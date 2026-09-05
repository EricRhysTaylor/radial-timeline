import { describe, expect, it } from 'vitest';
import type { RadialTimelineSettings } from '../types';
import { DEFAULT_SETTINGS } from './defaults';
import { DEFAULT_PRO_OPEN_BETA_KEY, seedProEntitlement } from './proEntitlementSeed';

function createSettings(overrides: Partial<RadialTimelineSettings> = {}): RadialTimelineSettings {
    return {
        ...DEFAULT_SETTINGS,
        ...overrides
    } as RadialTimelineSettings;
}

describe('seedProEntitlement', () => {
    it('seeds the open-beta key for fresh vault settings', () => {
        const settings = createSettings();

        const changed = seedProEntitlement(settings);

        expect(changed).toBe(true);
        expect(settings.proLicenseKey).toBe(DEFAULT_PRO_OPEN_BETA_KEY);
    });

    it('preserves an existing valid key', () => {
        const settings = createSettings({
            proLicenseKey: '1234567890abcdef',
            proAccessEnabled: true
        });

        const changed = seedProEntitlement(settings);

        expect(changed).toBe(false);
        expect(settings.proLicenseKey).toBe('1234567890abcdef');
    });

    it('restores Pro access that was stored off, so the hidden switch cannot strand a vault', () => {
        const settings = createSettings({
            proLicenseKey: '1234567890abcdef',
            proAccessEnabled: false
        });

        const changed = seedProEntitlement(settings);

        expect(changed).toBe(true);
        expect(settings.proAccessEnabled).toBe(true);
    });

    it('reports a change when only the access flag needed recovering', () => {
        // The key is already valid, so the caller would skip persisting unless the
        // guard itself reports the change — otherwise the recovery is lost on reload.
        const settings = createSettings({
            proLicenseKey: DEFAULT_PRO_OPEN_BETA_KEY,
            proAccessEnabled: false
        });

        expect(seedProEntitlement(settings)).toBe(true);
    });

    it('leaves an unset access flag alone', () => {
        // undefined already reads as enabled; only an explicit false is stuck.
        const settings = createSettings({ proLicenseKey: '1234567890abcdef' });
        delete (settings as Partial<RadialTimelineSettings>).proAccessEnabled;

        const changed = seedProEntitlement(settings);

        expect(changed).toBe(false);
        expect(settings.proAccessEnabled).toBeUndefined();
    });
});
