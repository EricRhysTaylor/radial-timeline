/*
 * Radial Timeline Plugin for Obsidian — Help Icon Component
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 *
 * =============================================================================
 * ICON-CENTERED POSITIONING (canonical pattern for all status icons)
 * =============================================================================
 * 
 *   Group origin: (ICON_X, ICON_Y) ← CENTER of the icon
 *   ├── Icon: translate(-12, -12) → centers 24px icon at origin
 *   └── Text: y = -22 → positioned above icon center
 * 
 * All positions in LayoutConstants define icon centers, not text baselines.
 * =============================================================================
 */

import { formatNumber } from '../../utils/svg';
import {
    HELP_ICON_X,
    HELP_ICON_Y,
    STATUS_ICON_CENTER_OFFSET,
    STATUS_TEXT_ABOVE_ICON
} from '../layout/LayoutConstants';

const LIFE_BUOY_ICON = `
<circle cx="12" cy="12" r="10"/>
<path d="m4.93 4.93 4.24 4.24"/>
<path d="m14.83 9.17 4.24-4.24"/>
<path d="m14.83 14.83 4.24 4.24"/>
<path d="m9.17 14.83-4.24 4.24"/>
<circle cx="12" cy="12" r="4"/>
`;

/**
 * Render the help icon SVG element
 * Positioned at the bottom-right corner of the timeline
 * Uses ICON-CENTERED positioning - group origin is icon center.
 */
export function renderHelpIcon(): string {
    const x = formatNumber(HELP_ICON_X);
    const y = formatNumber(HELP_ICON_Y);

    const hitAreaWidth = 120;
    const hitAreaHeight = 60;

    return `
        <g id="help-icon" class="rt-help-icon" transform="translate(${x}, ${y})">
            <!-- Hit area centered on icon -->
            <rect class="rt-help-icon-hitarea" 
                x="${formatNumber(-hitAreaWidth / 2)}" 
                y="${formatNumber(STATUS_TEXT_ABOVE_ICON - 10)}" 
                width="${hitAreaWidth}" 
                height="${hitAreaHeight}" 
                fill="white" fill-opacity="0" stroke="none" pointer-events="all" />

            <!-- Text: positioned above icon center -->
            <text class="rt-help-text" x="0" y="${STATUS_TEXT_ABOVE_ICON}" text-anchor="middle" dominant-baseline="baseline">GET HELP</text>

            <!-- Icon: centered at origin. pointer-events="none" so the rect
                 hitarea is the sole click target — without this, the cursor
                 flickers between pointer (on stroke) and default (between
                 strokes) as it moves across the icon. -->
            <g transform="translate(${STATUS_ICON_CENTER_OFFSET}, ${STATUS_ICON_CENTER_OFFSET})" pointer-events="none">
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"
                     fill="none" stroke="currentColor" stroke-width="1"
                     stroke-linecap="round" stroke-linejoin="round">
                    ${LIFE_BUOY_ICON}
                </svg>
            </g>
        </g>
    `;
}
