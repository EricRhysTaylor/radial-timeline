import { describe, it, expect } from 'vitest';
import {
    computeBriefingFooterButtonState,
    type BriefingFooterStateInput,
} from './briefingFooterButtonState';

function input(partial: Partial<BriefingFooterStateInput> = {}): BriefingFooterStateInput {
    return {
        lockout: false,
        running: false,
        sessionCount: 0,
        hasCorpusOverrides: false,
        purgeAvailable: false,
        ...partial,
    };
}

describe('computeBriefingFooterButtonState', () => {
    it('disables and marks inert when nothing is actionable', () => {
        expect(computeBriefingFooterButtonState(input())).toEqual({
            clearDisabled: true,
            clearInert: true,
            resetDisabled: true,
            purgeDisabled: true,
            purgeInert: true,
        });
    });

    it('clear enables only when sessions exist', () => {
        const result = computeBriefingFooterButtonState(input({ sessionCount: 3 }));
        expect(result.clearDisabled).toBe(false);
        expect(result.clearInert).toBe(false);
    });

    it('reset enables only when corpus has overrides', () => {
        const result = computeBriefingFooterButtonState(input({ hasCorpusOverrides: true }));
        expect(result.resetDisabled).toBe(false);
    });

    it('purge enables only when scanner reports purge available', () => {
        const result = computeBriefingFooterButtonState(input({ purgeAvailable: true }));
        expect(result.purgeDisabled).toBe(false);
        expect(result.purgeInert).toBe(false);
    });

    it('inert flags do not flip when running — only disabled flips', () => {
        // Running with full availability: buttons disabled but NOT inert
        // (inert is a "nothing to do" hint, not "blocked").
        const result = computeBriefingFooterButtonState(input({
            running: true,
            sessionCount: 5,
            hasCorpusOverrides: true,
            purgeAvailable: true,
        }));
        expect(result.clearDisabled).toBe(true);
        expect(result.clearInert).toBe(false);
        expect(result.resetDisabled).toBe(true);
        expect(result.purgeDisabled).toBe(true);
        expect(result.purgeInert).toBe(false);
    });

    it('lockout disables every button regardless of availability', () => {
        const result = computeBriefingFooterButtonState(input({
            lockout: true,
            sessionCount: 5,
            hasCorpusOverrides: true,
            purgeAvailable: true,
        }));
        expect(result.clearDisabled).toBe(true);
        expect(result.resetDisabled).toBe(true);
        expect(result.purgeDisabled).toBe(true);
    });
});
