import { setAccessibleLabel } from '../utils/domTooltip';
/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 *
 * Timetable: the sketch drawer
 * ----------------------------
 * A full-width drawer under a sketch's row, where the sketch gets room to be
 * written. The text is the note's own body, never a YAML field. Saving goes
 * through `vault.process` and touches only what follows the frontmatter, so the
 * properties stay byte for byte as they were. If the note changes elsewhere
 * while the drawer holds unsaved text, the drawer says so and never overwrites
 * silently.
 */

import { Component, getFrontMatterInfo, MarkdownRenderer, setIcon, type TFile } from 'obsidian';
import type RadialTimelinePlugin from '../main';
import { t } from '../i18n';
import { getConfiguredActCount, parseActLabels, resolveActLabel } from '../utils/acts';
import { canonicalizeFrontmatterKey, getActiveFrontmatterMappings } from '../utils/frontmatter';
import { authorKeyFor } from './timetableFiles';
import type { RingLayout, TimetableRow } from './timetableModel';

const SAVE_DELAY_MS = 700;

export interface SketchDrawerHost {
    promote(file: TFile): void;
    openNote(file: TFile, evt: MouseEvent): void;
    close(path: string): void;
    /** The drawer's editor lost focus; the table may redraw now. */
    editingEnded(): void;
}

/** Split a note into its frontmatter block (kept as is) and its body. */
function splitBody(content: string): { head: string; body: string } {
    const info = getFrontMatterInfo(content);
    const start = info.exists ? info.contentStart : 0;
    return { head: content.slice(0, start), body: content.slice(start) };
}

/** The body as the editor shows it: without the blank line(s) that follow the frontmatter. */
function leadingBreaks(body: string): string {
    return /^(?:\r?\n)*/.exec(body)?.[0] ?? '';
}

export class SketchDrawer extends Component {
    readonly el: HTMLElement;
    private readonly barEl: HTMLElement;
    private readonly conflictEl: HTMLElement;
    private readonly bodyEl: HTMLElement;
    private textarea: HTMLTextAreaElement | null = null;
    /** The body on disk as of the last load or save. */
    private savedBody: string | null = null;
    /** Unsaved editor text, or null when the editor matches the saved body. */
    private draft: string | null = null;
    private saveTimer: number | null = null;
    private conflict = false;
    private wantsFocus = false;

    constructor(
        private readonly plugin: RadialTimelinePlugin,
        readonly file: TFile,
        private readonly host: SketchDrawerHost
    ) {
        super();
        this.el = createDiv({ cls: 'ert-timetable__drawer' });
        this.barEl = this.el.createDiv({ cls: 'ert-timetable__drawer-bar' });
        this.conflictEl = this.el.createDiv({ cls: 'ert-timetable__drawer-conflict is-hidden' });
        this.bodyEl = this.el.createDiv({ cls: 'ert-timetable__drawer-body' });
    }

    onload(): void {
        // Delegated handlers: the bar and the body are redrawn often.
        this.registerDomEvent(this.el, 'click', (evt: MouseEvent) => this.handleClick(evt));
        this.registerDomEvent(this.el, 'change', (evt: Event) => this.handleChange(evt));
        this.registerDomEvent(this.el, 'input', (evt: Event) => {
            if (evt.target === this.textarea) this.handleInput();
        });
        this.registerDomEvent(this.el, 'focusout', (evt: FocusEvent) => {
            if (evt.target === this.textarea) this.handleEditorBlur();
        });
        this.registerDomEvent(this.el, 'keydown', (evt: KeyboardEvent) => {
            if (evt.key === 'Escape') {
                evt.preventDefault();
                void this.flush().then(() => this.host.close(this.file.path));
                return;
            }
            if (evt.key === 'Enter' && evt.target instanceof Element && evt.target.matches('.ert-timetable__drawer-preview')) {
                evt.preventDefault();
                this.showEditor();
            }
        });
        this.registerEvent(this.plugin.app.vault.on('modify', file => {
            if (file.path === this.file.path) void this.syncFromDisk();
        }));
        void this.syncFromDisk();
    }

    onunload(): void {
        if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
        if (this.draft !== null && !this.conflict) void this.save();
        this.el.remove();
    }

    private handleClick(evt: MouseEvent): void {
        const target = evt.target instanceof Element ? evt.target : null;
        if (!target) return;
        const ring = target.closest<HTMLElement>('.ert-timetable__drawer-ring');
        if (ring?.dataset.ring) {
            // Show the new state at once; the table redraws the bar from the note afterwards.
            const on = !ring.hasClass('is-on');
            ring.toggleClass('is-on', on);
            ring.setAttr('aria-pressed', String(on));
            void this.toggleRing(ring.dataset.ring);
            return;
        }
        if (target.closest('.ert-timetable__drawer-promote')) {
            void this.flush().then(() => this.host.promote(this.file));
            return;
        }
        if (target.closest('.ert-timetable__drawer-open')) {
            void this.flush().then(() => this.host.openNote(this.file, evt));
            return;
        }
        if (target.closest('.ert-timetable__drawer-keep')) {
            this.showConflict(false);
            void this.save(true);
            return;
        }
        if (target.closest('.ert-timetable__drawer-use')) {
            this.showConflict(false);
            this.draft = null;
            this.savedBody = null;
            void this.syncFromDisk();
            return;
        }
        // Links in the preview keep working; anywhere else in it starts editing.
        if (target.closest('.ert-timetable__drawer-preview') && !target.closest('a')) this.showEditor();
    }

    private handleChange(evt: Event): void {
        const target = evt.target;
        if (target instanceof HTMLSelectElement && target.matches('.ert-timetable__drawer-act')) {
            void this.writeProperty('Act', target.value === '' ? null : Number(target.value));
        } else if (target instanceof HTMLInputElement && target.matches('.ert-timetable__drawer-when')) {
            const value = target.value.trim();
            void this.writeProperty('When', value === '' ? null : value);
        }
    }

    /** True while the author is typing in the drawer, so the table holds off redrawing. */
    isEditing(): boolean {
        return this.textarea !== null && this.textarea.ownerDocument.activeElement === this.textarea;
    }

    /** Put the cursor in the editor as soon as the body has loaded. */
    focusEditor(): void {
        this.wantsFocus = true;
        if (this.savedBody !== null) this.showEditor();
    }

    // ── Properties bar ─────────────────────────────────────────────────

    /** Redraw the Act and When chips and the ring toggles from the note's current frontmatter. */
    renderBar(row: TimetableRow, frontmatter: Record<string, unknown> | undefined, layout: RingLayout | null): void {
        const { settings } = this.plugin;
        this.barEl.empty();

        const actField = this.barEl.createEl('label', { cls: 'ert-timetable__drawer-field' });
        actField.createSpan({ text: t('ui.timetable.drawerAct') });
        const actSelect = actField.createEl('select', { cls: 'dropdown ert-timetable__drawer-act' });
        actSelect.createEl('option', { value: '', text: t('ui.timetable.noAct') });
        const actCount = getConfiguredActCount(settings);
        const labels = parseActLabels(settings, actCount);
        for (let act = 1; act <= actCount; act++) {
            actSelect.createEl('option', { value: String(act), text: resolveActLabel(act - 1, labels) });
        }
        actSelect.value = row.act === null ? '' : String(row.act);

        const whenField = this.barEl.createEl('label', { cls: 'ert-timetable__drawer-field' });
        whenField.createSpan({ text: t('ui.timetable.drawerWhen') });
        const whenInput = whenField.createEl('input', { type: 'text', cls: 'ert-timetable__drawer-when' });
        whenInput.placeholder = 'YYYY-MM-DD HH:MM';
        whenInput.value = this.readProperty(frontmatter, 'When');

        if (layout && layout.order.length > 0) {
            const rings = this.barEl.createDiv({ cls: 'ert-timetable__drawer-rings' });
            const members = new Set(row.subplots);
            for (const name of layout.order) {
                const toggle = rings.createEl('button', { cls: 'ert-timetable__drawer-ring' });
                toggle.dataset.ring = name;
                toggle.setAttr('aria-pressed', String(members.has(name)));
                toggle.toggleClass('is-on', members.has(name));
                toggle.setCssProps({ '--ert-timetable-ring': `var(--rt-subplot-colors-${layout.colorIndex.get(name) ?? 0})` });
                toggle.createSpan({ cls: 'ert-timetable__drawer-ring-swatch' });
                toggle.createSpan({ text: name });
            }
        }

        const actions = this.barEl.createDiv({ cls: 'ert-timetable__drawer-actions' });
        const promote = actions.createEl('button', { cls: 'mod-cta ert-timetable__drawer-promote' });
        setIcon(promote.createSpan({ cls: 'ert-timetable__drawer-icon' }), 'file-up');
        promote.createSpan({ text: t('ui.timetable.promote') });
        const open = actions.createEl('button', { cls: 'ert-timetable__drawer-open' });
        setIcon(open.createSpan({ cls: 'ert-timetable__drawer-icon' }), 'file-text');
        open.createSpan({ text: t('ui.timetable.openNote') });
    }

    private frontmatterKey(frontmatter: Record<string, unknown> | undefined, canonical: string): string | undefined {
        if (!frontmatter) return undefined;
        const mappings = getActiveFrontmatterMappings(this.plugin.settings);
        return Object.keys(frontmatter).find(key => canonicalizeFrontmatterKey(key, mappings) === canonical);
    }

    private readProperty(frontmatter: Record<string, unknown> | undefined, canonical: string): string {
        const key = this.frontmatterKey(frontmatter, canonical);
        const value = key ? frontmatter?.[key] : undefined;
        return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
    }

    /** Write one property under the note's own key for it (or the author's mapped name). Null removes it. */
    private async writeProperty(canonical: string, value: string | number | null): Promise<void> {
        await this.plugin.app.fileManager.processFrontMatter(this.file, (fm: Record<string, unknown>) => {
            const key = this.frontmatterKey(fm, canonical) ?? authorKeyFor(canonical, this.plugin.settings);
            if (value === null) delete fm[key];
            else fm[key] = value;
        });
    }

    /**
     * Add or remove a planned ring. A sketch's Subplot lists exactly the rings
     * the author chose; unlike a scene, an empty list doesn't mean Main Plot.
     */
    private async toggleRing(name: string): Promise<void> {
        await this.plugin.app.fileManager.processFrontMatter(this.file, (fm: Record<string, unknown>) => {
            const key = this.frontmatterKey(fm, 'Subplot') ?? authorKeyFor('Subplot', this.plugin.settings);
            const raw: unknown = fm[key];
            const current = (Array.isArray(raw) ? raw : (raw === undefined || raw === null || raw === '' ? [] : [raw]))
                .map(value => String(value).trim())
                .filter(value => value.length > 0);
            const next = current.includes(name) ? current.filter(value => value !== name) : [...current, name];
            if (next.length === 0) delete fm[key];
            else fm[key] = next;
        });
    }

    // ── Body ────────────────────────────────────────────────────────────

    /**
     * Read the body from disk. A drawer with no unsaved text takes the new
     * text, even while its editor has focus, so later typing never builds on a
     * stale copy. A drawer with unsaved text flags the conflict instead.
     */
    private async syncFromDisk(): Promise<void> {
        const { body } = splitBody(await this.plugin.app.vault.read(this.file));
        if (body === this.savedBody) return;
        if (this.draft !== null) {
            this.showConflict(true);
            return;
        }
        this.savedBody = body;
        if (this.textarea && this.isEditing()) {
            const caret = this.textarea.selectionStart;
            this.textarea.value = this.visibleText();
            this.textarea.setSelectionRange(caret, caret);
            this.growEditor();
            return;
        }
        if (this.wantsFocus) this.showEditor();
        else this.showPreview();
    }

    private visibleText(): string {
        const body = this.draft ?? this.savedBody ?? '';
        return body.slice(leadingBreaks(body).length);
    }

    private showPreview(): void {
        const text = this.visibleText();
        if (text.trim().length === 0) {
            this.showEditor(false);
            return;
        }
        this.textarea = null;
        this.bodyEl.empty();
        const preview = this.bodyEl.createDiv({ cls: 'ert-timetable__drawer-preview markdown-rendered' });
        preview.setAttr('tabindex', '0');
        setAccessibleLabel(preview, t('ui.timetable.drawerEditHint'));
        void MarkdownRenderer.render(this.plugin.app, text, preview, this.file.path, this);
    }

    private showEditor(focus = true): void {
        this.bodyEl.empty();
        const textarea = this.bodyEl.createEl('textarea', { cls: 'ert-timetable__drawer-editor' });
        textarea.placeholder = t('ui.timetable.drawerPlaceholder');
        textarea.value = this.visibleText();
        this.textarea = textarea;
        window.requestAnimationFrame(() => this.growEditor());
        if (focus) {
            this.wantsFocus = false;
            textarea.focus();
        }
    }

    /** The editor grows with its text; CSS caps it at about 60% of the viewport, then it scrolls. */
    private growEditor(): void {
        const textarea = this.textarea;
        if (!textarea) return;
        textarea.setCssProps({ '--ert-timetable-editor-height': 'auto' });
        textarea.setCssProps({ '--ert-timetable-editor-height': `${textarea.scrollHeight + 2}px` });
    }

    private handleInput(): void {
        if (!this.textarea) return;
        const base = this.savedBody ?? '';
        const body = `${leadingBreaks(base) || '\n'}${this.textarea.value}`;
        this.draft = body === base ? null : body;
        this.growEditor();
        this.scheduleSave();
    }

    private handleEditorBlur(): void {
        void this.flush().then(() => {
            if (this.isEditing()) return;
            this.wantsFocus = false;
            if (!this.conflict) this.showPreview();
            this.host.editingEnded();
        });
    }

    private scheduleSave(): void {
        if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
        this.saveTimer = window.setTimeout(() => {
            this.saveTimer = null;
            void this.save();
        }, SAVE_DELAY_MS);
    }

    /** Save now if there is unsaved text. */
    async flush(): Promise<void> {
        if (this.saveTimer !== null) {
            window.clearTimeout(this.saveTimer);
            this.saveTimer = null;
        }
        if (this.draft !== null && !this.conflict) await this.save();
    }

    private async save(overwrite = false): Promise<void> {
        const draft = this.draft;
        if (draft === null) return;
        let conflicted = false;
        const previous = this.savedBody;
        await this.plugin.app.vault.process(this.file, content => {
            const { head, body } = splitBody(content);
            if (!overwrite && body !== this.savedBody) {
                conflicted = true;
                return content;
            }
            // Recorded before the write lands, so the modify event sees our own save.
            this.savedBody = draft;
            return head + draft;
        }).catch((error: unknown) => {
            this.savedBody = previous;
            throw error;
        });
        if (conflicted) {
            this.showConflict(true);
            return;
        }
        if (this.draft === draft) this.draft = null;
    }

    private showConflict(show: boolean): void {
        this.conflict = show;
        this.conflictEl.toggleClass('is-hidden', !show);
        this.conflictEl.empty();
        if (!show) return;
        this.conflictEl.createSpan({ text: t('ui.timetable.drawerConflict') });
        this.conflictEl.createEl('button', { cls: 'ert-timetable__drawer-keep', text: t('ui.timetable.drawerKeepMine') });
        this.conflictEl.createEl('button', { cls: 'ert-timetable__drawer-use', text: t('ui.timetable.drawerUseNote') });
    }
}
