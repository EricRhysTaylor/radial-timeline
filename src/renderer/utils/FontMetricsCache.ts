/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 */

/**
 * FontMetricsCache - One-time measurement of text widths for accurate pre-render sizing.
 * 
 * Instead of using em-based heuristics that may not match actual rendering,
 * this cache measures real text widths once when first needed,
 * then provides accurate estimates for all subsequent renders.
 * 
 * Base sizes are defined in LayoutConstants.ts under READABILITY SCALING section.
 */

import {
    NUMBER_SQUARE_FONT_SIZE_PX,
    NUMBER_SQUARE_PADDING_PX,
    NUMBER_SQUARE_LETTER_SPACING_EM,
    BEAT_LABEL_FONT_SIZE_PX,
    BEAT_LABEL_LETTER_SPACING_EM
} from '../layout/LayoutConstants';

export interface FontMetricsCacheConfig {
    fontFamily: string;
    fontSize: number;
    fontWeight: string | number;
    letterSpacing: string;
    textTransform?: string;
}

interface CachedMetrics {
    charWidths: Map<string, number>;
    avgCharWidth: number;
    spaceWidth: number;
    config: FontMetricsCacheConfig;
}

// Module-level cache - persists across renders
let beatLabelCache: CachedMetrics | null = null;
let numberSquareCache: CachedMetrics | null = null;
let currentFontScale: number = 1;

// Characters to measure for general text (beat labels)
const MEASUREMENT_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 -–—\'".,:;!?&()[]';

/**
 * Lazily initialize the beat label metrics cache.
 * Creates a temporary SVG element, measures characters, then removes it.
 */
export function ensureBeatLabelCache(fontScale: number = 1): void {
    // Skip if already cached at this scale
    if (beatLabelCache && currentFontScale === fontScale) {
        return;
    }

    currentFontScale = fontScale;

    const config: FontMetricsCacheConfig = {
        fontFamily: "var(--font-interface)",
        fontSize: BEAT_LABEL_FONT_SIZE_PX * fontScale,
        fontWeight: 500,
        letterSpacing: `${BEAT_LABEL_LETTER_SPACING_EM}em`,
        textTransform: 'uppercase'
    };

    beatLabelCache = measureWithTemporarySvg(config, MEASUREMENT_CHARS);
}

/**
 * Initialize the number square metrics cache.
 * Always measures at base font size - scaling is applied when retrieving widths.
 */
export function ensureNumberSquareCache(fontScale: number = 1): void {
    // Only need to measure once at base scale
    if (numberSquareCache) {
        return;
    }

    const config: FontMetricsCacheConfig = {
        fontFamily: "var(--font-interface)",
        fontSize: NUMBER_SQUARE_FONT_SIZE_PX,
        fontWeight: 'normal',
        letterSpacing: `${NUMBER_SQUARE_LETTER_SPACING_EM}em`
    };

    numberSquareCache = measureWithTemporarySvg(config, '0123456789.');
}

/**
 * Create a temporary SVG, measure character widths, then remove it.
 * SAFE: inline style used for temporary measurement element that is immediately removed
 */
function measureWithTemporarySvg(config: FontMetricsCacheConfig, chars: string): CachedMetrics {
    // Create temporary SVG container (hidden, used only for measurement)
    const doc = activeDocument;
    const svg = doc.win.createSvg('svg');
    svg.setAttribute('width', '0');
    svg.setAttribute('height', '0');
    svg.classList.add('ert-offscreen-measure');
    doc.body.appendChild(svg);

    // Create measurement text element with dynamic font config
    const text = doc.win.createSvg('text');
    text.style.fontFamily = config.fontFamily; // SAFE: inline style used for dynamic font measurement
    text.style.fontSize = `${config.fontSize}px`; // SAFE: inline style used for dynamic font measurement
    text.style.fontWeight = String(config.fontWeight); // SAFE: inline style used for dynamic font measurement
    text.style.letterSpacing = config.letterSpacing; // SAFE: inline style used for dynamic font measurement
    if (config.textTransform) {
        text.style.textTransform = config.textTransform; // SAFE: inline style used for dynamic font measurement
    }
    svg.appendChild(text);

    const charWidths = new Map<string, number>();
    let totalWidth = 0;
    let charCount = 0;

    // Measure each character
    for (const char of chars) {
        text.textContent = char;
        const width = text.getComputedTextLength();
        charWidths.set(char, width);
        if (char !== ' ') {
            totalWidth += width;
            charCount++;
        }
    }

    // Measure space separately (in case it wasn't in the char set)
    if (!charWidths.has(' ')) {
        text.textContent = ' ';
        const spaceWidth = text.getComputedTextLength();
        charWidths.set(' ', spaceWidth);
    }

    // Clean up
    doc.body.removeChild(svg);

    return {
        charWidths,
        avgCharWidth: charCount > 0 ? totalWidth / charCount : 8,
        spaceWidth: charWidths.get(' ') || 4,
        config
    };
}

/**
 * Estimate text width using cached character measurements.
 * Automatically initializes cache if needed.
 */
export function estimateBeatLabelWidth(title: string, fontPx: number, paddingPx: number): number {
    // Derive scale from requested font size vs base (12px)
    const fontScale = fontPx / 12;
    ensureBeatLabelCache(fontScale);

    if (!beatLabelCache) {
        // Fallback if measurement somehow failed
        return title.length * 8 + paddingPx;
    }

    // Use cached measurements
    const upperTitle = title.toUpperCase(); // Beat labels use text-transform: uppercase
    let width = 0;

    for (const char of upperTitle) {
        const charWidth = beatLabelCache.charWidths.get(char);
        if (charWidth !== undefined) {
            width += charWidth;
        } else {
            // Unknown character - use average
            width += beatLabelCache.avgCharWidth;
        }
    }

    return Math.max(0, width + paddingPx);
}

/**
 * Get number square width using cached measurements.
 * Automatically initializes cache if needed.
 * 
 * The cache measures at base font size (13px), then we scale the result.
 * This ensures consistent proportions across all scale factors.
 */
export function getNumberSquareWidthFromCache(num: string, scale: number = 1): number {
    // Always measure at base scale (1) for consistent character proportions
    ensureNumberSquareCache(1);

    if (!numberSquareCache) {
        // Fallback to old heuristic
        if (num.includes('.')) {
            if (num.length <= 3) return 30 * scale;
            if (num.length <= 4) return 36 * scale;
            return 40 * scale;
        }
        if (num.length === 1) return 20 * scale;
        if (num.length === 2) return 24 * scale;
        return 32 * scale;
    }

    // Use cached measurements (measured at base 13px)
    let width = 0;
    for (const char of num) {
        const charWidth = numberSquareCache.charWidths.get(char);
        if (charWidth !== undefined) {
            width += charWidth;
        } else {
            width += numberSquareCache.avgCharWidth;
        }
    }

    // Add padding, then scale everything
    return (width + NUMBER_SQUARE_PADDING_PX) * scale;
}

/**
 * Clear all caches (call when font settings change).
 */
export function clearFontMetricsCaches(): void {
    beatLabelCache = null;
    numberSquareCache = null;
    currentFontScale = 1;
}
