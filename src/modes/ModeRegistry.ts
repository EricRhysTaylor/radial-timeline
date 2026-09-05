/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 */

/**
 * Mode Registry
 * 
 * Central registry for all available timeline modes.
 * Provides lookup and validation functions.
 */

import { ModeDefinition, TimelineMode } from './ModeDefinition';
import { NARRATIVE_MODE } from './definitions/AllScenesMode';
import { PROGRESS_MODE } from './definitions/MainPlotMode';
import { GOSSAMER_MODE } from './definitions/GossamerMode';
import { CHRONOLOGUE_MODE } from './definitions/ChronologueMode';

/**
 * Registry of all available modes
 */
const MODE_REGISTRY = new Map<TimelineMode, ModeDefinition>([
    [TimelineMode.PROGRESS, PROGRESS_MODE],
    [TimelineMode.NARRATIVE, NARRATIVE_MODE],
    [TimelineMode.CHRONOLOGUE, CHRONOLOGUE_MODE],
    [TimelineMode.GOSSAMER, GOSSAMER_MODE],
]);

/**
 * Get a mode definition by its ID
 */
export function getModeDefinition(mode: TimelineMode): ModeDefinition {
    const definition = MODE_REGISTRY.get(mode);
    if (!definition) {
        // Fallback to Narrative mode if mode not found
        return NARRATIVE_MODE;
    }
    return definition;
}

/**
 * Get all registered modes
 */
export function getAllModes(): ModeDefinition[] {
    return Array.from(MODE_REGISTRY.values());
}

/**
 * Get modes that should appear in the toggle button, sorted by order
 */
export function getToggleableModes(): ModeDefinition[] {
    return getAllModes()
        .filter(mode => mode.ui.showInToggleButton)
        .sort((a, b) => a.ui.order - b.ui.order);
}

