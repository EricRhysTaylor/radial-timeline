import { Notice, TFile, normalizePath, parseYaml } from 'obsidian';
import { parseDocument, isMap, isScalar } from 'yaml';
import type RadialTimelinePlugin from '../main';
import { ErtModal } from '../ui/ErtModal';
import { t } from '../i18n';
import { getBookIdForPath } from '../utils/books';
import { canonicalizeFrontmatterKey, frontmatterValueToText, getActiveFrontmatterMappings } from '../utils/frontmatter';
import { buildDecimalSceneInsertionPrefix, isSafeSceneInsertionPrefix } from '../services/SceneInsertService';
import { splitNumberPrefix } from '../utils/noteTitle';
import { timelineItemAct } from '../utils/acts';

export type TimelineNoteTarget = { anchorPath: string; subplot: string };

function noteFrontmatter(content: string): Record<string, unknown> {
    const start = content.match(/^---\s*\r?\n/);
    if (!start) return {};
    const tail = content.slice(start[0].length);
    const end = /^---\s*$/m.exec(tail);
    if (!end) throw new Error(t('ui.timetable.noteDropInvalidYaml'));
    const parsed: unknown = parseYaml(tail.slice(0, end.index)) ?? {};
    if (typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(t('ui.timetable.noteDropInvalidYaml'));
    return parsed as Record<string, unknown>;
}

/** Change only the chosen property values; every other byte of the note stays intact. */
export function applyTimelineNoteFields(content: string, act: number, subplot: string, replaceAct: boolean, replaceSubplot: boolean, mappings?: Record<string, string>): string {
    const start = content.match(/^---\s*\r?\n/);
    const newline = start?.[0].endsWith('\r\n') ? '\r\n' : '\n';
    const tail = start ? content.slice(start[0].length) : '';
    const end = start ? /^---\s*$/m.exec(tail) : null;
    if (start && !end) throw new Error(t('ui.timetable.noteDropInvalidYaml'));
    const raw = start && end ? tail.slice(0, end.index) : '';
    const parsed: unknown = raw ? parseYaml(raw) : {};
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(t('ui.timetable.noteDropInvalidYaml'));
    const doc = parseDocument(raw);
    if (doc.errors.length || (doc.contents && !isMap(doc.contents))) throw new Error(t('ui.timetable.noteDropInvalidYaml'));
    const edits: Array<{start: number; end: number; value: string}> = [];
    const additions: string[] = ['Class: Scene'];
    const seen = new Set<string>();
    if (isMap(doc.contents)) for (const pair of doc.contents.items) {
        if (!isScalar(pair.key) || typeof pair.key.value !== 'string') continue;
        const key = canonicalizeFrontmatterKey(pair.key.value, mappings);
        if (!['Class', 'Act', 'Subplot'].includes(key)) continue;
        if (seen.has(key)) throw new Error(t('ui.timetable.noteDropInvalidYaml'));
        seen.add(key);
        if (key === 'Class') throw new Error(t('ui.timetable.noteDropHasClass'));
        const value = key === 'Act' && replaceAct ? String(act) : key === 'Subplot' && replaceSubplot ? JSON.stringify(subplot) : null;
        if (value !== null) {
            if (pair.value && 'anchor' in pair.value && pair.value.anchor) throw new Error(t('ui.timetable.timelineDropComplexProperty'));
            const range = pair.value?.range;
            if (!range) throw new Error(t('ui.timetable.timelineDropComplexProperty'));
            const original = raw.slice(range[0], range[1]);
            if (/(?:^|[\s\[{,])&[\w-]+/.test(original)) throw new Error(t('ui.timetable.timelineDropComplexProperty'));
            const space = range[0] === range[1] && raw[range[0] - 1] === ':' ? ' ' : '';
            edits.push({ start: range[0], end: range[1], value: space + value + (original.endsWith('\n') ? newline : '') });
        }
    }
    if (!seen.has('Act')) additions.push(`Act: ${act}`);
    if (!seen.has('Subplot')) additions.push(`Subplot: ${JSON.stringify(subplot)}`);
    let updated = raw;
    edits.sort((a, b) => b.start - a.start).forEach(edit => { updated = updated.slice(0, edit.start) + edit.value + updated.slice(edit.end); });
    const inserted = additions.join(newline) + newline;
    const check = parseDocument(inserted + updated);
    if (check.errors.length || !isMap(check.contents)) throw new Error(t('ui.timetable.noteDropInvalidYaml'));
    if (!start) return `---${newline}${inserted}---${newline}${newline}${content}`;
    return start[0] + inserted + updated + tail.slice(end!.index);
}

export class TimelineNoteDropModal extends ErtModal {
    constructor(private readonly plugin: RadialTimelinePlugin, private readonly file: TFile, private readonly bookId: string, private readonly target: TimelineNoteTarget) { super(plugin.app); }
    onOpen(): void {
        this.applyShell({ size: 'lg' });
        this.mountHeader({ title: t('ui.timetable.noteDropTitle'), subtitle: this.file.path });
        const status = this.contentEl.createDiv({ cls: 'ert-canvas-sketch-order-hint' });
        const conflicts = this.contentEl.createDiv();
        const actions = this.mountActions();
        actions.createEl('button', { text: t('common.cancel') }).onclick = () => this.close();
        const confirm = actions.createEl('button', { text: t('ui.timetable.noteDropConfirm'), cls: 'ert-note-drop-confirm mod-cta' });
        confirm.disabled = true;
        void (async () => {
            const book = this.plugin.settings.books.find(item => item.id === this.bookId);
            if (!book || getBookIdForPath(this.plugin.settings.books, this.target.anchorPath) !== book.id) throw new Error(t('ui.canvasSketch.noBook'));
            const scenes = await this.plugin.getSceneData({ sourcePath: book.sourceFolder });
            const target = scenes.find(item => item.path === this.target.anchorPath && item.itemType === 'Scene');
            if (!target) throw new Error(t('ui.timetable.timelineDropMissingTarget'));
            let prefix = buildDecimalSceneInsertionPrefix(scenes, this.target.anchorPath);
            if (!isSafeSceneInsertionPrefix(scenes, this.target.anchorPath, prefix)) {
                const anchorPrefix = this.target.anchorPath.split('/').pop()?.match(/^\s*(\d+)/)?.[1];
                if (anchorPrefix) for (let suffix = 1; suffix <= 999; suffix++) {
                    const candidate = `${anchorPrefix}.${suffix}`;
                    if (isSafeSceneInsertionPrefix(scenes, this.target.anchorPath, candidate)) { prefix = candidate; break; }
                }
            }
            if (!isSafeSceneInsertionPrefix(scenes, this.target.anchorPath, prefix)) throw new Error(t('ui.timetable.timelineDropNoNumber'));
            const act = timelineItemAct(target);
            const name = `${prefix} ${splitNumberPrefix(this.file.basename).title}.md`;
            const initialContent = await this.app.vault.read(this.file);
            const mappings = getActiveFrontmatterMappings(this.plugin.settings);
            const fm = noteFrontmatter(initialContent);
            const keyFor = (canonical: string) => Object.keys(fm).find(key => canonicalizeFrontmatterKey(key, mappings) === canonical);
            const actKey = keyFor('Act'); const subplotKey = keyFor('Subplot');
            status.setText(t('ui.timetable.timelineDropPreview', { book: book.title, scene: target.title || this.target.anchorPath, act: String(act), subplot: this.target.subplot, name }));
            const choice = (label: string, oldValue: unknown, desired: string): HTMLInputElement | null => {
                if (oldValue === undefined || frontmatterValueToText(oldValue) === desired || (Array.isArray(oldValue) && oldValue.includes(desired))) return null;
                const row = conflicts.createEl('label', { cls: 'setting-item' });
                const input = row.createEl('input', { type: 'checkbox' });
                row.createSpan({ text: t('ui.timetable.timelineDropConflict', { field: label, current: frontmatterValueToText(oldValue), value: desired }) });
                return input;
            };
            const replaceAct = choice('Act', actKey ? fm[actKey] : undefined, String(act));
            const replaceSubplot = choice('Subplot', subplotKey ? fm[subplotKey] : undefined, this.target.subplot);
            confirm.disabled = false;
            confirm.onclick = () => { confirm.disabled = true; void (async () => {
                const oldPath = this.file.path;
                const current = await this.app.vault.read(this.file);
                if (current !== initialContent) throw new Error(t('ui.timetable.timelineDropChanged'));
                const next = applyTimelineNoteFields(current, act, this.target.subplot, !!replaceAct?.checked, !!replaceSubplot?.checked, mappings);
                const latest = await this.plugin.getSceneData({ sourcePath: book.sourceFolder });
                const latestTarget = latest.find(item => item.path === this.target.anchorPath && item.itemType === 'Scene');
                if (!latestTarget || timelineItemAct(latestTarget) !== act) throw new Error(t('ui.timetable.timelineDropChanged'));
                if (!isSafeSceneInsertionPrefix(latest, this.target.anchorPath, prefix)) throw new Error(t('ui.timetable.timelineDropNoNumber'));
                const folder = getBookIdForPath(this.plugin.settings.books, oldPath) === book.id ? this.file.parent?.path ?? book.sourceFolder : book.sourceFolder;
                const destination = normalizePath(`${folder}/${name}`);
                if (destination !== oldPath && this.app.vault.getAbstractFileByPath(destination)) throw new Error(t('ui.timetable.noteDropExists'));
                if (destination !== oldPath) await this.app.fileManager.renameFile(this.file, destination);
                try { await this.app.vault.process(this.file, text => { if (text !== current) throw new Error(t('ui.timetable.timelineDropChanged')); return next; }); }
                catch (error) { if (destination !== oldPath) await this.app.fileManager.renameFile(this.file, oldPath); throw error; }
                const keptConflict = (replaceAct && !replaceAct.checked) || (replaceSubplot && !replaceSubplot.checked);
                this.close(); this.plugin.refreshTimelineIfNeeded(null);
                new Notice(keptConflict ? t('ui.timetable.timelineDropKept', { name }) : t('ui.timetable.timelineDropDone', { name, scene: target.title || this.target.anchorPath }));
            })().catch((error: unknown) => { confirm.disabled = false; status.setText(error instanceof Error ? error.message : String(error)); }); };
        })().catch((error: unknown) => status.setText(error instanceof Error ? error.message : String(error)));
    }
}
