import { describe, expect, it } from 'vitest';
import { BETA_FEATURES_MARKER, detectBetaFeatures, hasProFeatureAccess } from './featureGate';

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

describe('detectBetaFeatures', () => {
    const plugin = (dir: string | undefined, files: string[]) => ({
        manifest: { dir },
        app: { vault: { adapter: { exists: async (path: string) => files.includes(path) } } }
    }) as never;

    it('shows beta features in a vault a development build was deployed to', async () => {
        const dir = '.obsidian/plugins/radial-timeline';
        expect(await detectBetaFeatures(plugin(dir, [`${dir}/${BETA_FEATURES_MARKER}`]))).toBe(true);
    });

    it('hides beta features in an installed release', async () => {
        expect(await detectBetaFeatures(plugin('.obsidian/plugins/radial-timeline', []))).toBe(false);
        expect(await detectBetaFeatures(plugin(undefined, []))).toBe(false);
    });
});
