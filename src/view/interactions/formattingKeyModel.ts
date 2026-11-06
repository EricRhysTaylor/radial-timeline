/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 *
 * What the formatting key lists: Obsidian's own formatting, how a person
 * reaches each one, and the two small jobs Obsidian's commands leave to us
 * (naming a hotkey, and writing a callout of a chosen type).
 */

/** Where the cursor goes first. Unset runs the command on the selection as it stands. */
export type FormatPlacement = 'after-selection' | 'line-end';

export interface FormatCommand {
    /** Also its label's key under `ui.formatKey`. */
    id: string;
    command: string;
    icon: string;
    /** What a person types for the same result. */
    typed: string;
    place?: FormatPlacement;
}

export const TEXT_FORMATS: FormatCommand[] = [
    { id: 'bold', command: 'editor:toggle-bold', icon: 'bold', typed: '**text**' },
    { id: 'italic', command: 'editor:toggle-italics', icon: 'italic', typed: '*text*' },
    { id: 'strikethrough', command: 'editor:toggle-strikethrough', icon: 'strikethrough', typed: '~~text~~' },
    { id: 'highlight', command: 'editor:toggle-highlight', icon: 'highlighter', typed: '==text==' },
    { id: 'comment', command: 'editor:toggle-comments', icon: 'percent', typed: '%%text%%' },
    { id: 'link', command: 'editor:insert-link', icon: 'link', typed: '[text](url)' },
    { id: 'noteLink', command: 'editor:insert-wikilink', icon: 'file-symlink', typed: '[[note]]' },
    { id: 'clear', command: 'editor:clear-formatting', icon: 'eraser', typed: '' },
];

export const LINE_FORMATS: FormatCommand[] = [
    { id: 'bullets', command: 'editor:toggle-bullet-list', icon: 'list', typed: '- ' },
    { id: 'numbers', command: 'editor:toggle-numbered-list', icon: 'list-ordered', typed: '1. ' },
    { id: 'checkbox', command: 'editor:toggle-checklist-status', icon: 'square-check', typed: '- [ ] ' },
    { id: 'quote', command: 'editor:toggle-blockquote', icon: 'quote', typed: '> ' },
];

// A footnote belongs after the words it notes, and Obsidian's divider would replace the selection.
export const INSERT_FORMATS: FormatCommand[] = [
    { id: 'footnote', command: 'editor:insert-footnote', icon: 'superscript', typed: '[^1]', place: 'after-selection' },
    { id: 'table', command: 'editor:insert-table', icon: 'table', typed: '' },
    { id: 'divider', command: 'editor:insert-horizontal-rule', icon: 'minus', typed: '---', place: 'line-end' },
];

export const HEADING_LEVELS = [1, 2, 3, 4, 5, 6] as const;

export const headingCommand = (level: number): string => `editor:set-heading-${level}`;

export const HIGHLIGHT_COLORS = ['red', 'orange', 'yellow', 'green', 'blue', 'purple'] as const;

export const highlightCommand = (color: string): string => `editor:toggle-highlight-${color}`;

/** Obsidian's callouts, grouped by color. */
export const CALLOUT_TYPES = [
    'note', 'info', 'todo', 'abstract', 'tip', 'success', 'question', 'warning', 'failure', 'danger', 'bug', 'example', 'quote',
] as const;

export interface CommandHotkey {
    modifiers: string[];
    key: string;
}

const MODIFIER_ORDER = ['Ctrl', 'Alt', 'Shift', 'Meta', 'Mod'];
const MAC_MODIFIERS: Record<string, string> = { Ctrl: '⌃', Alt: '⌥', Shift: '⇧', Meta: '⌘', Mod: '⌘' };
const OTHER_MODIFIERS: Record<string, string> = { Ctrl: 'Ctrl', Alt: 'Alt', Shift: 'Shift', Meta: 'Win', Mod: 'Ctrl' };

/** A hotkey as this platform writes it: ⌘B on a Mac, Ctrl+B elsewhere. */
export function hotkeyLabel(hotkey: CommandHotkey, mac: boolean): string {
    const names = mac ? MAC_MODIFIERS : OTHER_MODIFIERS;
    const modifiers = [...hotkey.modifiers]
        .sort((a, b) => MODIFIER_ORDER.indexOf(a) - MODIFIER_ORDER.indexOf(b))
        .map(modifier => names[modifier] ?? modifier); // SAFE: a modifier Obsidian adds later reads as its own name
    const key = hotkey.key.length === 1 ? hotkey.key.toUpperCase() : hotkey.key;
    return mac ? [...modifiers, key].join('') : [...modifiers, key].join('+');
}

export interface CalloutEdit {
    fromLine: number;
    toLine: number;
    text: string;
    /** Where the cursor lands; null leaves it where it was. */
    cursor: { line: number; ch: number } | null;
}

const QUOTED_LINE = /^\s*>/;
const CALLOUT_HEADER = /^(\s*>\s*\[!)[^\]]+(\].*)$/;

/**
 * The edit that gives these lines a callout. A cursor already inside a callout
 * changes that callout's type, so trying colors never nests one in another.
 */
export function calloutEdit(lineAt: (line: number) => string, lineCount: number, fromLine: number, toLine: number, type: string): CalloutEdit {
    for (let line = fromLine; line >= 0 && QUOTED_LINE.test(lineAt(line)); line--) {
        const header = lineAt(line).match(CALLOUT_HEADER);
        if (header) return { fromLine: line, toLine: line, text: `${header[1]}${type}${header[2]}`, cursor: null };
    }

    const body: string[] = [];
    for (let line = fromLine; line <= toLine; line++) body.push(lineAt(line).trim() ? `> ${lineAt(line)}` : '>');
    if (body.length === 1 && body[0] === '>') body[0] = '> ';
    const lines = [`> [!${type}]`, ...body];
    // A paragraph straight after a quote would read as part of it.
    const followed = toLine + 1 < lineCount && lineAt(toLine + 1).trim() !== '';
    const lastLine = fromLine + lines.length - 1;
    return {
        fromLine,
        toLine,
        text: lines.join('\n') + (followed ? '\n' : ''),
        cursor: { line: lastLine, ch: lines[lines.length - 1].length },
    };
}
