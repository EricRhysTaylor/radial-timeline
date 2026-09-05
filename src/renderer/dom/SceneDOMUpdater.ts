/**
 * Radial Timeline Plugin for Obsidian — Scene DOM Updater
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 */

import { readSubplotColor } from '../utils/subplotColors';
import type { TimelineItem } from '../../types';
import type { PluginRendererFacade } from '../../utils/sceneHelpers';
import { getMostAdvancedStageColor } from '../../utils/colour';
import { getFillForScene } from '../utils/SceneFill';

/**
 * Updates scene colors in the DOM without regenerating SVG
 * Used for dominant subplot changes
 */
export function updateSceneColors(
    svg: SVGSVGElement,
    plugin: PluginRendererFacade,
    changedScenes: TimelineItem[]
): boolean {
    try {
        const subplotColors = plugin.settings.subplotColors || [];
        const masterSubplotOrder = getMasterSubplotOrder(svg);
        
        let updated = false;
        
        changedScenes.forEach(scene => {
            if (!scene.path) return;
            
            // Find all scene groups for this path
            const encodedPath = encodeURIComponent(scene.path);
            const sceneGroups = svg.querySelectorAll(`[data-path="${encodedPath}"]`);
            
            sceneGroups.forEach(group => {
                // Get the subplot index
                const subplot = scene.subplot || 'Main Plot';
                const subplotIndex = masterSubplotOrder.indexOf(subplot);
                
                if (subplotIndex === -1) return;
                
                // Update the scene arc fill color
                const arc = group.querySelector('.rt-scene-arc');
                if (arc) {
                    const color = subplotColors[subplotIndex % subplotColors.length] || '#cccccc';
                    arc.setAttribute('fill', color);
                    updated = true;
                }
            });
        });

        return updated;
    } catch (error) {
        console.error('[SceneDOMUpdater] Failed to update scene colors:', error);
        return false;
    }
}

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
                const subplotColorIndex = Number(group.getAttribute('data-subplot-color-index') ?? 0);
                const subplotColorResolver = () => readSubplotColor(svg.ownerDocument, subplotColorIndex);
                
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

/**
 * Helper: Extract master subplot order from SVG
 */
function getMasterSubplotOrder(svg: SVGSVGElement): string[] {
    const labels = svg.querySelectorAll('.rt-subplot-ring-label-text');
    return Array.from(labels)
        .map(label => label.getAttribute('data-subplot-name'))
        .filter((name): name is string => name !== null);
}

