import { describe, expect, it } from 'vitest';
import { buildBeatActColumns } from './actGrid';
describe('Beat workspace act grids', () => {
    it('preserves within-act order, clamps acts, and strips display prefixes', () => {
        const rows = [{ name: 'Finale', act: 9 }, { name: 'Act 1: Opening', act: 1 }, { name: 'Second', act: 1 }];
        const original = JSON.stringify(rows); const result = buildBeatActColumns(rows, 3);
        expect(result.totalBeats).toBe(3); expect(result.columns.map(column => column.label)).toEqual(['Act 1', 'Act 3']);
        expect(result.columns[0].beats.map(beat => beat.name)).toEqual(['Opening', 'Second']);
        expect(JSON.stringify(rows)).toBe(original);
    });
    it('uses the same legacy-row parsing and ignores blank rows for any loaded workspace', () => {
        const result = buildBeatActColumns(['Opening[1]', 'Midpoint[2]', ''], 3);
        expect(result.totalBeats).toBe(2); expect(result.columns.map(column => column.rank)).toEqual([1, 2]);
        expect(buildBeatActColumns([], 3)).toEqual({ totalBeats: 0, columns: [] });
    });
});
