import { describe, expect, it } from 'vitest';
import { formatSceneWhen, whenTextHasClock } from './whenFormat';

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
});
