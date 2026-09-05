/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 */

import { readSubplotColor } from '../../renderer/utils/subplotColors';

/**
 * Update scene title color in synopsis based on mode
 */
export function updateSynopsisTitleColor(synopsis: Element, sceneId: string, mode: string): void {
    const titleTspans = synopsis.querySelectorAll('.rt-scene-title-bold[data-item-type="title"]');
    if (titleTspans.length === 0) return;
    
    let color: string | null = null;

    if (mode === 'narrative' || mode === 'chronologue') {
        const doc = synopsis.ownerDocument;
        // Get the subplot color from the ring the scene is displayed in
        const sceneGroup = doc.getElementById(sceneId)?.closest('.rt-scene-group') as HTMLElement | null;
        if (sceneGroup) {
            // Check for Backdrop first
            if (sceneGroup.getAttribute('data-item-type') === 'Backdrop') {
                // Use the max publish stage color for Backdrops
                color = getComputedStyle(doc.documentElement).getPropertyValue('--rt-max-publish-stage-color').trim();
            } else {
                const subplotIndex = Number(sceneGroup.getAttribute('data-subplot-color-index') || sceneGroup.getAttribute('data-subplot-index'));
                if (Number.isFinite(subplotIndex)) {
                    color = readSubplotColor(doc, subplotIndex);
                }
            }
        }
    } else if (mode === 'subplot') {
        // Use the publish stage color stored on synopsis
        color = synopsis.getAttribute('data-stage-color');
    }
    
    if (color) {
        titleTspans.forEach(tspan => {
            (tspan as SVGTSpanElement).style.setProperty('--rt-dynamic-color', color);
        });
    }
}
