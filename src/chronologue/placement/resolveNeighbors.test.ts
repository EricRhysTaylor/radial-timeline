import { describe, it, expect } from 'vitest';
import { resolvePlacementNeighbors, resolveSeamIntervals, type PlacementSceneInput } from './resolveNeighbors';

function scene(title: string, iso: string | null, duration?: string): PlacementSceneInput {
    return {
        path: `Scenes/${title}.md`,
        title,
        when: iso ? new Date(iso) : undefined,
        Duration: duration
    };
}

// Chronological order, as the Chronologue ring renders it.
const SEQUENCE: PlacementSceneInput[] = [
    scene('A', '2024-03-01T09:00:00'),
    scene('B', '2024-03-02T09:00:00'),
    scene('C', '2024-03-03T09:00:00'),
    scene('D', '2024-03-04T09:00:00')
];

describe('resolvePlacementNeighbors', () => {
    it('bounds a forward drop with the target and the scene before it', () => {
        const result = resolvePlacementNeighbors(SEQUENCE, 'Scenes/A.md', 'Scenes/D.md');
        expect(result.kind).toBe('ok');
        if (result.kind !== 'ok') return;
        expect(result.interval.lowerNeighbor?.title).toBe('C');
        expect(result.interval.upperNeighbor?.title).toBe('D');
    });

    // The bug the dragged-scene removal exists to prevent.
    it('excludes the dragged scene when it sits between the bounds', () => {
        // Drag C backwards onto B. Without removing C first, the scene before B
        // is A and the answer looks fine — but drag B forwards onto D and the
        // sequence still holds B at index 1, making C the lower bound when it
        // should be C only after B is gone.
        const result = resolvePlacementNeighbors(SEQUENCE, 'Scenes/B.md', 'Scenes/D.md');
        expect(result.kind).toBe('ok');
        if (result.kind !== 'ok') return;
        expect(result.interval.lowerNeighbor?.title).toBe('C');
        expect(result.interval.upperNeighbor?.title).toBe('D');
        // C is the immediate predecessor of D *after* B is removed.
        expect(result.interval.lowerMs).toBe(new Date('2024-03-03T09:00:00').getTime());
    });

    it('bounds a backward drop correctly', () => {
        const result = resolvePlacementNeighbors(SEQUENCE, 'Scenes/D.md', 'Scenes/C.md');
        expect(result.kind).toBe('ok');
        if (result.kind !== 'ok') return;
        expect(result.interval.lowerNeighbor?.title).toBe('B');
        expect(result.interval.upperNeighbor?.title).toBe('C');
    });

    it('reports a no-op when the scene is already immediately before the target', () => {
        expect(resolvePlacementNeighbors(SEQUENCE, 'Scenes/A.md', 'Scenes/B.md')).toEqual({ kind: 'noop' });
    });

    it('reports a no-op when dropped on itself', () => {
        expect(resolvePlacementNeighbors(SEQUENCE, 'Scenes/B.md', 'Scenes/B.md')).toEqual({ kind: 'noop' });
    });

    it('asks for a seam choice when dropped on the first scene', () => {
        expect(resolvePlacementNeighbors(SEQUENCE, 'Scenes/C.md', 'Scenes/A.md')).toEqual({ kind: 'seam' });
    });

    it('opens the lower bound for before-first', () => {
        const result = resolvePlacementNeighbors(SEQUENCE, 'Scenes/C.md', 'Scenes/A.md', 'before-first');
        expect(result.kind).toBe('ok');
        if (result.kind !== 'ok') return;
        expect(result.interval.lowerNeighbor).toBeNull();
        expect(result.interval.upperNeighbor?.title).toBe('A');
        expect(result.interval.lowerMs).toBeLessThan(result.interval.upperMs);
    });

    it('opens the upper bound for after-last', () => {
        const result = resolvePlacementNeighbors(SEQUENCE, 'Scenes/C.md', 'Scenes/A.md', 'after-last');
        expect(result.kind).toBe('ok');
        if (result.kind !== 'ok') return;
        expect(result.interval.lowerNeighbor?.title).toBe('D');
        expect(result.interval.upperNeighbor).toBeNull();
    });

    it('extends an open bound by the median inter-scene gap', () => {
        // With C removed the remaining gaps are 1 day (A→B) and 2 days (B→D);
        // the median index convention matches calculateAutoDiscontinuityThreshold.
        const result = resolvePlacementNeighbors(SEQUENCE, 'Scenes/C.md', 'Scenes/A.md', 'before-first');
        expect(result.kind).toBe('ok');
        if (result.kind !== 'ok') return;
        const twoDays = 2 * 24 * 60 * 60 * 1000;
        expect(result.interval.upperMs - result.interval.lowerMs).toBe(twoDays);
    });

    it('rejects a drop whose lower neighbour has no When', () => {
        const withUndated = [SEQUENCE[0], scene('Undated', null), SEQUENCE[2], SEQUENCE[3]];
        const result = resolvePlacementNeighbors(withUndated, 'Scenes/A.md', 'Scenes/C.md');
        expect(result).toEqual({ kind: 'undated', sceneTitle: 'Undated' });
    });

    it('rejects a drop whose upper neighbour has no When', () => {
        const withUndated = [SEQUENCE[0], SEQUENCE[1], scene('Undated', null), SEQUENCE[3]];
        const result = resolvePlacementNeighbors(withUndated, 'Scenes/D.md', 'Scenes/Undated.md');
        expect(result).toEqual({ kind: 'undated', sceneTitle: 'Undated' });
    });

    it('reports not_found for an unknown path', () => {
        expect(resolvePlacementNeighbors(SEQUENCE, 'Scenes/Ghost.md', 'Scenes/C.md')).toEqual({ kind: 'not_found' });
        expect(resolvePlacementNeighbors(SEQUENCE, 'Scenes/A.md', 'Scenes/Ghost.md')).toEqual({ kind: 'not_found' });
    });

    it('carries neighbour Duration through to the interval', () => {
        const withDuration = [
            SEQUENCE[0],
            SEQUENCE[1],
            scene('C', '2024-03-03T09:00:00', '2h'),
            SEQUENCE[3]
        ];
        const result = resolvePlacementNeighbors(withDuration, 'Scenes/A.md', 'Scenes/D.md');
        expect(result.kind).toBe('ok');
        if (result.kind !== 'ok') return;
        expect(result.interval.lowerNeighbor?.durationMs).toBe(2 * 60 * 60 * 1000);
    });
});

describe('resolveSeamIntervals', () => {
    it('returns both seam alternatives', () => {
        const { beforeFirst, afterLast } = resolveSeamIntervals(SEQUENCE, 'Scenes/C.md');
        expect(beforeFirst.kind).toBe('ok');
        expect(afterLast.kind).toBe('ok');
        if (beforeFirst.kind !== 'ok' || afterLast.kind !== 'ok') return;
        expect(beforeFirst.interval.upperNeighbor?.title).toBe('A');
        expect(afterLast.interval.lowerNeighbor?.title).toBe('D');
    });
});
