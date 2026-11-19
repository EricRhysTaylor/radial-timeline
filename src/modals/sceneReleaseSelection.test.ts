import { describe, expect, it } from 'vitest';
import type { SceneReleaseSummary } from '../communityShare/communityShareClient';
import type { SceneReleaseRow } from '../communityShare/sceneReleaseVault';
import {
    batchKeyOf,
    batchKindOf,
    batchSelection,
    keepSelectable,
    releasePlacesLeft,
    selectableKeys,
} from './sceneReleaseSelection';

const release = (id: string): SceneReleaseSummary => ({
    id, scene_id: null, scene_title: id, version: 1, rating: 'general', words: 1, text_hash: 'a'.repeat(64),
    hidden: false, released_at: '', updated_at: '', readers: 0,
});
const scene = (sceneId: string | undefined) => ({ path: `${sceneId}.md`, title: String(sceneId), sceneId }) as SceneReleaseRow['scene'];

const ROWS: SceneReleaseRow[] = [
    { state: 'not_released', title: 'A', scene: scene('scn_a') },
    { state: 'released', title: 'B', scene: scene('scn_b'), release: release('rb') },
    { state: 'unavailable', title: 'C', scene: scene(undefined) },
    { state: 'not_released', title: 'D', scene: scene('scn_d') },
    { state: 'website', title: 'E', release: release('re') },
];
const OPEN = { limit: 5, releases: [release('rb'), release('re')], standing: null };

describe('Release scenes selection', () => {
    it('a release is taken down by its release id; an unreleased scene is released by its scene id; neither for a scene with no id', () => {
        expect(ROWS.map(batchKindOf)).toEqual(['release', 'takeDown', null, 'release', 'takeDown']);
        expect(ROWS.map(batchKeyOf)).toEqual(['scene:scn_a', 'release:rb', null, 'scene:scn_d', 'release:re']);
    });

    it('splits the checked rows by batch, in list order, ignoring a key with no row', () => {
        const checked = new Set(['release:re', 'scene:scn_d', 'scene:scn_a', 'scene:gone']);
        const selection = batchSelection(ROWS, checked, OPEN);
        expect(selection.release.map(row => row.title)).toEqual(['A', 'D']);
        expect(selection.takeDown.map(row => row.title)).toEqual(['E']);
    });

    it('counts the places left, never below zero', () => {
        expect(releasePlacesLeft(OPEN)).toBe(3);
        expect(releasePlacesLeft({ limit: 1, releases: OPEN.releases })).toBe(0);
    });

    it('at the limit or while the account is paused, only take-downs stay selectable', () => {
        const all = new Set(ROWS.flatMap(row => batchKeyOf(row) ?? []));
        for (const status of [{ ...OPEN, limit: 2 }, { ...OPEN, standing: 'account_flagged' as const }]) {
            expect([...keepSelectable(ROWS, all, status)]).toEqual(['release:rb', 'release:re']);
            expect(selectableKeys(ROWS, 'release', status)).toEqual([]);
            expect(selectableKeys(ROWS, 'takeDown', status)).toEqual(['release:rb', 'release:re']);
        }
        expect(selectableKeys(ROWS, 'release', OPEN)).toEqual(['scene:scn_a', 'scene:scn_d']);
    });
});
