/**
 * Radial Timeline Plugin for Obsidian — Synopsis DOM Updater
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 */

import type { TimelineItem } from '../../types';

/**
 * Updates synopsis text content in the DOM without regenerating SVG
 * Used when scene synopsis changes but structure remains the same
 */
export function updateSynopsisText(
    svg: SVGSVGElement,
    changedScenes: TimelineItem[]
): boolean {
    try {
        let updated = false;
        
        changedScenes.forEach(scene => {
            if (!scene.path || !scene.synopsis) return;
            
            const encodedPath = encodeURIComponent(scene.path);
            
            // Find synopsis elements for this scene
            const synopsisElements = svg.querySelectorAll(`[data-scene-path="${encodedPath}"] .rt-synopsis-text`);
            
            synopsisElements.forEach(element => {
                const currentText = element.textContent || '';
                const newText = scene.synopsis || '';
                
                if (currentText !== newText) {
                    element.textContent = newText; // SAFE: textContent used for plain text
                    updated = true;
                }
            });
        });
        
        return updated;
    } catch (error) {
        console.error('[SynopsisDOMUpdater] Failed to update synopsis:', error);
        return false;
    }
}

/**
 * Updates synopsis visibility based on mode/zoom
 */
export function updateSynopsisVisibility(
    svg: SVGSVGElement,
    visibleScenePaths: Set<string>
): boolean {
    try {
        let updated = false;
        
        const synopsisGroups = svg.querySelectorAll('.rt-synopsis-group');
        
        synopsisGroups.forEach(group => {
            const scenePath = group.getAttribute('data-scene-path');
            if (!scenePath) return;
            
            const decodedPath = decodeURIComponent(scenePath);
            const shouldBeVisible = visibleScenePaths.has(decodedPath);
            
            const isCurrentlyVisible = !group.classList.contains('is-hidden');
            
            if (shouldBeVisible && !isCurrentlyVisible) {
                group.classList.remove('is-hidden');
                updated = true;
            } else if (!shouldBeVisible && isCurrentlyVisible) {
                group.classList.add('is-hidden');
                updated = true;
            }
        });
        
        return updated;
    } catch (error) {
        console.error('[SynopsisDOMUpdater] Failed to update synopsis visibility:', error);
        return false;
    }
}
