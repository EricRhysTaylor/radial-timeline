/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 *
 * The formatting key
 * ------------------
 * A signature icon at the center of each note's title bar. It opens a key
 * panel listing Obsidian's formatting with each one's hotkey and what to type.
 * Clicking a row runs Obsidian's own command on the note, around the selected
 * text. Nothing stays on the page: it opens when asked and leaves with the
 * pointer, so it never competes with Editorialist's review toolbar. The panel
 * is wide and short, so it hangs from the center without covering the writing.
 */

import { Component, MarkdownView, Platform, setIcon, type Editor } from 'obsidian';
import type RadialTimelinePlugin from '../../main';
import { t } from '../../i18n';
import { setAccessibleLabel, setTooltip } from '../../utils/domTooltip';
import { commandHotkey, executeCommandById, hasCommand } from '../../utils/obsidianInternals';
import { renderLegendSurface, wireLegendTrigger } from './LegendPanel';
import {
    calloutEdit,
    CALLOUT_TYPES,
    HEADING_LEVELS,
    headingCommand,
    HIGHLIGHT_COLORS,
    highlightCommand,
    hotkeyLabel,
    INSERT_FORMATS,
    LINE_FORMATS,
    TEXT_FORMATS,
    type FormatCommand,
} from './formattingKeyModel';

const FORMATS = new Map([...TEXT_FORMATS, ...LINE_FORMATS, ...INSERT_FORMATS].map(format => [format.id, format]));
const PANEL_WIDTH = 780;
const PANEL_MARGIN = 8;

class FormattingKey extends Component {
    private button!: HTMLElement;
    private panel!: HTMLElement;

    constructor(private readonly plugin: RadialTimelinePlugin, readonly view: MarkdownView, private readonly header: HTMLElement) {
        super();
    }

    onload(): void {
        // No hover tooltip: the panel names the key, and a tooltip would sit over it.
        const button = this.header.createEl('button', { cls: 'ert-format-key__trigger clickable-icon', attr: { type: 'button', 'aria-expanded': 'false' } });
        setIcon(button, 'signature');
        setAccessibleLabel(button, t('ui.formatKey.title'));
        const panel = button.doc.body.createDiv({ cls: 'ert-timeline-legend ert-timeline-legend--compact ert-timetable-key ert-format-key' });
        this.button = button;
        this.panel = panel;
        wireLegendTrigger(this, button, panel, () => this.fill());
        // Pressing a button would take the focus, and with it the selection, from the note.
        this.registerDomEvent(button, 'mousedown', event => event.preventDefault());
        this.registerDomEvent(panel, 'mousedown', event => event.preventDefault());
        this.registerDomEvent(panel, 'click', event => this.handleClick(event));
    }

    onunload(): void {
        const label = this.button.getAttribute('aria-labelledby');
        if (label) this.button.doc.getElementById(label)?.remove();
        this.button.remove();
        this.panel.remove();
    }

    isMounted(): boolean {
        return this.view.containerEl.contains(this.button);
    }

    private fill(): void {
        const reading = this.view.getMode() === 'preview';
        const surface = renderLegendSurface(this.panel, {
            title: t('ui.formatKey.title'),
            badge: reading ? t('ui.formatKey.readingBadge') : undefined,
            sections: [],
        });
        if (reading) surface.createDiv({ cls: 'ert-format-key__note', text: t('ui.formatKey.readingNote') });

        const columns = surface.createDiv({ cls: 'ert-format-key__columns' });
        const first = columns.createDiv();
        const second = columns.createDiv();
        const third = columns.createDiv();

        const text = this.section(first, t('ui.formatKey.selectedText'));
        for (const format of TEXT_FORMATS) {
            this.formatRow(text, format);
            if (format.id === 'highlight') this.highlightColors(text);
        }

        const lines = this.section(second, t('ui.formatKey.wholeLine'));
        this.headings(lines);
        for (const format of LINE_FORMATS) this.formatRow(lines, format);

        const insert = this.section(second, t('ui.formatKey.insert'));
        for (const format of INSERT_FORMATS) this.formatRow(insert, format);

        const callouts = this.section(third, t('ui.formatKey.callouts'));
        this.calloutChips(callouts);
        third.createDiv({ cls: 'ert-format-key__note', text: t('ui.formatKey.exportNote') });

        for (const control of Array.from(this.panel.querySelectorAll<HTMLButtonElement>('button'))) control.disabled = reading;
        this.place();
    }

    /** Hang the panel centered under the button, inside the note. */
    private place(): void {
        const button = this.button.getBoundingClientRect();
        const note = this.view.containerEl.getBoundingClientRect();
        const width = Math.min(PANEL_WIDTH, note.width - PANEL_MARGIN * 2);
        const centered = button.left + button.width / 2 - width / 2;
        const left = Math.max(note.left + PANEL_MARGIN, Math.min(centered, note.right - width - PANEL_MARGIN));
        const top = button.bottom + 6;
        this.panel.setCssProps({
            '--ert-key-top': `${top}px`,
            '--ert-key-left': `${left}px`,
            '--ert-key-max-height': `${Math.max(160, this.button.win.innerHeight - top - 12)}px`,
            '--ert-format-key-width': `${width}px`,
        });
    }

    private section(parent: HTMLElement, title: string): HTMLElement {
        const section = parent.createEl('section', { cls: 'ert-timeline-legend__section' });
        section.createDiv({ cls: 'ert-timeline-legend__section-title', text: title });
        return section;
    }

    private formatRow(parent: HTMLElement, format: FormatCommand): void {
        if (!hasCommand(this.plugin.app, format.command)) return;
        const row = parent.createEl('button', { cls: 'ert-format-key__row clickable-icon', attr: { type: 'button', 'data-format': format.id } });
        setIcon(row.createSpan({ cls: 'ert-timeline-legend__icon' }), format.icon);
        row.createSpan({ cls: 'ert-format-key__label', text: t(`ui.formatKey.${format.id}`) });
        const hotkey = commandHotkey(this.plugin.app, format.command);
        row.createSpan({ cls: 'ert-format-key__hotkey', text: hotkey ? hotkeyLabel(hotkey, Platform.isMacOS) : '' });
        row.createSpan({ cls: 'ert-format-key__typed', text: format.typed });
    }

    private choiceRow(parent: HTMLElement, icon: string | null, label: string): HTMLElement {
        const row = parent.createDiv({ cls: 'ert-format-key__choices' });
        const iconEl = row.createSpan({ cls: 'ert-timeline-legend__icon' });
        if (icon) setIcon(iconEl, icon);
        row.createSpan({ cls: 'ert-format-key__label', text: label });
        return row.createDiv({ cls: 'ert-format-key__choice-list' });
    }

    private headings(parent: HTMLElement): void {
        const levels = HEADING_LEVELS.filter(level => hasCommand(this.plugin.app, headingCommand(level)));
        if (!levels.length) return;
        const heading = t('ui.formatKey.heading');
        const list = this.choiceRow(parent, 'heading', '');
        for (const level of levels) {
            const choice = list.createEl('button', { cls: 'ert-format-key__level clickable-icon', text: `H${level}`, attr: { type: 'button', 'data-command': headingCommand(level) } });
            setAccessibleLabel(choice, `${heading} ${level}`);
        }
    }

    private highlightColors(parent: HTMLElement): void {
        const colors = HIGHLIGHT_COLORS.filter(color => hasCommand(this.plugin.app, highlightCommand(color)));
        if (!colors.length) return;
        const list = this.choiceRow(parent, null, t('ui.formatKey.highlightColors'));
        for (const color of colors) {
            const choice = list.createEl('button', { cls: 'ert-format-key__dot clickable-icon', attr: { type: 'button', 'data-command': highlightCommand(color) } });
            choice.setCssProps({ '--ert-format-dot': `var(--color-${color})` });
            const name = t(`ui.formatKey.color.${color}`);
            setTooltip(choice, name);
            setAccessibleLabel(choice, name);
        }
    }

    /** Each chip is a real callout, so it wears the theme's colors and icon as it would in the note. */
    private calloutChips(parent: HTMLElement): void {
        const list = parent.createDiv({ cls: 'ert-format-key__callouts' });
        for (const type of CALLOUT_TYPES) {
            const chip = list.createEl('button', { cls: 'ert-format-key__callout clickable-icon', attr: { type: 'button', 'data-callout-type': type } });
            const callout = chip.createSpan({ cls: 'callout', attr: { 'data-callout': type } });
            const title = callout.createSpan({ cls: 'callout-title' });
            const icon = title.createSpan({ cls: 'callout-icon' });
            title.createSpan({ cls: 'callout-title-inner', text: t(`ui.formatKey.callout.${type}`) });
            setIcon(icon, getComputedStyle(callout).getPropertyValue('--callout-icon').trim());
        }
    }

    private handleClick(event: Event): void {
        const target = event.target instanceof Element ? event.target.closest<HTMLElement>('button') : null;
        if (!target) return;
        const { workspace } = this.plugin.app;
        // Commands act on the active note, which may not be the one whose key this is. A note
        // that's already active keeps its focus, which may be in a footnote's own small editor.
        if (workspace.getActiveViewOfType(MarkdownView) !== this.view) workspace.setActiveLeaf(this.view.leaf, { focus: true });
        const editor = workspace.activeEditor?.editor;
        if (!editor) return;
        editor.focus();
        const { format, command, calloutType } = target.dataset;
        if (calloutType) this.insertCallout(editor, calloutType);
        else if (command) executeCommandById(this.plugin.app, command);
        else if (format) this.runFormat(editor, format);
    }

    private runFormat(editor: Editor, id: string): void {
        const format = FORMATS.get(id);
        if (!format) return;
        const end = editor.getCursor('to');
        if (format.place === 'after-selection') editor.setCursor(end);
        if (format.place === 'line-end') editor.setCursor({ line: end.line, ch: editor.getLine(end.line).length });
        executeCommandById(this.plugin.app, format.command);
    }

    private insertCallout(editor: Editor, type: string): void {
        const edit = calloutEdit(line => editor.getLine(line), editor.lineCount(), editor.getCursor('from').line, editor.getCursor('to').line, type);
        editor.replaceRange(edit.text, { line: edit.fromLine, ch: 0 }, { line: edit.toLine, ch: editor.getLine(edit.toLine).length });
        if (edit.cursor) editor.setCursor(edit.cursor);
    }
}

/** Give every open note its key, including inactive and split ones. */
export function registerFormattingKey(plugin: RadialTimelinePlugin): void {
    const keys = new Map<MarkdownView, FormattingKey>();
    let running = true;
    const refresh = (): void => {
        if (!running) return;
        const open = new Set<MarkdownView>();
        plugin.app.workspace.iterateAllLeaves(leaf => {
            const view = leaf.view;
            if (!(view instanceof MarkdownView)) return;
            const header = view.containerEl.querySelector<HTMLElement>('.view-header');
            if (!header) return;
            open.add(view);
            const existing = keys.get(view);
            if (existing?.isMounted()) return;
            if (existing) plugin.removeChild(existing);
            keys.set(view, plugin.addChild(new FormattingKey(plugin, view, header)));
        });
        for (const [view, key] of keys) {
            if (open.has(view)) continue;
            plugin.removeChild(key);
            keys.delete(view);
        }
    };
    const workspace = plugin.app.workspace;
    plugin.registerEvent(workspace.on('layout-change', refresh));
    plugin.registerEvent(workspace.on('active-leaf-change', refresh));
    plugin.registerEvent(workspace.on('file-open', refresh));
    workspace.onLayoutReady(refresh);
    plugin.register(() => {
        running = false;
    });
}
