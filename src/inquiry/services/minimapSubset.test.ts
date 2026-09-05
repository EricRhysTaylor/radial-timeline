import { describe, expect, it } from 'vitest';
import { buildMinimapSubsetResult } from './minimapSubset';

describe('minimapSubset', () => {
    it('marks all items included when no subset is provided', () => {
        const result = buildMinimapSubsetResult(
            [{ id: 'S1', sceneId: 'scn_a1' }, { id: 'S2', sceneId: 'scn_b2' }],
            new Set(),
            new Set()
        );

        expect(result.included).toEqual([true, true]);
        expect(result.hasSubset).toBe(false);
    });

    it('keeps subset stable across path changes when sceneId remains constant', () => {
        const renamedItems = [
            { id: 'S1', sceneId: 'scn_a1', filePath: 'Book 1/12 Renamed.md' },
            { id: 'S2', sceneId: 'scn_b2', filePath: 'Book 1/13.md' }
        ];

        const result = buildMinimapSubsetResult(
            renamedItems,
            new Set(['scn_a1']),
            new Set()
        );

        expect(result.included).toEqual([true, false]);
        expect(result.hasSubset).toBe(true);
        expect(result.includedCount).toBe(1);
    });

    it('falls back to path matching for legacy entries without sceneId', () => {
        const result = buildMinimapSubsetResult(
            [{ id: 'S1', filePath: 'Book 1/12.md' }, { id: 'S2', filePath: 'Book 1/13.md' }],
            new Set(),
            new Set(['Book 1/13.md'])
        );

        expect(result.included).toEqual([false, true]);
        expect(result.hasSubset).toBe(true);
    });
});
