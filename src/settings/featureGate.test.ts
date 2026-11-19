import { describe, expect, it } from 'vitest';
import { BETA_FEATURES_MARKER, detectBetaFeatures } from './featureGate';

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
