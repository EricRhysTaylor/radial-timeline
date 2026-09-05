/**
 * APR presets - minimal definitions for derived layout.
 *
 * Preview sizes (small/medium/large) control the settings preview.
 * Export quality (standard/ultra/print) controls the actual published output.
 * All exports render at high resolution regardless of preview size.
 *
 * Note: The legacy 'thumb' (100px) preview size was removed in v6.x. Ring-only rendering
 * is now controlled by `aprDefaultViewMode === 'ring'`, independent of size.
 */

export type AprSize = 'small' | 'medium' | 'large';

export type AprExportQuality = 'standard' | 'ultra' | 'print';

export type AprPresetKey = 'sm150' | 'md300' | 'lg450';

export type AprPreset = {
    key: AprPresetKey;
    outerPx: number;
    innerRadiusPx?: number;
    enableText: boolean;
    enableCenterLabel: boolean;
    density?: number;
};

// Note: `density` is intentionally omitted on standard presets. The aprLayout formula
// (patternScale = outerPx / 600) derives a consistent per-cell pattern density across
// previews and exports. Override `density` only for one-off custom presets.
export const APR_PRESETS: Record<AprPresetKey, AprPreset> = {
    sm150: {
        key: 'sm150',
        outerPx: 150,
        enableText: true,
        enableCenterLabel: true,
    },
    md300: {
        key: 'md300',
        outerPx: 300,
        enableText: true,
        enableCenterLabel: true,
    },
    lg450: {
        key: 'lg450',
        outerPx: 450,
        enableText: true,
        enableCenterLabel: true,
    },
} as const;

export const APR_SIZE_TO_PRESET: Record<AprSize, AprPresetKey> = {
    small: 'sm150',
    medium: 'md300',
    large: 'lg450',
};

/** Export quality → output pixel dimensions. */
export const APR_EXPORT_PX: Record<AprExportQuality, number> = {
    standard: 1200,
    ultra: 2400,
    print: 4800,
};

export function getAprPreset(sizeOrKey: AprSize | AprPresetKey): AprPreset {
    const key = (sizeOrKey in APR_SIZE_TO_PRESET)
        ? APR_SIZE_TO_PRESET[sizeOrKey as AprSize]
        : (sizeOrKey as AprPresetKey);
    return APR_PRESETS[key];
}

/**
 * Build an export preset from a design intent and export quality.
 * Preview sizes control the design features (text, labels, density).
 * Export quality controls the output resolution.
 */
export function getExportPreset(_designSize: AprSize, quality: AprExportQuality): AprPreset {
    const exportPx = APR_EXPORT_PX[quality];
    return {
        key: 'lg450',
        outerPx: exportPx,
        enableText: true,
        enableCenterLabel: true,
        // Pattern density derived from outerPx in aprLayout — no override needed.
    };
}
