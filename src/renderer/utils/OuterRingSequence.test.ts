import { describe, expect, it } from 'vitest';
import type { TimelineItem } from '../../types';
import { buildOuterRingSequence } from './OuterRingSequence';

const ACT_START = -Math.PI / 2;
const ACT_END = (2 * Math.PI) / 3 - Math.PI / 2;

function scene(partial: Partial<TimelineItem> & { title: string }): TimelineItem {
    return {
        date: '',
        actNumber: 1,
        subplot: 'Main Plot',
        ...partial
    } as TimelineItem;
}

function build(scenes: TimelineItem[], overrides: Partial<Parameters<typeof buildOuterRingSequence>[0]> = {}) {
    return buildOuterRingSequence({
        scenes,
        segment: 0,
        isSagaScope: false,
        sortByWhen: false,
        forceChronological: false,
        includeBeats: true,
        masterSubplotOrder: ['Main Plot', 'Betrayal'],
        innerR: 700,
        outerR: 760,
        startAngle: ACT_START,
        endAngle: ACT_END,
        ...overrides
    });
}

describe('buildOuterRingSequence', () => {
    it('collapses a scene tagged with several subplots into one item', () => {
        const sequence = build([
            scene({ title: '1 Arrival', path: 'Book/1 Arrival.md', subplot: 'Main Plot' }),
            scene({ title: '1 Arrival', path: 'Book/1 Arrival.md', subplot: 'Betrayal' }),
            scene({ title: '2 Departure', path: 'Book/2 Departure.md', subplot: 'Betrayal' })
        ]);

        expect(sequence.items.map(item => item.path)).toEqual([
            'Book/1 Arrival.md',
            'Book/2 Departure.md'
        ]);
        // Dominance falls to the earliest subplot in master order.
        expect(sequence.items[0].subplot).toBe('Main Plot');
    });

    it('keeps only the requested act, and only the requested book under saga scope', () => {
        const scenes = [
            scene({ title: '1 A', path: 'a.md', actNumber: 1, bookIndex: 0 }),
            scene({ title: '2 B', path: 'b.md', actNumber: 2, bookIndex: 1 })
        ];

        expect(build(scenes, { segment: 1 }).items.map(i => i.path)).toEqual(['b.md']);
        expect(build(scenes, { segment: 1, isSagaScope: true }).items.map(i => i.path)).toEqual(['b.md']);
    });

    it('drops beats when the mode hides them, and keeps them out of the alignment map', () => {
        const scenes = [
            scene({ title: '1 Opening', path: 'open.md' }),
            scene({ title: '1 Catalyst', path: 'beat.md', itemType: 'Beat' })
        ];

        expect(build(scenes, { includeBeats: false }).items.map(i => i.path)).toEqual(['open.md']);

        const withBeats = build(scenes, { includeBeats: true });
        expect(withBeats.items).toHaveLength(2);
        // Beats occupy angular space but are not alignment targets.
        expect([...withBeats.positionByKey.keys()]).toEqual(['open.md']);
    });

    it('keys positions so a subplot ring can look up the outer-ring angle', () => {
        const sequence = build([
            scene({ title: '1 A', path: 'a.md' }),
            scene({ title: '2 B', path: 'b.md' })
        ]);

        const first = sequence.positionByKey.get('a.md');
        const second = sequence.positionByKey.get('b.md');
        expect(first).toEqual(sequence.positions.get(0));
        expect(second).toEqual(sequence.positions.get(1));
        expect(first?.startAngle).toBeCloseTo(ACT_START);
        expect(second?.startAngle).toBeCloseTo(first!.endAngle);
    });

    it('reports a dominant-subplot preference that no longer matches any candidate', () => {
        const sequence = build(
            [scene({ title: '1 A', path: 'a.md', subplot: 'Main Plot' })],
            { dominantSubplots: { 'a.md': 'Deleted Subplot' } }
        );

        expect(sequence.staleDominantPaths).toEqual(['a.md']);
    });
});
