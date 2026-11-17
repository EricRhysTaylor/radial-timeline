import { describe, expect, it } from 'vitest';
import { buildCompressedTimeScale } from './compressedTimeScale';

const day = 86_400_000;
const options = { startAngle: 0, endAngle: 6, gapThresholdMs: 30 * day, compressedGapMs: 5 * day };

describe('experimental compressed Chronologue scale', () => {
    it('compresses only the long empty gap and retains its real duration', () => {
        const scale = buildCompressedTimeScale([
            { id: 'a', startMs: 0, endMs: 0 },
            { id: 'b', startMs: day, endMs: day },
            { id: 'c', startMs: 366 * day, endMs: 366 * day },
            { id: 'd', startMs: 367 * day, endMs: 367 * day },
        ], options)!;
        const gap = scale.segments.find(segment => segment.compressed)!;
        expect(gap.endMs - gap.startMs).toBe(365 * day);
        expect(gap.endAngle - gap.startAngle).toBeCloseTo(6 * 5 / 7);
        expect(scale.angleAt(day)).toBeCloseTo(6 / 7);
        expect(scale.angleAt(367 * day)).toBe(6);
        expect(scale.angleAt(-1)).toBeNull();
    });

    it('keeps overlapping uncertain ranges and simultaneous scenes at their actual positions', () => {
        const scale = buildCompressedTimeScale([
            { id: 'a', startMs: 0, endMs: 40 * day },
            { id: 'b', startMs: 20 * day, endMs: 60 * day },
            { id: 'c', startMs: 20 * day, endMs: 20 * day },
            { id: 'd', startMs: 20 * day, endMs: 20 * day },
        ], options)!;
        expect(scale.segments.some(segment => segment.compressed)).toBe(false);
        expect(scale.ranges[1].startAngle).toBe(scale.ranges[2].startAngle);
        expect(scale.ranges[2].startAngle).toBe(scale.ranges[3].startAngle);
        expect(scale.ranges[0].endAngle).toBeGreaterThan(scale.ranges[1].startAngle);
    });

    it('does not compress a gap exactly at the threshold', () => {
        const scale = buildCompressedTimeScale([{ id: 'a', startMs: 0, endMs: 0 }, { id: 'b', startMs: 30 * day, endMs: 30 * day }], options)!;
        expect(scale.segments[0].compressed).toBe(false);
    });

    it('uses a linear scale when no gap crosses the threshold', () => {
        const scale = buildCompressedTimeScale([
            { id: 'first', startMs: 0, endMs: 0 },
            { id: 'middle', startMs: day, endMs: day },
            { id: 'last', startMs: 4 * day, endMs: 4 * day },
        ], options)!;
        expect(scale.angleAt(day)).toBeCloseTo(1.5);
        expect(scale.segments.every(segment => !segment.compressed)).toBe(true);
    });

    it('rejects ambiguous domains, invalid options and repeated ids', () => {
        expect(buildCompressedTimeScale([], options)).toBeNull();
        expect(buildCompressedTimeScale([{ id: 'a', startMs: 1, endMs: 1 }], options)).toBeNull();
        expect(buildCompressedTimeScale([{ id: 'a', startMs: 2, endMs: 1 }], options)).toBeNull();
        expect(buildCompressedTimeScale([{ id: 'a', startMs: 1, endMs: 1 }, { id: 'a', startMs: 2, endMs: 2 }], options)).toBeNull();
        expect(buildCompressedTimeScale([{ id: 'a', startMs: 1, endMs: 2 }], { ...options, endAngle: 2 * Math.PI })).toBeNull();
    });
});
