import { describe, expect, it } from 'vitest';
import type RadialTimelinePlugin from '../main';
import type { TimelineItem } from '../types';
import { getSortedSceneFiles } from '../utils/manuscript';
import { createInMemoryApp } from '../../tests/helpers/inMemoryObsidian';

/**
 * Gossamer scores beats placed at narrative positions, so its manuscript is
 * always in narrative order. It used to follow the timeline view: in
 * Chronologue (or with When ordering on) the manuscript went out in story-time
 * order, the request bytes changed between signals, and written AI jobs looked
 * stale.
 */
describe('Gossamer manuscript order', () => {
    // Narrative order Alpha → Beta → Gamma; story time runs the other way.
    const scenes: TimelineItem[] = [
        { title: '3 Gamma', path: 'Book/3 Gamma.md', itemType: 'Scene', when: new Date('2020-01-01') },
        { title: '1 Alpha', path: 'Book/1 Alpha.md', itemType: 'Scene', when: new Date('2020-03-01') },
        { title: '2 Beta', path: 'Book/2 Beta.md', itemType: 'Scene', when: new Date('2020-02-01') }
    ] as TimelineItem[];

    const pluginIn = (settings: Record<string, unknown>): RadialTimelinePlugin => ({
        app: createInMemoryApp(Object.fromEntries(scenes.map(scene => [scene.path!, 'Body']))),
        settings,
        getSceneData: async () => scenes
    }) as never;

    const order = async (settings: Record<string, unknown>) =>
        (await getSortedSceneFiles(pluginIn(settings))).files.map(file => file.basename);

    it('is narrative order in every view and regardless of When ordering', async () => {
        const narrative = ['1 Alpha', '2 Beta', '3 Gamma'];
        expect(await order({ currentMode: 'narrative' })).toEqual(narrative);
        expect(await order({ currentMode: 'gossamer' })).toEqual(narrative);
        expect(await order({ currentMode: 'chronologue' })).toEqual(narrative);
        expect(await order({ currentMode: 'gossamer', sortByWhenDate: true })).toEqual(narrative);
    });
});
