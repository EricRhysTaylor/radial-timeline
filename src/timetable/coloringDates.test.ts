import { describe, expect, it } from 'vitest';
import { compareDateCategories, dateColoringRows, readDateGrouping } from './coloringDates';
import { planConfiguredColoring } from './timetableModel';

const today = new Date(2026, 9, 26, 14);
const rows = (values: unknown[]) => values.map((value, i) => ({ path: String(i), value }));

describe('date coloring', () => {
    it('groups date-only strings, timestamps and Date values by calendar month', () => {
        expect(dateColoringRows(rows(['2085-04-01', '2085-04-30 23:59', new Date(2085, 4, 1)]), { kind: 'month' }, today).map(row => row.value))
            .toEqual(['month:2085-04', 'month:2085-04', 'month:2085-05']);
    });

    it('distinguishes missing and invalid dates instead of inventing a date', () => {
        expect(dateColoringRows(rows(['', null, 'not a date', '2085-02-30', '2026-13-10', '2026/2/30', '2026-2-30']), { kind: 'year' }, today).map(row => row.value))
            .toEqual(['date:unset', 'date:unset', 'date:invalid', 'date:invalid', 'date:invalid', 'date:invalid', 'date:invalid']);
    });

    it('includes both boundary days, including their timestamps, in a custom range', () => {
        expect(dateColoringRows(rows(['2085-03-31', '2085-04-01 00:00', '2085-04-30 23:59', '2085-05-01']), { kind: 'range', start: '2085-04-01', end: '2085-04-30' }, today).map(row => row.value))
            .toEqual(['range:before', 'range:inside', 'range:inside', 'range:after']);
    });

    it('uses calendar days for Due groups across the autumn DST boundary', () => {
        expect(dateColoringRows(rows(['2026-10-25', '2026-10-26', '2026-10-27', '2026-11-02', '2026-11-03']), { kind: 'due' }, today).map(row => row.value))
            .toEqual(['due:overdue', 'due:today', 'due:week', 'due:week', 'due:later']);
    });

    it('keeps completion dates out of Overdue while retaining missing/invalid date groups', () => {
        const completed = rows(['2020-01-01', '2026-10-26', '', 'not a date']).map(row => ({ ...row, complete: true }));
        expect(dateColoringRows(completed, { kind: 'due' }, today).map(row => row.value))
            .toEqual(['due:completed', 'due:completed', 'date:unset', 'date:invalid']);
        expect(dateColoringRows(completed, { kind: 'year' }, today)[0].value).toBe('year:2020');
    });

    it('validates saved ranges and accepts same-day intervals', () => {
        expect(readDateGrouping({ kind: 'range', start: '2024-02-29', end: '2024-02-29' })).not.toBeNull();
        expect(readDateGrouping({ kind: 'range', start: '2023-02-29', end: '2023-03-01' })).toBeNull();
        expect(readDateGrouping({ kind: 'range', start: '2026-11-01', end: '2026-10-01' })).toBeNull();
        expect(readDateGrouping({ kind: 'unknown' })).toBeNull();
    });

    it('orders calendar categories chronologically with missing and invalid dates last', () => {
        expect(['date:invalid', 'month:2085-11', 'date:unset', 'month:2085-02'].sort(compareDateCategories))
            .toEqual(['month:2085-02', 'month:2085-11', 'date:unset', 'date:invalid']);
        const plan = planConfiguredColoring(rows(['2085-11-01', '2085-02-01', '2085-11-02']), { grouping: { kind: 'month' } }, [4, 8], today);
        expect(plan.kind === 'ok' && plan.legend.map(item => [item.value, item.count, item.colorIndex])).toEqual([['month:2085-02', 1, 8], ['month:2085-11', 2, 4]]);
    });
});
