import { describe, it, expect } from 'vitest';
import { CONTENT_LOGGING_RESET_VERSION, resetContentLoggingOnce } from './contentLogging';
import { DEFAULT_SETTINGS } from '../settings/defaults';
import type { RadialTimelineSettings } from '../types/settings';

/** Mirrors loadSettings: defaults merged under the persisted data.json. */
function load(persisted: Partial<RadialTimelineSettings>): RadialTimelineSettings {
    return Object.assign({}, DEFAULT_SETTINGS, persisted);
}

describe('resetContentLoggingOnce', () => {
    it('defaults keep content logging off and never seed the stamp', () => {
        expect(DEFAULT_SETTINGS.logApiInteractions).toBe(false);
        expect(DEFAULT_SETTINGS.contentLoggingResetVersion).toBeUndefined();
    });

    it('turns content logging off once for an existing install that had it on', () => {
        const settings = load({ logApiInteractions: true });
        expect(resetContentLoggingOnce(settings)).toBe(true);
        expect(settings.logApiInteractions).toBe(false);
        expect(settings.contentLoggingResetVersion).toBe(CONTENT_LOGGING_RESET_VERSION);
    });

    it('stamps an existing install that already had logging off', () => {
        const settings = load({ logApiInteractions: false });
        expect(resetContentLoggingOnce(settings)).toBe(true);
        expect(settings.logApiInteractions).toBe(false);
        expect(settings.contentLoggingResetVersion).toBe(CONTENT_LOGGING_RESET_VERSION);
    });

    it('stamps a fresh install with logging off', () => {
        const settings = load({});
        expect(resetContentLoggingOnce(settings)).toBe(true);
        expect(settings.logApiInteractions).toBe(false);
    });

    it('keeps logging on after the author turns it back on', () => {
        const settings = load({ logApiInteractions: true });
        resetContentLoggingOnce(settings);
        // Author re-enables in Settings; settings persist with the stamp.
        settings.logApiInteractions = true;
        const reloaded = load(JSON.parse(JSON.stringify(settings)) as Partial<RadialTimelineSettings>);
        expect(resetContentLoggingOnce(reloaded)).toBe(false);
        expect(reloaded.logApiInteractions).toBe(true);
    });

    it('runs again on an unknown stamp so the reset is never skipped', () => {
        const settings = load({ logApiInteractions: true, contentLoggingResetVersion: 0 });
        expect(resetContentLoggingOnce(settings)).toBe(true);
        expect(settings.logApiInteractions).toBe(false);
    });
});
