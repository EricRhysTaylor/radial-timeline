/*
 * Radial Timeline Plugin for Obsidian — Version Indicator Component
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
 * 
 * NOTE: VersionIndicator has dynamic X positioning to prevent text clipping.
 * The Y position uses VERSION_ICON_Y from LayoutConstants.
 * =============================================================================
 */

import { formatNumber } from '../../utils/svg';
import {
    MONTH_LABEL_RADIUS,
    SVG_SIZE,
    VERSION_ICON_X,
    VERSION_ICON_Y,
    STATUS_ICON_CENTER_OFFSET,
    STATUS_TEXT_ABOVE_ICON
} from '../layout/LayoutConstants';

/**
 * Octagon alert icon SVG path (lucide-octagon-alert) - shown when update available
 * Size: 24x24, stroke-width: 1
 */
const BADGE_ALERT_ICON = `
<path d="M12 16h.01"/>
<path d="M12 8v4"/>
<path d="M15.312 2a2 2 0 0 1 1.414.586l4.688 4.688A2 2 0 0 1 22 8.688v6.624a2 2 0 0 1-.586 1.414l-4.688 4.688a2 2 0 0 1-1.414.586H8.688a2 2 0 0 1-1.414-.586l-4.688-4.688A2 2 0 0 1 2 15.312V8.688a2 2 0 0 1 .586-1.414l4.688-4.688A2 2 0 0 1 8.688 2z"/>
`;

/**
 * Bug icon SVG path (lucide-bug) - shown when no update, links to bug reporting
 * Size: 24x24, stroke-width: 1
 */
const BUG_ICON = `
<path d="M12 20v-9"/>
<path d="M14 7a4 4 0 0 1 4 4v3a6 6 0 0 1-12 0v-3a4 4 0 0 1 4-4z"/>
<path d="M14.12 3.88 16 2"/>
<path d="M21 21a4 4 0 0 0-3.81-4"/>
<path d="M21 5a4 4 0 0 1-3.55 3.97"/>
<path d="M22 13h-4"/>
<path d="M3 21a4 4 0 0 1 3.81-4"/>
<path d="M3 5a4 4 0 0 0 3.55 3.97"/>
<path d="M6 13H2"/>
<path d="m8 2 1.88 1.88"/>
<path d="M9 7.13V6a3 3 0 1 1 6 0v1.13"/>
`;

/**
 * Settings alert icon (lucide-settings-2) - shown when settings alerts are active
 * Size: 24x24, stroke-width: 1
 */
const SETTINGS_ALERT_ICON = `
<path d="M20 7h-9"/>
<path d="M14 17H5"/>
<circle cx="17" cy="17" r="3"/>
<circle cx="7" cy="7" r="3"/>
`;

/** Approximate font size used for version text (px) — must match styles.css */
const VERSION_TEXT_FONT_SIZE_PX = 20;

/** Average character width ratio for the 04b03b font (roughly monospace) */
const VERSION_TEXT_CHAR_WIDTH_RATIO = 0.62;

/** Minimum inner padding from the SVG/circle edge for the version indicator */
const VERSION_INDICATOR_SAFE_PADDING = 32;

/** Hit area size for the icon (px) — see .rt-version-hitarea */
const ICON_HITAREA_SIZE = 32;

const ICON_HITAREA_HALF_WIDTH = ICON_HITAREA_SIZE / 2;

/** Extra padding for the unified hit area (px) */
const HITAREA_HORIZONTAL_PADDING = 12;

function estimateTextHalfWidth(text: string): number {
    const trimmed = text.trim();
    const effectiveText = trimmed.length ? trimmed : text;
    const charCount = effectiveText.length || 4;
    const approxCharWidthPx = VERSION_TEXT_FONT_SIZE_PX * VERSION_TEXT_CHAR_WIDTH_RATIO;
    return (charCount * approxCharWidthPx) / 2;
}

export interface VersionIndicatorOptions {
    version: string;
    hasUpdate: boolean;
    latestVersion?: string;
    hasSettingsAlert?: boolean;  // When true, shows settings icon with "SETTINGS ALERT" text
}

export interface VersionIndicatorResult {
    svg: string;
    computedX: number;  // The actual X position used (for aligning APR above)
}

/**
 * Compute the safe X position for bottom-left indicators.
 * Ensures text doesn't clip the edge. Used by both Version and APR indicators.
 */
export function computeBottomLeftIndicatorX(textWidths: number[]): number {
    const maxHalfWidth = Math.max(...textWidths, ICON_HITAREA_HALF_WIDTH);
    const viewboxLeftEdge = -(SVG_SIZE / 2);
    const circleLeftEdge = -MONTH_LABEL_RADIUS;
    const safeCanvasCenterX = viewboxLeftEdge + VERSION_INDICATOR_SAFE_PADDING + maxHalfWidth;
    const safeCircleCenterX = circleLeftEdge + VERSION_INDICATOR_SAFE_PADDING + maxHalfWidth;
    return Math.max(VERSION_ICON_X, safeCanvasCenterX, safeCircleCenterX);
}

/**
 * Determine update severity based on version comparison
 * Returns: 'major' (red), 'minor' (orange), or 'none' (green)
 */
function getUpdateSeverity(current: string, latest: string | undefined): 'none' | 'minor' | 'major' {
    if (!latest) return 'none';

    const parseVersion = (v: string): number[] => {
        return v.replace(/^v/, '').split('.').map(n => parseInt(n, 10) || 0);
    };

    const [curMajor] = parseVersion(current);
    const [latMajor] = parseVersion(latest);

    // Major version bump (e.g., 4.x.x -> 5.x.x)
    if (latMajor > curMajor) {
        return 'major';
    }

    // Any other update (minor or patch)
    return 'minor';
}

/**
 * Render the version indicator SVG element
 * Positioned at the bottom-left corner of the timeline
 * Shows bug icon when up-to-date, update icon when new version available
 * 
 * Uses ICON-CENTERED positioning - group origin is icon center.
 * NOTE: X position is dynamically computed to prevent text clipping.
 * 
 * Returns both the SVG and the computed X for aligning APR indicator above.
 */
export function renderVersionIndicator(options: VersionIndicatorOptions): VersionIndicatorResult {
    const { version, hasUpdate, latestVersion, hasSettingsAlert } = options;

    const currentVersionLabel = version.trim() || version;
    const latestVersionLabel = (latestVersion ?? '').trim();
    const updateRangeText = latestVersionLabel
        ? `${currentVersionLabel} -> ${latestVersionLabel}`
        : currentVersionLabel;

    // Priority: Settings Alert > Update Available > Bug Report
    let versionText: string;
    let actionText: string;
    let iconContent: string;
    let iconClass: string;

    if (hasSettingsAlert) {
        // Settings alert mode (highest priority)
        versionText = 'SETTINGS ALERT';
        actionText = 'OPEN SETTINGS';
        iconContent = SETTINGS_ALERT_ICON;
        iconClass = 'rt-version-settings-icon';
    } else if (hasUpdate) {
        // Update available mode
        versionText = 'NEW RELEASE';
        actionText = updateRangeText || 'UPDATE TO LATEST VERSION';
        iconContent = BADGE_ALERT_ICON;
        iconClass = 'rt-version-alert-icon';
    } else {
        // Default bug report mode
        versionText = currentVersionLabel;
        actionText = 'REPORT BUG';
        iconContent = BUG_ICON;
        iconClass = 'rt-version-bug-icon';
    }

    const versionTextHalfWidth = estimateTextHalfWidth(versionText);
    const actionTextHalfWidth = estimateTextHalfWidth(actionText);
    const maxHalfWidth = Math.max(versionTextHalfWidth, actionTextHalfWidth, ICON_HITAREA_HALF_WIDTH);
    
    // Compute safe X position (shared logic)
    const computedX = computeBottomLeftIndicatorX([versionTextHalfWidth, actionTextHalfWidth]);
    
    // Position is ICON CENTER
    const x = formatNumber(computedX);
    const y = formatNumber(VERSION_ICON_Y);

    // Determine severity for styling
    const severity = hasSettingsAlert ? 'settings' : (hasUpdate ? getUpdateSeverity(version, latestVersion) : 'none');

    // Build classes based on state
    const groupClasses = ['rt-version-indicator', `rt-update-${severity}`];
    if (hasSettingsAlert) {
        groupClasses.push('rt-has-settings-alert');
    } else if (hasUpdate) {
        groupClasses.push('rt-has-update');
    }

    // Hit area covers text and icon
    const hitAreaWidth = Math.max(
        ICON_HITAREA_SIZE + HITAREA_HORIZONTAL_PADDING * 2,
        (maxHalfWidth * 2) + (HITAREA_HORIZONTAL_PADDING * 2)
    );
    const hitAreaHeight = 60;

    const svg = `
        <g id="version-indicator" class="${groupClasses.join(' ')}" transform="translate(${x}, ${y})">
            <!-- Hit area centered on icon -->
            <rect class="rt-version-hitarea"
                x="${formatNumber(-hitAreaWidth / 2)}"
                y="${formatNumber(STATUS_TEXT_ABOVE_ICON - 10)}"
                width="${formatNumber(hitAreaWidth)}"
                height="${hitAreaHeight}"
                rx="6" ry="6"
                fill="white" fill-opacity="0" stroke="none" pointer-events="all">
            </rect>

            <!-- Version text: positioned above icon center -->
            <text class="rt-version-text rt-version-number" x="0" y="${STATUS_TEXT_ABOVE_ICON}" text-anchor="middle" dominant-baseline="baseline">
                ${versionText}
            </text>

            <!-- Action text (visible on hover): same position as version text -->
            <text class="rt-version-text rt-version-action" x="0" y="${STATUS_TEXT_ABOVE_ICON}" text-anchor="middle" dominant-baseline="baseline">
                ${actionText}
            </text>
            
            <!-- Icon: centered at origin. pointer-events="none" so the rect
                 hitarea above is the sole click target — without this, the
                 cursor flickers between pointer (on stroke) and default
                 (between strokes) as it moves across the icon. -->
            <g class="${iconClass}" transform="translate(${STATUS_ICON_CENTER_OFFSET}, ${STATUS_ICON_CENTER_OFFSET})" pointer-events="none">
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round">
                    ${iconContent}
                </svg>
            </g>
        </g>
    `;
    
    return { svg, computedX };
}
