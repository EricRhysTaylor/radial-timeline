import { describe, expect, it } from 'vitest';
import { formatCompactDuration, formatDueLabel, formatLongDate, formatSceneWhen, formatTableWhen, whenTextHasClock } from './whenFormat';

describe('whenTextHasClock', () => {
    it('reads a clock time only when the author wrote one', () => {
        expect(whenTextHasClock('2085-05-10')).toBe(false);
        expect(whenTextHasClock('2085-01-03 14:20')).toBe(true);
        expect(whenTextHasClock('2085-01-03T14:20')).toBe(true);
        expect(whenTextHasClock('2085-01-03 2pm')).toBe(true);
    });
});

describe('formatSceneWhen', () => {
    it('adds the weekday and keeps the @ before the time', () => {
        expect(formatSceneWhen(new Date(2085, 0, 3, 14, 20), true, 'en')).toBe('Wed Jan 3, 2085 @ 2:20PM');
    });

    it('never prints @ Noon for a date-only When', () => {
        expect(formatSceneWhen(new Date(2085, 4, 10, 12, 0), false, 'en')).toBe('Thu May 10, 2085');
    });

    it('names noon and midnight only when the YAML says so', () => {
        expect(formatSceneWhen(new Date(2085, 4, 10, 12, 0), true, 'en-gb')).toBe('Thu May 10, 2085 @ Noon');
        expect(formatSceneWhen(new Date(2085, 4, 10, 0, 0), true, 'en')).toBe('Thu May 10, 2085 @ Midnight');
    });

    it('follows the language for month and weekday names', () => {
        expect(formatSceneWhen(new Date(2085, 4, 10, 12, 0), false, 'de')).toBe('Do., 10. Mai 2085');
        expect(formatSceneWhen(new Date(2085, 0, 3, 14, 20), true, 'ja')).toContain('@ 14:20');
    });

    it('rejects an invalid date', () => {
        expect(() => formatSceneWhen(new Date('nonsense'), true, 'en')).toThrow();
    });

    it('keeps the Gregorian manuscript year in Thai', () => {
        const label = formatSceneWhen(new Date(2085, 4, 10), false, 'th');
        expect(label).toContain('2085');
        expect(label).not.toContain('2628');
    });
});

describe('formatTableWhen', () => {
    it('drops the year a shared header shows, and puts the clock after a dot', () => {
        expect(formatTableWhen(new Date(2085, 3, 6, 19, 0), true, false, 'en')).toBe('Fri Apr 6 · 7PM');
        expect(formatTableWhen(new Date(2085, 3, 9, 12, 0), false, false, 'en')).toBe('Mon Apr 9');
        expect(formatTableWhen(new Date(2085, 3, 6, 19, 0), true, true, 'en')).toBe('Fri Apr 6, 2085 · 7PM');
    });

    it('follows the language and keeps the Gregorian year in Thai', () => {
        expect(formatTableWhen(new Date(2085, 4, 10, 12, 0), false, true, 'th')).toContain('2085');
        expect(formatTableWhen(new Date(2085, 0, 3, 14, 20), true, false, 'ja')).toContain('14:20');
    });
});

describe('formatCompactDuration', () => {
    it('shortens the Duration the author wrote', () => {
        expect(formatCompactDuration('2 hours', 'en')).toBe('2h');
        expect(formatCompactDuration('45 minutes', 'en')).toBe('45m');
        expect(formatCompactDuration('1.5 hours', 'en')).toBe('1.5h');
        expect(formatCompactDuration('3 days', 'en')).toBe('3d');
    });

    it('never shortens months to an m that reads as minutes', () => {
        expect(formatCompactDuration('2 months', 'en')).not.toBe('2m');
    });

    it('returns null for text it can’t read', () => {
        expect(formatCompactDuration('a while', 'en')).toBeNull();
    });
});

describe('formatDueLabel', () => {
    const today = new Date(2026, 9, 24);
    const date = new Date(2026, 9, 20);

    it('reads relative time near today', () => {
        expect(formatDueLabel({ kind: 'late', date, days: -4 }, today, 'en')).toBe('4 days ago');
        expect(formatDueLabel({ kind: 'soon', date, days: 1 }, today, 'en')).toBe('tomorrow');
        expect(formatDueLabel({ kind: 'soon', date, days: 0 }, today, 'en')).toBe('today');
    });

    it('shows the date further off and for a complete scene, with the year only when it differs', () => {
        expect(formatDueLabel({ kind: 'later', date: new Date(2026, 11, 14), days: 51 }, today, 'en')).toBe('Dec 14');
        expect(formatDueLabel({ kind: 'done', date }, today, 'en')).toBe('Oct 20');
        expect(formatDueLabel({ kind: 'later', date: new Date(2027, 1, 2), days: 101 }, today, 'en')).toBe('Feb 2, 2027');
    });
});

describe('formatLongDate', () => {
    it('spells the whole date for hover', () => {
        expect(formatLongDate(new Date(2026, 9, 20), 'en')).toBe('Tue, Oct 20, 2026');
    });
});
