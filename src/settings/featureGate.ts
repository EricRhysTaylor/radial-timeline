/* global __RT_RELEASE__ -- build-time flags injected by esbuild define; see esbuild.config.mjs */
import type RadialTimelinePlugin from '../main';
import { isProActive } from './proEntitlement';

export function hasProFeatureAccess(plugin: RadialTimelinePlugin): boolean {
    return isProActive(plugin);
}

export function areBetaCommandsVisible(options?: { releaseBuild?: boolean }): boolean {
    const releaseBuild = options?.releaseBuild ?? (
        typeof __RT_RELEASE__ !== 'undefined'
            ? __RT_RELEASE__
            : false
    );
    return !releaseBuild;
}
