import type { ManuscriptOrder } from './manuscript';
import type { ManuscriptPreset, OutlinePreset } from './exportFormats';
import type {
    ExportProfile,
    ManuscriptExportCleanupOptions,
    ManuscriptExportTemplate,
    TemplateProfile,
} from '../types';
import {
    convertExportProfileToLegacyManuscriptExportTemplate,
    convertLegacyManuscriptExportTemplateToExportProfile,
    normalizeExportProfile,
} from './publishingMigration';
export { adaptPandocLayoutsToPublishingModel } from './publishingModel';

export interface ModalExportProfile extends ExportProfile {
    order: ManuscriptOrder;
    subplot: string;
    selectedLayoutId?: string;
    createdAt?: string;
}

function resolveTemplateProfileId(
    selectedLayoutId: string | undefined,
    usageContext: ManuscriptPreset,
    templateProfiles: TemplateProfile[]
): string {
    const direct = selectedLayoutId?.trim();
    if (direct && templateProfiles.some(profile => profile.id === direct)) {
        return direct;
    }

    const byContext = templateProfiles.find(profile => profile.usageContexts.includes(usageContext));
    if (byContext) return byContext.id;

    return templateProfiles[0]?.id || direct || '';
}

function getSelectionPolicy(outputFormat: ExportProfile['outputFormat'], exportType: ExportProfile['exportType']): ExportProfile['selectionPolicy'] {
    return exportType === 'manuscript' && outputFormat === 'pdf'
        ? 'full-book'
        : 'manual-range';
}

export function buildModalExportProfile(
    profile: ExportProfile,
    templateProfiles: TemplateProfile[]
): ModalExportProfile {
    const normalized = normalizeExportProfile(profile);
    const templateProfileId = resolveTemplateProfileId(normalized.templateProfileId, normalized.usageContext, templateProfiles);
    return {
        ...normalized,
        templateProfileId,
        order: normalized.order || 'narrative',
        subplot: normalized.subplot || 'All Subplots',
        selectedLayoutId: templateProfileId,
    };
}

export function buildModalExportProfileFromLegacyTemplate(
    template: ManuscriptExportTemplate,
    templateProfiles: TemplateProfile[]
): ModalExportProfile {
    const exportProfile = convertLegacyManuscriptExportTemplateToExportProfile(template, templateProfiles);
    return {
        ...buildModalExportProfile(exportProfile, templateProfiles),
        createdAt: template.createdAt,
        selectedLayoutId: template.selectedLayoutId || exportProfile.templateProfileId,
    };
}

export function buildPersistedExportProfileFromModalExportProfile(profile: ModalExportProfile): ExportProfile {
    return normalizeExportProfile({
        ...profile,
        templateProfileId: profile.templateProfileId || profile.selectedLayoutId || '',
        manuscriptPreset: profile.usageContext,
        order: profile.order,
        subplot: profile.subplot,
    });
}

export function buildLegacyTemplateFromModalExportProfile(
    profile: ModalExportProfile,
    params: {
        order: ManuscriptOrder;
        subplot: string;
        selectedLayoutId?: string;
        createdAt?: string;
    }
): ManuscriptExportTemplate {
    const persisted = buildPersistedExportProfileFromModalExportProfile({
        ...profile,
        order: params.order,
        subplot: params.subplot,
        selectedLayoutId: params.selectedLayoutId || profile.selectedLayoutId,
    });
    const legacy = convertExportProfileToLegacyManuscriptExportTemplate(persisted);
    return {
        ...legacy,
        createdAt: params.createdAt || profile.createdAt || legacy.createdAt,
        selectedLayoutId: params.selectedLayoutId || profile.selectedLayoutId || legacy.selectedLayoutId,
    };
}

export function buildTransientModalExportProfile(params: {
    id?: string;
    name: string;
    usageContext: ManuscriptPreset;
    exportType: ExportProfile['exportType'];
    outputFormat: ExportProfile['outputFormat'];
    order: ManuscriptOrder;
    subplot: string;
    outlinePreset: OutlinePreset;
    tocMode: ExportProfile['tocMode'];
    includeSceneIdInToc?: boolean;
    includeSceneIdInHeading?: boolean;
    includeMatter: boolean;
    includeSynopsis: boolean;
    updateWordCounts: boolean;
    saveMarkdownArtifact: boolean;
    cleanup: ManuscriptExportCleanupOptions;
    splitMode: 'single' | 'parts';
    splitParts: number;
    selectedLayoutId?: string;
    templateProfiles: TemplateProfile[];
    rangeStart?: number;
    rangeEnd?: number;
}): ModalExportProfile {
    const templateProfileId = resolveTemplateProfileId(params.selectedLayoutId, params.usageContext, params.templateProfiles);
    return buildModalExportProfile({
        id: params.id || `${Date.now()}`,
        name: params.name,
        templateProfileId,
        usageContext: params.usageContext,
        outputFormat: params.outputFormat,
        exportType: params.exportType,
        manuscriptPreset: params.usageContext,
        outlinePreset: params.outlinePreset,
        tocMode: params.tocMode,
        includeSceneIdInToc: params.includeSceneIdInToc,
        includeSceneIdInHeading: params.includeSceneIdInHeading,
        order: params.order,
        subplot: params.subplot,
        includeMatter: params.includeMatter,
        includeSynopsis: params.includeSynopsis,
        updateWordCounts: params.updateWordCounts,
        saveMarkdownArtifact: params.saveMarkdownArtifact,
        cleanup: params.cleanup,
        splitMode: params.splitMode,
        splitParts: params.splitParts,
        selectionPolicy: getSelectionPolicy(params.outputFormat, params.exportType),
        rangeStart: params.rangeStart,
        rangeEnd: params.rangeEnd,
    }, params.templateProfiles);
}

export function getModalExportProfileSummary(
    profile: ModalExportProfile | undefined,
    templateProfiles: TemplateProfile[]
): string {
    if (!profile) return 'No export profile selected.';
    const templateProfile = templateProfiles.find(item => item.id === profile.templateProfileId);
    const templateName = templateProfile?.name || 'Unknown template';
    return `${profile.name} · ${templateName} · ${profile.usageContext}`;
}
