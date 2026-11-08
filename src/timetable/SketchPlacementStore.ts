/*
 * Sketch placement sidecar
 * ------------------------
 * Where each sketch sits among the scenes (the scene it follows and its order
 * there) is plugin state, not the author's writing, so it lives in
 * `Radial Timeline/Sketch Placement/placements.json`, which syncs with the
 * vault, and never in the sketch note. Modeled on the Scene Time sidecar:
 * keyed by note path, kept current as notes are renamed, moved or deleted.
 *
 * Earlier versions wrote `Place after scene` and `Sketch order` into sketch
 * notes. While the vault has no sidecar yet, those values are read once into
 * it; the lines stay in the notes as the author has them and are not read
 * again. From then on the sidecar is the only source.
 */

import { Component, Notice, TAbstractFile, TFile, normalizePath } from 'obsidian';
import type RadialTimelinePlugin from '../main';
import { t } from '../i18n';
import { readFrontmatterProperty } from '../utils/frontmatterKeys';
import { buildTableRow } from './timetableModel';
import { LEGACY_SKETCH_AFTER_SCENE, LEGACY_SKETCH_ORDER, type SketchPlacement } from './sketchPlacementFields';

const ROOT_DIR = 'Radial Timeline';
const STORE_DIR = `${ROOT_DIR}/Sketch Placement`;
export const SKETCH_PLACEMENT_PATH = `${STORE_DIR}/placements.json`;

interface PlacementFile { schemaVersion: 1; sketches: Record<string, SketchPlacement> }

export function parsePlacementFile(raw: string): PlacementFile {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object' || !('schemaVersion' in value) || value.schemaVersion !== 1
        || !('sketches' in value) || !value.sketches || typeof value.sketches !== 'object' || Array.isArray(value.sketches)) {
        throw new Error(t('sketchPlacement.unsupportedFile'));
    }
    const sketches: Record<string, SketchPlacement> = {};
    for (const [path, entry] of Object.entries(value.sketches as Record<string, unknown>)) { // SAFE: non-array object validated above
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error(t('sketchPlacement.unsupportedFile'));
        const placement = cleanPlacement(entry as SketchPlacement); // SAFE: each field is type-checked by cleanPlacement
        if (placement) sketches[path] = placement;
    }
    return { schemaVersion: 1, sketches };
}

/** Only a non-empty scene ID and a finite order are kept; an entry with neither is no entry. */
function cleanPlacement(entry: { after?: unknown; order?: unknown }): SketchPlacement | null {
    const placement: SketchPlacement = {};
    if (typeof entry.after === 'string' && entry.after.trim()) placement.after = entry.after.trim();
    if (typeof entry.order === 'number' && Number.isFinite(entry.order)) placement.order = entry.order;
    return placement.after === undefined && placement.order === undefined ? null : placement;
}

/** Placement written in a note by an earlier version, or null when it has none. */
export function legacyNotePlacement(frontmatter: Record<string, unknown> | undefined): SketchPlacement | null {
    return cleanPlacement({
        after: readFrontmatterProperty(frontmatter, LEGACY_SKETCH_AFTER_SCENE),
        order: readFrontmatterProperty(frontmatter, LEGACY_SKETCH_ORDER),
    });
}

export class SketchPlacementStore extends Component {
    private data: PlacementFile = { schemaVersion: 1, sketches: {} };
    private hasFile = false;
    private imported = false;
    private importDone!: () => void;
    /** Writes wait for the one-time import, so it never misses a note. */
    private readonly importReady = new Promise<void>(resolve => { this.importDone = resolve; });
    private pendingWrite: Promise<void> = Promise.resolve();
    private readonly listeners = new Set<() => void>();
    error: string | null = null;

    constructor(private readonly plugin: RadialTimelinePlugin) { super(); }

    /** Read the sidecar, before the vault index is ready. */
    async initialize(): Promise<void> {
        try {
            const io = this.plugin.app.vault.adapter; // SAFE: JSON sidecar loads before the Vault index is ready
            this.hasFile = await io.exists(SKETCH_PLACEMENT_PATH);
            if (this.hasFile) this.data = parsePlacementFile(await io.read(SKETCH_PLACEMENT_PATH));
        } catch (error) {
            this.error = t('sketchPlacement.loadFailed', { detail: error instanceof Error ? error.message : String(error) });
            new Notice(this.error, 0);
        }
    }

    onload(): void {
        const { vault, workspace } = this.plugin.app;
        workspace.onLayoutReady(() => { void this.importFromNotes(); });
        this.registerEvent(vault.on('rename', (file, oldPath) => this.moved(file, oldPath)));
        this.registerEvent(vault.on('delete', file => this.deleted(file)));
        // The sidecar changed on disk (another device synced it): read it again.
        this.registerEvent(vault.on('modify', file => { if (file.path === SKETCH_PLACEMENT_PATH) void this.reload(); }));
        this.registerEvent(vault.on('create', file => { if (file.path === SKETCH_PLACEMENT_PATH) void this.reload(); }));
        this.register(() => this.listeners.clear());
    }

    get(path: string): SketchPlacement | undefined {
        return this.data.sketches[path];
    }

    subscribe(listener: () => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    /** Set or clear several sketches' placements in one write. A null placement clears it. */
    set(changes: Iterable<readonly [string, SketchPlacement | null]>): Promise<void> {
        const list = [...changes];
        return this.write(data => {
            for (const [path, placement] of list) {
                const clean = placement ? cleanPlacement(placement) : null;
                if (clean) data.sketches[path] = clean;
                else delete data.sketches[path];
            }
        });
    }

    /**
     * The one-time import: while the vault has no sidecar, copy every sketch
     * note's old placement lines into one. The notes are not edited. With
     * nothing to copy, no file is made; the first placement makes it.
     */
    async importFromNotes(): Promise<void> {
        if (this.imported) return;
        try {
            if (this.hasFile || this.error) return;
            const { app, settings } = this.plugin;
            const found: Record<string, SketchPlacement> = {};
            for (const file of app.vault.getMarkdownFiles()) {
                const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter;
                const placement = legacyNotePlacement(frontmatter);
                if (placement && buildTableRow(file.path, file.basename, frontmatter, settings).kind === 'sketch') found[file.path] = placement;
            }
            if (Object.keys(found).length === 0) return;
            await this.writeNow(data => {
                // The sidecar wins over anything a note still says.
                for (const [path, placement] of Object.entries(found)) data.sketches[path] ??= placement;
            });
        } catch (error) {
            console.error('[Sketch placement] Could not copy the sketch positions from the notes', error);
            new Notice(t('ui.timetable.writeFailed', { message: error instanceof Error ? error.message : String(error) }), 8000);
        } finally {
            this.imported = true;
            this.importDone();
        }
    }

    private moved(file: TAbstractFile, oldPath: string): void {
        const changes: Array<[string, string]> = [];
        for (const path of Object.keys(this.data.sketches)) {
            if (path === oldPath) changes.push([path, file.path]);
            else if (!(file instanceof TFile) && path.startsWith(`${oldPath}/`)) changes.push([path, `${file.path}${path.slice(oldPath.length)}`]);
        }
        if (changes.length === 0) return;
        void this.write(data => {
            for (const [from, to] of changes) {
                const placement = data.sketches[from];
                if (!placement) continue;
                data.sketches[to] = placement;
                delete data.sketches[from];
            }
        }).catch(error => new Notice(String(error)));
    }

    private deleted(file: TAbstractFile): void {
        const gone = Object.keys(this.data.sketches).filter(path => path === file.path || (!(file instanceof TFile) && path.startsWith(`${file.path}/`)));
        if (gone.length === 0) return;
        void this.write(data => { for (const path of gone) delete data.sketches[path]; }).catch(error => new Notice(String(error)));
    }

    private reload(): Promise<void> {
        const operation = this.pendingWrite.then(async () => {
            const io = this.plugin.app.vault.adapter; // SAFE: the sidecar is read directly, as at load
            if (!(await io.exists(SKETCH_PLACEMENT_PATH))) return;
            const next = parsePlacementFile(await io.read(SKETCH_PLACEMENT_PATH));
            this.hasFile = true;
            this.error = null;
            if (JSON.stringify(next) === JSON.stringify(this.data)) return;
            this.data = next;
            this.notify();
        });
        this.pendingWrite = operation.catch(error => {
            this.error = t('sketchPlacement.loadFailed', { detail: error instanceof Error ? error.message : String(error) });
            new Notice(this.error, 0);
        });
        return this.pendingWrite;
    }

    private async write(update: (data: PlacementFile) => void): Promise<void> {
        await this.importReady;
        return this.writeNow(update);
    }

    private writeNow(update: (data: PlacementFile) => void): Promise<void> {
        const operation = this.pendingWrite.then(async () => {
            if (this.error) throw new Error(this.error);
            const next = parsePlacementFile(JSON.stringify(this.data));
            update(next);
            const io = this.plugin.app.vault.adapter; // SAFE: serialized JSON sidecar writes; no note is modified
            if (!(await io.exists(normalizePath(ROOT_DIR)))) await io.mkdir(normalizePath(ROOT_DIR));
            if (!(await io.exists(STORE_DIR))) await io.mkdir(STORE_DIR);
            await io.write(SKETCH_PLACEMENT_PATH, JSON.stringify(next, null, 2));
            this.data = next;
            this.hasFile = true;
            this.notify();
        });
        // The caller receives the failure; release the queue so a later explicit retry can run.
        this.pendingWrite = operation.catch(() => {}); // SAFE: failure is returned to the caller for a visible Notice
        return operation;
    }

    private notify(): void {
        this.listeners.forEach(listener => listener());
    }
}
