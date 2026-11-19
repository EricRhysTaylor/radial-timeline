import type { PandocLayoutTemplate, TemplateKind, TemplateTier } from '../types';

export const BASIC_MANUSCRIPT_LAYOUT_ID = 'bundled-fiction-classic-manuscript';
export const CONTEMPORARY_LITERARY_LAYOUT_ID = 'bundled-fiction-contemporary-literary';

export function getPandocLayoutTier(layout: Pick<PandocLayoutTemplate, 'id' | 'preset' | 'bundled' | 'tier' | 'origin'>): TemplateTier {
    // Designed styles are always Pro; this check wins over name/id heuristics so a generated
    // .tex file that happens to mention "classic" or similar tokens stays on the Pro side.
    if (layout.origin === 'designed') return 'pro';
    if (layout.tier === 'free' || layout.tier === 'pro') return layout.tier;
    if (layout.preset === 'screenplay' || layout.preset === 'podcast') return 'pro';
    if (layout.bundled && (layout.id === BASIC_MANUSCRIPT_LAYOUT_ID || layout.id === CONTEMPORARY_LITERARY_LAYOUT_ID)) {
        return 'free';
    }
    return 'pro';
}

export function getPandocLayoutKind(layout: Pick<PandocLayoutTemplate, 'preset' | 'bundled' | 'origin' | 'templateKind'>): TemplateKind {
    if (layout.templateKind) return layout.templateKind;
    if (!layout.bundled || layout.origin === 'imported') return 'custom';
    if (layout.preset === 'screenplay') return 'screenplay';
    if (layout.preset === 'podcast') return 'podcast';
    return 'book';
}

export function getPandocLayoutRecommendedUse(layout: Pick<PandocLayoutTemplate, 'id' | 'recommendedUse'>): string | undefined {
    if (layout.recommendedUse?.trim()) return layout.recommendedUse.trim();
    return undefined;
}

/**
 * Two-letter abbreviation for a layout, used in exported PDF filenames so the
 * template that produced a given file is visible at a glance.
 *
 * Mapping:
 *   - Basic         → "BA"
 *   - Standard      → "ST"
 *   - Professional  → "PR"
 *   - Signature     → "SG"
 *   - Designed (origin: 'designed') → "DS"
 *   - Anything else (imported / custom / unknown) → "CT"
 */
export function getLayoutAbbreviation(
    layout: Pick<PandocLayoutTemplate, 'id' | 'origin'> | undefined | null
): string {
    if (!layout) return 'CT';
    switch (layout.id) {
        case BASIC_MANUSCRIPT_LAYOUT_ID: return 'BA';
        case CONTEMPORARY_LITERARY_LAYOUT_ID: return 'ST';
        case 'bundled-fiction-signature-literary': return 'PR';
        case 'bundled-fiction-modern-classic': return 'SG';
    }
    if (layout.origin === 'designed') return 'DS';
    return 'CT';
}

export function getPandocLayoutSortRank(layout: Pick<PandocLayoutTemplate, 'id' | 'preset' | 'name' | 'bundled' | 'tier' | 'origin'>): number {
    if (layout.id === BASIC_MANUSCRIPT_LAYOUT_ID) return 10;
    if (layout.id === CONTEMPORARY_LITERARY_LAYOUT_ID) return 20;
    if (layout.id === 'bundled-fiction-signature-literary') return 30;
    if (layout.id === 'bundled-fiction-modern-classic') return 40;
    // Designed styles slot between bundled-pro and custom/imported.
    if (layout.origin === 'designed') return 45;
    if (layout.preset === 'screenplay') return 50;
    if (layout.preset === 'podcast') return 60;
    return getPandocLayoutTier(layout) === 'free' ? 70 : 80;
}

/** The first PDF style for a preset in display order: the one used when none is chosen. */
export function defaultLayoutForPreset(layouts: PandocLayoutTemplate[], preset: PandocLayoutTemplate['preset']): PandocLayoutTemplate | undefined {
    return layouts
        .filter(layout => layout.preset === preset)
        .sort((a, b) => getPandocLayoutSortRank(a) - getPandocLayoutSortRank(b) || a.name.localeCompare(b.name))[0];
}
