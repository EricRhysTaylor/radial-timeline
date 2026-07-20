import { describe, expect, it } from 'vitest';
import {
    OMNIBUS_RECENT_RESULT_SUGGEST_WINDOW_MS,
    formatOmnibusResultAge,
    shouldSuggestOmnibusSkip
} from './omnibusRecentResults';

const NOW = 1_700_000_000_000;

describe('shouldSuggestOmnibusSkip', () => {
    it('suggests skipping a result from minutes ago', () => {
        expect(shouldSuggestOmnibusSkip(NOW - 32 * 60_000, NOW)).toBe(true);
    });

    it('suggests skipping right up to the window boundary', () => {
        expect(shouldSuggestOmnibusSkip(NOW - OMNIBUS_RECENT_RESULT_SUGGEST_WINDOW_MS, NOW)).toBe(true);
    });

    it('does not suggest skipping beyond the window', () => {
        expect(shouldSuggestOmnibusSkip(NOW - OMNIBUS_RECENT_RESULT_SUGGEST_WINDOW_MS - 1, NOW)).toBe(false);
    });

    it('rejects future or invalid timestamps', () => {
        expect(shouldSuggestOmnibusSkip(NOW + 60_000, NOW)).toBe(false);
        expect(shouldSuggestOmnibusSkip(0, NOW)).toBe(false);
        expect(shouldSuggestOmnibusSkip(Number.NaN, NOW)).toBe(false);
    });
});

describe('formatOmnibusResultAge', () => {
    it('labels sub-minute ages as just now', () => {
        expect(formatOmnibusResultAge(NOW - 20_000, NOW)).toBe('just now');
    });

    it('labels minute ages', () => {
        expect(formatOmnibusResultAge(NOW - 32 * 60_000, NOW)).toBe('32m ago');
    });

    it('labels hour ages', () => {
        expect(formatOmnibusResultAge(NOW - 3 * 60 * 60_000, NOW)).toBe('3h ago');
    });

    it('labels day ages', () => {
        expect(formatOmnibusResultAge(NOW - 49 * 60 * 60_000, NOW)).toBe('2d ago');
    });
});
