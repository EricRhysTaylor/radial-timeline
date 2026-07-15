import {
    buildCampaignEmbedPath,
    buildDefaultEmbedPath,
    normalizeAprExportFormat
} from '../utils/aprPaths';
import type {
    AuthorProgressCampaign,
    AuthorProgressDefaults,
    AuthorProgressFrequency,
    AuthorProgressPublishTarget,
    AuthorProgressSettings,
    AprStyleProfile,
    AprStyleSettings,
    AprTrackedStage,
    TeaserRevealSettings
} from '../types/settings';

const AUTHOR_PROGRESS_FREQUENCIES = new Set<AuthorProgressFrequency>(['manual', 'daily', 'weekly', 'monthly']);
const AUTHOR_PROGRESS_PUBLISH_TARGETS = new Set<AuthorProgressPublishTarget>(['folder', 'github_pages', 'note']);

type AprDefaultViewMode = NonNullable<AuthorProgressDefaults['aprDefaultViewMode']>;
const APR_DEFAULT_VIEW_MODES = new Set<AprDefaultViewMode>(['auto', 'ring', 'scenes', 'colors', 'full']);

const APR_TRACKED_STAGES = new Set<AprTrackedStage>(['Zero', 'Author', 'House', 'Press']);

type AprSpokeColorMode = NonNullable<AprStyleSettings['aprSpokeColorMode']>;
// 'dark' is deliberately absent: the original migration checks never accepted it,
// so a saved 'dark' falls through to the caller-provided fallback.
const APR_SPOKE_COLOR_MODES = new Set<AprSpokeColorMode>(['light', 'none', 'custom', 'sync']);

type LegacyAuthorProgressSettings = Record<string, unknown>;

function asRecord(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return null;
    }
    return value as Record<string, unknown>;
}

function asString(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    return trimmed ? trimmed : undefined;
}

function asBoolean(value: unknown, fallback: boolean): boolean {
    return typeof value === 'boolean' ? value : fallback;
}

function asNumber(value: unknown, fallback: number): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function normalizeFrequency(value: unknown, fallback: AuthorProgressFrequency): AuthorProgressFrequency {
    return typeof value === 'string' && AUTHOR_PROGRESS_FREQUENCIES.has(value as AuthorProgressFrequency)
        ? value as AuthorProgressFrequency
        : fallback;
}

function normalizePublishTarget(value: unknown, fallback: AuthorProgressPublishTarget): AuthorProgressPublishTarget {
    return typeof value === 'string' && AUTHOR_PROGRESS_PUBLISH_TARGETS.has(value as AuthorProgressPublishTarget)
        ? value as AuthorProgressPublishTarget
        : fallback;
}

function normalizeAprSize(value: unknown, fallback: AuthorProgressDefaults['aprSize']): AuthorProgressDefaults['aprSize'] {
    // TODO(v7): Remove the 'thumb' → 'small' migration. See docs/engineering/plans/v7-removals.md.
    // Pre-v6 'thumb' (100px) is gone; map to 'small' (150px). Ring-only behavior is
    // preserved by also forcing aprDefaultViewMode='ring' in migrateDefaults below.
    if (value === 'thumb') return 'small';
    if (value === 'small' || value === 'medium' || value === 'large') return value;
    return fallback;
}

/** True when the saved aprSize was the legacy 'thumb' value (pre-v6). */
function isLegacyThumbSize(value: unknown): boolean {
    return value === 'thumb';
}

function normalizeAprDefaultViewMode(
    value: unknown,
    fallback: AuthorProgressDefaults['aprDefaultViewMode']
): AuthorProgressDefaults['aprDefaultViewMode'] {
    // TODO(v7): Remove the 'bar' → 'ring' migration. See docs/engineering/plans/v7-removals.md.
    if (value === 'bar') return 'ring';
    if (typeof value === 'string' && APR_DEFAULT_VIEW_MODES.has(value as AprDefaultViewMode)) {
        return value as AprDefaultViewMode;
    }
    return fallback;
}

function normalizeTrackedStage(value: unknown, fallback: AprTrackedStage = 'Zero'): AprTrackedStage {
    return typeof value === 'string' && APR_TRACKED_STAGES.has(value as AprTrackedStage)
        ? value as AprTrackedStage
        : fallback;
}

function normalizeAprSpokeColorMode(
    value: unknown,
    fallback: AprStyleSettings['aprSpokeColorMode']
): AprStyleSettings['aprSpokeColorMode'] {
    return typeof value === 'string' && APR_SPOKE_COLOR_MODES.has(value as AprSpokeColorMode)
        ? value as AprSpokeColorMode
        : fallback;
}

function normalizeTeaserReveal(value: unknown): TeaserRevealSettings | undefined {
    const record = asRecord(value);
    if (!record) return undefined;
    const customThresholds = asRecord(record.customThresholds);
    const disabledStages = asRecord(record.disabledStages);
    return {
        enabled: asBoolean(record.enabled, false),
        preset: record.preset === 'slow' || record.preset === 'fast' || record.preset === 'custom' ? record.preset : 'standard',
        customThresholds: customThresholds ? {
            scenes: asNumber(customThresholds.scenes, 10),
            colors: asNumber(customThresholds.colors, 30),
            full: asNumber(customThresholds.full, 60)
        } : undefined,
        disabledStages: disabledStages ? {
            scenes: asBoolean(disabledStages.scenes, false) || undefined,
            colors: asBoolean(disabledStages.colors, false) || undefined
        } : undefined
    };
}

export function buildDefaultAuthorProgressDefaults(): AuthorProgressDefaults {
    return {
        noteBehavior: 'preset',
        publishTarget: 'folder',
        showSubplots: true,
        showActs: true,
        showStatus: true,
        showProgressPercent: true,
        aprProgressMode: 'stage',
        aprTrackedStage: 'Zero',
        aprProgressDateStart: undefined,
        aprProgressDateTarget: undefined,
        aprTargetSceneCount: undefined,
        aprSize: 'medium',
        aprDefaultViewMode: 'auto',
        exportFormat: 'png',
        aprBackgroundColor: '#0d0d0f',
        aprCenterTransparent: true,
        aprBookAuthorColor: '#6FB971',
        aprAuthorColor: '#6FB971',
        aprEngineColor: '#e5e5e5',
        aprPercentNumberColor: '#6FB971',
        aprPercentSymbolColor: '#6FB971',
        aprTheme: 'dark',
        aprSpokeColorMode: 'dark',
        aprSpokeColor: '#ffffff',
        aprBookTitleFontFamily: 'Inter',
        aprBookTitleFontWeight: 400,
        aprBookTitleFontItalic: false,
        aprBookTitleFontSize: undefined,
        aprAuthorNameFontFamily: 'Inter',
        aprAuthorNameFontWeight: 400,
        aprAuthorNameFontItalic: false,
        aprAuthorNameFontSize: undefined,
        aprPercentNumberFontSize1Digit: undefined,
        aprPercentNumberFontSize2Digit: undefined,
        aprPercentNumberFontSize3Digit: undefined,
        aprRtBadgeFontFamily: 'Inter',
        aprRtBadgeFontWeight: 700,
        aprRtBadgeFontItalic: false,
        aprRtBadgeFontSize: undefined,
        aprShowRtAttribution: true,
        lastPublishedDate: undefined,
        updateFrequency: 'manual',
        stalenessThresholdDays: 30,
        enableReminders: true,
        exportPath: '',
        autoUpdateExportPath: true
    };
}

export function buildDefaultAuthorProgressSettings(): AuthorProgressSettings {
    return {
        enabled: false,
        defaults: buildDefaultAuthorProgressDefaults(),
        styleProfiles: [],
        designerDraftStyle: undefined,
        designerCampaignId: undefined,
        campaigns: []
    };
}

function captureStyleSettings(defaults: AuthorProgressDefaults): AprStyleSettings {
    return {
        aprBackgroundColor: defaults.aprBackgroundColor,
        aprCenterTransparent: defaults.aprCenterTransparent,
        aprBookAuthorColor: defaults.aprBookAuthorColor,
        aprAuthorColor: defaults.aprAuthorColor,
        aprEngineColor: defaults.aprEngineColor,
        aprPercentNumberColor: defaults.aprPercentNumberColor,
        aprPercentSymbolColor: defaults.aprPercentSymbolColor,
        aprTheme: defaults.aprTheme,
        aprSpokeColorMode: defaults.aprSpokeColorMode,
        aprSpokeColor: defaults.aprSpokeColor,
        aprBookTitleFontFamily: defaults.aprBookTitleFontFamily,
        aprBookTitleFontWeight: defaults.aprBookTitleFontWeight,
        aprBookTitleFontItalic: defaults.aprBookTitleFontItalic,
        aprBookTitleFontSize: defaults.aprBookTitleFontSize,
        aprAuthorNameFontFamily: defaults.aprAuthorNameFontFamily,
        aprAuthorNameFontWeight: defaults.aprAuthorNameFontWeight,
        aprAuthorNameFontItalic: defaults.aprAuthorNameFontItalic,
        aprAuthorNameFontSize: defaults.aprAuthorNameFontSize,
        aprPercentNumberFontSize1Digit: defaults.aprPercentNumberFontSize1Digit,
        aprPercentNumberFontSize2Digit: defaults.aprPercentNumberFontSize2Digit,
        aprPercentNumberFontSize3Digit: defaults.aprPercentNumberFontSize3Digit,
        aprRtBadgeFontFamily: defaults.aprRtBadgeFontFamily,
        aprRtBadgeFontWeight: defaults.aprRtBadgeFontWeight,
        aprRtBadgeFontItalic: defaults.aprRtBadgeFontItalic,
        aprRtBadgeFontSize: defaults.aprRtBadgeFontSize,
        aprShowRtAttribution: defaults.aprShowRtAttribution,
    };
}

function migrateStyleSettings(raw: unknown, defaults: AuthorProgressDefaults): AprStyleSettings {
    const record = asRecord(raw);
    const base = captureStyleSettings(defaults);
    if (!record) return base;
    return {
        ...base,
        aprBackgroundColor: asString(record.aprBackgroundColor) ?? base.aprBackgroundColor,
        aprCenterTransparent: asBoolean(record.aprCenterTransparent, base.aprCenterTransparent ?? true),
        aprBookAuthorColor: asString(record.aprBookAuthorColor) ?? base.aprBookAuthorColor,
        aprAuthorColor: asString(record.aprAuthorColor) ?? base.aprAuthorColor,
        aprEngineColor: asString(record.aprEngineColor) ?? base.aprEngineColor,
        aprPercentNumberColor: asString(record.aprPercentNumberColor) ?? base.aprPercentNumberColor,
        aprPercentSymbolColor: asString(record.aprPercentSymbolColor) ?? base.aprPercentSymbolColor,
        aprTheme: record.aprTheme === 'light' || record.aprTheme === 'none' ? record.aprTheme : base.aprTheme,
        aprSpokeColorMode: normalizeAprSpokeColorMode(record.aprSpokeColorMode, base.aprSpokeColorMode),
        aprSpokeColor: asString(record.aprSpokeColor) ?? base.aprSpokeColor,
        aprBookTitleFontFamily: asString(record.aprBookTitleFontFamily) ?? base.aprBookTitleFontFamily,
        aprBookTitleFontWeight: asNumber(record.aprBookTitleFontWeight, base.aprBookTitleFontWeight ?? 400),
        aprBookTitleFontItalic: asBoolean(record.aprBookTitleFontItalic, base.aprBookTitleFontItalic ?? false),
        aprBookTitleFontSize: typeof record.aprBookTitleFontSize === 'number' ? record.aprBookTitleFontSize : base.aprBookTitleFontSize,
        aprAuthorNameFontFamily: asString(record.aprAuthorNameFontFamily) ?? base.aprAuthorNameFontFamily,
        aprAuthorNameFontWeight: asNumber(record.aprAuthorNameFontWeight, base.aprAuthorNameFontWeight ?? 400),
        aprAuthorNameFontItalic: asBoolean(record.aprAuthorNameFontItalic, base.aprAuthorNameFontItalic ?? false),
        aprAuthorNameFontSize: typeof record.aprAuthorNameFontSize === 'number' ? record.aprAuthorNameFontSize : base.aprAuthorNameFontSize,
        aprPercentNumberFontSize1Digit: typeof record.aprPercentNumberFontSize1Digit === 'number' ? record.aprPercentNumberFontSize1Digit : base.aprPercentNumberFontSize1Digit,
        aprPercentNumberFontSize2Digit: typeof record.aprPercentNumberFontSize2Digit === 'number' ? record.aprPercentNumberFontSize2Digit : base.aprPercentNumberFontSize2Digit,
        aprPercentNumberFontSize3Digit: typeof record.aprPercentNumberFontSize3Digit === 'number' ? record.aprPercentNumberFontSize3Digit : base.aprPercentNumberFontSize3Digit,
        aprRtBadgeFontFamily: asString(record.aprRtBadgeFontFamily) ?? base.aprRtBadgeFontFamily,
        aprRtBadgeFontWeight: asNumber(record.aprRtBadgeFontWeight, base.aprRtBadgeFontWeight ?? 700),
        aprRtBadgeFontItalic: asBoolean(record.aprRtBadgeFontItalic, base.aprRtBadgeFontItalic ?? false),
        aprRtBadgeFontSize: typeof record.aprRtBadgeFontSize === 'number' ? record.aprRtBadgeFontSize : base.aprRtBadgeFontSize,
        aprShowRtAttribution: asBoolean(record.aprShowRtAttribution, base.aprShowRtAttribution ?? true),
    };
}

function migrateStyleProfile(raw: unknown, defaults: AuthorProgressDefaults): AprStyleProfile | null {
    const record = asRecord(raw);
    if (!record) return null;
    const id = asString(record.id);
    const name = asString(record.name);
    if (!id || !name) return null;
    return {
        id,
        name,
        createdAt: asString(record.createdAt) ?? new Date().toISOString(),
        style: migrateStyleSettings(record.style ?? record, defaults),
        aprExportQuality: normalizeAprExportQuality(record.aprExportQuality)
    };
}

function hasLegacyCampaignStyleOverrides(record: Record<string, unknown>): boolean {
    return asString(record.customBackgroundColor) !== undefined
        || typeof record.customTransparent === 'boolean'
        || record.customTheme === 'light'
        || record.customTheme === 'dark';
}

function createLegacyCampaignStyleProfile(
    campaignId: string,
    campaignName: string,
    defaults: AuthorProgressDefaults,
    record: Record<string, unknown>
): AprStyleProfile {
    const style = captureStyleSettings(defaults);
    style.aprBackgroundColor = asString(record.customBackgroundColor) ?? style.aprBackgroundColor;
    style.aprCenterTransparent = typeof record.customTransparent === 'boolean'
        ? record.customTransparent
        : style.aprCenterTransparent;
    style.aprTheme = record.customTheme === 'light' || record.customTheme === 'dark'
        ? record.customTheme
        : style.aprTheme;
    return {
        id: `legacy-style-${campaignId}`,
        name: `${campaignName} Style`,
        createdAt: asString(record.createdAt) ?? new Date().toISOString(),
        style,
        aprExportQuality: normalizeAprExportQuality(record.aprExportQuality)
    };
}

function migrateDefaults(raw: LegacyAuthorProgressSettings | null): AuthorProgressDefaults {
    const defaults = buildDefaultAuthorProgressDefaults();
    if (!raw) return defaults;

    const noteBehavior = raw.noteBehavior === 'custom' || raw.defaultNoteBehavior === 'custom' ? 'custom' : 'preset';
    const updateFrequency = normalizeFrequency(raw.updateFrequency, defaults.updateFrequency);
    const aprSize = normalizeAprSize(raw.aprSize, defaults.aprSize);
    // If migrating from legacy thumb size, force the view mode to 'ring' to preserve the
    // visual outcome (thumb used to imply ring-only rendering).
    // TODO(v7): Remove this thumb-aware fallback. See docs/engineering/plans/v7-removals.md.
    const aprDefaultViewMode = isLegacyThumbSize(raw.aprSize)
        ? 'ring' as const
        : normalizeAprDefaultViewMode(raw.aprDefaultViewMode, defaults.aprDefaultViewMode);
    const exportFormat = normalizeAprExportFormat(raw.exportFormat);

    const rawProgressMode = raw.aprProgressMode;
    const migratedProgressMode = rawProgressMode === 'date'
        ? 'date'
        : rawProgressMode === 'full'
            ? 'full'
            : 'stage';
    const migratedTrackedStage = rawProgressMode === 'zero'
        ? 'Zero'
        : normalizeTrackedStage(raw.aprTrackedStage, defaults.aprTrackedStage ?? 'Zero');

    return {
        ...defaults,
        noteBehavior,
        publishTarget: normalizePublishTarget(raw.publishTarget ?? raw.defaultPublishTarget, defaults.publishTarget),
        customNoteTemplatePath: asString(raw.customNoteTemplatePath),
        showSubplots: asBoolean(raw.showSubplots, defaults.showSubplots),
        showActs: asBoolean(raw.showActs, defaults.showActs),
        showStatus: asBoolean(raw.showStatus, defaults.showStatus),
        showProgressPercent: asBoolean(raw.showProgressPercent, defaults.showProgressPercent ?? true),
        aprProgressMode: migratedProgressMode,
        aprTrackedStage: migratedTrackedStage,
        aprProgressDateStart: asString(raw.aprProgressDateStart),
        aprProgressDateTarget: asString(raw.aprProgressDateTarget),
        aprTargetSceneCount: typeof raw.aprTargetSceneCount === 'number' && raw.aprTargetSceneCount > 0
            ? Math.floor(raw.aprTargetSceneCount)
            : undefined,
        aprSize,
        aprDefaultViewMode,
        exportFormat,
        aprBackgroundColor: asString(raw.aprBackgroundColor) ?? defaults.aprBackgroundColor,
        aprCenterTransparent: asBoolean(raw.aprCenterTransparent, defaults.aprCenterTransparent ?? true),
        aprBookAuthorColor: asString(raw.aprBookAuthorColor) ?? defaults.aprBookAuthorColor,
        aprAuthorColor: asString(raw.aprAuthorColor) ?? defaults.aprAuthorColor,
        aprEngineColor: asString(raw.aprEngineColor) ?? defaults.aprEngineColor,
        aprPercentNumberColor: asString(raw.aprPercentNumberColor) ?? defaults.aprPercentNumberColor,
        aprPercentSymbolColor: asString(raw.aprPercentSymbolColor) ?? defaults.aprPercentSymbolColor,
        aprTheme: raw.aprTheme === 'light' || raw.aprTheme === 'none' ? raw.aprTheme : defaults.aprTheme,
        aprSpokeColorMode: normalizeAprSpokeColorMode(raw.aprSpokeColorMode, defaults.aprSpokeColorMode),
        aprSpokeColor: asString(raw.aprSpokeColor) ?? defaults.aprSpokeColor,
        aprBookTitleFontFamily: asString(raw.aprBookTitleFontFamily) ?? defaults.aprBookTitleFontFamily,
        aprBookTitleFontWeight: asNumber(raw.aprBookTitleFontWeight, defaults.aprBookTitleFontWeight ?? 400),
        aprBookTitleFontItalic: asBoolean(raw.aprBookTitleFontItalic, defaults.aprBookTitleFontItalic ?? false),
        aprBookTitleFontSize: typeof raw.aprBookTitleFontSize === 'number' ? raw.aprBookTitleFontSize : undefined,
        aprAuthorNameFontFamily: asString(raw.aprAuthorNameFontFamily) ?? defaults.aprAuthorNameFontFamily,
        aprAuthorNameFontWeight: asNumber(raw.aprAuthorNameFontWeight, defaults.aprAuthorNameFontWeight ?? 400),
        aprAuthorNameFontItalic: asBoolean(raw.aprAuthorNameFontItalic, defaults.aprAuthorNameFontItalic ?? false),
        aprAuthorNameFontSize: typeof raw.aprAuthorNameFontSize === 'number' ? raw.aprAuthorNameFontSize : undefined,
        aprPercentNumberFontSize1Digit: typeof raw.aprPercentNumberFontSize1Digit === 'number' ? raw.aprPercentNumberFontSize1Digit : undefined,
        aprPercentNumberFontSize2Digit: typeof raw.aprPercentNumberFontSize2Digit === 'number' ? raw.aprPercentNumberFontSize2Digit : undefined,
        aprPercentNumberFontSize3Digit: typeof raw.aprPercentNumberFontSize3Digit === 'number' ? raw.aprPercentNumberFontSize3Digit : undefined,
        aprRtBadgeFontFamily: asString(raw.aprRtBadgeFontFamily) ?? defaults.aprRtBadgeFontFamily,
        aprRtBadgeFontWeight: asNumber(raw.aprRtBadgeFontWeight, defaults.aprRtBadgeFontWeight ?? 700),
        aprRtBadgeFontItalic: asBoolean(raw.aprRtBadgeFontItalic, defaults.aprRtBadgeFontItalic ?? false),
        aprRtBadgeFontSize: typeof raw.aprRtBadgeFontSize === 'number' ? raw.aprRtBadgeFontSize : undefined,
        aprShowRtAttribution: asBoolean(raw.aprShowRtAttribution, defaults.aprShowRtAttribution ?? true),
        authorName: asString(raw.authorName),
        lastPublishedDate: asString(raw.lastPublishedDate),
        updateFrequency,
        stalenessThresholdDays: asNumber(raw.stalenessThresholdDays, defaults.stalenessThresholdDays),
        enableReminders: asBoolean(raw.enableReminders, defaults.enableReminders),
        exportPath: asString(raw.exportPath ?? raw.dynamicEmbedPath) ?? buildDefaultEmbedPath({
            updateFrequency,
            aprExportQuality: normalizeAprExportQuality(raw.aprExportQuality),
            exportFormat
        }),
        autoUpdateExportPath: asBoolean(raw.autoUpdateExportPath ?? raw.autoUpdateEmbedPaths, defaults.autoUpdateExportPath ?? true)
    };
}

function normalizeAprExportQuality(value: unknown): AuthorProgressCampaign['aprExportQuality'] | undefined {
    return value === 'standard' || value === 'ultra' || value === 'print' ? value : undefined;
}

function migrateCampaign(
    raw: unknown,
    defaults: AuthorProgressDefaults
): { campaign: AuthorProgressCampaign; generatedProfile?: AprStyleProfile } | null {
    const record = asRecord(raw);
    if (!record) return null;
    const name = asString(record.name);
    const id = asString(record.id);
    if (!name || !id) return null;

    const updateFrequency = normalizeFrequency(record.updateFrequency, defaults.updateFrequency);
    const aprSize = normalizeAprSize(record.aprSize, defaults.aprSize);
    const exportFormat = normalizeAprExportFormat(record.exportFormat);
    const aprExportQuality = normalizeAprExportQuality(record.aprExportQuality);
    const teaserReveal = normalizeTeaserReveal(record.teaserReveal);
    const hasLegacyStyle = hasLegacyCampaignStyleOverrides(record);
    const explicitStyleSource = record.styleSource === 'profile' || record.styleSource === 'global'
        ? record.styleSource
        : undefined;
    const generatedProfile = hasLegacyStyle && explicitStyleSource !== 'profile'
        ? createLegacyCampaignStyleProfile(id, name, defaults, record)
        : undefined;
    const styleSource = explicitStyleSource ?? (generatedProfile ? 'profile' : 'global');
    const styleProfileId = asString(record.styleProfileId) ?? generatedProfile?.id;

    return {
        campaign: {
            id,
            name,
            description: asString(record.description),
            isActive: asBoolean(record.isActive, true),
            updateFrequency,
            sendToCommunity: asBoolean(record.sendToCommunity, false),
            lastCommunityUploadAttemptAt: asString(record.lastCommunityUploadAttemptAt),
            lastCommunityUploadedAt: asString(record.lastCommunityUploadedAt),
            lastCommunityUploadStatus: record.lastCommunityUploadStatus === 'private' || record.lastCommunityUploadStatus === 'active'
                ? record.lastCommunityUploadStatus
                : undefined,
            lastCommunityUploadError: asString(record.lastCommunityUploadError),
            refreshThresholdDays: asNumber(record.refreshThresholdDays, defaults.stalenessThresholdDays),
            lastPublishedDate: asString(record.lastPublishedDate),
            exportPath: asString(record.exportPath ?? record.embedPath) ?? buildCampaignEmbedPath({
                campaignName: name,
                updateFrequency,
                aprExportQuality,
                teaserEnabled: teaserReveal?.enabled,
                exportFormat
            }),
            exportFormat,
            aprExportQuality,
            targetBookId: asString(record.targetBookId),
            aprSize,
            styleSource,
            styleProfileId,
            teaserReveal
        },
        generatedProfile
    };
}

export function migrateAuthorProgressSettings(raw: unknown): AuthorProgressSettings {
    const record = asRecord(raw);
    if (!record) {
        return buildDefaultAuthorProgressSettings();
    }

    const defaults = migrateDefaults(asRecord(record.defaults) ?? record);
    const migratedProfiles = Array.isArray(record.styleProfiles)
        ? record.styleProfiles
            .map((profile) => migrateStyleProfile(profile, defaults))
            .filter((profile): profile is AprStyleProfile => profile !== null)
        : [];
    const migratedCampaigns = Array.isArray(record.campaigns)
        ? record.campaigns
            .map((campaign) => migrateCampaign(campaign, defaults))
            .filter((campaign): campaign is { campaign: AuthorProgressCampaign; generatedProfile?: AprStyleProfile } => campaign !== null)
        : [];
    const styleProfiles = [...migratedProfiles];
    const seenProfileIds = new Set(styleProfiles.map(profile => profile.id));
    migratedCampaigns.forEach(({ generatedProfile }) => {
        if (!generatedProfile || seenProfileIds.has(generatedProfile.id)) return;
        seenProfileIds.add(generatedProfile.id);
        styleProfiles.push(generatedProfile);
    });
    const campaigns = migratedCampaigns.map(({ campaign }) => campaign);

    return {
        enabled: asBoolean(record.enabled, false),
        defaults,
        styleProfiles,
        designerDraftStyle: record.designerDraftStyle ? migrateStyleSettings(record.designerDraftStyle, defaults) : undefined,
        designerCampaignId: asString(record.designerCampaignId),
        campaigns
    };
}

export function getAuthorProgressDefaults(authorProgress?: AuthorProgressSettings): AuthorProgressDefaults | undefined {
    return authorProgress?.defaults;
}

export function getAuthorProgressCampaigns(authorProgress?: AuthorProgressSettings): AuthorProgressCampaign[] {
    return authorProgress?.campaigns ?? [];
}
