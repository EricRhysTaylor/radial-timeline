import { describe, expect, it } from 'vitest';
import { formatDateRange, parseDateRange } from './dateRange';
describe('Author Progress date ranges', () => {
    it.each(['2026-02-30 to 2026-03-10', '2025-02-29 to 2025-03-10', '2026-13-01 to 2027-01-01', '2026-01-01'])('rejects invalid calendar range %s', value => {
        expect(parseDateRange(value).error).toBeTruthy();
    });
    it('accepts leap days, equal dates, and the Unix epoch date', () => {
        for (const value of ['2024-02-29', '1970-01-01']) expect(parseDateRange(`${value} to ${value}`)).toEqual({ start: value, target: value });
    });
    it('rejects reversed dates and round-trips a valid range', () => {
        expect(parseDateRange('2026-03-02 to 2026-03-01').error).toContain('before');
        expect(parseDateRange(formatDateRange('2026-01-01', '2026-12-31'))).toEqual({ start: '2026-01-01', target: '2026-12-31' });
        expect(formatDateRange(undefined, '2026-12-31')).toBe('');
    });
});
