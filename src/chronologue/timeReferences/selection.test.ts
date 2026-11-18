import { afterEach, describe, expect, it } from 'vitest';
import { currentReferenceSelection, hoverTimeReference, onReferenceSelection, pinTimeReference, reconcileReferenceSelection, selectsReference } from './selection';

afterEach(() => { hoverTimeReference(null); pinTimeReference(null); });

describe('reference selection lifetime', () => {
    it('previews a hover over a pinned relationship, then restores the pin', () => {
        pinTimeReference({ path: 'scene.md', key: 'first' });
        hoverTimeReference({ path: 'other.md', key: 'second' });
        expect(currentReferenceSelection()).toEqual({ path: 'other.md', key: 'second' });
        hoverTimeReference(null);
        expect(currentReferenceSelection()).toEqual({ path: 'scene.md', key: 'first' });
    });

    it('a new activation replaces both a pin and a stale hover', () => {
        hoverTimeReference({ path: 'old.md', key: 'old' });
        pinTimeReference({ path: 'scene.md', key: 'first' });
        expect(currentReferenceSelection()).toEqual({ path: 'scene.md', key: 'first' });
        pinTimeReference({ path: 'scene.md', key: 'second' });
        expect(currentReferenceSelection()).toEqual({ path: 'scene.md', key: 'second' });
        pinTimeReference(null);
        expect(currentReferenceSelection()).toBeNull();
    });

    it('reveals only on activation so the author can collapse pinned references', () => {
        const reveals: boolean[] = [];
        const unsubscribe = onReferenceSelection(value => reveals.push(value?.reveal === true));
        pinTimeReference({ path: 'scene.md', key: 'first' });
        hoverTimeReference({ path: 'other.md', key: 'second' });
        expect(currentReferenceSelection()).toEqual({ path: 'other.md', key: 'second' });
        hoverTimeReference(null);
        unsubscribe();
        expect(reveals).toEqual([false, true, false, false]);
    });

    it('invalidates changed declarations without clearing another scene', () => {
        pinTimeReference({ path: 'scene.md', key: 'old' });
        hoverTimeReference({ path: 'other.md', key: 'retained' });
        reconcileReferenceSelection('scene.md', new Set(['new']));
        hoverTimeReference(null);
        expect(currentReferenceSelection()).toBeNull();
        pinTimeReference({ path: 'other.md', key: 'retained' });
        reconcileReferenceSelection('scene.md', new Set());
        expect(currentReferenceSelection()?.key).toBe('retained');
    });

    it('a whole-scene selection covers every reference that scene declares, and only those', () => {
        const scene = { path: 'scene.md', key: null };
        expect(selectsReference(scene, 'scene.md', 'first')).toBe(true);
        expect(selectsReference(scene, 'scene.md', 'second')).toBe(true);
        expect(selectsReference(scene, 'other.md', 'first')).toBe(false);
        expect(selectsReference({ path: 'scene.md', key: 'first' }, 'scene.md', 'second')).toBe(false);
        expect(selectsReference(null, 'scene.md', 'first')).toBe(false);
    });

    it('a grouped marker selects all of its references, including other sources', () => {
        const group = { path: 'scene.md', key: 'first', keys: ['first', 'second'] };
        expect(selectsReference(group, 'scene.md', 'first')).toBe(true);
        expect(selectsReference(group, 'other.md', 'second')).toBe(true);
        expect(selectsReference(group, 'other.md', 'third')).toBe(false);
    });

    it('keeps a whole-scene hover while the scene has references, and drops it when none remain', () => {
        hoverTimeReference({ path: 'scene.md', key: null });
        reconcileReferenceSelection('scene.md', new Set(['new']));
        expect(currentReferenceSelection()).toEqual({ path: 'scene.md', key: null });
        reconcileReferenceSelection('scene.md', new Set());
        expect(currentReferenceSelection()).toBeNull();
    });

    it('retains unchanged keys and removes disposed listeners', () => {
        const seen: unknown[] = [];
        const unsubscribe = onReferenceSelection(value => seen.push(value));
        pinTimeReference({ path: 'scene.md', key: 'same' });
        reconcileReferenceSelection('scene.md', new Set(['same']));
        expect(seen).toHaveLength(2);
        unsubscribe();
        reconcileReferenceSelection('scene.md', new Set());
        expect(currentReferenceSelection()).toBeNull();
        expect(seen).toHaveLength(2);
    });
});
