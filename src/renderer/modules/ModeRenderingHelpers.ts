/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 */

/**
 * Mode Rendering Helpers
 * 
 * Helper functions to make rendering decisions based on the active mode definition.
 */

import { TimelineMode } from '../../modes/ModeDefinition';
import { getModeDefinition } from '../../modes/ModeRegistry';
import type { PluginRendererFacade } from '../../utils/sceneHelpers';
import { t } from '../../i18n';
import { getTimelineScope } from '../../utils/books';
import { DEFAULT_MAIN_PLOT_NAME } from '../../utils/mainPlot';
import type { ReadabilityScale } from '../../types/settings';
import {
    SUBPLOT_OUTER_RADIUS_CHRONOLOGUE,
    SUBPLOT_OUTER_RADIUS_MAINPLOT,
    SUBPLOT_OUTER_RADIUS_STANDARD
} from '../layout/LayoutConstants';

// Type alias for compatibility
type PluginFacade = PluginRendererFacade;

/**
 * Check if story beats should be shown in the outer ring
 * 
 * @param plugin - Plugin facade with settings
 * @returns true if beats should be shown, false if they should be hidden/removed
 */
export function shouldRenderStoryBeats(plugin: PluginFacade): boolean {
    if (getTimelineScope(plugin.settings) === 'saga') {
        return false;
    }

    const currentMode = plugin.settings.currentMode || TimelineMode.NARRATIVE;
    const modeDef = getModeDefinition(currentMode as TimelineMode);
    
    // Check if beats are shown in this mode
    return modeDef.rendering.beatDisplay !== 'none';
}

/**
 * Check if subplot rings should be shown
 * 
 * @param plugin - Plugin facade with settings
 * @returns true if subplot rings should be shown, false if hidden
 */
export function shouldShowSubplotRings(plugin: PluginFacade): boolean {
    const currentMode = plugin.settings.currentMode || TimelineMode.NARRATIVE;
    const modeDef = getModeDefinition(currentMode as TimelineMode);
    
    // Check if inner rings are visible (not hidden)
    return modeDef.rendering.innerRingContent !== 'hidden';
}

/**
 * Check if all scenes should be shown in the outer ring
 * (vs. only main plot scenes)
 * 
 * @param plugin - Plugin facade with settings
 * @returns true if all scenes shown, false if only main plot
 */
export function shouldShowAllScenesInOuterRing(plugin: PluginFacade): boolean {
    const currentMode = plugin.settings.currentMode || TimelineMode.NARRATIVE;
    return modeHasAllScenesOuterRing(currentMode as TimelineMode);
}

/**
 * Whether a mode's outer ring holds every scene rather than Main Plot only.
 *
 * Asked by the renderer through the plugin facade above, and by the header
 * (which knows a mode id, not a plugin) to decide whether the subplot
 * alignment toggle applies. One answer, two callers.
 *
 * 'narrative' → true, 'chronologue' → true, 'subplot-only' → false
 */
export function modeHasAllScenesOuterRing(mode: TimelineMode): boolean {
    const modeDef = getModeDefinition(mode);
    return modeDef.rendering.outerRingContent === 'narrative' ||
           modeDef.rendering.outerRingContent === 'chronologue';
}

/**
 * Where the subplot rings end. Chronologue and the Narrative runtime view pull
 * the rings in to the same radius to make room for their scene arcs and the
 * labels around the perimeter; Progress widens Main Plot; every other view uses
 * the standard radius for the readability size.
 *
 * One answer for the renderer, the ring layout and synopsis placement.
 */
export function resolveSubplotOuterRadius(mode: string, readabilityScale: ReadabilityScale, runtimeView: boolean): number {
    if (mode === 'chronologue' || runtimeView) return SUBPLOT_OUTER_RADIUS_CHRONOLOGUE;
    if (mode === 'progress') return SUBPLOT_OUTER_RADIUS_MAINPLOT;
    return SUBPLOT_OUTER_RADIUS_STANDARD[readabilityScale];
}

/**
 * The fewest rings a ring view shows (Eric, 2026-11-19: "never allow fewer
 * than 3 rings even if one or two are empty … A timeline with only 1 ring
 * looks lame"). The Community wheel keeps the same minimum; see the decision
 * "2026-11-19 Community wheel is a hybrid of Narrative and progress".
 */
export const MIN_TIMELINE_RINGS = 3;

/**
 * How many placeholder rings pad the inside of the timeline, toward the hub.
 *
 * `ringCount` is the number of real rings (`masterSubplotOrder.length`). In
 * Narrative the outer ring holds every scene in the main plot's slot, so the
 * count already includes it: a Main-Plot-only book is that one ring plus two
 * placeholders, as on the Community. Progress draws the same count with Main
 * Plot alone on the outer ring.
 *
 * Only the ring views (Narrative, Progress) are padded; Chronologue and
 * Gossamer keep their own stacks. A book with no rings at all is the zero
 * state, the same three placeholders in every mode, so the first scene lands
 * on the outer ring without the rings moving.
 */
export function placeholderRingCount(mode: string, ringCount: number): number {
    const padded = ringCount === 0 || mode === TimelineMode.NARRATIVE || mode === TimelineMode.PROGRESS;
    return padded ? Math.max(0, MIN_TIMELINE_RINGS - ringCount) : 0;
}

/**
 * Check if subplot rings align each scene to its outer-ring angle (Sequence)
 * rather than spreading to fill their segment (Fill).
 *
 * Alignment needs an all-scenes outer ring to align against, so the mode gate
 * is structural, not a list of allowed modes: Progress mode's outer ring holds
 * only Main Plot scenes, so there is nothing to align to and the setting has
 * no effect there.
 *
 * @param plugin - Plugin facade with settings
 * @returns true if subplot scenes should be drawn at their outer-ring angles
 */
export function usesSequenceAlignment(plugin: PluginFacade): boolean {
    if (plugin.settings.subplotAlignment !== 'sequence') return false;
    return shouldShowAllScenesInOuterRing(plugin);
}

/**
 * Get the subplot label text for a given subplot name and ring position
 * 
 * @param plugin - Plugin facade with settings
 * @param subplot - Subplot name
 * @param isOuterRing - Whether this is the outer ring
 * @returns Label text (uppercase)
 */
export function getSubplotLabelText(plugin: PluginFacade, subplot: string, isOuterRing: boolean): string {
    if (!isOuterRing) {
        return subplot.toUpperCase();
    }
    
    // Outer ring label depends on mode
    const currentMode = plugin.settings.currentMode || TimelineMode.NARRATIVE;
    const modeDef = getModeDefinition(currentMode as TimelineMode);
    
    // Check outer ring content type
    if (modeDef.rendering.outerRingContent === 'narrative') {
        return t('timeline.subplotRing.allScenes');
    } else if (modeDef.rendering.outerRingContent === 'subplot-only') {
        // Ring 1 holds the main plot alone. Keep the translated label while it
        // has the default name; once the author renames it, show that name.
        return subplot === DEFAULT_MAIN_PLOT_NAME ? t('timeline.subplotRing.mainPlot') : subplot.toUpperCase();
    } else if (modeDef.rendering.outerRingContent === 'chronologue') {
        return t('timeline.subplotRing.chronologue');
    }

    return subplot.toUpperCase();
}
