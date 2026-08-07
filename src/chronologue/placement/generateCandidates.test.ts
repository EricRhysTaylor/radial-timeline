import { describe, it, expect } from 'vitest';
import { generateCandidates } from './generateCandidates';
import type { PlacementInterval } from './types';

function interval(lowerIso: string, upperIso: string): PlacementInterval {
    return {
        lowerMs: new Date(lowerIso).getTime(),
        upperMs: new Date(upperIso).getTime(),
        lowerNeighbor: { path: 'prev.md', title: 'Previous', when: new Date(lowerIso), durationMs: null },
        upperNeighbor: { path: 'next.md', title: 'Next', when: new Date(upperIso), durationMs: null }
    };
}

describe('generateCandidates', () => {
    it('offers keep-the-time and midpoint across a multi-day interval', () => {
        const candidates = generateCandidates(
            interval('2024-03-01T09:00:00', '2024-03-08T09:00:00'),
            new Date('2024-05-20T06:30:00'),
            null
        );
        expect(candidates.map(c => c.id)).toEqual(expect.arrayContaining(['keep-time', 'midpoint']));
    });

    it('keeps the same day when the scene time still lies ahead of the lower bound', () => {
        // Lower bound 06:00, scene happens at 09:00 — same day works.
        const candidates = generateCandidates(
            interval('2024-03-01T06:00:00', '2024-03-08T09:00:00'),
            new Date('2024-05-20T09:00:00'),
            null
        );
        const keepTime = candidates.find(c => c.id === 'keep-time');
        expect(keepTime?.storedWhen).toBe('2024-03-01 09:00');
        expect(keepTime?.label).toBe('Same time, same day');
    });

    it('advances to the next day when the scene time has already passed', () => {
        // Lower bound 09:00, scene happens at 06:30 — that hour is behind the
        // bound today, so the placement is the same clock time tomorrow.
        const candidates = generateCandidates(
            interval('2024-03-01T09:00:00', '2024-03-08T09:00:00'),
            new Date('2024-05-20T06:30:00'),
            null
        );
        const keepTime = candidates.find(c => c.id === 'keep-time');
        expect(keepTime?.storedWhen).toBe('2024-03-02 06:30');
        expect(keepTime?.label).toBe('Same time, next day');
    });

    it('drops keep-the-time when the time of day does not fit the interval', () => {
        // Four hours of room, and the scene happens at 23:00.
        const candidates = generateCandidates(
            interval('2024-03-01T09:00:00', '2024-03-01T13:00:00'),
            new Date('2024-05-20T23:00:00'),
            null
        );
        expect(candidates.map(c => c.id)).toEqual(['midpoint']);
    });

    it('still offers a midpoint in a tight interval', () => {
        const candidates = generateCandidates(
            interval('2024-03-01T09:00:00', '2024-03-01T09:10:00'),
            null,
            null
        );
        expect(candidates).toHaveLength(1);
        expect(candidates[0].storedWhen).toBe('2024-03-01 09:05');
    });

    it('returns nothing when the interval has no room', () => {
        expect(generateCandidates(
            interval('2024-03-01T09:00:00', '2024-03-01T09:01:00'),
            new Date('2024-05-20T09:00:30'),
            null
        )).toEqual([]);
    });

    it('omits keep-the-time when the scene has no existing When', () => {
        const candidates = generateCandidates(
            interval('2024-03-01T09:00:00', '2024-03-08T09:00:00'),
            null,
            null
        );
        expect(candidates.map(c => c.id)).toEqual(['midpoint']);
    });

    it('deduplicates candidates that store the same value', () => {
        // Midpoint of this interval is exactly 12:00, and so is keep-the-time.
        const candidates = generateCandidates(
            interval('2024-03-01T00:00:00', '2024-03-02T00:00:00'),
            new Date('2024-05-20T12:00:00'),
            null
        );
        const stored = candidates.map(c => c.storedWhen);
        expect(new Set(stored).size).toBe(stored.length);
        expect(candidates[0].id).toBe('keep-time');
    });

    it('carries the overlap warning onto the candidate', () => {
        const bounds = interval('2024-03-01T09:00:00', '2024-03-01T17:00:00');
        bounds.lowerNeighbor = {
            path: 'prev.md',
            title: 'Previous',
            when: new Date('2024-03-01T09:00:00'),
            durationMs: 6 * 60 * 60 * 1000
        };
        const candidates = generateCandidates(bounds, null, null);
        expect(candidates[0].overlapWarning).toMatchObject({
            kind: 'previous_runs_past',
            neighborTitle: 'Previous'
        });
    });

    it('every candidate it returns validates', () => {
        const bounds = interval('2024-03-01T09:00:00', '2024-03-04T09:00:00');
        const candidates = generateCandidates(bounds, new Date('2024-05-20T14:15:00'), null);
        expect(candidates.length).toBeGreaterThan(0);
        candidates.forEach(candidate => {
            expect(candidate.when.getTime()).toBeGreaterThan(bounds.lowerMs);
            expect(candidate.when.getTime()).toBeLessThan(bounds.upperMs);
        });
    });
});
