import type { InquiryScope, InquiryZone } from '../inquiry/state';
import type { AiSettingsV1, AIRoleTemplate } from '../ai/types';
import type { DesignedStyleSpec } from '../publishing/designedStyle';

export type AiContextTemplate = AIRoleTemplate;

export interface BookDesignerSceneAssignment {
    sceneNumber: number;
    act: number;
    subplotIndex: number;
}

export interface BookDesignerTemplate {
    id: string;
    name: string;
    templateType: 'base' | 'advanced';
    createdAt: string;
    scenesToGenerate: number;
    targetRangeMax: number;
    timeIncrement: string;
    selectedActs: number[];
    subplots: string[];
    characters: string[];
    generateBeats: boolean;
    assignments: BookDesignerSceneAssignment[];
    targetBookId?: string;
    targetPath?: string;
}

export type ManuscriptSceneHeadingMode = 'scene-number' | 'scene-number-title' | 'title-only';
export type UsageContext = 'novel' | 'screenplay' | 'podcast';
/**
 * Closed enumeration of book-meta fields that profiles may declare as
 * required/recommended. Adding a new field forces an exhaustive case in
 * `collectMissingBookMetaFields` (compile-time error via assertNever).
 */
export type BookMetaFieldKey =
    | 'Book.title'
    | 'Book.author'
    | 'Rights.year'
    | 'Rights.copyright_holder'
    | 'Publisher.name'
    | 'Identifiers.isbn_paperback';
export type OutputIntent = 'print-book' | 'submission-manuscript' | 'screenplay-pdf' | 'podcast-script' | 'epub' | 'web';
export type TemplateSource = 'bundled' | 'vault' | 'imported';
export type ValidationLevel = 'info' | 'warning' | 'error';
export type ProfileOrigin = 'built-in' | 'duplicated' | 'imported' | 'legacy-custom' | 'designed';
export type HealthState = 'ready' | 'warning' | 'blocked';

export interface ManuscriptExportCleanupOptions {
    stripComments: boolean;
    // Editorialist author queries (%%ai: …%%) are a distinct comment category:
    // the generic stripComments pass spares them so they survive an export bound
    // for AI review. They are removed only when stripAiComments is on.
    stripAiComments: boolean;
    stripLinks: boolean;
    stripCallouts: boolean;
    stripBlockIds: boolean;
}

export interface ManuscriptExportTemplate {
    id: string;
    name: string;
    createdAt: string;
    exportType: 'manuscript' | 'outline';
    manuscriptPreset: 'novel' | 'screenplay' | 'podcast';
    outlinePreset: 'beat-sheet' | 'episode-rundown' | 'shooting-schedule' | 'index-cards-csv' | 'index-cards-json';
    outputFormat: 'markdown' | 'pdf' | 'docx' | 'csv' | 'json';
    tocMode: 'markdown' | 'plain' | 'none';
    /** Append each scene's SceneId to its TOC entry. Useful when sending exports to AI reviewers. */
    includeSceneIdInToc?: boolean;
    /** Append each scene's SceneId to its body heading. Useful when AI may crop the TOC out of context. */
    includeSceneIdInHeading?: boolean;
    sceneHeadingMode?: ManuscriptSceneHeadingMode;
    order: 'narrative' | 'chronological' | 'reverse-narrative' | 'reverse-chronological';
    subplot: string;
    updateWordCounts: boolean;
    includeSynopsis: boolean;
    includeMatter: boolean;
    saveMarkdownArtifact: boolean;
    exportCleanup: ManuscriptExportCleanupOptions;
    splitMode: 'single' | 'parts';
    splitParts: number;
    selectedLayoutId?: string;
}

export interface ValidationIssue {
    code: string;
    level: ValidationLevel;
    message: string;
    detail?: string;
    scope: 'asset' | 'profile' | 'book-meta' | 'matter' | 'export';
    field?: string;
    actionable?: boolean;
}

export interface ValidationSummary {
    state: HealthState;
    errorCount: number;
    warningCount: number;
    topMessage?: string;
}

export interface ImportedTemplateDetectionSummary {
    styleHint: 'manuscript' | 'book' | 'literary' | 'chaptered' | 'custom';
    mockPreviewKind: 'manuscript' | 'book' | 'literary' | 'chaptered' | 'generic';
    traits: string[];
    confidence: 'low' | 'medium' | 'high';
}

export interface TemplateAsset {
    id: string;
    source: TemplateSource;
    engine: 'pandoc-latex';
    path: string;
    bundled?: boolean;
    checksum?: string;
    installed: boolean;
}

export interface TemplateCapability {
    key: 'sceneHeadingMode' | 'actEpigraphs' | 'modernClassicStructure' | 'semanticMatter';
    label: string;
}

export type TemplateTier = 'free' | 'pro';
export type TemplateKind = 'book' | 'screenplay' | 'podcast' | 'custom';

export interface TemplateProfile {
    id: string;
    assetId: string;
    legacyLayoutId: string;
    origin: ProfileOrigin;
    name: string;
    description: string;
    usageContexts: UsageContext[];
    outputIntent: OutputIntent;
    tier: TemplateTier;
    templateKind: TemplateKind;
    recommendedUse?: string;
    styleKey: string;
    summary: string;
    guidance?: string;
    previewMode: 'static' | 'generated';
    capabilities: TemplateCapability[];
    requiredBookMetaFields: BookMetaFieldKey[];
    recommendedBookMetaFields: BookMetaFieldKey[];
    supportedMatterRoles: string[];
    status: 'ready' | 'draft' | 'invalid';
}

export interface ExportProfile {
    id: string;
    name: string;
    templateProfileId: string;
    usageContext: UsageContext;
    outputFormat: 'pdf' | 'markdown' | 'docx' | 'csv' | 'json';
    exportType: 'manuscript' | 'outline';
    manuscriptPreset?: 'novel' | 'screenplay' | 'podcast';
    outlinePreset?: 'beat-sheet' | 'episode-rundown' | 'shooting-schedule' | 'index-cards-csv' | 'index-cards-json';
    tocMode?: 'markdown' | 'plain' | 'none';
    /** Append each scene's SceneId to its TOC entry. */
    includeSceneIdInToc?: boolean;
    /** Append each scene's SceneId to its body heading. */
    includeSceneIdInHeading?: boolean;
    order?: 'narrative' | 'chronological' | 'reverse-narrative' | 'reverse-chronological';
    subplot?: string;
    includeMatter: boolean;
    includeSynopsis: boolean;
    updateWordCounts: boolean;
    saveMarkdownArtifact: boolean;
    cleanup: ManuscriptExportCleanupOptions;
    splitMode: 'single' | 'parts';
    splitParts: number;
    selectionPolicy: 'full-book' | 'manual-range';
    /** 1-based scene range start (inclusive). Restored on next modal open; clamped to current scene count. */
    rangeStart?: number;
    /** 1-based scene range end (inclusive). Restored on next modal open; clamped to current scene count. */
    rangeEnd?: number;
}

export interface BookPublishingPreferences {
    bookId: string;
    defaultExportProfileId?: string;
    lastUsedExportProfileId?: string;
    /** Snapshot of modal state from the last close, including ad-hoc tweaks made on top of any selected preset. */
    lastUsedExportProfileSnapshot?: ExportProfile;
    preferredTemplateProfileIdByContext?: Partial<Record<UsageContext, string>>;
    profileOverrides?: Record<string, {
        sceneHeadingMode?: ManuscriptSceneHeadingMode;
        actEpigraphs?: string[];
        actEpigraphAttributions?: string[];
    }>;
}

export interface PublishingValidationSnapshot {
    assetIssues: Record<string, ValidationIssue[]>;
    profileIssues: Record<string, ValidationIssue[]>;
    exportProfileIssues: Record<string, ValidationIssue[]>;
    activeBookMetaIssues: ValidationIssue[];
    matterIssues: ValidationIssue[];
    preflightIssues: ValidationIssue[];
    templateAccessIssues: ValidationIssue[];
    templateAccess?: {
        requestedTemplateName: string;
        requestedTemplateId: string;
        effectiveTemplateName: string;
        effectiveTemplateId: string;
        tier: TemplateTier;
        usedFallback: boolean;
    };
    templateCompatibilityIssues: ValidationIssue[];
    templateCompatibility?: {
        templateName: string;
        templateId: string;
        level: 'invalid' | 'legacy' | 'compatible';
        variables: {
            hasBody: boolean;
            hasTitle: boolean;
            hasAuthor: boolean;
            hooks: Record<string, boolean>;
        };
        declaredCapabilities: string[];
        detectedCapabilities: string[];
    };
}

export interface BeatSystemConfig {
    beatYamlAdvanced: string;
    beatHoverMetadataFields: HoverMetadataField[];
}

export interface BeatDefinition {
    name: string;
    act: number;
    purpose?: string;
    id?: string;
    range?: string;
}

export interface SavedBeatSystem {
    id: string;
    name: string;
    description?: string;
    beats: BeatDefinition[];
    createdAt: string;
}

export type BeatSourceKind = 'builtin' | 'starter' | 'saved' | 'blank' | 'detected';

export type BeatLibraryCategory = 'narrative' | 'engine' | 'format' | 'saved' | 'blank';

export interface BeatLibraryItem {
    id: string;
    kind: BeatSourceKind;
    category: BeatLibraryCategory;
    icon?: string;
    name: string;
    description?: string;
    beats: BeatDefinition[];
    config: BeatSystemConfig;
    linkedSavedSystemId?: string;
}

export interface LoadedBeatTab {
    tabId: string;
    sourceKind: BeatSourceKind;
    sourceId?: string;
    name: string;
    description?: string;
    beats: BeatDefinition[];
    config: BeatSystemConfig;
    linkedSavedSystemId?: string;
    dirty: boolean;
}

export interface BeatWorkspaceState {
    loadedTabIds: string[];
    tabsById: Record<string, LoadedBeatTab>;
    activeTabId?: string;
}

export type GlobalPovMode = 'off' | 'first' | 'second' | 'third' | 'omni' | 'objective';
export type ReadabilityScale = 'normal' | 'large';
export type RuntimeContentType = 'novel' | 'screenplay' | 'audiobook';
export type ChronologueCalendarDefault = 'earth' | 'planetary' | 'remember';
export type ChronologueCalendarView = 'earth' | 'planetary';
export type PlanetaryTimeConversionDirection = 'earth-to-planet' | 'planet-to-earth';
export type PovMarkerLabel = '0' | '1' | '2' | '3';

export interface RuntimeRateProfile {
    id: string;
    label: string;
    contentType: RuntimeContentType;
    dialogueWpm: number;
    actionWpm: number;
    narrationWpm: number;
    beatSeconds: number;
    pauseSeconds: number;
    longPauseSeconds: number;
    momentSeconds: number;
    silenceSeconds: number;
    sessionPlanning?: {
        draftingWpm?: number;
        recordingWpm?: number;
        editingWpm?: number;
        dailyMinutes?: number;
        dailyWords?: number;
    };
}

export type WritingSessionMode = 'drafting' | 'revising' | 'editing' | 'planning';
export type WritingSessionStage = 'Zero' | 'Author' | 'House' | 'Press' | 'Mixed';
export type WritingSessionStagePreference = WritingSessionStage | 'auto';
export type WritingSessionTargetMode = 'time' | 'words' | 'both';

export interface WritingSessionDefaults {
    defaultMode: WritingSessionMode;
    defaultStage?: WritingSessionStagePreference;
    targetMode?: WritingSessionTargetMode;
    weeklyGoalDays?: number;
    writingStatsOpen?: boolean;
    /**
     * When true, a session the author has begun pauses, resumes, and finalizes
     * itself based on real editing activity (typing, cursor moves, scrolling,
     * scene switches) instead of the author driving the pause button. Auto-track
     * never starts a session — the author always presses play. The buttons
     * remain a manual override.
     */
    autoTrack?: boolean;
    /**
     * Auto-track: gap (ms) with no activity after which a running session is
     * paused, freezing elapsed time at the last activity. Resumes silently on
     * the next activity. Default 2 minutes.
     */
    idleTimeoutMs?: number;
    /**
     * Remembered default for the per-save "post to community feed" toggle in
     * the completion modal. Only meaningful at the top sharing level with an
     * active Community Share connection; the author still sees and can flip
     * the toggle at every save. Default OFF (sharing is opt-in at every layer).
     */
    postSessionsToFeed?: boolean;
}

export interface ActiveWritingSession {
    id: string;
    bookId?: string;
    bookTitle?: string;
    mode: WritingSessionMode;
    stage?: WritingSessionStage;
    stagePreference?: WritingSessionStagePreference;
    startedAt: string;
    lastResumedAt: string;
    pausedAt?: string;
    elapsedMsBeforePause: number;
    goalMinutes?: number;
    /**
     * Total elapsed milliseconds at the start of the current countdown sprint.
     * Allows a completed countdown to continue as the same saved session while
     * restarting the visible countdown interval.
     */
    countdownSegmentStartElapsedMs?: number;
    /**
     * Heartbeat timestamp written while the session is actively running. Used
     * to detect sessions abandoned by an app crash/quit: if the gap since the
     * last heartbeat exceeds the stale threshold, elapsed time is frozen at
     * this point instead of counting the dead time.
     */
    lastSeenAt?: string;
    /**
     * Auto-track: ISO timestamp of the last *real* writing activity (keystroke,
     * cursor move, scroll, or scene switch while focused on a scene). Distinct
     * from `lastSeenAt`, which is the crash heartbeat that ticks every second
     * regardless of activity. Drives idle auto-pause/finalize.
     */
    lastActivityAt?: string;
    /**
     * True when the session is currently paused by idle auto-detection — it
     * resumes silently on the next activity. Distinguishes an idle pause from a
     * manual pause (the author's explicit hold), which auto-track never touches.
     */
    idleAuto?: boolean;
    targetMode?: WritingSessionTargetMode;
    goalWords?: number;
    typedWords?: number;
    wordSnapshot?: {
        startedWords: number;
        paths: string[];
    };
    /**
     * Per-scene attribution accumulated during the session: active milliseconds
     * and typed words, keyed by scene path. A memory aid surfaced at save time —
     * the active-ms values sum to roughly the session elapsed. PRIVATE (contains
     * scene paths); never emitted to non-private audiences.
     */
    sceneActivity?: Record<string, SceneActivityTotals>;
    /**
     * Scene path currently credited the in-progress activity window. The gap to
     * the next activity is attributed here, then this advances to the
     * newly-focused scene. Transient; not part of the saved record.
     */
    currentScenePath?: string;
}

export interface SceneActivityTotals {
    activeMs: number;
    typedWords: number;
}

export interface WritingSessionRecord {
    id: string;
    bookId?: string;
    bookTitle?: string;
    mode: WritingSessionMode;
    stage?: WritingSessionStage;
    stagePreference?: WritingSessionStagePreference;
    startedAt: string;
    endedAt: string;
    /**
     * Local writing day credited by stats. Defaults to the session start day
     * for recovered/stale sessions while `endedAt` remains the actual save time.
     */
    sessionDate?: string;
    elapsedMs: number;
    wordsAdded?: number;
    typedWords?: number;
    netWordDelta?: number;
    scenesCompleted?: number;
    /** Vault paths of scenes touched during the session. PRIVATE — never emitted to non-private audiences. */
    scenePaths?: string[];
    /**
     * Vault paths of scenes that transitioned to Complete during the session.
     * PRIVATE — never emitted to non-private audiences. Captured at stop()
     * time so completion attribution is durable on the record even if the
     * scene's stage later moves.
     */
    scenesCompletedPaths?: string[];
    pagesEdited?: number;
    note?: string;
    source: 'timer' | 'manual';
    /**
     * Per-scene time + typed-word breakdown for the session. PRIVATE — contains
     * scene paths; never emitted to non-private audiences. Day views aggregate
     * these across the day's records.
     */
    scenesActivity?: SceneActivityRecord[];
}

export interface SceneActivityRecord {
    path: string;
    activeMs: number;
    typedWords: number;
}

export interface WritingSessionsSettings {
    /**
     * Persisted data-shape version. Stamped by `normalizeWritingSessionsSettings`.
     * Lets future plugin releases (and the planned companion website) migrate
     * older exported session data deterministically. Absent = pre-versioned (v0).
     */
    schemaVersion?: number;
    defaults: WritingSessionDefaults;
    active?: ActiveWritingSession;
    records: WritingSessionRecord[];
}

export interface LlmTimingStats {
    averageTokenPerSec: number;
    lastJobTokenCount: number;
    lastJobDurationMs: number;
    sampleSize: number;
    recentSamples: number[];
    sampleCount: number;
}

export interface HoverMetadataField {
    key: string;           // Frontmatter key
    label: string;         // Display label
    icon: string;          // Lucide icon name
    enabled: boolean;      // Show in hover synopsis
}

export interface StructuralMoveHistoryEntry {
    timestamp: string;
    itemType: 'Scene' | 'Beat';
    itemId: string;
    itemLabel: string;
    sourceContext?: string;
    destinationContext?: string;
    summary: string;
    renameCount?: number;
    crossedActs?: boolean;
    rippleRename?: boolean;
}

/** Per-stage publishing target dates (YYYY-MM-DD strings). Scoped per book. */
export interface StageTargetDates {
    Zero?: string;
    Author?: string;
    House?: string;
    Press?: string;
}

export interface BookProfile {
    id: string;
    title: string;
    sourceFolder: string;
    fileStem?: string;
    genre?: string;
    projectStage?: string;
    publicLabel?: string;
    publicDescription?: string;
    /** Publishing target dates for THIS book (Progress & status panel). */
    stageTargetDates?: StageTargetDates;
    lastUsedPandocLayoutByPreset?: Partial<Record<'novel' | 'screenplay' | 'podcast', string>>;
    layoutOptions?: Record<string, BookLayoutOptions>;
    beatWorkspace?: BeatWorkspaceState;
    recentStructuralMoves?: StructuralMoveHistoryEntry[];
    /**
     * User-defined Book Pages preview order. Each entry is a `ResolvedPage.id`
     * (e.g. `note:Books/X/0.2 Title Page.md` or `bookmeta:copyright`). Applied
     * via `applyBookPageOrder`. Empty/undefined → canonical order. The export
     * pipeline consumes this field when assembling front/back matter.
     */
    bookPageOrder?: string[];
}

export interface BookLayoutOptions {
    actEpigraphs?: string[];
    actEpigraphAttributions?: string[];
    sceneHeadingMode?: ManuscriptSceneHeadingMode;
}

export type AuthorProgressPublishTarget = 'folder' | 'github_pages' | 'note';
export type AuthorProgressFrequency = 'manual' | 'daily' | 'weekly' | 'monthly';
export type AprExportFormat = 'png' | 'svg';
export type AprExportQuality = 'standard' | 'ultra' | 'print';

export interface AuthorProgressDefaults {
    noteBehavior: 'preset' | 'custom';
    publishTarget: AuthorProgressPublishTarget;
    customNoteTemplatePath?: string; // Path to custom note template (Pro feature)

    // Display defaults
    showSubplots: boolean;  // Show all rings vs single Main Plot ring
    showActs: boolean;      // Show act divisions vs full circle
    showStatus: boolean;    // Show real stage colors vs neutral gray
    showProgressPercent?: boolean; // Show big center %
    aprProgressMode?: 'stage' | 'date' | 'full';
    aprTrackedStage?: AprTrackedStage;
    aprProgressDateStart?: string;
    aprProgressDateTarget?: string;
    aprTargetSceneCount?: number; // Author-estimated total scenes — APR denominator when current scene count is smaller
    aprSize?: 'small' | 'medium' | 'large';
    aprExportQuality?: AprExportQuality; // Standard (1200px) or Ultra (2400px)
    // Persisted view mode for the Default Report and any campaign with teaser OFF.
    // Mirrors the teaser preview dropdown in social settings. 'auto' = use progress %.
    aprDefaultViewMode?: 'auto' | 'ring' | 'scenes' | 'colors' | 'full';
    exportFormat?: AprExportFormat; // Core/default report export format
    aprBackgroundColor?: string;
    aprCenterTransparent?: boolean;
    aprBookAuthorColor?: string;
    aprAuthorColor?: string;
    aprEngineColor?: string;
    aprPercentNumberColor?: string; // Color for the center percent number
    aprPercentSymbolColor?: string; // Color for the center % symbol
    aprTheme?: 'dark' | 'light' | 'none'; // Controls stroke/border contrast
    aprSpokeColorMode?: 'dark' | 'light' | 'none' | 'custom' | 'sync'; // Act spokes color mode
    aprSpokeColor?: string; // Custom spokes color (used when mode is 'custom')

    // Typography Settings (since SVG embeds fonts, these are user-configurable)
    aprBookTitleFontFamily?: string;  // Font family for book title (default: 'Inter')
    aprBookTitleFontWeight?: number;  // Font weight for book title (default: 400)
    aprBookTitleFontItalic?: boolean; // Italic for book title (default: false)
    aprBookTitleFontSize?: number;    // Font size for book title (default: from preset)

    aprAuthorNameFontFamily?: string;  // Font family for author name (default: 'Inter' or script font)
    aprAuthorNameFontWeight?: number;  // Font weight for author name (default: 400)
    aprAuthorNameFontItalic?: boolean; // Italic for author name (default: false)
    aprAuthorNameFontSize?: number;    // Font size for author name (default: from preset)

    aprPercentNumberFontSize1Digit?: number;  // Font size for single-digit (default: from preset)
    aprPercentNumberFontSize2Digit?: number;  // Font size for double-digit (default: from preset)
    aprPercentNumberFontSize3Digit?: number;  // Font size for triple-digit (default: from preset)

    aprRtBadgeFontFamily?: string;  // Font family for stage badge / RT mark (default: 'Inter')
    aprRtBadgeFontWeight?: number;  // Font weight for stage badge / RT mark (default: 700)
    aprRtBadgeFontItalic?: boolean; // Italic for stage badge / RT mark (default: false)
    aprRtBadgeFontSize?: number;    // Font size for stage badge / RT mark (default: from preset)
    aprShowRtAttribution?: boolean; // Show RT attribution mark (Pro can disable)
    aprStylingExpanded?: boolean; // Collapse state for the styling panel body

    // Custom background presets (user-saved colors with names)
    aprCustomBgPresets?: Array<{ label: string; color: string }>;

    // Identity
    authorName?: string;

    // Publishing defaults
    lastPublishedDate?: string; // ISO string
    updateFrequency: AuthorProgressFrequency;
    stalenessThresholdDays: number; // For Manual mode
    enableReminders: boolean;
    exportPath: string;
    autoUpdateExportPath?: boolean;
}

export interface AuthorProgressSettings {
    enabled: boolean;
    defaults: AuthorProgressDefaults;
    styleProfiles?: AprStyleProfile[];
    designerDraftStyle?: AprStyleSettings;
    designerCampaignId?: string;

    // Pro Feature: Campaign Manager
    campaigns?: AuthorProgressCampaign[];
}

export type AprTrackedStage = 'Zero' | 'Author' | 'House' | 'Press';
export type AprStyleSource = 'global' | 'profile';

export interface AprStyleSettings {
    aprBackgroundColor?: string;
    aprCenterTransparent?: boolean;
    aprBookAuthorColor?: string;
    aprAuthorColor?: string;
    aprEngineColor?: string;
    aprPercentNumberColor?: string;
    aprPercentSymbolColor?: string;
    aprTheme?: 'dark' | 'light' | 'none';
    aprSpokeColorMode?: 'dark' | 'light' | 'none' | 'custom' | 'sync';
    aprSpokeColor?: string;
    aprBookTitleFontFamily?: string;
    aprBookTitleFontWeight?: number;
    aprBookTitleFontItalic?: boolean;
    aprBookTitleFontSize?: number;
    aprAuthorNameFontFamily?: string;
    aprAuthorNameFontWeight?: number;
    aprAuthorNameFontItalic?: boolean;
    aprAuthorNameFontSize?: number;
    aprPercentNumberFontSize1Digit?: number;
    aprPercentNumberFontSize2Digit?: number;
    aprPercentNumberFontSize3Digit?: number;
    aprRtBadgeFontFamily?: string;
    aprRtBadgeFontWeight?: number;
    aprRtBadgeFontItalic?: boolean;
    aprRtBadgeFontSize?: number;
    aprShowRtAttribution?: boolean;
}

export interface AprStyleProfile {
    id: string;
    name: string;
    createdAt: string;
    style: AprStyleSettings;
    aprExportQuality?: AprExportQuality;
}

/**
 * Teaser Reveal stages for progressive reveal (4 stages)
 * Each level unlocks more visual detail as progress increases
 *
 * ring    = Progress ring only, no scenes (formerly called 'bar' internally)
 * scenes  = Scene cells + acts rendered in grayscale with patterns, completed = gray
 * colors  = Full publish stage colors revealed (status + stage)
 * full    = All subplot rings visible
 */
export type TeaserRevealLevel = 'ring' | 'scenes' | 'colors' | 'full';

/**
 * Teaser Reveal preset configurations
 */
export type TeaserPreset = 'slow' | 'standard' | 'fast' | 'custom';

/**
 * Teaser Reveal thresholds - percentage at which each level unlocks
 * Order: ring (0%) → scenes → colors → full
 */
export interface TeaserThresholds {
    scenes: number;    // When to show scene cells + acts (e.g., 10%)
    colors: number;    // When to show full publish stage colors (e.g., 30%)
    full: number;      // When to show subplot rings / complete view (e.g., 60%)
}

/**
 * Disabled stages for Teaser Reveal
 * Authors can skip middle stages by clicking on preview cards
 */
export interface TeaserDisabledStages {
    scenes?: boolean;  // Skip SCENES stage
    colors?: boolean;  // Skip COLORS stage
}

/**
 * Teaser Reveal settings for progressive reveal
 */
export interface TeaserRevealSettings {
    enabled: boolean;
    preset: TeaserPreset;
    customThresholds?: TeaserThresholds;
    disabledStages?: TeaserDisabledStages;
}

/**
 * Author Progress campaign - Pro Feature
 * Allows multiple export destinations with independent refresh schedules
 */
export interface AuthorProgressCampaign {
    id: string;
    name: string;                    // "Kickstarter", "Newsletter", "Website", etc.
    description?: string;            // Optional notes about this campaign
    isActive: boolean;               // Whether this campaign is currently being used

    // Update Schedule
    updateFrequency?: 'manual' | 'daily' | 'weekly' | 'monthly';  // How often to auto-update
    refreshThresholdDays: number;    // Days before reminder appears (for manual mode)
    lastPublishedDate?: string;      // ISO string - when last updated

    // Community share surface: also send this campaign's APR to the author's
    // My Share page on the community website. It arrives private there; the
    // author activates public display on the website (never from the plugin).
    sendToCommunity?: boolean;

    // Output
    exportPath: string;              // Where to save the exported report for this campaign
    exportFormat?: AprExportFormat;  // Campaign export format (PNG recommended, SVG optional for web embeds)

    // Book targeting (Pro: select a specific book; default: follows active book)
    targetBookId?: string;            // Book Manager book ID — undefined = current active book

    aprSize?: 'small' | 'medium' | 'large';
    aprExportQuality?: AprExportQuality;

    // Explicit style resolution
    styleSource?: AprStyleSource;
    styleProfileId?: string;

    // Legacy per-campaign styling overrides retained for migration only
    customBackgroundColor?: string;
    customTransparent?: boolean;
    customTheme?: 'dark' | 'light';

    // Pro Feature: Teaser Reveal (Progressive Reveal)
    teaserReveal?: TeaserRevealSettings;
}

export type SceneInclusion = 'excluded' | 'summary' | 'full';

export type InquirySourcesPreset = 'default' | 'light' | 'deep';
export type BriefingThemePreference = 'auto' | 'light' | 'dark';

export interface InquiryClassConfig {
    className: string;
    enabled: boolean;
    bookScope: SceneInclusion;
    sagaScope: SceneInclusion;
    referenceScope: SceneInclusion;
}

export interface InquirySourcesSettings {
    preset?: InquirySourcesPreset;
    scanRoots?: string[];
    resolvedScanRoots?: string[];
    bookInclusion?: Record<string, boolean>;
    classScope?: string[];
    classes?: InquiryClassConfig[];
    classCounts?: Record<string, number>;
    lastScanAt?: string;
}

export interface InquiryTimingHistoryEntry {
    samples: number;
    avgMsPerInputToken: number;
    lastDurationMs: number;
    lastInputTokens: number;
    updatedAt: string;
}

export type InquiryCanonicalQuestionTier = 'core' | 'signature';
export type InquiryCanonicalPromptState = 'loaded' | 'customized';

export interface InquiryCanonicalPromptRef {
    id: string;
    version: number;
    tier: InquiryCanonicalQuestionTier;
    zone: InquiryZone;
    state?: InquiryCanonicalPromptState;
}

export interface InquiryPromptSlot {
    id: string;
    label?: string;
    question: string;
    enabled: boolean;
    builtIn?: boolean;
    requiresContext?: boolean;
    canonical?: InquiryCanonicalPromptRef;
}

export type InquiryPromptConfig = Record<InquiryZone, InquiryPromptSlot[]>;

export interface InquiryTargetCache {
    lastBookId?: string;
    lastTargetSceneIdsByBookId?: Record<string, string[]>;
}

export interface InquiryCorpusThresholds {
    emptyMax: number;
    sketchyMin: number;
    mediumMin: number;
    substantiveMin: number;
}

export interface OmnibusProgressState {
    totalQuestions: number;
    completedQuestionIds: string[];
    scope: InquiryScope;
    questionIds: string[];
    useOmnibus: boolean;
    corpusSettingsFingerprint: string;
    indexNotePath?: string;
    abortedAt?: string;
}

export interface InquirySessionCacheRecord {
    sessions: {
        key: string;
        baseKey: string;
        result: unknown;
        createdAt: number;
        lastAccessed: number;
        stale?: boolean;
        status?: 'saved' | 'unsaved' | 'error' | 'simulated';
        briefPath?: string;
        targetSceneIds: string[];
        focusBookId?: string;
        scope?: InquiryScope;
        questionZone?: InquiryZone;
        pendingEditsApplied?: boolean;
        pendingEditsEmpty?: boolean;
        logPath?: string;
        cacheWindowExpiresAt?: number;
        cacheReuseFingerprint?: string;
        cacheReuseState?: 'idle' | 'eligible' | 'warm';
        providerCacheStatus?: 'hit' | 'created';
        cachedStableRatio?: number;
        cachedStableTokens?: number;
        totalInputTokens?: number;
    }[];
    max: number;
}

export interface GossamerRunFilterSettings {
    latestOnly: boolean;
    visibleRunIds: string[];
    beatSystemKey: string;
    /**
     * Signal the timeline is currently plotting (momentum, tension, activity, interiority).
     * Only runs matching this signal are shown in the runs panel and plotted.
     * Defaults to 'momentum' — legacy runs without a stored signal read as momentum.
     */
    signal?: string;
}

/** A Pandoc LaTeX layout template scoped to a manuscript preset. */
export interface PandocLayoutTemplate {
    id: string;                // unique, e.g. "bundled-fiction-signature-literary"
    name: string;              // display name, e.g. "Signature Literary"
    preset: 'novel' | 'screenplay' | 'podcast';
    path: string;              // vault-relative or absolute path to .tex file
    description?: string;      // optional user-editable description shown in Pro settings
    bundled?: boolean;         // true for RT-generated sample templates
    origin?: ProfileOrigin;    // provenance for newly imported templates
    tier?: TemplateTier;
    templateKind?: TemplateKind;
    recommendedUse?: string;
    draft?: boolean;           // staged import that should not be treated as activated yet
    importDetection?: ImportedTemplateDetectionSummary; // inferred layout summary captured during guided import
    usesModernClassicStructure?: boolean; // emit rtPart/rtSceneSep markers and chapter headings in PDF compilation
    hasEpigraphs?: boolean;
    hasSceneOpenerHeadingOptions?: boolean;
    /**
     * Spec for layouts authored via the Designed Style wizard (origin === 'designed').
     * The .tex file at `path` is regenerated from this spec on save; this field is the source of truth.
     */
    designedSpec?: DesignedStyleSpec;
}

export type SettingsTabId = 'core' | 'social' | 'community' | 'inquiry' | 'publishing' | 'ai' | 'advanced' | 'pro';

export type CommunityShareConnectionStatus = 'disconnected' | 'pending' | 'connected' | 'paused' | 'revoked';
export type CommunityShareAudience = 'private_draft' | 'public' | 'followers' | 'trusted_authors' | 'private_link';
export type CommunityShareTier = 0 | 1 | 2 | 3 | 4 | 5;
export type CommunityShareReportPeriod = 'weekly' | 'monthly' | 'manual';
export type CommunityShareFieldKey =
    | 'project.title'
    | 'project.alias'
    | 'project.description'
    | 'project.status'
    | 'project.genre'
    | 'project.custom_genre_label'
    | 'activity.report_period'
    | 'activity.writing_days'
    | 'activity.minutes_total'
    | 'activity.words_added'
    | 'activity.session_count'
    | 'activity.mode_mix'
    | 'activity.scenes_completed_by_stage'
    | 'activity.stage_mix'
    | 'activity.completed_scene_count'
    | 'activity.revised_scene_count'
    | 'activity.streak'
    | 'structure.real_scene_titles'
    | 'activity.exact_session_timestamps';

export type CommunityShareFieldPolicy = Record<CommunityShareFieldKey, boolean>;

export interface CommunityShareConnectionSettings {
    status: CommunityShareConnectionStatus;
    connectionId?: string;
    activationTokenId?: string;
    profileId?: string;
    projectId?: string;
    publicSlug?: string;
    connectedAt?: string;
    lastSyncedAt?: string;
    /** Payload hash of the last successful publish/sync; automatic syncs skip when unchanged. */
    lastSyncedPayloadHash?: string;
    disconnectedAt?: string;
    secretId?: string;
}

export interface CommunitySharePreviewState {
    status: 'not_generated' | 'ready' | 'stale' | 'blocked';
    generatedAt?: string;
    previewHash?: string;
    payloadHash?: string;
    reportPeriod?: CommunityShareReportPeriod;
    summary?: string;
}

export interface CommunitySharePublishHistoryEntry {
    id: string;
    action: 'preview_generated' | 'publish' | 'sync' | 'revoke' | 'delete' | 'disconnect' | 'pause' | 'resume';
    status: 'success' | 'failed' | 'blocked';
    at: string;
    message?: string;
    publishId?: string;
    versionId?: string;
    publicSlug?: string;
}

export interface CommunityShareSettings {
    schemaVersion: 1;
    enabled: boolean;
    tier: CommunityShareTier;
    audience: CommunityShareAudience;
    manualPublishEnabled: boolean;
    scheduledPublishEnabled: boolean;
    workingNowEnabled: boolean;
    fieldPolicy: CommunityShareFieldPolicy;
    redactionPolicy: Record<string, boolean>;
    connection: CommunityShareConnectionSettings;
    preview: CommunitySharePreviewState;
    publishHistory: CommunitySharePublishHistoryEntry[];
    lastError?: string;
}

export interface RadialTimelineSettings {
    books: BookProfile[];
    activeBookId?: string;
    timelineScope?: 'book' | 'saga';
    /**
     * Last tab the user had open in Settings. Restored on next Settings open
     * so users who live on (e.g.) the Publish tab don't have to re-navigate
     * from Core every time. Persists across reloads.
     */
    lastSettingsTab?: SettingsTabId;
    sourcePath: string;
    /** @deprecated Legacy toggle. Book title now comes from BookProfile. Kept for migration. */
    showSourcePathAsTitle?: boolean;
    validFolderPaths: string[];
    validProjectPaths?: string[];  // Autocomplete history for Social Project Path field
    /** @deprecated Logging paths are internalized and no longer user-configurable. */
    aiOutputFolder?: string;
    /** Export destination for manuscript, outline, and cue-card exports. Defaults to `Radial Timeline/Export`. */
    manuscriptOutputFolder?: string;
    /** @deprecated Outline exports use the shared Export folder. Kept in sync with `manuscriptOutputFolder` so stale values can't diverge. */
    outlineOutputFolder?: string;
    inquirySources?: InquirySourcesSettings;
    inquiryPromptConfig?: InquiryPromptConfig;
    inquirySessionCache?: InquirySessionCacheRecord;
    inquiryTargetCache?: InquiryTargetCache;
    inquiryLastMode?: 'flow' | 'depth';
    inquiryCorpusThresholds?: InquiryCorpusThresholds;
    inquiryPromptZoneExpanded?: Record<InquiryZone, boolean>;
    inquiryActionNotesAutoPopulate?: boolean;
    briefingTheme?: BriefingThemePreference;
    inquiryOmnibusProgress?: OmnibusProgressState;
    inquiryTimingHistory?: Record<string, InquiryTimingHistoryEntry>;
    actCount?: number;
    actLabelsRaw?: string;
    gossamerRunFilter?: GossamerRunFilterSettings;
    /** Last observed API round-trip duration per signal, used to seed the next run's ETA. */
    gossamerLastRunMsBySignal?: Record<string, number>;
    publishStageColors: {
        Zero: string;
        Author: string;
        House: string;
        Press: string;
    };
    subplotColors: string[];
    /** Hero Patterns motif id used for Working-status scene fills. */
    workingPatternId?: string;
    /**
     * User-defined custom working patterns (Pro feature). Each entry is the
     * result of running pasted SVG markup through {@link validateSvgPattern}
     * and is stored as structured shape data — never as raw markup.
     */
    customWorkingPatterns?: Array<{
        id: string;
        name: string;
        tileW: number;
        tileH: number;
        fillOpacity: number;
        fillRule?: 'evenodd' | 'nonzero';
        shapes: Array<{ tag: 'path' | 'circle'; attrs: Record<string, string> }>;
    }>;
    currentMode?: string;
    logApiInteractions: boolean;
    targetCompletionDate?: string;  // Legacy - kept for backwards compatibility
    /**
     * @deprecated Legacy vault-global target dates. Migrated into per-book
     * `BookProfile.stageTargetDates` on load (see loadSettings) and cleared;
     * never read at runtime.
     */
    stageTargetDates?: StageTargetDates;
    showCompletionEstimate?: boolean;
    timelapseYearSimulation?: {
        enabled?: boolean;
        startDate?: string;
        finishDate?: string;
        totalScenes?: number;
    };
    completionEstimateWindowDays?: number;
    coreCompletionPreviewExpanded?: boolean;
    povPreviewExpanded?: boolean;
    aiSettings?: AiSettingsV1;
    aiProviderSnapshotCacheJson?: string;
    aiPricingCacheJson?: string;
    enableAiSceneAnalysis: boolean;
    enableZeroDraftMode?: boolean;
    enableSceneTitleAutoExpand?: boolean;
    showChapterMarkers?: boolean;
    showRecentMovesOverlay?: boolean;
    enableManuscriptRippleRename?: boolean;
    synopsisHoverMaxLines?: number; // @deprecated Legacy hover line limit, now derived from Synopsis max words
    enableHoverDebugLogging?: boolean;
    showFullTripletAnalysis?: boolean;
    sortByWhenDate?: boolean;
    chronologueDurationCapSelection?: string;
    chronologueCalendarDefault?: ChronologueCalendarDefault;
    chronologueLastCalendarView?: ChronologueCalendarView;
    discontinuityThreshold?: string;
    shouldRestoreTimelineOnLoad?: boolean;
    /** @deprecated Legacy global beat-system selector. Migrated into per-book beatWorkspace and not used at runtime. */
    beatSystem?: string;
    /** Internal one-time migration flag for per-book beat system selection bootstrap. */
    beatSelectionMigrationComplete?: boolean;
    dominantSubplots?: Record<string, string>;
    globalPovMode?: GlobalPovMode;
    readabilityScale?: ReadabilityScale;
    _isResuming?: boolean;
    _resumingMode?: 'flagged' | 'unprocessed' | 'force-all';
    lastSeenReleaseNotesVersion?: string;
    // Synopsis generation settings (legacy names — now control Summary generation)
    synopsisTargetWords?: number; // Target word count for AI-generated summaries (default: 200)
    synopsisWeakThreshold?: number; // Word count below which a summary is considered "weak" (default: 75)

    // Summary & Synopsis generation settings
    alsoUpdateSynopsis?: boolean; // When running Summary refresh, also generate Synopsis (default: false)
    synopsisGenerationMaxWords?: number; // Max words for AI-generated Synopsis (default: 30)
    synopsisGenerationMaxLines?: number; // @deprecated Legacy line-based synopsis limiter

    // Internal AI update timestamps (per-scene, keyed by file path)
    aiUpdateTimestamps?: Record<string, { synopsisUpdated?: string; summaryUpdated?: string }>
    cachedReleaseNotes?: EmbeddedReleaseNotesBundle | null;
    releaseNotesLastFetched?: string;
    enablePlanetaryTime?: boolean;
    planetarySectionExpanded?: boolean;
    planetaryProfiles?: PlanetaryProfile[];
    activePlanetaryProfileId?: string
    planetaryTimeLastDirection?: PlanetaryTimeConversionDirection;
    frontmatterMappings?: Record<string, string>;
    enableCustomMetadataMapping?: boolean;
    enableAdvancedYamlEditor?: boolean;
    sceneAdvancedPropertiesEnabled?: boolean;
    sceneYamlTemplates?: {
        base: string;
        advanced: string;
    };
    bookDesignerTemplates?: BookDesignerTemplate[];
    exportProfiles?: ExportProfile[];
    bookPublishingPreferences?: BookPublishingPreferences[];
    manuscriptExportTemplates?: ManuscriptExportTemplate[];
    lastUsedManuscriptExportTemplateId?: string;
    lastUsedExportProfileId?: string;
    /** @deprecated Use backdropYamlTemplates instead. Kept for migration. */
    backdropYamlTemplate?: string;
    backdropYamlTemplates?: {
        base: string;
        advanced: string;
    };
    enableBackdropYamlEditor?: boolean;
    backdropHoverMetadataFields?: HoverMetadataField[];
    showBackdropRing?: boolean;
    chronologueBackdropMicroRings?: ChronologueBackdropMicroRing[];
    hoverMetadataFields?: HoverMetadataField[];

    enableBeatYamlEditor?: boolean;
    // Per-system beat YAML + hover configs (keyed by system name or custom:<id>)
    beatSystemConfigs?: Record<string, BeatSystemConfig>;
    /** @deprecated Legacy fixed-Custom workspace marker kept only for migration. */
    activeCustomBeatSystemId?: string;
    beatYamlTemplates?: {
        base: string;
    };
    savedBeatSystems?: SavedBeatSystem[];

    // Pro access
    proLicenseKey?: string;
    proAccessEnabled?: boolean;
    /** IDs of bonus (Website Exclusive) vaults the user has activated/installed. */
    installedBonusVaults?: string[];

    // Runtime Estimation Settings (Pro feature)
    runtimeRateProfiles?: RuntimeRateProfile[];
    defaultRuntimeProfileId?: string;
    runtimeContentType?: RuntimeContentType;
    runtimeDialogueWpm?: number;
    runtimeActionWpm?: number;
    runtimeNarrationWpm?: number;
    runtimeBeatSeconds?: number;
    runtimePauseSeconds?: number;
    runtimeLongPauseSeconds?: number;
    runtimeMomentSeconds?: number;
    runtimeSilenceSeconds?: number;

    // Local writing sessions and accountability stats
    writingSessions?: WritingSessionsSettings;

    // LLM Timing Calibration (for progress bar animation)
    pulseTimingStats?: LlmTimingStats;

    /**
     * Version of the latest release note the user explicitly collapsed in the "What's New"
     * settings panel. When set and it matches the current featured release, the panel stays
     * closed on subsequent renders. Cleared automatically when a newer release ships.
     */
    dismissedLatestReleaseVersion?: string;

    // Export / Pandoc (Pro)
    pandocPath?: string;
    pandocFolder: string;  // Vault path for Pandoc templates and compile scripts (always populated via DEFAULT_SETTINGS merge)
    pandocLayouts?: PandocLayoutTemplate[];
    /**
     * Opt-in print binding gutter for PDF export. When true, exports inject
     * `\geometry{bindingoffset=0.25in}` via --include-in-header so the inner
     * margin compensates for paperback spine loss. Off by default because it
     * changes page geometry — screen PDFs and print PDFs are different outputs.
     */
    pdfBindingGutter?: boolean;
    /**
     * Pro: extra Pandoc `--metadata key=value` pairs, one `key: value` per line.
     * Serves authors migrating an existing Pandoc setup whose custom templates
     * read variables beyond title/author (fontsize, geometry, documentclass…).
     */
    customPandocMetadata?: string;
    /**
     * Pro: raw LaTeX injected into the PDF preamble via --include-in-header.
     * The escape hatch for migrated setups (custom macros, packages). Injected
     * after the generated preamble so user definitions win.
     */
    customLatexPreamble?: string;
    /** @deprecated Migrated to BookProfile.lastUsedPandocLayoutByPreset. Kept for one migration cycle. */
    lastUsedPandocLayoutByPreset?: Record<string, string>;

    /** @deprecated Migrated to pandocLayouts on load. Kept for one release cycle. */
    pandocTemplates?: {
        screenplay?: string;
        podcast?: string;
        novel?: string;
    };

    // Social / authorProgress settings
    authorProgress?: AuthorProgressSettings;

    // Community Share settings
    communityShare?: CommunityShareSettings;

    // Pro experience (visual/hero activation)

    // Refactor Alerts System
    dismissedAlerts?: string[];

    // Snapshot of refactor-alert IDs that existed when the plugin was first
    // installed into this vault. Set once, on a brand-new install, so the
    // backlog of upgrade/migration notices never shows to a fresh user (they
    // have nothing to migrate). `undefined` for existing users — they keep
    // seeing alerts as normal. Future updates add IDs not in this baseline, so
    // genuine upgrade alerts still surface once this user becomes an upgrader.
    installAlertBaseline?: string[];

    // Bundled .tex template auto-hotfix history. Each entry records an
    // (layoutId, hotfixId) pair that ran during plugin load. The synthetic
    // The template and matter update refactor alert reads from this list — it appears
    // while any entry has `acknowledged: false` and clears when the user
    // dismisses the Core notification.
    templateHotfixHistory?: HotfixHistoryEntry[];
}

/**
 * Non-deprecated view of the legacy persisted fields on RadialTimelineSettings.
 * Old data.json files may still carry these; the migration / fallback code reads
 * them through this shape so the boundary access doesn't trip no-deprecated while
 * the deprecation tags stay on RadialTimelineSettings for everyone else.
 */
export interface LegacyPersistedSettings {
    showSourcePathAsTitle?: boolean;
    outlineOutputFolder?: string;
    backdropYamlTemplate?: string;
    pandocTemplates?: {
        screenplay?: string;
        podcast?: string;
        novel?: string;
    };
    lastUsedPandocLayoutByPreset?: Record<string, string>;
}

export interface HotfixHistoryEntry {
    layoutId: string;        // e.g. 'bundled-fiction-classic-manuscript'
    hotfixId: string;        // e.g. 'scene-opener-macro-v1', 'symmetric-margins-v1'
    appliedAt: number;       // Date.now() when the normalize* fn returned changed: true
    acknowledged: boolean;   // user dismissed the synthetic Core notification
}

export interface ChronologueBackdropMicroRing {
    title: string;
    range: string;
    color: string;
}

export interface PlanetaryProfile {
    id: string;
    label: string;
    hoursPerDay: number;
    daysPerWeek: number;
    daysPerYear: number;
    epochOffsetDays?: number;
    epochLabel?: string;
    monthNames?: string[];
    weekdayNames?: string[];
    customFormat?: string;
}

export interface EmbeddedReleaseNotesBundle {
    version: string;
    entries: EmbeddedReleaseNotesEntry[];
    // Properties used by ReleaseNotesService logic
    majorVersion?: string;
    major?: EmbeddedReleaseNotesEntry;
    latest?: EmbeddedReleaseNotesEntry;
    patches?: EmbeddedReleaseNotesEntry[];
}

export interface EmbeddedReleaseNotesEntry {
    version: string;
    title: string;
    sections: {
        type: 'feature' | 'improvement' | 'fix';
        items: string[];
    }[];
    publishedAt?: string;
    body?: string;
    url?: string;
}
