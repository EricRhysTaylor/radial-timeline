/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 */

import { App } from 'obsidian';
import type { TimelineItem } from '../../types';
import { RadialTimelineView } from '../TimeLineView';

interface DominantSubplotView {
    plugin: {
        app?: App;
        settings: {
            dominantSubplots?: Record<string, string>;
        };
        saveSettings?: () => Promise<void>;
    };
}

/**
 * Handle dominant subplot selection when a scene is clicked in a subplot ring.
 * This sets the clicked subplot as dominant for ALL scenes in that subplot that exist in multiple subplots.
 * 
 * @param view - The view instance
 * @param clickedGroup - The scene group element that was clicked
 * @param svgElement - The SVG container element
 * @param scenes - All scenes in the timeline
 * @returns Promise that resolves when the operation is complete
 */
export async function handleDominantSubplotSelection(
    view: DominantSubplotView,
    clickedGroup: Element,
    svgElement: SVGSVGElement,
    scenes: TimelineItem[]
): Promise<void> {
    // Get the subplot index from the clicked scene group
    const subplotIndexAttr = clickedGroup.getAttribute('data-subplot-index');
    const encodedPath = clickedGroup.getAttribute('data-path');
    
    if (!subplotIndexAttr || !encodedPath) {
        return;
    }
    
    const subplotIndex = parseInt(subplotIndexAttr, 10);
    
    if (isNaN(subplotIndex)) {
        return;
    }
    
    // Get masterSubplotOrder from the SVG element
    const subplotLabels = Array.from(svgElement.querySelectorAll('.rt-subplot-ring-label-text'));
    const masterSubplotOrder = subplotLabels
        .map(label => label.getAttribute('data-subplot-name'))
        .filter((name): name is string => name !== null);
    
    if (subplotIndex >= masterSubplotOrder.length) {
        return;
    }
    
    const clickedSubplot = masterSubplotOrder[subplotIndex];
    
    // Find ALL scenes that belong to the clicked subplot
    const scenesInClickedSubplot = scenes.filter(s => s.subplot === clickedSubplot);
    
    // Group scenes by path to find which ones exist in multiple subplots
    const pathToScenes = new Map<string, TimelineItem[]>();
    scenes.forEach(s => {
        if (s.path) {
            if (!pathToScenes.has(s.path)) {
                pathToScenes.set(s.path, []);
            }
            pathToScenes.get(s.path)!.push(s);
        }
    });
    
    // For each scene in the clicked subplot that exists in multiple subplots,
    // set the clicked subplot as dominant
    let updatedCount = 0;
    if (!view.plugin.settings.dominantSubplots) {
        view.plugin.settings.dominantSubplots = {};
    }
    
    scenesInClickedSubplot.forEach(scene => {
        if (!scene.path) return;
        
        const scenesWithSamePath = pathToScenes.get(scene.path) || [];
        if (scenesWithSamePath.length > 1) {
            // This scene exists in multiple subplots - set dominant preference
            view.plugin.settings.dominantSubplots![scene.path] = clickedSubplot;
            updatedCount++;
        }
    });
    
    if (updatedCount > 0) {
        // Save settings and refresh timeline
        if (view.plugin.saveSettings) {
            await view.plugin.saveSettings();
        }
        
        // Trigger timeline refresh using the correct method
        const timelineView = view.plugin.app?.workspace?.getLeavesOfType('radial-timeline')?.[0]?.view as RadialTimelineView | undefined;
        if (timelineView?.refreshTimeline) {
            timelineView.refreshTimeline();
        }
    }
}
