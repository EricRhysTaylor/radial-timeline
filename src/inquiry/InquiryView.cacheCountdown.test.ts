import { describe, expect, it } from 'vitest';
import { formatCacheCountdown } from './utils/inquiryViewText';

describe('InquiryView cache countdown formatting', () => {
    it('formats the HUD cache countdown as HH:MM without seconds', () => {
        expect(formatCacheCountdown(0)).toBe('00:00');
        expect(formatCacheCountdown(90_000)).toBe('00:01');
        expect(formatCacheCountdown(3_600_000)).toBe('01:00');
        expect(formatCacheCountdown(3_661_000)).toBe('01:01');

        // Always exactly HH:MM (no seconds component).
        for (const ms of [0, 1_000, 59_000, 90_000, 3_600_000, 36_000_000]) {
            expect(formatCacheCountdown(ms)).toMatch(/^\d{2}:\d{2}$/);
        }

        // No seconds granularity: inputs differing only within the same
        // minute produce identical output.
        expect(formatCacheCountdown(60_000)).toBe(formatCacheCountdown(119_000));
    });

    it('clamps negative remaining time to zero', () => {
        expect(formatCacheCountdown(-5_000)).toBe('00:00');
    });
});
