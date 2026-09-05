import { describe, expect, it } from 'vitest';
import { isLowSubstanceTier, resolveCorpusSceneStatus } from './corpusCellStatus';

describe('resolveCorpusSceneStatus', () => {
    const today = new Date(2026, 2, 9); // March 9, 2026 (local time)

    it('returns todo for todo status with future due date', () => {
        expect(resolveCorpusSceneStatus({
            status: 'Todo',
            due: '2026-03-10',
            today
        })).toBe('todo');
    });

    it('returns overdue for working status with past due date', () => {
        expect(resolveCorpusSceneStatus({
            status: 'Working',
            due: '2026-03-08',
            today
        })).toBe('overdue');
    });

    it('returns complete for complete-like status even with past due date', () => {
        expect(resolveCorpusSceneStatus({
            status: 'completed',
            due: '2026-03-01',
            today
        })).toBe('complete');

        expect(resolveCorpusSceneStatus({
            status: 'done',
            due: '2026-03-01',
            today
        })).toBe('complete');
    });

    it('returns overdue when status is missing and due date is overdue', () => {
        expect(resolveCorpusSceneStatus({
            status: undefined,
            due: '2026-03-07',
            today
        })).toBe('overdue');
    });

    it('returns todo when status is missing and due date is missing', () => {
        expect(resolveCorpusSceneStatus({
            status: undefined,
            due: undefined,
            today
        })).toBe('todo');
    });
});

describe('isLowSubstanceTier', () => {
    it('returns true for empty and sketchy', () => {
        expect(isLowSubstanceTier('empty')).toBe(true);
        expect(isLowSubstanceTier('sketchy')).toBe(true);
    });

    it('returns false for medium and substantive', () => {
        expect(isLowSubstanceTier('medium')).toBe(false);
        expect(isLowSubstanceTier('substantive')).toBe(false);
    });
});
