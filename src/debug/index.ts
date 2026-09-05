/*
 * Dev-only debug infrastructure
 * This module is only loaded in development builds via dynamic import
 */
import type RadialTimelinePlugin from '../main';
import { buildSnapshot } from './snapshot';

interface DebugGlobals {
    __RT_DEBUG_SNAPSHOT__?: () => ReturnType<typeof buildSnapshot>;
    __RT_DEBUG_CAPS__?: { snapshotVersion: number };
}

export function installDebug(plugin: RadialTimelinePlugin): void {
    const debugWindow = window as Window & DebugGlobals;
    debugWindow.__RT_DEBUG_SNAPSHOT__ = () => buildSnapshot(plugin);
    debugWindow.__RT_DEBUG_CAPS__ = { snapshotVersion: 1 };
}
