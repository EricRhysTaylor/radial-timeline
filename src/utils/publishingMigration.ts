import { cleanupFormatForOutputFormat, normalizeManuscriptCleanupOptions } from './manuscriptSanitize';
import type {
    BookProfile,
    BookPublishingPreferences,
    ExportProfile,
    ManuscriptExportTemplate,
    ManuscriptSceneHeadingMode,
    RadialTimelineSettings,
    TemplateProfile,
    UsageContext,
} from '../types';

export interface PublishingMigrationResult {
    exportProfiles: ExportProfile[];
    bookPublishingPreferences: BookPublishingPreferences[];
    lastUsedExportProfileId?: string;
    changed: boolean;
}

const PRESET_TO_CONTEXT: Record<'novel' | 'screenplay' | 'podcast', UsageContext> = {
    novel: 'novel',
    screenplay: 'screenplay',
    podcast: 'podcast',
};

const DEFAULT_EXPORT_PROFILE_NAME = 'Export profile';

function isNonEmptyString(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0;
}

function normalizeSceneHeadingMode(value: unknown): ManuscriptSceneHeadingMode | undefined {
    if (value === 'scene-number' || value === 'scene-number-title' || value === 'title-only') return value;
    return undefined;
}

function inferUsageContextFromPreset(preset: ManuscriptExportTemplate['manuscriptPreset']): UsageContext {
    return PRESET_TO_CONTEXT[preset] || 'novel';
}

function inferTemplateProfileId(
    template: ManuscriptExportTemplate,
    layouts: TemplateProfile[],
): string {
    const selectedLayoutId = isNonEmptyString(template.selectedLayoutId)
        ? template.selectedLayoutId.trim()
        : '';
    if (selectedLayoutId && layouts.some(layout => layout.id === selectedLayoutId)) {
        return selectedLayoutId;
    }

    const matchingLayout = layouts.find(layout => layout.usageContexts.includes(inferUsageContextFromPreset(template.manuscriptPreset)));
    if (matchingLayout) {
        return matchingLayout.id;
    }

    return template.id;
}

export function normalizeExportProfile(profile: Partial<ExportProfile>): ExportProfile {
    const usageContext = profile.usageContext || inferUsageContextFromPreset(profile.manuscriptPreset || 'novel');
    const exportType = profile.exportType || (profile.outlinePreset ? 'outline' : 'manuscript');
    const outputFormat = profile.outputFormat || (exportType === 'outline' ? 'markdown' : 'pdf');
    const cleanupFormat = cleanupFormatForOutputFormat(outputFormat);
    const name = isNonEmptyString(profile.name) ? profile.name.trim() : DEFAULT_EXPORT_PROFILE_NAME;
    const templateProfileId = isNonEmptyString(profile.templateProfileId) ? profile.templateProfileId.trim() : (isNonEmptyString(profile.id) ? profile.id.trim() : name);
    const order = profile.order || 'narrative';
    const subplot = isNonEmptyString(profile.subplot) ? profile.subplot.trim() : 'All Subplots';

    return {
        id: isNonEmptyString(profile.id) ? profile.id.trim() : templateProfileId,
        name,
        templateProfileId,
        usageContext,
        outputFormat,
        exportType,
        manuscriptPreset: profile.manuscriptPreset || (usageContext === 'screenplay' ? 'screenplay' : usageContext === 'podcast' ? 'podcast' : 'novel'),
        outlinePreset: profile.outlinePreset,
        tocMode: profile.tocMode || (exportType === 'outline' ? 'none' : 'markdown'),
        includeSceneIdInToc: profile.includeSceneIdInToc,
        includeSceneIdInHeading: profile.includeSceneIdInHeading,
        order,
        subplot,
        includeMatter: profile.includeMatter ?? exportType === 'manuscript',
        includeSynopsis: profile.includeSynopsis ?? exportType === 'outline',
        updateWordCounts: profile.updateWordCounts ?? true,
        saveMarkdownArtifact: profile.saveMarkdownArtifact ?? false,
        cleanup: normalizeManuscriptCleanupOptions(profile.cleanup, cleanupFormat),
        splitMode: profile.splitMode || 'single',
        splitParts: Math.max(1, Math.floor(profile.splitParts || 1)),
        selectionPolicy: profile.selectionPolicy || 'manual-range',
        rangeStart: typeof profile.rangeStart === 'number' && Number.isFinite(profile.rangeStart) && profile.rangeStart >= 1
            ? Math.floor(profile.rangeStart)
            : undefined,
        rangeEnd: typeof profile.rangeEnd === 'number' && Number.isFinite(profile.rangeEnd) && profile.rangeEnd >= 1
            ? Math.floor(profile.rangeEnd)
            : undefined,
    };
}

export function convertLegacyManuscriptExportTemplateToExportProfile(
    template: ManuscriptExportTemplate,
    layouts: TemplateProfile[] = []
): ExportProfile {
    return normalizeExportProfile({
        id: template.id,
        name: template.name,
        templateProfileId: inferTemplateProfileId(template, layouts),
        usageContext: inferUsageContextFromPreset(template.manuscriptPreset),
        outputFormat: template.outputFormat,
        exportType: template.exportType,
        manuscriptPreset: template.manuscriptPreset,
        outlinePreset: template.outlinePreset,
        tocMode: template.tocMode,
        includeSceneIdInToc: template.includeSceneIdInToc,
        includeSceneIdInHeading: template.includeSceneIdInHeading,
        order: template.order,
        subplot: template.subplot,
        includeMatter: template.includeMatter,
        includeSynopsis: template.includeSynopsis,
        updateWordCounts: template.updateWordCounts,
        saveMarkdownArtifact: template.saveMarkdownArtifact,
        cleanup: template.exportCleanup,
        splitMode: template.splitMode,
        splitParts: template.splitParts,
        selectionPolicy: template.exportType === 'outline' ? 'manual-range' : 'manual-range',
    });
}

export function convertExportProfileToLegacyManuscriptExportTemplate(
    profile: ExportProfile,
    options?: { createdAt?: string }
): ManuscriptExportTemplate {
    const normalized = normalizeExportProfile(profile);
    return {
        id: normalized.id,
        name: normalized.name,
        createdAt: options?.createdAt || new Date().toISOString(),
        exportType: normalized.exportType,
        manuscriptPreset: normalized.manuscriptPreset || 'novel',
        outlinePreset: normalized.outlinePreset || 'beat-sheet',
        outputFormat: normalized.outputFormat,
        tocMode: normalized.tocMode || 'none',
        includeSceneIdInToc: normalized.includeSceneIdInToc,
        includeSceneIdInHeading: normalized.includeSceneIdInHeading,
        sceneHeadingMode: normalizeSceneHeadingMode((profile as { sceneHeadingMode?: ManuscriptSceneHeadingMode }).sceneHeadingMode),
        order: normalized.order || 'narrative',
        subplot: normalized.subplot || 'All Subplots',
        updateWordCounts: normalized.updateWordCounts,
        includeSynopsis: normalized.includeSynopsis,
        includeMatter: normalized.includeMatter,
        saveMarkdownArtifact: normalized.saveMarkdownArtifact,
        exportCleanup: normalized.cleanup,
        splitMode: normalized.splitMode,
        splitParts: normalized.splitParts,
        selectedLayoutId: normalized.templateProfileId || undefined,
    };
}

export function normalizeBookPublishingPreferences(preferences: Partial<BookPublishingPreferences> | undefined): BookPublishingPreferences | null {
    if (!preferences || !isNonEmptyString(preferences.bookId)) return null;
    const bookId = preferences.bookId.trim();
    const preferredTemplateProfileIdByContext = preferences.preferredTemplateProfileIdByContext
        ? Object.fromEntries(
            Object.entries(preferences.preferredTemplateProfileIdByContext).flatMap(([key, value]) => {
                if (!isNonEmptyString(value)) return [];
                return [[key, value.trim()]];
            })
        ) as BookPublishingPreferences['preferredTemplateProfileIdByContext']
        : undefined;

    const profileOverrides = preferences.profileOverrides
        ? Object.fromEntries(
            Object.entries(preferences.profileOverrides).flatMap(([key, value]) => {
                if (!value) return [];
                const normalized = {
                    ...(value.sceneHeadingMode ? { sceneHeadingMode: normalizeSceneHeadingMode(value.sceneHeadingMode) } : {}),
                    ...(Array.isArray(value.actEpigraphs) ? { actEpigraphs: value.actEpigraphs.filter(isNonEmptyString).map(item => item.trim()) } : {}),
                    ...(Array.isArray(value.actEpigraphAttributions) ? { actEpigraphAttributions: value.actEpigraphAttributions.filter(isNonEmptyString).map(item => item.trim()) } : {}),
                };
                if (!normalized.sceneHeadingMode && !normalized.actEpigraphs && !normalized.actEpigraphAttributions) return [];
                return [[key, normalized]];
            })
        ) as BookPublishingPreferences['profileOverrides']
        : undefined;

    return {
        bookId,
        ...(isNonEmptyString(preferences.defaultExportProfileId) ? { defaultExportProfileId: preferences.defaultExportProfileId.trim() } : {}),
        ...(isNonEmptyString(preferences.lastUsedExportProfileId) ? { lastUsedExportProfileId: preferences.lastUsedExportProfileId.trim() } : {}),
        ...(preferences.lastUsedExportProfileSnapshot ? { lastUsedExportProfileSnapshot: normalizeExportProfile(preferences.lastUsedExportProfileSnapshot) } : {}),
        ...(preferredTemplateProfileIdByContext && Object.keys(preferredTemplateProfileIdByContext).length > 0
            ? { preferredTemplateProfileIdByContext }
            : {}),
        ...(profileOverrides && Object.keys(profileOverrides).length > 0 ? { profileOverrides } : {}),
    };
}

export function deriveBookPublishingPreferences(
    book: BookProfile,
    exportProfiles: ExportProfile[] = [],
    activeExportProfileId?: string
): BookPublishingPreferences | null {
    const lastUsed = book.lastUsedPandocLayoutByPreset || {};
    const preferredTemplateProfileIdByContext: Partial<Record<UsageContext, string>> = {};
    let defaultExportProfileId = activeExportProfileId && exportProfiles.some(profile => profile.id === activeExportProfileId)
        ? activeExportProfileId
        : undefined;

    (['novel', 'screenplay', 'podcast'] as const).forEach((preset) => {
        const layoutId = lastUsed[preset];
        if (!isNonEmptyString(layoutId)) return;
        preferredTemplateProfileIdByContext[PRESET_TO_CONTEXT[preset]] = layoutId.trim();
        if (!defaultExportProfileId) {
            const matchingExportProfile = exportProfiles.find(profile => profile.usageContext === PRESET_TO_CONTEXT[preset] && profile.templateProfileId === layoutId.trim());
            if (matchingExportProfile) {
                defaultExportProfileId = matchingExportProfile.id;
            }
        }
    });

    if (!defaultExportProfileId && Object.keys(preferredTemplateProfileIdByContext).length === 0) {
        return null;
    }

    return normalizeBookPublishingPreferences({
        bookId: book.id,
        defaultExportProfileId,
        preferredTemplateProfileIdByContext,
    });
}

export function migratePublishingModelState(settings: Pick<RadialTimelineSettings, 'books' | 'activeBookId' | 'exportProfiles' | 'bookPublishingPreferences' | 'manuscriptExportTemplates' | 'lastUsedManuscriptExportTemplateId' | 'lastUsedExportProfileId'>, layouts: TemplateProfile[] = []): PublishingMigrationResult {
    const legacyTemplates = Array.isArray(settings.manuscriptExportTemplates) ? settings.manuscriptExportTemplates : [];
    const existingExportProfiles = Array.isArray(settings.exportProfiles) ? settings.exportProfiles : [];
    const existingBookPublishingPreferences = Array.isArray(settings.bookPublishingPreferences)
        ? settings.bookPublishingPreferences.map(normalizeBookPublishingPreferences).filter((entry): entry is BookPublishingPreferences => !!entry)
        : [];
    const exportProfiles = legacyTemplates.length > 0
        ? legacyTemplates.map(template => convertLegacyManuscriptExportTemplateToExportProfile(template, layouts))
        : existingExportProfiles.map(profile => normalizeExportProfile(profile));

    const bookPrefsById = new Map(existingBookPublishingPreferences.map(entry => [entry.bookId, entry]));
    (Array.isArray(settings.books) ? settings.books : []).forEach(book => {
        const derived = deriveBookPublishingPreferences(book, exportProfiles, settings.lastUsedExportProfileId);
        if (!derived) return;
        const existing = bookPrefsById.get(derived.bookId);
        bookPrefsById.set(derived.bookId, existing ? {
            ...existing,
            ...derived,
            preferredTemplateProfileIdByContext: {
                ...(existing.preferredTemplateProfileIdByContext || {}),
                ...(derived.preferredTemplateProfileIdByContext || {}),
            },
            profileOverrides: {
                ...(existing.profileOverrides || {}),
                ...(derived.profileOverrides || {}),
            },
        } : derived);
    });
    const bookPublishingPreferences = Array.from(bookPrefsById.values());

    const activeBookId = settings.activeBookId && Array.isArray(settings.books) && settings.books.some(book => book.id === settings.activeBookId)
        ? settings.activeBookId
        : undefined;
    const lastUsedExportProfileId = settings.lastUsedExportProfileId
        || (settings.lastUsedManuscriptExportTemplateId
            ? exportProfiles.find(profile => profile.id === settings.lastUsedManuscriptExportTemplateId)?.id
            : undefined);

    return {
        exportProfiles,
        bookPublishingPreferences: bookPublishingPreferences.map(preferences => {
            if (!activeBookId || preferences.bookId !== activeBookId || !lastUsedExportProfileId) return preferences;
            return {
                ...preferences,
                lastUsedExportProfileId,
            };
        }),
        lastUsedExportProfileId,
        changed:
            legacyTemplates.length > 0
            || existingExportProfiles.length > 0
            || existingBookPublishingPreferences.length > 0
            || bookPublishingPreferences.length > 0
            || !!settings.lastUsedManuscriptExportTemplateId
            || !!settings.lastUsedExportProfileId,
    };
}
