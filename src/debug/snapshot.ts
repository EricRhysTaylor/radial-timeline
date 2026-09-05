/*
 * Debug snapshot builder
 * Returns a stable JSON object for automated testing
 * This module is only loaded in development builds
 */
import type RadialTimelinePlugin from '../main';

export interface DebugSnapshot {
    version: number;
    plugin: {
        id: string;
        version: string;
    };
    viewState: {
        isOpen: boolean;
        viewCount: number;
        currentMode: string | null;
        width: number | null;
        height: number | null;
    };
    dataCounts: {
        sceneCount: number;
        subplotCount: number;
        actCount: number;
        povCount: number;
    };
    renderStats: {
        searchActive: boolean;
        searchResultCount: number;
    };
    errors: {
        errorCount: number;
        lastError: string | null;
    };
}

/**
 * Build a stable JSON snapshot of plugin/view state for automation testing
 * Avoids exposing sensitive content (no scene text, no vault paths)
 */
export function buildSnapshot(plugin: RadialTimelinePlugin): DebugSnapshot {
    const views = plugin.getTimelineViews();
    const firstView = views.length > 0 ? views[0] : null;
    
    // Get container dimensions if view exists
    let width: number | null = null;
    let height: number | null = null;
    if (firstView) {
        const container = firstView.containerEl;
        if (container) {
            width = container.clientWidth;
            height = container.clientHeight;
        }
    }
    
    // Count unique subplots, acts, and POVs from scene data
    const sceneData = plugin.lastSceneData ?? [];
    const subplots = new Set<string>();
    const acts = new Set<string>();
    const povs = new Set<string>();
    
    for (const scene of sceneData) {
        if (scene.subplot) subplots.add(scene.subplot);
        if (scene.act) acts.add(scene.act);
        if (scene.pov) povs.add(scene.pov);
    }
    
    return {
        version: 1,
        plugin: {
            id: plugin.manifest.id,
            version: plugin.manifest.version,
        },
        viewState: {
            isOpen: views.length > 0,
            viewCount: views.length,
            currentMode: firstView?.currentMode ?? plugin.settings.currentMode ?? null,
            width,
            height,
        },
        dataCounts: {
            sceneCount: sceneData.length,
            subplotCount: subplots.size,
            actCount: acts.size,
            povCount: povs.size,
        },
        renderStats: {
            searchActive: plugin.searchState.active,
            searchResultCount: plugin.searchState.hits.size,
        },
        errors: {
            errorCount: 0,
            lastError: null,
        },
    };
}
