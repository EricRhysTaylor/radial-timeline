/**
 * Radial Timeline Plugin for Obsidian — Scene DOM Updater
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 */

import type { TimelineItem } from '../../types';
import type { PluginRendererFacade } from '../../utils/sceneHelpers';
import { getMostAdvancedStageColor } from '../../utils/colour';
import { getFillForScene } from '../utils/SceneFill';

/**
 * Updates scene fills in the DOM without regenerating SVG.
 * Used for visual-only YAML changes such as Status, Due, and Publish Stage.
 */
export function updateSceneFills(
    svg: SVGSVGElement,
    plugin: PluginRendererFacade,
    changedScenes: TimelineItem[]
): boolean {
    try {
        const publishStageColors = plugin.settings.publishStageColors || {};
        const currentMode = plugin.settings.currentMode || 'narrative';
        const forceSubplotFillColors = currentMode === 'narrative' || currentMode === 'chronologue';
        
        let updated = false;
        
        changedScenes.forEach(scene => {
            if (!scene.path) return;
            
            const encodedPath = encodeURIComponent(scene.path);
            const sceneGroups = svg.querySelectorAll(`.rt-scene-group[data-path="${encodedPath}"]`);
            
            sceneGroups.forEach(group => {
                const arc = group.querySelector('.rt-scene-arc');
                if (!arc) return;
                // The render stamps every scene group with its subplot color.
                const subplotColor = group.getAttribute('data-subplot-color');
                if (subplotColor === null) return;
                const subplotColorResolver = () => subplotColor;
                
                const fill = getFillForScene(
                    scene,
                    publishStageColors,
                    subplotColorResolver,
                    false,
                    forceSubplotFillColors
                );
                
                if (arc.getAttribute('fill') !== fill) {
                    arc.setAttribute('fill', fill);
                    updated = true;
                }
            });
        });

        const dominantStageColor = getMostAdvancedStageColor(changedScenes, publishStageColors);
        const root = svg.ownerDocument?.documentElement;
        if (root) {
            root.style.setProperty('--rt-max-publish-stage-color', dominantStageColor);
            root.style.setProperty('--ert-max-publish-stage-color', dominantStageColor);
        }

        svg.querySelectorAll<SVGTextElement>('.rt-act-label').forEach(label => {
            if (label.getAttribute('fill') !== dominantStageColor) {
                label.setAttribute('fill', dominantStageColor);
                updated = true;
            }
        });
        
        return updated;
    } catch (error) {
        console.error('[SceneDOMUpdater] Failed to update scene fills:', error);
        return false;
    }
}

