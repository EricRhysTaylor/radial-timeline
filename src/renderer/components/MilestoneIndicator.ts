/*
 * =============================================================================
 * MILESTONE INDICATOR
 * =============================================================================
 * 
 * ICON-CENTERED POSITIONING (canonical pattern for all status icons):
 * 
 *   Group origin: (ICON_X, ICON_Y) ← CENTER of the icon
 *   ├── Icon: centered at origin (pulse circles at 0,0, SVG at -12,-12)
 *   └── Text: y = -22 → positioned above icon center
 * 
 * All positions in LayoutConstants define icon centers, not text baselines.
 * =============================================================================
 */

import { formatNumber } from '../../utils/svg';
import {
    MILESTONE_ICON_X,
    MILESTONE_ICON_Y,
    STATUS_ICON_CENTER_OFFSET,
    STATUS_TEXT_ABOVE_ICON
} from '../layout/LayoutConstants';

export type MilestoneType = 
    | 'stage-zero-complete'
    | 'stage-author-complete'
    | 'stage-house-complete'
    | 'stage-press-complete'
    // Legacy alias retained for compatibility with older milestone payloads
    | 'book-complete'
    | 'staleness-warn'
    | 'staleness-late'
    | 'staleness-stalled';

export interface MilestoneInfo {
    type: MilestoneType;
    stage?: string;
}

/**
 * Get the appropriate icon SVG path for each milestone type
 * Uses Lucide icon paths
 */
function getIconForMilestone(type: MilestoneType): { icon: string; color: string; label: string } {
    switch (type) {
        case 'stage-zero-complete':
            return {
                // Sprout icon - first growth
                icon: `<path d="M7 20h10"/>
                       <path d="M10 20c5.5-2.5.8-6.4 3-10"/>
                       <path d="M9.5 9.4c1.1.8 1.8 2.2 2.3 3.7-2 .4-3.5.4-4.8-.3-1.2-.6-2.3-1.9-3-4.2 2.8-.5 4.4 0 5.5.8z"/>
                       <path d="M14.1 6a7 7 0 0 0-1.1 4c1.9-.1 3.3-.6 4.3-1.4 1-1 1.6-2.3 1.7-4.6-2.7.1-4 1-4.9 2z"/>`,
                color: 'var(--rt-publishStageColors-Zero, #9E70CF)',
                label: 'ZERO COMPLETE'
            };
        case 'stage-author-complete':
            return {
                // Tree-pine icon - growing
                icon: `<path d="m17 14 3 3.3a1 1 0 0 1-.7 1.7H4.7a1 1 0 0 1-.7-1.7L7 14h-.3a1 1 0 0 1-.7-1.7L9 9h-.2A1 1 0 0 1 8 7.3L12 3l4 4.3a1 1 0 0 1-.8 1.7H15l3 3.3a1 1 0 0 1-.7 1.7H17Z"/>
                       <path d="M12 22v-3"/>`,
                color: 'var(--rt-publishStageColors-Author, #5E85CF)',
                label: 'AUTHOR COMPLETE'
            };
        case 'stage-house-complete':
            return {
                // Trees icon - forest
                icon: `<path d="M10 10v.2A3 3 0 0 1 8.9 16v0H5v0h0a3 3 0 0 1-1-5.8V10a3 3 0 0 1 6 0Z"/>
                       <path d="M7 16v6"/>
                       <path d="M13 19v3"/>
                       <path d="M10.3 14H20l-1.3 1.6a1 1 0 0 0 .3 1.5l1 .5-.3.8a2 2 0 0 1-1.8 1.1h-5.1"/>
                       <path d="m18 10-1.2 1.5a1 1 0 0 0 .3 1.5l1 .5-.3.7A2 2 0 0 1 16 15h-2.3"/>
                       <path d="M13 8a3 3 0 0 1 0 6"/>`,
                color: 'var(--rt-publishStageColors-House, #6FB971)',
                label: 'HOUSE COMPLETE'
            };
        case 'stage-press-complete':
        case 'book-complete':
            return {
                // Shell/trophy icon - ultimate victory
                icon: `<path d="M14 11a2 2 0 1 1-4 0 4 4 0 0 1 8 0 6 6 0 0 1-12 0 8 8 0 0 1 16 0 10 10 0 1 1-20 0 11.93 11.93 0 0 1 2.42-7.22 2 2 0 0 1 3.16 0A10.01 10.01 0 0 1 10 11"/>`,
                color: 'var(--rt-publishStageColors-Press, #E5A84B)',
                label: 'BOOK COMPLETE!'
            };
        case 'staleness-warn':
            return {
                // Clock with warning
                icon: `<circle cx="12" cy="12" r="10"/>
                       <polyline points="12 6 12 12 16 14"/>`,
                color: '#ff9a00',
                label: 'KEEP GOING'
            };
        case 'staleness-late':
            return {
                // Alarm clock
                icon: `<circle cx="12" cy="13" r="8"/>
                       <path d="M5 3 2 6"/>
                       <path d="m22 6-3-3"/>
                       <path d="M6.38 18.7 4 21"/>
                       <path d="M17.64 18.67 20 21"/>
                       <path d="M12 10v4l2 2"/>`,
                color: '#ff4d4f',
                label: 'YOU GOT THIS'
            };
        case 'staleness-stalled':
            return {
                // Heart with pulse (encouragement)
                icon: `<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>
                       <path d="M3.22 12H9.5l.5-1 2 4.5 2-7 1.5 3.5h5.27"/>`,
                color: '#c1121f',
                label: 'WE BELIEVE IN YOU'
            };
    }
}

/**
 * Render the Milestone indicator in the timeline view.
 * 
 * MILESTONES SYSTEM (this component):
 * - Shows celebration icons when stages are COMPLETELY done (all scenes at that stage complete)
 * - Shows encouragement icons when author is getting behind (staleness warnings)
 * - Syncs with ProgressSection progress tracker (hero cards in settings)
 * 
 * SEPARATE FROM: Estimation/Tick Tracking System
 * - TimelineMetricsService handles progress tracking, completion estimates, target dates
 * - Shows tick marks on timeline, calculates pace, estimates completion dates
 * - Much more nuanced - tracks continuous progress through stages
 * 
 * Uses ICON-CENTERED positioning - group origin is icon center.
 */
export function renderMilestoneIndicator(params: {
    milestone: MilestoneInfo | null;
    x?: number;
    y?: number;
}): string {
    if (!params.milestone) return '';

    // Position is ICON CENTER
    const x = params.x ?? MILESTONE_ICON_X;
    const y = params.y ?? MILESTONE_ICON_Y;

    const { icon, color, label } = getIconForMilestone(params.milestone.type);

    // Hit area covers text and icon
    const hitAreaWidth = 120;
    const hitAreaHeight = 60;

    return `
        <g id="progress-milestone-indicator" class="rt-milestone-indicator" transform="translate(${formatNumber(x)}, ${formatNumber(y)})">
            <!-- Hit area centered on icon -->
            <rect class="rt-milestone-hitarea" 
                x="${formatNumber(-hitAreaWidth / 2)}" 
                y="${formatNumber(STATUS_TEXT_ABOVE_ICON - 10)}" 
                width="${hitAreaWidth}" 
                height="${hitAreaHeight}" 
                rx="6" ry="6"
                fill="white" fill-opacity="0" stroke="none" pointer-events="all" />

            <!-- Text: positioned above icon center, pulses via CSS -->
            <text class="rt-milestone-indicator-text" x="0" y="${STATUS_TEXT_ABOVE_ICON}" text-anchor="middle" dominant-baseline="baseline" fill="${color}">
                ${label}
            </text>

            <!-- Icon: centered at origin, pulses via CSS (no dot/circle) -->
            <g class="rt-milestone-icon" transform="translate(${STATUS_ICON_CENTER_OFFSET}, ${STATUS_ICON_CENTER_OFFSET})">
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"
                     fill="none" stroke="${color}" stroke-width="1" stroke-linecap="round" stroke-linejoin="round">
                    ${icon}
                </svg>
            </g>
        </g>
    `;
}
