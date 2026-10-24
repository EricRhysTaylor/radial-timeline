import { describe, expect, it } from 'vitest';
import { isUntitledName, safeTitle, splitNumberPrefix } from './noteTitle';

describe('safeTitle', () => {
    it('turns characters a file name can’t hold into single spaces', () => {
        expect(safeTitle('  The Keeper: Part 2/3?  ')).toBe('The Keeper Part 2 3');
        expect(safeTitle('#[]')).toBe('');
    });
});

describe('splitNumberPrefix', () => {
    it('keeps the number and its space apart from the title', () => {
        expect(splitNumberPrefix('12.5 The Lighthouse Stair')).toEqual({ lead: '12.5 ', title: 'The Lighthouse Stair' });
        expect(splitNumberPrefix('Untitled sketch')).toEqual({ lead: '', title: 'Untitled sketch' });
    });
});

describe('isUntitledName', () => {
    it('knows the placeholder names, with or without a counter or number', () => {
        expect(isUntitledName('Untitled sketch', 'Untitled sketch')).toBe(true);
        expect(isUntitledName('Untitled sketch 3', 'Untitled sketch')).toBe(true);
        expect(isUntitledName('12.5 Untitled sketch', 'Untitled sketch')).toBe(true);
        expect(isUntitledName('Untitled', 'Untitled sketch')).toBe(true);
        expect(isUntitledName('Unbenannte Skizze 2', 'Unbenannte Skizze')).toBe(true);
    });

    it('leaves real titles alone', () => {
        expect(isUntitledName('Untitled sketch of the harbor', 'Untitled sketch')).toBe(false);
        expect(isUntitledName('The Lighthouse Stair', 'Untitled sketch')).toBe(false);
    });
});
