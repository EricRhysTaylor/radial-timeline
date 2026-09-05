import { formatNumber } from '../../utils/svg';
import {
    APR_ICON_X,
    APR_ICON_Y,
    STATUS_ICON_CENTER_OFFSET,
    STATUS_TEXT_ABOVE_ICON
} from '../layout/LayoutConstants';

/*
 * =============================================================================
 * APR REFRESH INDICATOR
 * =============================================================================
 * 
 * ICON-CENTERED POSITIONING (canonical pattern for all status icons):
 * 
 *   Group origin: (ICON_X, ICON_Y) ← CENTER of the icon
 *   ├── Icon: translate(-12, -12) → centers 24px icon at origin
 *   └── Text: y = -22 → positioned above icon center
 * 
 * All positions in LayoutConstants define icon centers, not text baselines.
 * This ensures perfect alignment between stacked icons.
 * =============================================================================
 */

/**
 * Alert triangle icon (Lucide alert-triangle)
 * 24x24 viewBox
 */
const ALERT_TRIANGLE_ICON = `
<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/>
<path d="M12 9v4"/>
<path d="M12 17h.01"/>
`;

/**
 * Render the APR Refresh indicator in the timeline view.
 * Positioned above the version indicator (bottom-left corner).
 * 
 * Uses ICON-CENTERED positioning - group origin is icon center.
 */
export function renderAuthorProgressIndicator(params: {
    needsRefresh: boolean;
    x?: number;
    y?: number;
}): string {
    if (!params.needsRefresh) return '';

    const aprText = 'APR REFRESH';
    
    // Position is ICON CENTER
    const x = params.x ?? APR_ICON_X;
    const y = params.y ?? APR_ICON_Y;

    // Hit area covers text and icon
    const hitAreaWidth = 120;
    const hitAreaHeight = 60;

    return `
        <g id="apr-refresh-indicator" class="rt-apr-indicator" transform="translate(${formatNumber(x)}, ${formatNumber(y)})">
            <!-- Hit area centered on icon -->
            <rect class="rt-apr-hitarea" 
                x="${formatNumber(-hitAreaWidth / 2)}" 
                y="${formatNumber(STATUS_TEXT_ABOVE_ICON - 10)}" 
                width="${hitAreaWidth}" 
                height="${hitAreaHeight}" 
                rx="6" ry="6"
                fill="white" fill-opacity="0" stroke="none" pointer-events="all" />

            <!-- Text: positioned above icon center -->
            <text class="rt-apr-indicator-text" x="0" y="${STATUS_TEXT_ABOVE_ICON}" text-anchor="middle" dominant-baseline="baseline">
                ${aprText}
            </text>

            <!-- Icon: centered at origin (group position IS icon center) -->
            <g class="rt-apr-alert-icon" transform="translate(${STATUS_ICON_CENTER_OFFSET}, ${STATUS_ICON_CENTER_OFFSET})">
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"
                     fill="none" stroke="currentColor" stroke-width="1"
                     stroke-linecap="round" stroke-linejoin="round">
                    ${ALERT_TRIANGLE_ICON}
                </svg>
            </g>
        </g>
    `;
}
