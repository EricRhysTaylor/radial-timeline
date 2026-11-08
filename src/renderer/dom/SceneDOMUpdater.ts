/**
 * Radial Timeline Plugin for Obsidian — Scene DOM Updater
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 */

import type { TimelineItem } from '../../types';
import type { PluginRendererFacade } from '../../utils/sceneHelpers';
import { getMostAdvancedStageColor } from '../../utils/colour';
import { getFillForScene } from '../utils/SceneFill';
import { getMainPlotName } from '../../utils/mainPlot';

/**
 * Updates scene colors in the DOM without regenerating SVG
 * Used for dominant subplot changes. Each ring's color is read back from its
 * label, which the render stamped from the one subplot color lookup.
 */
export function updateSceneColors(
    svg: SVGSVGElement,
    changedScenes: TimelineItem[]
): boolean {
    try {
        const ringColors = getRingColors(svg);
        
        let updated = false;
        
        changedScenes.forEach(scene => {
            if (!scene.path) return;
            
            // Find all scene groups for this path
            const encodedPath = encodeURIComponent(scene.path);
            const sceneGroups = svg.querySelectorAll(`[data-path="${encodedPath}"]`);
            
            sceneGroups.forEach(group => {
                const color = ringColors.get(scene.subplot || getMainPlotName());
                if (color === undefined) return;
                
                // Update the scene arc fill color
                const arc = group.querySelector('.rt-scene-arc');
                if (arc) {
                    arc.setAttribute('fill', color);
                    group.setAttribute('data-subplot-color', color);
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

/** Each ring's color by subplot name, as the render stamped it on the ring labels. */
function getRingColors(svg: SVGSVGElement): Map<string, string> {
    const colors = new Map<string, string>();
    svg.querySelectorAll('.rt-subplot-ring-label-text[data-subplot-name][data-subplot-color]').forEach(label => {
        // SAFE: the selector above guarantees both attributes
        colors.set(label.getAttribute('data-subplot-name')!, label.getAttribute('data-subplot-color')!);
    });
    return colors;
}

