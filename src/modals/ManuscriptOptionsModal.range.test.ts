import { describe, expect, it } from 'vitest';
import { ManuscriptOptionsModal } from './ManuscriptOptionsModal';

interface RangeHarness {
    source?: { kind: 'book' | 'folder' };
    sceneTitles: string[];
    sceneNumbers: number[];
    getSceneNumberAt(position: number): string | number;
}

describe('manuscript export range labels', () => {
    it('preserves decimal prefixes, including trailing zeroes, for book scenes', () => {
        const modal = Object.assign(Object.create(ManuscriptOptionsModal.prototype) as RangeHarness, {
            source: { kind: 'book' },
            sceneTitles: ['12 First', '12.05 Inserted', '12.5 Another', '13 Last'],
            sceneNumbers: [12, 12, 12, 13],
        });
        expect([1, 2, 3, 4].map(position => modal.getSceneNumberAt(position)))
            .toEqual([12, '12.05', '12.5', 13]);
    });

    it('keeps reviewed folder sources numbered by their selection order', () => {
        const modal = Object.assign(Object.create(ManuscriptOptionsModal.prototype) as RangeHarness, {
            source: { kind: 'folder' }, sceneTitles: ['12.05 Note'], sceneNumbers: [1],
        });
        expect(modal.getSceneNumberAt(1)).toBe(1);
    });
});
