import type { PandocLayoutTemplate, TemplateKind, TemplateTier, ValidationIssue } from '../types';

export const BASIC_MANUSCRIPT_LAYOUT_ID = 'bundled-fiction-classic-manuscript';
export const CONTEMPORARY_LITERARY_LAYOUT_ID = 'bundled-fiction-contemporary-literary';

export const TEMPLATE_ACCESS_FALLBACK_MESSAGE = 'The saved PDF style is a Pro style. This export will use Basic instead.';
export const TEMPLATE_ACCESS_LOCKED_MESSAGE = 'The selected PDF style is a Pro style, and no Core fallback is available.';

export interface TemplateAccessResolution {
    requestedLayout?: PandocLayoutTemplate;
    effectiveLayout?: PandocLayoutTemplate;
    fallbackLayout?: PandocLayoutTemplate;
    tier?: TemplateTier;
    usedFallback: boolean;
    issues: ValidationIssue[];
}

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

export function isPandocLayoutAccessible(layout: PandocLayoutTemplate, hasProAccess: boolean): boolean {
    return hasProAccess || getPandocLayoutTier(layout) === 'free';
}

export function findBasicManuscriptFallback(layouts: PandocLayoutTemplate[], preset: PandocLayoutTemplate['preset'] = 'novel'): PandocLayoutTemplate | undefined {
    if (preset !== 'novel') return undefined;
    return layouts.find(layout => layout.id === BASIC_MANUSCRIPT_LAYOUT_ID && getPandocLayoutTier(layout) === 'free')
        || layouts.find(layout => layout.preset === 'novel' && getPandocLayoutTier(layout) === 'free');
}

function buildIssue(level: ValidationIssue['level'], code: string, message: string, field?: string): ValidationIssue {
    return {
        level,
        code,
        message,
        scope: 'export',
        actionable: level !== 'info',
        ...(field ? { field } : {}),
    };
}

export function resolveTemplateAccess(params: {
    layouts: PandocLayoutTemplate[];
    selectedLayoutId?: string;
    manuscriptPreset?: PandocLayoutTemplate['preset'];
    hasProAccess: boolean;
}): TemplateAccessResolution {
    const requestedLayout = params.selectedLayoutId
        ? params.layouts.find(layout => layout.id === params.selectedLayoutId)
        : [...params.layouts]
            .filter(layout => layout.preset === (params.manuscriptPreset || 'novel'))
            .sort((a, b) => getPandocLayoutSortRank(a) - getPandocLayoutSortRank(b) || a.name.localeCompare(b.name))
            .find(layout => params.hasProAccess || getPandocLayoutTier(layout) === 'free')
            || params.layouts.find(layout => layout.preset === (params.manuscriptPreset || 'novel'));
    if (!requestedLayout) {
        return { usedFallback: false, issues: [] };
    }

    const tier = getPandocLayoutTier(requestedLayout);
    if (isPandocLayoutAccessible(requestedLayout, params.hasProAccess)) {
        return {
            requestedLayout,
            effectiveLayout: requestedLayout,
            tier,
            usedFallback: false,
            issues: [
                buildIssue(
                    'info',
                    tier === 'free' ? 'template_access_core_included' : 'template_access_requires_pro',
                    tier === 'free' ? 'Included with Core.' : 'Pro workflow.',
                    requestedLayout.id
                ),
            ],
        };
    }

    const fallbackLayout = findBasicManuscriptFallback(params.layouts, requestedLayout.preset);
    if (fallbackLayout) {
        return {
            requestedLayout,
            effectiveLayout: fallbackLayout,
            fallbackLayout,
            tier,
            usedFallback: true,
            issues: [
                buildIssue('warning', 'template_access_fallback_to_basic', TEMPLATE_ACCESS_FALLBACK_MESSAGE, requestedLayout.id),
                buildIssue('info', 'template_access_core_included', 'Included with Core.', fallbackLayout.id),
            ],
        };
    }

    return {
        requestedLayout,
        tier,
        usedFallback: false,
        issues: [
            buildIssue('error', 'template_access_locked_no_fallback', TEMPLATE_ACCESS_LOCKED_MESSAGE, requestedLayout.id),
            buildIssue('info', 'template_access_requires_pro', 'Pro workflow.', requestedLayout.id),
        ],
    };
}
