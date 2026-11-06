import { describe, expect, it } from 'vitest';
import { calloutEdit, hotkeyLabel } from './formattingKeyModel';

function edit(text: string, from: number, to: number, type: string) {
    const lines = text.split('\n');
    return calloutEdit(line => lines[line], lines.length, from, to, type);
}

describe('hotkeyLabel', () => {
    it('writes a hotkey the way each platform does', () => {
        expect(hotkeyLabel({ modifiers: ['Mod'], key: 'B' }, true)).toBe('⌘B');
        expect(hotkeyLabel({ modifiers: ['Mod'], key: 'B' }, false)).toBe('Ctrl+B');
    });

    it('puts modifiers in the usual order and capitalizes the key', () => {
        expect(hotkeyLabel({ modifiers: ['Mod', 'Shift'], key: 'l' }, true)).toBe('⇧⌘L');
        expect(hotkeyLabel({ modifiers: ['Mod', 'Alt'], key: 'Enter' }, false)).toBe('Alt+Ctrl+Enter');
    });
});

describe('calloutEdit', () => {
    it('wraps the selected lines', () => {
        expect(edit('One\nTwo\n\nThree', 0, 1, 'tip')).toEqual({
            fromLine: 0,
            toLine: 1,
            text: '> [!tip]\n> One\n> Two',
            cursor: { line: 2, ch: 5 },
        });
    });

    it('starts an empty callout on an empty line, ready to type', () => {
        expect(edit('One\n\n\nTwo', 1, 1, 'note')).toEqual({
            fromLine: 1,
            toLine: 1,
            text: '> [!note]\n> ',
            cursor: { line: 2, ch: 2 },
        });
    });

    it('keeps blank lines inside the callout', () => {
        expect(edit('One\n\nTwo', 0, 2, 'info').text).toBe('> [!info]\n> One\n>\n> Two');
    });

    it('leaves a blank line before a paragraph that follows', () => {
        expect(edit('One\nTwo', 0, 0, 'tip').text).toBe('> [!tip]\n> One\n');
    });

    it('changes the type of a callout the cursor is already in', () => {
        expect(edit('> [!note] Title\n> One\n> Two', 2, 2, 'warning')).toEqual({
            fromLine: 0,
            toLine: 0,
            text: '> [!warning] Title',
            cursor: null,
        });
    });

    it('wraps a plain quote that has no callout header', () => {
        expect(edit('> Plain quote', 0, 0, 'tip').text).toBe('> [!tip]\n> > Plain quote');
    });
});
