import { describe, expect, it } from 'vitest';
import { areBetaCommandsVisible, hasProFeatureAccess } from './featureGate';

describe('hasProFeatureAccess', () => {
    it('uses Pro entitlement as the single feature access source', () => {
        expect(hasProFeatureAccess({
            settings: {}
        } as any)).toBe(false);

        expect(hasProFeatureAccess({
            settings: {
                proAccessEnabled: true
            }
        } as any)).toBe(false);

        expect(hasProFeatureAccess({
            settings: {
                proLicenseKey: '1234567890abcdef',
                proAccessEnabled: true
            }
        } as any)).toBe(true);

        expect(hasProFeatureAccess({
            settings: {
                proLicenseKey: '1234567890abcdef',
                proAccessEnabled: false
            }
        } as any)).toBe(false);
    });
});

describe('areBetaCommandsVisible', () => {
    it('keeps beta commands visible outside release builds', () => {
        expect(areBetaCommandsVisible({ releaseBuild: false })).toBe(true);
    });

    it('hides beta commands in release builds', () => {
        expect(areBetaCommandsVisible({ releaseBuild: true })).toBe(false);
    });
});
