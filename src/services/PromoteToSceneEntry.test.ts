import { describe, expect, it } from 'vitest';
import { anchorsInSketchAct, promotionAnchors, sketchesByAct } from './PromoteToSceneEntry';
import type { TimelineItem } from '../types';
import type { PlacementItem } from '../timetable/sketchPlacement';

const sketch = (name: string, act: number | null, order: number): PlacementItem => ({
    row: { path: `${name}.md`, basename: name, kind: 'sketch', act, prefix: null, className: 'Sketch', subplots: [], removedScene: false },
    placement: { order },
} as unknown as PlacementItem); // SAFE: test fixture with only the fields orderSketches reads

const scene = (title: string, subplot: string): TimelineItem =>
    ({ itemType: 'Scene', title, path: `Book/${title}.md`, subplot } as unknown as TimelineItem); // SAFE: test fixture with only the fields promotionAnchors reads

describe('sketchesByAct', () => {
    it('keeps the order the author set, not the alphabetical order of the names', () => {
        const items = [sketch('Vale names the killer', null, 30), sketch('Lord Ashby dies', null, 10), sketch('The butler swears', null, 20)];
        const paths = new Set(items.map(item => item.row.path));
        expect([...sketchesByAct(items, paths)]).toEqual([[1, ['Lord Ashby dies.md', 'The butler swears.md', 'Vale names the killer.md']]]);
    });
    it('groups by act, leaves out sketches that were not chosen, and puts no act in Act 1', () => {
        const items = [sketch('Later', 2, 10), sketch('Skipped', 1, 10), sketch('First', 1, 20), sketch('Floating', null, 10)];
        const paths = new Set(['Later.md', 'First.md', 'Floating.md']);
        expect(Object.fromEntries(sketchesByAct(items, paths))).toEqual({ 1: ['First.md', 'Floating.md'], 2: ['Later.md'] });
    });
});

describe('promotionAnchors', () => {
    it('only offers scene anchors in the sketch act, excluding missing or unassigned scenes', () => {
        const anchors = ['first', 'second', 'unknown'].map(path => ({ path, label: path }));
        const acts: Record<string, number | null> = { first: 1, second: 2, unknown: null };
        expect(anchorsInSketchAct(anchors, 2, anchor => acts[anchor.path])).toEqual([anchors[1]]);
    });
    it('offers each scene once, in reading order, however many rings it is in', () => {
        // getSceneData groups by ring, so scenes repeat and arrive out of order.
        const data = [
            scene('3 First Ball', 'Main Plot'), scene('2 Mr Bennet Visits', 'Main Plot'),
            scene('61 Happy Marriages', 'Main Plot'), scene('10 Evening Conversations', 'Class and Manners'),
            scene('61 Happy Marriages', 'Class and Manners'), scene('5.5 Charlotte Warns Elizabeth', 'Main Plot'),
            scene('61 Happy Marriages', 'Jane-Bingley Romance'), scene('5 Lucas Visit', 'Main Plot'),
            { itemType: 'Beat', title: '5.01 Theme Stated', path: 'Book/5.01 Theme Stated.md' } as unknown as TimelineItem, // SAFE: beat fixture
        ];
        expect(promotionAnchors(data).map(anchor => anchor.label)).toEqual([
            '2 Mr Bennet Visits', '3 First Ball', '5 Lucas Visit', '5.5 Charlotte Warns Elizabeth',
            '10 Evening Conversations', '61 Happy Marriages',
        ]);
    });
});
