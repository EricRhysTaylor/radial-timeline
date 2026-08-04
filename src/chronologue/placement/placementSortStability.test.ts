/*
 * The invariant the whole feature rests on: after the write, the scene sits in
 * the slot the modal promised. Everything else — the round-trip validation, the
 * strict-between bounds, removing the dragged scene before reading neighbours —
 * exists to make this test pass for every drop.
 */

import { describe, it, expect } from 'vitest';
import type { TimelineItem } from '../../types';
import { buildChronologueSceneSequence } from '../../utils/sceneHelpers';
import { parseWhenField } from '../../utils/date';
import { generateCandidates } from './generateCandidates';
import { resolvePlacementNeighbors } from './resolveNeighbors';

/**
 * Manuscript order deliberately DISAGREES with chronology here — that
 * disagreement is what Chronologue exists to show, and it is what makes the
 * equal-timestamp tie-break dangerous.
 */
function scene(manuscriptNumber: number, title: string, iso: string): TimelineItem {
    return {
        path: `Scenes/${String(manuscriptNumber).padStart(2, '0')} ${title}.md`,
        title,
        number: manuscriptNumber,
        date: iso,
        when: new Date(iso),
        itemType: 'Scene'
    };
}

// Read in the order 1..5; happens in the order D, B, E, A, C.
const SCENES: TimelineItem[] = [
    scene(1, 'Alpha', '2024-04-10T09:00:00'),
    scene(2, 'Bravo', '2024-02-14T09:00:00'),
    scene(3, 'Charlie', '2024-05-01T09:00:00'),
    scene(4, 'Delta', '2024-01-05T09:00:00'),
    scene(5, 'Echo', '2024-03-20T09:00:00')
];

/** Re-derive the ring order after rewriting one scene's When. */
function sequenceAfterPlacement(dragged: TimelineItem, storedWhen: string): string[] {
    const rewritten = SCENES.map(item => (
        item.path === dragged.path
            ? { ...item, when: parseWhenField(storedWhen) ?? undefined } // SAFE: stored values always reparse; undefined would fail the assertion loudly
            : item
    ));
    return buildChronologueSceneSequence(rewritten).map(item => item.title ?? '');
}

function placeBefore(draggedTitle: string, targetTitle: string): string[] {
    const sequence = buildChronologueSceneSequence(SCENES);
    const dragged = SCENES.find(item => item.title === draggedTitle)!;
    const target = SCENES.find(item => item.title === targetTitle)!;

    const resolution = resolvePlacementNeighbors(sequence, dragged.path!, target.path!);
    expect(resolution.kind).toBe('ok');
    if (resolution.kind !== 'ok') throw new Error('unreachable');

    const candidates = generateCandidates(resolution.interval, dragged.when ?? null, null);
    expect(candidates.length).toBeGreaterThan(0);

    // Every candidate must produce the same landing slot.
    const orders = candidates.map(candidate => sequenceAfterPlacement(dragged, candidate.storedWhen));
    orders.forEach(order => expect(order).toEqual(orders[0]));
    return orders[0];
}

describe('placement sort stability', () => {
    it('starts from a chronology that disagrees with manuscript order', () => {
        expect(buildChronologueSceneSequence(SCENES).map(s => s.title)).toEqual([
            'Delta', 'Bravo', 'Echo', 'Alpha', 'Charlie'
        ]);
    });

    it('lands the scene immediately before the target when dragged forward', () => {
        // Delta is first chronologically; place it just before Charlie (last).
        const order = placeBefore('Delta', 'Charlie');
        expect(order).toEqual(['Bravo', 'Echo', 'Alpha', 'Delta', 'Charlie']);
    });

    it('lands the scene immediately before the target when dragged backward', () => {
        // Charlie is last; place it just before Echo.
        const order = placeBefore('Charlie', 'Echo');
        expect(order).toEqual(['Delta', 'Bravo', 'Charlie', 'Echo', 'Alpha']);
    });

    it('lands correctly for a mid-sequence move', () => {
        const order = placeBefore('Alpha', 'Echo');
        expect(order).toEqual(['Delta', 'Bravo', 'Alpha', 'Echo', 'Charlie']);
    });

    it('holds for a drop between two immediate neighbours', () => {
        const order = placeBefore('Charlie', 'Bravo');
        expect(order).toEqual(['Delta', 'Charlie', 'Bravo', 'Echo', 'Alpha']);
    });

    it('holds when the manuscript tie-break would otherwise win', () => {
        // Bravo (manuscript #2) placed before Delta (manuscript #4). If the
        // written value ever equalled Delta's, the sort would order them by
        // manuscript index and Bravo would land first anyway — masking a bug.
        // Placing before Delta (the chronological first) is a seam case, so use
        // the explicit seam form.
        const sequence = buildChronologueSceneSequence(SCENES);
        const dragged = SCENES.find(item => item.title === 'Bravo')!;
        const resolution = resolvePlacementNeighbors(sequence, dragged.path!, 'Scenes/04 Delta.md', 'before-first');
        expect(resolution.kind).toBe('ok');
        if (resolution.kind !== 'ok') throw new Error('unreachable');

        const candidates = generateCandidates(resolution.interval, dragged.when ?? null, null);
        expect(candidates.length).toBeGreaterThan(0);
        candidates.forEach(candidate => {
            expect(sequenceAfterPlacement(dragged, candidate.storedWhen)).toEqual([
                'Bravo', 'Delta', 'Echo', 'Alpha', 'Charlie'
            ]);
            // And the written value is strictly earlier than Delta's — not equal.
            expect(parseWhenField(candidate.storedWhen)!.getTime())
                .toBeLessThan(new Date('2024-01-05T09:00:00').getTime());
        });
    });
});
