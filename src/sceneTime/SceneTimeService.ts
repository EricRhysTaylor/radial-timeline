import { Component, MarkdownView, Notice, TFile, normalizePath } from 'obsidian';
import { attachManualTimes, manualTimeKey, manualTimeQuote } from './manualTime';
import type RadialTimelinePlugin from '../main';
import { getActiveFrontmatterMappings, normalizeFrontmatterKeys } from '../utils/frontmatter';
import { resolveSceneTime, scanSceneTime, type SceneTimeSnapshot, type TimeDecision } from './model';

const STORE_DIR = 'Radial Timeline/Scene Time';
const STORE_PATH = `${STORE_DIR}/decisions.json`;
interface TimeStore { schemaVersion: 1; scenes: Record<string, Record<string, TimeDecision>> }

export function parseTimeStore(raw: string): TimeStore {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object' || !('schemaVersion' in value) || value.schemaVersion !== 1
        || !('scenes' in value) || !value.scenes || typeof value.scenes !== 'object' || Array.isArray(value.scenes)) {
        throw new Error('Unsupported scene time decisions file');
    }
    const scenes = value.scenes as Record<string, unknown>; // SAFE: non-array object validated above.
    for (const decisions of Object.values(scenes)) {
        if (!decisions || typeof decisions !== 'object' || Array.isArray(decisions)) throw new Error('Invalid scene time decisions');
        const entries = decisions as Record<string, unknown>; // SAFE: non-array object validated above.
        for (const key of Object.keys(entries)) manualTimeQuote(key);
        for (const decision of Object.values(entries)) {
            if (!decision || typeof decision !== 'object' || !('action' in decision) || typeof decision.action !== 'string'
                || !['add', 'checkpoint', 'exclude'].includes(decision.action) || !('minutes' in decision)
                || typeof decision.minutes !== 'number' || !Number.isFinite(decision.minutes) || decision.minutes < 0) {
                throw new Error('Invalid scene time contribution');
            }
        }
    }
    return value as TimeStore; // SAFE: schema and every nested decision validated above.
}

export class SceneTimeService extends Component {
    private data: TimeStore = { schemaVersion: 1, scenes: {} };
    private revision = 0;
    private cache = new Map<string, { source: string; when: unknown; revision: number; snapshot: SceneTimeSnapshot }>();
    private listeners = new Set<() => void>();
    private pendingWrite: Promise<void> = Promise.resolve();
    private timer: number | undefined;
    error: string | null = null;

    constructor(readonly plugin: RadialTimelinePlugin) { super(); }

    async initialize(): Promise<void> {
        try {
            const io = this.plugin.app.vault.adapter; // SAFE: JSON sidecar loads before the Vault index is ready.
            if (await io.exists(STORE_PATH)) this.data = parseTimeStore(await io.read(STORE_PATH));
        } catch (error) {
            this.error = `Scene time decisions could not be loaded: ${error instanceof Error ? error.message : String(error)}`;
            new Notice(this.error);
        }
    }

    onload(): void {
        this.registerEvent(this.plugin.app.workspace.on('file-open', () => this.scheduleRefresh()));
        this.registerEvent(this.plugin.app.metadataCache.on('changed', () => this.scheduleRefresh()));
        this.registerEvent(this.plugin.app.vault.on('rename', (file, oldPath) => {
            if (!(file instanceof TFile) || !this.data.scenes[oldPath]) return;
            const newPath = file.path;
            void this.write(data => {
                if (data.scenes[newPath]) throw new Error('Scene time destination already has decisions; source decisions were preserved.');
                data.scenes[newPath] = data.scenes[oldPath];
                delete data.scenes[oldPath];
            }).catch(error => new Notice(String(error)));
        }));
        this.register(() => { if (this.timer !== undefined) window.clearTimeout(this.timer); this.listeners.clear(); this.cache.clear(); });
    }

    metadata(file: TFile): Record<string, unknown> | null {
        const raw = this.plugin.app.metadataCache.getFileCache(file)?.frontmatter;
        if (!raw) return null;
        const metadata = normalizeFrontmatterKeys(raw, getActiveFrontmatterMappings(this.plugin.settings));
        return metadata.Class === 'Scene' ? metadata : null;
    }

    snapshot(file: TFile, source: string): SceneTimeSnapshot | null {
        const metadata = this.metadata(file);
        if (!metadata) return null;
        const cached = this.cache.get(file.path);
        if (cached && cached.source === source && cached.when === metadata.When && cached.revision === this.revision) return cached.snapshot;
        const scan = scanSceneTime(source);
        attachManualTimes(source, scan, this.data.scenes[file.path] || {});
        const snapshot = resolveSceneTime(scan, this.data.scenes[file.path] || {}, metadata.When);
        if (this.cache.size >= 32 && !this.cache.has(file.path)) this.cache.delete(Array.from(this.cache.keys())[0]);
        this.cache.set(file.path, { source, when: metadata.When, revision: this.revision, snapshot });
        return snapshot;
    }

    detachedManualTimes(file: TFile, source: string): Array<{ key: string; quote: string; minutes: number }> {
        const decisions = this.data.scenes[file.path] || {};
        return attachManualTimes(source, scanSceneTime(source), decisions)
            .map(key => ({ key, quote: manualTimeQuote(key)!, minutes: decisions[key].minutes }));
    }

    async assignSelection(file: TFile, source: string, quote: string, minutes: number): Promise<void> {
        if (!this.metadata(file)) throw new Error('Select prose in a Scene note.');
        if (!quote.trim() || /[\r\n]/.test(quote) || !Number.isFinite(minutes) || minutes <= 0)
            throw new Error('Select one line of prose and enter a positive duration.');
        let current = await this.plugin.app.vault.cachedRead(file);
        this.plugin.app.workspace.iterateAllLeaves(leaf => {
            if (leaf.view instanceof MarkdownView && leaf.view.file === file) current = leaf.view.getViewData();
        });
        if (current !== source) throw new Error('The note changed. Select the text again.');
        const key = manualTimeKey(quote);
        await this.write(data => {
            const decisions = data.scenes[file.path] || {};
            const next = { ...decisions, [key]: { action: 'add' as const, minutes } };
            if (attachManualTimes(source, scanSceneTime(source), next).includes(key))
                throw new Error('Choose unique prose without overlapping time cues or assignments.');
            data.scenes[file.path] = next;
        });
    }

    async removeManualTime(file: TFile, key: string): Promise<void> {
        if (manualTimeQuote(key) === null) throw new Error('Not a manual assignment.');
        await this.write(data => { if (data.scenes[file.path]) delete data.scenes[file.path][key]; });
    }

    subscribe(listener: () => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    scheduleRefresh(): void {
        if (this.timer !== undefined) window.clearTimeout(this.timer);
        this.timer = window.setTimeout(() => {
            this.timer = undefined;
            this.listeners.forEach(listener => listener());
        }, 160);
    }

    async decide(file: TFile, key: string, decision: TimeDecision | null): Promise<void> {
        let openSource: string | null = null;
        this.plugin.app.workspace.iterateAllLeaves(leaf => {
            if (leaf.view instanceof MarkdownView && leaf.view.file === file) openSource = leaf.view.getViewData();
        });
        const source = openSource !== null ? openSource : await this.plugin.app.vault.cachedRead(file);
        const cue = this.snapshot(file, source)?.cues.find(item => item.key === key);
        if (!cue || cue.duplicate) throw new Error('This marker changed or is duplicated. Review the current prose before saving.');
        if (decision && (!Number.isFinite(decision.minutes) || decision.minutes < 0)) throw new Error('Enter a non-negative elapsed duration.');
        await this.write(data => {
            const decisions = data.scenes[file.path] || {};
            if (decision) decisions[key] = decision;
            else delete decisions[key];
            data.scenes[file.path] = decisions;
        });
    }

    async confirmAll(file: TFile, keys: string[]): Promise<void> {
        let source = await this.plugin.app.vault.cachedRead(file);
        this.plugin.app.workspace.iterateAllLeaves(leaf => {
            if (leaf.view instanceof MarkdownView && leaf.view.file === file) source = leaf.view.getViewData();
        });
        const snapshot = this.snapshot(file, source);
        if (!snapshot) throw new Error('This note is no longer a scene.');
        const cues = keys.map(key => snapshot.cues.find(cue => cue.key === key));
        if (cues.some(cue => !cue || cue.duplicate || cue.decision || cue.suggestedMinutes === null
            || (cue.kind !== 'advance' && cue.kind !== 'checkpoint'))) {
            throw new Error('The cues changed. Reopen scene time before confirming all.');
        }
        await this.write(data => {
            const decisions = data.scenes[file.path] || {};
            if (keys.some(key => decisions[key])) throw new Error('A cue was already confirmed. Reopen scene time before confirming all.');
            for (const cue of cues) {
                if (!cue || cue.suggestedMinutes === null) continue;
                decisions[cue.key] = { action: cue.kind === 'checkpoint' ? 'checkpoint' : 'add', minutes: cue.suggestedMinutes };
            }
            data.scenes[file.path] = decisions;
        });
    }

    private write(update: (data: TimeStore) => void): Promise<void> {
        const operation = this.pendingWrite.then(async () => {
            if (this.error) throw new Error(this.error);
            const next = parseTimeStore(JSON.stringify(this.data));
            update(next);
            const io = this.plugin.app.vault.adapter; // SAFE: serialized JSON sidecar writes avoid file-index races; no note content is modified.
            const root = normalizePath('Radial Timeline');
            if (!(await io.exists(root))) await io.mkdir(root);
            if (!(await io.exists(STORE_DIR))) await io.mkdir(STORE_DIR);
            await io.write(STORE_PATH, JSON.stringify(next, null, 2));
            this.data = next;
            this.revision++;
            this.scheduleRefresh();
        });
        // The caller receives the failure; release the queue so a later explicit retry can run.
        this.pendingWrite = operation.catch(() => {}); // SAFE: failure is returned to the caller for a visible Notice.
        return operation;
    }
}
