import { describe, expect, it } from 'vitest';
import { buildSceneRefIndex, isStableSceneId, normalizeSceneRef } from './sceneRefNormalizer';

describe('sceneRefNormalizer', () => {
    const index = buildSceneRefIndex([
        {
            sceneId: 'scn_a1b2c3d4',
            path: 'Book 1/38 Jump.md',
            label: 'S38',
            sceneNumber: 38,
            title: 'Jump',
            aliases: ['jump']
        },
        {
            sceneId: 'scn_b2c3d4e5',
            path: 'Book 1/44 Long Road Up.md',
            label: 'S44',
            sceneNumber: 44,
            title: 'Long Road Up',
            aliases: ['long_road_up']
        }
    ]);

    it('recognizes stable scene IDs', () => {
        expect(isStableSceneId('scn_a1b2c3d4')).toBe(true);
        expect(isStableSceneId('Book 1/01.md')).toBe(false);
    });

    it('normalizes legacy path references to sceneId', () => {
        const normalized = normalizeSceneRef({ ref_id: 'Book 1/38 Jump.md' }, index);
        expect(normalized.ref.ref_id).toBe('scn_a1b2c3d4');
        expect(normalized.normalizedFromLegacy).toBe(true);
        expect(normalized.unresolved).toBe(false);
        expect(normalized.warning).toBeTruthy();
    });

    it('preserves existing stable sceneId values', () => {
        const normalized = normalizeSceneRef({ ref_id: 'scn_b2c3d4e5' }, index);
        expect(normalized.ref.ref_id).toBe('scn_b2c3d4e5');
        expect(normalized.normalizedFromLegacy).toBe(false);
        expect(normalized.unresolved).toBe(false);
        expect(normalized.warning).toBeUndefined();
    });

    it('resolves scene-number-slug legacy refs to canonical scene ids', () => {
        const normalized = normalizeSceneRef({ ref_id: 'scn_s38_jump' }, index);
        expect(normalized.ref.ref_id).toBe('scn_a1b2c3d4');
        expect(normalized.unresolved).toBe(false);
    });

    it('resolves scene number refs to canonical scene ids', () => {
        const normalized = normalizeSceneRef({ ref_id: 'S44' }, index);
        expect(normalized.ref.ref_id).toBe('scn_b2c3d4e5');
        expect(normalized.unresolved).toBe(false);
    });

    it('resolves full-scene shorthand refs to canonical scene ids', () => {
        const normalized = normalizeSceneRef({ ref_id: 'F44' }, index);
        expect(normalized.ref.ref_id).toBe('scn_b2c3d4e5');
        expect(normalized.unresolved).toBe(false);
    });

    it('resolves full-scene text refs to canonical scene ids', () => {
        const normalized = normalizeSceneRef({ ref_id: 'Full Scene 38' }, index);
        expect(normalized.ref.ref_id).toBe('scn_a1b2c3d4');
        expect(normalized.unresolved).toBe(false);
    });

    it('does not remap explicit scene numbers to a different scene by title', () => {
        const normalized = normalizeSceneRef({ ref_id: 'S25 · Long Road Up' }, index);
        expect(normalized.ref.ref_id).toBe('');
        expect(normalized.unresolved).toBe(true);
    });

    it('leaves unresolved refs unbound instead of substituting a fallback scene', () => {
        const normalized = normalizeSceneRef({ ref_id: 'Unknown Scene' }, index);
        expect(normalized.ref.ref_id).toBe('');
        expect(normalized.normalizedFromLegacy).toBe(true);
        expect(normalized.unresolved).toBe(true);
        expect(normalized.warning).toContain('unbound');
    });
});
