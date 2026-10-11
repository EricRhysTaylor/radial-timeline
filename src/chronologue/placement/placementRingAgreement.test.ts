/*
 * Chronologue drag against the ring the author actually sees.
 *
 * placementSortStability pins hand-picked drops. This sweeps every drag/target
 * pair over seeded random manuscripts — scenes in several subplots, a share of
 * them undated — and checks each landing against the outer-ring sequence the
 * renderer draws, not against the drag controller's own copy of it.
 */

import { describe, it, expect } from 'vitest';
import type { TimelineItem } from '../../types';
import { buildChronologueSceneSequence } from '../../utils/sceneHelpers';
import { buildOuterRingSequence } from '../../renderer/utils/OuterRingSequence';
import { parseWhenField } from '../../utils/date';
import { generateCandidates } from './generateCandidates';
import { resolvePlacementNeighbors, resolveSeamIntervals } from './resolveNeighbors';
import type { PlacementInterval } from './types';

const SUBPLOTS = ['Main Plot', 'B Plot', 'C Plot'];
const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

/** Deterministic LCG so a failure reproduces. */
function seededRandom(seed: number): () => number {
    let state = seed;
    return () => {
        state = (state * 1103515245 + 12345) & 0x7fffffff;
        return state / 0x7fffffff;
    };
}

/** One entry per subplot membership, the way the vault scan delivers them. */
function buildManuscript(random: () => number, sceneCount: number, undatedShare: number): TimelineItem[] {
    const base = new Date('2024-01-01T08:00:00').getTime();
    const items: TimelineItem[] = [];
    for (let n = 1; n <= sceneCount; n += 1) {
        const when = random() < undatedShare
            ? undefined
            : new Date(base + Math.floor(random() * 60) * DAY_MS + Math.floor(random() * 24) * HOUR_MS);
        const prefix = String(n).padStart(2, '0');
        const memberships = SUBPLOTS.filter((_, index) => index === 0 || random() < 0.3);
        memberships.forEach(subplot => items.push({
            path: `Book/${prefix} Scene ${n}.md`,
            title: `${prefix} Scene ${n}`,
            number: n,
            date: when ? when.toISOString() : '',
            when,
            itemType: 'Scene',
            subplot,
            actNumber: 1
        }));
    }
    return items;
}

/** The Chronologue outer ring as the renderer builds it. */
function renderedRing(items: TimelineItem[]): string[] {
    return buildOuterRingSequence({
        scenes: items,
        segment: 0,
        isSagaScope: false,
        sortByWhen: true,
        forceChronological: true,
        includeBeats: false,
        masterSubplotOrder: SUBPLOTS,
        innerR: 100,
        outerR: 200,
        startAngle: -Math.PI / 2,
        endAngle: (3 * Math.PI) / 2
    }).items.map(item => item.path ?? '');
}

/** Every candidate the modal would offer, each applied to the vault and re-rendered. */
function ringsAfterPlacement(items: TimelineItem[], draggedPath: string, interval: PlacementInterval): string[][] {
    const dragged = items.find(item => item.path === draggedPath);
    return generateCandidates(interval, dragged?.when ?? null, null).map(candidate => renderedRing(
        items.map(item => (item.path === draggedPath
            ? { ...item, when: parseWhenField(candidate.storedWhen) ?? undefined } // SAFE: stored values always reparse; undefined would fail the assertions loudly
            : item))
    ));
}

describe('Chronologue drag agrees with the rendered ring', () => {
    it('resolves drops against the exact order the ring draws', () => {
        const random = seededRandom(20261010);
        for (let trial = 0; trial < 150; trial += 1) {
            const items = buildManuscript(random, 3 + Math.floor(random() * 12), random() * 0.4);
            expect(buildChronologueSceneSequence(items).map(item => item.path)).toEqual(renderedRing(items));
        }
    });

    it('lands every accepted drop immediately before its target', () => {
        const random = seededRandom(7);
        let landed = 0;
        for (let trial = 0; trial < 120; trial += 1) {
            const items = buildManuscript(random, 3 + Math.floor(random() * 9), random() * 0.3);
            const isUndated = (path: string) => !items.find(item => item.path === path)?.when;
            const sequence = buildChronologueSceneSequence(items);

            for (const dragged of sequence) {
                const draggedPath = dragged.path ?? '';
                for (const target of sequence) {
                    const targetPath = target.path ?? '';
                    if (draggedPath === targetPath) continue;
                    const resolution = resolvePlacementNeighbors(sequence, draggedPath, targetPath);

                    if (resolution.kind === 'ok') {
                        ringsAfterPlacement(items, draggedPath, resolution.interval).forEach(ring => {
                            // Undated scenes sit after the dated scene before them in
                            // manuscript order, so an anchor's undated followers move
                            // with it. Anything else between it and the target is a
                            // misplacement.
                            let next = ring.indexOf(draggedPath) + 1;
                            while (ring[next] !== targetPath && isUndated(ring[next])) next += 1;
                            expect(ring[next], `${draggedPath} → before ${targetPath}`).toBe(targetPath);
                            landed += 1;
                        });
                    } else if (resolution.kind === 'seam') {
                        const seams = resolveSeamIntervals(sequence, draggedPath);
                        if (seams.beforeFirst.kind === 'ok') {
                            ringsAfterPlacement(items, draggedPath, seams.beforeFirst.interval).forEach(ring => {
                                ring.slice(0, ring.indexOf(draggedPath)).forEach(path => expect(isUndated(path)).toBe(true));
                            });
                        }
                        if (seams.afterLast.kind === 'ok') {
                            ringsAfterPlacement(items, draggedPath, seams.afterLast.interval).forEach(ring => {
                                ring.slice(ring.indexOf(draggedPath) + 1).forEach(path => expect(isUndated(path)).toBe(true));
                            });
                        }
                    } else if (resolution.kind === 'noop') {
                        const ring = sequence.map(item => item.path);
                        expect(ring[ring.indexOf(draggedPath) + 1]).toBe(targetPath);
                    }
                }
            }
        }
        // Guard against a generator change that quietly makes every drop a no-op.
        expect(landed).toBeGreaterThan(1000);
    });
});
