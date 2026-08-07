import { describe, it, expect } from 'vitest';
import { validatePlacement } from './validatePlacement';
import type { PlacementInterval, PlacementNeighbor } from './types';

function neighbor(title: string, iso: string, durationMs: number | null = null): PlacementNeighbor {
    return { path: `${title}.md`, title, when: new Date(iso), durationMs };
}

function interval(
    lowerIso: string,
    upperIso: string,
    lower: PlacementNeighbor | null = null,
    upper: PlacementNeighbor | null = null
): PlacementInterval {
    return {
        lowerMs: new Date(lowerIso).getTime(),
        upperMs: new Date(upperIso).getTime(),
        lowerNeighbor: lower ?? neighbor('Previous', lowerIso),
        upperNeighbor: upper ?? neighbor('Next', upperIso)
    };
}

describe('validatePlacement', () => {
    it('accepts a date strictly inside the interval', () => {
        const result = validatePlacement(
            new Date('2024-03-05T12:00:00'),
            interval('2024-03-05T08:00:00', '2024-03-05T18:00:00'),
            null
        );
        expect(result.kind).toBe('ok');
        if (result.kind !== 'ok') return;
        expect(result.storedWhen).toBe('2024-03-05 12:00');
        expect(result.when.getTime()).toBe(new Date('2024-03-05T12:00:00').getTime());
    });

    it('rejects a date equal to the lower bound', () => {
        const result = validatePlacement(
            new Date('2024-03-05T08:00:00'),
            interval('2024-03-05T08:00:00', '2024-03-05T18:00:00'),
            null
        );
        expect(result).toMatchObject({ kind: 'rejected', reason: 'outside_bounds' });
    });

    it('rejects a date equal to the upper bound', () => {
        const result = validatePlacement(
            new Date('2024-03-05T18:00:00'),
            interval('2024-03-05T08:00:00', '2024-03-05T18:00:00'),
            null
        );
        expect(result).toMatchObject({ kind: 'rejected', reason: 'outside_bounds' });
    });

    it('rejects a date outside the interval entirely', () => {
        const result = validatePlacement(
            new Date('2024-03-09T12:00:00'),
            interval('2024-03-05T08:00:00', '2024-03-05T18:00:00'),
            null
        );
        expect(result).toMatchObject({ kind: 'rejected', reason: 'outside_bounds' });
    });

    // The reason this validator exists at all.
    it('rejects a candidate that only clears a bound on its seconds', () => {
        // 45 seconds past the lower bound — stores as 08:00, which IS the bound.
        const result = validatePlacement(
            new Date('2024-03-05T08:00:45'),
            interval('2024-03-05T08:00:00', '2024-03-05T18:00:00'),
            null
        );
        expect(result).toMatchObject({ kind: 'rejected', reason: 'outside_bounds' });
        if (result.kind !== 'rejected') return;
        expect(result.message).toContain('Previous');
    });

    it('rejects a candidate that seconds-truncation pushes onto the upper bound', () => {
        const result = validatePlacement(
            new Date('2024-03-05T17:59:30'),
            interval('2024-03-05T08:00:00', '2024-03-05T18:00:00'),
            null
        );
        // 17:59:30 stores as 17:59, still inside — this one must pass.
        expect(result.kind).toBe('ok');
        if (result.kind !== 'ok') return;
        expect(result.storedWhen).toBe('2024-03-05 17:59');
    });

    it('rejects an interval narrower than two minutes', () => {
        const result = validatePlacement(
            new Date('2024-03-05T08:00:30'),
            interval('2024-03-05T08:00:00', '2024-03-05T08:01:00'),
            null
        );
        expect(result).toMatchObject({ kind: 'rejected', reason: 'no_room' });
    });

    it('rejects a null or invalid date', () => {
        const bounds = interval('2024-03-05T08:00:00', '2024-03-05T18:00:00');
        expect(validatePlacement(null, bounds, null)).toMatchObject({ reason: 'unparsable' });
        expect(validatePlacement(new Date('nonsense'), bounds, null)).toMatchObject({ reason: 'unparsable' });
    });

    it('works against an open lower bound with no neighbour', () => {
        const bounds: PlacementInterval = {
            lowerMs: new Date('2024-03-04T12:00:00').getTime(),
            upperMs: new Date('2024-03-05T12:00:00').getTime(),
            lowerNeighbor: null,
            upperNeighbor: neighbor('Opening', '2024-03-05T12:00:00')
        };
        expect(validatePlacement(new Date('2024-03-05T06:00:00'), bounds, null).kind).toBe('ok');
    });

    describe('overlap warnings', () => {
        it('warns when the previous scene runs past the candidate', () => {
            const bounds = interval(
                '2024-03-05T08:00:00',
                '2024-03-05T18:00:00',
                neighbor('Previous', '2024-03-05T08:00:00', 4 * 60 * 60 * 1000)
            );
            const result = validatePlacement(new Date('2024-03-05T10:00:00'), bounds, null);
            expect(result.kind).toBe('ok');
            if (result.kind !== 'ok') return;
            expect(result.overlapWarning).toMatchObject({
                kind: 'previous_runs_past',
                neighborTitle: 'Previous',
                overlapMs: 2 * 60 * 60 * 1000
            });
        });

        it('warns when the dragged scene runs past the next scene', () => {
            const bounds = interval('2024-03-05T08:00:00', '2024-03-05T12:00:00');
            const result = validatePlacement(
                new Date('2024-03-05T11:00:00'),
                bounds,
                3 * 60 * 60 * 1000
            );
            expect(result.kind).toBe('ok');
            if (result.kind !== 'ok') return;
            expect(result.overlapWarning).toMatchObject({
                kind: 'dragged_runs_past',
                neighborTitle: 'Next',
                overlapMs: 2 * 60 * 60 * 1000
            });
        });

        it('does not warn when durations fit', () => {
            const bounds = interval(
                '2024-03-05T08:00:00',
                '2024-03-05T18:00:00',
                neighbor('Previous', '2024-03-05T08:00:00', 30 * 60 * 1000)
            );
            const result = validatePlacement(new Date('2024-03-05T12:00:00'), bounds, 30 * 60 * 1000);
            expect(result.kind).toBe('ok');
            if (result.kind !== 'ok') return;
            expect(result.overlapWarning).toBeNull();
        });

        it('never blocks on an overlap', () => {
            const bounds = interval(
                '2024-03-05T08:00:00',
                '2024-03-05T18:00:00',
                neighbor('Previous', '2024-03-05T08:00:00', 9 * 60 * 60 * 1000)
            );
            expect(validatePlacement(new Date('2024-03-05T09:00:00'), bounds, null).kind).toBe('ok');
        });
    });
});
