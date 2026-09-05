/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 */

import { ModeDefinition, TimelineMode } from '../ModeDefinition';

/**
 * Narrative Mode Definition
 * 
 * Shows all scenes from all subplots in manuscript order.
 * The outer ring displays combined scenes with subplot colors,
 * while inner rings show subplot-specific scenes.
 */
export const NARRATIVE_MODE: ModeDefinition = {
    id: TimelineMode.NARRATIVE,
    name: 'Narrative',
    description: 'View all scenes across all subplots in manuscript order with subplot coloring',
    
    rendering: {
        outerRingContent: 'narrative',
        innerRingContent: 'subplot-scenes',
        beatDisplay: 'outer-ring-slices',
        sceneColoring: 'subplot',
        numberSquares: 'full',
        overlayLayers: [],
        visualMuting: []
    },
    
    interactions: {
        hoverBehavior: 'standard-scene-hover',
        clickBehavior: 'open-scene-file',
        enableZeroDraftMode: true,
        exitBehavior: 'toggle-button'
    },
    
    ui: {
        acronym: 'N',
        tooltip: 'Switch to Narrative mode',
        showInToggleButton: true,
        order: 2
    }
};
