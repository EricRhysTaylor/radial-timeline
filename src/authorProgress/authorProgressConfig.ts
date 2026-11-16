/**
 * Social / authorProgress settings: the shipped defaults and the one seam where
 * saved data is read.
 *
 * Schema 2 has a single shape. The Default report is the first entry in
 * `campaigns` (id `default`), every report names a saved style, and the style
 * with id `default` always exists. Schema 1 kept the Default report, and the
 * "manual" colors and fonts it was drawn with, loose inside `defaults`;
 * `migrateAuthorProgressSettings` folds that into a report and a style.
 */
import { DEFAULT_REPORT_ID, normalizeAprExportFormat } from '../utils/aprPaths';
import type {
    AprExportFormat,
    AprExportQuality,
    AuthorProgressCampaign,
    AuthorProgressDefaults,
    AuthorProgressFrequency,
    AuthorProgressSettings,
    AprStyleProfile,
    AprStyleSettings,
    AprTrackedStage,
    TeaserRevealLevel,
    TeaserRevealSettings
} from '../types/settings';

/** Id of the style every vault has. It cannot be deleted. */
export const DEFAULT_STYLE_ID = 'default';

const AUTHOR_PROGRESS_FREQUENCIES = new Set<AuthorProgressFrequency>(['manual', 'daily', 'weekly', 'monthly']);
const APR_VIEW_MODES = new Set<TeaserRevealLevel>(['ring', 'scenes', 'colors', 'full']);
const APR_TRACKED_STAGES = new Set<AprTrackedStage>(['Zero', 'Author', 'House', 'Press']);

type AprSpokeColorMode = NonNullable<AprStyleSettings['aprSpokeColorMode']>;
// 'dark' is deliberately absent: the original migration checks never accepted it,
// so a saved 'dark' falls through to the caller-provided fallback.
const APR_SPOKE_COLOR_MODES = new Set<AprSpokeColorMode>(['light', 'none', 'custom', 'sync']);

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

function asOptionalNumber(value: unknown, fallback: number | undefined): number | undefined {
    return typeof value === 'number' ? value : fallback;
}

function normalizeFrequency(value: unknown): AuthorProgressFrequency {
    return typeof value === 'string' && AUTHOR_PROGRESS_FREQUENCIES.has(value as AuthorProgressFrequency)
        ? value as AuthorProgressFrequency
        : 'manual';
}

function normalizeViewMode(value: unknown): TeaserRevealLevel {
    return typeof value === 'string' && APR_VIEW_MODES.has(value as TeaserRevealLevel)
        ? value as TeaserRevealLevel
        : 'full';
}

function normalizeTrackedStage(value: unknown): AprTrackedStage {
    return typeof value === 'string' && APR_TRACKED_STAGES.has(value as AprTrackedStage)
        ? value as AprTrackedStage
        : 'Zero';
}

function normalizeAprSpokeColorMode(
    value: unknown,
    fallback: AprStyleSettings['aprSpokeColorMode']
): AprStyleSettings['aprSpokeColorMode'] {
    return typeof value === 'string' && APR_SPOKE_COLOR_MODES.has(value as AprSpokeColorMode)
        ? value as AprSpokeColorMode
        : fallback;
}

function normalizeAprExportQuality(value: unknown): AprExportQuality | undefined {
    return value === 'standard' || value === 'ultra' || value === 'print' ? value : undefined;
}

/** A saved format, or the extension of a schema 1 export path. */
function normalizeFormat(format: unknown, legacyPath: unknown): AprExportFormat {
    if (asString(format)) return normalizeAprExportFormat(format);
    return asString(legacyPath)?.toLowerCase().endsWith('.svg') ? 'svg' : 'png';
}

function normalizeTeaserReveal(value: unknown): TeaserRevealSettings {
    const record = asRecord(value);
    // A report that never chose a teaser draws the full view.
    if (!record) return { enabled: false, preset: 'standard' };
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
        aprProgressMode: 'stage',
        aprTrackedStage: 'Zero',
        aprProgressDateStart: undefined,
        aprProgressDateTarget: undefined,
        aprTargetSceneCount: undefined
    };
}

/** The colors and fonts a new vault starts with. */
export function buildDefaultAprStyle(): AprStyleSettings {
    return {
        aprBackgroundColor: '#0d0d0f',
        aprCenterTransparent: true,
        aprBookAuthorColor: '#6FB971',
        aprAuthorColor: '#6FB971',
        aprEngineColor: '#e5e5e5',
        aprPercentNumberColor: '#6FB971',
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
        aprShowRtAttribution: true
    };
}

function buildDefaultStyleProfile(style: AprStyleSettings): AprStyleProfile {
    return { id: DEFAULT_STYLE_ID, name: 'Default', createdAt: new Date().toISOString(), style };
}

function buildDefaultReport(): AuthorProgressCampaign {
    return {
        id: DEFAULT_REPORT_ID,
        name: 'Default',
        isActive: true,
        updateFrequency: 'manual',
        refreshThresholdDays: 30,
        exportFormat: 'png',
        aprExportQuality: 'standard',
        styleProfileId: DEFAULT_STYLE_ID,
        teaserReveal: { enabled: false, preset: 'standard' },
        viewMode: 'full'
    };
}

/** A campaign the author adds: teaser reveal on, drawn with the Default style until they pick another. */
export function buildNewCampaign(name: string, reminderDays: number): AuthorProgressCampaign {
    return {
        ...buildDefaultReport(),
        id: `campaign-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
        name,
        refreshThresholdDays: reminderDays,
        teaserReveal: { enabled: true, preset: 'standard' }
    };
}

export function buildDefaultAuthorProgressSettings(): AuthorProgressSettings {
    return {
        schemaVersion: 2,
        defaults: buildDefaultAuthorProgressDefaults(),
        styleProfiles: [buildDefaultStyleProfile(buildDefaultAprStyle())],
        campaigns: [buildDefaultReport()]
    };
}

function migrateStyleSettings(raw: unknown, base: AprStyleSettings): AprStyleSettings {
    const record = asRecord(raw);
    if (!record) return { ...base };
    return {
        aprBackgroundColor: asString(record.aprBackgroundColor) ?? base.aprBackgroundColor,
        aprCenterTransparent: asBoolean(record.aprCenterTransparent, base.aprCenterTransparent ?? true),
        aprBookAuthorColor: asString(record.aprBookAuthorColor) ?? base.aprBookAuthorColor,
        aprAuthorColor: asString(record.aprAuthorColor) ?? base.aprAuthorColor,
        aprEngineColor: asString(record.aprEngineColor) ?? base.aprEngineColor,
        aprPercentNumberColor: asString(record.aprPercentNumberColor) ?? base.aprPercentNumberColor,
        aprTheme: record.aprTheme === 'light' || record.aprTheme === 'none' || record.aprTheme === 'dark' ? record.aprTheme : base.aprTheme,
        aprSpokeColorMode: normalizeAprSpokeColorMode(record.aprSpokeColorMode, base.aprSpokeColorMode),
        aprSpokeColor: asString(record.aprSpokeColor) ?? base.aprSpokeColor,
        aprBookTitleFontFamily: asString(record.aprBookTitleFontFamily) ?? base.aprBookTitleFontFamily,
        aprBookTitleFontWeight: asNumber(record.aprBookTitleFontWeight, base.aprBookTitleFontWeight ?? 400),
        aprBookTitleFontItalic: asBoolean(record.aprBookTitleFontItalic, base.aprBookTitleFontItalic ?? false),
        aprBookTitleFontSize: asOptionalNumber(record.aprBookTitleFontSize, base.aprBookTitleFontSize),
        aprAuthorNameFontFamily: asString(record.aprAuthorNameFontFamily) ?? base.aprAuthorNameFontFamily,
        aprAuthorNameFontWeight: asNumber(record.aprAuthorNameFontWeight, base.aprAuthorNameFontWeight ?? 400),
        aprAuthorNameFontItalic: asBoolean(record.aprAuthorNameFontItalic, base.aprAuthorNameFontItalic ?? false),
        aprAuthorNameFontSize: asOptionalNumber(record.aprAuthorNameFontSize, base.aprAuthorNameFontSize),
        aprPercentNumberFontSize1Digit: asOptionalNumber(record.aprPercentNumberFontSize1Digit, base.aprPercentNumberFontSize1Digit),
        aprPercentNumberFontSize2Digit: asOptionalNumber(record.aprPercentNumberFontSize2Digit, base.aprPercentNumberFontSize2Digit),
        aprPercentNumberFontSize3Digit: asOptionalNumber(record.aprPercentNumberFontSize3Digit, base.aprPercentNumberFontSize3Digit),
        aprRtBadgeFontFamily: asString(record.aprRtBadgeFontFamily) ?? base.aprRtBadgeFontFamily,
        aprRtBadgeFontWeight: asNumber(record.aprRtBadgeFontWeight, base.aprRtBadgeFontWeight ?? 700),
        aprRtBadgeFontItalic: asBoolean(record.aprRtBadgeFontItalic, base.aprRtBadgeFontItalic ?? false),
        aprRtBadgeFontSize: asOptionalNumber(record.aprRtBadgeFontSize, base.aprRtBadgeFontSize),
        aprShowRtAttribution: asBoolean(record.aprShowRtAttribution, base.aprShowRtAttribution ?? true),
    };
}

function migrateStyleProfile(raw: unknown, base: AprStyleSettings): AprStyleProfile | null {
    const record = asRecord(raw);
    if (!record) return null;
    const id = asString(record.id);
    const name = asString(record.name);
    if (!id || !name) return null;
    return {
        id,
        name,
        createdAt: asString(record.createdAt) ?? new Date().toISOString(),
        style: migrateStyleSettings(record.style ?? record, base)
    };
}

/**
 * Schema 1 campaigns older than saved styles carried their own background,
 * transparency and theme. Those become a style of their own.
 */
function buildLegacyCampaignStyle(
    campaignId: string,
    campaignName: string,
    base: AprStyleSettings,
    record: Record<string, unknown>
): AprStyleProfile | undefined {
    const background = asString(record.customBackgroundColor);
    const transparent = typeof record.customTransparent === 'boolean' ? record.customTransparent : undefined;
    const theme = record.customTheme === 'light' || record.customTheme === 'dark' ? record.customTheme : undefined;
    if (background === undefined && transparent === undefined && theme === undefined) return undefined;
    return {
        id: `legacy-style-${campaignId}`,
        name: `${campaignName} Style`,
        createdAt: asString(record.createdAt) ?? new Date().toISOString(),
        style: {
            ...base,
            aprBackgroundColor: background ?? base.aprBackgroundColor,
            aprCenterTransparent: transparent ?? base.aprCenterTransparent,
            aprTheme: theme ?? base.aprTheme
        }
    };
}

function migrateSharedDefaults(raw: Record<string, unknown>): AuthorProgressDefaults {
    const rawProgressMode = raw.aprProgressMode;
    const customPresets = Array.isArray(raw.aprCustomBgPresets)
        ? raw.aprCustomBgPresets
            .map(asRecord)
            .map(preset => ({ label: asString(preset?.label), color: asString(preset?.color) }))
            .filter((preset): preset is { label: string; color: string } => !!preset.label && !!preset.color)
        : undefined;
    return {
        aprProgressMode: rawProgressMode === 'date' ? 'date' : rawProgressMode === 'full' ? 'full' : 'stage',
        // Schema 0 named the Zero stage as a progress mode of its own.
        aprTrackedStage: rawProgressMode === 'zero' ? 'Zero' : normalizeTrackedStage(raw.aprTrackedStage),
        aprProgressDateStart: asString(raw.aprProgressDateStart),
        aprProgressDateTarget: asString(raw.aprProgressDateTarget),
        aprTargetSceneCount: typeof raw.aprTargetSceneCount === 'number' && raw.aprTargetSceneCount > 0
            ? Math.floor(raw.aprTargetSceneCount)
            : undefined,
        aprStylingExpanded: typeof raw.aprStylingExpanded === 'boolean' ? raw.aprStylingExpanded : undefined,
        aprCustomBgPresets: customPresets,
        authorName: asString(raw.authorName)
    };
}

/** What a schema 1 report inherited from the loose Default settings. */
interface LegacyInheritance {
    quality: AprExportQuality;
    viewMode: TeaserRevealLevel;
    staleDays: number;
}

function migrateReport(
    record: Record<string, unknown>,
    id: string,
    name: string,
    styleProfileId: string,
    inherited: LegacyInheritance
): AuthorProgressCampaign {
    return {
        id,
        name,
        isActive: asBoolean(record.isActive, true),
        updateFrequency: normalizeFrequency(record.updateFrequency),
        refreshThresholdDays: asNumber(record.refreshThresholdDays, inherited.staleDays),
        lastPublishedDate: asString(record.lastPublishedDate),
        sendToCommunity: asBoolean(record.sendToCommunity, false),
        lastCommunityUploadAttemptAt: asString(record.lastCommunityUploadAttemptAt),
        lastCommunityUploadedAt: asString(record.lastCommunityUploadedAt),
        lastCommunityUploadStatus: record.lastCommunityUploadStatus === 'private' || record.lastCommunityUploadStatus === 'active'
            ? record.lastCommunityUploadStatus
            : undefined,
        lastCommunityUploadError: asString(record.lastCommunityUploadError),
        exportFormat: normalizeFormat(record.exportFormat, record.exportPath ?? record.embedPath),
        aprExportQuality: normalizeAprExportQuality(record.aprExportQuality) ?? inherited.quality,
        targetBookId: asString(record.targetBookId),
        styleProfileId,
        teaserReveal: normalizeTeaserReveal(record.teaserReveal),
        viewMode: record.viewMode === undefined ? inherited.viewMode : normalizeViewMode(record.viewMode)
    };
}

/**
 * Read saved Social settings of any age into schema 2.
 *
 * For schema 1 this builds the Default report from the loose Default settings,
 * saves the "manual" colors and fonts as the style named Default, and points
 * every campaign that borrowed them at that style. A style left open and
 * unsaved in the old designer is not carried over.
 */
export function migrateAuthorProgressSettings(raw: unknown): AuthorProgressSettings {
    const record = asRecord(raw);
    if (!record) {
        return buildDefaultAuthorProgressSettings();
    }

    const isLegacy = record.schemaVersion !== 2;
    // Schema 1 nests the shared settings under `defaults`; the first releases kept them flat.
    const sharedRecord = asRecord(record.defaults) ?? record;
    const defaults = migrateSharedDefaults(sharedRecord);

    // The style that incomplete saved styles are filled from: the shipped one,
    // or for schema 1 the colors and fonts the Default report was drawn with.
    const baseStyle = isLegacy
        ? migrateStyleSettings(sharedRecord, buildDefaultAprStyle())
        : buildDefaultAprStyle();

    const styleProfiles = (Array.isArray(record.styleProfiles) ? record.styleProfiles : [])
        .map(profile => migrateStyleProfile(profile, baseStyle))
        .filter((profile): profile is AprStyleProfile => profile !== null);
    if (!styleProfiles.some(profile => profile.id === DEFAULT_STYLE_ID)) {
        styleProfiles.unshift(buildDefaultStyleProfile(baseStyle));
    }

    const inherited: LegacyInheritance = {
        quality: normalizeAprExportQuality(sharedRecord.aprExportQuality) ?? 'standard',
        viewMode: normalizeViewMode(sharedRecord.aprDefaultViewMode),
        staleDays: asNumber(sharedRecord.stalenessThresholdDays, 30)
    };

    const campaigns: AuthorProgressCampaign[] = [];
    for (const rawCampaign of Array.isArray(record.campaigns) ? record.campaigns : []) {
        const campaignRecord = asRecord(rawCampaign);
        const id = asString(campaignRecord?.id);
        const name = asString(campaignRecord?.name);
        if (!campaignRecord || !id || !name) continue;

        // A report keeps the saved style it names. One that names none borrowed
        // the manual style (or, before saved styles, carried its own overrides).
        let savedStyle = styleProfiles.find(profile => profile.id === asString(campaignRecord.styleProfileId));
        if (isLegacy && !savedStyle) {
            const legacyStyle = buildLegacyCampaignStyle(id, name, baseStyle, campaignRecord);
            savedStyle = styleProfiles.find(profile => profile.id === legacyStyle?.id) ?? legacyStyle;
            if (savedStyle && savedStyle === legacyStyle) styleProfiles.push(legacyStyle);
        }
        campaigns.push(migrateReport(campaignRecord, id, name, savedStyle ? savedStyle.id : DEFAULT_STYLE_ID, inherited));
    }

    if (!campaigns.some(campaign => campaign.id === DEFAULT_REPORT_ID)) {
        // Schema 1: the Default report's own settings sat beside the shared ones.
        const defaultReport = isLegacy
            ? migrateReport(
                { ...sharedRecord, refreshThresholdDays: sharedRecord.stalenessThresholdDays, isActive: true },
                DEFAULT_REPORT_ID,
                'Default',
                DEFAULT_STYLE_ID,
                inherited
            )
            : buildDefaultReport();
        campaigns.unshift({ ...defaultReport, sendToCommunity: false, targetBookId: undefined });
    }

    return { schemaVersion: 2, defaults, styleProfiles, campaigns };
}
