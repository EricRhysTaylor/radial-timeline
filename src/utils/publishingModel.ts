import type {
    BookMetaFieldKey,
    OutputIntent,
    PandocLayoutTemplate,
    ProfileOrigin,
    TemplateAsset,
    TemplateCapability,
    TemplateProfile,
    TemplateSource,
    UsageContext,
} from '../types';
import { getPandocLayoutKind, getPandocLayoutRecommendedUse, getPandocLayoutTier } from '../publishing/templateTiering';

const SUPPORTED_MATTER_ROLES = [
    'title-page',
    'copyright',
    'dedication',
    'epigraph',
    'acknowledgments',
    'about-author',
    'foreword',
    'afterword',
    'appendix',
];

const CAPABILITY_LABELS: Record<TemplateCapability['key'], string> = {
    sceneHeadingMode: 'Scene heading controls',
    partEpigraphs: 'Part epigraphs',
    modernClassicStructure: 'Modern classic structure',
    semanticMatter: 'Semantic matter support',
};

/**
 * Per-usage-context guidance string. Adding a new UsageContext member forces
 * a compile-time error here until a guidance entry is supplied.
 */
const PROFILE_GUIDANCE_BY_USAGE_CONTEXT: Record<UsageContext, string> = {
    novel: 'Pairs with the current Pandoc + LaTeX pipeline and the existing matter workflow.',
    screenplay: 'Uses the current Pandoc + LaTeX pipeline without changing the export engine.',
    podcast: 'Uses the current Pandoc + LaTeX pipeline without changing the export engine.',
};

export interface AdaptedPublishingModel {
    assets: TemplateAsset[];
    profiles: TemplateProfile[];
}

function getTemplateSource(layout: PandocLayoutTemplate): TemplateSource {
    if (layout.bundled) return 'bundled';
    if (/^\s*https?:\/\//i.test(layout.path)) return 'imported';
    return 'vault';
}

function getProfileOrigin(layout: PandocLayoutTemplate): ProfileOrigin {
    if (layout.origin) return layout.origin;
    return layout.bundled ? 'built-in' : 'legacy-custom';
}

function getOutputIntent(layout: PandocLayoutTemplate): OutputIntent {
    if (layout.preset === 'screenplay') return 'screenplay-pdf';
    if (layout.preset === 'podcast') return 'podcast-script';

    const fingerprint = `${layout.id} ${layout.name} ${layout.description || ''}`.toLowerCase();
    if (fingerprint.includes('basic manuscript') || fingerprint.includes('classic manuscript')) {
        return 'submission-manuscript';
    }
    return 'print-book';
}

function getStyleKey(layout: PandocLayoutTemplate): string {
    const fingerprint = `${layout.id} ${layout.name} ${layout.path}`.toLowerCase();
    if (fingerprint.includes('signature') && fingerprint.includes('literary')) return 'signature-literary';
    if (fingerprint.includes('modern') && fingerprint.includes('classic')) return 'modern-classic';
    if (fingerprint.includes('contemporary') && fingerprint.includes('literary')) return 'contemporary-literary';
    if (fingerprint.includes('basic manuscript') || fingerprint.includes('classic manuscript')) return 'basic-manuscript';
    if (layout.preset === 'screenplay') return 'screenplay-standard';
    if (layout.preset === 'podcast') return 'podcast-script';
    return `${layout.preset}-custom`;
}

// Descriptions are authored on the layout (bundled templates in pandocBundledLayouts.ts;
// copies inherit at duplicate time; imports set their own). No category-level fallback.
function getSummary(layout: PandocLayoutTemplate): string {
    return layout.description?.trim() || '';
}

function getCapabilities(layout: PandocLayoutTemplate): TemplateCapability[] {
    const capabilities: TemplateCapability[] = [];
    const add = (key: TemplateCapability['key']) => {
        if (!capabilities.some(item => item.key === key)) {
            capabilities.push({ key, label: CAPABILITY_LABELS[key] });
        }
    };

    // Scene heading controls are exposed when EITHER the layout flag is set
    // (legacy hand-coded templates) OR the layout's DesignedStyleSpec
    // declares opener heading modes (spec-driven path). The spec is the
    // source of truth for designed templates.
    const specHasOpenerHeadingModes = layout.designedSpec?.scene.openerHeadingModes
        && layout.designedSpec.scene.openerHeadingModes.length > 0;
    if (layout.hasSceneOpenerHeadingOptions || specHasOpenerHeadingModes) add('sceneHeadingMode');
    if (layout.hasEpigraphs) add('partEpigraphs');
    if (layout.usesModernClassicStructure) add('modernClassicStructure');
    if (layout.preset === 'novel') add('semanticMatter');

    return capabilities;
}

function getRecommendedBookMetaFields(layout: PandocLayoutTemplate, capabilities: TemplateCapability[]): BookMetaFieldKey[] {
    const fields: BookMetaFieldKey[] = ['Book.title', 'Book.author'];
    if (capabilities.some(item => item.key === 'semanticMatter')) {
        fields.push('Rights.year', 'Rights.copyright_holder', 'Publisher.name', 'Identifiers.isbn_paperback');
    }
    return fields;
}

function getRequiredBookMetaFields(layout: PandocLayoutTemplate, capabilities: TemplateCapability[]): BookMetaFieldKey[] {
    if (layout.preset !== 'novel') return [];
    if (!capabilities.some(item => item.key === 'semanticMatter')) return [];
    return ['Book.title', 'Book.author'];
}

function getSupportedMatterRoles(layout: PandocLayoutTemplate): string[] {
    if (layout.preset !== 'novel') return [];
    return [...SUPPORTED_MATTER_ROLES];
}

function deriveProfileStatus(layout: PandocLayoutTemplate): TemplateProfile['status'] {
    const trimmedPath = layout.path?.trim() || '';
    if (layout.draft) return 'draft';
    if (!trimmedPath) return 'invalid';
    return 'ready';
}

export function adaptPandocLayoutToTemplateAsset(layout: PandocLayoutTemplate): TemplateAsset {
    return {
        id: `${layout.id}::asset`,
        source: getTemplateSource(layout),
        engine: 'pandoc-latex',
        path: layout.path,
        bundled: layout.bundled,
        installed: !!layout.path?.trim(),
    };
}

export function adaptPandocLayoutToTemplateProfile(layout: PandocLayoutTemplate): TemplateProfile {
    const outputIntent = getOutputIntent(layout);
    const capabilities = getCapabilities(layout);
    const description = getSummary(layout);
    return {
        id: layout.id,
        assetId: `${layout.id}::asset`,
        legacyLayoutId: layout.id,
        origin: getProfileOrigin(layout),
        name: layout.name,
        description,
        usageContexts: [layout.preset],
        outputIntent,
        tier: getPandocLayoutTier(layout),
        templateKind: getPandocLayoutKind(layout),
        recommendedUse: getPandocLayoutRecommendedUse(layout),
        styleKey: getStyleKey(layout),
        summary: description,
        guidance: PROFILE_GUIDANCE_BY_USAGE_CONTEXT[layout.preset],
        previewMode: 'static',
        capabilities,
        requiredBookMetaFields: getRequiredBookMetaFields(layout, capabilities),
        recommendedBookMetaFields: getRecommendedBookMetaFields(layout, capabilities),
        supportedMatterRoles: getSupportedMatterRoles(layout),
        status: deriveProfileStatus(layout),
    };
}

export function adaptPandocLayoutsToPublishingModel(layouts: PandocLayoutTemplate[] | undefined): AdaptedPublishingModel {
    const normalized = Array.isArray(layouts) ? layouts : [];
    return {
        assets: normalized.map(adaptPandocLayoutToTemplateAsset),
        profiles: normalized.map(adaptPandocLayoutToTemplateProfile),
    };
}
