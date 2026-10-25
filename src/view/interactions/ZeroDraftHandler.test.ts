import { describe, expect, it } from 'vitest';
import { appendPendingEdits, pendingEditsText } from './ZeroDraftHandler';

describe('zero draft pending edits', () => {
    it('adds new edits after the existing text instead of replacing it', () => {
        expect(appendPendingEdits('Tighten the opening.', 'Check day two.')).toBe('Tighten the opening.\nCheck day two.');
    });

    it('starts the field when there are no pending edits yet', () => {
        expect(appendPendingEdits(undefined, 'Check day two.')).toBe('Check day two.');
        expect(appendPendingEdits(null, 'Check day two.')).toBe('Check day two.');
        expect(appendPendingEdits('   ', 'Check day two.')).toBe('Check day two.');
    });

    it('keeps an author’s YAML list a list', () => {
        expect(appendPendingEdits(['Tighten the opening.'], 'Check day two.')).toEqual(['Tighten the opening.', 'Check day two.']);
    });

    it('shows every list entry, one per line', () => {
        expect(pendingEditsText(['Tighten the opening.', '', 'Check day two.'])).toBe('Tighten the opening.\nCheck day two.');
        expect(pendingEditsText(undefined)).toBe('');
    });
});
