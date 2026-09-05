import { describe, it, expect } from 'vitest';
import { deriveBriefingArtifactClassFlags } from './briefingArtifactStatus';

describe('deriveBriefingArtifactClassFlags', () => {
    it('returns pulse flag when status is unsaved', () => {
        expect(deriveBriefingArtifactClassFlags('unsaved')).toEqual({
            'is-briefing-pulse': true,
            'is-briefing-saved': false,
            'is-briefing-error': false,
        });
    });

    it('returns saved flag when status is saved', () => {
        expect(deriveBriefingArtifactClassFlags('saved')).toEqual({
            'is-briefing-pulse': false,
            'is-briefing-saved': true,
            'is-briefing-error': false,
        });
    });

    it('returns error flag when status is error', () => {
        expect(deriveBriefingArtifactClassFlags('error')).toEqual({
            'is-briefing-pulse': false,
            'is-briefing-saved': false,
            'is-briefing-error': true,
        });
    });

    it('clears all flags when status is null', () => {
        expect(deriveBriefingArtifactClassFlags(null)).toEqual({
            'is-briefing-pulse': false,
            'is-briefing-saved': false,
            'is-briefing-error': false,
        });
    });

    it('clears all flags when status is undefined', () => {
        expect(deriveBriefingArtifactClassFlags(undefined)).toEqual({
            'is-briefing-pulse': false,
            'is-briefing-saved': false,
            'is-briefing-error': false,
        });
    });

    it('clears all flags for unrecognized statuses (e.g. simulated)', () => {
        expect(deriveBriefingArtifactClassFlags('simulated')).toEqual({
            'is-briefing-pulse': false,
            'is-briefing-saved': false,
            'is-briefing-error': false,
        });
    });
});
