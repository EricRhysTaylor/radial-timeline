/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 */

import { Notice } from 'obsidian';
import { ModeDefinition, TimelineMode } from '../ModeDefinition';
import { t } from '../../i18n';
import { resolveSelectedBeatModelFromSettings } from '../../utils/beatSystemState';

/**
 * Gossamer Mode Definition
 * 
 * Overlays Gossamer score analysis on top of All Scenes rendering.
 * Shows dots on radial spokes representing current scores, with historical
 * dots, confidence bands, and beat outlines. Non-plot elements are muted.
 */
export const GOSSAMER_MODE: ModeDefinition = {
    id: TimelineMode.GOSSAMER,
    name: 'Gossamer',
    description: 'Gossamer score analysis overlay with beat tracking and historical data',
    
    rendering: {
        outerRingContent: 'narrative',
        innerRingContent: 'subplot-scenes',
        beatDisplay: 'outer-ring-slices',
        sceneColoring: 'subplot',
        numberSquares: 'full',
        overlayLayers: [
            'gossamer-dots',
            'gossamer-spokes',
            'gossamer-outlines',
            'confidence-band'
        ],
        visualMuting: ['non-plot']
    },
    
    interactions: {
        hoverBehavior: 'gossamer-bidirectional',
        clickBehavior: 'gossamer-open-file',
        enableZeroDraftMode: false, // Gossamer mode has its own click behavior
        exitBehavior: 'click-background',
        // Custom handlers are registered in GossamerMode.ts in view/modes
    },
    
    ui: {
        acronym: 'G',
        tooltip: 'Gossamer mode — beat-level signal analysis (requires beat notes)',
        showInToggleButton: true, // Show in mode toggle button
        order: 4
    },
    
    // Lifecycle hooks
    onEnter: async (view) => {
        // Import and run the Gossamer initialization
        const plugin = view.plugin;

        // Get current scenes
        const scenes = await plugin.getSceneData();
        const beatNotes = scenes.filter(s => s.itemType === 'Beat' || s.itemType === 'Plot');
        
        if (beatNotes.length === 0) {
            const selectedSystem = resolveSelectedBeatModelFromSettings(plugin.settings) ?? '';
            const systemHint = selectedSystem
                ? t('gossamer.notices.systemHintWithModel', { system: selectedSystem })
                : t('gossamer.notices.systemHintNoModel');
            new Notice(t('gossamer.notices.cannotEnterMode', { hint: systemHint }), 8000);
            throw new Error('Cannot enter Gossamer mode: No story beats found');
        }
        
        // Build and store Gossamer runs
        const { setBaseModeAllScenes, resetRotation, syncGossamerPresentationState } = await import('../../GossamerCommands');
        
        const selectedBeatModel = resolveSelectedBeatModelFromSettings(plugin.settings);
        const allRuns = await syncGossamerPresentationState(plugin, scenes);
        
        if (allRuns.current.beats.length === 0) {
            const systemHint = selectedBeatModel
                ? t('gossamer.notices.modeMatchHintWithModel', { system: selectedBeatModel })
                : t('gossamer.notices.modeMatchHintNoModel');
            new Notice(t('gossamer.notices.cannotEnterMode', { hint: systemHint }), 8000);
            throw new Error(`Cannot enter Gossamer mode: No beats found for system: ${selectedBeatModel}`);
        }

        // Show info message if no scores exist (graceful, not a warning)
        if (!allRuns.hasAnyScores) {
            const { DEFAULT_GOSSAMER_SIGNAL, GOSSAMER_SIGNAL_METADATA } = await import('../../types/gossamerSignals');
            const activeSignalLabel = GOSSAMER_SIGNAL_METADATA[plugin.gossamerSelectedSignal ?? DEFAULT_GOSSAMER_SIGNAL].label.toLowerCase();
            new Notice(t('gossamer.notices.noScoresInfo', { signal: activeSignalLabel }));
        }
        
        // Setup mode
        setBaseModeAllScenes(plugin);
        resetRotation(plugin);
        plugin.clearSearch();
    },
    
    onExit: async (view) => {
        // This is called when exiting Gossamer mode
        // Future: migrate cleanup logic here
    }
};
