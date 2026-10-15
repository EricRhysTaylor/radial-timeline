import { describe, expect, it } from 'vitest';
import { locateReferencePassage, parseReferenceDate, readTimeReferences, referenceDateLabel } from './model';

describe('author time reference contract', () => {
    it('preserves year precision separately from a declared period', () => {
        const result = readTimeReferences([{ Label: 'Memory', When: '1952', Kind: 'recollection' },
            { Label: 'Letters', When: '1986', End: '1989', Kind: 'mention' }], '12.md');
        expect(result.problems).toEqual([]);
        expect(result.references[0].when.precision).toBe('year');
        expect(result.references[0].end).toBeUndefined();
        expect(referenceDateLabel(result.references[0])).toBe('1952');
        expect(referenceDateLabel(result.references[1])).toBe('1986 – 1989');
    });
    it('rejects impossible calendar values and preserves early years', () => {
        for (const value of ['2025-02-29', '2026-02-31', '2026-13', '2026-00', '2026-01-00', '2026-01-01T25:00', 'before the war']) {
            expect(parseReferenceDate(value), value).toBeNull();
        }
        expect(parseReferenceDate('2024-02-29')?.precision).toBe('day');
        expect(new Date(parseReferenceDate('0052')!.start).getFullYear()).toBe(52);
    });
    it('retains diagnostics for invalid entries without hiding valid siblings', () => {
        const result = readTimeReferences([{ Label: 'Wrong', When: '2000', End: '1999', Kind: 'mention' },
            { Label: 'Valid', When: '2040', Kind: 'possibility' }, 'bad'], 'scene.md');
        expect(result.problems.map(p => p.reason)).toEqual(['range', 'entry']);
        expect(result.references.map(r => r.label)).toEqual(['Valid']);
        expect(readTimeReferences({}, 'scene.md').problems[0].reason).toBe('array');
    });
    it('separates equal labels and invalidates stale entry locators', () => {
        const entry = { Label: 'Memory', When: '1952', Kind: 'recollection' };
        const before = readTimeReferences([entry, entry], 'scene.md').references;
        expect(before[0].key).not.toBe(before[1].key);
        const after = readTimeReferences([{ ...entry, When: '1953' }], 'scene.md').references;
        expect(before[0].key).not.toBe(after[0].key);
    });
    it('keeps identity independent of unrecognized author properties', () => {
        const entry: Record<string, unknown> = { Label: 'Memory', When: '1952', Kind: 'mention' };
        entry.Custom = entry;
        expect(readTimeReferences([entry], 'scene.md').references).toHaveLength(1);
    });
    it('only attaches unique exact prose', () => {
        expect(locateReferencePassage('Before. The fire. After.', 'The fire.')).toEqual({ from: 8, to: 17 });
        expect(locateReferencePassage('The fire. The fire.', 'The fire.')).toBeNull();
        expect(locateReferencePassage('A different passage.', 'The fire.')).toBeNull();
    });
});
