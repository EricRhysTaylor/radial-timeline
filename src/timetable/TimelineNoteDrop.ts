import { Notice, TFile, normalizePath, setIcon } from 'obsidian';
import type RadialTimelinePlugin from '../main';
import { ErtModal } from '../ui/ErtModal';
import { t } from '../i18n';
import { getBookIdForPath } from '../utils/books';
import { authorKeyFromMappings, canonicalizeFrontmatterKey, frontmatterValueToText, getActiveFrontmatterMappings } from '../utils/frontmatter';
import { buildDecimalSceneInsertionPrefix, isSafeSceneInsertionPrefix, readAnchorWhen } from '../services/SceneInsertService';
import { splitNumberPrefix } from '../utils/noteTitle';
import { timelineItemAct } from '../utils/acts';
import { addSceneIntakeTemplate } from './sceneIntakeTemplate';
import { applyFrontmatterEdits, frontmatterValues, isBlankFrontmatterValue, readFrontmatterText, replaceValueEdit, yamlKey, type TextEdit } from '../utils/frontmatterText';
import { scenePropertySetLabel } from '../utils/yamlTemplateNormalize';

export type TimelineNoteTarget = { anchorPath: string; subplot: string };

function noteFrontmatter(content: string): Record<string, unknown> {
    const text = readFrontmatterText(content);
    return text ? frontmatterValues(text) : {};
}

/** Change only the chosen property values; every other byte of the note stays intact. */
export function applyTimelineNoteFields(content: string, act: number, subplot: string, replaceAct: boolean, replaceSubplot: boolean, mappings?: Record<string, string>): string {
    const text = readFrontmatterText(content);
    const lines = (classLine: boolean, hasAct: boolean, hasSubplot: boolean) => [
        ...(classLine ? [`${yamlKey(authorKeyFromMappings('Class', mappings))}: Scene`] : []),
        ...(hasAct ? [] : [`${yamlKey(authorKeyFromMappings('Act', mappings))}: ${act}`]),
        ...(hasSubplot ? [] : [`${yamlKey(authorKeyFromMappings('Subplot', mappings))}: ${JSON.stringify(subplot)}`]),
    ];
    if (!text) return `---\n${lines(true, false, false).join('\n')}\n---\n\n${content}`;
    const edits: TextEdit[] = [];
    const seen = new Set<string>();
    for (const field of text.fields) {
        const key = canonicalizeFrontmatterKey(field.key, mappings);
        if (!['Class', 'Act', 'Subplot'].includes(key)) continue;
        if (seen.has(key)) throw new Error(t('ui.timetable.noteDropInvalidYaml'));
        seen.add(key);
        if (key === 'Class') {
            if (!isBlankFrontmatterValue(field.value)) throw new Error(t('ui.timetable.noteDropHasClass'));
            edits.push(replaceValueEdit(text, field, 'Scene'));
        } else if (key === 'Act' && replaceAct) edits.push(replaceValueEdit(text, field, String(act)));
        else if (key === 'Subplot' && replaceSubplot) edits.push(replaceValueEdit(text, field, JSON.stringify(subplot)));
    }
    const added = lines(!seen.has('Class'), seen.has('Act'), seen.has('Subplot'));
    if (added.length) edits.push({ start: 0, end: 0, text: added.map(line => line + text.newline).join('') });
    return applyFrontmatterEdits(text, edits);
}

export class TimelineNoteDropModal extends ErtModal {
    constructor(private readonly plugin: RadialTimelinePlugin, private readonly file: TFile, private readonly bookId: string, private readonly target: TimelineNoteTarget) { super(plugin.app); }
    onOpen(): void {
        this.applyShell({ size: 'lg', containerClasses: ['ert-timeline-note-drop'] });
        this.contentEl.addClass('ert-drag-confirm-modal');
        this.mountHeader({ title: t('ui.timetable.noteDropTitle'), subtitle: this.file.path, badge: { text: t('ui.timetable.noteDropScene') } });
        const status = this.contentEl.createDiv({ cls: 'ert-canvas-sketch-order-hint' });
        status.hide();
        const showError = (error: unknown) => { status.setText(error instanceof Error ? error.message : String(error)); status.show(); };
        const summary = this.contentEl.createDiv({ cls: 'ert-drag-confirm-list' });
        const section = summary.createDiv({ cls: 'ert-drag-confirm-section' });
        section.createDiv({ cls: 'ert-drag-confirm-section-title', text: t('ui.addSceneConfirmModal.summaryTitle') });
        const grid = section.createDiv({ cls: 'ert-drag-confirm-impact-grid' });
        const conflicts = this.contentEl.createDiv({ cls: 'ert-drag-confirm-section' });
        conflicts.hide();
        const note = this.contentEl.createDiv({ cls: 'ert-drag-confirm-row' });
        setIcon(note.createDiv({ cls: 'ert-drag-confirm-row-icon' }), 'info');
        note.createDiv({ cls: 'ert-drag-confirm-row-text', text: t('ui.timetable.timelineDropPreserveNote') });
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
            const card = (label: string, value: string, icon: string): HTMLElement => {
                const item = grid.createDiv({ cls: 'ert-drag-confirm-impact-card' });
                setIcon(item.createDiv({ cls: 'ert-drag-confirm-row-icon' }), icon);
                const text = item.createDiv({ cls: 'ert-drag-confirm-impact-text' });
                text.createDiv({ cls: 'ert-drag-confirm-impact-label', text: label });
                return text.createDiv({ cls: 'ert-drag-confirm-impact-value', text: value });
            };
            card(t('ui.timetable.timelineDropBookLabel'), book.title, 'book-open');
            card(t('ui.timetable.timelineDropAfterLabel'), target.title || this.target.anchorPath, 'list-ordered');
            const actValue = card(t('ui.timetable.timelineDropActLabel'), String(act), 'book-open-text');
            const subplotValue = card(t('ui.addSceneConfirmModal.subplotLabel'), this.target.subplot, 'orbit');
            card(t('ui.timetable.timelineDropFilenameLabel'), name, 'file-text');
            card(t('ui.scenePropertiesSection.heading'), scenePropertySetLabel(this.plugin.settings), 'list');
            const choice = (label: string, oldValue: unknown, desired: string): HTMLInputElement | null => {
                if (oldValue === undefined || frontmatterValueToText(oldValue) === desired || (Array.isArray(oldValue) && oldValue.includes(desired))) return null;
                if (!conflicts.hasChildNodes()) { conflicts.createDiv({ cls: 'ert-drag-confirm-section-title', text: t('ui.timetable.timelineDropExistingProperties') }); conflicts.show(); }
                const row = conflicts.createEl('label', { cls: 'ert-drag-confirm-row' });
                const input = row.createEl('input', { type: 'checkbox' });
                row.createSpan({ cls: 'ert-drag-confirm-row-text', text: t('ui.timetable.timelineDropConflict', { field: label, current: frontmatterValueToText(oldValue), value: desired }) });
                return input;
            };
            const replaceAct = choice('Act', actKey ? fm[actKey] : undefined, String(act));
            const replaceSubplot = choice('Subplot', subplotKey ? fm[subplotKey] : undefined, this.target.subplot);
            const refreshValues = () => {
                actValue.setText(actKey && !replaceAct?.checked ? frontmatterValueToText(fm[actKey]) || '—' : String(act));
                subplotValue.setText(subplotKey && !replaceSubplot?.checked ? frontmatterValueToText(fm[subplotKey]) || '—' : this.target.subplot);
            };
            if (replaceAct) replaceAct.onchange = refreshValues;
            if (replaceSubplot) replaceSubplot.onchange = refreshValues;
            refreshValues();
            confirm.disabled = false;
            confirm.onclick = () => { confirm.disabled = true; void (async () => {
                const oldPath = this.file.path;
                const current = await this.app.vault.read(this.file);
                if (current !== initialContent) throw new Error(t('ui.timetable.timelineDropChanged'));
                const classified = applyTimelineNoteFields(current, act, this.target.subplot, !!replaceAct?.checked, !!replaceSubplot?.checked, mappings);
                const anchorFile = this.app.vault.getAbstractFileByPath(this.target.anchorPath);
                const when = anchorFile instanceof TFile ? await readAnchorWhen(this.app, this.plugin.settings, anchorFile) : '';
                const next = addSceneIntakeTemplate(classified, this.plugin.settings, { act, when });
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
            })().catch((error: unknown) => { confirm.disabled = false; showError(error); }); };
        })().catch(showError);
    }
}
