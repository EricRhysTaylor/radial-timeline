import { describe, expect, it } from 'vitest';
import type { TimelineItem } from '../../types';
import { readTimeReferences } from './model';
import { referenceSceneMatches } from './sceneMatches';

const scene = (path: string, date: string, clock = true): TimelineItem => ({ path, when: new Date(date), whenHasClock: clock });
const reference = (when: string, end?: string) => readTimeReferences([{ Label: 'Memory', When: when, End: end, Kind: 'recollection' }], 'source.md').references[0];
const scenes = [scene('one.md', '2026-06-04T14:30:00'), scene('two.md', '2026-06-04T18:00:00'),
    scene('date-only.md', '2026-06-04T00:00:00', false), scene('next.md', '2026-06-05T14:30:00')];

describe('reference destination scene matches', () => {
    it('shows all scenes on an explicitly referenced day', () => {
        expect(referenceSceneMatches([reference('2026-06-04')], scenes)).toEqual(new Set(['one.md', 'two.md', 'date-only.md']));
    });
    it('requires a matching clock for a reference to a precise time', () => {
        expect(referenceSceneMatches([reference('2026-06-04 14:30')], scenes)).toEqual(new Set(['one.md']));
    });
    it('does not invent destination scenes for years, months, periods or outside dates', () => {
        for (const ref of [reference('2026'), reference('2026-06'), reference('2026-06-04', '2026-06-05'), reference('1952-06-04')]) {
            expect(referenceSceneMatches([ref], scenes).size).toBe(0);
        }
    });
});
