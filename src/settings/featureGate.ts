import type RadialTimelinePlugin from '../main';
import { isProActive } from './proEntitlement';

export function hasProFeatureAccess(plugin: RadialTimelinePlugin): boolean {
    return isProActive(plugin);
}

/**
 * Beta features (unreleased commands, the PDF style designer and .tex import,
 * the Welcome onboarding card) show only in vaults a local development build
 * was deployed to: esbuild.config.mjs writes this marker into those plugin
 * folders. Every build ships the same main.js, so Obsidian's review can
 * reproduce the release from a plain `npm run build`.
 */
export const BETA_FEATURES_MARKER = 'beta-features';

export async function detectBetaFeatures(plugin: Pick<RadialTimelinePlugin, 'app' | 'manifest'>): Promise<boolean> {
    const dir = plugin.manifest.dir;
    return !!dir && await plugin.app.vault.adapter.exists(`${dir}/${BETA_FEATURES_MARKER}`);
}
