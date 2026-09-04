/**
 * Radial Timeline Plugin for Obsidian — Number Square DOM Updater
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 */

import type { TimelineItem } from '../../types';
import type { PluginRendererFacade } from '../../utils/sceneHelpers';
import { getSceneState, buildSquareClasses, buildTextClasses, shouldDisplayMissingWhenWarning } from '../../utils/sceneHelpers';

/**
 * Updates number square colors and classes without regenerating
 * Used for status changes, AI grade updates, etc.
 */
export function updateNumberSquareStates(
    svg: SVGSVGElement,
    plugin: PluginRendererFacade,
    scenes: TimelineItem[]
): boolean {
    try {
        let updated = false;
        
        scenes.forEach(scene => {
            if (!scene.path) return;
            
            const encodedPath = encodeURIComponent(scene.path);
            
            const sceneGroups = svg.querySelectorAll(`.rt-scene-group[data-path="${encodedPath}"]`);
            
            sceneGroups.forEach(group => {
                const scenePath = group.querySelector('.rt-scene-path');
                const sceneId = scenePath?.id;
                
                const numberSquare = sceneId ? svg.querySelector(`.rt-number-square[data-scene-id="${sceneId}"]`) : null;
                const numberText = sceneId ? svg.querySelector(`.rt-number-text[data-scene-id="${sceneId}"]`) : null;
                
                if (!numberSquare || !numberText) return;
                
                // Get current state
                const { isSceneOpen, isSearchMatch, hasEdits } = getSceneState(scene, plugin);
                
                // Build new classes
                let newSquareClasses = buildSquareClasses(isSceneOpen, isSearchMatch, hasEdits);
                let newTextClasses = buildTextClasses(isSceneOpen, isSearchMatch, hasEdits);
                
                if (shouldDisplayMissingWhenWarning(scene)) {
                    newSquareClasses += ' rt-missing-when';
                    newTextClasses += ' rt-missing-when';
                }
                
                // Add AI grade if enabled
                if (plugin.settings.enableAiSceneAnalysis) {
                    // Try to extract grade from existing class
                    const existingClasses = numberText.getAttribute('class') || '';
                    const gradeMatch = existingClasses.match(/rt-grade-([A-F])/);
                    if (gradeMatch) {
                        newTextClasses += ` rt-grade-${gradeMatch[1]}`;
                    }
                }
                
                // Update square classes
                const currentSquareClasses = numberSquare.getAttribute('class');
                if (currentSquareClasses !== newSquareClasses) {
                    numberSquare.setAttribute('class', newSquareClasses);
                    updated = true;
                }
                
                // Update text classes
                const currentTextClasses = numberText.getAttribute('class');
                if (currentTextClasses !== newTextClasses) {
                    numberText.setAttribute('class', newTextClasses);
                    updated = true;
                }
            });
        });
        
        return updated;
    } catch (error) {
        console.error('[NumberSquareDOMUpdater] Failed to update number squares:', error);
        return false;
    }
}

