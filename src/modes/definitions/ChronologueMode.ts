/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 */

import { ModeDefinition, TimelineMode } from '../ModeDefinition';
import type { RadialTimelineView } from '../../view/TimeLineView';

/**
 * Chronologue Mode Definition
 * 
 * Shows scenes in chronological story order based on their When field.
 * The outer ring displays scenes sorted by story chronology with proportional
 * time visualization via the outer arc timeline.
 */
export const CHRONOLOGUE_MODE: ModeDefinition = {
    id: TimelineMode.CHRONOLOGUE,
    name: 'Chronologue',
    description: 'View scenes in chronological story order based on When field',
    
    rendering: {
        outerRingContent: 'chronologue',
        innerRingContent: 'chronologue',
        beatDisplay: 'none',
        sceneColoring: 'subplot',
        numberSquares: 'full',
        overlayLayers: ['chronological-timeline'],
        visualMuting: []
    },
    
    interactions: {
        hoverBehavior: 'standard-scene-hover',
        clickBehavior: 'open-scene-file',
        enableZeroDraftMode: true,
        exitBehavior: 'toggle-button'
    },
    
    ui: {
        acronym: 'C',
        tooltip: 'Switch to Chronologue mode',
        showInToggleButton: true,
        order: 3
    },
    
    /**
     * Exit lifecycle hook - Clean up shift mode state
     */
    onExit: async (view: RadialTimelineView) => {
        // Call the chronologue shift cleanup function if it exists
        if (view._chronologueShiftCleanup) {
            view._chronologueShiftCleanup();
            // Clear the cleanup function reference
            delete view._chronologueShiftCleanup;
        }

        // Reset the global shift mode state
        const { resetShiftModeState } = await import('../../view/interactions/ChronologueShiftController');
        resetShiftModeState();

        // Clean up any remaining shift mode UI from the SVG
        const container = view.containerEl;
        if (container) {
            const svg = container.querySelector('.radial-timeline-svg') as SVGSVGElement;
            if (svg) {
                // Remove shift mode data attribute
                svg.removeAttribute('data-shift-mode');
                
                // Remove shift button
                const shiftButton = svg.querySelector('#shift-mode-toggle');
                if (shiftButton) {
                    shiftButton.remove();
                }
                
                // Clean up any shift mode classes
                svg.querySelectorAll('.rt-shift-hover, .rt-shift-locked, .rt-shift-selected, .rt-shift-non-select').forEach(el => {
                    el.classList.remove('rt-shift-hover', 'rt-shift-locked', 'rt-shift-selected', 'rt-shift-non-select');
                });
                
                // Clean up number square shift classes
                svg.querySelectorAll('.rt-shift-active').forEach(el => {
                    el.classList.remove('rt-shift-active');
                    el.removeAttribute('data-subplot-idx');
                });
                
                // Remove elapsed time elements
                svg.querySelectorAll('.rt-elapsed-time-arc, .rt-elapsed-time-group').forEach(el => {
                    el.remove();
                });
                
                // Clean up any regular Chronologue hover states
                svg.querySelectorAll('.rt-selected, .rt-non-selected').forEach(el => {
                    el.classList.remove('rt-selected', 'rt-non-selected');
                });
            }
        }
    }
};
