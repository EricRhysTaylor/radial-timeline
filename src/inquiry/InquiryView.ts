import {
    ItemView,
    Menu,
    Notice,
    Platform,
    setIcon,
    TAbstractFile,
    TFile,
    TFolder,
    WorkspaceLeaf,
    normalizePath
} from 'obsidian';
import type RadialTimelinePlugin from '../main';
import { BugReportModal } from '../modals/BugReportModal';
import { t } from '../i18n';
import {
    INQUIRY_MAX_OUTPUT_TOKENS,
    INQUIRY_SCHEMA_VERSION,
    INQUIRY_VIEW_DISPLAY_TEXT,
    INQUIRY_VIEW_TYPE
} from './constants';
import {
    computeCitationIntegritySummary,
    createDefaultInquiryState,
    FindingRole,
    InquiryFinding,
    InquiryLens,
    InquiryRoleValidation,
    InquiryResult,
    InquiryPromptFormOverride,
    InquirySelectionMode,
    InquiryScope,
    InquiryStaleDiagnosis,
    InquiryStaleReason,
    InquiryZone
} from './state';
import { replayTransientClass } from '../utils/domClassEffects';
import { providerSupportsCitations } from '../api/providerCapabilities';
import { formatProviderCacheTtlLabel, normalizeGeminiCacheTtlSeconds, resolveProviderCacheWindowMs } from '../ai/settings/cacheWindows';
import type {
    InquiryCanonicalQuestionTier,
    InquiryClassConfig,
    InquiryPromptConfig,
    InquiryPromptSlot,
    SceneInclusion,
    InquiryTimingHistoryEntry,
    OmnibusProgressState
} from '../types/settings';
import {
    buildDefaultInquiryPromptConfig,
    getCanonicalQuestionForSlot,
    getPromptSlotQuestion,
    normalizeInquiryPromptConfig
} from './prompts';
import {
    createInquiryBriefingPanel,
    createInquiryDesktopShell,
    createInquiryEnginePanel,
    createInquiryPromptPreviewPanel
} from './dom/inquiryDomFactory';
import {
    bindInquiryBriefingPanelEvents,
    bindInquiryBriefingSessionItemEvents,
    bindInquiryDetailsToggleEvent,
    bindInquiryDesktopShellEvents,
    bindInquiryEngineActionButtons,
    bindInquiryEnginePanelEvents,
    bindInquiryMobileGateEvents,
    bindInquiryPreviewPanelEvents,
    bindInquiryZonePodEvents
} from './interactions/inquiryEventBinder';
import { buildInquiryBriefingSections } from './briefing/inquiryBriefingGrouping';
import { renderInquiryBriefingSessionItem } from './briefing/inquiryBriefingRenderer';
import { HoverPopoverController } from './dom/hoverPopoverController';
import { anchorPanelNearTrigger } from './dom/panelAnchoring';
import { deriveBriefingArtifactClassFlags } from './briefing/briefingArtifactStatus';
import { DisposableRegistry, clearTrackedTimer } from '../core/disposable';
import { SceneDossierController } from './render/sceneDossierController';
import { getEmbeddedAssetDataUri, type EmbeddedAssetKey } from '../utils/embeddedAssets';
import {
    isInquiryResultError,
    isInquiryResultDegraded,
    resolveInquirySessionStatus,
    resolveInquirySessionStatusFromResult,
} from './utils/inquiryResultStatus';
import { InquiryBriefingPurgeScanner } from './briefing/InquiryBriefingPurgeScanner';
import { computeBriefingFooterButtonState } from './briefing/briefingFooterButtonState';
import { InquiryActiveSessionState } from './session/inquiryActiveSessionState';
import { InquirySelectionState } from './session/inquirySelectionState';
import { InquirySettingsAccessor } from './settings/inquirySettingsAccessor';
import { InquiryCorpusSnapshotController } from './corpus/InquiryCorpusSnapshotController';
import {
    buildFocusedCustomPrompt,
    resolveQuestionPrompt,
    resolveQuestionPromptForm,
    type InquiryQuestionPromptForm
} from './questions/resolveQuestionPrompt';
import { ensureInquiryArtifactFolder, getMostRecentArtifactFile, resolveInquiryArtifactFolder } from './utils/artifacts';
import { cleanEvidenceBody } from './utils/evidenceCleaning';
import { countWords as countManuscriptWords } from '../utils/manuscript';
import { ensureInquiryContentLogFolder, ensureInquiryLogFolder, resolveInquiryLogFolder } from './utils/logs';
import { openOrRevealFile, openOrRevealFileAtSubpath } from '../utils/fileUtils';
import { extractTokenUsage } from '../ai/log';
import {
    InquiryGlyph,
    FLOW_RADIUS,
    FLOW_STROKE,
    ZONE_RING_THICKNESS,
    ZONE_SEGMENT_RADIUS
} from './components/InquiryGlyph';
import { InquiryRunnerService } from './runner/InquiryRunnerService';
import { getLastAiAdvancedContext } from '../ai/runtime/aiClient';
// computeCaps, INPUT_TOKEN_GUARD_FACTOR: now used in inquiryReadinessBuilder.ts
import { resolveCitationsEnabled } from '../ai/caps/computeCaps';
import { BUILTIN_MODELS } from '../ai/registry/builtinModels';
import { ANTHROPIC_REQUESTED_CACHE_TTL, buildDefaultAiSettings } from '../ai/settings/aiSettings';
import { validateAiSettings } from '../ai/settings/validateAiSettings';
import type { AIProviderId, AiSettingsV1, AccessTier, RTCorpusTokenEstimate, AIRunAdvancedContext } from '../ai/types';
import type {
    CorpusManifest,
    CorpusManifestEntry,
    EvidenceParticipationRules,
    InquiryOmnibusInput,
    InquiryRunProgressEvent,
    InquiryRunTrace,
    InquiryRunnerInput
} from './runner/types';
import { InquirySessionStore } from './InquirySessionStore';
import { readInquirySessionsFromVault, readInquirySidecarVaultIdentity } from './InquiryArtifactStore';
import type { InquirySession, InquirySessionStatus } from './sessionTypes';
import { extractSummary, getActiveFrontmatterMappings, normalizeFrontmatterKeys } from '../utils/frontmatter';
import { getSequencedBooks } from '../utils/books';
import type { InquirySourcesSettings } from '../types/settings';
import { DEFAULT_SETTINGS } from '../settings/defaults';
import { hasProFeatureAccess } from '../settings/featureGate';
import { InquiryCorpusSnapshot, InquiryCorpusItem, InquirySceneItem, InquiryBookItem } from './services/InquiryCorpusResolver';
import {
    isPathIncludedByInquiryBooks,
    resolveBookManagerInquiryBooks
} from './services/bookResolution';
import { resolveInquiryEngine, type ResolvedInquiryEngine } from './services/inquiryModelResolver';
import { computeInquiryAdvisoryContext, type InquiryAdvisoryContext } from './services/inquiryAdvisory';
import {
    blendSampleRate,
    computeSampleRate,
    computeTimingHistoryKey,
    normalizeEvidenceModeKey,
    predictTimingFromEntry,
    type EvidenceModeKey
} from './services/inquiryTimingPrediction';
import { buildInquiryBookAnchorId, scopeEntriesToActiveInquiryTarget } from './services/canonicalInquiryCorpus';
import type {
    TokenTier,
    InquiryCurrentCorpusContext,
    InquiryPayloadStats,
    InquiryReadinessUiState,
    InquiryEnginePopoverState,
    PassPlanResult
} from './types';
import {
    buildReadinessUiState as buildReadinessUiStatePure,
    buildRunScopeLabel as buildRunScopeLabelPure,
    resolveEnginePopoverState as resolveEnginePopoverStatePure,
    getCurrentPassPlan as getCurrentPassPlanPure,
    buildAdvisoryInputKey,
    formatTokenEstimate as formatTokenEstimatePure,
    getTokenTier as getTokenTierPure,
    getTokenTierFromSnapshot as getTokenTierFromSnapshotPure
} from './services/inquiryReadinessBuilder';
import { buildPendingCorpusEstimateFromManifestEntries } from './services/buildExactCorpusEstimate';
import {
    InquiryCorpusService,
    isSynopsisCapableClass as isSynopsisCapableClassPure,
    normalizeEvidenceMode as normalizeEvidenceModePure,
    isModeActive as isModeActivePure,
    normalizeContributionMode as normalizeContributionModePure,
    normalizeMaterialMode as normalizeMaterialModePure,
    normalizeClassContribution as normalizeClassContributionPure,
    resolveContributionMode as resolveContributionModePure,
    getDefaultMaterialMode as getDefaultMaterialModePure,
    hashString as hashStringPure,
    getCorpusGroupKey as getCorpusGroupKeyPure,
    getCorpusGroupBaseClass as getCorpusGroupBaseClassPure,
    getCorpusItemKey as getCorpusItemKeyPure,
    parseCorpusItemKey as parseCorpusItemKeyPure,
    getCorpusCycleModes as getCorpusCycleModesPure,
    getNextCorpusMode as getNextCorpusModePure,
    getCorpusGroupKeys as getCorpusGroupKeysPure,
    getClassScopeConfig as getClassScopeConfigPure,
    extractClassValues as extractClassValuesPure,
    getFrontmatterScope as getFrontmatterScopePure,
    normalizeInquirySources as normalizeInquirySourcesPure
} from './services/InquiryCorpusService';
import { createSvgElement, createSvgGroup, createSvgText, clearSvgChildren } from './minimap/svgUtils';
import {
    InquiryMinimapRenderer,
    MIN_PROCESSING_MS,
    toRgbString,
    getExecutionColorValue,
    getBackboneStartColors,
} from './minimap/InquiryMinimapRenderer';
import { addTooltipData, balanceTooltipText, setupTooltipsFromDataAttributes } from '../utils/tooltip';
import { classifySynopsis, type SynopsisQuality } from '../sceneAnalysis/synopsisQuality';
import { readSceneId } from '../utils/sceneIds';
import { migrateSceneFrontmatterIds } from '../migrations/sceneIds';
import { buildSceneRefIndex, isStableSceneId, normalizeSceneRef } from '../ai/references/sceneRefNormalizer';
import {
    DEFAULT_CHARS_PER_TOKEN,
    estimateTokensFromChars as estimateTokensFromCharsHeuristic
} from '../ai/tokens/inputTokenEstimate';
import {
    estimateCorpusCost,
    formatExactUsdCost,
    formatApproxUsdCost,
    estimateOmnibusCostRange
} from '../ai/cost/estimateCorpusCost';
import {
    accumulateOmnibusPassCost,
    buildOmnibusCacheMissMessage,
    createOmnibusCostAccumulator,
    evaluateOmnibusCachePass,
    readOmnibusCacheProbe,
    type OmnibusCostAccumulator
} from './runner/omnibusCacheHealth';
import type { OmnibusRecentQuestionResult } from './runner/omnibusRecentResults';
import { tokenEstimateFromMethod } from '../ai/estimates';
import { resolveInquirySourceRoots } from './utils/sourceRoots';
import { renderInquiryCorpusStrip } from './corpus/inquiryCorpusStripRenderer';
import { applyInquiryCorpusCcSlotViewModel, buildInquiryCorpusCcSlotViewModel } from './corpus/inquiryCorpusStripSlotRenderer';
import { createInquirySceneDossierLayer, renderInquirySceneDossier } from './render/inquiryDossierRenderer';
import { createInquiryEngineActionButtons } from './engine/inquiryEngineDom';
import { renderInquiryEngineAdvisoryCard, renderInquiryEngineReadinessStrip, type EngineRecentRunSnapshot, type EngineCacheWindowSnapshot } from './engine/inquiryEngineRenderer';
import {
    getAnthropicAcceptedCacheTtl as getAnthropicAcceptedCacheTtlPure,
    getDispatchEngineKey as getDispatchEngineKeyPure,
    resolveActualUsageCostForResult as resolveActualUsageCostForResultPure,
    buildEngineRecentRunSnapshot as buildEngineRecentRunSnapshotPure,
    buildEngineCacheWindowSnapshotFromSession as buildEngineCacheWindowSnapshotFromSessionPure,
    pickEffectiveReuseAdvancedContext as pickEffectiveReuseAdvancedContextPure,
    mapSessionToPersistedReuseContext as mapSessionToPersistedReuseContextPure,
    matchLiveReuseAdvancedContext as matchLiveReuseAdvancedContextPure,
    resolveActiveCacheWindowExpiry as resolveActiveCacheWindowExpiryPure,
    formatContextCountdownLabel as formatContextCountdownLabelPure
} from './engine/inquiryCacheStatus';
import { buildInquiryEngineCorpusSummary } from './engine/inquiryEngineViewModel';
import {
    renderInquiryPromptPreviewLayout,
    renderInquiryRunningHud,
    updateInquiryPreviewClickTargetLayout,
    updateInquiryPreviewShimmerLayout,
    updateInquiryPreviewShimmerText,
    updateInquiryResultsFooterPosition
} from './render/inquiryHudRenderer';
import { buildInquiryContentLogContent, buildInquiryLogContent } from './render/inquiryLogBuilders';
import {
    CC_PAGE_BASE_SIZE,
    GLYPH_EMPTY_STATE_STUB,
    GLYPH_PLACEHOLDER_DEPTH,
    GLYPH_PLACEHOLDER_FLOW,
    GUIDANCE_ALERT_LINE_HEIGHT,
    GUIDANCE_LINE_HEIGHT,
    GUIDANCE_TEXT_Y,
    MODE_ICON_OFFSET_Y,
    MODE_ICON_VIEWBOX,
    SCENE_DOSSIER_CANVAS_Y,
    SCENE_DOSSIER_HIDE_DELAY_MS,
    SCENE_DOSSIER_HOVER_DELAY_MS,
    VIEWBOX_MAX,
    VIEWBOX_MIN,
    VIEWBOX_SIZE
} from './constants/inquiryLayout';
import {
    BRIEFING_HIDE_DELAY_MS,
    BRIEFING_SESSION_LIMIT,
    DEPTH_ICON_PATHS,
    DUPLICATE_PULSE_MS,
    FLOW_ICON_PATHS,
    INQUIRY_CONTEXT_CLASSES,
    INQUIRY_GUIDANCE_DOC_URL,
    INQUIRY_NOTES_MAX,
    INQUIRY_PROMPT_OVERHEAD_CHARS,
    REHYDRATE_HIGHLIGHT_MS,
    REHYDRATE_PULSE_MS,
    SIGMA_CHAR,
    SIMULATION_DURATION_MS
} from './constants/inquiryUi';
import {
    InquiryCancelRunModal,
    InquiryOmnibusModal,
    InquiryPurgeConfirmationModal
} from './modals/InquiryViewModals';
import { InquiryBriefingModal } from './modals/InquiryBriefingModal';
import type {
    AiSettingsFocus,
    CorpusCcEntry,
    CorpusCcGroup,
    CorpusCcHeader,
    CorpusCcSlot,
    CorpusCcStats,
    EngineFailureGuidance,
    InquiryBriefModel,
    InquiryGlyphSeed,
    InquiryGuidanceState,
    InquiryOmnibusPlan,
    InquiryOmnibusModalOptions,
    OmnibusCostRangePlan,
    InquiryPurgePreviewItem,
    InquiryPreviewRow,
    InquiryQuestion,
    InquirySceneDossier,
    InquiryWritebackOutcome,
    OmnibusProviderChoice,
    OmnibusProviderPlan
} from './types/inquiryViewTypes';
import {
    appendInquiryNotesToPendingEdits,
    isInquiryLine,
    normalizeInquiryLinkLine,
    validatePendingEditsValue,
    purgeInquiryNotesFromPendingEdits,
} from './pendingEditsSafety';
import { prepareFrontmatterRewrite, verifyFrontmatterRewrite } from '../utils/frontmatterWriteSafety';
import {
    buildSceneDossierHeader,
    buildStaleShortLabel,
    buildStaleTooltipLines,
    countSynopsisWords,
    getCorpusCcOrderNumber,
    formatApiErrorReason,
    formatAuthorFacingErrorDetail,
    formatAuthorFacingErrorHero,
    formatElapsedRunClock,
    formatInquiryBriefId,
    formatInquiryBriefLink,
    formatInquiryBriefShortDate,
    formatInquiryBriefTimestamp,
    formatInquiryId,
    formatRunDurationEstimate,
    formatTokenCountFailureReason,  // used by getEngineFailureGuidance to surface countTokens failures in the AI Engine popover
    formatPendingEditsSuccessMessage,
    formatPendingEditsTargetsTooltip,
    formatSessionOverrides,
    formatSessionProviderModel,
    formatSessionScope,
    formatSessionTime,
    formatTokenUsageVisibility,
    getDocumentStatusFields,
    getOrdinalSuffix,
    readFrontmatterWordCount,
    renderInquiryBrief,
    resolveFindingChipLabel,
    resolveInquiryScopeIndicator
} from './utils/inquiryViewText';
import {
    getBriefModelLabel as getBriefModelLabelPure,
    buildSceneDossierHoverKey as buildSceneDossierHoverKeyPure,
    getBriefSceneAnchorId as getBriefSceneAnchorIdPure,
    buildResultsHeroText as buildResultsHeroTextPure,
    buildResultsMetaText as buildResultsMetaTextPure,
    resolveInquiryBriefZoneLabel as resolveInquiryBriefZoneLabelPure,
    buildSceneDossierModel as buildSceneDossierModelPure,
    formatInquiryBriefTitle as formatInquiryBriefTitlePure,
    isFindingHit as isFindingHitPure,
    getFindingRole as getFindingRolePure,
    getResultSummaryForMode as getResultSummaryForModePure,
    getOrderedFindings as getOrderedFindingsPure,
    normalizeInquiryBriefText as normalizeInquiryBriefTextPure,
    buildInquiryReferenceLabelMap as buildInquiryReferenceLabelMapPure,
    buildInquirySceneReferenceIndex as buildInquirySceneReferenceIndexPure,
    getInquiryActionText as getInquiryActionTextPure,
    buildInquiryPendingAction as buildInquiryPendingActionPure,
    buildBriefPendingActions as buildBriefPendingActionsPure,
    buildInquirySceneNotes as buildInquirySceneNotesPure,
    buildInquiryBriefModel as buildInquiryBriefModelPure
} from './utils/inquiryBriefModel';
import {
    getResultSelectionMode as getResultSelectionModePure,
    getResultRoleValidation as getResultRoleValidationPure,
    computeRoleValidation as computeRoleValidationPure,
    buildFindingRowData as buildFindingRowDataPure,
    buildUnverifiedFindingRowData as buildUnverifiedFindingRowDataPure
} from './utils/inquiryFindingsPanel';
import {
    getMinimapItemFilePath as getMinimapItemFilePathPure,
    getCorpusCcModeMeta as getCorpusCcModeMetaPure,
    getCorpusCcHeaderLabel as getCorpusCcHeaderLabelPure,
    getCorpusCcHeaderDisplayLabel as getCorpusCcHeaderDisplayLabelPure,
    getCorpusCcHeaderTooltip as getCorpusCcHeaderTooltipPure
} from './utils/inquiryCorpusStripMinimap';
import { polarToCartesian } from './utils/inquiryGeometry';

const INQUIRY_PAYLOAD_STATS_REFRESH_DEBOUNCE_MS = 150;

export class InquiryView extends ItemView {
    static readonly viewType = INQUIRY_VIEW_TYPE;

    public readonly perfCounters = {
        hudTextWrites: 0,
        hudAttrWrites: 0,
        progressUpdateCalls: 0,
        progressDomPatches: 0,
        sweepAttrWrites: 0,
        refreshUICalls: 0,
        refreshCorpusCalls: 0,
        corpusRefreshMs: 0,
        svgTextWrites: 0,
        svgNodeCreates: 0,
        svgNodeReuses: 0,
        svgClearCalls: 0,
        svgAttrWrites: 0
    };

    private setTextIfChanged(el: Element | null | undefined, text: string, counterKey?: keyof InquiryView['perfCounters']): void {
        if (!el || el.textContent === text) return;
        el.textContent = text;
        if (counterKey) this.perfCounters[counterKey]++;
    }

    private toggleClassIfChanged(el: Element | null | undefined, cls: string, force: boolean, counterKey?: keyof InquiryView['perfCounters']): void {
        if (!el || el.classList.contains(cls) === force) return;
        el.classList.toggle(cls, force);
        if (counterKey) this.perfCounters[counterKey]++;
    }

    private updateRunningClockInterval?: number;
    /** Light poll started on reopen when an Inquiry run is in flight elsewhere. */
    private inquiryRecoveryPollHandle?: number;

    private plugin: RadialTimelinePlugin;
    private state = createDefaultInquiryState();
    // Slice 1 of InquirySessionController: owns the active-result lifecycle
    // subset of `state` (activeSessionId, activeResult, activeQuestionId,
    // activeZone, cacheStatus, corpus-fingerprint trio, lastError). Writes
    // through to the shared `state` object so existing read sites are
    // unchanged. See inquiry-session-controller-map-2026-05-21.md.
    private activeSession = new InquiryActiveSessionState({ state: this.state });
    // Slice 2a of InquirySessionController: owns the `mode` field and its
    // round-trip with `plugin.settings.inquiryLastMode`. Initialized in the
    // constructor body because the settings closures need `this.plugin`,
    // which is assigned by the constructor body (not a field initializer).
    private selection!: InquirySelectionState;
    // Slice 3 of InquirySessionController: read-side facade over the
    // `plugin.settings.inquiry*` keys. No defaulting, no normalization;
    // callers continue applying their own `?? fallback` semantics.
    private settingsAccessor!: InquirySettingsAccessor;

    private rootSvg?: SVGSVGElement;
    private scopeToggleButton?: SVGGElement;
    private scopeToggleIcon?: SVGUseElement;
    private modeToggleButton?: SVGGElement;
    private modeToggleIcon?: SVGUseElement;
    private artifactButton?: SVGGElement;
    private apiSimulationButton?: SVGGElement;
    private briefingPanelEl?: HTMLDivElement;
    private briefingListEl?: HTMLDivElement;
    private briefingFooterEl?: HTMLDivElement;
    private briefingClearButton?: HTMLButtonElement;
    private briefingResetButton?: HTMLButtonElement;
    private briefingPurgeButton?: HTMLButtonElement;
    private briefingSaveStateButton?: HTMLButtonElement;
    private briefingRestoreButton?: HTMLButtonElement;
    private briefingEmptyEl?: HTMLDivElement;
    private briefingPopover!: HoverPopoverController;
    private enginePopover!: HoverPopoverController;
    // View-scoped disposables — re-instantiated on each onOpen so the same
    // view instance can be reopened after onClose without leaking.
    private viewDisposables = new DisposableRegistry();
    private readonly briefingPurgeScanner = new InquiryBriefingPurgeScanner({
        getScenes: () => this.corpus?.scenes ?? [], // SAFE: corpus not loaded yet — purge scanner sees no scenes
        getScope: () => this.state.scope,
        getActiveBookId: () => this.corpus?.activeBookId,
        resolveActionNotesFieldLabel: () => this.resolveInquiryActionNotesFieldLabel(),
        scanForActionItems: (scenes) => this.scanForInquiryActionItems(scenes),
        onStateChange: () => this.updateBriefingFooterActionStates(),
    });
    private engineBadgeGroup?: SVGGElement;
    private enginePanelEl?: HTMLDivElement;
    private enginePanelAllLabelEl?: HTMLDivElement;
    private enginePanelGuardEl?: HTMLDivElement;
    private enginePanelGuardNoteEl?: HTMLDivElement;
    private enginePanelGuardTokenEl?: HTMLElement;
    private enginePanelListEl?: HTMLDivElement;
    private enginePanelMetaEl?: HTMLDivElement;
    private enginePanelReadinessEl?: HTMLDivElement;
    private enginePanelReadinessStatusEl?: HTMLDivElement;
    private enginePanelReadinessCorpusEl?: HTMLDivElement;
    private enginePanelReadinessMessageEl?: HTMLDivElement;
    private enginePanelReadinessActionsEl?: HTMLDivElement;
    private enginePanelReadinessScopeEl?: HTMLDivElement;
    private pendingGuardQuestion?: InquiryQuestion;
    private enginePanelFailureGuidance: EngineFailureGuidance | null = null;
    private lastEngineAdvisoryContext: InquiryAdvisoryContext | null = null;
    private lastEngineAdvisoryInputKey = '';
    /** Memoized per-refresh-cycle. Invalidated at top of refreshUI(). */
    private _resolvedEngine: ResolvedInquiryEngine | null = null;
    /** Memoized per-refresh-cycle. Invalidated at top of refreshUI(). */
    private _currentCorpusContext: InquiryCurrentCorpusContext | null = null;
    private omnibusAbortRequested = false;
    private activeOmnibusModal?: InquiryOmnibusModal;
    private activeCancelRunModal?: InquiryCancelRunModal;
    private readonly minimap = new InquiryMinimapRenderer();
    private wasRunning = false;
    private zonePromptElements = new Map<InquiryZone, {
        group: SVGGElement;
        bg: SVGRectElement;
        glow: SVGRectElement;
        text: SVGTextElement;
    }>();
    private glyphAnchor?: SVGGElement;
    private glyph?: InquiryGlyph;
    private glyphHit?: SVGRectElement;
    private flowRingHit?: SVGCircleElement;
    private depthRingHit?: SVGCircleElement;
    private flowModeIconEl?: SVGSVGElement;
    private depthModeIconEl?: SVGSVGElement;
    private modeIconToggleHit?: SVGRectElement;
    private findingsTitleEl?: SVGTextElement;
    private summaryEl?: SVGTextElement;
    private verdictEl?: SVGTextElement;
    private findingsListEl?: SVGGElement;
    private detailsToggle?: SVGGElement;
    private detailsIcon?: SVGUseElement;
    private detailsEl?: SVGGElement;
    private detailRows: SVGTextElement[] = [];
    private artifactPreviewEl?: SVGGElement;
    private artifactPreviewBg?: SVGRectElement;
    private hoverTextEl?: SVGTextElement;
    private sceneDossierGroup?: SVGGElement;
    private sceneDossierComposition?: SVGGElement;
    private sceneDossierFocusCore?: SVGCircleElement;
    private sceneDossierFocusGlow?: SVGCircleElement;
    private sceneDossierFocusOutline?: SVGCircleElement;
    private sceneDossierBg?: SVGRectElement;
    private sceneDossierBraceLeft?: SVGTextElement;
    private sceneDossierBraceRight?: SVGTextElement;
    private sceneDossierTextGroup?: SVGGElement;
    private sceneDossierCoreGroup?: SVGGElement;
    private sceneDossierHeader?: SVGTextElement;
    private sceneDossierAnchor?: SVGTextElement;
    private sceneDossierBody?: SVGTextElement;
    private sceneDossierBodySecondary?: SVGTextElement;
    private sceneDossierBodyDivider?: SVGLineElement;
    private sceneDossierFooter?: SVGTextElement;
    private sceneDossierSource?: SVGTextElement;
    private sceneDossier!: SceneDossierController;
    private previewGroup?: SVGGElement;
    private previewHero?: SVGTextElement;
    private previewMeta?: SVGTextElement;
    private previewRunningNote?: SVGTextElement;
    private previewFooter?: SVGTextElement;
    private previewClickTarget?: SVGRectElement;
    private previewRows: InquiryPreviewRow[] = [];
    private previewRowDefaultLabels: string[] = [];
    private previewHideTimer?: number;
    private previewLast?: { zone: InquiryZone; question: string; questionId?: string };
    private previewLocked = false;
    private previewShimmerGroup?: SVGGElement;
    private previewShimmerMask?: SVGMaskElement;
    private previewShimmerMaskRect?: SVGRectElement;
    private previewPanelHeight = 0;
    private payloadStats?: InquiryPayloadStats;
    private entryBodyCharCache = new Map<string, { mtime: number; chars: number }>();
    private entryBodyCharLoads = new Map<string, Promise<void>>();
    private payloadStatsRefreshTimer?: number;
    private payloadStatsRefreshDirty = false;
    private sourcesRefreshTimer?: number;
    private duplicatePulseTimer?: number;
    private rehydratePulseTimer?: number;
    private rehydrateHighlightTimer?: number;
    private rehydrateTargetKey?: string;
    private ccGroup?: SVGGElement;
    private ccLabelGroup?: SVGGElement;
    private ccLabelHit?: SVGRectElement;
    private ccLabel?: SVGTextElement;
    private ccCorpusLabel?: SVGTextElement;
    private ccCorpusUnderline?: SVGLineElement;
    private ccLegendTrigger?: SVGGElement;
    private ccLegendPanel?: SVGGElement;
    private ccLabelHint?: SVGGElement;
    private ccLabelHintIcon?: SVGUseElement;
    private ccEmptyText?: SVGTextElement;
    private ccClassLabels: CorpusCcHeader[] = [];
    private ccEntries: CorpusCcEntry[] = [];
    private ccSlots: CorpusCcSlot[] = [];
    private ccUpdateId = 0;
    private ccLayout?: { pageWidth: number; pageHeight: number; gap: number };
    private ccWordCache = new Map<string, {
        mtime: number;
        bodyWords: number;
        synopsisWords: number;
        synopsisQuality: SynopsisQuality;
        statusRaw?: string;
        due?: string;
        title?: string;
    }>();
    private corpusService = new InquiryCorpusService();
    private corpusWarningActive = false;
    private apiSimulationTimer?: number;
    private navPrevButton?: SVGGElement;
    private navNextButton?: SVGGElement;
    private navPrevIcon?: SVGUseElement;
    private navNextIcon?: SVGUseElement;
    private navSessionLabel?: SVGTextElement;
    private engineTimerIcon?: SVGUseElement;
    private engineTimerLabel?: SVGTextElement;
    private helpToggleButton?: SVGGElement;
    private helpTipsEnabled = false;
    private iconSymbols = new Set<string>();
    private svgDefs?: SVGDefsElement;
    private startupFreshMode = false;
    private freshModeTouchedBookIds = new Set<string>();
    // lastTargetSceneIdsByBookId + targetPersistTimer moved into
    // InquirySelectionState (Slice 2b). See selection.* method calls.
    // Corpus snapshot lifecycle (Slice 1) — the InquiryCorpusSnapshotController
    // owns the resolver and the refresh() entry point. `corpus` is the
    // write-through slot the controller writes to, so the 22+ existing
    // `this.corpus?.X` read sites are unchanged. Field is non-private so
    // the controller's host reference can write to it from outside the
    // class without TS access-modifier complaints.
    corpus?: InquiryCorpusSnapshot;
    private corpusSnapshot!: InquiryCorpusSnapshotController;
    private runner: InquiryRunnerService;
    private sessionStore: InquirySessionStore;
    private minimapResultPreviewActive = false;
    private guidanceState: InquiryGuidanceState = 'ready';
    // Stamped name of a packaged demo vault (from the sidecar), or null. Used to
    // make the no-api-key state read as an honest "Demo Vault" rather than a
    // half-configured engine.
    private demoVaultName: string | null = null;
    private inquiryRunTokenCounter = 0;
    private activeInquiryRunToken = 0;
    private cancelledInquiryRunTokens = new Set<number>();
    private currentRunProgress: InquiryRunProgressEvent | null = null;
    private currentRunElapsedMs = 0;
    private currentRunEstimatedMaxMs = 0;
    private lastAnthropicDispatchPrefixByEngine = new Map<string, string>();

    constructor(leaf: WorkspaceLeaf, plugin: RadialTimelinePlugin) {
        super(leaf);
        this.plugin = plugin;
        this.addAction('bug', 'Report a bug', () => {
            new BugReportModal(this.app, this.plugin, 'inquiry').open();
        });
        // Slice 2a controller — must be constructed before any mode hydration
        // call. The settings closures capture `this.plugin` so the controller
        // never imports RadialTimelinePlugin directly.
        // Slice 3: read-side facade. Constructed before the selection
        // controller so closures here see a fully-initialized accessor.
        this.settingsAccessor = new InquirySettingsAccessor(() => this.plugin.settings);
        this.selection = new InquirySelectionState(
            { state: this.state },
            {
                getPersistedLastMode: () => this.plugin.settings.inquiryLastMode,
                setPersistedLastMode: (mode) => { this.plugin.settings.inquiryLastMode = mode; },
                setTargetCache: (cache) => { this.plugin.settings.inquiryTargetCache = cache; },
                saveSettings: () => this.plugin.saveSettings(),
            }
        );
        const mappings = getActiveFrontmatterMappings(this.plugin.settings);
        this.runner = new InquiryRunnerService(this.plugin, this.app.vault, this.app.metadataCache, mappings);
        this.selection.applyPersistedLastModeOr(createDefaultInquiryState().mode);
        this.ensurePromptConfig();
        this.state.selectedPromptIds = this.buildDefaultSelectedPromptIds();
        this.sessionStore = new InquirySessionStore(plugin);
        // Corpus snapshot lifecycle. The controller's host reference is
        // `this` — it writes through to the `corpus` field on this view.
        // The mappings closure is read on every refresh so frontmatter-
        // mapping changes between refreshes are observed (audit Risk #1).
        this.corpusSnapshot = new InquiryCorpusSnapshotController(
            this,
            this.app.vault,
            this.app.metadataCache,
            () => getActiveFrontmatterMappings(this.plugin.settings)
        );
    }

    private registerSvgEvent<TEvent extends Event>(
        element: SVGElement | undefined,
        event: string,
        handler: (event: TEvent) => void,
        options?: boolean | AddEventListenerOptions
    ): void {
        if (!element) return;
        const listener = handler;
        element.addEventListener(event, listener, options);
        this.register(() => element.removeEventListener(event, listener, options));
    }

    private registerBoundDomEvent(
        element: HTMLElement | undefined,
        event: string,
        handler: EventListener,
        options?: boolean | AddEventListenerOptions
    ): void {
        if (!element) return;
        this.registerDomEvent(element, event, handler, options);
    }

    // Lifecycle
    getViewType(): string {
        return INQUIRY_VIEW_TYPE;
    }

    getDisplayText(): string {
        return this.buildDynamicDisplayText();
    }

    private buildDynamicDisplayText(): string {
        const base = INQUIRY_VIEW_DISPLAY_TEXT;
        if (this.state?.scope === 'saga') {
            const labels = (this.corpus?.books ?? []) // SAFE: corpus not loaded yet — tab title omits book labels
                .map(book => book.displayLabel)
                .filter((label): label is string => !!label && label !== '?');
            if (labels.length) return `${base}: Saga · ${labels.join(' · ')}`;
            return `${base}: Saga`;
        }
        const bookTitle = this.getActiveBookTitleForMessages();
        if (bookTitle) return `${base}: ${bookTitle}`;
        const bookLabel = this.getActiveBookLabel();
        if (bookLabel && bookLabel !== '?') return `${base}: ${bookLabel}`;
        return base;
    }

    private updateViewTitle(): void {
        const titleText = this.buildDynamicDisplayText();
        const headerTitle = this.containerEl.querySelector('.view-header-title');
        if (headerTitle && headerTitle.textContent !== titleText) {
            headerTitle.textContent = titleText;
        }
        const tabTitle = this.containerEl
            .closest('.workspace-leaf')
            ?.querySelector('.workspace-tab-header-inner-title') as HTMLElement | null;
        if (tabTitle && tabTitle.textContent !== titleText) {
            tabTitle.textContent = titleText;
        }
    }

    getIcon(): string {
        return 'waves';
    }

    async onOpen(): Promise<void> {
        this.contentEl.empty();
        if (Platform.isMobile) { // SAFE: Platform imported from obsidian at top of file
            this.renderMobileGate();
            return;
        }
        this.viewDisposables = new DisposableRegistry();
        this.registerViewTimerCleanups();
        // Load the session cache from the vault sidecar (single source of truth)
        // and arm writes BEFORE any session-touching UI work below. The store is
        // constructed with an empty cache; without this awaited hydrate the first
        // interaction would flush that empty cache over a good sessions.json.
        await this.sessionStore.hydrate();
        this.demoVaultName = (await readInquirySidecarVaultIdentity(this.app))?.displayName ?? null;
        const freshLaunchPending = this.plugin.consumeInquiryFreshLaunchPending();
        if (!this.state.isRunning) {
            this.clearRehydrateState();
            this.clearActiveResultState();
            this.clearResultPreview();
            this.unlockPromptPreview();
            this.setApiStatus('idle');
        }
        this.startupFreshMode = freshLaunchPending || !this.state.isRunning;
        this.freshModeTouchedBookIds.clear();
        this.loadTargetCache({ adoptPersistedSelection: !this.startupFreshMode });
        this.renderDesktopLayout();
        this.refreshUI();
        this.recoverInquiryRunOnOpen();

        // SVG text cannot be measured while the leaf is hidden (display:none),
        // so a result that lands on a backgrounded tab wraps to a single line.
        // Re-render the active result's hero when this view becomes active again
        // so the now-measurable text wraps correctly. Mirrors the
        // active-leaf-change re-render pattern in TimeLineView.
        this.registerEvent(this.app.workspace.on('active-leaf-change', () => {
            if (this.app.workspace.getActiveViewOfType(InquiryView) !== this) return;
            if (this.isResultsState() && this.state.activeResult) {
                this.showResultsPreview(this.state.activeResult);
            }
        }));
    }

    /**
     * If a run is in flight on the plugin marker (started by a now-closed
     * view instance), surface a passive status and lightly poll the
     * persisted session cache until that run completes, then load its
     * result through the existing session-load path. Starts no new run and
     * never touches cancellation or cache-truth semantics.
     */
    private recoverInquiryRunOnOpen(): void {
        // This view itself running its own run → nothing to recover.
        if (this.state.isRunning) return;
        this.sessionStore.reloadFromSettings();
        const marker = this.plugin._inquiryRunInFlight;
        if (!marker) return;
        const sessionKey = marker.sessionKey;

        // Already finished between persist and our reopen → load immediately.
        if (this.sessionStore.peekSession(sessionKey)) {
            this.reopenSessionByKey(sessionKey);
            return;
        }

        // Passive in-progress status (no spinner, no run state change).
        this.setTextIfChanged(
            this.navSessionLabel,
            t('inquiry.nav.backgroundRunInProgress'),
            'hudTextWrites'
        );
        if (this.inquiryRecoveryPollHandle !== undefined) {
            window.clearInterval(this.inquiryRecoveryPollHandle);
        }
        const handle = window.setInterval(() => {
            this.sessionStore.reloadFromSettings();
            const stillRunning = this.plugin._inquiryRunInFlight?.sessionKey === sessionKey;
            const session = this.sessionStore.peekSession(sessionKey);
            if (!stillRunning && session) {
                window.clearInterval(handle);
                if (this.inquiryRecoveryPollHandle === handle) {
                    this.inquiryRecoveryPollHandle = undefined;
                }
                this.reopenSessionByKey(sessionKey);
            }
        }, 2000);
        this.registerInterval(handle);
        this.inquiryRecoveryPollHandle = handle;
    }

    async onClose(): Promise<void> {
        // The run promise is owned by this instance but is NOT aborted on
        // close — it keeps running and persists its session. Tell the user
        // they can come back; the reopened view will pick it up.
        if (this.state.isRunning) {
            new Notice(t('inquiry.notice.runContinuesInBackground'));
        }
        // Drain any pending debounced session save before teardown so the
        // sidecar is current on close. A background run that is still going
        // persists its own session via the write-through in saveBrief().
        await this.sessionStore.flush();
        // All tracked view-scoped timers are cleared in LIFO order; one bad
        // cleanup cannot block the others.
        this.viewDisposables.disposeAll();
        this.briefingPopover?.cleanup();
        this.enginePopover?.cleanup();
        this.sceneDossier?.cleanup();
        this.selection?.cleanup();
        this.payloadStatsRefreshDirty = false;
        this.contentEl.empty();
    }

    /**
     * Register the per-onOpen timer-clear closures with the view registry.
     * Each timer field is captured by closure, so cleanup always reads the
     * current value at disposal time. Field names cannot be compile-time
     * checked because they are private (`keyof this`/`keyof InquiryView`
     * both omit private members); the runtime numeric guard inside
     * {@link clearTrackedTimer} prevents misuse if a name is typo'd.
     */
    private registerViewTimerCleanups(): void {
        const self = this as unknown as Record<string, number | undefined>;
        const track = (key: string, kind: 'timeout' | 'interval' = 'timeout'): void => {
            this.viewDisposables.add(() => clearTrackedTimer(self, key, kind));
        };
        track('inquiryRecoveryPollHandle', 'interval');
        track('updateRunningClockInterval', 'interval');
        track('apiSimulationTimer');
        track('payloadStatsRefreshTimer');
        track('sourcesRefreshTimer');
    }

    // Shell Composition
    private renderMobileGate(): void {
        const wrapper = this.contentEl.createDiv({ cls: 'ert-inquiry-mobile ert-ui' });
        wrapper.createDiv({ cls: 'ert-inquiry-mobile-title', text: t('inquiry.mobile.title') });
        wrapper.createDiv({
            cls: 'ert-inquiry-mobile-subtitle',
            text: t('inquiry.mobile.subtitle')
        });

        const actions = wrapper.createDiv({ cls: 'ert-inquiry-mobile-actions' });
        const openFolderBtn = actions.createEl('button', { cls: 'ert-inquiry-mobile-btn', text: t('inquiry.mobile.openBriefs') });
        const openLatestBtn = actions.createEl('button', { cls: 'ert-inquiry-mobile-btn', text: t('inquiry.mobile.viewLatest') });

        bindInquiryMobileGateEvents({
            registerDomEvent: (element, event, handler, options) => this.registerBoundDomEvent(element, event, handler, options),
            openFolderButton: openFolderBtn,
            openLatestButton: openLatestBtn,
            onOpenFolder: () => { void this.openArtifactsFolder(); },
            onOpenLatest: () => { void this.openMostRecentArtifact(); }
        });
    }

    private renderDesktopLayout(): void {
        const shell = createInquiryDesktopShell({
            contentEl: this.contentEl,
            populateDefs: defs => {
                this.svgDefs = defs;
                this.buildIconSymbols(defs);
                this.buildZoneGradients(defs);
                this.buildSceneDossierResources(defs);
            },
            createIconButton: this.createIconButton.bind(this),
            getBackgroundHref: () => this.getInquiryAssetHref('images/radial_texture.png'),
            buildDebugOverlay: this.buildDebugOverlay.bind(this)
        });
        this.rootSvg = shell.rootSvg;
        this.scopeToggleButton = shell.scopeToggleButton;
        this.scopeToggleIcon = shell.scopeToggleIcon;
        this.artifactButton = shell.artifactButton;
        this.apiSimulationButton = shell.apiSimulationButton;
        this.helpToggleButton = shell.helpToggleButton;
        this.engineBadgeGroup = shell.engineBadgeGroup;
        this.engineTimerIcon = shell.engineTimerIcon;
        this.engineTimerLabel = shell.engineTimerLabel;
        this.navPrevButton = shell.navPrevButton;
        this.navNextButton = shell.navNextButton;
        this.navPrevIcon = shell.navPrevIcon;
        this.navNextIcon = shell.navNextIcon;
        this.navSessionLabel = shell.navSessionLabel;

        this.registerSvgEvent(this.engineTimerIcon, 'click', () => this.clearContextWindow());
        this.registerSvgEvent(this.engineTimerLabel, 'click', () => this.clearContextWindow());

        setupTooltipsFromDataAttributes(this.rootSvg, this.registerDomEvent.bind(this), { rtOnly: true });
        this.minimap.initElements(shell.minimapGroup, VIEWBOX_SIZE);
        this.renderModeIcons(shell.minimapGroup);

        this.glyphAnchor = shell.glyphAnchor;
        const glyphSeed = this.resolveGlyphSeed();
        this.glyph = new InquiryGlyph(this.glyphAnchor, {
            scopeLabel: this.getScopeLabel(),
            flowValue: glyphSeed.flowValue,
            depthValue: glyphSeed.depthValue,
            flowVisualValue: glyphSeed.flowVisualValue,
            depthVisualValue: glyphSeed.depthVisualValue
        });

        this.flowRingHit = this.glyph.flowRingHit;
        this.depthRingHit = this.glyph.depthRingHit;
        this.glyphHit = this.glyph.labelHit;

        this.buildPromptPreviewPanel(shell.canvasGroup);
        this.buildSceneDossierLayer(this.rootSvg, SCENE_DOSSIER_CANVAS_Y);
        bindInquiryDesktopShellEvents({
            registerDomEvent: (element, event, handler, options) => this.registerBoundDomEvent(element, event, handler, options),
            registerSvgEvent: this.registerSvgEvent.bind(this),
            contentEl: this.contentEl,
            scopeToggleButton: this.scopeToggleButton,
            apiSimulationButton: this.apiSimulationButton,
            helpToggleButton: this.helpToggleButton,
            artifactButton: this.artifactButton,
            engineBadgeGroup: this.engineBadgeGroup,
            glyphHit: this.glyphHit,
            flowRingHit: this.flowRingHit,
            depthRingHit: this.depthRingHit,
            modeIconToggleHit: this.modeIconToggleHit,
            navPrevButton: this.navPrevButton,
            navNextButton: this.navNextButton,
            onBackgroundClick: (event: MouseEvent) => {
                if (!this.isErrorState()) return;
                const target = event.target;
                if (!(target instanceof Element)) return;
                const backgroundTarget = target.closest('.ert-inquiry-bg, .ert-inquiry-bg-image');
                if (!backgroundTarget) return;
                this.dismissError();
            },
            onScopeToggle: () => this.handleScopeChange(this.state.scope === 'book' ? 'saga' : 'book'),
            onApiSimulation: () => this.startApiSimulation(),
            onHelpToggle: () => this.handleGuidanceHelpClick(),
            onArtifactEnter: () => this.briefingPopover.show(),
            onArtifactLeave: () => this.briefingPopover.scheduleHide(),
            onArtifactClick: () => this.briefingPopover.toggle(),
            onEngineEnter: () => this.enginePopover.show(),
            onEngineLeave: () => this.enginePopover.scheduleHide(),
            // Open the engine popover (which carries the readiness strip — incl.
            // the "key is missing, add one in AI settings" state — and an explicit
            // Open AI Settings button) rather than jumping straight to Settings.
            // Mirrors the sibling artifact button's toggle interaction.
            onEngineClick: () => this.enginePopover.toggle(),
            onGlyphClick: () => {
                if (this.isInquiryGuidanceLockout()) return;
                this.handleGlyphClick();
            },
            onFlowRingClick: () => {
                if (this.isInquiryGuidanceLockout()) return;
                this.handleRingClick('flow');
            },
            onDepthRingClick: () => {
                if (this.isInquiryGuidanceLockout()) return;
                this.handleRingClick('depth');
            },
            onModeIconClick: () => {
                if (this.isInquiryGuidanceLockout()) return;
                this.handleModeIconToggleClick();
            },
            onModeIconEnter: () => {
                if (this.isInquiryGuidanceLockout() || this.state.isRunning) return;
                this.setModeIconHoverState(true);
                this.setHoverText(this.buildModeToggleHoverText());
            },
            onModeIconLeave: () => {
                this.setModeIconHoverState(false);
                if (this.isInquiryGuidanceLockout()) return;
                this.clearHoverText();
            },
            onModeIconKeydown: (event: KeyboardEvent) => {
                if (this.isInquiryGuidanceLockout()) return;
                if (event.key !== 'Enter' && event.key !== ' ') return;
                event.preventDefault();
                this.handleModeIconToggleClick();
            },
            onGlyphEnter: () => {
                if (this.isInquiryGuidanceLockout()) return;
                this.setHoverText(this.buildScopeHoverText());
            },
            onGlyphLeave: () => {
                if (this.isInquiryGuidanceLockout()) return;
                this.clearHoverText();
            },
            onFlowRingEnter: () => {
                if (this.isInquiryGuidanceLockout()) return;
                this.setHoverText(this.buildRingHoverText('flow'));
            },
            onFlowRingLeave: () => {
                if (this.isInquiryGuidanceLockout()) return;
                this.clearHoverText();
            },
            onDepthRingEnter: () => {
                if (this.isInquiryGuidanceLockout()) return;
                this.setHoverText(this.buildRingHoverText('depth'));
            },
            onDepthRingLeave: () => {
                if (this.isInquiryGuidanceLockout()) return;
                this.clearHoverText();
            },
            onNavPrev: () => this.shiftFocus(-1),
            onNavNext: () => this.shiftFocus(1)
        });

        this.buildBriefingPanel();
        this.buildEnginePanel();
    }

    private buildPromptPreviewPanel(parent: SVGGElement): void {
        const refs = createInquiryPromptPreviewPanel({
            parent,
            ensurePreviewShimmerResources: (panel) => {
                this.ensurePreviewShimmerResources(panel);
                return {
                    mask: this.previewShimmerMask,
                    maskRect: this.previewShimmerMaskRect
                };
            }
        });
        this.previewGroup = refs.previewGroup;
        this.previewRunningNote = refs.previewRunningNote;
        this.previewHero = refs.previewHero;
        this.previewMeta = refs.previewMeta;
        this.previewFooter = refs.previewFooter;
        this.previewClickTarget = refs.previewClickTarget;
        this.previewRows = refs.previewRows;
        this.previewRowDefaultLabels = refs.previewRowDefaultLabels;
        this.previewShimmerGroup = refs.previewShimmerGroup;

        bindInquiryPreviewPanelEvents({
            registerSvgEvent: this.registerSvgEvent.bind(this),
            previewGroup: this.previewGroup,
            onClick: (event: MouseEvent) => {
                if (this.state.isRunning) {
                    event.stopPropagation();
                    void this.handleRunningPreviewCancelClick();
                    return;
                }
                if (this.isErrorState()) {
                    event.stopPropagation();
                    void this.openInquiryErrorLog();
                    return;
                }
                if (!this.isResultsState()) return;
                event.stopPropagation();
                this.dismissResults();
            }
        });

        this.updatePromptPreview('setup', this.state.mode, t('inquiry.preview.hoverPreview'), undefined, undefined, { hideEmpty: true });
        this.hidePromptPreview(true);
    }

    private buildBriefingPanel(): void {
        if (this.briefingPanelEl) return;
        const refs = createInquiryBriefingPanel(this.contentEl);
        this.briefingPanelEl = refs.briefingPanelEl;
        this.briefingListEl = refs.briefingListEl;
        this.briefingEmptyEl = refs.briefingEmptyEl;
        this.briefingFooterEl = refs.briefingFooterEl;
        this.briefingClearButton = refs.briefingClearButton;
        this.briefingResetButton = refs.briefingResetButton;
        this.briefingPurgeButton = refs.briefingPurgeButton;
        this.briefingSaveStateButton = refs.briefingSaveStateButton;
        this.briefingRestoreButton = refs.briefingRestoreButton;

        this.briefingPopover = new HoverPopoverController({
            beforeShow: () => {
                this.refreshBriefingPanel();
                void this.briefingPurgeScanner.refresh();
            },
            positionPanel: () => {
                if (this.artifactButton && this.briefingPanelEl) {
                    anchorPanelNearTrigger(this.briefingPanelEl, this.artifactButton, this.contentEl, 'right');
                }
            }
        }, BRIEFING_HIDE_DELAY_MS);
        this.briefingPopover.attach(this.briefingPanelEl);

        bindInquiryBriefingPanelEvents({
            registerDomEvent: (element, event, handler, options) => this.registerBoundDomEvent(element, event, handler, options),
            briefingPanelEl: this.briefingPanelEl,
            briefingClearButton: this.briefingClearButton,
            briefingResetButton: this.briefingResetButton,
            briefingPurgeButton: this.briefingPurgeButton,
            briefingSaveStateButton: this.briefingSaveStateButton,
            briefingRestoreButton: this.briefingRestoreButton,
            onClearClick: (event: MouseEvent) => {
                event.stopPropagation();
                this.handleBriefingClearClick();
            },
            onResetClick: (event: MouseEvent) => {
                event.stopPropagation();
                this.handleBriefingResetCorpusClick();
            },
            onPurgeClick: (event: MouseEvent) => {
                event.stopPropagation();
                void this.handleBriefingPurgeClick();
            },
            onSaveStateClick: (event: MouseEvent) => {
                event.stopPropagation();
                void this.handleBriefingSaveStateClick();
            },
            onRestoreClick: (event: MouseEvent) => {
                event.stopPropagation();
                void this.handleBriefingRestoreClick();
            },
            onPointerEnter: () => this.briefingPopover.cancelHide(),
            onPointerLeave: () => this.briefingPopover.scheduleHide()
        });
        this.refreshBriefingPanel();
        void this.briefingPurgeScanner.refresh();
    }

    private buildEnginePanel(): void {
        if (this.enginePanelEl) return;
        const refs = createInquiryEnginePanel(this.contentEl);
        this.enginePanelEl = refs.enginePanelEl;
        this.enginePanelMetaEl = refs.enginePanelMetaEl;
        this.enginePanelReadinessEl = refs.enginePanelReadinessEl;
        this.enginePanelReadinessStatusEl = refs.enginePanelReadinessStatusEl;
        this.enginePanelReadinessCorpusEl = refs.enginePanelReadinessCorpusEl;
        this.enginePanelReadinessMessageEl = refs.enginePanelReadinessMessageEl;
        this.enginePanelReadinessScopeEl = refs.enginePanelReadinessScopeEl;
        this.enginePanelReadinessActionsEl = refs.enginePanelReadinessActionsEl;
        this.enginePanelGuardEl = refs.enginePanelGuardEl;
        this.enginePanelGuardNoteEl = refs.enginePanelGuardNoteEl;
        this.enginePanelListEl = refs.enginePanelListEl;

        this.enginePopover = new HoverPopoverController({
            beforeShow: () => this.refreshEnginePanel(),
            positionPanel: () => {
                if (this.engineBadgeGroup && this.enginePanelEl) {
                    anchorPanelNearTrigger(this.enginePanelEl, this.engineBadgeGroup, this.contentEl, 'left');
                }
            }
        }, BRIEFING_HIDE_DELAY_MS);
        this.enginePopover.attach(this.enginePanelEl);

        bindInquiryEnginePanelEvents({
            registerDomEvent: (element, event, handler, options) => this.registerBoundDomEvent(element, event, handler, options),
            enginePanelEl: this.enginePanelEl,
            onPointerEnter: () => this.enginePopover.cancelHide(),
            onPointerLeave: () => this.enginePopover.scheduleHide()
        });
        this.refreshEnginePanel();
    }

    /**
     * Render the engine panel as a read-only status/diagnostics display.
     *
     * Shows the resolved engine from canonical AI Strategy (not a model picker).
     * Inquiry does not choose models — it reports the resolved engine.
     */
    private refreshEnginePanel(): void {
        if (!this.enginePanelListEl) return;
        this.enginePanelListEl.empty();

        const engine = this.getResolvedEngine();
        const readinessUi = this.buildReadinessUiState();
        const advisoryContext = this.buildInquiryAdvisoryContext(readinessUi);
        const currentCorpus = this.getCurrentCorpusContext();
        this.lastEngineAdvisoryContext = advisoryContext;

        const failureGuidance = this.getEngineFailureGuidance();
        this.enginePanelFailureGuidance = failureGuidance;

        // ── 1. Header summary (non-repeated) ──
        if (this.enginePanelMetaEl) {
            // In Demo Mode be honest: no key is set, this is a packaged vault.
            this.enginePanelMetaEl.setText(
                this.isInquiryDemoMode()
                    ? `No API key set · Demo Vault: ${this.getDemoVaultLabel()}`
                    : `${engine.providerLabel} · ${engine.modelLabel}`
            );
        }

        // ── 2. Status card (readiness strip) ──
        renderInquiryEngineReadinessStrip({
            readinessEl: this.enginePanelReadinessEl,
            readinessStatusEl: this.enginePanelReadinessStatusEl,
            readinessCorpusEl: this.enginePanelReadinessCorpusEl,
            readinessMessageEl: this.enginePanelReadinessMessageEl,
            readinessActionsEl: this.enginePanelReadinessActionsEl,
            readinessScopeEl: this.enginePanelReadinessScopeEl,
            providerLabel: engine.provider === 'ollama' ? 'Local LLM' : engine.providerLabel,
            popoverState: this.resolveEnginePopoverState(readinessUi),
            blocked: !!engine.blocked,
            readOnlyNoKey: this.isInquiryApiKeyMissing(),
            hasSavedBriefings: this.hasInquirySessions(),
            corpusSummary: buildInquiryEngineCorpusSummary(
                currentCorpus.corpus,
                currentCorpus.requestTokens,
                this.formatApproxCorpusTokens.bind(this),
                currentCorpus.requestEstimateMethod
            ),
            passPlan: this.getCurrentPassPlan(readinessUi),
            readinessCause: readinessUi.readiness.cause,
            readinessReason: readinessUi.reason,
            runScopeLabel: this.getEngineRunScopeLabel(readinessUi.runScopeLabel),
            cacheTtlLabel: this.getProviderCacheTtlLabel(engine.provider),
            citationsRequested: this.areInquiryProviderCitationsEnabled(engine.provider),
            providerSupportsCitations: engine.provider !== 'none' && engine.provider !== 'ollama'
                ? providerSupportsCitations(engine.provider)
                : false,
            // "Last run cost" / "Cache created" come from baked session data. With
            // no real key (Demo Mode) they're stale dev metadata — suppress them so
            // a keyless vault doesn't claim a warm cache or a prior run cost.
            recentRun: engine.hasCredential ? this.buildEngineRecentRunSnapshot() : undefined,
            cacheWindow: engine.hasCredential ? this.buildEngineCacheWindowSnapshot() : undefined
        });

        // ── Guard (error/failure guidance) ──
        if (this.enginePanelGuardEl) {
            const showGuard = Boolean(failureGuidance);
            this.enginePanelGuardEl.classList.toggle('ert-hidden', !showGuard);
            this.enginePanelGuardEl.classList.toggle('is-error-guidance', Boolean(failureGuidance));
            if (this.enginePanelGuardNoteEl && failureGuidance) {
                this.enginePanelGuardNoteEl.empty();
                this.enginePanelGuardTokenEl = undefined;
                this.enginePanelGuardNoteEl.setText(failureGuidance.message);
            }
        }

        // ── 3. Advisor slot ──
        const advisorSlot = this.enginePanelListEl.createDiv({ cls: 'ert-inquiry-engine-advisor-slot' });
        if (advisoryContext) {
            renderInquiryEngineAdvisoryCard(advisorSlot, advisoryContext);
        }

        // ── 4. Action row ──
        const { settingsButton, logButton } = createInquiryEngineActionButtons(this.enginePanelListEl);
        bindInquiryEngineActionButtons({
            registerDomEvent: (element, event, handler, options) => this.registerBoundDomEvent(element, event, handler, options),
            settingsButton,
            logButton,
            onSettingsClick: (event: MouseEvent) => {
                event.stopPropagation();
                this.enginePopover?.hide(true);
                this.openAiSettings(['provider']);
            },
            onLogClick: (event: MouseEvent) => {
                event.stopPropagation();
                this.enginePopover?.hide(true);
                void this.openInquiryErrorLog();
            }
        });
    }

    private openAiSettings(targets: AiSettingsFocus[] = []): void {
        if (this.plugin.settingsTab) {
            this.plugin.settingsTab.setActiveTab('ai');
        }
        // SAFE: any type used for accessing Obsidian's internal settings API
        const setting = (this.app as unknown as { setting?: { open: () => void; openTabById: (id: string) => void } }).setting;
        if (setting) {
            setting.open();
            setting.openTabById('radial-timeline');
        }
        window.setTimeout(() => {
            if (this.plugin.settingsTab) {
                this.plugin.settingsTab.setActiveTab('ai');
            }
            const uniqueTargets = Array.from(new Set(targets));
            uniqueTargets.forEach((target, index) => {
                window.setTimeout(() => this.scrollAndPulseAiSetting(target, index === 0), index * 120);
            });
        }, 180);
    }

    private scrollAndPulseAiSetting(target: AiSettingsFocus, shouldScroll: boolean): void {
        const el = activeDocument.querySelector(`[data-ert-role="ai-setting:${target}"]`);
        if (!(el instanceof HTMLElement)) return;
        if (shouldScroll) {
            el.scrollIntoView({ block: 'center' });
        }
        replayTransientClass(el, 'is-attention-pulse', { durationMs: 2600 });
    }

    private getEngineFailureGuidance(): EngineFailureGuidance | null {
        // Last-run error takes precedence — a real failure on the most
        // recent run is the loudest thing to surface in the popover.
        const result = this.state.activeResult;
        if (result && this.isErrorResult(result)) {
            const hero = formatAuthorFacingErrorHero(result);
            const detail = result.aiErrorDetail ? `\n${result.aiErrorDetail}` : '';
            return {
                message: `${hero}${detail}\nOpen Inquiry Log for detailed error report.`
            };
        }
        // No active error — but if the most recent pre-flight token
        // count failed, surface that here too. Without this, the pills
        // say "unavailable" with no indication of *why* and the user
        // has no path to diagnose. The popover is the canonical error
        // surface (red), matching the months-long pattern.
        // With no key the token count is EXPECTED to be unavailable — that's a
        // calm capability limit, not a diagnosable failure, so don't raise the red
        // guard for it (Demo Mode stays calm).
        const corpus = this.getCurrentCorpusContext();
        if (corpus.requestEstimateMethod === 'unavailable' && corpus.requestEstimateFailureMessage && !this.isInquiryApiKeyMissing()) {
            const reason = formatTokenCountFailureReason(corpus.requestEstimateFailureMessage)
                || 'provider token count failed'; // SAFE: UX default — formatter may yield an empty reason; generic text keeps the error readable
            return {
                message: `Couldn't reach the AI provider to size this Inquiry — ${reason}.\nYou can still run it; the estimate and cost just won't show until the provider responds.`
            };
        }
        return null;
    }

    private getEngineContextQuestion(): string | null {
        if (this.pendingGuardQuestion) {
            return this.resolveQuestionPromptForRun(
                this.pendingGuardQuestion,
                this.getSelectionMode(this.getActiveTargetSceneIds())
            );
        }
        const activeQuestion = this.getQuestionTextById(this.state.activeQuestionId);
        return activeQuestion ?? null;
    }

    private buildEnginePayloadSummary(): {
        text: string;
        inputTokens: number;
        tier: TokenTier;
    } {
        const currentCorpus = this.getCurrentCorpusContext();
        const fallbackText = currentCorpus.requestEstimateMethod === 'unavailable'
            ? 'Full Request: unavailable'
            : 'Full Request: Estimating…';
        return {
            text: currentCorpus.requestTokens > 0
                ? `Full Request: ~${this.formatTokenEstimate(currentCorpus.requestTokens)}`
                : fallbackText,
            inputTokens: currentCorpus.requestTokens,
            tier: this.getTokenTier(currentCorpus.requestTokens)
        };
    }

    private getRTCorpusEstimate(): RTCorpusTokenEstimate {
        return this.getCurrentCorpusContext().corpus;
    }

    public getCurrentCorpusContext(): InquiryCurrentCorpusContext {
        const manifest = this.buildCorpusManifest('estimate-snapshot');
        const snapshot = this.plugin.getInquiryEstimateService().getSnapshot();
        const currentCitationsEnabled = this.areInquiryProviderCitationsEnabled();
        // Scope/book match is the precondition for any reuse from the snapshot.
        const sameScope = !!snapshot
            && snapshot.scope === this.state.scope
            && snapshot.activeBookId === this.getCanonicalActiveBookId();
        // Corpus chars are provider-independent — reuse them across model switches
        // as long as the corpus content fingerprint matches.
        const corpusMatches = sameScope
            && snapshot.corpus.corpusOnlyFingerprint === manifest.corpusOnlyFingerprint;
        // Request envelope tokens / pass count / ceilings depend on every dimension
        // that affects bytes-on-the-wire — model AND citations toggle. Reuse only
        // when the full state matches. `snapshotFresh` distinguishes "snapshot is
        // for this exact state" from "the provider count succeeded" — when the
        // count fails the method is 'unavailable' and the UI should surface that
        // honestly rather than masquerade as in-flight estimation.
        const snapshotFresh = sameScope
            && snapshot.resolvedEngine.modelId === this.getResolvedEngine().modelId
            && snapshot.corpus.corpusFingerprint === manifest.fingerprint
            && snapshot.citationsEnabled === currentCitationsEnabled;
        const requestMatches = snapshotFresh && snapshot.estimate.estimatedInputTokens > 0;
        this._currentCorpusContext = {
            scope: this.state.scope,
            activeBookId: this.getCanonicalActiveBookId(),
            scopeLabel: this.getScopeLabel(),
            corpusFingerprint: manifest.fingerprint,
            cacheReuseFingerprint: manifest.cacheReuseFingerprint,
            corpus: corpusMatches
                ? snapshot.corpus.estimate
                : buildPendingCorpusEstimateFromManifestEntries(manifest.entries),
            requestTokens: requestMatches ? snapshot.estimate.estimatedInputTokens : 0,
            requestEstimateMethod: snapshotFresh ? snapshot.estimate.estimationMethod : undefined,
            requestEstimateFailureMessage: snapshotFresh ? snapshot.estimate.tokenCountFailureMessage : undefined,
            expectedPassCount: requestMatches ? snapshot.estimate.expectedPassCount : 1,
            safeInputBudget: requestMatches ? snapshot.estimate.effectiveInputCeiling : 0,
            manifestEntries: manifest.entries.map(entry => ({ ...entry }))
        };
        return this._currentCorpusContext;
    }

    private buildInquiryAdvisoryContext(
        readinessUi: InquiryReadinessUiState
    ): InquiryAdvisoryContext | null {
        if (readinessUi.pending) return null;
        const snapshot = this.plugin.getInquiryEstimateService().getSnapshot();
        if (!snapshot) return null;

        const engine = this.getResolvedEngine();
        const currentModel = readinessUi.model
            ?? BUILTIN_MODELS.find(model => model.provider === engine.provider && model.id === engine.modelId)
            ?? null;
        if (!currentModel) return null;

        const advancedContext = this.getEffectiveReuseAdvancedContext();
        const corpusFingerprint = snapshot.corpus.corpusFingerprint || this.state.corpusFingerprint || 'unknown'; // SAFE: diagnostic label — unknown until a corpus fingerprint is computed
        const corpusFingerprintReused = advancedContext?.reuseState === 'warm';
        const overrideSummary = this.getCorpusOverrideSummary();
        const estimatedInputTokens = snapshot.estimate.estimatedInputTokens;
        const advisoryInputKey = buildAdvisoryInputKey({
            scope: this.state.scope,
            scopeLabel: this.getScopeLabel(),
            provider: engine.provider,
            modelId: engine.modelId,
            estimatedInputTokens,
            estimateMethod: readinessUi.estimateMethod,
            estimateUncertaintyTokens: readinessUi.estimateUncertaintyTokens,
            corpusFingerprint,
            overrideSummary,
            corpusFingerprintReused
        });
        if (this.lastEngineAdvisoryInputKey === advisoryInputKey) {
            return this.lastEngineAdvisoryContext;
        }

        const advisory = computeInquiryAdvisoryContext({
            scope: this.state.scope,
            scopeLabel: this.getScopeLabel(),
            resolvedEngine: engine,
            currentModel,
            models: BUILTIN_MODELS,
            estimatedInputTokens,
            currentSafeInputBudget: readinessUi.safeInputBudget,
            estimationMethod: readinessUi.estimateMethod,
            estimateUncertaintyTokens: readinessUi.estimateUncertaintyTokens,
            corpusFingerprint,
            corpusFingerprintReused,
            overrideSummary,
            previousContext: this.lastEngineAdvisoryContext
        });
        this.lastEngineAdvisoryInputKey = advisoryInputKey;
        return advisory;
    }

    private getCurrentPromptQuestion(): string | null {
        const activeZone = this.state.activeZone ?? 'setup'; // SAFE: no active zone on first render — setup is the default zone
        const activePrompt = this.getActivePrompt(activeZone);
        if (activePrompt) {
            return this.resolveQuestionPromptForRun(activePrompt, this.getSelectionMode(this.getActiveTargetSceneIds())).trim();
        }
        const fallback = this.getPromptOptions('setup')[0];
        return fallback
            ? this.resolveQuestionPromptForRun(fallback, this.getSelectionMode(this.getActiveTargetSceneIds())).trim()
            : null;
    }

    private getCanonicalActiveBookId(): string | undefined {
        if (this.state.scope !== 'book') return undefined;
        return this.corpus?.activeBookId ?? this.state.activeBookId ?? this.corpus?.books?.[0]?.id;
    }

    private getCanonicalAiSettings(): AiSettingsV1 {
        const validated = validateAiSettings(this.plugin.settings.aiSettings ?? buildDefaultAiSettings());
        this.plugin.settings.aiSettings = validated.value;
        return validated.value;
    }

    private areInquiryProviderCitationsEnabled(provider: AIProviderId = this.getResolvedEngine().provider): boolean {
        return resolveCitationsEnabled(
            provider,
            'inquiry',
            this.getCanonicalAiSettings().citationsEnabled !== false
        );
    }

    private getAccessTierForProvider(provider: AIProviderId, aiSettings: AiSettingsV1): AccessTier {
        if (provider === 'anthropic') return aiSettings.aiAccessProfile.anthropicTier ?? 1; // SAFE: unset access profile defaults to tier 1, the lowest tier
        if (provider === 'openai') return aiSettings.aiAccessProfile.openaiTier ?? 1; // SAFE: unset access profile defaults to tier 1, the lowest tier
        if (provider === 'google') return aiSettings.aiAccessProfile.googleTier ?? 1; // SAFE: unset access profile defaults to tier 1, the lowest tier
        return 1;
    }

    private buildReadinessUiState(): InquiryReadinessUiState {
        const engine = this.getResolvedEngine();
        return buildReadinessUiStatePure({
            snapshot: this.plugin.getInquiryEstimateService().getSnapshot(),
            scope: this.state.scope,
            scopeLabel: this.getScopeLabel(),
            resolvedEngine: engine,
            hasCredential: engine.hasCredential,
            payloadStats: this.getPayloadStats(),
            selectedSceneOverrideCount: this.getSelectedSceneOverrideEntries().length,
            hasAnyBodyEvidence: this.hasAnyBodyEvidence(),
            estimateSummaryOnlyTokens: this.estimateSummaryOnlyTokens('')
        });
    }

    private buildRunScopeLabel(stats: InquiryPayloadStats, selectedSceneCount: number): string {
        return buildRunScopeLabelPure(stats, selectedSceneCount, this.state.scope, this.getScopeLabel());
    }

    private resolveEnginePopoverState(readinessUi: InquiryReadinessUiState): InquiryEnginePopoverState {
        return resolveEnginePopoverStatePure(readinessUi);
    }

    private getCurrentPassPlan(readinessUi: InquiryReadinessUiState): PassPlanResult {
        return getCurrentPassPlanPure(readinessUi, this.getEffectiveReuseAdvancedContext());
    }

    private getEngineRunScopeLabel(runScopeLabel: string): string {
        if (this.state.scope !== 'book') return runScopeLabel;
        if (/^Run on \d+ scenes \(/.test(runScopeLabel)) return runScopeLabel;
        const bookTitle = this.getActiveBookTitleForMessages()?.trim();
        if (!bookTitle) return runScopeLabel;
        return runScopeLabel.replace(/^Run on Book\s+.+?\s+\(/, `Run on ${bookTitle} (`);
    }

    private hasAnyBodyEvidence(): boolean {
        const stats = this.getPayloadStats();
        return stats.sceneFullTextCount > 0 || stats.bookOutlineFullCount > 0 || stats.sagaOutlineFullCount > 0;
    }

    private estimateSummaryOnlyTokens(questionText: string): number {
        const manifest = this.buildCorpusManifest('payload-preview', {
            questionZone: this.previewLast?.zone,
            applyOverrides: true
        });
        const summaryChars = manifest.entries.reduce((sum, entry) => {
            const isSynopsisCapable = entry.class === 'scene' || entry.class === 'outline';
            if (!isSynopsisCapable) {
                return sum + this.getEntryContentLength(entry);
            }
            const summary = this.getEntrySummary(entry.path);
            if (summary.length > 0) {
                return sum + summary.length;
            }
            return sum + this.getEntryContentLength(entry);
        }, 0);
        return this.estimateTokensFromChars(summaryChars + (questionText?.length ?? 0) + INQUIRY_PROMPT_OVERHEAD_CHARS); // SAFE: no question text yet — contributes 0 chars to the token estimate
    }

    private getSelectedSceneOverrideEntries(): Array<{ entryKey: string; mode: SceneInclusion }> {
        const entries = this.getCorpusCcEntries().filter(entry => entry.classKey === 'scene');
        const selected: Array<{ entryKey: string; mode: SceneInclusion }> = [];
        entries.forEach(entry => {
            const override = this.getCorpusItemOverride(entry.classKey, entry.filePath, entry.scope, entry.sceneId);
            if (!override || !this.isModeActive(override)) return;
            selected.push({ entryKey: entry.entryKey, mode: override });
        });
        return selected;
    }

    private refreshBriefingPanel(): void {
        if (!this.briefingListEl || !this.briefingEmptyEl || !this.briefingFooterEl) return;
        this.briefingListEl.empty();
        const sessions = this.sessionStore.getRecentSessions(BRIEFING_SESSION_LIMIT);
        const hasSessions = sessions.length > 0;
        const blocked = this.isInquiryBlocked();
        if (!hasSessions) {
            this.briefingEmptyEl.classList.remove('ert-hidden');
        } else {
            this.briefingEmptyEl.classList.add('ert-hidden');
            const sections = buildInquiryBriefingSections(sessions);
            sections.forEach(section => {
                if (!section.sessions.length) return;
                const groupEl = this.briefingListEl?.createDiv({ cls: 'ert-inquiry-briefing-group' });
                if (!groupEl) return;
                groupEl.createDiv({ cls: 'ert-inquiry-briefing-group-label', text: section.label });
                const groupList = groupEl.createDiv({ cls: 'ert-inquiry-briefing-group-list' });
                section.sessions.forEach(session => this.renderBriefingSessionItem(groupList, session, blocked));
            });
        }

        this.briefingClearButton?.classList.remove('ert-hidden');
        this.briefingFooterEl.classList.remove('ert-hidden');
        this.updateBriefingFooterActionStates();
    }

    private renderBriefingSessionItem(container: HTMLElement, session: InquirySession, blocked: boolean): void {
        const zoneId = session.questionZone ?? this.findPromptZoneById(session.result.questionId) ?? 'setup'; // SAFE: legacy sessions predate zone metadata — setup is the default zone
        const overrideLabel = formatSessionOverrides(session);
        const metaText = `${formatSessionScope(session)} · ${formatSessionProviderModel(session)} · ${formatSessionTime(session)}${overrideLabel ? ` · ${overrideLabel}` : ''}`;
        const status = this.resolveSessionStatus(session);
        const pendingPlan = this.buildInquiryPendingEditsPlan(session.result, session.activeBookId);
        const pendingEditsApplied = this.syncPendingEditsAppliedState(session, pendingPlan.notesByMaterial);
        const pendingEditsEmpty = pendingPlan.notesByMaterial.size === 0;
        const priorPendingEditsEmpty = session.pendingEditsEmpty;
        session.pendingEditsEmpty = pendingEditsEmpty;
        if (session.key && priorPendingEditsEmpty !== pendingEditsEmpty) {
            this.sessionStore.updateSession(session.key, { pendingEditsEmpty });
        }
        const autoPopulateEnabled = this.settingsAccessor.getActionNotesAutoPopulate() ?? false; // SAFE: optional setting unset — auto-populate defaults off
        const fieldLabel = this.resolveInquiryActionNotesFieldLabel();
        const pendingEditsTooltip = blocked
            ? 'Inquiry is blocked'
            : pendingEditsApplied
                ? formatPendingEditsSuccessMessage(pendingPlan.targetLabels).replace(/\.$/, '')
                : status === 'error'
                    ? 'No pending edits (run failed)'
                    : formatPendingEditsTargetsTooltip(pendingPlan.targetLabels);
        const refs = renderInquiryBriefingSessionItem({
            container,
            zoneId,
            isRehydrateTarget: session.key === this.rehydrateTargetKey,
            isActive: session.key === this.state.activeSessionId,
            questionLabel: this.resolveSessionQuestionLabel(session),
            metaText,
            status,
            blocked,
            pendingEditsApplied,
            pendingEditsEmpty,
            pendingEditsTooltip,
            autoPopulateEnabled,
            fieldLabel,
            hasBriefPath: !!session.briefPath
        });
        bindInquiryBriefingSessionItemEvents({
            registerDomEvent: (element, event, handler, options) => this.registerBoundDomEvent(element, event, handler, options),
            item: refs.item,
            updateButton: refs.updateButton,
            openButton: refs.openButton,
            onItemClick: () => {
                this.activateSession(session);
                this.briefingPopover.unpin();
                this.briefingPopover.hide(true);
            },
            onUpdateClick: (event: MouseEvent) => {
                event.stopPropagation();
                if (pendingEditsApplied) return;
                if (status === 'error') return;
                if (pendingEditsEmpty) {
                    this.notifyInteraction(t('inquiry.interaction.noActionItemsThreshold'));
                    return;
                }
                void this.handleBriefingPendingEditsClick(session);
            },
            onOpenClick: (event: MouseEvent) => {
                event.stopPropagation();
                void this.openBriefFromSession(session);
            }
        });
    }

    // Session / Briefing Helpers

    private resolveSessionStatus(session: InquirySession, options?: { simulated?: boolean }): InquirySessionStatus {
        return resolveInquirySessionStatus(session, options);
    }

    private resolveSessionStatusFromResult(result: InquiryResult, options?: { simulated?: boolean }): InquirySessionStatus {
        return resolveInquirySessionStatusFromResult(result, options);
    }

    private resolveSessionZoneLabel(session: InquirySession): string {
        const zone = session.questionZone ?? this.findPromptZoneById(session.result.questionId) ?? 'setup'; // SAFE: legacy sessions predate zone metadata — setup is the default zone
        return zone === 'setup' ? 'Setup' : zone === 'pressure' ? 'Pressure' : 'Payoff';
    }

    private resolveSessionLensLabel(session: InquirySession, zoneLabel: string): string {
        const promptLabel = this.findPromptLabelById(session.result.questionId);
        if (promptLabel && promptLabel.toLowerCase() !== zoneLabel.toLowerCase()) {
            return promptLabel;
        }
        return session.result.mode === 'depth' ? 'Depth' : 'Flow';
    }

    private resolveSessionQuestionLabel(session: InquirySession): string {
        const zoneLabel = this.resolveSessionZoneLabel(session);
        const fallbackLabel = this.resolveSessionLensLabel(session, zoneLabel);
        const questionPrefix = this.resolveInquiryQuestionPrefix({
            questionId: session.result.questionId,
            questionZone: session.questionZone ?? this.findPromptZoneById(session.result.questionId),
            fallbackLabel
        });
        return questionPrefix ?? `${zoneLabel}: ${fallbackLabel}`; // SAFE: no custom question prefix — zone and lens labels compose the fallback
    }

    private ensurePendingEditsEmpty(session: InquirySession): boolean {
        const pendingEditsEmpty = this.resolvePendingEditsEmpty(session.result, session.activeBookId);
        const prior = session.pendingEditsEmpty;
        session.pendingEditsEmpty = pendingEditsEmpty;
        if (session.key && prior !== pendingEditsEmpty) {
            this.sessionStore.updateSession(session.key, { pendingEditsEmpty });
        }
        return pendingEditsEmpty;
    }

    private resolvePendingEditsEmpty(result: InquiryResult, activeBookId?: string): boolean {
        const normalized = this.normalizeLegacyResult(result);
        if (this.isErrorResult(normalized)) return true;
        if (normalized.scope !== 'book') return true;
        if (!this.corpus) return true;
        return this.buildInquiryPendingEditsPlan(normalized, activeBookId).notesByMaterial.size === 0;
    }

    private syncPendingEditsAppliedState(
        session: InquirySession,
        notesByMaterial?: Map<string, string[]>
    ): boolean {
        if (!session.pendingEditsApplied) return false;
        const targetNotes = notesByMaterial ?? this.buildInquiryPendingEditsPlan(session.result, session.activeBookId).notesByMaterial;
        if (this.hasPendingEditsMarkerForSession(session, targetNotes)) {
            return true;
        }
        session.pendingEditsApplied = false;
        if (session.key) {
            this.sessionStore.updateSession(session.key, { pendingEditsApplied: false });
        }
        return false;
    }

    private hasPendingEditsMarkerForSession(
        session: InquirySession,
        notesByMaterial: Map<string, string[]>
    ): boolean {
        if (!notesByMaterial.size) return false;
        const briefId = this.formatInquiryBriefId(session.result);
        const briefIdNeedle = `[[${briefId}`;
        const targetField = this.resolveInquiryActionNotesFieldLabel();
        for (const path of notesByMaterial.keys()) {
            const file = this.app.vault.getAbstractFileByPath(path);
            if (!file || !(file instanceof TFile)) continue;
            const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
            if (!frontmatter) continue;
            const validated = validatePendingEditsValue(frontmatter[targetField]);
            if (!validated.ok) continue;
            const hasMarker = validated.lines
                .map(line => normalizeInquiryLinkLine(line))
                .some(line => line.includes(briefIdNeedle));
            if (hasMarker) return true;
        }
        return false;
    }

    private buildInquiryPendingEditsPlan(
        result: InquiryResult,
        activeBookId?: string
    ): {
        notesByMaterial: Map<string, string[]>;
        targetLabels: string[];
    } {
        const normalized = this.normalizeLegacyResult(result);
        if (this.isErrorResult(normalized) || normalized.scope !== 'book' || !this.corpus) {
            return { notesByMaterial: new Map(), targetLabels: [] };
        }
        const briefId = this.formatInquiryBriefId(normalized);
        const briefAlias = this.formatInquiryBriefShortDate(normalized);
        const notesByMaterial = this.buildInquiryActionNotes(normalized, briefId, briefAlias, activeBookId);
        const sceneLabelsByPath = new Map<string, string>();
        (this.corpus.scenes ?? []).forEach(scene => { // SAFE: snapshot may omit scenes — no scene labels to map
            if (scene.filePath && scene.displayLabel) {
                sceneLabelsByPath.set(scene.filePath, scene.displayLabel);
            }
        });
        const outlinePath = this.resolveBookOutlinePath(activeBookId);
        const targetLabels = Array.from(notesByMaterial.keys()).map(path => {
            const sceneLabel = sceneLabelsByPath.get(path);
            if (sceneLabel) return sceneLabel;
            if (outlinePath && path === outlinePath) return 'Outline';
            return path.split('/').pop()?.replace(/\.md$/i, '').trim() || path;
        });
        targetLabels.sort((a, b) => {
            const aMatch = a.match(/^S(\d+)$/i);
            const bMatch = b.match(/^S(\d+)$/i);
            if (aMatch && bMatch) return Number(aMatch[1]) - Number(bMatch[1]);
            return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
        });
        return { notesByMaterial, targetLabels };
    }

    private updateBriefingButtonState(): void {
        if (!this.artifactButton) return;
        const activeSession = this.state.activeSessionId
            ? this.sessionStore.peekSession(this.state.activeSessionId)
            : undefined;
        const status = activeSession ? this.resolveSessionStatus(activeSession) : null;
        const flags = deriveBriefingArtifactClassFlags(status);
        for (const [cls, on] of Object.entries(flags)) {
            this.artifactButton.classList.toggle(cls, on);
        }
        // Briefing manager has its own full panel on hover/click; keep this icon tooltip-free.
        this.artifactButton.removeAttribute('data-rt-tip');
        this.artifactButton.removeAttribute('data-rt-tip-placement');
    }


    private updateBriefingFooterActionStates(): void {
        const state = computeBriefingFooterButtonState({
            lockout: this.isInquiryGuidanceLockout(),
            running: this.state.isRunning,
            sessionCount: this.sessionStore.getSessionCount(),
            hasCorpusOverrides: this.hasCorpusOverrides(),
            purgeAvailable: this.briefingPurgeScanner.isAvailable(),
        });

        if (this.briefingClearButton) {
            this.briefingClearButton.disabled = state.clearDisabled;
            this.briefingClearButton.classList.toggle('is-inert', state.clearInert);
        }
        if (this.briefingResetButton) {
            this.briefingResetButton.disabled = state.resetDisabled;
        }
        if (this.briefingPurgeButton) {
            this.briefingPurgeButton.disabled = state.purgeDisabled;
            this.briefingPurgeButton.classList.toggle('is-inert', state.purgeInert);
        }
    }

    private async handleBriefingPendingEditsClick(session: InquirySession): Promise<void> {
        if (this.isInquiryBlocked()) return;
        if (this.state.isRunning) {
            this.notifyInteraction(t('inquiry.interaction.running'));
            return;
        }
        if (this.syncPendingEditsAppliedState(session)) {
            const fieldLabel = this.resolveInquiryActionNotesFieldLabel();
            this.notifyInteraction(t('inquiry.interaction.fieldAlreadyUpdated', { fieldLabel }));
            return;
        }
        await this.writeInquiryPendingEdits(session, session.result, { notify: true });
    }

    private handleBriefingClearClick(): void {
        if (this.state.isRunning) {
            this.notifyInteraction(t('inquiry.interaction.runningWaitClear'));
            return;
        }
        this.sessionStore.clearSessions();
        this.resetInquiryToFreshBaseState({ clearPersistedTargets: true });
        this.refreshUI({ reason: 'recent sessions cleared' });
    }

    private handleBriefingResetCorpusClick(): void {
        if (this.state.isRunning) {
            this.notifyInteraction(t('inquiry.interaction.runningWaitReset'));
            return;
        }
        if (!this.hasCorpusOverrides()) {
            this.notifyInteraction(t('inquiry.interaction.corpusOverridesAlreadyMatch'));
            return;
        }
        this.resetCorpusOverrides();
        this.notifyInteraction(t('inquiry.interaction.corpusOverridesReset'));
    }

    /**
     * Explicit "I'm about to package/share this vault" action: flush the live
     * session cache to the hidden sidecar now, bypassing the debounce, and
     * report how many sessions were written.
     */
    private async handleBriefingSaveStateClick(): Promise<void> {
        await this.sessionStore.flush();
        const count = this.sessionStore.getSessionCount();
        this.notifyInteraction(`${count} session${count === 1 ? '' : 's'} saved`);
    }

    /**
     * Rehydrate the session list from the hidden sidecar. Merges by key and
     * prefers the sidecar version on a collision, but never removes sessions
     * that exist only in the current working set — restore augments, it does
     * not clobber. Reports found / restored / skipped and warns when any
     * restored brief file is missing from the vault.
     */
    private async handleBriefingRestoreClick(): Promise<void> {
        if (this.state.isRunning) {
            this.notifyInteraction(t('inquiry.interaction.running'));
            return;
        }
        const sidecarSessions = await readInquirySessionsFromVault(this.app);
        const found = sidecarSessions.length;
        if (found === 0) {
            this.notifyInteraction('No saved session state found in this vault.');
            return;
        }
        let restored = 0;
        let skipped = 0;
        let missingBriefs = 0;
        for (const session of sidecarSessions) {
            if (!session.key) {
                skipped++;
                continue;
            }
            // Upsert: sidecar wins on a key collision; sessions absent from the
            // sidecar stay untouched in the live cache.
            this.sessionStore.setSession(session);
            restored++;
            if (session.briefPath && !this.app.vault.getAbstractFileByPath(session.briefPath)) {
                missingBriefs++;
            }
        }
        await this.sessionStore.flush();
        this.refreshUI({ reason: 'inquiry sessions restored from vault' });
        const parts = [`${found} found`, `${restored} restored`, `${skipped} skipped`];
        if (missingBriefs > 0) {
            parts.push(`⚠ ${missingBriefs} brief${missingBriefs === 1 ? '' : 's'} missing`);
        }
        this.notifyInteraction(parts.join(' · '));
    }

    private async handleBriefingPurgeClick(): Promise<void> {
        if (this.state.isRunning) {
            this.notifyInteraction(t('inquiry.interaction.running'));
            return;
        }
        if (!this.corpus) {
            this.notifyInteraction(t('inquiry.interaction.noCorpusAvailable'));
            return;
        }
        const scenes = this.corpus.scenes ?? []; // SAFE: snapshot may omit scenes — empty list hits the no-scenes notice below
        if (!scenes.length) {
            this.notifyInteraction(t('inquiry.interaction.noScenesInScope'));
            return;
        }
        const scopeBookLabel = this.getActiveBookTitleForMessages() || this.getActiveBookLabel();
        const scopeLabel = this.state.scope === 'saga' ? 'saga' : `book "${scopeBookLabel}"`;
        const affectedScenes = await this.scanForInquiryActionItems(scenes);
        this.briefingPurgeScanner.markFromExternalScan(affectedScenes.length);
        if (!affectedScenes.length) {
            this.notifyInteraction(t('inquiry.interaction.noActionItemsToPurge'));
            return;
        }
        const modal = new InquiryPurgeConfirmationModal(
            this.app,
            scenes.length,
            affectedScenes,
            scopeLabel,
            async () => {
                const result = await this.purgeInquiryActionItems(scenes);
                const rearmedSessions = result.purgedCount > 0
                    ? this.sessionStore.clearPendingEditsAppliedFlags({
                        scope: this.state.scope,
                        activeBookId: this.state.scope === 'book' ? this.state.activeBookId : undefined,
                        statuses: ['saved', 'unsaved']
                    })
                    : 0;
                this.briefingPurgeScanner.invalidate();
                this.refreshBriefingPanel();
                void this.briefingPurgeScanner.refresh();
                if (result.purgedCount > 0) {
                    const rearmSuffix = rearmedSessions > 0
                        ? ` Re-armed ${rearmedSessions} session${rearmedSessions !== 1 ? 's' : ''} for fresh writeback.`
                        : '';
                    const sceneWord = result.purgedCount !== 1 ? 'scenes' : 'scene';
                    if (rearmSuffix) {
                        const rearmMatch = rearmSuffix.match(/Re-armed (\d+) session/);
                        const rearmCount = rearmMatch ? Number(rearmMatch[1]) : 0;
                        const sessionWord = rearmCount !== 1 ? 'sessions' : 'session';
                        new Notice(t('inquiry.notice.purgedScenesWithRearm', { count: result.purgedCount, sceneWord, rearmCount, sessionWord }));
                    } else {
                        new Notice(t('inquiry.notice.purgedScenes', { count: result.purgedCount, sceneWord }));
                    }
                } else {
                    new Notice(t('inquiry.notice.purgedNothing'));
                }
            }
        );
        modal.open();
    }

    private async scanForInquiryActionItems(
        scenes: InquirySceneItem[]
    ): Promise<InquiryPurgePreviewItem[]> {
        const targetField = this.resolveInquiryActionNotesFieldLabel();
        const results: InquiryPurgePreviewItem[] = [];

        for (const scene of scenes) {
            const filePath = scene.filePath;
            if (!filePath) continue;
            const file = this.app.vault.getAbstractFileByPath(filePath);
            if (!file || !(file instanceof TFile)) continue;

            try {
                const cache = this.app.metadataCache.getFileCache(file);
                const frontmatter = cache?.frontmatter;
                if (!frontmatter) continue;

                const rawValue = frontmatter[targetField];
                if (rawValue === undefined || rawValue === null) continue;

                let rawText = '';
                if (typeof rawValue === 'string') {
                    rawText = rawValue;
                } else if (Array.isArray(rawValue)) {
                    rawText = rawValue.map(entry => (typeof entry === 'string' ? entry : String(entry))).join('\n');
                } else {
                    rawText = String(rawValue);
                }

                if (!rawText.trim()) continue;

                const lines = rawText.split(/\r?\n/);
                const inquiryLines = lines.filter(line => isInquiryLine(line));
                if (inquiryLines.length > 0) {
                    results.push({
                        label: scene.displayLabel,
                        path: filePath,
                        lineCount: inquiryLines.length
                    });
                }
            } catch (error) {
                console.warn('[Inquiry] Error scanning scene for action items:', filePath, error);
            }
        }

        return results;
    }

    private async purgeInquiryActionItems(
        scenes: InquirySceneItem[]
    ): Promise<{ purgedCount: number; totalScenes: number }> {
        const targetField = this.resolveInquiryActionNotesFieldLabel();
        let purgedCount = 0;
        let refusedCount = 0;

        for (const scene of scenes) {
            const filePath = scene.filePath;
            if (!filePath) continue;
            const file = this.app.vault.getAbstractFileByPath(filePath);
            if (!file || !(file instanceof TFile)) continue;

            try {
                const originalContent = await this.app.vault.read(file);
                const prepared = prepareFrontmatterRewrite(originalContent);
                if (!prepared || prepared.aliasConflicts.length > 0) {
                    refusedCount++;
                    continue;
                }
                let hadInquiryLines = false;
                await this.app.fileManager.processFrontMatter(file, (fm) => {
                    const frontmatter = fm as Record<string, unknown>;
                    const nextState = purgeInquiryNotesFromPendingEdits(frontmatter[targetField]);
                    if (!nextState.ok) {
                        refusedCount++;
                        return;
                    }
                    if (nextState.outcome === 'written') {
                        hadInquiryLines = true;
                        frontmatter[targetField] = nextState.value ?? ''; // SAFE: purge may clear the field entirely — write empty string, not undefined
                    }
                });

                if (hadInquiryLines) {
                    const verifiedContent = await this.app.vault.read(file);
                    const verification = verifyFrontmatterRewrite(verifiedContent, {
                        originalBody: prepared.body,
                        verifyParsed: (verifiedFrontmatter) => validatePendingEditsValue(verifiedFrontmatter[targetField]).ok
                    });
                    if (!verification.ok) {
                        refusedCount++;
                        continue;
                    }
                    purgedCount++;
                }
            } catch (error) {
                console.warn('[Inquiry] Error purging action items from scene:', filePath, error);
            }
        }

        if (refusedCount > 0) {
            new Notice(t('inquiry.notice.pendingEditsBroken'), 7000);
        }

        return { purgedCount, totalScenes: scenes.length };
    }

    private activateSession(session: InquirySession): void {
        if (this.isInquiryBlocked()) return;
        this.clearErrorStateForAction();
        if (this.state.isRunning) return;
        this.state.scope = session.scope ?? session.result.scope;
        this.selection.setActiveBookId(session.activeBookId ?? this.state.activeBookId);
        this.selection.setTargetSceneIds(this.normalizeTargetSceneIds(session.targetSceneIds ?? this.state.targetSceneIds));
        this.applySession({
            result: session.result,
            key: session.key,
            activeBookId: session.activeBookId,
            targetSceneIds: session.targetSceneIds,
            scope: session.scope,
            questionZone: session.questionZone
        }, 'fresh');
        if (this.isErrorResult(session.result)) {
            this.setApiStatus('error', formatApiErrorReason(session.result));
        } else {
            this.setApiStatus('success');
        }
        this.sessionStore.updateSession(session.key, { lastAccessed: Date.now() });
    }

    private async openBriefFromSession(session: InquirySession, anchorId?: string): Promise<void> {
        if (this.isInquiryBlocked()) return;
        if (!session.briefPath) return;
        const file = this.app.vault.getAbstractFileByPath(session.briefPath);
        if (!(file instanceof TFile)) {
            new Notice(t('inquiry.notice.briefNotFound'));
            return;
        }
        if (!anchorId) {
            const staleDiagnosis = this.diagnoseSessionStaleness(session);
            this.openBriefingPresentation(this.buildInquiryBriefModel(session.result, session.logPath), {
                briefFile: file,
                logFile: this.getArtifactFileAtPath(session.logPath),
                generatedAt: session.result.completedAt ?? session.createdAt,
                isCorpusStale: !!staleDiagnosis,
                staleDiagnosis
            });
            return;
        }
        await openOrRevealFileAtSubpath(this.app, file, `#^${anchorId}`);
    }

    private getArtifactFileAtPath(path?: string | null): TFile | null {
        if (!path) return null;
        const file = this.app.vault.getAbstractFileByPath(path);
        return file instanceof TFile ? file : null;
    }

    private openBriefingPresentation(
        brief: InquiryBriefModel,
        options?: {
            briefFile?: TFile | null;
            logFile?: TFile | null;
            generatedAt?: number | string | null;
            focusAnchorId?: string | null;
            isCorpusStale?: boolean;
            staleDiagnosis?: InquiryStaleDiagnosis | null;
        }
    ): void {
        new InquiryBriefingModal(this.app, {
            brief,
            plugin: this.plugin,
            briefFile: options?.briefFile ?? null,
            logFile: options?.logFile ?? null,
            generatedAt: options?.generatedAt ?? null,
            focusAnchorId: options?.focusAnchorId ?? null,
            isCorpusStale: options?.isCorpusStale ?? false, // SAFE: optional modal flag — omitted means corpus is not stale
            staleDiagnosis: options?.staleDiagnosis ?? null
        }).open();
    }

    /**
     * Compute the current corpus fingerprints + snapshot for a given question — this reflects
     * the live filesystem, independent of whatever session is loaded in state.
     */
    private buildCurrentCorpusSnapshot(
        questionId: string,
        questionZone?: InquiryZone
    ): { corpusOnlyFingerprint: string; snapshot: InquiryResult['corpusManifestSnapshot'] } {
        const contextRequired = this.isContextRequiredForQuestion(questionId, questionZone ?? 'setup'); // SAFE: caller may omit the zone — setup is the default zone
        const manifest = this.buildCorpusManifest(questionId, {
            modelId: this.resolveEngineSelectionForRun().modelId,
            questionZone,
            contextRequired
        });
        return {
            corpusOnlyFingerprint: manifest.corpusOnlyFingerprint,
            snapshot: manifest.snapshot
        };
    }

    private isSessionCorpusStale(session: { result?: InquiryResult } | null | undefined): boolean {
        const prior = session?.result;
        if (!prior) return false;
        const priorCorpusOnly = prior.corpusOnlyFingerprint;
        if (!priorCorpusOnly) return false; // pre-upgrade session — can't judge without a baseline
        const current = this.buildCurrentCorpusSnapshot(prior.questionId, prior.questionZone);
        return priorCorpusOnly !== current.corpusOnlyFingerprint;
    }

    /**
     * Produce a human-readable diagnosis of *why* a prior session is stale relative to current state.
     * Returns null if the session isn't stale.
     */
    private diagnoseSessionStaleness(session: { result?: InquiryResult } | null | undefined): InquiryStaleDiagnosis | null {
        const prior = session?.result;
        if (!prior) return null;
        const priorCorpusOnly = prior.corpusOnlyFingerprint;
        if (!priorCorpusOnly) return null;
        const current = this.buildCurrentCorpusSnapshot(prior.questionId, prior.questionZone);
        if (priorCorpusOnly === current.corpusOnlyFingerprint) return null;

        const priorSnapshot = prior.corpusManifestSnapshot;
        const currentSnapshot = current.snapshot;
        const reasons: InquiryStaleReason[] = [];

        if (priorSnapshot && currentSnapshot) {
            const priorByPath = new Map(priorSnapshot.map(e => [e.path, e]));
            const currentByPath = new Map(currentSnapshot.map(e => [e.path, e]));

            const editedScenes: string[] = [];
            const addedScenes: string[] = [];
            const removedScenes: string[] = [];
            const modeChangedScenes: string[] = [];
            const targetChangedScenes: string[] = [];

            for (const [path, current] of currentByPath) {
                const prev = priorByPath.get(path);
                if (!prev) {
                    addedScenes.push(path);
                    continue;
                }
                if (prev.mtime !== current.mtime) editedScenes.push(path);
                if (prev.mode !== current.mode) modeChangedScenes.push(path);
                if (prev.isTarget !== current.isTarget) targetChangedScenes.push(path);
            }
            for (const path of priorByPath.keys()) {
                if (!currentByPath.has(path)) removedScenes.push(path);
            }

            if (editedScenes.length) reasons.push({ kind: 'scenes_edited', paths: editedScenes });
            if (addedScenes.length) reasons.push({ kind: 'scenes_added', paths: addedScenes });
            if (removedScenes.length) reasons.push({ kind: 'scenes_removed', paths: removedScenes });
            if (modeChangedScenes.length) reasons.push({ kind: 'inclusion_changed', paths: modeChangedScenes });
            if (targetChangedScenes.length) reasons.push({ kind: 'target_changed', paths: targetChangedScenes });
        }

        if (!reasons.length) {
            reasons.push({ kind: 'corpus_changed', paths: [] });
        }

        return {
            reasons,
            shortLabel: buildStaleShortLabel(reasons),
            tooltipLines: buildStaleTooltipLines(reasons)
        };
    }


    private getMostRecentInquiryLogFile(): TFile | null {
        const folderPath = resolveInquiryLogFolder();
        const folder = this.app.vault.getAbstractFileByPath(folderPath);
        if (!(folder instanceof TFolder)) return null;

        let latest: TFile | null = null;
        const scan = (node: TAbstractFile): void => {
            if (node instanceof TFile) {
                if (node.extension !== 'md') return;
                if (!latest || node.stat.mtime > latest.stat.mtime) {
                    latest = node;
                }
                return;
            }
            if (node instanceof TFolder) {
                node.children.forEach(child => scan(child));
            }
        };
        scan(folder);
        return latest;
    }

    private async openLatestInquiryLogForContext(): Promise<boolean> {
        const activeSession = this.state.activeSessionId
            ? this.sessionStore.peekSession(this.state.activeSessionId)
            : undefined;
        const sessionLogPath = activeSession?.logPath;
        if (sessionLogPath) {
            const sessionLog = this.app.vault.getAbstractFileByPath(sessionLogPath);
            if (sessionLog instanceof TFile) {
                await openOrRevealFile(this.app, sessionLog);
                return true;
            }
        }
        // If there is an active session but no log was saved, don't fall through
        // to an unrelated older log — report the failure honestly.
        if (activeSession) return false;
        const fallback = this.getMostRecentInquiryLogFile();
        if (!fallback) return false;
        await openOrRevealFile(this.app, fallback);
        return true;
    }

    private getInquiryAssetHref(key: EmbeddedAssetKey): string {
        // Embedded in main.js, not read from the plugin folder: Obsidian
        // installs only manifest.json/main.js/styles.css from a release, so a
        // plugin-folder path resolves to nothing for anyone who installed
        // through the Community Plugins browser.
        return getEmbeddedAssetDataUri(key);
    }

    private loadTargetCache(options?: { adoptPersistedSelection?: boolean }): void {
        const adoptPersistedSelection = options?.adoptPersistedSelection !== false;
        const cache = this.settingsAccessor.getTargetCache();
        this.selection.hydrateRememberedTargetSceneIdsFromCache(
            cache?.lastTargetSceneIdsByBookId,
            (ids) => this.normalizeTargetSceneIds(ids)
        );
        if (adoptPersistedSelection && cache?.lastBookId) {
            this.selection.setActiveBookId(cache.lastBookId);
            this.selection.setTargetSceneIds(
                this.selection.getRememberedTargetSceneIdsForBook(cache.lastBookId) ?? [] // SAFE: no remembered target selection for this book — start with none
            );
        } else if (!adoptPersistedSelection) {
            this.selection.setTargetSceneIds([]);
        }
        this.selection.cancelPendingPersist();
    }

    private scheduleTargetPersist(): void {
        this.selection.schedulePersist(this.state.activeBookId);
    }

    private buildIconSymbols(defs: SVGDefsElement): void {
        this.iconSymbols.clear();
        [
            'waves',
            'waves-arrow-down',
            'file',
            'file-text',
            'file-x-corner',
            'book',
            'columns-2',
            'cpu',
            'aperture',
            'chevron-left',
            'chevron-right',
            'chevron-up',
            'chevron-down',
            'help-circle',
            'activity',
            'arrow-big-up',
            'arrow-big-up-dash',
            'arrow-big-right-dash',
            'mouse-pointer-click',
            'check-circle',
            'flame-kindling',
            'sigma',
            'x',
            'circle',
            'circle-dot',
            'disc',
            'asterisk'
        ].forEach(icon => {
            const symbolId = this.createIconSymbol(defs, icon);
            if (symbolId) {
                this.iconSymbols.add(symbolId);
            }
        });
    }

    private buildZoneGradients(defs: SVGDefsElement): void {
        const zones: InquiryZone[] = ['setup', 'pressure', 'payoff'];
        const zoneAnchors: Record<InquiryZone, { cx: string; cy: string; r: string }> = {
            setup: { cx: '1', cy: '0', r: '1.42' },
            pressure: { cx: '0', cy: '0', r: '1.42' },
            payoff: { cx: '0.5', cy: '0', r: '1' }
        };
        const zoneStopOpacity = '0.35';
        const createStop = (offset: string, color: string, opacity?: string): SVGStopElement => {
            const stop = createSvgElement('stop');
            stop.setAttribute('offset', offset);
            stop.setAttribute('stop-color', color);
            if (opacity) {
                stop.setAttribute('stop-opacity', opacity);
            }
            return stop;
        };
        const createGradient = (
            id: string,
            stops: Array<[string, string]>,
            anchor: { cx: string; cy: string; r: string },
            stopOpacity?: string
        ): SVGRadialGradientElement => {
            const gradient = createSvgElement('radialGradient');
            gradient.setAttribute('id', id);
            gradient.setAttribute('cx', anchor.cx);
            gradient.setAttribute('cy', anchor.cy);
            gradient.setAttribute('fx', anchor.cx);
            gradient.setAttribute('fy', anchor.cy);
            gradient.setAttribute('r', anchor.r);
            stops.forEach(([offset, color]) => {
                gradient.appendChild(createStop(offset, color, stopOpacity));
            });
            return gradient;
        };

        const glassGradient = createSvgElement('radialGradient');
        glassGradient.setAttribute('id', 'ert-inquiry-zone-glass');
        glassGradient.setAttribute('gradientUnits', 'userSpaceOnUse');
        glassGradient.setAttribute('cx', '0');
        glassGradient.setAttribute('cy', '0');
        glassGradient.setAttribute('fx', '0');
        glassGradient.setAttribute('fy', '0');
        glassGradient.setAttribute('r', String(VIEWBOX_MAX));
        const toPercent = (radius: number): string => {
            const clamped = Math.min(Math.max(radius / VIEWBOX_MAX, 0), 1);
            return `${(clamped * 100).toFixed(2)}%`;
        };
        const zoneInner = ZONE_SEGMENT_RADIUS - (ZONE_RING_THICKNESS / 2);
        const zoneOuter = ZONE_SEGMENT_RADIUS + (ZONE_RING_THICKNESS / 2);
        const bandInset = ZONE_RING_THICKNESS * 0.18;
        const innerFade = Math.max(0, zoneInner - (ZONE_RING_THICKNESS * 0.22));
        const outerFade = zoneOuter + (ZONE_RING_THICKNESS * 0.22);
        [
            [toPercent(innerFade), '#ffffff', '0.015'],
            [toPercent(zoneInner), '#ffffff', '0.03'],
            [toPercent(zoneInner + bandInset), '#ffffff', '0.12'],
            [toPercent(zoneInner + (ZONE_RING_THICKNESS * 0.5)), '#ffffff', '0.26'],
            [toPercent(zoneOuter - bandInset), '#ffffff', '0.12'],
            [toPercent(zoneOuter), '#ffffff', '0.03'],
            [toPercent(outerFade), '#ffffff', '0.015']
        ].forEach(([offset, color, opacity]) => {
            glassGradient.appendChild(createStop(offset, color, opacity));
        });
        defs.appendChild(glassGradient);

        zones.forEach(zone => {
            const zoneVar = `var(--ert-inquiry-zone-${zone})`;
            const anchor = zoneAnchors[zone];
            defs.appendChild(createGradient(
                `ert-inquiry-zone-${zone}-raised`,
                [
                    ['0%', `color-mix(in srgb, ${zoneVar} 55%, #ffffff)`],
                    ['50%', zoneVar],
                    ['100%', `color-mix(in srgb, ${zoneVar} 55%, #000000)`]
                ],
                anchor,
                zoneStopOpacity
            ));
            defs.appendChild(createGradient(
                `ert-inquiry-zone-${zone}-pressed`,
                [
                    ['0%', `color-mix(in srgb, ${zoneVar} 55%, #000000)`],
                    ['60%', zoneVar],
                    ['100%', `color-mix(in srgb, ${zoneVar} 55%, #ffffff)`]
                ],
                anchor,
                zoneStopOpacity
            ));
        });

        // Neumorphic filters for zone pill states.
        const pillOutFilter = createSvgElement('filter');
        pillOutFilter.setAttribute('id', 'ert-inquiry-zone-pill-out');
        pillOutFilter.setAttribute('x', '-50%');
        pillOutFilter.setAttribute('y', '-50%');
        pillOutFilter.setAttribute('width', '200%');
        pillOutFilter.setAttribute('height', '200%');
        pillOutFilter.setAttribute('color-interpolation-filters', 'sRGB');
        const pillOutLight = createSvgElement('feDropShadow');
        pillOutLight.setAttribute('dx', '-2');
        pillOutLight.setAttribute('dy', '-2');
        pillOutLight.setAttribute('stdDeviation', '1.6');
        pillOutLight.setAttribute('flood-color', '#ffffff');
        pillOutLight.setAttribute('flood-opacity', '0.28');
        const pillOutDark = createSvgElement('feDropShadow');
        pillOutDark.setAttribute('dx', '2');
        pillOutDark.setAttribute('dy', '2');
        pillOutDark.setAttribute('stdDeviation', '1.8');
        pillOutDark.setAttribute('flood-color', '#000000');
        pillOutDark.setAttribute('flood-opacity', '0.35');
        pillOutFilter.appendChild(pillOutLight);
        pillOutFilter.appendChild(pillOutDark);
        defs.appendChild(pillOutFilter);

        const pillInFilter = createSvgElement('filter');
        pillInFilter.setAttribute('id', 'ert-inquiry-zone-pill-in');
        pillInFilter.setAttribute('x', '-50%');
        pillInFilter.setAttribute('y', '-50%');
        pillInFilter.setAttribute('width', '200%');
        pillInFilter.setAttribute('height', '200%');
        pillInFilter.setAttribute('color-interpolation-filters', 'sRGB');
        const pillInOffsetDark = createSvgElement('feOffset');
        pillInOffsetDark.setAttribute('in', 'SourceAlpha');
        pillInOffsetDark.setAttribute('dx', '1.6');
        pillInOffsetDark.setAttribute('dy', '1.6');
        pillInOffsetDark.setAttribute('result', 'pill-in-offset-dark');
        const pillInBlurDark = createSvgElement('feGaussianBlur');
        pillInBlurDark.setAttribute('in', 'pill-in-offset-dark');
        pillInBlurDark.setAttribute('stdDeviation', '1.2');
        pillInBlurDark.setAttribute('result', 'pill-in-blur-dark');
        const pillInCompositeDark = createSvgElement('feComposite');
        pillInCompositeDark.setAttribute('in', 'pill-in-blur-dark');
        pillInCompositeDark.setAttribute('in2', 'SourceAlpha');
        pillInCompositeDark.setAttribute('operator', 'arithmetic');
        pillInCompositeDark.setAttribute('k2', '-1');
        pillInCompositeDark.setAttribute('k3', '1');
        pillInCompositeDark.setAttribute('result', 'pill-in-inner-dark');
        const pillInFloodDark = createSvgElement('feFlood');
        pillInFloodDark.setAttribute('flood-color', '#000000');
        pillInFloodDark.setAttribute('flood-opacity', '0.35');
        pillInFloodDark.setAttribute('result', 'pill-in-flood-dark');
        const pillInShadowDark = createSvgElement('feComposite');
        pillInShadowDark.setAttribute('in', 'pill-in-flood-dark');
        pillInShadowDark.setAttribute('in2', 'pill-in-inner-dark');
        pillInShadowDark.setAttribute('operator', 'in');
        pillInShadowDark.setAttribute('result', 'pill-in-shadow-dark');

        const pillInOffsetLight = createSvgElement('feOffset');
        pillInOffsetLight.setAttribute('in', 'SourceAlpha');
        pillInOffsetLight.setAttribute('dx', '-1.6');
        pillInOffsetLight.setAttribute('dy', '-1.6');
        pillInOffsetLight.setAttribute('result', 'pill-in-offset-light');
        const pillInBlurLight = createSvgElement('feGaussianBlur');
        pillInBlurLight.setAttribute('in', 'pill-in-offset-light');
        pillInBlurLight.setAttribute('stdDeviation', '1.2');
        pillInBlurLight.setAttribute('result', 'pill-in-blur-light');
        const pillInCompositeLight = createSvgElement('feComposite');
        pillInCompositeLight.setAttribute('in', 'pill-in-blur-light');
        pillInCompositeLight.setAttribute('in2', 'SourceAlpha');
        pillInCompositeLight.setAttribute('operator', 'arithmetic');
        pillInCompositeLight.setAttribute('k2', '-1');
        pillInCompositeLight.setAttribute('k3', '1');
        pillInCompositeLight.setAttribute('result', 'pill-in-inner-light');
        const pillInFloodLight = createSvgElement('feFlood');
        pillInFloodLight.setAttribute('flood-color', '#ffffff');
        pillInFloodLight.setAttribute('flood-opacity', '0.22');
        pillInFloodLight.setAttribute('result', 'pill-in-flood-light');
        const pillInShadowLight = createSvgElement('feComposite');
        pillInShadowLight.setAttribute('in', 'pill-in-flood-light');
        pillInShadowLight.setAttribute('in2', 'pill-in-inner-light');
        pillInShadowLight.setAttribute('operator', 'in');
        pillInShadowLight.setAttribute('result', 'pill-in-shadow-light');

        const pillInMerge = createSvgElement('feMerge');
        const pillInMergeGraphic = createSvgElement('feMergeNode');
        pillInMergeGraphic.setAttribute('in', 'SourceGraphic');
        const pillInMergeDark = createSvgElement('feMergeNode');
        pillInMergeDark.setAttribute('in', 'pill-in-shadow-dark');
        const pillInMergeLight = createSvgElement('feMergeNode');
        pillInMergeLight.setAttribute('in', 'pill-in-shadow-light');
        pillInMerge.appendChild(pillInMergeGraphic);
        pillInMerge.appendChild(pillInMergeDark);
        pillInMerge.appendChild(pillInMergeLight);

        pillInFilter.appendChild(pillInOffsetDark);
        pillInFilter.appendChild(pillInBlurDark);
        pillInFilter.appendChild(pillInCompositeDark);
        pillInFilter.appendChild(pillInFloodDark);
        pillInFilter.appendChild(pillInShadowDark);
        pillInFilter.appendChild(pillInOffsetLight);
        pillInFilter.appendChild(pillInBlurLight);
        pillInFilter.appendChild(pillInCompositeLight);
        pillInFilter.appendChild(pillInFloodLight);
        pillInFilter.appendChild(pillInShadowLight);
        pillInFilter.appendChild(pillInMerge);
        defs.appendChild(pillInFilter);

        // Neumorphic "up" filter for zone dot buttons.
        const dotUpFilter = createSvgElement('filter');
        dotUpFilter.setAttribute('id', 'ert-inquiry-zone-dot-up');
        dotUpFilter.setAttribute('x', '-50%');
        dotUpFilter.setAttribute('y', '-50%');
        dotUpFilter.setAttribute('width', '200%');
        dotUpFilter.setAttribute('height', '200%');
        dotUpFilter.setAttribute('color-interpolation-filters', 'sRGB');

        const dotUpFlood = createSvgElement('feFlood');
        dotUpFlood.setAttribute('flood-opacity', '0');
        dotUpFlood.setAttribute('result', 'BackgroundImageFix');
        const dotUpAlphaDark = createSvgElement('feColorMatrix');
        dotUpAlphaDark.setAttribute('in', 'SourceAlpha');
        dotUpAlphaDark.setAttribute('type', 'matrix');
        dotUpAlphaDark.setAttribute('values', '0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0');
        dotUpAlphaDark.setAttribute('result', 'hardAlpha');
        const dotUpOffsetDark = createSvgElement('feOffset');
        dotUpOffsetDark.setAttribute('dx', '2');
        dotUpOffsetDark.setAttribute('dy', '2');
        const dotUpBlurDark = createSvgElement('feGaussianBlur');
        dotUpBlurDark.setAttribute('stdDeviation', '2');
        const dotUpCompositeDark = createSvgElement('feComposite');
        dotUpCompositeDark.setAttribute('in2', 'hardAlpha');
        dotUpCompositeDark.setAttribute('operator', 'out');
        const dotUpColorDark = createSvgElement('feColorMatrix');
        dotUpColorDark.setAttribute('type', 'matrix');
        dotUpColorDark.setAttribute('values', '0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.3 0');
        const dotUpBlendDark = createSvgElement('feBlend');
        dotUpBlendDark.setAttribute('mode', 'normal');
        dotUpBlendDark.setAttribute('in2', 'BackgroundImageFix');
        dotUpBlendDark.setAttribute('result', 'effect1_dropShadow');

        const dotUpAlphaLight = createSvgElement('feColorMatrix');
        dotUpAlphaLight.setAttribute('in', 'SourceAlpha');
        dotUpAlphaLight.setAttribute('type', 'matrix');
        dotUpAlphaLight.setAttribute('values', '0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0');
        dotUpAlphaLight.setAttribute('result', 'hardAlpha');
        const dotUpOffsetLight = createSvgElement('feOffset');
        dotUpOffsetLight.setAttribute('dx', '-2');
        dotUpOffsetLight.setAttribute('dy', '-2');
        const dotUpBlurLight = createSvgElement('feGaussianBlur');
        dotUpBlurLight.setAttribute('stdDeviation', '3');
        const dotUpCompositeLight = createSvgElement('feComposite');
        dotUpCompositeLight.setAttribute('in2', 'hardAlpha');
        dotUpCompositeLight.setAttribute('operator', 'out');
        const dotUpColorLight = createSvgElement('feColorMatrix');
        dotUpColorLight.setAttribute('type', 'matrix');
        dotUpColorLight.setAttribute('values', '0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 0.11 0');
        const dotUpBlendLight = createSvgElement('feBlend');
        dotUpBlendLight.setAttribute('mode', 'normal');
        dotUpBlendLight.setAttribute('in2', 'effect1_dropShadow');
        dotUpBlendLight.setAttribute('result', 'effect2_dropShadow');
        const dotUpBlendShape = createSvgElement('feBlend');
        dotUpBlendShape.setAttribute('mode', 'normal');
        dotUpBlendShape.setAttribute('in', 'SourceGraphic');
        dotUpBlendShape.setAttribute('in2', 'effect2_dropShadow');
        dotUpBlendShape.setAttribute('result', 'shape');

        const dotUpAlphaInnerDark = createSvgElement('feColorMatrix');
        dotUpAlphaInnerDark.setAttribute('in', 'SourceAlpha');
        dotUpAlphaInnerDark.setAttribute('type', 'matrix');
        dotUpAlphaInnerDark.setAttribute('values', '0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0');
        dotUpAlphaInnerDark.setAttribute('result', 'hardAlpha');
        const dotUpOffsetInnerDark = createSvgElement('feOffset');
        dotUpOffsetInnerDark.setAttribute('dx', '-2');
        dotUpOffsetInnerDark.setAttribute('dy', '-2');
        const dotUpBlurInnerDark = createSvgElement('feGaussianBlur');
        dotUpBlurInnerDark.setAttribute('stdDeviation', '1');
        const dotUpCompositeInnerDark = createSvgElement('feComposite');
        dotUpCompositeInnerDark.setAttribute('in2', 'hardAlpha');
        dotUpCompositeInnerDark.setAttribute('operator', 'arithmetic');
        dotUpCompositeInnerDark.setAttribute('k2', '-1');
        dotUpCompositeInnerDark.setAttribute('k3', '1');
        const dotUpColorInnerDark = createSvgElement('feColorMatrix');
        dotUpColorInnerDark.setAttribute('type', 'matrix');
        dotUpColorInnerDark.setAttribute('values', '0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.17 0');
        const dotUpBlendInnerDark = createSvgElement('feBlend');
        dotUpBlendInnerDark.setAttribute('mode', 'normal');
        dotUpBlendInnerDark.setAttribute('in2', 'shape');
        dotUpBlendInnerDark.setAttribute('result', 'effect3_innerShadow');

        const dotUpAlphaInnerLight = createSvgElement('feColorMatrix');
        dotUpAlphaInnerLight.setAttribute('in', 'SourceAlpha');
        dotUpAlphaInnerLight.setAttribute('type', 'matrix');
        dotUpAlphaInnerLight.setAttribute('values', '0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0');
        dotUpAlphaInnerLight.setAttribute('result', 'hardAlpha');
        const dotUpOffsetInnerLight = createSvgElement('feOffset');
        dotUpOffsetInnerLight.setAttribute('dx', '2');
        dotUpOffsetInnerLight.setAttribute('dy', '2');
        const dotUpBlurInnerLight = createSvgElement('feGaussianBlur');
        dotUpBlurInnerLight.setAttribute('stdDeviation', '1');
        const dotUpCompositeInnerLight = createSvgElement('feComposite');
        dotUpCompositeInnerLight.setAttribute('in2', 'hardAlpha');
        dotUpCompositeInnerLight.setAttribute('operator', 'arithmetic');
        dotUpCompositeInnerLight.setAttribute('k2', '-1');
        dotUpCompositeInnerLight.setAttribute('k3', '1');
        const dotUpColorInnerLight = createSvgElement('feColorMatrix');
        dotUpColorInnerLight.setAttribute('type', 'matrix');
        dotUpColorInnerLight.setAttribute('values', '0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 0.17 0');
        const dotUpBlendInnerLight = createSvgElement('feBlend');
        dotUpBlendInnerLight.setAttribute('mode', 'color-dodge');
        dotUpBlendInnerLight.setAttribute('in2', 'effect3_innerShadow');
        dotUpBlendInnerLight.setAttribute('result', 'effect4_innerShadow');

        dotUpFilter.appendChild(dotUpFlood);
        dotUpFilter.appendChild(dotUpAlphaDark);
        dotUpFilter.appendChild(dotUpOffsetDark);
        dotUpFilter.appendChild(dotUpBlurDark);
        dotUpFilter.appendChild(dotUpCompositeDark);
        dotUpFilter.appendChild(dotUpColorDark);
        dotUpFilter.appendChild(dotUpBlendDark);
        dotUpFilter.appendChild(dotUpAlphaLight);
        dotUpFilter.appendChild(dotUpOffsetLight);
        dotUpFilter.appendChild(dotUpBlurLight);
        dotUpFilter.appendChild(dotUpCompositeLight);
        dotUpFilter.appendChild(dotUpColorLight);
        dotUpFilter.appendChild(dotUpBlendLight);
        dotUpFilter.appendChild(dotUpBlendShape);
        dotUpFilter.appendChild(dotUpAlphaInnerDark);
        dotUpFilter.appendChild(dotUpOffsetInnerDark);
        dotUpFilter.appendChild(dotUpBlurInnerDark);
        dotUpFilter.appendChild(dotUpCompositeInnerDark);
        dotUpFilter.appendChild(dotUpColorInnerDark);
        dotUpFilter.appendChild(dotUpBlendInnerDark);
        dotUpFilter.appendChild(dotUpAlphaInnerLight);
        dotUpFilter.appendChild(dotUpOffsetInnerLight);
        dotUpFilter.appendChild(dotUpBlurInnerLight);
        dotUpFilter.appendChild(dotUpCompositeInnerLight);
        dotUpFilter.appendChild(dotUpColorInnerLight);
        dotUpFilter.appendChild(dotUpBlendInnerLight);
        defs.appendChild(dotUpFilter);

        // Neumorphic "down" filter for zone dot buttons.
        const dotDownFilter = createSvgElement('filter');
        dotDownFilter.setAttribute('id', 'ert-inquiry-zone-dot-down');
        dotDownFilter.setAttribute('x', '-50%');
        dotDownFilter.setAttribute('y', '-50%');
        dotDownFilter.setAttribute('width', '200%');
        dotDownFilter.setAttribute('height', '200%');
        dotDownFilter.setAttribute('color-interpolation-filters', 'sRGB');

        const dotDownOffsetDark = createSvgElement('feOffset');
        dotDownOffsetDark.setAttribute('in', 'SourceAlpha');
        dotDownOffsetDark.setAttribute('dx', '3.2');
        dotDownOffsetDark.setAttribute('dy', '3.2');
        dotDownOffsetDark.setAttribute('result', 'dot-down-offset-dark');
        const dotDownBlurDark = createSvgElement('feGaussianBlur');
        dotDownBlurDark.setAttribute('in', 'dot-down-offset-dark');
        dotDownBlurDark.setAttribute('stdDeviation', '2.4');
        dotDownBlurDark.setAttribute('result', 'dot-down-blur-dark');
        const dotDownCompositeDark = createSvgElement('feComposite');
        dotDownCompositeDark.setAttribute('in', 'dot-down-blur-dark');
        dotDownCompositeDark.setAttribute('in2', 'SourceAlpha');
        dotDownCompositeDark.setAttribute('operator', 'arithmetic');
        dotDownCompositeDark.setAttribute('k2', '-1');
        dotDownCompositeDark.setAttribute('k3', '1');
        dotDownCompositeDark.setAttribute('result', 'dot-down-inner-dark');
        const dotDownFloodDark = createSvgElement('feFlood');
        dotDownFloodDark.setAttribute('flood-color', '#000000');
        dotDownFloodDark.setAttribute('flood-opacity', '0.35');
        dotDownFloodDark.setAttribute('result', 'dot-down-flood-dark');
        const dotDownShadowDark = createSvgElement('feComposite');
        dotDownShadowDark.setAttribute('in', 'dot-down-flood-dark');
        dotDownShadowDark.setAttribute('in2', 'dot-down-inner-dark');
        dotDownShadowDark.setAttribute('operator', 'in');
        dotDownShadowDark.setAttribute('result', 'dot-down-shadow-dark');

        const dotDownOffsetLight = createSvgElement('feOffset');
        dotDownOffsetLight.setAttribute('in', 'SourceAlpha');
        dotDownOffsetLight.setAttribute('dx', '-3.2');
        dotDownOffsetLight.setAttribute('dy', '-3.2');
        dotDownOffsetLight.setAttribute('result', 'dot-down-offset-light');
        const dotDownBlurLight = createSvgElement('feGaussianBlur');
        dotDownBlurLight.setAttribute('in', 'dot-down-offset-light');
        dotDownBlurLight.setAttribute('stdDeviation', '2.4');
        dotDownBlurLight.setAttribute('result', 'dot-down-blur-light');
        const dotDownCompositeLight = createSvgElement('feComposite');
        dotDownCompositeLight.setAttribute('in', 'dot-down-blur-light');
        dotDownCompositeLight.setAttribute('in2', 'SourceAlpha');
        dotDownCompositeLight.setAttribute('operator', 'arithmetic');
        dotDownCompositeLight.setAttribute('k2', '-1');
        dotDownCompositeLight.setAttribute('k3', '1');
        dotDownCompositeLight.setAttribute('result', 'dot-down-inner-light');
        const dotDownFloodLight = createSvgElement('feFlood');
        dotDownFloodLight.setAttribute('flood-color', '#ffffff');
        dotDownFloodLight.setAttribute('flood-opacity', '0.22');
        dotDownFloodLight.setAttribute('result', 'dot-down-flood-light');
        const dotDownShadowLight = createSvgElement('feComposite');
        dotDownShadowLight.setAttribute('in', 'dot-down-flood-light');
        dotDownShadowLight.setAttribute('in2', 'dot-down-inner-light');
        dotDownShadowLight.setAttribute('operator', 'in');
        dotDownShadowLight.setAttribute('result', 'dot-down-shadow-light');

        const dotDownMerge = createSvgElement('feMerge');
        const dotDownMergeGraphic = createSvgElement('feMergeNode');
        dotDownMergeGraphic.setAttribute('in', 'SourceGraphic');
        const dotDownMergeDark = createSvgElement('feMergeNode');
        dotDownMergeDark.setAttribute('in', 'dot-down-shadow-dark');
        const dotDownMergeLight = createSvgElement('feMergeNode');
        dotDownMergeLight.setAttribute('in', 'dot-down-shadow-light');
        dotDownMerge.appendChild(dotDownMergeGraphic);
        dotDownMerge.appendChild(dotDownMergeDark);
        dotDownMerge.appendChild(dotDownMergeLight);

        dotDownFilter.appendChild(dotDownOffsetDark);
        dotDownFilter.appendChild(dotDownBlurDark);
        dotDownFilter.appendChild(dotDownCompositeDark);
        dotDownFilter.appendChild(dotDownFloodDark);
        dotDownFilter.appendChild(dotDownShadowDark);
        dotDownFilter.appendChild(dotDownOffsetLight);
        dotDownFilter.appendChild(dotDownBlurLight);
        dotDownFilter.appendChild(dotDownCompositeLight);
        dotDownFilter.appendChild(dotDownFloodLight);
        dotDownFilter.appendChild(dotDownShadowLight);
        dotDownFilter.appendChild(dotDownMerge);
        defs.appendChild(dotDownFilter);

        const backboneGradient = createSvgElement('linearGradient');
        backboneGradient.setAttribute('id', 'ert-inquiry-minimap-backbone-grad');
        backboneGradient.setAttribute('x1', '0%');
        backboneGradient.setAttribute('y1', '0%');
        backboneGradient.setAttribute('x2', '100%');
        backboneGradient.setAttribute('y2', '0%');
        const startColors = getBackboneStartColors(this.getStyleSource());
        const gradientStart = startColors.gradient[0] ?? { r: 255, g: 153, b: 0 };
        const gradientMid = startColors.gradient[1] ?? { r: 255, g: 211, b: 106 };
        const gradientEnd = startColors.gradient[2] ?? { r: 255, g: 94, b: 0 };
        const backboneGradientStops = [
            createStop('0%', toRgbString(gradientStart)),
            createStop('50%', toRgbString(gradientMid)),
            createStop('100%', toRgbString(gradientEnd))
        ];
        backboneGradientStops.forEach(stop => backboneGradient.appendChild(stop));
        this.minimap.setGradientStops(backboneGradientStops);
        defs.appendChild(backboneGradient);

        const backboneShine = createSvgElement('linearGradient');
        backboneShine.setAttribute('id', 'ert-inquiry-minimap-backbone-shine');
        backboneShine.setAttribute('x1', '0%');
        backboneShine.setAttribute('y1', '0%');
        backboneShine.setAttribute('x2', '100%');
        backboneShine.setAttribute('y2', '0%');
        const shineStart = startColors.shine[0] ?? { r: 255, g: 242, b: 207 };
        const shinePeak = startColors.shine[1] ?? { r: 255, g: 247, b: 234 };
        const shineWarm = startColors.shine[2] ?? { r: 255, g: 179, b: 77 };
        const shineEnd = startColors.shine[3] ?? { r: 255, g: 242, b: 207 };
        const backboneShineStops = [
            createStop('0%', toRgbString(shineStart), '0'),
            createStop('40%', toRgbString(shinePeak), '1'),
            createStop('60%', toRgbString(shineWarm), '0.9'),
            createStop('100%', toRgbString(shineEnd), '0')
        ];
        backboneShineStops.forEach(stop => backboneShine.appendChild(stop));
        this.minimap.setShineStops(backboneShineStops);
        defs.appendChild(backboneShine);

        this.minimap.initBackboneClip(defs);

        // Hatched pattern for cached portion overlay on token cap bar
        const cachedPattern = createSvgElement('pattern');
        cachedPattern.setAttribute('id', 'ert-inquiry-minimap-cached-hatch');
        cachedPattern.setAttribute('width', '8');
        cachedPattern.setAttribute('height', '8');
        cachedPattern.setAttribute('patternUnits', 'userSpaceOnUse');
        const hatchBg = createSvgElement('rect');
        hatchBg.setAttribute('x', '0');
        hatchBg.setAttribute('y', '0');
        hatchBg.setAttribute('width', '8');
        hatchBg.setAttribute('height', '8');
        hatchBg.classList.add('ert-inquiry-minimap-cached-hatch-bg');
        cachedPattern.appendChild(hatchBg);
        const hatchLine = createSvgElement('line');
        hatchLine.setAttribute('x1', '0');
        hatchLine.setAttribute('y1', '0');
        hatchLine.setAttribute('x2', '8');
        hatchLine.setAttribute('y2', '8');
        hatchLine.classList.add('ert-inquiry-minimap-cached-hatch-stroke');
        cachedPattern.appendChild(hatchLine);
        const hatchLineSecondary = createSvgElement('line');
        hatchLineSecondary.setAttribute('x1', '0');
        hatchLineSecondary.setAttribute('y1', '8');
        hatchLineSecondary.setAttribute('x2', '8');
        hatchLineSecondary.setAttribute('y2', '0');
        hatchLineSecondary.classList.add('ert-inquiry-minimap-cached-hatch-stroke');
        cachedPattern.appendChild(hatchLineSecondary);
        defs.appendChild(cachedPattern);
    }

    private createIconSymbol(defs: SVGDefsElement, iconName: string): string | null {
        const holder = defs.ownerDocument.win.createSpan();
        setIcon(holder, iconName);
        const source = holder.querySelector('svg');
        if (!source) {
            if (iconName === 'file-x-corner') {
                return this.createFallbackFileXCornerSymbol(defs);
            }
            if (iconName !== 'sigma') return null;
            const symbol = createSvgElement('symbol');
            const symbolId = `ert-icon-${iconName}`;
            symbol.setAttribute('id', symbolId);
            symbol.setAttribute('viewBox', '0 0 24 24');
            const text = createSvgElement('text');
            text.setAttribute('x', '12');
            text.setAttribute('y', '13');
            text.setAttribute('text-anchor', 'middle');
            text.setAttribute('dominant-baseline', 'middle');
            text.setAttribute('font-size', '16');
            text.setAttribute('font-weight', '700');
            text.textContent = String.fromCharCode(931);
            symbol.appendChild(text);
            defs.appendChild(symbol);
            return symbolId;
        }
        const symbol = createSvgElement('symbol');
        const symbolId = `ert-icon-${iconName}`;
        symbol.setAttribute('id', symbolId);
        symbol.setAttribute('viewBox', source.getAttribute('viewBox') || '0 0 24 24'); // SAFE: source icon missing viewBox — Lucide default 24x24 box
        Array.from(source.children).forEach(child => {
            if (child.tagName.toLowerCase() === 'title') return;
            symbol.appendChild(child.cloneNode(true));
        });
        if (iconName === 'circle-dot') {
            const circles = Array.from(symbol.querySelectorAll('circle'));
            if (circles.length >= 2) {
                const sorted = circles
                    .slice()
                    .sort((a, b) => (Number(a.getAttribute('r')) || 0) - (Number(b.getAttribute('r')) || 0)); // SAFE: circle without an r attribute sorts as radius 0
                const inner = sorted[0];
                const outer = sorted[sorted.length - 1];
                const outerCx = outer.getAttribute('cx');
                const outerCy = outer.getAttribute('cy');
                if (outerCx) inner.setAttribute('cx', outerCx);
                if (outerCy) inner.setAttribute('cy', outerCy);
                const innerRadius = Number(inner.getAttribute('r'));
                if (Number.isFinite(innerRadius) && innerRadius > 0) {
                    inner.setAttribute('r', String(Math.max(1, innerRadius * 0.7)));
                }
                inner.setAttribute('fill', 'currentColor');
                inner.setAttribute('stroke', 'none');
            }
        }
        defs.appendChild(symbol);
        return symbolId;
    }

    private createFallbackFileXCornerSymbol(defs: SVGDefsElement): string {
        const symbolId = 'ert-icon-file-x-corner';
        const existing = defs.querySelector(`#${symbolId}`);
        if (existing) return symbolId;
        const symbol = createSvgElement('symbol');
        symbol.setAttribute('id', symbolId);
        symbol.setAttribute('viewBox', '0 0 24 24');
        [
            'M11 22H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.706.706l3.588 3.588A2.4 2.4 0 0 1 20 8v5',
            'M14 2v5a1 1 0 0 0 1 1h5',
            'm15 17 5 5',
            'm20 17-5 5'
        ].forEach(d => {
            const path = createSvgElement('path');
            path.setAttribute('d', d);
            symbol.appendChild(path);
        });
        defs.appendChild(symbol);
        return symbolId;
    }

    private createIconButton(
        parent: SVGElement,
        x: number,
        y: number,
        size: number,
        iconName: string,
        _label: string,
        extraClass = ''
    ): SVGGElement {
        const group = createSvgGroup(parent, `ert-inquiry-icon-btn ${extraClass}`.trim(), x, y);
        group.setAttribute('role', 'button');
        group.setAttribute('tabindex', '0');
        const rect = createSvgElement('rect');
        rect.classList.add('ert-inquiry-icon-btn-bg');
        rect.setAttribute('width', String(size));
        rect.setAttribute('height', String(size));
        rect.setAttribute('rx', String(Math.round(size * 0.3)));
        rect.setAttribute('ry', String(Math.round(size * 0.3)));
        group.appendChild(rect);
        const iconSize = Math.round(size * 0.5);
        const icon = this.createIconUse(iconName, (size - iconSize) / 2, (size - iconSize) / 2, iconSize);
        icon.classList.add('ert-inquiry-icon');
        group.appendChild(icon);
        return group;
    }

    private createIconUse(iconName: string, x: number, y: number, size: number): SVGUseElement {
        const use = createSvgElement('use');
        use.setAttribute('x', String(x));
        use.setAttribute('y', String(y));
        use.setAttribute('width', String(size));
        use.setAttribute('height', String(size));
        this.setIconUse(use, iconName);
        return use;
    }

    private setIconUse(use: SVGUseElement | undefined, iconName: string): void {
        if (!use) return;
        const symbolId = `ert-icon-${iconName}`;
        use.setAttribute('href', `#${symbolId}`);
        use.setAttributeNS('http://www.w3.org/1999/xlink', 'href', `#${symbolId}`);
    }

    private buildDefaultSelectedPromptIds(): Record<InquiryZone, string> {
        const config = this.getPromptConfig();
        const pickFirstAvailable = (zone: InquiryZone): string => {
            const slots = config[zone] ?? []; // SAFE: zone may be absent from prompt config — no slots to pick from
            const firstAvailable = slots.find(slot => this.getQuestionTextForSlot(zone, slot).trim().length > 0);
            return firstAvailable?.id ?? slots[0]?.id ?? zone;
        };
        return {
            setup: pickFirstAvailable('setup'),
            pressure: pickFirstAvailable('pressure'),
            payoff: pickFirstAvailable('payoff')
        };
    }

    private ensurePromptConfig(): void {
        if (!this.settingsAccessor.getPromptConfig()) {
            this.plugin.settings.inquiryPromptConfig = buildDefaultInquiryPromptConfig();
            void this.plugin.saveSettings();
        }
    }

    private getPromptConfig(): InquiryPromptConfig {
        return normalizeInquiryPromptConfig(this.settingsAccessor.getPromptConfig());
    }

    private getQuestionTextForSlot(_zone: InquiryZone, slot: InquiryPromptSlot): string {
        return getPromptSlotQuestion(slot);
    }

    private getFocusedPromptForSlot(
        _zone: InquiryZone,
        slot: InquiryPromptSlot,
        standardPrompt: string
    ): string | undefined {
        const canonical = getCanonicalQuestionForSlot(slot);
        if (canonical?.focusedPrompt?.trim().length) {
            return canonical.focusedPrompt.trim();
        }
        if (slot.builtIn && canonical) {
            return undefined;
        }
        const focusedPrompt = buildFocusedCustomPrompt(standardPrompt);
        return focusedPrompt.trim().length ? focusedPrompt : undefined;
    }

    private resolveSlotTier(slotIndex: number): InquiryCanonicalQuestionTier {
        return slotIndex >= 4 ? 'signature' : 'core';
    }

    private buildInquiryQuestion(
        zone: InquiryZone,
        slot: InquiryPromptSlot,
        icon: string,
        slotIndex: number
    ): InquiryQuestion | null {
        const standardPrompt = this.getQuestionTextForSlot(zone, slot).trim();
        if (!standardPrompt) return null;
        return {
            id: slot.id,
            label: slot.label || (zone === 'setup' ? 'Setup' : zone === 'pressure' ? 'Pressure' : 'Payoff'),
            standardPrompt,
            focusedPrompt: this.getFocusedPromptForSlot(zone, slot, standardPrompt),
            zone,
            icon,
            tier: this.resolveSlotTier(slotIndex)
        };
    }

    private resolveQuestionPromptForRun(
        question: InquiryQuestion,
        selectionMode: InquirySelectionMode,
        override?: InquiryQuestionPromptForm
    ): string {
        return resolveQuestionPrompt(question, selectionMode, override);
    }

    private resolveQuestionPromptFormForRun(
        question: InquiryQuestion,
        selectionMode: InquirySelectionMode,
        override?: InquiryQuestionPromptForm
    ): InquiryQuestionPromptForm {
        return resolveQuestionPromptForm(question, selectionMode, override);
    }

    private getPromptOptions(zone: InquiryZone): InquiryQuestion[] {
        const config = this.getPromptConfig();
        const icon = zone === 'setup' ? 'help-circle' : zone === 'pressure' ? 'activity' : 'check-circle';
        const slots = config[zone] ?? []; // SAFE: zone may be absent from prompt config — no slots visible
        const visibleSlots = hasProFeatureAccess(this.plugin)
            ? slots
            : slots.slice(0, 4);
        return visibleSlots
            .map((slot, slotIndex) => this.buildInquiryQuestion(zone, slot, icon, slotIndex))
            .filter((question): question is InquiryQuestion => !!question);
    }

    private getActivePrompt(zone: InquiryZone): InquiryQuestion | undefined {
        const options = this.getPromptOptions(zone);
        if (!options.length) return undefined;
        const activeId = this.state.selectedPromptIds[zone];
        const match = options.find(prompt => prompt.id === activeId);
        if (match) return match;
        const fallback = options[0];
        this.state.selectedPromptIds[zone] = fallback.id;
        return fallback;
    }

    private getProcessedPromptState(): { id: string | null; status: 'success' | 'error' | null } {
        const result = this.state.activeResult;
        if (!result || this.state.isRunning) return { id: null, status: null };
        if (result.scope !== this.state.scope) return { id: null, status: null };
        const scopeLabel = this.getScopeLabel();
        if (result.scopeLabel && result.scopeLabel !== scopeLabel) return { id: null, status: null };
        const status = this.isErrorResult(result) ? 'error' : 'success';
        return { id: result.questionId, status };
    }

    /**
     * Computes exact reusable, prior same-corpus, and stale corpus-drift prompt IDs.
     * Model changes affect exact rehydration, but they do not make an analysis stale.
     */
    private computePromptCacheStates(): {
        cachedIds: Set<string>;
        priorIds: Set<string>;
        staleIds: Set<string>;
        staleDiagnoses: Map<string, InquiryStaleDiagnosis>;
    } {
        const cachedIds = new Set<string>();
        const priorIds = new Set<string>();
        const staleIds = new Set<string>();
        const staleDiagnoses = new Map<string, InquiryStaleDiagnosis>();
        const scopeKey = this.getScopeKey();
        const targetSceneIds = this.getActiveTargetSceneIds();
        const selectionMode = this.getSelectionMode(targetSceneIds);
        const engineSelection = this.resolveEngineSelectionForRun();
        const modelId = engineSelection.modelId;

        // Cache entry-derived fingerprintSource by contextRequired flag.
        // Entries only differ based on this flag (questionId/zone don't affect entries
        // when contextRequired is passed explicitly). This avoids redundant vault scans.
        const fingerprintSourceByContext = new Map<boolean, string>();

        for (const zone of ['setup', 'pressure', 'payoff'] as const) {
            const prompts = this.getPromptOptions(zone);
            for (const prompt of prompts) {
                const contextRequired = this.isContextRequiredForQuestion(prompt.id, zone);

                let fingerprintSource = fingerprintSourceByContext.get(contextRequired);
                if (fingerprintSource === undefined) {
                    const manifest = this.buildCorpusManifest(prompt.id, {
                        modelId,
                        questionZone: zone,
                        contextRequired
                    });
                    fingerprintSource = manifest.entries
                        .map(e => `${e.path}:${e.sceneId ?? ''}:${e.mtime}:${e.mode}:${e.isTarget ? 1 : 0}`) // SAFE: non-scene entries have no sceneId — empty segment keeps the fingerprint stable
                        .sort()
                        .join('|');
                    fingerprintSourceByContext.set(contextRequired, fingerprintSource);
                }

                const fingerprintRaw = `${INQUIRY_SCHEMA_VERSION}|${prompt.id}|${modelId}|${fingerprintSource}`;
                const fingerprint = this.hashString(fingerprintRaw);

                const effectiveOverride = this.getEffectivePromptOverride(prompt.id);
                const questionText = this.resolveQuestionPromptForRun(prompt, selectionMode, effectiveOverride);
                const questionPromptForm = this.resolveQuestionPromptFormForRun(prompt, selectionMode, effectiveOverride);
                const questionSignature = this.buildQuestionSignature(questionText);

                const baseKey = this.sessionStore.buildBaseKey({
                    questionId: prompt.id,
                    questionPromptForm,
                    questionSignature,
                    scope: this.state.scope,
                    scopeKey,
                    targetSceneIds
                });

                const key = this.sessionStore.buildKey(baseKey, fingerprint);
                const session = this.sessionStore.peekSession(key);
                if (session && !this.isErrorResult(session.result)) {
                    cachedIds.add(prompt.id);
                    continue;
                }
                const priorByBase = this.sessionStore.getLatestByBaseKey(baseKey);
                if (priorByBase && !this.isErrorResult(priorByBase.result)) {
                    // With no key there is no "selected model" to re-run against,
                    // and the saved session never key-matches (the current model
                    // is empty). Treat a saved briefing as the available result
                    // ("Open previous result"), not a foreign-model prior.
                    if (this.isInquiryApiKeyMissing()) {
                        cachedIds.add(prompt.id);
                        continue;
                    }
                    // Briefing history is not cache validity. Once a briefing
                    // exists for the same question/scope/target/form, keep the
                    // muted prior-run affordance visible until the author
                    // explicitly purges briefing history.
                    priorIds.add(prompt.id);

                    const priorCorpusOnly = priorByBase.result.corpusOnlyFingerprint;
                    const currentCorpusOnly = this.hashString(`${INQUIRY_SCHEMA_VERSION}|${prompt.id}|${fingerprintSource}`);
                    if (!priorCorpusOnly || priorCorpusOnly === currentCorpusOnly) {
                        continue;
                    }
                    // Corpus drift is still tracked for hover copy / briefing
                    // stale badges, but it must not erase history visibility.
                    const diagnosis = this.diagnoseSessionStaleness(priorByBase);
                    if (diagnosis) {
                        staleIds.add(prompt.id);
                        staleDiagnoses.set(prompt.id, diagnosis);
                    }
                }
            }
        }

        return { cachedIds, priorIds, staleIds, staleDiagnoses };
    }

    private updateZonePrompts(): void {
        this.syncSelectedPromptIds();
        const paddingX = 24;
        const pillHeight = 40;
        const processed = this.getProcessedPromptState();
        this.zonePromptElements.forEach((elements, zone) => {
            const prompt = this.getActivePrompt(zone);
            if (!prompt) {
                if (elements.text.textContent !== '') {
                    this.perfCounters.svgTextWrites++;
                    elements.text.textContent = '';
                    elements.bg.setAttribute('width', '0');
                    elements.bg.setAttribute('height', '0');
                    elements.glow.setAttribute('width', '0');
                    elements.glow.setAttribute('height', '0');
                    elements.group.classList.remove('is-active', 'is-processed', 'is-processed-success', 'is-processed-error', 'is-locked');
                    elements.group.removeAttribute('data-prompt-id');
                }
                return;
            }

            if (elements.text.textContent !== prompt.standardPrompt) {
                this.perfCounters.svgTextWrites++;
                elements.text.textContent = prompt.standardPrompt;
                const textLength = elements.text.getComputedTextLength();
                const width = Math.max(textLength + (paddingX * 2), 180);
                const widthFixed = width.toFixed(2);
                
                elements.bg.setAttribute('width', widthFixed);
                elements.bg.setAttribute('height', String(pillHeight));
                elements.bg.setAttribute('x', String(-width / 2));
                elements.bg.setAttribute('y', String(-pillHeight / 2));
                elements.bg.setAttribute('rx', String(pillHeight / 2));
                elements.bg.setAttribute('ry', String(pillHeight / 2));
                
                elements.glow.setAttribute('width', widthFixed);
                elements.glow.setAttribute('height', String(pillHeight));
                elements.glow.setAttribute('x', String(-width / 2));
                elements.glow.setAttribute('y', String(-pillHeight / 2));
                elements.glow.setAttribute('rx', String(pillHeight / 2));
                elements.glow.setAttribute('ry', String(pillHeight / 2));
            }

            this.toggleClassIfChanged(elements.group, 'is-active', this.state.selectedPromptIds[zone] === prompt.id, 'svgAttrWrites');
            const isProcessed = processed.id === prompt.id;
            this.toggleClassIfChanged(elements.group, 'is-processed', isProcessed, 'svgAttrWrites');
            this.toggleClassIfChanged(elements.group, 'is-processed-success', isProcessed && processed.status === 'success', 'svgAttrWrites');
            this.toggleClassIfChanged(elements.group, 'is-processed-error', isProcessed && processed.status === 'error', 'svgAttrWrites');
            this.toggleClassIfChanged(elements.group, 'is-locked', this.state.isRunning && this.state.activeZone === zone, 'svgAttrWrites');
            
            const currentPromptId = elements.group.getAttribute('data-prompt-id');
            if (currentPromptId !== prompt.id) {
                this.perfCounters.svgAttrWrites++;
                elements.group.setAttribute('data-prompt-id', prompt.id);
            }
            if (elements.group.hasAttribute('aria-label')) {
                this.perfCounters.svgAttrWrites++;
                elements.group.removeAttribute('aria-label');
            }
        });
    }

    private updateGlyphPromptState(): void {
        if (!this.glyph) return;
        this.syncSelectedPromptIds();
        const processed = this.getProcessedPromptState();
        const selectionMode = this.getSelectionMode(this.getActiveTargetSceneIds());
        const promptsByZone = {
            setup: this.getPromptOptions('setup').map(prompt => ({ id: prompt.id, question: prompt.standardPrompt, tier: prompt.tier })),
            pressure: this.getPromptOptions('pressure').map(prompt => ({ id: prompt.id, question: prompt.standardPrompt, tier: prompt.tier })),
            payoff: this.getPromptOptions('payoff').map(prompt => ({ id: prompt.id, question: prompt.standardPrompt, tier: prompt.tier }))
        };
        const focusedFormIds = new Set<string>();
        for (const zone of ['setup', 'pressure', 'payoff'] as const) {
            for (const prompt of this.getPromptOptions(zone)) {
                const effective = this.getEffectivePromptOverride(prompt.id);
                if (resolveQuestionPromptForm(prompt, selectionMode, effective) === 'focused') {
                    focusedFormIds.add(prompt.id);
                }
            }
        }
        const { cachedIds: cachedPromptIds, priorIds: priorPromptIds, staleIds: stalePromptIds } = this.computePromptCacheStates();
        this.glyph.updatePromptState({
            promptsByZone,
            selectedPromptIds: this.state.selectedPromptIds,
            processedPromptId: processed.id,
            processedStatus: processed.status,
            lockedPromptId: this.state.isRunning ? this.state.activeQuestionId : null,
            focusedFormIds,
            cachedPromptIds,
            priorPromptIds,
            stalePromptIds,
            onPromptSelect: (zone, promptId, event) => {
                // No-key demo stays browsable: let the click through so runInquiry's
                // no-key guard reopens this zone's saved briefing. Otherwise a
                // run-disabled view swallows the click.
                if (this.isInquiryRunDisabled() && !this.isInquiryDemoMode()) return;
                if (this.state.isRunning) {
                    this.notifyInteraction(t('inquiry.interaction.running'));
                    return;
                }
                const prompt = this.getPromptOptions(zone)
                    .find(item => item.id === promptId);
                if (prompt && this.isErrorState() && this.state.activeResult?.questionId === prompt.id) {
                    void this.openInquiryErrorLog();
                    return;
                }
                this.clearErrorStateForAction();
                this.setSelectedPrompt(zone, promptId);
                if (prompt) {
                    void this.handleQuestionClick(prompt, { forceRerun: event?.shiftKey });
                } else {
                    this.notifyInteraction(t('inquiry.interaction.noQuestionForSlot'));
                }
            },
            onPromptContextMenu: (zone, promptId, event) => {
                const prompt = this.getPromptOptions(zone).find(item => item.id === promptId);
                if (!prompt) {
                    this.notifyInteraction(t('inquiry.interaction.noQuestionForSlot'));
                    return;
                }
                this.showQuestionRunMenu(prompt, event);
            },
            onPromptHover: (zone, promptId, promptText) => {
                if (this.isInquiryRunDisabled()) return;
                const prompt = this.getPromptOptions(zone).find(item => item.id === promptId);
                this.showPromptPreview(
                    zone,
                    this.state.mode,
                    prompt
                        ? this.resolveQuestionPromptForRun(prompt, this.getSelectionMode(this.getActiveTargetSceneIds()), this.getEffectivePromptOverride(promptId))
                        : promptText,
                    prompt?.id
                );
            },
            onPromptHoverEnd: () => {
                if (this.isInquiryRunDisabled()) return;
                this.hidePromptPreview();
            }
        });
    }

    private syncSelectedPromptIds(): void {
        const config = this.getPromptConfig();
        (['setup', 'pressure', 'payoff'] as InquiryZone[]).forEach(zone => {
            const slots = config[zone] ?? []; // SAFE: zone may be absent from prompt config — no slots to sync
            const available = slots.filter(slot => this.getQuestionTextForSlot(zone, slot).trim().length > 0);
            const desired = available[0]?.id ?? slots[0]?.id ?? zone;
            if (!desired) return;
            const current = this.state.selectedPromptIds[zone];
            const currentValid = available.some(slot => slot.id === current);
            if (!currentValid) {
                this.state.selectedPromptIds[zone] = desired;
            }
        });
    }

    private setSelectedPrompt(zone: InquiryZone, promptId: string): void {
        if (this.state.isRunning) return;
        if (this.state.selectedPromptIds[zone] === promptId) return;
        this.state.selectedPromptIds[zone] = promptId;
        this.updateZonePrompts();
        this.updateGlyphPromptState();
    }

    private handlePromptClick(zone: InquiryZone, event?: MouseEvent): void {
        if (this.isInquiryRunDisabled()) return;
        if (this.state.isRunning) {
            this.notifyInteraction(t('inquiry.interaction.running'));
            return;
        }
        const options = this.getPromptOptions(zone);
        if (!options.length) {
            this.notifyInteraction(t('inquiry.interaction.noQuestionsForZone'));
            return;
        }
        const currentId = this.state.selectedPromptIds[zone];
        const currentIdx = options.findIndex(prompt => prompt.id === currentId);
        const nextIdx = options.length > 1
            ? (currentIdx >= 0 ? (currentIdx + 1) % options.length : 0)
            : (currentIdx >= 0 ? currentIdx : 0);
        const nextPrompt = options[nextIdx] ?? options[0];
        if (!nextPrompt) {
            this.notifyInteraction(t('inquiry.interaction.noQuestionsForZone'));
            return;
        }
        if (!event?.shiftKey && this.isErrorState() && this.state.activeResult?.questionId === nextPrompt.id) {
            void this.openInquiryErrorLog();
            return;
        }
        this.clearErrorStateForAction();
        if (nextPrompt.id !== currentId) {
            this.setSelectedPrompt(zone, nextPrompt.id);
        }
        void this.handleQuestionClick(nextPrompt, { forceRerun: event?.shiftKey });
    }

    private showQuestionRunMenu(question: InquiryQuestion, event: MouseEvent): void {
        const menu = new Menu();
        const current = this.state.promptFormOverrides[question.id] ?? 'auto'; // SAFE: no per-question override recorded — auto is the default form
        const options: Array<{ label: string; value: InquiryPromptFormOverride }> = [
            { label: t('inquiry.menu.optionDefaultRun'), value: 'auto' },
            { label: t('inquiry.menu.optionStandard'), value: 'standard' },
            { label: t('inquiry.menu.optionFocused'), value: 'focused' }
        ];
        for (const opt of options) {
            menu.addItem(item => {
                item.setTitle(opt.value === current ? `${opt.label}  \u2713` : opt.label);
                item.onClick(() => {
                    this.setPromptFormOverride(question.id, opt.value);
                });
            });
        }
        menu.addSeparator();
        menu.addItem(item => {
            item.setTitle(t('inquiry.menu.forceRerun'));
            item.onClick(() => {
                this.setSelectedPrompt(question.zone, question.id);
                void this.handleQuestionClick(question, { forceRerun: true });
            });
        });
        menu.showAtMouseEvent(event);
    }

    private setPromptFormOverride(questionId: string, override: InquiryPromptFormOverride): void {
        if (override === 'auto') {
            delete this.state.promptFormOverrides[questionId];
        } else {
            this.state.promptFormOverrides[questionId] = override;
        }
        this.updateGlyphPromptState();
    }

    private getEffectivePromptOverride(questionId: string): InquiryQuestionPromptForm | undefined {
        const override = this.state.promptFormOverrides[questionId];
        if (!override || override === 'auto') return undefined;
        return override;
    }

    private renderZonePods(parent: SVGGElement): void {
        const rZone = FLOW_RADIUS + FLOW_STROKE + 90;
        const zones: Array<{ id: InquiryZone; angle: number }> = [
            { id: 'setup', angle: 210 },
            { id: 'pressure', angle: 330 },
            { id: 'payoff', angle: 90 }
        ];

        this.zonePromptElements.clear();

        zones.forEach(zone => {
            const pos = polarToCartesian(rZone, zone.angle);
            const zoneEl = createSvgGroup(parent, `ert-inquiry-zone-pod ert-inquiry-zone--${zone.id}`, pos.x, pos.y);
            zoneEl.setAttribute('role', 'button');
            zoneEl.setAttribute('tabindex', '0');
            const bg = createSvgElement('rect');
            bg.classList.add('ert-inquiry-zone-pill');
            zoneEl.appendChild(bg);
            const glow = createSvgElement('rect');
            glow.classList.add('ert-inquiry-zone-pill-glow');
            zoneEl.appendChild(glow);

            const text = createSvgText(zoneEl, 'ert-inquiry-zone-pill-text', '', 0, 0);
            text.setAttribute('text-anchor', 'middle');
            text.setAttribute('dominant-baseline', 'middle');
            text.setAttribute('alignment-baseline', 'middle');

            this.zonePromptElements.set(zone.id, { group: zoneEl, bg, glow, text });
            bindInquiryZonePodEvents({
                registerSvgEvent: this.registerSvgEvent.bind(this),
                zoneEl,
                onClick: (event) => this.handlePromptClick(zone.id, event),
                onContextMenu: (event) => {
                    if (this.isInquiryRunDisabled()) return;
                    const prompt = this.getActivePrompt(zone.id);
                    if (!prompt) {
                        this.notifyInteraction(t('inquiry.interaction.noQuestionsForZone'));

                        return;
                    }
                    this.showQuestionRunMenu(prompt, event);
                },
                onPointerEnter: () => {
                    if (this.isInquiryRunDisabled()) return;
                    const prompt = this.getActivePrompt(zone.id);
                    if (prompt) {
                        this.showPromptPreview(
                            zone.id,
                            this.state.mode,
                            this.resolveQuestionPromptForRun(prompt, this.getSelectionMode(this.getActiveTargetSceneIds()), this.getEffectivePromptOverride(prompt.id)),
                            prompt.id
                        );
                    }
                    this.setHoverText(this.buildZoneHoverText(zone.id));
                },
                onPointerLeave: () => {
                    if (this.isInquiryRunDisabled()) return;
                    this.clearHoverText();
                    this.hidePromptPreview();
                }
            });
        });
    }

    private buildDebugOverlay(parent: SVGElement): void {
        const debugGroup = createSvgGroup(parent, 'ert-inquiry-debug');
        debugGroup.setAttribute('id', 'inq-debug');

        const rect = createSvgElement('rect');
        rect.classList.add('ert-inquiry-debug-frame');
        rect.setAttribute('x', String(VIEWBOX_MIN));
        rect.setAttribute('y', String(VIEWBOX_MIN));
        rect.setAttribute('width', String(VIEWBOX_SIZE));
        rect.setAttribute('height', String(VIEWBOX_SIZE));
        debugGroup.appendChild(rect);

        const xAxis = createSvgElement('line');
        xAxis.classList.add('ert-inquiry-debug-axis');
        xAxis.setAttribute('x1', String(VIEWBOX_MIN));
        xAxis.setAttribute('y1', '0');
        xAxis.setAttribute('x2', String(VIEWBOX_MAX));
        xAxis.setAttribute('y2', '0');
        debugGroup.appendChild(xAxis);

        const yAxis = createSvgElement('line');
        yAxis.classList.add('ert-inquiry-debug-axis');
        yAxis.setAttribute('x1', '0');
        yAxis.setAttribute('y1', String(VIEWBOX_MIN));
        yAxis.setAttribute('x2', '0');
        yAxis.setAttribute('y2', String(VIEWBOX_MAX));
        debugGroup.appendChild(yAxis);

        const tickOffsets = [VIEWBOX_MAX * 0.25, VIEWBOX_MAX * 0.5];
        const tickHalf = 12;
        tickOffsets.forEach(offset => {
            [offset, -offset].forEach(position => {
                const xTick = createSvgElement('line');
                xTick.classList.add('ert-inquiry-debug-tick');
                xTick.setAttribute('x1', String(position));
                xTick.setAttribute('y1', String(-tickHalf));
                xTick.setAttribute('x2', String(position));
                xTick.setAttribute('y2', String(tickHalf));
                debugGroup.appendChild(xTick);

                const yTick = createSvgElement('line');
                yTick.classList.add('ert-inquiry-debug-tick');
                yTick.setAttribute('x1', String(-tickHalf));
                yTick.setAttribute('y1', String(position));
                yTick.setAttribute('x2', String(tickHalf));
                yTick.setAttribute('y2', String(position));
                debugGroup.appendChild(yTick);
            });
        });

        const label = createSvgText(debugGroup, 'ert-inquiry-debug-label', t('inquiry.debug.origin'), 0, 0);
        label.setAttribute('text-anchor', 'middle');
        label.setAttribute('dominant-baseline', 'middle');
    }

    private buildSceneDossierResources(defs: SVGDefsElement): void {
        if (defs.querySelector('#ert-inquiry-scene-dossier-focus-grad')) return;
        const gradient = createSvgElement('radialGradient');
        gradient.setAttribute('id', 'ert-inquiry-scene-dossier-focus-grad');
        gradient.setAttribute('cx', '50%');
        gradient.setAttribute('cy', '46%');
        gradient.setAttribute('fx', '50%');
        gradient.setAttribute('fy', '42%');
        gradient.setAttribute('r', '54%');
        ['0%', '32%', '70%', '100%'].forEach(offset => {
            const stop = createSvgElement('stop');
            stop.setAttribute('offset', offset);
            gradient.appendChild(stop);
        });
        defs.appendChild(gradient);
    }

    private renderModeIcons(parent: SVGGElement): void {
        const iconOffsetY = MODE_ICON_OFFSET_Y;
        const iconSize = Math.round(VIEWBOX_SIZE * 0.25 * 0.7);
        const iconX = Math.round(-iconSize / 2);
        const viewBoxHalf = MODE_ICON_VIEWBOX / 2;
        const iconGroup = createSvgGroup(parent, 'ert-inquiry-mode-icons', 0, iconOffsetY);

        const createIcon = (cls: string, paths: string[], rotateDeg = 0): SVGSVGElement => {
            const group = createSvgElement('svg');
            group.classList.add('ert-inquiry-mode-icon', 'ert-inquiry-mode-icon-btn', cls);
            group.setAttribute('x', String(iconX));
            group.setAttribute('y', '0');
            group.setAttribute('width', String(iconSize));
            group.setAttribute('height', String(iconSize));
            group.setAttribute('viewBox', `${-viewBoxHalf} ${-viewBoxHalf} ${MODE_ICON_VIEWBOX} ${MODE_ICON_VIEWBOX}`);
            group.setAttribute('preserveAspectRatio', 'xMidYMid meet');
            group.setAttribute('pointer-events', 'none');
            const transformGroup = createSvgElement('g');
            if (rotateDeg) {
                transformGroup.setAttribute('transform', `rotate(${rotateDeg})`);
            }
            const pathGroup = createSvgElement('g');
            pathGroup.setAttribute('transform', `translate(${-viewBoxHalf} ${-viewBoxHalf})`);
            paths.forEach(d => {
                const path = createSvgElement('path');
                path.setAttribute('d', d);
                pathGroup.appendChild(path);
            });
            transformGroup.appendChild(pathGroup);
            group.appendChild(transformGroup);
            iconGroup.appendChild(group);
            return group;
        };

        this.flowModeIconEl = createIcon('ert-inquiry-mode-icon--flow', FLOW_ICON_PATHS);
        this.depthModeIconEl = createIcon('ert-inquiry-mode-icon--depth', DEPTH_ICON_PATHS, 90);

        const hit = createSvgElement('rect');
        hit.classList.add('ert-inquiry-mode-icon-hit');
        const hitHeight = Math.round(iconSize * 0.4);
        const hitY = Math.round((iconSize - hitHeight) / 2);
        hit.setAttribute('x', String(iconX));
        hit.setAttribute('y', String(hitY));
        hit.setAttribute('width', String(iconSize));
        hit.setAttribute('height', String(hitHeight));
        hit.setAttribute('rx', String(Math.round(iconSize * 0.2)));
        hit.setAttribute('ry', String(Math.round(iconSize * 0.2)));
        hit.setAttribute('pointer-events', 'all');
        hit.setAttribute('tabindex', '0');
        hit.setAttribute('role', 'button');
        iconGroup.appendChild(hit);
        this.modeIconToggleHit = hit;
    }

    private buildSceneDossierLayer(parent: SVGElement, y: number): void {
        const refs = createInquirySceneDossierLayer(parent, y);
        this.sceneDossierGroup = refs.group;
        this.sceneDossierComposition = refs.composition;
        this.sceneDossierFocusCore = refs.focusCore;
        this.sceneDossierFocusGlow = refs.focusGlow;
        this.sceneDossierFocusOutline = refs.focusOutline;
        this.sceneDossierBg = refs.bg;
        this.sceneDossierBraceLeft = refs.braceLeft;
        this.sceneDossierBraceRight = refs.braceRight;
        this.sceneDossierTextGroup = refs.textGroup;
        this.sceneDossierCoreGroup = refs.coreGroup;
        this.sceneDossierHeader = refs.header;
        this.sceneDossierAnchor = refs.anchor;
        this.sceneDossierBody = refs.body;
        this.sceneDossierBodySecondary = refs.bodySecondary;
        this.sceneDossierBodyDivider = refs.bodyDivider;
        this.sceneDossierFooter = refs.footer;
        this.sceneDossierSource = refs.source;

        this.sceneDossier = new SceneDossierController(
            {
                onRender: (dossier, hoverKey) => this.renderSceneDossier(dossier, hoverKey),
                onClear: () => this.clearSceneDossierVisuals()
            },
            { hoverDelayMs: SCENE_DOSSIER_HOVER_DELAY_MS, hideDelayMs: SCENE_DOSSIER_HIDE_DELAY_MS }
        );
    }

    private renderWaveHeader(parent: SVGElement): void {
        const flowWidth = 2048;
        const flowOffsetY = 740;
        const targetWidth = VIEWBOX_SIZE * 0.5;
        const scale = targetWidth / flowWidth;
        const y = VIEWBOX_MIN + 50;
        const group = createSvgGroup(parent, 'ert-inquiry-wave-header');
        group.setAttribute('transform', `translate(0 ${y}) scale(${scale.toFixed(4)}) translate(${-flowWidth / 2} ${-flowOffsetY})`);
        group.setAttribute('pointer-events', 'none');

        // Path data is internal to the inquiry renderer.
        const paths = [
            'M1873.99,900.01c.23,1.74-2.27.94-3.48.99-14.3.59-28.74-.35-43.05-.04-2.37.05-4.55,1.03-6.92,1.08-124.15,2.86-248.6,8.35-373,4.92-91.61-2.53-181.2-15.53-273.08-17.92-101.98-2.65-204.05,7.25-305.95.95-83.2-5.14-164.18-24.05-247.02-31.98-121.64-11.65-245.9-13.5-368.04-15.96-2.37-.05-4.55-1.04-6.92-1.08-17.31-.34-34.77.75-52.05.04-1.22-.05-3.72.75-3.48-.99,26.49-.25,53.03.28,79.54.03,144.74-1.38,289.81-5.3,433.95,8.97,18.67,1.85,37.34,5.16,56.01,6.99,165.31,16.18,330.85-3.46,495.99,14.01,118.64,12.56,236.15,30.42,355.97,28.03,87.15,0,174.3,2.45,261.54,1.97Z',
            'M1858.99,840.01c.23,1.74-2.27.94-3.48.99-15.63.64-31.41-.36-47.05-.04-2.37.05-4.55,1.03-6.92,1.08-127.12,2.74-254.28,9.03-381.05,2.97-86.31-4.13-170.32-17.4-256.98-20.02-110.96-3.36-222.13,6.92-333-1-62.18-4.44-123.32-15.98-185.14-22.86-130.81-14.57-267.28-16.86-398.92-19.08-2.36-.04-4.55-1.04-6.92-1.08-20.56-.33-41.57.88-62.05.04-1.22-.05-3.72.75-3.48-.99,27.83-.25,55.7.28,83.54.03,110.53-1,221.67-2.9,331.92,2,82.52,3.67,164.67,14.08,247,17,120.4,4.27,240.84-7.91,361.03,1.97,68.04,5.59,135.16,18.98,203.02,25.98,102.05,10.53,205.5,10.76,307.95,12.05,50.17.63,100.37.51,150.54.97Z',
            'M1842.99,961.01c.23,1.74-2.27.94-3.48.99-25.56,1.05-51.45.11-77.05.96l-79.92,3.08c-11.35.14-22.73-.31-34.08-.08-75.38,1.5-150.52,3.23-225.92,0-70.84-3.04-141.24-10.76-212.08-12.92-110.8-3.38-221.44,7.94-331.95.95-87.75-5.56-170.98-27.28-258.02-35.98-121.12-12.11-248.16-13.39-370.03-15.97-2.37-.05-4.55-1.03-6.92-1.08-16.64-.35-33.43.72-50.05.04-1.22-.05-3.72.75-3.48-.99,21.16-.25,42.37.28,63.54.03,120.89-1.45,244.31-4.94,364.95,1.97,92.31,5.29,182.02,23.64,274.97,26.03,97.61,2.52,194.76-4.98,292.08-1.08,102.89,4.12,204.72,22.93,307.92,28.08,108.68,5.42,217.3,1.72,326.08,4.92,7.47.22,15.65,1.96,23.45,1.05Z',
            'M1892.99,1020.01c.23,1.74-2.27.94-3.48.99-16.61.68-33.41-.29-50.05-.04-2.36.04-4.55,1.04-6.92,1.08-127.73,2.28-255.33,8.29-383,4.92-71.58-1.89-142.68-9.43-214.03-11.97-125.84-4.47-251.12,11.24-377,0-78-6.96-152.8-27.94-231.01-35.99-132.21-13.59-267.3-12.99-400.03-16.97l-19.45-2.03c31.83-.25,63.7.28,95.54.03,135.4-1.07,273.36-5.92,407.82,11.1,42.78,5.42,85.05,13.34,128.15,16.85,139.4,11.34,279.58-5.96,418.98,5.02,46.43,3.66,92.62,10.85,139.01,14.99,108.66,9.68,220.94,10.96,329.95,12.05,55.16.55,110.38-.5,165.54-.03Z',
            'M1846.99,1081.01c.23,1.74-2.27.94-3.48.99-16.29.67-32.74-.35-49.05-.04-126.07,2.42-250.52,8.4-376.97,3.05-54.11-2.29-108-7.25-162.03-8.97-147.59-4.7-291.2,17.69-438.82-4.18-44.08-6.53-87.24-17.93-131.31-24.69-118.91-18.24-240.1-17.95-359.79-24.21l-138.05-1.96-3.48-.99c45.84-.3,91.68-.55,137.54-.97,118.46-1.08,241.16-3.52,358.95,8.96,49.25,5.22,97.78,15.79,147.01,20.99,134.9,14.23,269.26-2.37,404,4,115.35,5.45,230.26,23.7,345.95,24.05l269.54,3.97Z',
            'M1886.99,1140.01c.23,1.74-2.27.94-3.48.99-18.28.75-36.75-.35-55.05-.04-2.36.04-4.55,1.04-6.92,1.08-124.58,2.26-249.4,6.27-374,2.92-79.23-2.13-157.79-10.68-237-9.92-111.01,1.07-222.29,15.23-333.04,4.95-80.02-7.42-157.13-29.72-237.13-38.87-109.52-12.53-220.11-13.58-329.83-18.17-30.26-1.04-60.82.28-91.05-.96-1.22-.05-3.72.75-3.48-.99,33.41-1.66,66.99-.63,100.54-.97,132.12-1.34,266.81-5.51,397.79,13.13,35.16,5,70.02,12.4,105.29,16.71,163.13,19.92,325.43-6.76,489.87,7.13,25.01,2.11,50.01,5.78,75.01,7.99,124.74,11,249.78,13.86,374.95,15.05,42.5.4,85.05-.39,127.54-.03Z',
            'M1827.99,1201.01c.23,1.74-2.27.94-3.48.99-14.29.59-28.74-.28-43.05-.04-115.65,1.92-231.19,6.1-346.92,2-86.12-3.05-168.46-11.59-255-8.92-104.04,3.22-205.73,15.8-310.04,4.95-74.39-7.74-146.25-28.95-221.13-37.87-128.28-15.28-263.63-17.56-392.83-20.17-16.64-.34-33.43.72-50.05.04-1.22-.05-3.72.75-3.48-.99,32.01-2.07,64.38-.68,96.54-.97,143.23-1.26,287.89-5.92,429.79,15.13,72.64,10.78,132.72,21.01,207.21,22.79,120.32,2.88,237.35-12.3,357.95-2.95,126.6,9.81,252.83,24.46,379.97,24.03l154.54,1.97Z',
            'M1866.99,1260.01c.23,1.74-2.27.94-3.48.99-14.95.61-30.07-.28-45.05-.04-2.36.04-4.55,1.04-6.92,1.08-130.78,2.42-262.55,7.17-393.05.97-74.88-3.56-146.78-13.43-221.95-10.97-102.42,3.35-199.73,18.19-303.03,9.95-86.01-6.86-168.89-32.27-255.13-41.87-122.3-13.61-249.91-14.58-372.92-17.08-2.37-.05-4.55-1.04-6.92-1.08-14.31-.24-28.76.63-43.05.04-1.22-.05-3.72.75-3.48-.99,15.16-.25,30.37.28,45.54.03,2.62-.04,5.06-1.05,7.91-1.09,130.55-1.8,270.66-5.74,400.04,7.06,71.51,7.08,141.22,24.72,213.02,29.98,60.88,4.46,121.1,1.83,181.95-1.03,82.54-3.88,157.04-9.61,240.04-1.95,42.37,3.91,84.57,10.5,127.01,13.99,95.85,7.88,192.07,8.57,287.95,12.05l151.54-.03Z',
            'M1844.99,780.01c.23,1.74-2.27.94-3.48.99-13.96.57-28.07-.3-42.05-.04-141.3,2.57-283.58,13.37-424.95,1.04-43.21-3.77-85.9-11.58-129.01-15.99-177.25-18.1-353.26,10.99-529.98-14.02l-187.5-24.98c22.83,1.11,45.69,1.89,68.54,2.95,110.04,5.09,214.45,8.65,324.92,6,86.75-2.08,173.41-7.14,260.03.05,62.88,5.22,124.66,18.79,187.15,26.85,142.22,18.35,285.65,13.88,428.91,16.09,2.85.04,5.29,1.04,7.91,1.09,13.16.25,26.38-.28,39.54-.03Z',
            'M1432.99,1309.01c.23,1.74-2.27.94-3.48.99-5.14.21-10.9.2-16.05.04-95.06-2.94-189.84-5.29-284.95,1.97-64.76,4.95-127.67,14.31-193.05,12.03-95.43-3.32-186.63-31.93-281.08-42.92-123.44-14.36-254.58-17.15-378.83-19.17-15.64-.25-31.43.68-47.05.04-1.22-.05-3.72.75-3.48-.99,8.82-.24,17.71.28,26.54.03,2.37-.07,4.55-1.03,6.92-1.08,128.74-2.8,269.19-5.78,397.03,5.05,70.2,5.95,137.58,23.09,207.02,29.98,53.73,5.33,106.29,4.52,160,2.02,82.26-3.83,161.4-14.61,243.99-7.01,55.59,5.12,110.68,16.34,166.5,19.01Z'
        ];

        paths.forEach(d => {
            const path = createSvgElement('path');
            path.classList.add('ert-inquiry-wave-path');
            path.setAttribute('d', d);
            group.appendChild(path);
        });
    }


    private buildFindingsPanel(findingsGroup: SVGGElement, width: number, height: number): void {
        const bg = createSvgElement('rect');
        bg.classList.add('ert-inquiry-panel-bg');
        bg.setAttribute('width', String(width));
        bg.setAttribute('height', String(height));
        bg.setAttribute('rx', '22');
        bg.setAttribute('ry', '22');
        findingsGroup.appendChild(bg);

        this.findingsTitleEl = createSvgText(findingsGroup, 'ert-inquiry-findings-title', t('inquiry.findings.findings'), 24, 36);
        this.detailsToggle = this.createIconButton(findingsGroup, width - 88, 14, 32, 'chevron-down', t('inquiry.details.toggle'), 'ert-inquiry-details-toggle');
        this.detailsIcon = this.detailsToggle.querySelector('.ert-inquiry-icon') as SVGUseElement;
        bindInquiryDetailsToggleEvent({
            registerSvgEvent: this.registerSvgEvent.bind(this),
            detailsToggle: this.detailsToggle,
            onClick: () => this.toggleDetails()
        });

        this.detailsEl = createSvgGroup(findingsGroup, 'ert-inquiry-details ert-hidden', 24, 64);
        this.detailRows = [
            createSvgText(this.detailsEl, 'ert-inquiry-detail-row', t('inquiry.findings.corpusFingerprintNotAvailable'), 0, 0),
            createSvgText(this.detailsEl, 'ert-inquiry-detail-row', t('inquiry.findings.recentSessionsNotAvailable'), 0, 20)
        ];

        this.summaryEl = createSvgText(findingsGroup, 'ert-inquiry-summary', t('inquiry.findings.noInquiryRun'), 24, 120);
        this.verdictEl = createSvgText(findingsGroup, 'ert-inquiry-verdict', t('inquiry.findings.runToSeeVerdicts'), 24, 144);

        this.findingsListEl = createSvgGroup(findingsGroup, 'ert-inquiry-findings-list', 24, 176);

        const previewY = height - 210;
        this.artifactPreviewEl = createSvgGroup(findingsGroup, 'ert-inquiry-report-preview ert-hidden', 24, previewY);
        this.artifactPreviewBg = createSvgElement('rect');
        this.artifactPreviewBg.classList.add('ert-inquiry-report-preview-bg');
        this.artifactPreviewBg.setAttribute('width', String(width - 48));
        this.artifactPreviewBg.setAttribute('height', '180');
        this.artifactPreviewBg.setAttribute('rx', '14');
        this.artifactPreviewBg.setAttribute('ry', '14');
        this.artifactPreviewEl.appendChild(this.artifactPreviewBg);
    }

    private getResolvedEngine(): ResolvedInquiryEngine {
        if (!this._resolvedEngine) {
            // resolveInquiryEngine never throws — it returns a blocked DTO
            // with honest zeros when the provider lacks required capabilities.
            this._resolvedEngine = resolveInquiryEngine(this.plugin, BUILTIN_MODELS);
        }
        return this._resolvedEngine;
    }

    private getProviderCacheTtlLabel(provider: string): string {
        if (provider !== 'anthropic' && provider !== 'openai' && provider !== 'google') return '';
        const aiSettings = this.getCanonicalAiSettings();
        return formatProviderCacheTtlLabel(provider, aiSettings);
    }

    /**
     * Build a snapshot of the most recent successful run for the engine
     * popover pills (cache reuse %, citations confirmed/missing). Returns
     * undefined when there is no successful prior run, so the renderer can
     * show a "pending" state cleanly.
     *
     * Citation count uses the unified Sources ViewModel rather than raw
     * `result.citations` because Anthropic's tool_use path (used whenever
     * we send a strict JSON schema) returns no text content blocks for
     * inline citation annotations to attach to. The findings still carry
     * scene-anchored ref_ids, and the user has working source attribution.
     * Counting only inline blocks would falsely flag every strict-JSON
     * Anthropic run as "Citations missing".
     */
    private buildEngineRecentRunSnapshot(): EngineRecentRunSnapshot | undefined {
        const result = this.state.activeResult;
        // The session store carries `providerCacheStatus` from the run
        // trace — that's the cache-manager-derived create/hit signal,
        // not a payload heuristic. The pill needs it (esp. for Gemini)
        // to label create vs reuse honestly.
        const persistedCacheSession = this.getLatestCacheSessionForResolvedEngine();
        const cacheStatus = persistedCacheSession?.providerCacheStatus;
        if (result && !this.isErrorResult(result)) {
            return buildEngineRecentRunSnapshotPure(
                result,
                this.areInquiryProviderCitationsEnabled(),
                cacheStatus
            );
        }
        if (!persistedCacheSession || this.isErrorResult(persistedCacheSession.result)) return undefined;
        return buildEngineRecentRunSnapshotPure(
            persistedCacheSession.result,
            this.areInquiryProviderCitationsEnabled(),
            cacheStatus
        );
    }

    private getActualUsageCostForResult(
        result: InquiryResult,
        cacheProvenance?: 'hit' | 'created'
    ): number | undefined {
        return resolveActualUsageCostForResultPure(result, cacheProvenance);
    }

    private getLatestSameCorpusActualCostForResolvedEngine(): number | null {
        const engine = this.getResolvedEngine();
        if (engine.blocked || !engine.modelId || engine.provider === 'none' || engine.provider === 'ollama') {
            return null;
        }
        const currentContext = this.getCurrentCorpusContext();
        const currentReuseFingerprint = currentContext.cacheReuseFingerprint.trim();
        if (!currentReuseFingerprint) return null;
        const normalizedProvider = engine.provider.trim().toLowerCase();
        const normalizedModelId = engine.modelId.trim();
        const currentScopeKey = this.getScopeKey();
        const sessions = this.sessionStore.getRecentSessions(this.sessionStore.getSessionCount());
        for (const session of sessions) {
            const sessionScope = session.scope ?? session.result.scope;
            if (sessionScope !== this.state.scope) continue;
            if (this.state.scope === 'book' && this.getSessionScopeKey(session) !== currentScopeKey) continue;
            if (this.isErrorResult(session.result)) continue;
            const sessionProvider = (session.result.aiProvider ?? '').trim().toLowerCase(); // SAFE: absent provider normalizes to empty and fails the match below
            if (sessionProvider !== normalizedProvider) continue;
            const resolvedModel = (session.result.aiModelResolved || '').trim(); // SAFE: absent model normalizes to empty and fails the match below
            const requestedModel = (session.result.aiModelRequested || '').trim(); // SAFE: absent model normalizes to empty and fails the match below
            if (resolvedModel !== normalizedModelId && requestedModel !== normalizedModelId) continue;
            const sessionReuseFingerprint = (session.cacheReuseFingerprint || session.result.cacheReuseFingerprint || '').trim(); // SAFE: absent fingerprint normalizes to empty and fails the reuse match below
            if (sessionReuseFingerprint !== currentReuseFingerprint) continue;
            const actualCost = this.getActualUsageCostForResult(session.result, session.providerCacheStatus);
            if (typeof actualCost === 'number' && Number.isFinite(actualCost) && actualCost >= 0) {
                return actualCost;
            }
        }
        return null;
    }

    /**
     * Find the latest still-warm provider cache window for the current
     * engine + corpus. Drives the "Cache: Xm left" countdown pill in the
     * engine popover. Returns undefined when no active window exists, so
     * the renderer skips the pill cleanly.
     *
     * Re-evaluated on every engine panel refresh — no live timer is
     * scheduled, so the displayed minutes lag refresh cadence. Adequate
     * for a coarse "fresh / soon / expiring" indicator; a per-second
     * countdown would imply more precision than we have anyway.
     */
    private buildEngineCacheWindowSnapshot(): EngineCacheWindowSnapshot | undefined {
        const engine = this.getResolvedEngine();
        if (!engine.modelId || engine.provider === 'none' || engine.provider === 'ollama') return undefined;
        const session = this.sessionStore.getLatestActiveCacheSessionForEngine(
            engine.provider,
            engine.modelId,
            {
                cacheReuseFingerprint: this.getCurrentCacheReuseFingerprint() ?? undefined,
                scope: this.state.scope
            }
        );
        return buildEngineCacheWindowSnapshotFromSessionPure(session, Date.now());
    }

    /** Called externally (e.g. from Settings) when AI strategy changes. */
    onAiSettingsChanged(): void {
        this._resolvedEngine = null;
        this._currentCorpusContext = null;
        // Adding/removing a provider key flips the no-api-key read-only state, so
        // recompute guidance here — otherwise the calm read-only screen would
        // persist until the view is reopened.
        this.guidanceState = this.resolveGuidanceState();
        this.updateGuidance();
        this.updateEngineBadge();
        this.refreshEnginePanel();
        this.updateMinimapPressureGauge();
        // The estimate snapshot may be stale: provider, model, citations, or
        // tier could have changed. The service keys on these dimensions, so
        // requesting again will hit cache when nothing material changed and
        // rebuild when it did.
        void this.requestEstimateSnapshot();
    }

    /** Called externally when Inquiry prompt settings change. */
    onPromptSettingsChanged(): void {
        this.refreshUI({ skipCorpus: true, reason: 'prompt settings changed' });
    }

    /** Called externally when Book Manager settings or order change. */
    onBookSettingsChanged(): void {
        this.refreshUI({ reason: 'book settings changed' });
    }

    /** Called externally when material source/class settings change. Debounced to avoid flicker. */
    onSourcesSettingsChanged(): void {
        if (this.sourcesRefreshTimer !== undefined) {
            window.clearTimeout(this.sourcesRefreshTimer);
        }
        this.sourcesRefreshTimer = window.setTimeout(() => {
            this.sourcesRefreshTimer = undefined;
            this.refreshUI({ reason: 'sources settings changed' });
        }, 250);
    }

    private refreshUI(options?: { skipCorpus?: boolean, reason?: string }): void {
        this.perfCounters.refreshUICalls++;
        this.invalidateRefreshCycleCaches();
        this.refreshDataDependencies(options?.skipCorpus);
        this.refreshDerivedViewState();
        this.refreshVisualChrome();
    }

    private invalidateRefreshCycleCaches(): void {
        this._resolvedEngine = null;
        this._currentCorpusContext = null;
    }

    private refreshDataDependencies(skipCorpus = false): void {
        if (skipCorpus) return;
        this.perfCounters.refreshCorpusCalls++;
        const start = performance.now();
        this.refreshCorpus();
        this.perfCounters.corpusRefreshMs += (performance.now() - start);
    }

    private refreshDerivedViewState(): void {
        this.guidanceState = this.resolveGuidanceState();
        this.renderMinimapTicks();
        this.updateRings();
        this.updateFindingsIndicators();
        this.updateZonePrompts();
        this.updateScopeGlyph();
        void this.requestEstimateSnapshot();
    }

    private refreshVisualChrome(): void {
        this.refreshPrimaryChrome();
        this.refreshSessionChrome();
        this.refreshPanelChrome();
        this.updateViewTitle();
    }

    private refreshPrimaryChrome(): void {
        this.updateScopeToggle();
        this.updateModeToggle();
        this.updateModeClass();
        this.updateActiveZoneStyling();
        this.updateEngineBadge();
        this.updateGlyphPromptState();
    }

    private refreshSessionChrome(): void {
        this.updateFooterStatus();
        this.updateNavigationIcons();
        this.updateNavSessionLabel();
        this.updateRunningState();
    }

    private refreshPanelChrome(): void {
        this.updateBriefingButtonState();
        this.refreshBriefingPanel();
        this.updateFindingsPanel();
        this.updateGuidance();
    }

    private refreshCorpus(): void {
        this.briefingPurgeScanner.invalidate();
        // Controller resolves the snapshot, writes through to `this.corpus`,
        // and returns it. The local binding lets the reconcile chain below
        // read the just-resolved snapshot without re-asserting non-null on
        // every access. Behavior identical to the inline form: the view's
        // `this.corpus` field is updated synchronously by refresh().
        const snapshot = this.corpusSnapshot.refresh({
            scope: this.state.scope,
            activeBookId: this.state.activeBookId,
            sources: this.normalizeInquirySources(this.settingsAccessor.getSources()),
            bookProfiles: this.plugin.settings.books,
        });

        let shouldPersist = false;
        if (snapshot.activeBookId) {
            if (this.state.activeBookId !== snapshot.activeBookId) {
                this.selection.setActiveBookId(snapshot.activeBookId);
                shouldPersist = true;
            }
        } else {
            if (this.state.activeBookId) {
                this.selection.setActiveBookId(undefined);
                shouldPersist = true;
            }
        }

        if (this.state.scope === 'book') {
            const nextTargetSceneIds = this.resolveTargetSceneIds(snapshot.activeBookId, snapshot.scenes);
            if (!this.areTargetSceneIdsEqual(this.state.targetSceneIds, nextTargetSceneIds)) {
                this.selection.setTargetSceneIds(nextTargetSceneIds);
                shouldPersist = true;
            }
            if (snapshot.activeBookId) {
                const shouldSyncTargetCache = !this.startupFreshMode || this.freshModeTouchedBookIds.has(snapshot.activeBookId);
                if (shouldSyncTargetCache) {
                    const prior = this.selection.getRememberedTargetSceneIdsForBook(snapshot.activeBookId) ?? []; // SAFE: no remembered target selection for this book — compare against empty
                    if (!this.areTargetSceneIdsEqual(prior, nextTargetSceneIds)) {
                        this.selection.rememberTargetSceneIdsForBook(snapshot.activeBookId, nextTargetSceneIds);
                        shouldPersist = true;
                    }
                }
            }
        }

        this.refreshPayloadStats();

        if (shouldPersist) {
            this.scheduleTargetPersist();
        }
    }

    private updateModeClass(): void {
        if (!this.rootSvg) return;
        this.rootSvg.classList.toggle('is-mode-flow', this.state.mode === 'flow');
        this.rootSvg.classList.toggle('is-mode-depth', this.state.mode === 'depth');
    }

    private setModeIconHoverState(active: boolean): void {
        if (!this.rootSvg) return;
        const canHover = !this.isInquiryGuidanceLockout() && !this.state.isRunning;
        this.rootSvg.classList.toggle('is-mode-icon-hover', active && canHover);
    }

    private getZoneColorVar(zone: InquiryZone): string {
        if (zone === 'pressure') return 'var(--ert-inquiry-zone-pressure)';
        if (zone === 'payoff') return 'var(--ert-inquiry-zone-payoff)';
        return 'var(--ert-inquiry-zone-setup)';
    }

    private updateActiveZoneStyling(): void {
        if (!this.rootSvg) return;
        const zone = this.state.activeZone ?? 'setup'; // SAFE: no active zone on first render — setup is the default zone
        const zoneColor = this.getZoneColorVar(zone);
        this.rootSvg.style.setProperty('--ert-inquiry-active-zone-color', zoneColor);
        this.rootSvg.style.setProperty('--ert-inquiry-finding-color', zoneColor);
    }

    private updateScopeToggle(): void {
        this.updateToggleButton(this.scopeToggleButton, this.state.scope === 'saga');
        if (this.scopeToggleIcon) {
            const icon = this.state.scope === 'saga' ? 'sigma' : 'columns-2';
            if (this.scopeToggleIcon.instanceOf(SVGUseElement)) {
                this.setIconUse(this.scopeToggleIcon, icon);
            }
        }
    }

    private updateModeToggle(): void {
        this.updateToggleButton(this.modeToggleButton, this.state.mode === 'depth');
        if (this.modeToggleIcon) {
            const icon = this.state.mode === 'depth' ? 'waves-arrow-down' : 'waves';
            this.setIconUse(this.modeToggleIcon, icon);
        }
    }

    private updateToggleButton(button: SVGElement | undefined, isActive: boolean): void {
        if (!button) return;
        button.classList.toggle('is-active', isActive);
        button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    }

    private setIconButtonDisabled(button: SVGGElement | undefined, disabled: boolean): void {
        if (!button) return;
        button.classList.toggle('is-disabled', disabled);
        button.setAttribute('aria-disabled', disabled ? 'true' : 'false');
        button.setAttribute('tabindex', disabled ? '-1' : '0');
    }

    private updateEngineBadge(): void {
        if (!this.engineBadgeGroup) return;
        const engine = this.getResolvedEngine();
        const modelLabel = engine.modelLabel;
        const providerLabel = engine.providerLabel;
        if (this.enginePanelMetaEl) {
            const payloadSummary = this.buildEnginePayloadSummary();
            this.enginePanelMetaEl.setText(`Active: ${providerLabel} · ${modelLabel} · ${payloadSummary.text}`);
        }
        this.syncEngineBadgePulse();
        this.refreshEnginePanel();
    }

    private syncEngineBadgePulse(): void {
        if (!this.engineBadgeGroup) return;
        const readinessUi = this.buildReadinessUiState();
        // While the estimate is still loading, stay neutral — don't flash red for unknown state.
        if (readinessUi.pending) {
            this.engineBadgeGroup.classList.remove('is-engine-pulse-amber', 'is-engine-pulse-red');
            return;
        }
        const hasError = this.isErrorState();
        // A missing key is a calm capability limit, not an error — don't pulse red
        // for it (Demo Mode / keyless vaults stay calm).
        const red = (hasError || readinessUi.readiness.state === 'blocked')
            && !this.isInquiryApiKeyMissing();
        this.engineBadgeGroup.classList.remove('is-engine-pulse-amber');
        this.engineBadgeGroup.classList.toggle('is-engine-pulse-red', red);
    }

    /**
     * Resolve the engine selection for a run submission.
     * Delegates to the shared canonical resolver — no legacy settings read.
     */
    private resolveEngineSelectionForRun(): {
        provider: AIProviderId;
        modelId: string;
        modelLabel: string;
    } {
        const engine = this.getResolvedEngine();
        return {
            provider: engine.provider,
            modelId: engine.modelId,
            modelLabel: engine.modelLabel
        };
    }

    private getClassScopeConfig(raw?: string[]): { allowAll: boolean; allowed: Set<string> } {
        return getClassScopeConfigPure(raw);
    }

    private getCurrentItems(): InquiryCorpusItem[] {
        if (!this.corpus) return [];
        return this.state.scope === 'saga' ? this.corpus.books : this.corpus.scenes;
    }

    private getMinimapItemFilePath(item: InquiryCorpusItem): string | undefined {
        return getMinimapItemFilePathPure(item);
    }

    private getMinimapItemTitle(item: InquiryCorpusItem): string {
        const filePath = this.getMinimapItemFilePath(item);
        if (filePath) {
            const file = this.app.vault.getAbstractFileByPath(filePath);
            if (file && this.isTFile(file)) {
                return this.getDocumentTitle(file);
            }
            const segments = filePath.split('/').filter(Boolean);
            return segments[segments.length - 1] || filePath;
        }
        return item.displayLabel;
    }

    private getMinimapItemTitleWithWordCount(item: InquiryCorpusItem): string {
        const title = this.getMinimapItemTitle(item);
        const words = this.getMinimapItemWordCount(item);
        return words !== null ? `${title} · ${words.toLocaleString()}w` : title;
    }

    private getMinimapItemWordCount(item: InquiryCorpusItem): number | null {
        const filePath = this.getMinimapItemFilePath(item);
        if (!filePath) return null;
        const file = this.app.vault.getAbstractFileByPath(filePath);
        if (!file || !this.isTFile(file)) return null;
        const fm = this.getNormalizedFrontmatter(file);
        if (!fm) return null;
        const raw = fm['Words'] ?? fm['words'];
        if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
        if (typeof raw === 'string') {
            const parsed = parseFloat(raw.replace(/,/g, '').trim());
            if (Number.isFinite(parsed)) return parsed;
        }
        return null;
    }

    private normalizeTargetSceneIds(value: unknown): string[] {
        const raw = Array.isArray(value)
            ? value
            : (typeof value === 'string' && value.trim().length > 0 ? [value] : []);
        return Array.from(new Set(raw.map(entry => String(entry).trim()).filter(Boolean)));
    }

    private resolveTargetSceneIds(bookId: string | undefined, scenes: InquiryCorpusItem[]): string[] {
        if (!bookId || !scenes.length) return [];
        const candidateIds = [
            ...this.getVisibleTargetSceneIdsForBook(bookId),
            ...this.state.targetSceneIds
        ];
        const next = candidateIds.filter(candidate => (
            scenes.some(scene => this.matchesSceneSelectionId(scene, candidate))
        ));
        return Array.from(new Set(next));
    }

    private areTargetSceneIdsEqual(left: string[], right: string[]): boolean {
        if (left.length !== right.length) return false;
        return left.every((value, index) => value === right[index]);
    }

    private matchesSceneSelectionId(item: InquiryCorpusItem, selectionId: string): boolean {
        const target = selectionId.toLowerCase();
        if (item.id.toLowerCase() === target) return true;
        if (typeof item.sceneId === 'string' && item.sceneId.toLowerCase() === target) return true;
        if (item.filePaths?.some(path => path.toLowerCase() === target)) return true;
        const scenePath = (item as { filePath?: string }).filePath;
        if (scenePath && scenePath.toLowerCase() === target) return true;
        return false;
    }

    private async isFocusableTargetSceneItem(item: InquiryCorpusItem): Promise<boolean> {
        if (this.state.scope !== 'book' || !item.sceneId) return false;
        const scenePath = (item as { filePath?: string }).filePath;
        if (!scenePath) return false;
        const stats = await this.loadCorpusCcStatsByPath(scenePath);
        return stats.bodyWords > this.getCorpusThresholds().emptyMax;
    }

    private removeEmptyTargetSceneItems(emptySceneItems: InquiryCorpusItem[]): boolean {
        if (this.state.scope !== 'book' || !emptySceneItems.length || !this.state.targetSceneIds.length) return false;
        const next = this.state.targetSceneIds.filter(sceneId => (
            !emptySceneItems.some(item => this.matchesSceneSelectionId(item, sceneId))
        ));
        if (this.areTargetSceneIdsEqual(this.state.targetSceneIds, next)) return false;

        this.selection.setTargetSceneIds(next);
        const activeBookId = this.corpus?.activeBookId ?? this.state.activeBookId;
        if (activeBookId) {
            this.freshModeTouchedBookIds.add(activeBookId);
            this.selection.rememberTargetSceneIdsForBook(activeBookId, next);
        }
        this.scheduleTargetPersist();
        return true;
    }

    private isSceneFile(file: TFile): boolean {
        const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
        if (!frontmatter) return false;
        const normalized = normalizeFrontmatterKeys(frontmatter, getActiveFrontmatterMappings(this.plugin.settings));
        const classValues = this.extractClassValues(normalized);
        return classValues.includes('scene');
    }

    private async refreshMinimapEmptyStates(items: InquiryCorpusItem[]): Promise<void> {
        const updateId = this.minimap.nextEmptyUpdateId();
        if (!items.length) return;
        const thresholds = this.getCorpusThresholds();
        const emptyMax = thresholds.emptyMax;
        const markdownFiles = this.app.vault.getMarkdownFiles();
        const sceneFiles = markdownFiles.filter(file => this.isSceneFile(file));
        const scenePathsByRoot = new Map<string, string[]>();

        const getScenePathsForBook = (rootPath: string): string[] => {
            const cached = scenePathsByRoot.get(rootPath);
            if (cached) return cached;
            const prefix = `${rootPath}/`;
            const paths = sceneFiles
                .filter(file => file.path === rootPath || file.path.startsWith(prefix))
                .map(file => file.path);
            scenePathsByRoot.set(rootPath, paths);
            return paths;
        };

        const wordCounts = await Promise.all(items.map(async item => {
            const scenePath = (item as { filePath?: string }).filePath;
            if (scenePath) {
                const stats = await this.loadCorpusCcStatsByPath(scenePath);
                return stats.bodyWords;
            }

            const rootPath = (item as { rootPath?: string }).rootPath;
            if (rootPath) {
                const rootFile = this.app.vault.getAbstractFileByPath(rootPath);
                if (rootFile && this.isTFile(rootFile)) {
                    const stats = await this.loadCorpusCcStatsByPath(rootPath);
                    return stats.bodyWords;
                }
                const scenePaths = getScenePathsForBook(rootPath);
                if (!scenePaths.length) return 0;
                const stats = await Promise.all(scenePaths.map(path => this.loadCorpusCcStatsByPath(path)));
                return stats.reduce((sum, stat) => sum + stat.bodyWords, 0);
            }

            const fallbackPaths = item.filePaths ?? []; // SAFE: items without filePaths contribute 0 words
            if (!fallbackPaths.length) return 0;
            const stats = await Promise.all(fallbackPaths.map(path => this.loadCorpusCcStatsByPath(path)));
            return stats.reduce((sum, stat) => sum + stat.bodyWords, 0);
        }));

        if (!this.minimap.isCurrentEmptyUpdate(updateId)) return;

        const emptySceneItems = items.filter((item, index) => (
            !!item.sceneId
            && typeof (item as { filePath?: string }).filePath === 'string'
            && wordCounts[index] <= emptyMax
        ));
        const prunedEmptyTargets = this.removeEmptyTargetSceneItems(emptySceneItems);
        this.minimap.applyEmptyStates(wordCounts, emptyMax);
        this.updateMinimapTargetStates(this.state.activeResult);
        if (prunedEmptyTargets) {
            this.refreshUI();
        }
    }

    private renderMinimapTicks(): void {
        const items = this.getCurrentItems();
        const result = this.minimap.renderTicks(items, this.state.scope, VIEWBOX_SIZE, this.buildMinimapRenderCallbacks());
        this.applyMinimapRenderOutcome(items, result);
    }

    private buildMinimapRenderCallbacks(): Parameters<InquiryMinimapRenderer['renderTicks']>[3] {
        return {
            getItemTitle: (item) => this.getMinimapItemTitleWithWordCount(item),
            balanceTooltipText,
            registerDomEvent: (el, event, handler) => this.registerDomEvent(el, event, handler),
            onTickClick: (item, event) => { void (async () => {
                this.clearResultPreview();
                this.clearErrorStateForAction();
                if (this.state.isRunning) {
                    this.notifyInteraction(t('inquiry.interaction.running'));
                    return;
                }
                if (this.state.scope === 'book') {
                    if (event.shiftKey) {
                        if (item.sceneId) {
                            const canFocus = await this.isFocusableTargetSceneItem(item);
                            if (!canFocus) {
                                this.notifyInteraction(t('inquiry.interaction.emptyScenesCannotTarget'));
                                return;
                            }
                            this.toggleTargetScene(item.sceneId, { announce: true });
                        } else {
                            this.notifyInteraction(t('inquiry.interaction.onlySceneTicksTargetable'));
                        }
                        return;
                    }
                    if (this.doesMinimapItemHaveFinding(item)) {
                        if (event.altKey) {
                            this.openActiveBriefArticleForItem(item);
                            return;
                        }
                        void this.openActiveBriefForItem(item);
                    } else {
                        const filePath = this.getMinimapItemFilePath(item);
                        if (filePath) {
                            void this.openSceneFromMinimap(filePath);
                        }
                    }
                    return;
                }
                this.drillIntoBook(item.id);
            })(); },
            onTickContextMenu: (item, event) => {
                this.handleMinimapTickContextMenu(item, event);
            },
            onTickHover: (item, label, fullLabel) => {
                if (this.state.isRunning) return;
                this.handleMinimapHover(item, label, fullLabel);
            },
            onTickLeave: () => {
                this.clearHoverText();
                const hadPreview = this.minimapResultPreviewActive;
                this.hideSceneDossier();
                if (!hadPreview || this.previewLocked) return;
                this.hidePromptPreview(true);
            }
        };
    }

    private applyMinimapRenderOutcome(
        items: InquiryCorpusItem[],
        result: ReturnType<InquiryMinimapRenderer['renderTicks']>
    ): void {
        if (!result) {
            this.refreshMinimapAfterEmptyRender();
            return;
        }

        this.updatePreviewPanelPosition();
        this.minimap.buildSweepLayer(result.tickLayouts, result.tickWidth, this.minimap.layoutLength ?? 0); // SAFE: layout not measured yet — sweep layer built with zero length
        void this.refreshMinimapEmptyStates(items);
        this.renderCorpusCcStrip();
        this.applyMinimapSubsetShading(items);
        this.updateMinimapTargetStates(this.state.activeResult);
        this.updateMinimapPressureGauge();
    }

    private refreshMinimapAfterEmptyRender(): void {
        this.renderCorpusCcStrip();
        this.updateMinimapTargetStates(this.state.activeResult);
        this.updateMinimapPressureGauge();
        this.updatePreviewPanelPosition();
    }

    private updatePreviewPanelPosition(): void {
        if (!this.previewGroup || !this.minimap.hasGroup) return;
        const targetY = this.minimap.getPreviewPanelTargetY();
        if (!Number.isFinite(targetY)) return;
        this.previewGroup.setAttribute('transform', `translate(0 ${targetY})`);
        this.updateResultsFooterPosition(targetY);
    }

    private applyMinimapSubsetShading(items: InquiryCorpusItem[]): void {
        const manifest = this.buildCorpusManifest('minimap-subset', {
            questionZone: this.state.activeZone ?? undefined,
            applyOverrides: true
        });
        this.minimap.applySubsetShading(items, this.state.scope, manifest);
    }

    private updateMinimapPressureGauge(): void {
        const readinessUi = this.buildReadinessUiState();
        // While the estimate is pending, reset the gauge — never show stale data.
        // Force reuse state to idle so endcaps aren't painted green from a persisted
        // cache session whose fingerprint hasn't yet been validated against the
        // freshly-loaded corpus. The post-settle update will paint the real state.
        // Pending OR no key → reset to a neutral gauge. Without a key there's no
        // real estimate to show, and a missing key is calm, not an alert.
        if (readinessUi.pending || this.isInquiryApiKeyMissing()) {
            this.minimap.resetPressureGauge();
            this.minimap.updateReuseStatus(null);
            return;
        }
        const basePassPlan = this.getCurrentPassPlan(readinessUi);
        const passPlan = this.getDisplayedPassPlan(basePassPlan);
        const styleSource = this.getStyleSource();
        const isPro = hasProFeatureAccess(this.plugin);
        const advancedContext = this.getEffectiveReuseAdvancedContext();
        this.minimap.updatePressureGauge(
            readinessUi,
            passPlan,
            styleSource,
            isPro,
            advancedContext,
            this.currentRunProgress,
            this.getRTCorpusEstimate().estimatedTokens,
            (value) => this.formatTokenEstimate(value),
            balanceTooltipText
        );
        this.updateMinimapReuseStatus();
    }

    private getDisplayedPassPlan(passPlan: PassPlanResult): PassPlanResult {
        const progress = this.currentRunProgress;
        if (!this.state.isRunning || !progress || progress.totalPasses <= 1) {
            return passPlan;
        }
        return {
            ...passPlan,
            multiPassExpected: true,
            recentExactPassCount: progress.totalPasses,
            displayPassCount: progress.totalPasses,
            multiPassTriggerReason: this.describeRunningPassPlan(progress)
        };
    }

    private describeRunningPassPlan(progress: InquiryRunProgressEvent): string {
        if (progress.phase === 'finalizing') {
            return `Finalizing after pass ${progress.totalPasses} of ${progress.totalPasses}.`;
        }
        return `Pass ${progress.currentPass} of ${progress.totalPasses} is in progress.`;
    }

    private updateMinimapReuseStatus(): void {
        const advanced = this.getEffectiveReuseAdvancedContext();
        this.minimap.updateReuseStatus(advanced);
    }

    private renderCorpusCcStrip(): void {
        if (!this.rootSvg) return;
        const entries = this.getCorpusCcEntries();
        const entriesByClass = new Map<string, CorpusCcEntry[]>();
        entries.forEach(entry => {
            const list = entriesByClass.get(entry.className) ?? []; // SAFE: first entry for this class starts a fresh list
            list.push(entry);
            entriesByClass.set(entry.className, list);
        });
        entriesByClass.forEach(items => {
            items.sort((a, b) => this.compareCorpusCcEntries(a, b));
        });
        const classGroups = this.getCorpusCcClassGroups(entriesByClass);
        const rendered = renderInquiryCorpusStrip({
            rootSvg: this.rootSvg,
            refs: {
                ccGroup: this.ccGroup,
                ccLabelGroup: this.ccLabelGroup,
                ccLabelHit: this.ccLabelHit,
                ccLabel: this.ccLabel,
                ccCorpusLabel: this.ccCorpusLabel,
                ccCorpusUnderline: this.ccCorpusUnderline,
                ccLegendTrigger: this.ccLegendTrigger,
                ccLegendPanel: this.ccLegendPanel,
                ccLabelHint: this.ccLabelHint,
                ccLabelHintIcon: this.ccLabelHintIcon,
                ccEmptyText: this.ccEmptyText,
                ccClassLabels: this.ccClassLabels,
                ccSlots: this.ccSlots
            },
            entries,
            classGroups,
            createIconUse: this.createIconUse.bind(this),
            registerSvgEvent: this.registerSvgEvent.bind(this),
            getScopeLabel: this.getCorpusCcScopeLabel.bind(this),
            getModeMeta: this.getCorpusCcModeMeta.bind(this),
            getHeaderLabel: this.getCorpusCcHeaderLabel.bind(this),
            getHeaderTooltip: this.getCorpusCcHeaderTooltip.bind(this),
            onGlobalToggle: this.handleCorpusGlobalToggle.bind(this),
            onGlobalContextMenu: this.handleCorpusGlobalContextMenu.bind(this),
            onGroupToggle: this.handleCorpusGroupToggle.bind(this),
            onItemToggle: this.handleCorpusItemToggle.bind(this),
            onItemShiftAction: this.handleCorpusItemShiftAction.bind(this),
            onItemContextMenu: this.handleCorpusItemContextMenu.bind(this),
            onItemHover: this.handleCorpusItemHover.bind(this),
            onItemLeave: this.handleCorpusItemLeave.bind(this),
            openEntryPath: (filePath: string) => {
                if (this.state.isRunning) return;
                const file = this.app.vault.getAbstractFileByPath(filePath);
                if (file && this.isTFile(file)) {
                    void openOrRevealFile(this.app, file);
                }
            },
            onCorpusTitleClick: () => {
                this.openInquirySettings('sources');
            }
        });
        this.ccGroup = rendered.ccGroup;
        this.ccLabelGroup = rendered.ccLabelGroup;
        this.ccLabelHit = rendered.ccLabelHit;
        this.ccLabel = rendered.ccLabel;
        this.ccCorpusLabel = rendered.ccCorpusLabel;
        this.ccCorpusUnderline = rendered.ccCorpusUnderline;
        this.ccLegendTrigger = rendered.ccLegendTrigger;
        this.ccLegendPanel = rendered.ccLegendPanel;
        this.ccLabelHint = rendered.ccLabelHint;
        this.ccLabelHintIcon = rendered.ccLabelHintIcon;
        this.ccEmptyText = rendered.ccEmptyText;
        this.ccClassLabels = rendered.ccClassLabels;
        this.ccSlots = rendered.ccSlots;
        this.ccEntries = rendered.ccEntries;
        this.ccLayout = rendered.ccLayout;
        if (rendered.ccEntries.length) {
            void this.updateCorpusCcData(rendered.ccEntries);
        }
    }

    private getCorpusCcScopeLabel(): string {
        const scopeLabel = this.getScopeLabel();
        if (this.state.scope === 'saga') {
            return `Saga ${scopeLabel}`;
        }
        return `Book ${scopeLabel}`;
    }

    private getCorpusGroupBaseClass(className: string): string {
        return getCorpusGroupBaseClassPure(className);
    }

    private getCorpusGroupKey(className: string, scope?: InquiryScope): string {
        return getCorpusGroupKeyPure(className, scope);
    }

    private getSceneBookGroupKey(bookId: string): string {
        return `scene-book:${bookId}`;
    }

    private parseSceneBookGroupKey(groupKey: string): string | null {
        const prefix = 'scene-book:';
        if (!groupKey.startsWith(prefix)) return null;
        const bookId = groupKey.slice(prefix.length).trim();
        return bookId.length ? bookId : null;
    }

    private getCorpusItemKey(className: string, filePath: string, scope?: InquiryScope, sceneId?: string): string {
        return getCorpusItemKeyPure(className, filePath, scope, sceneId);
    }

    private parseCorpusItemKey(entryKey: string): { className: string; scope?: InquiryScope; path: string; sceneId?: string } {
        return parseCorpusItemKeyPure(entryKey);
    }

    private getCorpusItemOverride(
        className: string,
        filePath: string,
        scope?: InquiryScope,
        sceneId?: string
    ): SceneInclusion | undefined {
        return this.corpusService.getItemOverride(className, filePath, scope, sceneId);
    }

    private getCorpusCycleModes(className: string): SceneInclusion[] {
        return getCorpusCycleModesPure(className);
    }

    private getCorpusGroupBaseMode(
        className: string,
        configMap: Map<string, InquiryClassConfig>
    ): SceneInclusion {
        return this.corpusService.getGroupBaseMode(className, configMap, this.state.scope, this.ccEntries);
    }

    private getCorpusGroupEffectiveMode(
        className: string,
        configMap: Map<string, InquiryClassConfig>
    ): SceneInclusion {
        return this.corpusService.getGroupEffectiveMode(className, configMap, this.state.scope, this.ccEntries);
    }

    private getCorpusItemEffectiveMode(
        entry: CorpusManifestEntry,
        configMap: Map<string, InquiryClassConfig>
    ): SceneInclusion {
        return this.corpusService.getItemEffectiveMode(entry, configMap, this.state.scope, this.ccEntries);
    }

    private getCorpusGroupKeys(sources: InquirySourcesSettings): string[] {
        return getCorpusGroupKeysPure(sources, this.ccEntries);
    }

    private getCorpusGlobalMode(
        groupKeys: string[],
        configMap: Map<string, InquiryClassConfig>
    ): SceneInclusion | 'mixed' {
        return this.corpusService.getGlobalMode(groupKeys, configMap, this.state.scope, this.ccEntries);
    }

    private getNextCorpusMode(current: SceneInclusion, modes: SceneInclusion[]): SceneInclusion {
        return getNextCorpusModePure(current, modes);
    }

    private clearItemOverridesForGroup(groupKey: string): void {
        this.corpusService.clearItemOverridesForGroup(groupKey);
    }

    private hasCorpusOverrides(): boolean {
        return this.corpusService.hasOverrides();
    }

    private getCorpusOverrideSummary(): { active: boolean; classCount: number; itemCount: number; total: number } {
        return this.corpusService.getOverrideSummary();
    }

    private applyCorpusOverrideSummary(result: InquiryResult): InquiryResult {
        return this.corpusService.applyOverrideSummary(result);
    }

    private resetCorpusOverrides(): void {
        this.corpusService.resetOverrides();
        this.corpusWarningActive = false;
        this.refreshUI();
    }

    private handleCorpusGroupToggle(groupKey: string): void {
        if (this.state.isRunning) return;
        const sceneBookId = this.parseSceneBookGroupKey(groupKey);
        if (sceneBookId) {
            this.handleCorpusSceneBookGroupToggle(sceneBookId);
            return;
        }
        const sources = this.normalizeInquirySources(this.settingsAccessor.getSources());
        const configMap = new Map((sources.classes || []).map(config => [config.className, config])); // SAFE: settings may omit class configs — empty map means no class modes configured
        const currentMode = this.getCorpusGroupEffectiveMode(groupKey, configMap);
        const modes = this.getCorpusCycleModes(groupKey);
        const nextMode = this.getNextCorpusMode(currentMode, modes);
        const baseMode = this.getCorpusGroupBaseMode(groupKey, configMap);
        const normalizedNext = this.normalizeContributionMode(nextMode, this.getCorpusGroupBaseClass(groupKey));
        if (normalizedNext === baseMode) {
            this.corpusService.deleteClassOverride(groupKey);
        } else {
            this.corpusService.setClassOverride(groupKey, normalizedNext);
        }
        this.clearItemOverridesForGroup(groupKey);
        this.corpusWarningActive = false;
        this.refreshUI();
    }

    private getSceneBookEffectiveMode(entries: CorpusCcEntry[]): SceneInclusion | 'mixed' {
        if (!entries.length) return 'excluded';
        const modes = entries.map(entry => this.normalizeContributionMode(entry.mode ?? 'excluded', 'scene')); // SAFE: entries without a mode are treated as excluded
        const first = modes[0];
        if (modes.every(mode => mode === first)) return first;
        return 'mixed';
    }

    private getSceneBookDisplayMode(entries: CorpusCcEntry[]): SceneInclusion {
        const mode = this.getSceneBookEffectiveMode(entries);
        if (mode === 'mixed') {
            const hasFull = entries.some(entry => this.normalizeContributionMode(entry.mode ?? 'excluded', 'scene') === 'full'); // SAFE: entries without a mode are treated as excluded
            return hasFull ? 'full' : 'summary';
        }
        return mode;
    }

    private handleCorpusSceneBookGroupToggle(bookId: string): void {
        const entries = this.ccEntries.filter(entry => entry.className === 'scene' && entry.bookId === bookId);
        if (!entries.length) return;

        const sources = this.normalizeInquirySources(this.settingsAccessor.getSources());
        const configMap = new Map((sources.classes || []).map(config => [config.className, config])); // SAFE: settings may omit class configs — empty map means no class modes configured
        const classMode = this.getCorpusGroupEffectiveMode('scene', configMap);
        const currentMode = this.getSceneBookEffectiveMode(entries);
        const modes = this.getCorpusCycleModes('scene');
        const nextMode = currentMode === 'mixed' ? 'excluded' : this.getNextCorpusMode(currentMode, modes);
        const normalizedNext = this.normalizeContributionMode(nextMode, 'scene');

        entries.forEach(entry => {
            if (normalizedNext === classMode) {
                this.corpusService.deleteItemOverrideByKey(entry.entryKey);
            } else {
                this.corpusService.setItemOverrideByKey(entry.entryKey, normalizedNext);
            }
        });

        this.corpusWarningActive = false;
        this.refreshUI();
    }

    private handleCorpusItemToggle(entryKey: string): void {
        if (this.state.isRunning) return;
        const entry = this.ccEntries.find(candidate => candidate.entryKey === entryKey);
        if (!entry) return;
        const sources = this.normalizeInquirySources(this.settingsAccessor.getSources());
        const configMap = new Map((sources.classes || []).map(config => [config.className, config])); // SAFE: settings may omit class configs — empty map means no class modes configured
        const groupKey = this.getCorpusGroupKey(entry.classKey, entry.scope);
        const classMode = this.getCorpusGroupEffectiveMode(groupKey, configMap);
        const currentMode = this.normalizeContributionMode(entry.mode, this.getCorpusGroupBaseClass(groupKey));
        const modes = this.getCorpusCycleModes(groupKey);
        const nextMode = this.getNextCorpusMode(currentMode, modes);
        const normalizedNext = this.normalizeContributionMode(nextMode, this.getCorpusGroupBaseClass(groupKey));
        if (normalizedNext === classMode) {
            this.corpusService.deleteItemOverrideByKey(entryKey);
        } else {
            this.corpusService.setItemOverrideByKey(entryKey, normalizedNext);
        }
        this.corpusWarningActive = false;
        this.refreshUI();
    }

    private setCorpusItemInclusion(entryKey: string, mode: SceneInclusion): void {
        const entry = this.ccEntries.find(candidate => candidate.entryKey === entryKey);
        if (!entry) return;
        const sources = this.normalizeInquirySources(this.settingsAccessor.getSources());
        const configMap = new Map((sources.classes || []).map(config => [config.className, config])); // SAFE: settings may omit class configs — empty map means no class modes configured
        const groupKey = this.getCorpusGroupKey(entry.classKey, entry.scope);
        const classMode = this.getCorpusGroupEffectiveMode(groupKey, configMap);
        const normalizedMode = this.normalizeContributionMode(mode, this.getCorpusGroupBaseClass(groupKey));
        if (normalizedMode === classMode) {
            this.corpusService.deleteItemOverrideByKey(entryKey);
        } else {
            this.corpusService.setItemOverrideByKey(entryKey, normalizedMode);
        }
        this.corpusWarningActive = false;
        this.refreshUI();
    }

    private toggleTargetScene(sceneId: string, options?: { announce?: boolean }): void {
        if (this.state.scope !== 'book') {
            if (options?.announce) {
                this.notifyInteraction(t('inquiry.interaction.targetScenesBookOnly'));
            }
            return;
        }
        const normalizedId = String(sceneId || '').trim(); // SAFE: null or undefined sceneId normalizes to empty — guarded empty check follows
        if (!normalizedId) return;

        const existing = this.normalizeTargetSceneIds(this.state.targetSceneIds);
        const isTarget = existing.includes(normalizedId);
        const next = isTarget
            ? existing.filter(candidate => candidate !== normalizedId)
            : [...existing, normalizedId];
        this.selection.setTargetSceneIds(next);

        const activeBookId = this.corpus?.activeBookId ?? this.state.activeBookId;
        if (activeBookId) {
            this.freshModeTouchedBookIds.add(activeBookId);
            this.selection.rememberTargetSceneIdsForBook(activeBookId, next);
        }

        this.scheduleTargetPersist();
        this.refreshUI();

        if (options?.announce) {
            this.notifyInteraction(isTarget ? 'Removed from Target Scenes.' : 'Added to Target Scenes.');
        }
    }

    private clearAllTargetScenes(options?: { announce?: boolean }): void {
        if (this.state.scope !== 'book') {
            if (options?.announce) {
                this.notifyInteraction(t('inquiry.interaction.targetScenesBookOnly'));
            }
            return;
        }

        if (!this.state.targetSceneIds.length) {
            if (options?.announce) {
                this.notifyInteraction(t('inquiry.interaction.noTargetScenesToClear'));
            }
            return;
        }

        this.selection.setTargetSceneIds([]);

        const activeBookId = this.corpus?.activeBookId ?? this.state.activeBookId;
        if (activeBookId) {
            this.freshModeTouchedBookIds.add(activeBookId);
            this.selection.rememberTargetSceneIdsForBook(activeBookId, []);
        }

        this.scheduleTargetPersist();
        this.refreshUI();

        if (options?.announce) {
            this.notifyInteraction(t('inquiry.interaction.clearedAllTargetScenes'));
        }
    }

    private handleCorpusItemShiftAction(entryKey: string, filePath: string, event: MouseEvent): void {
        if (this.state.isRunning) return;
        event.preventDefault();
        const entry = this.ccEntries.find(candidate => candidate.entryKey === entryKey);
        if (!entry) return;
        if (entry.classKey === 'scene' && entry.sceneId) {
            this.toggleTargetScene(entry.sceneId, { announce: true });
            return;
        }
        if (filePath) {
            const file = this.app.vault.getAbstractFileByPath(filePath);
            if (file && this.isTFile(file)) {
                void openOrRevealFile(this.app, file);
            }
        }
    }

    private menuTitleWithKeys(title: string, keys: string[]): string {
        return `${title}        ${keys.join(' + ')}`;
    }

    private doesMinimapItemHaveFinding(item: InquiryCorpusItem): boolean {
        const result = this.state.activeResult;
        if (!result || this.state.isRunning || this.isErrorResult(result)) return false;
        const resultItems = this.getResultItems(result);
        const findingMap = this.buildFindingMap(result, resultItems);
        return findingMap.has(item.displayLabel);
    }

    private hasActiveSavedBrief(): boolean {
        const sessionId = this.state.activeSessionId;
        if (!sessionId) return false;
        const session = this.sessionStore.peekSession(sessionId);
        return !!session?.briefPath;
    }

    private showMinimapSceneMenu(options: {
        item: InquiryCorpusItem;
        filePath: string;
        hasCitation: boolean;
        isTarget: boolean;
        event: MouseEvent;
    }): void {
        const menu = new Menu();
        menu.addItem(menuItem => {
            const sceneTitle = options.hasCitation ? t('inquiry.menu.openScene') : this.menuTitleWithKeys(t('inquiry.menu.openScene'), ['Click']);
            menuItem.setTitle(sceneTitle);
            menuItem.onClick(() => {
                const file = this.app.vault.getAbstractFileByPath(options.filePath);
                if (file && this.isTFile(file)) {
                    void openOrRevealFile(this.app, file);
                }
            });
        });
        if (this.hasActiveSavedBrief()) {
            menu.addItem(menuItem => {
                menuItem.setTitle(this.menuTitleWithKeys(
                    options.hasCitation ? t('inquiry.menu.openCitationBriefing') : t('inquiry.menu.openBriefingArticle'),
                    ['⌥', 'Click']
                ));
                menuItem.onClick(() => {
                    if (options.hasCitation) {
                        this.openActiveBriefArticleForItem(options.item);
                        return;
                    }
                    this.openActiveBriefArticle();
                });
            });
            menu.addItem(menuItem => {
                menuItem.setTitle(this.menuTitleWithKeys(
                    options.hasCitation ? t('inquiry.menu.openCitationMarkdown') : t('inquiry.menu.openBriefMarkdown'),
                    ['Click']
                ));
                menuItem.onClick(() => {
                    void (options.hasCitation ? this.openActiveBriefForItem(options.item) : this.openActiveBrief());
                });
            });
        }
        menu.addSeparator();
        menu.addItem(menuItem => {
            const focusLabel = options.isTarget ? t('inquiry.menu.removeFocus') : t('inquiry.menu.setFocus');
            menuItem.setTitle(this.menuTitleWithKeys(focusLabel, ['⇧', 'Click']));
            if (!options.item.sceneId) {
                menuItem.setDisabled(true);
                return;
            }
            menuItem.onClick(() => this.toggleTargetScene(options.item.sceneId!, { announce: true }));
        });
        menu.showAtMouseEvent(options.event);
    }

    private showSceneEntryMenu(options: {
        entryKey: string;
        filePath: string;
        sceneId?: string;
        isTarget: boolean;
        event: MouseEvent;
    }): void {
        const menu = new Menu();
        menu.addItem(item => {
            item.setTitle(options.sceneId ? t('inquiry.menu.openScene') : t('inquiry.menu.openNote'));
            item.onClick(() => {
                const file = this.app.vault.getAbstractFileByPath(options.filePath);
                if (file && this.isTFile(file)) {
                    void openOrRevealFile(this.app, file);
                }
            });
        });
        menu.addSeparator();
        ([
            ['excluded', t('inquiry.menu.corpusExclude')],
            ['summary', t('inquiry.menu.corpusSummary')],
            ['full', t('inquiry.menu.corpusFullScene')]
        ] as const).forEach(([mode, title]) => {
            menu.addItem(item => {
                item.setTitle(this.menuTitleWithKeys(title, ['Click']));
                item.onClick(() => this.setCorpusItemInclusion(options.entryKey, mode));
            });
        });
        menu.addSeparator();
        menu.addItem(item => {
            const bookOnly = this.state.scope !== 'book';
            const targetLabel = options.isTarget ? t('inquiry.menu.removeFromTargetScenes') : t('inquiry.menu.addToTargetScenes');
            item.setTitle(this.menuTitleWithKeys(targetLabel, ['⇧', 'Click']));
            if (bookOnly || !options.sceneId) {
                item.setDisabled(true);
                return;
            }
            item.onClick(() => this.toggleTargetScene(options.sceneId!, { announce: true }));
        });
        menu.showAtMouseEvent(options.event);
    }

    private handleCorpusItemContextMenu(entryKey: string, filePath: string, event: MouseEvent): void {
        if (this.state.isRunning) return;
        event.preventDefault();
        const entry = this.ccEntries.find(candidate => candidate.entryKey === entryKey);
        if (!entry) return;
        this.showSceneEntryMenu({
            entryKey,
            filePath,
            sceneId: entry.classKey === 'scene' ? entry.sceneId : undefined,
            isTarget: entry.isTarget,
            event
        });
    }

    private handleCorpusItemHover(entryKey: string): void {
        if (this.state.isRunning) return;
        const entry = this.ccEntries.find(candidate => candidate.entryKey === entryKey);
        if (!entry?.sceneId) {
            this.minimap.updateLinkedHoverState();
            return;
        }
        this.minimap.updateLinkedHoverState(entry.sceneId);
    }

    private handleCorpusItemLeave(): void {
        this.minimap.updateLinkedHoverState();
    }

    private handleCorpusGlobalContextMenu(event: MouseEvent): void {
        if (this.state.isRunning) return;
        event.preventDefault();

        const menu = new Menu();
        menu.addItem(item => {
            item.setTitle(t('inquiry.menu.cancelTargeting'));
            if (this.state.scope !== 'book' || this.getActiveTargetSceneIds().length === 0) {
                item.setDisabled(true);
                return;
            }
            item.onClick(() => this.clearAllTargetScenes({ announce: true }));
        });
        menu.showAtMouseEvent(event);
    }

    private handleCorpusGlobalToggle(): void {
        if (this.state.isRunning) return;
        const sources = this.normalizeInquirySources(this.settingsAccessor.getSources());
        const configMap = new Map((sources.classes || []).map(config => [config.className, config])); // SAFE: settings may omit class configs — empty map means no class modes configured
        const groupKeys = this.getCorpusGroupKeys(sources);
        if (!groupKeys.length) return;
        const current = this.getCorpusGlobalMode(groupKeys, configMap);
        const next = current === 'excluded'
            ? 'summary'
            : current === 'summary'
                ? 'full'
                : 'excluded';

        this.corpusService.resetOverrides();
        groupKeys.forEach(groupKey => {
            const baseClass = this.getCorpusGroupBaseClass(groupKey);
            const normalizedTarget = this.normalizeContributionMode(next, baseClass);
            const baseMode = this.getCorpusGroupBaseMode(groupKey, configMap);
            if (normalizedTarget !== baseMode) {
                this.corpusService.setClassOverride(groupKey, normalizedTarget);
            }
        });
        this.corpusWarningActive = false;
        this.refreshUI();
    }

    private isCorpusEmpty(): boolean {
        const stats = this.getPayloadStats();
        const total = stats.sceneTotal
            + stats.bookOutlineCount
            + stats.sagaOutlineCount
            + stats.referenceCounts.total;
        return total === 0;
    }

    private handleEmptyCorpusRun(): void {
        this.corpusWarningActive = true;
        this.updateGuidanceHelpTooltip(this.guidanceState);
        this.notifyInteraction(t('inquiry.interaction.corpusDisabled'));
    }

    private getCorpusCcModeMeta(mode: SceneInclusion): {
        label: string;
        short: string;
        icon: string;
        isActive: boolean;
    } {
        return getCorpusCcModeMetaPure(mode);
    }

    private getCorpusCcHeaderLabel(className: string, count: number, overrideLabel?: string): string {
        return getCorpusCcHeaderLabelPure(className, count, overrideLabel);
    }

    private getCorpusCcHeaderTooltip(
        className: string,
        mode: SceneInclusion,
        count: number,
        overrideLabel?: string
    ): string {
        return getCorpusCcHeaderTooltipPure(className, mode, count, overrideLabel);
    }

    private getCorpusCcHeaderDisplayLabel(className: string): string {
        return getCorpusCcHeaderDisplayLabelPure(className);
    }


    private getSceneBookMetaFromEntry(entry: CorpusCcEntry): { bookId: string; bookLabel: string; order: number } {
        const books = this.corpus?.books ?? []; // SAFE: corpus not loaded yet — no books to match
        if (entry.bookId) {
            const match = books.find(book => book.id === entry.bookId);
            if (match) {
                const index = books.findIndex(book => book.id === match.id);
                return {
                    bookId: match.id,
                    bookLabel: entry.bookLabel || match.displayLabel,
                    order: index >= 0 ? index : Number.POSITIVE_INFINITY
                };
            }
            return {
                bookId: entry.bookId,
                bookLabel: entry.bookLabel || '?', // SAFE: display placeholder when the book id has no known label
                order: Number.POSITIVE_INFINITY
            };
        }

        const byPath = books.find(book => entry.filePath === book.rootPath || entry.filePath.startsWith(`${book.rootPath}/`));
        if (byPath) {
            const index = books.findIndex(book => book.id === byPath.id);
            return {
                bookId: byPath.id,
                bookLabel: byPath.displayLabel,
                order: index >= 0 ? index : Number.POSITIVE_INFINITY
            };
        }

        const fallback = entry.filePath.split('/').filter(Boolean);
        const folder = fallback.length > 1 ? fallback[0] : 'book';
        const numeric = getCorpusCcOrderNumber(folder, 'outline');
        const fallbackLabel = numeric !== null ? `B${numeric}` : '?';
        return {
            bookId: folder || entry.filePath,
            bookLabel: fallbackLabel,
            order: numeric !== null ? numeric : Number.POSITIVE_INFINITY
        };
    }

    private buildSagaSceneGroups(
        sceneEntries: CorpusCcEntry[],
        sceneMode: SceneInclusion
    ): CorpusCcGroup[] {
        if (!sceneEntries.length) {
            return [{
                key: 'scene',
                className: 'scene',
                items: [],
                count: 0,
                mode: sceneMode
            }];
        }

        const groups = new Map<string, { items: CorpusCcEntry[]; label: string; order: number }>();
        sceneEntries.forEach(entry => {
            const meta = this.getSceneBookMetaFromEntry(entry);
            const bucket = groups.get(meta.bookId);
            if (bucket) {
                bucket.items.push(entry);
                return;
            }
            groups.set(meta.bookId, { items: [entry], label: meta.bookLabel, order: meta.order });
        });

        const orderedGroups = Array.from(groups.entries())
            .map(([bookId, value]) => ({
                key: this.getSceneBookGroupKey(bookId),
                className: 'scene' as const,
                items: value.items,
                count: value.items.length,
                mode: this.getSceneBookDisplayMode(value.items),
                headerLabel: value.label,
                headerTooltipLabel: `${value.label} Scenes`,
                order: value.order
            }))
            .sort((a, b) => {
                if (a.order !== b.order) return a.order - b.order;
                return a.headerLabel.localeCompare(b.headerLabel, undefined, { numeric: true, sensitivity: 'base' });
            });

        return orderedGroups.map(({ order: _order, ...group }) => group);
    }

    private getCorpusCcClassGroups(entriesByClass: Map<string, CorpusCcEntry[]>): CorpusCcGroup[] {
        const sources = this.normalizeInquirySources(this.settingsAccessor.getSources());
        const classScope = this.getClassScopeConfig(sources.classScope);
        const configMap = new Map((sources.classes || []).map(config => [config.className, config])); // SAFE: settings may omit class configs — empty map means no class modes configured
        const configs = (sources.classes || []) // SAFE: settings may omit class configs — nothing to group
            .filter(config => config.enabled && (classScope.allowAll || classScope.allowed.has(config.className)));
        const groups: CorpusCcGroup[] = [];
        const ensureGroup = (className: string, mode: SceneInclusion) => {
            const items = entriesByClass.get(className) ?? []; // SAFE: class has no entries yet — group renders empty
            groups.push({ key: className, className, items, count: items.length, mode });
        };

        configs.forEach(config => {
            if (!config) return;
            const normalizedName = config.className;
            if (normalizedName === 'scene' && this.state.scope === 'saga') {
                const sceneMode = this.getCorpusGroupEffectiveMode('scene', configMap);
                const sceneItems = entriesByClass.get('scene') ?? []; // SAFE: no scene entries in saga scope — book groups render empty
                groups.push(...this.buildSagaSceneGroups(sceneItems, sceneMode));
                return;
            }
            if (normalizedName === 'outline') {
                const outlineMode = this.getCorpusGroupEffectiveMode('outline', configMap);
                ensureGroup('outline', outlineMode);
                if (this.state.scope === 'saga') {
                    const sagaMode = this.getCorpusGroupEffectiveMode('outline-saga', configMap);
                    const sagaItems = entriesByClass.get('outline-saga') ?? []; // SAFE: no saga outline entries — group renders empty
                    groups.push({
                        key: 'outline-saga',
                        className: 'outline-saga',
                        items: sagaItems,
                        count: sagaItems.length,
                        mode: sagaMode,
                        headerLabel: `${SIGMA_CHAR}`,
                        headerTooltipLabel: 'Saga Outline'
                    });
                }
                return;
            }

            const normalizedMode = this.getCorpusGroupEffectiveMode(normalizedName, configMap);
            ensureGroup(normalizedName, normalizedMode);
        });

        entriesByClass.forEach((items, className) => {
            if (groups.some(group => group.key === className || group.className === className)) return;
            const baseClass = this.getCorpusGroupBaseClass(className);
            const entryConfig = configMap.get(baseClass);
            if (entryConfig && !entryConfig.enabled) return;
            const override = this.corpusService.getClassOverride(className);
            const mode = override ?? items[0]?.mode ?? 'excluded'; // SAFE: no override and no entries — class defaults to excluded
            groups.push({
                key: className,
                className,
                items,
                count: items.length,
                mode: this.normalizeContributionMode(mode, baseClass)
            });
        });

        const order = ['scene', 'outline', 'outline-saga', 'character', 'place', 'power'];
        groups.sort((a, b) => {
            const aIndex = order.indexOf(a.className);
            const bIndex = order.indexOf(b.className);
            if (aIndex !== -1 || bIndex !== -1) {
                return (aIndex === -1 ? 999 : aIndex) - (bIndex === -1 ? 999 : bIndex);
            }
            return a.className.localeCompare(b.className);
        });

        return groups;
    }

    private resolveCorpusBookForPath(path: string): { id: string; label: string } | undefined {
        const books = this.corpus?.books ?? []; // SAFE: corpus not loaded yet — no books to match
        const match = books.find(book => path === book.rootPath || path.startsWith(`${book.rootPath}/`));
        if (match) {
            return {
                id: match.id,
                label: match.displayLabel
            };
        }

        const segments = path.split('/').filter(Boolean);
        const bookSegmentIndex = segments.findIndex(segment => /^book\s+\d+/i.test(segment));
        if (bookSegmentIndex >= 0) {
            const segment = segments[bookSegmentIndex];
            const numberMatch = segment.match(/^book\s+(\d+)/i);
            const number = numberMatch ? Number.parseInt(numberMatch[1], 10) : Number.NaN;
            return {
                id: segments.slice(0, bookSegmentIndex + 1).join('/'),
                label: Number.isFinite(number) ? `B${number}` : '?'
            };
        }

        const fallbackRoot = segments[0] || path;
        const numeric = getCorpusCcOrderNumber(fallbackRoot, 'outline');
        return {
            id: fallbackRoot,
            label: numeric !== null ? `B${numeric}` : '?'
        };
    }

    private getCorpusCcEntries(): CorpusCcEntry[] {
        // No corpus entries when book scope is unresolved.
        if (this.state.scope === 'book' && this.corpus && !this.corpus.bookResolved) {
            return [];
        }
        const manifest = this.buildCorpusEntryList(this.state.activeQuestionId ?? 'cc-preview', { // SAFE: no active question — stable preview id keys the entry list
            questionZone: this.state.activeZone ?? undefined,
            includeInactive: true,
            applyOverrides: true
        });
        const sceneEntries = manifest.entries.filter(entry => entry.class === 'scene');
        const outlineEntries = manifest.entries.filter(entry => entry.class === 'outline');
        const referenceEntries = manifest.entries.filter(entry => entry.class !== 'scene' && entry.class !== 'outline' && entry.class !== 'book');
        const bookOutlineEntries = outlineEntries
            .filter(entry => entry.scope !== 'saga');
        const sagaOutlineEntries = this.state.scope === 'saga'
            ? outlineEntries.filter(entry => entry.scope === 'saga')
            : [];

        const scopedEntries = [
            ...sceneEntries,
            ...bookOutlineEntries,
            ...sagaOutlineEntries,
            ...referenceEntries
        ];

        return scopedEntries.map(entry => {
            const fallbackLabel = entry.path.split('/').pop() || entry.path;
            const file = this.app.vault.getAbstractFileByPath(entry.path);
            const label = file && this.isTFile(file) ? this.getDocumentTitle(file) : fallbackLabel;
            const className = entry.class === 'outline' && entry.scope === 'saga'
                ? 'outline-saga'
                : entry.class;
            const entryKey = this.getCorpusItemKey(entry.class, entry.path, entry.scope, entry.sceneId);
            const resolvedSceneBook = entry.class === 'scene' ? this.resolveCorpusBookForPath(entry.path) : undefined;
            const sceneBook = entry.class === 'scene'
                ? {
                    id: entry.bookId || resolvedSceneBook?.id || '', // SAFE: unresolved scene book — empty id renders as unknown book
                    label: resolvedSceneBook?.label || '?' // SAFE: display placeholder for an unresolved book label
                }
                : undefined;
            return {
                id: `${entry.class}:${entry.path}`,
                entryKey,
                label,
                filePath: entry.path,
                sceneId: entry.sceneId,
                bookId: sceneBook?.id || undefined,
                bookLabel: sceneBook?.label,
                className,
                classKey: entry.class,
                scope: entry.scope,
                mode: this.normalizeContributionMode(entry.mode ?? 'excluded', entry.class), // SAFE: entries without a mode are treated as excluded
                isTarget: entry.isTarget,
                sortLabel: label
            };
        });
    }

    private compareCorpusCcEntries(a: CorpusCcEntry, b: CorpusCcEntry): number {
        const aLabel = (a.sortLabel ?? a.label).trim();
        const bLabel = (b.sortLabel ?? b.label).trim();
        const aNumber = getCorpusCcOrderNumber(aLabel, a.className);
        const bNumber = getCorpusCcOrderNumber(bLabel, b.className);
        const aHasNumber = aNumber !== null;
        const bHasNumber = bNumber !== null;

        if (aHasNumber && bHasNumber && aNumber !== bNumber) {
            return aNumber - bNumber;
        }
        if (aHasNumber !== bHasNumber) {
            return aHasNumber ? -1 : 1;
        }

        const labelCompare = aLabel.localeCompare(bLabel, undefined, { numeric: false, sensitivity: 'base' });
        if (labelCompare !== 0) return labelCompare;
        return a.filePath.localeCompare(b.filePath);
    }


    private buildSagaCcEntries(corpus: InquiryCorpusSnapshot): CorpusCcEntry[] {
        const sources = this.normalizeInquirySources(this.settingsAccessor.getSources());
        const classScope = this.getClassScopeConfig(sources.classScope);
        const outlineConfig = (sources.classes || []).find(cfg => cfg.className === 'outline'); // SAFE: settings may omit class configs — missing outline config disables outlines below
        if (!outlineConfig?.enabled) {
            return [];
        }
        const includeBookOutlines = this.isModeActive(outlineConfig.bookScope);
        const includeSagaOutlines = this.isModeActive(outlineConfig.sagaScope);
        const outlineAllowed = includeBookOutlines || includeSagaOutlines;
        if (!outlineAllowed || (!classScope.allowAll && !classScope.allowed.has('outline'))) {
            return [];
        }

        const outlineFiles = this.getOutlineFiles();
        const bookOutlines = outlineFiles.filter(file => (this.getOutlineScope(file) ?? 'book') === 'book'); // SAFE: outlines without an explicit scope are book-scoped
        const sagaOutlines = outlineFiles.filter(file => this.getOutlineScope(file) === 'saga');

        const entries: CorpusCcEntry[] = [];
        if (includeBookOutlines) {
            entries.push(...corpus.books.map(book => {
                const outline = bookOutlines.find(file => file.path === book.rootPath || file.path.startsWith(`${book.rootPath}/`));
                const filePath = outline?.path || ''; // SAFE: book without an outline file — empty path marks a missing outline entry
                return {
                    id: outline?.path || book.id,
                    entryKey: this.getCorpusItemKey('outline', filePath || book.id, 'book'),
                    label: book.displayLabel,
                    filePath,
                    className: 'outline',
                    classKey: 'outline',
                    mode: this.normalizeContributionMode(outlineConfig.bookScope, 'outline'),
                    isTarget: false
                };
            }));
        }

        if (includeSagaOutlines) {
            const sagaOutline = sagaOutlines[0];
            const filePath = sagaOutline?.path || ''; // SAFE: no saga outline file — empty path marks a missing outline entry
            entries.push({
                id: sagaOutline?.path || 'saga-outline', // SAFE: stable placeholder id when no saga outline file exists
                entryKey: this.getCorpusItemKey('outline', filePath || 'saga-outline', 'saga'), // SAFE: stable placeholder key when no saga outline file exists
                label: 'Saga',
                filePath,
                className: 'outline',
                classKey: 'outline',
                mode: this.normalizeContributionMode(outlineConfig.sagaScope, 'outline'),
                isTarget: false
            });
        }

        return entries;
    }

    private getOutlineFiles(): TFile[] {
        const sources = this.normalizeInquirySources(this.settingsAccessor.getSources());
        const classScope = this.getClassScopeConfig(sources.classScope);
        const outlineConfig = (sources.classes || []).find(cfg => cfg.className === 'outline'); // SAFE: settings may omit class configs — missing outline config yields no files
        if (!outlineConfig?.enabled) return [];
        if (!this.isModeActive(outlineConfig.bookScope) && !this.isModeActive(outlineConfig.sagaScope)) return [];
        if (!classScope.allowAll && !classScope.allowed.has('outline')) return [];

        const { resolvedVaultRoots } = resolveInquirySourceRoots(this.app.vault, sources, this.plugin.settings.books);
        const bookResolution = resolveBookManagerInquiryBooks(this.plugin.settings.books);

        const inRoots = (path: string) => {
            return resolvedVaultRoots.some(root => !root || path === root || path.startsWith(`${root}/`));
        };

        const files = this.app.vault.getMarkdownFiles();
        return files.filter(file => {
            if (!inRoots(file.path)) return false;
            if (!isPathIncludedByInquiryBooks(file.path, bookResolution.candidates, this.state.scope)) return false;
            const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
            if (!frontmatter) return false;
            const normalized = normalizeFrontmatterKeys(frontmatter, getActiveFrontmatterMappings(this.plugin.settings));
            const classValues = this.extractClassValues(normalized);
            return classValues.includes('outline');
        });
    }

    private getOutlineScope(file: TFile): InquiryScope | undefined {
        const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
        if (!frontmatter) return undefined;
        return this.getFrontmatterScope(frontmatter);
    }

    // Corpus Async Coordination
    private async updateCorpusCcData(entries: CorpusCcEntry[]): Promise<void> {
        const updateId = ++this.ccUpdateId;
        const stats = await Promise.all(entries.map(entry => this.loadCorpusCcStats(entry)));
        if (updateId !== this.ccUpdateId) return;
        const thresholds = this.getCorpusThresholds();
        const pageHeight = this.ccLayout?.pageHeight ?? Math.round(CC_PAGE_BASE_SIZE * 1.45);
        stats.forEach((entryStats, idx) => {
            const slot = this.ccSlots[idx];
            const entry = entries[idx];
            if (!slot || !entry) return;
            const viewModel = buildInquiryCorpusCcSlotViewModel({
                entry,
                stats: entryStats,
                thresholds,
                pageHeight
            });
            applyInquiryCorpusCcSlotViewModel(slot, viewModel);
        });
    }

    private getCorpusThresholds(): { emptyMax: number; sketchyMin: number; mediumMin: number; substantiveMin: number } {
        const defaults = DEFAULT_SETTINGS.inquiryCorpusThresholds || {
            emptyMax: 10,
            sketchyMin: 100,
            mediumMin: 300,
            substantiveMin: 1000
        };
        const raw = this.settingsAccessor.getCorpusThresholds() || defaults;
        return {
            emptyMax: Number.isFinite(raw.emptyMax) ? raw.emptyMax : defaults.emptyMax,
            sketchyMin: Number.isFinite(raw.sketchyMin) ? raw.sketchyMin : defaults.sketchyMin,
            mediumMin: Number.isFinite(raw.mediumMin) ? raw.mediumMin : defaults.mediumMin,
            substantiveMin: Number.isFinite(raw.substantiveMin) ? raw.substantiveMin : defaults.substantiveMin
        };
    }

    private async loadCorpusCcStats(entry: CorpusCcEntry): Promise<CorpusCcStats> {
        const filePath = entry.filePath;
        if (!filePath) {
            return { bodyWords: 0, synopsisWords: 0, synopsisQuality: 'missing' };
        }
        const file = this.app.vault.getAbstractFileByPath(filePath);
        if (!file || !this.isTFile(file)) {
            return { bodyWords: 0, synopsisWords: 0, synopsisQuality: 'missing' };
        }
        const mtime = file.stat.mtime ?? 0; // SAFE: missing mtime treated as 0 — cache lookup simply misses
        const title = this.getDocumentTitle(file);
        const frontmatter = this.getNormalizedFrontmatter(file) ?? {}; // SAFE: file without frontmatter — status fields read from an empty object
        const { statusRaw, due } = getDocumentStatusFields(frontmatter);
        const cached = this.ccWordCache.get(filePath);
        if (cached && cached.mtime === mtime && cached.statusRaw === statusRaw && cached.due === due && cached.title === title) {
            return {
                bodyWords: cached.bodyWords,
                synopsisWords: cached.synopsisWords,
                synopsisQuality: cached.synopsisQuality,
                statusRaw: cached.statusRaw,
                due: cached.due,
                title: cached.title
            };
        }
        const yamlWords = readFrontmatterWordCount(frontmatter);
        let bodyWords: number;
        if (yamlWords !== null) {
            bodyWords = yamlWords;
        } else {
            const content = await this.app.vault.cachedRead(file);
            bodyWords = countManuscriptWords(cleanEvidenceBody(content));
        }
        const summary = extractSummary(frontmatter);
        const synopsisWords = countSynopsisWords(summary);
        const synopsisQuality = classifySynopsis(summary);
        this.ccWordCache.set(filePath, {
            mtime,
            bodyWords,
            synopsisWords,
            synopsisQuality,
            statusRaw,
            due,
            title
        });
        return {
            bodyWords,
            synopsisWords,
            synopsisQuality,
            statusRaw,
            due,
            title
        };
    }

    private async loadCorpusCcStatsByPath(filePath: string): Promise<CorpusCcStats> {
        return this.loadCorpusCcStats({
            id: filePath,
            entryKey: this.getCorpusItemKey('', filePath),
            label: filePath,
            filePath,
            className: '',
            classKey: '',
            mode: 'full',
            isTarget: false
        });
    }

    private getDocumentTitle(file: TFile): string {
        const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
        if (frontmatter) {
            const normalized = normalizeFrontmatterKeys(frontmatter, getActiveFrontmatterMappings(this.plugin.settings));
            const rawTitle = normalized['Title'] ?? normalized['title'];
            if (typeof rawTitle === 'string' && rawTitle.trim()) {
                return rawTitle.trim();
            }
        }
        return file.basename;
    }

    private getStyleSource(): Element {
        return this.contentEl ?? this.rootSvg ?? activeDocument.documentElement;
    }

    private isTFile(file: TAbstractFile | null): file is TFile {
        return !!file && file instanceof TFile;
    }

    private updateScopeGlyph(): void {
        this.glyph?.update({ scopeLabel: this.getScopeLabel() });
        this.glyph?.root.classList.remove('is-expanded');
        this.updateScopeGlyphTooltip();
    }

    private updateScopeGlyphTooltip(): void {
        if (!this.glyphHit) return;
        this.glyphHit.classList.toggle('is-tooltip-only', this.state.scope === 'book');
        if (this.state.scope !== 'book') {
            this.glyphHit.removeAttribute('data-rt-tip');
            this.glyphHit.removeAttribute('data-rt-tip-placement');
            return;
        }
        const bookTitle = this.getActiveBookTitleForMessages() || this.getActiveBookLabel();
        const tooltipText = bookTitle?.trim();
        if (!tooltipText) {
            this.glyphHit.removeAttribute('data-rt-tip');
            this.glyphHit.removeAttribute('data-rt-tip-placement');
            return;
        }
        addTooltipData(this.glyphHit, balanceTooltipText(tooltipText), 'top');
    }

    private updateRings(): void {
        const glyphSeed = this.resolveGlyphSeed();
        const result = this.state.activeResult;
        const hasError = this.isErrorResult(result);
        const errorRing = hasError ? this.state.mode : null;
        // Alert-red the ring ONLY for genuine misconfiguration (not-configured /
        // no-scenes), never for a missing key — that's a calm Demo-Mode capability
        // limit, not an error. (No key is not an error; see resolveGuidanceState.)
        const ringAlert = this.guidanceState === 'not-configured' || this.guidanceState === 'no-scenes';
        const ringOverrideColor = ringAlert ? this.getInquiryAlertColor() : undefined;

        this.glyph?.update({
            scopeLabel: this.getScopeLabel(),
            flowValue: glyphSeed.flowValue,
            depthValue: glyphSeed.depthValue,
            flowVisualValue: glyphSeed.flowVisualValue,
            depthVisualValue: glyphSeed.depthVisualValue,
            errorRing,
            ringOverrideColor
        });
    }

    private updateFindingsIndicators(): void {
        const result = this.state.activeResult;
        if (this.rootSvg) {
            if (this.state.isRunning) {
                this.rootSvg.classList.remove('is-error');
            } else {
                this.rootSvg.classList.toggle('is-error', this.isErrorResult(result));
            }
        }
        this.updateMinimapFindingStates(result);
    }

    private isErrorResult(result: InquiryResult | null | undefined): boolean {
        return isInquiryResultError(result);
    }

    private isDegradedResult(result: InquiryResult | null | undefined): boolean {
        return isInquiryResultDegraded(result);
    }

    private hasBindableInquiryHits(result: InquiryResult): boolean {
        return this.buildFindingMap(result, this.getResultItems(result)).size > 0;
    }

    private shouldRejectUnboundHitResult(result: InquiryResult): boolean {
        if (this.isErrorResult(result)) return false;
        if (result.scope !== 'book') return false;
        if (!result.findings.some(finding => this.isFindingHit(finding))) return false;
        return !this.hasBindableInquiryHits(result);
    }

    private withCitationBindingFailure(result: InquiryResult): InquiryResult {
        const message = 'Inquiry completed its passes, but no finding could be matched to this corpus. No minimap findings were available.';
        return {
            ...result,
            aiStatus: 'rejected',
            aiReason: 'citation_binding_failed',
            summary: message,
            summaryFlow: message,
            summaryDepth: message,
            findings: [{
                refId: '',
                kind: 'error',
                headline: t('inquiry.runner.citationsCouldNotBeMatched'),
                bullets: [message],
                related: [],
                evidenceType: 'mixed',
                lens: 'both'
            }]
        };
    }

    private isErrorState(): boolean {
        return !this.state.isRunning && this.isErrorResult(this.state.activeResult);
    }

    private isResultsState(): boolean {
        return !this.state.isRunning && !!this.state.activeResult && !this.isErrorResult(this.state.activeResult);
    }

    private clearErrorStateForAction(): void {
        if (!this.isErrorState()) return;
        this.dismissError();
    }

    private notifyInteraction(message: string): void {
        new Notice(message);
    }

    private pulseZonePrompt(zone: InquiryZone, promptId: string): void {
        const elements = this.zonePromptElements.get(zone);
        if (elements) {
            elements.group.classList.add('is-duplicate-pulse');
        }
        if (this.glyph) {
            this.glyph.setPromptPulse(promptId, true);
        }
        if (this.duplicatePulseTimer) {
            window.clearTimeout(this.duplicatePulseTimer);
        }
        this.duplicatePulseTimer = window.setTimeout(() => {
            elements?.group.classList.remove('is-duplicate-pulse');
            this.glyph?.setPromptPulse(promptId, false);
            this.duplicatePulseTimer = undefined;
        }, DUPLICATE_PULSE_MS);
    }

    private pulseRehydrateButton(zone: InquiryZone): void {
        if (!this.artifactButton) return;
        this.activeSession.setActiveZone(zone);
        this.updateActiveZoneStyling();
        this.artifactButton.classList.add('is-rehydrate-pulse');
        if (this.rehydratePulseTimer) {
            window.clearTimeout(this.rehydratePulseTimer);
        }
        this.rehydratePulseTimer = window.setTimeout(() => {
            this.artifactButton?.classList.remove('is-rehydrate-pulse');
            this.rehydratePulseTimer = undefined;
        }, REHYDRATE_PULSE_MS);
    }

    private highlightRehydrateSession(sessionKey?: string): void {
        if (!sessionKey) return;
        this.rehydrateTargetKey = sessionKey;
        this.refreshBriefingPanel();
        if (this.rehydrateHighlightTimer) {
            window.clearTimeout(this.rehydrateHighlightTimer);
        }
        this.rehydrateHighlightTimer = window.setTimeout(() => {
            this.rehydrateTargetKey = undefined;
            this.refreshBriefingPanel();
            this.rehydrateHighlightTimer = undefined;
        }, REHYDRATE_HIGHLIGHT_MS);
    }

    private handleDuplicateRunFeedback(question: InquiryQuestion, sessionKey?: string): void {
        this.activeSession.setActiveZone(question.zone);
        this.updateActiveZoneStyling();
        this.pulseZonePrompt(question.zone, question.id);
        this.pulseRehydrateButton(question.zone);
        this.highlightRehydrateSession(sessionKey);
        this.notifyInteraction(t('inquiry.interaction.inquiryAlreadyRun'));
    }

    private showErrorPreview(result: InquiryResult): void {
        if (!this.previewGroup || !this.previewHero) return;
        if (this.previewHideTimer) {
            window.clearTimeout(this.previewHideTimer);
            this.previewHideTimer = undefined;
        }
        const zone = result.questionZone ?? this.findPromptZoneById(result.questionId) ?? 'setup'; // SAFE: legacy results predate zone metadata — setup is the default zone
        const hero = formatAuthorFacingErrorHero(result);
        const meta = formatAuthorFacingErrorDetail(result);
        const emptyRows = Array(this.previewRows.length || 6).fill(''); // SAFE: rows not built yet — render six placeholder rows
        this.previewLocked = true;
        this.previewGroup.classList.add('is-visible', 'is-error');
        this.previewGroup.classList.remove('is-locked', 'is-results');
        this.setPreviewRunningNoteText('');
        this.resetPreviewRowLabels();
        this.setPreviewFooterText(t('inquiry.preview.footerOpenLog'));
        this.updatePromptPreview(zone, this.state.mode, hero, emptyRows, meta, { hideEmpty: true });
        this.minimap.showErrorState(this.getStyleSource());
    }

    private updateMinimapFindingStates(result: InquiryResult | null | undefined): void {
        const resultItems = result ? this.getResultItems(result) : [];
        const findingMap = this.buildFindingMap(result, resultItems);
        this.minimap.updateFindingStates(
            this.state.isRunning,
            this.isErrorResult(result),
            findingMap,
            balanceTooltipText
        );
    }

    private updateArtifactPreview(): void {
        // No-op while findings panel is removed.
    }

    private updateFooterStatus(): void {
        // Legacy diagnostics removed from footer by design.
    }

    private setApiStatus(_state: 'idle' | 'running' | 'success' | 'error', _reason?: string): void {
        this.updateFooterStatus();
    }

    private updateNavigationIcons(): void {
        if (!this.navPrevButton || !this.navNextButton || !this.navPrevIcon || !this.navNextIcon) return;
        this.setIconUse(this.navPrevIcon, 'chevron-left');
        this.setIconUse(this.navNextIcon, 'chevron-right');

        const books = this.getNavigationBooks();
        const current = this.getNavigationBookIndex(books);
        const hasPrev = books.length > 1 && current > 0;
        const hasNext = books.length > 1 && current >= 0 && current < books.length - 1;
        const lockout = this.isInquiryGuidanceLockout();
        const running = this.state.isRunning;

        this.setIconButtonDisabled(this.navPrevButton, running || lockout || !hasPrev);
        this.setIconButtonDisabled(this.navNextButton, running || lockout || !hasNext);

        const prevBook = hasPrev ? books[current - 1] : undefined;
        const nextBook = hasNext ? books[current + 1] : undefined;
        const prevTooltip = prevBook
            ? `Previous book: ${this.getBookTitleForId(prevBook.id) || prevBook.displayLabel || 'Book'}` // SAFE: display fallback chain for the book tooltip label
            : t('inquiry.nav.noPreviousBook');
        const nextTooltip = nextBook
            ? `Next book: ${this.getBookTitleForId(nextBook.id) || nextBook.displayLabel || 'Book'}` // SAFE: display fallback chain for the book tooltip label
            : t('inquiry.nav.noNextBook');

        addTooltipData(this.navPrevButton, balanceTooltipText(prevTooltip), 'top');
        addTooltipData(this.navNextButton, balanceTooltipText(nextTooltip), 'top');
    }

    private updateNavSessionLabel(): void {
        if (!this.navSessionLabel) return;
        if (this.state.scope === 'book' && this.corpus && !this.corpus.bookResolved) {
            this.setTextIfChanged(this.navSessionLabel, t('inquiry.nav.bookUnresolved'), 'hudTextWrites');
            return;
        }
        if (this.state.isRunning) {
            this.setTextIfChanged(this.navSessionLabel, this.buildRunningStageLabel(this.currentRunProgress) || t('inquiry.nav.waitingForProvider'), 'hudTextWrites');
            return;
        }
        const sessionId = this.state.activeSessionId;
        if (!sessionId) {
            const glyphSeed = this.resolveGlyphSeed();
            if (glyphSeed.source === 'session' && glyphSeed.session) {
                this.setTextIfChanged(this.navSessionLabel, this.formatSessionNavLabel(glyphSeed.session), 'hudTextWrites');
                return;
            }
            this.setTextIfChanged(this.navSessionLabel, this.buildWelcomeNavLabel(), 'hudTextWrites');
            return;
        }
        const session = this.sessionStore.peekSession(sessionId);
        if (!session) {
            const glyphSeed = this.resolveGlyphSeed();
            if (glyphSeed.source === 'session' && glyphSeed.session) {
                this.setTextIfChanged(this.navSessionLabel, this.formatSessionNavLabel(glyphSeed.session), 'hudTextWrites');
                return;
            }
            this.setTextIfChanged(this.navSessionLabel, this.buildWelcomeNavLabel(), 'hudTextWrites');
            return;
        }
        this.setTextIfChanged(this.navSessionLabel, this.formatSessionNavLabel(session), 'hudTextWrites');
    }

    private formatSessionNavLabel(session: InquirySession): string {
        const timestamp = session.createdAt || session.lastAccessed;
        const date = new Date(timestamp);
        const formatted = date.toLocaleString(undefined, {
            month: 'short',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
            hour12: true
        });
        const timeStr = formatted.replace(/\s+(AM|PM)/i, (_, m) => m.toLowerCase());
        const zoneTag = this.buildSessionZoneTag(session);
        return zoneTag ? `ID: ${zoneTag} · ${timeStr}` : `ID: ${timeStr}`;
    }

    private buildSessionZoneTag(session: InquirySession): string | null {
        const questionId = session.result?.questionId;
        const zone = session.questionZone ?? session.result?.questionZone ?? (questionId ? this.findPromptZoneById(questionId) : null);
        return this.buildZoneTagForQuestion(questionId, zone);
    }

    private buildZoneTagForQuestion(questionId?: string | null, zone?: InquiryZone | null): string | null {
        const resolvedZone = zone ?? (questionId ? this.findPromptZoneById(questionId) : null);
        if (!resolvedZone) return null;
        const abbr = resolvedZone === 'setup' ? 'Set' : resolvedZone === 'pressure' ? 'Pres' : 'Pay';
        if (!questionId) return abbr;
        const config = this.getPromptConfig();
        const slots = config[resolvedZone] ?? []; // SAFE: zone may be absent from prompt config — no slot number appended
        const slotIndex = slots.findIndex(slot => slot.id === questionId);
        const num = slotIndex >= 0 ? slotIndex + 1 : null;
        return num !== null ? `${abbr}${num}` : abbr;
    }

    private resolveInquiryQuestionPrefix(options: {
        questionId?: string | null;
        questionZone?: InquiryZone | null;
        fallbackLabel?: string | null;
    }): string | null {
        const questionId = options.questionId?.trim();
        const zoneTag = this.buildZoneTagForQuestion(questionId, options.questionZone);
        const promptLabel = questionId ? this.findPromptLabelById(questionId)?.trim() : null;
        const label = promptLabel || questionId || options.fallbackLabel?.trim();
        if (!label && zoneTag) return zoneTag;
        if (!label) return null;
        return zoneTag ? `${zoneTag}: ${label}` : label;
    }

    private resolveInquiryQuestionPrefixForResult(result: InquiryResult): string | null {
        const zoneLabel = this.resolveInquiryBriefZoneLabel(result);
        const fallbackLabel = this.resolveInquiryBriefLensLabel(result, zoneLabel);
        return this.resolveInquiryQuestionPrefix({
            questionId: result.questionId,
            questionZone: result.questionZone ?? this.findPromptZoneById(result.questionId),
            fallbackLabel
        });
    }

    private buildWelcomeNavLabel(date: Date = new Date()): string {
        const weekday = date.toLocaleDateString(undefined, { weekday: 'long' });
        const month = date.toLocaleDateString(undefined, { month: 'long' });
        const day = String(date.getDate());
        const ordinal = getOrdinalSuffix(date.getDate());
        return t('inquiry.nav.welcome', { weekday, month, day, ordinal });
    }

    private updateRunningState(): void {
        if (!this.rootSvg) return;
        const isRunning = this.state.isRunning;
        const wasRunning = this.wasRunning;
        const runDisabled = this.isInquiryRunDisabled();
        this.wasRunning = isRunning;
        this.rootSvg.classList.toggle('is-running', isRunning);
        this.previewGroup?.classList.toggle('is-running', isRunning);
        // Demo Mode is browsable: keep zone clicks live even though running is
        // disabled, so clicking a zone opens its saved briefing.
        this.glyph?.setZoneInteractionsEnabled(!isRunning && (!runDisabled || this.isInquiryDemoMode()));
        const isError = this.rootSvg.classList.contains('is-error');
        const hasResult = !!this.state.activeResult && !isError;
        this.rootSvg.classList.toggle('is-results', !isRunning && hasResult);
        if (wasRunning && !isRunning) {
            (['setup', 'pressure', 'payoff'] as InquiryZone[]).forEach(zone => {
                this.glyph?.setZoneScaleLocked(zone, false);
            });
        }
        if (isRunning) {
            this.startRunningAnimations();
            this.updateMinimapPressureGauge();
        } else {
            this.stopRunningAnimations();
            if (wasRunning) {
                this.startBackboneFadeOut();
            }
            this.updateMinimapPressureGauge();
        }
        this.reconcileEngineTimerInterval();
        this.updateRunningHud();
        this.updateNavSessionLabel();
    }

    private reconcileEngineTimerInterval(hasCacheCountdown?: boolean): void {
        const cacheActive = typeof hasCacheCountdown === 'boolean'
            ? hasCacheCountdown
            : !!this.getActiveCacheWindowExpiry();
        const shouldRunTimer = this.state.isRunning || cacheActive;
        if (shouldRunTimer && !this.updateRunningClockInterval) {
            this.updateRunningClockInterval = window.setInterval(() => this.updateRunningHud(), 1000);
        } else if (!shouldRunTimer && this.updateRunningClockInterval) {
            window.clearInterval(this.updateRunningClockInterval);
            this.updateRunningClockInterval = undefined;
        }
    }

    private resolveGuidanceState(): InquiryGuidanceState {
        if (this.state.isRunning) return 'running';
        if (!this.isInquiryConfigured()) return 'not-configured';
        if (this.getInquirySceneCount() === 0) return 'no-scenes';
        // A displayed briefing is ALWAYS a results view — it must render
        // identically with or without a key. "No key" gates running a NEW
        // inquiry (a capability, via isInquiryApiKeyMissing()), never the
        // display of an existing one. So results wins over no-api-key here.
        if (this.isResultsState()) return 'results';
        // Configured + has scenes + no result shown + no key → read-only Demo
        // Mode (browse saved briefings), without the red misconfiguration alert.
        if (this.isInquiryApiKeyMissing()) return 'no-api-key';
        return 'ready';
    }

    /**
     * True when the active provider has no usable credential. The resolver
     * never throws — it returns a blocked DTO with hasCredential:false — so this
     * is a pure read. AI-disabled / unconfigured cases are caught upstream
     * (the view won't open) and by the earlier guidance branches.
     */
    private isInquiryApiKeyMissing(): boolean {
        return !this.getResolvedEngine().hasCredential;
    }

    /**
     * Demo Mode: a packaged vault being explored read-only — no usable key AND
     * saved briefings present to browse. Drives the honest "Demo Vault" copy.
     */
    private isInquiryDemoMode(): boolean {
        // Predicate-based (not the display-state label) so the honest "Demo
        // Vault" engine copy holds whether the empty prompt OR a saved briefing
        // is on screen.
        return this.isInquiryApiKeyMissing() && this.hasInquirySessions();
    }

    private getDemoVaultLabel(): string {
        return this.demoVaultName?.trim() || 'Demo Vault'; // SAFE: UX default — unnamed demo vault shows the generic label
    }

    private isInquiryConfigured(): boolean {
        const sources = this.normalizeInquirySources(this.settingsAccessor.getSources());
        const hasBooks = (this.plugin.settings.books || []).some(book => (book.sourceFolder || '').trim().length > 0); // SAFE: settings without books or sourceFolder count as not configured
        return hasBooks && (sources.classScope?.length ?? 0) > 0; // SAFE: missing classScope means no classes selected — not configured
    }

    private getInquirySceneCount(): number {
        if (!this.isInquiryConfigured()) return 0;
        const entryList = this.buildCorpusEntryList('scene-count', {
            includeInactive: true,
            applyOverrides: false
        });
        return entryList.entries.filter(entry => entry.class === 'scene').length;
    }

    private hasInquirySessions(): boolean {
        return this.sessionStore.getSessionCount() > 0;
    }

    private isInquiryRunDisabled(): boolean {
        // Run capability is independent of the DISPLAY state: a missing key
        // disables running even while a briefing is shown (state === 'results').
        return this.guidanceState === 'not-configured'
            || this.guidanceState === 'no-scenes'
            || this.isInquiryApiKeyMissing();
    }

    private isInquiryGuidanceLockout(): boolean {
        return this.guidanceState === 'no-scenes';
    }

    private isInquiryBlocked(): boolean {
        return this.guidanceState === 'not-configured';
    }

    private getInquiryAlertColor(): string {
        const styleSource = this.getStyleSource();
        if (!this.rootSvg) return getExecutionColorValue(styleSource, '--rt-ai-error', '#ff4d4d');
        const color = getComputedStyle(this.rootSvg).getPropertyValue('--ert-inquiry-alert').trim();
        return color || getExecutionColorValue(styleSource, '--rt-ai-error', '#ff4d4d');
    }

    private updateGuidance(): void {
        const state = this.guidanceState;
        const runDisabled = this.isInquiryRunDisabled();
        const blocked = this.isInquiryBlocked();
        const lockout = this.isInquiryGuidanceLockout();
        const running = this.state.isRunning;

        // Demo Mode is BROWSABLE: running is disabled, but the zones remain
        // clickable to open their saved briefings (and visible, not run-locked
        // faint). is-demo-browse marks the SVG so the zones desaturate rather
        // than dim. Run-lock (pointer-events off + faint) applies only when you
        // genuinely can't interact: actually running, or misconfigured.
        const browsable = this.isInquiryDemoMode();
        const runLocked = running || (runDisabled && !browsable);
        if (this.rootSvg) {
            // Red alert is reserved for genuine misconfiguration (not-configured /
            // no-scenes) — NOT the calm no-api-key read-only state, which disables
            // running but must never paint the ring red.
            this.rootSvg.classList.toggle('is-inquiry-blocked', blocked || lockout);
            this.rootSvg.classList.toggle('is-run-locked', runLocked);
            this.rootSvg.classList.toggle('is-demo-browse', browsable);
            this.rootSvg.classList.toggle('is-no-scenes', state === 'no-scenes');
            this.rootSvg.classList.toggle('is-guidance-lockout', lockout);
        }
        if (lockout || running) {
            this.setModeIconHoverState(false);
        }
        this.contentEl.classList.toggle('is-inquiry-blocked', blocked);
        this.contentEl.classList.toggle('is-guidance-lockout', lockout);

        this.zonePromptElements.forEach(({ group }) => {
            const disabled = runLocked;
            group.setAttribute('aria-disabled', disabled ? 'true' : 'false');
            group.setAttribute('tabindex', disabled ? '-1' : '0');
        });

        this.setIconButtonDisabled(this.apiSimulationButton, runDisabled || running);
        const singleBook = (this.corpus?.books ?? []).length <= 1; // SAFE: corpus not loaded yet — treat as single book and disable scope toggle
        this.setIconButtonDisabled(this.scopeToggleButton, lockout || running || singleBook);
        // The engine button opens AI settings, so keep it clickable during setup
        // (not-configured / no-scenes) — only mute it while a query is running.
        this.setIconButtonDisabled(this.engineBadgeGroup, running);
        this.setIconButtonDisabled(this.artifactButton, lockout || running);
        this.setIconButtonDisabled(this.detailsToggle, lockout || running);

        this.updateBriefingFooterActionStates();
        if (lockout || running) {
            this.briefingPopover?.hide(true);
            this.enginePopover?.hide(true);
        }

        this.updateGuidanceText(state);
        this.updateGuidanceHelpTooltip(state);
        this.updateNavigationIcons();
    }

    private updateGuidanceText(state: InquiryGuidanceState): void {
        if (!this.hoverTextEl) return;
        if (state === 'running') {
            this.hoverTextEl.classList.add('ert-hidden');
            this.hoverTextEl.classList.remove('is-guidance', 'is-guidance-alert', 'is-guidance-results');
            clearSvgChildren(this.hoverTextEl);
            return;
        }

        if (state === 'no-api-key') {
            // Calm read-only message — uses `is-guidance` (text-normal fill), not
            // `is-guidance-alert` (red). No reopen needed: cleared live when a key
            // is added via onAiSettingsChanged().
            this.hoverTextEl.classList.remove('ert-hidden');
            this.hoverTextEl.classList.toggle('is-guidance', true);
            this.hoverTextEl.classList.toggle('is-guidance-alert', false);
            this.hoverTextEl.classList.toggle('is-guidance-results', false);
            this.hoverTextEl.setAttribute('x', '0');
            this.hoverTextEl.setAttribute('y', String(GUIDANCE_TEXT_Y));
            this.hoverTextEl.setAttribute('text-anchor', 'middle');
            this.setGuidanceTextLines(
                this.isInquiryDemoMode()
                    ? [`Demo Vault — ${this.getDemoVaultLabel()}`, 'Select a Briefing to begin.']
                    : [t('inquiry.preview.noApiKeyHero'), t('inquiry.preview.noApiKeyHelp')],
                GUIDANCE_LINE_HEIGHT
            );
            return;
        }

        const isNoScenes = state === 'no-scenes';
        const isAlert = state === 'not-configured' || isNoScenes;
        if (!isAlert) {
            this.hoverTextEl.classList.add('ert-hidden');
            this.hoverTextEl.classList.remove('is-guidance', 'is-guidance-alert', 'is-guidance-results');
            clearSvgChildren(this.hoverTextEl);
            return;
        }

        const guidanceLines = state === 'not-configured'
            ? [t('inquiry.preview.inquiryNotConfiguredHero'), t('inquiry.preview.inquiryNotConfiguredHelp')]
            : ['No Scenes Found', 'Check scan roots and class scope in Settings → Radial Timeline → Inquiry.'];
        const lineHeight = isAlert
            ? (isNoScenes ? GUIDANCE_ALERT_LINE_HEIGHT + 14 : GUIDANCE_ALERT_LINE_HEIGHT)
            : GUIDANCE_LINE_HEIGHT;

        this.hoverTextEl.classList.remove('ert-hidden');
        this.hoverTextEl.classList.toggle('is-guidance', true);
        this.hoverTextEl.classList.toggle('is-guidance-alert', isAlert);
        this.hoverTextEl.classList.toggle('is-guidance-results', false);
        this.hoverTextEl.setAttribute('x', '0');
        this.hoverTextEl.setAttribute('y', String(GUIDANCE_TEXT_Y));
        this.hoverTextEl.setAttribute('text-anchor', 'middle');
        this.setGuidanceTextLines(
            guidanceLines,
            lineHeight,
            isNoScenes
                ? { primaryClass: 'ert-inquiry-guidance-primary', primarySize: 40, primaryWeight: 800 }
                : undefined
        );
    }

    private setGuidanceTextLines(
        lines: string[],
        lineHeight: number,
        options?: { primaryClass?: string; primarySize?: number; primaryWeight?: number }
    ): void {
        const hoverTextEl = this.hoverTextEl;
        if (!hoverTextEl) return;
        clearSvgChildren(hoverTextEl);
        const x = hoverTextEl.getAttribute('x') ?? '0'; // SAFE: text element without an x attribute anchors tspans at 0
        const primaryClass = options?.primaryClass;
        const primarySize = options?.primarySize;
        const primaryWeight = options?.primaryWeight;
        lines.forEach((line, index) => {
            const tspan = createSvgElement('tspan');
            tspan.setAttribute('x', x);
            tspan.setAttribute('dy', index === 0 ? '0' : String(lineHeight));
            if (index === 0 && primaryClass) {
                tspan.classList.add(primaryClass);
                if (primarySize) {
                    tspan.setAttribute('font-size', String(primarySize));
                }
                if (primaryWeight) {
                    tspan.setAttribute('font-weight', String(primaryWeight));
                }
            }
            tspan.textContent = line;
            hoverTextEl.appendChild(tspan);
        });
    }

    private updateGuidanceHelpTooltip(state: InquiryGuidanceState): void {
        if (!this.helpToggleButton) return;
        const hasSessions = this.hasInquirySessions();
        const corpusAlert = this.corpusWarningActive && this.isCorpusEmpty();
        const isAlert = state === 'not-configured' || state === 'no-scenes' || corpusAlert;
        const isResults = state === 'results';
        const isRunning = state === 'running';
        const tooltip = isRunning
            ? (this.activeInquiryRunToken
                ? t('inquiry.help.runningSingleTooltip')
                : t('inquiry.help.runningTooltip'))
            : (corpusAlert
                ? t('inquiry.help.corpusTooltip')
                : (state === 'no-api-key'
                    ? (this.isInquiryDemoMode()
                        ? 'Demo Vault Active. Select a Briefing to begin.'
                        : t('inquiry.help.noApiKeyTooltip'))
                    : (isAlert
                        ? (state === 'not-configured' ? t('inquiry.help.configTooltip') : t('inquiry.help.noScenesTooltip'))
                        : (isResults ? t('inquiry.help.resultsTooltip') : (hasSessions ? t('inquiry.help.tooltip') : t('inquiry.help.onboardingTooltip'))))));
        const balancedTooltip = balanceTooltipText(tooltip);

        this.helpToggleButton.removeAttribute('aria-pressed');
        this.helpToggleButton.setAttribute('aria-disabled', isRunning ? 'true' : 'false');
        this.helpToggleButton.classList.toggle('is-help-onboarding', !hasSessions && !isAlert && !isResults);
        this.helpToggleButton.classList.toggle('is-help-results', isResults && !corpusAlert);
        this.helpToggleButton.classList.toggle('is-guidance-alert', isAlert);
        addTooltipData(this.helpToggleButton, balancedTooltip, 'left');
    }

    private handleGuidanceHelpClick(): void {
        const state = this.resolveGuidanceState();
        this.guidanceState = state;
        if (state === 'running') {
            return;
        }
        if (state === 'not-configured') {
            this.openInquirySettings('sources');
            return;
        }
        if (state === 'no-scenes') {
            this.openInquirySettings('sources');
            return;
        }
        window.open(INQUIRY_GUIDANCE_DOC_URL, '_blank');
    }

    private openInquirySettings(
        focus: 'overview' | 'sources' | 'class-scope' | 'scan-roots' | 'class-presets'
    ): void {
        if (this.plugin.settingsTab) {
            this.plugin.settingsTab.setActiveTab('inquiry');
        }
        // SAFE: any type used for accessing Obsidian's internal settings API
        const setting = (this.app as unknown as { setting?: { open: () => void; openTabById: (id: string) => void } }).setting;
        if (setting) {
            setting.open();
            setting.openTabById('radial-timeline');
        }
        window.setTimeout(() => {
            if (focus === 'overview') {
                return;
            }
            if (focus === 'sources') {
                this.scrollInquirySetting('sources-heading');
                return;
            }
            this.scrollInquirySetting(focus);
        }, 160);
    }

    private scrollInquirySetting(target: 'sources-heading' | 'class-scope' | 'scan-roots' | 'class-presets'): void {
        const el = activeDocument.querySelector(`[data-ert-role="inquiry-setting:${target}"]`);
        if (!(el instanceof HTMLElement)) return;
        el.scrollIntoView({ block: 'start' });
    }

    private startRunningAnimations(): void {
        const styleSource: Element = this.contentEl ?? this.rootSvg ?? activeDocument.documentElement;
        const isPro = hasProFeatureAccess(this.plugin);
        this.minimap.startRunningAnimations(
            styleSource,
            isPro,
            () => this.state.isRunning,
            (elapsedMs) => this.updateRunningHudFrame(elapsedMs)
        );
    }

    private stopRunningAnimations(): void {
        this.minimap.stopRunningAnimations();
        this.updateRunningHud();
    }

    private startBackboneFadeOut(): void {
        this.minimap.startFadeOut();
    }

    private cancelBackboneFadeOut(): void {
        this.minimap.cancelFadeOut();
    }

    private handleScopeChange(scope: InquiryScope): void {
        this.clearErrorStateForAction();
        if (!scope || scope === this.state.scope) return;
        this.state.scope = scope;
        if (scope === 'saga' && this.state.targetSceneIds.length) {
            this.notifyInteraction(t('inquiry.interaction.targetScenesBookOnlySaga'));
        }
        if (this.state.activeResult) {
            this.clearActiveResultState();
            this.unlockPromptPreview();
            this.setApiStatus('idle');
        }
        this.refreshUI();
    }

    private setActiveLens(mode: InquiryLens): void {
        if (!mode || mode === this.state.mode) return;
        // Lens is UI emphasis only; inquiry computation must always include flow + depth.
        // Atomic state → settings → save triple lives in the controller.
        this.selection.setActiveLens(mode);
        this.updateModeClass();
        this.updateRings();
        if (this.isResultsState() && this.state.activeResult) {
            this.showResultsPreview(this.state.activeResult);
            // Sync findings panel summary to match the preview hero lens.
            if (this.summaryEl) {
                this.summaryEl.textContent = this.buildResultsHeroText(this.state.activeResult, mode);
            }
        }
        if (!this.previewLocked && this.previewGroup?.classList.contains('is-visible') && this.previewLast) {
            this.updatePromptPreview(
                this.previewLast.zone,
                mode,
                this.previewLast.question,
                this.getPreviewPayloadRows(this.previewLast.zone, this.previewLast.questionId),
                undefined,
                { hideEmpty: true }
            );
        }
    }

    private handleRingClick(mode: InquiryLens): void {
        if (this.isInquiryGuidanceLockout()) return;
        this.clearErrorStateForAction();
        if (this.state.isRunning) {
            this.notifyInteraction(t('inquiry.interaction.running'));
            return;
        }
        if (mode === this.state.mode) {
            if (this.isResultsState() && this.state.activeResult) {
                this.showResultsPreview(this.state.activeResult);
            }
            this.notifyInteraction(t('inquiry.interaction.lensAlreadyActive', { lens: mode === 'flow' ? 'Flow' : 'Depth' }));
            return;
        }
        this.setActiveLens(mode);
    }

    private handleModeIconToggleClick(): void {
        if (this.state.activeResult && !this.hasDistinctLensSummaries(this.state.activeResult)) {
            this.notifyInteraction(t('inquiry.interaction.onlyOneSummaryLens'));
            return;
        }
        const nextMode: InquiryLens = this.state.mode === 'flow' ? 'depth' : 'flow';
        this.handleRingClick(nextMode);
    }

    private hasDistinctLensSummaries(result: InquiryResult): boolean {
        const flow = this.getResultSummaryForMode(result, 'flow');
        const depth = this.getResultSummaryForMode(result, 'depth');
        return flow !== depth && !!flow && !!depth;
    }

    private buildModeToggleHoverText(): string {
        const nextMode = this.state.mode === 'flow' ? 'Depth' : 'Flow';
        return `Switch to ${nextMode} lens.`;
    }

    private handleGlyphClick(): void {
        if (this.isInquiryGuidanceLockout()) return;
        this.clearErrorStateForAction();
        if (this.state.isRunning) {
            this.notifyInteraction(t('inquiry.interaction.running'));
            return;
        }
        if (this.state.scope === 'saga') {
            this.state.scope = 'book';
            this.refreshUI();
            return;
        }
    }

    private beginInquiryRunToken(): number {
        const token = ++this.inquiryRunTokenCounter;
        this.activeInquiryRunToken = token;
        this.cancelledInquiryRunTokens.delete(token);
        return token;
    }

    private finishInquiryRunToken(token: number): void {
        this.cancelledInquiryRunTokens.delete(token);
        if (this.activeInquiryRunToken === token) {
            this.activeInquiryRunToken = 0;
        }
    }

    private shouldDiscardInquiryRunOutcome(token: number): boolean {
        if (!token) return false;
        if (this.cancelledInquiryRunTokens.has(token)) return true;
        return this.activeInquiryRunToken !== token;
    }

    private requestActiveInquiryCancellation(): void {
        if (!this.state.isRunning) return;
        const token = this.activeInquiryRunToken;
        if (!token) {
            this.notifyInteraction(t('inquiry.interaction.cannotCancelFromPreview'));
            return;
        }
        this.cancelledInquiryRunTokens.add(token);
        if (this.activeInquiryRunToken === token) {
            this.activeInquiryRunToken = 0;
        }
        this.state.isRunning = false;
        this.currentRunProgress = null;
        this.pendingGuardQuestion = undefined;
        this.unlockPromptPreview();
        this.setApiStatus('idle');
        this.refreshUI({ skipCorpus: true });
        this.notifyInteraction(t('inquiry.interaction.cancelRequested'));
    }

    private async openInquiryErrorLog(): Promise<void> {
        const opened = await this.openLatestInquiryLogForContext();
        if (!opened) {
            new Notice(t('inquiry.notice.logNotFound'));
        }
    }

    private async handleQuestionClick(
        question: InquiryQuestion,
        options?: { promptOverride?: InquiryQuestionPromptForm; forceRerun?: boolean }
    ): Promise<void> {
        if (!options?.forceRerun && this.isErrorState() && this.state.activeResult?.questionId === question.id) {
            await this.openInquiryErrorLog();
            return;
        }
        await this.runInquiry(question, options);
    }

    /**
     * Latest non-error saved session for a question in the current scope, matched
     * by question id. Model-agnostic — used when there's no key to key on (the
     * exact session key includes the model, which is empty without a credential).
     */
    private findSavedSessionForQuestion(question: InquiryQuestion): InquirySession | undefined {
        const scope = this.state.scope;
        return this.sessionStore
            .getRecentSessions(this.sessionStore.getSessionCount())
            .find(s => !this.isErrorResult(s.result)
                && s.result.questionId === question.id
                && (s.scope ?? s.result.scope) === scope);
    }

    private async runInquiry(
        question: InquiryQuestion,
        options?: { bypassTokenGuard?: boolean; promptOverride?: InquiryQuestionPromptForm; forceRerun?: boolean }
    ): Promise<void> {
        if (this.isInquiryApiKeyMissing()) {
            // No key → no run. Open THIS question's saved briefing if it has one;
            // otherwise point to the saved briefings (demo) or explain.
            const saved = this.findSavedSessionForQuestion(question);
            if (saved && this.reopenSessionByKey(saved.key)) return;
            if (this.isInquiryDemoMode()) {
                this.briefingPopover.show();
                return;
            }
            this.notifyInteraction(t('inquiry.interaction.noApiKey'));
            return;
        }
        if (this.isInquiryRunDisabled()) return;
        if (this.state.isRunning) {
            this.notifyInteraction(t('inquiry.interaction.running'));
            return;
        }
        if (this.state.scope === 'book' && this.corpus && !this.corpus.bookResolved) {
            this.notifyInteraction(t('inquiry.interaction.bookScopeUnresolved'));
            return;
        }
        this.clearErrorStateForAction();
        this.activeSession.setActiveZone(question.zone);
        this.updateActiveZoneStyling();

        const scopeLabel = this.getScopeLabel();
        const scopeKey = this.getScopeKey();
        const targetSceneIds = this.getActiveTargetSceneIds();
        const selectionMode = this.getSelectionMode(targetSceneIds);
        const effectiveOverride = options?.promptOverride ?? this.getEffectivePromptOverride(question.id);
        const questionText = this.resolveQuestionPromptForRun(question, selectionMode, effectiveOverride);
        const questionPromptForm = this.resolveQuestionPromptFormForRun(question, selectionMode, effectiveOverride);
        const questionSignature = this.buildQuestionSignature(questionText);
        const activeBookId = this.state.scope === 'saga' ? this.state.activeBookId : this.state.activeBookId;

        const engineSelection = this.resolveEngineSelectionForRun();
        let manifest = this.buildCorpusManifest(question.id, {
            modelId: engineSelection.modelId,
            questionZone: question.zone
        });
        if (!manifest.entries.length) {
            this.handleEmptyCorpusRun();
            return;
        }
        // Ensure scene files have canonical IDs before running.
        // Migration only runs at startup, so scenes added later may lack IDs.
        const scenesWithoutIds = manifest.entries.filter(entry => entry.class === 'scene' && !entry.sceneId);
        if (scenesWithoutIds.length > 0) {
            const migrated = await migrateSceneFrontmatterIds(this.plugin);
            if (migrated > 0) {
                // Rebuild manifest to pick up newly assigned IDs from the metadata cache.
                manifest = this.buildCorpusManifest(question.id, {
                    modelId: engineSelection.modelId,
                    questionZone: question.zone
                });
            }
        }
        const baseKey = this.sessionStore.buildBaseKey({
            questionId: question.id,
            questionPromptForm,
            questionSignature,
            scope: this.state.scope,
            scopeKey,
            targetSceneIds
        });
        // A normal run dedupes to one session per question+corpus (overwrites
        // in place). A force-rerun gets a unique key so it APPENDS a distinct
        // history entry instead of purging the prior run; `baseKey` (stored on
        // the session) still groups all runs of this question together.
        const canonicalKey = this.sessionStore.buildKey(baseKey, manifest.fingerprint);
        const key = options?.forceRerun
            ? `${canonicalKey}::rerun-${Date.now()}`
            : canonicalKey;
        let cacheStatus: 'fresh' | 'stale' | 'missing' = 'missing';

        if (!options?.forceRerun) {
            if (this.state.activeSessionId === key && this.state.activeResult && !this.isErrorResult(this.state.activeResult)) {
                this.handleDuplicateRunFeedback(question, key);
                this.showResultsPreview(this.state.activeResult);
                return;
            }
            let cachedSession: InquirySession | undefined;
            const cached = this.sessionStore.getSession(key);
            if (cached) {
                cachedSession = cached;
                cacheStatus = 'fresh';
            }
            if (!cachedSession) {
                const prior = this.sessionStore.getLatestByBaseKey(baseKey);
                if (prior) {
                    const priorCorpusOnly = prior.result.corpusOnlyFingerprint;
                    const corpusChanged = !!priorCorpusOnly && priorCorpusOnly !== manifest.corpusOnlyFingerprint;
                    if (corpusChanged) {
                        cacheStatus = 'stale';
                        this.sessionStore.markStaleByBaseKey(baseKey);
                    }
                }
            }
            if (cachedSession && this.isErrorResult(cachedSession.result)) {
                cachedSession = undefined;
                cacheStatus = 'missing';
            }
            if (cachedSession) {
                this.activeSession.setCacheStatus(cacheStatus);
                this.handleDuplicateRunFeedback(question, cachedSession.key);
                this.activateSession(cachedSession);
                return;
            }
        }

        if (!options?.bypassTokenGuard) {
            const readinessUi = this.buildReadinessUiState();
            if (readinessUi.readiness.state === 'blocked') {
                this.pendingGuardQuestion = question;
                this.enginePopover.show();
                return;
            }
        }

        this.clearActiveResultState();
        this.currentRunProgress = null;
        this.currentRunElapsedMs = 0;
        const durationRange = this.estimateRunDurationRange(questionText);
        // Use midpoint of the range so the bar is optimistic — better to finish than stall.
        this.currentRunEstimatedMaxMs = durationRange
            ? ((durationRange.minSeconds + durationRange.maxSeconds) / 2) * 1000
            : 0;
        this.activeSession.setActiveQuestionId(question.id);
        this.activeSession.setActiveZone(question.zone);
        this.lockPromptPreview(question, questionText);
        this.activeSession.setCacheStatus(cacheStatus);

        const startTime = Date.now();
        this.state.isRunning = true;
        // Plugin-level marker: survives this view being closed mid-run so a
        // reopened view can observe the in-flight run and pick up its
        // persisted result. Cleared in this method's finally (keyed by `key`
        // so a newer run's marker is never clobbered by a stale finally).
        this.plugin._inquiryRunInFlight = { sessionKey: key, question: questionText, startedAt: startTime };
        this.setApiStatus('running');
        this.refreshUI({ skipCorpus: true });
        let result: InquiryResult;
        let runTrace: InquiryRunTrace | null = null;
        new Notice(t('inquiry.runner.contactingProvider'));
        const submittedAt = new Date();
        const simulationProvider: Exclude<AIProviderId, 'none'> = engineSelection.provider === 'none'
            ? 'openai'
            : engineSelection.provider;
        const runnerInput: InquiryRunnerInput = {
            scope: this.state.scope,
            scopeLabel,
            targetSceneIds,
            selectionMode,
            activeBookId: this.state.scope === 'saga' ? this.state.activeBookId : this.state.activeBookId,
            mode: this.state.mode,
            questionId: question.id,
            questionText,
            questionPromptForm,
            questionZone: question.zone,
            corpus: manifest,
            rules: this.getEvidenceRules(),
            ai: {
                provider: simulationProvider,
                modelId: engineSelection.modelId,
                modelLabel: engineSelection.modelLabel
            },
            citationsEnabled: this.areInquiryProviderCitationsEnabled(simulationProvider)
        };
        const runToken = this.beginInquiryRunToken();
        try {
            try {
                // Lens selection is UI-only; do not vary question, evidence, or verdict structure by lens.
                // Each inquiry produces two compressed answers (flow + depth). Keep this dual-answer model intact.
                const runOutput = await this.runner.runWithTrace(runnerInput, {
                    onProgress: progress => this.updateRunProgress(progress),
                    shouldAbort: () => this.shouldDiscardInquiryRunOutcome(runToken),
                    forceFreshRun: !!options?.forceRerun
                });
                result = runOutput.result;
                runTrace = runOutput.trace;
                const progressState = this.currentRunProgress as InquiryRunProgressEvent | null;
                const progressPassCount = progressState?.totalPasses;
                const finalPassCount = Math.max(1, runOutput.trace.executionPassCount ?? progressPassCount ?? 1); // SAFE: trace and progress may omit pass counts — a run has at least one pass
                this.updateRunProgress({
                    phase: 'finalizing',
                    currentPass: finalPassCount,
                    totalPasses: finalPassCount,
                    detail: 'Provider response received. Saving the result.'
                });
            } catch (error) {
                result = this.buildErrorFallback(question, questionText, questionPromptForm, scopeLabel, manifest, error);
                const message = error instanceof Error ? error.message : String(error);
                runTrace = await this.buildFallbackTrace(runnerInput, `Runner exception: ${message}`);
            }
            if (this.shouldDiscardInquiryRunOutcome(runToken)) {
                return;
            }
            const completedAt = new Date();
            result.submittedAt = submittedAt.toISOString();
            result.completedAt = completedAt.toISOString();
            result.roundTripMs = completedAt.getTime() - submittedAt.getTime();
            this.applyTokenEstimateFromTrace(result, runTrace);
            result.aiModelNextRunOnly = false; // Legacy field — always false.
            result = this.applyCorpusOverrideSummary(result);
            const rawResult = result;
            result = this.normalizeLegacyResult(result);
            const normalizationNotes = this.collectNormalizationNotes(rawResult, result);
            result = this.applyExecutionObservabilityFromTrace(result, runTrace);
            this.appendAnthropicDispatchTraceNote(result, runTrace);
            void this.recordInquiryTimingSample(result, runTrace);
            if (this.shouldRejectUnboundHitResult(result)) {
                runTrace?.notes.push('Inquiry result rejected after execution: no finding could be matched to the active corpus.');
                result = this.withCitationBindingFailure(result);
            }

            if (!this.isErrorResult(result)) {
                cacheStatus = 'fresh';
            } else {
                cacheStatus = 'missing';
            }

            let session: InquirySession = {
                key,
                baseKey,
                result,
                createdAt: Date.now(),
                lastAccessed: Date.now(),
                status: this.resolveSessionStatusFromResult(result),
                activeBookId,
                targetSceneIds,
                scope: this.state.scope,
                questionZone: question.zone
            };
            session.cacheReuseFingerprint = manifest.cacheReuseFingerprint;
            const cacheWindowExpiresAt = this.resolveCacheWindowExpiry(result, runTrace);
            if (cacheWindowExpiresAt) {
                session.cacheWindowExpiresAt = cacheWindowExpiresAt;
            }
            session.cacheReuseState = runTrace?.cacheReuseState;
            session.providerCacheStatus = runTrace?.cacheStatus;
            const observedCacheMetrics = this.getObservedCacheMetrics(runTrace);
            session.cachedStableRatio = observedCacheMetrics
                ? observedCacheMetrics.cachedStableRatio
                : (typeof runTrace?.cachedStableRatio === 'number' && Number.isFinite(runTrace.cachedStableRatio)
                    ? Math.min(1, Math.max(0, runTrace.cachedStableRatio))
                    : undefined);
            session.cachedStableTokens = observedCacheMetrics
                ? observedCacheMetrics.cachedStableTokens
                : (typeof runTrace?.cachedStableTokens === 'number' && Number.isFinite(runTrace.cachedStableTokens)
                    ? Math.max(0, Math.floor(runTrace.cachedStableTokens))
                    : undefined);
            session.totalInputTokens = observedCacheMetrics
                ? observedCacheMetrics.totalInputTokens
                : (typeof runTrace?.usage?.inputTokens === 'number' && Number.isFinite(runTrace.usage.inputTokens)
                    ? Math.max(0, Math.floor(runTrace.usage.inputTokens))
                    : (typeof result.tokenEstimateInput === 'number' && Number.isFinite(result.tokenEstimateInput)
                        ? Math.max(0, Math.floor(result.tokenEstimateInput))
                        : undefined));
            session.pendingEditsEmpty = this.resolvePendingEditsEmpty(result, activeBookId);
            this.sessionStore.setSession(session);
            const traceForLog = runTrace
                ?? await this.buildFallbackTrace(runnerInput, 'Trace unavailable; log created without prompt capture.');
            await this.saveInquiryLog(result, traceForLog, manifest, {
                sessionKey: session.key,
                normalizationNotes,
                silent: false
            });
            if (this.shouldDiscardInquiryRunOutcome(runToken)) {
                return;
            }
            session = this.sessionStore.peekSession(session.key) ?? session;

            const rawResponse = runTrace?.response?.content ?? null;
            const hasRawResponse = typeof rawResponse === 'string' && rawResponse.trim().length > 0;
            const isError = this.isErrorResult(result);
            const shouldSaveBrief = session.status !== 'simulated'
                && session.status !== 'saved'
                && !session.briefPath;
            if (shouldSaveBrief) {
                await this.saveBrief(result, {
                    openFile: false,
                    silent: false,
                    sessionKey: session.key,
                    rawResponse: isError && hasRawResponse ? rawResponse : undefined,
                    statusOverride: isError
                        ? this.resolveSessionStatusFromResult(result)
                        : undefined
                });
                session = this.sessionStore.peekSession(session.key) ?? session;
            }

            const elapsed = Date.now() - startTime;
            if (elapsed < MIN_PROCESSING_MS) {
                await new Promise(resolve => window.setTimeout(resolve, MIN_PROCESSING_MS - elapsed));
            }

            if (this.shouldDiscardInquiryRunOutcome(runToken)) {
                return;
            }

            this.applySession({
                result,
                key: session.key,
                activeBookId: session.activeBookId,
                targetSceneIds: session.targetSceneIds,
                scope: session.scope,
                questionZone: session.questionZone
            }, cacheStatus);
            if (this.isErrorResult(result)) {
                this.setApiStatus('error', formatApiErrorReason(result));
            } else {
                this.setApiStatus('success');
            }
            if (this.shouldAutoPopulatePendingEdits()) {
                void this.writeInquiryPendingEdits(session, result);
            }
        } finally {
            this.currentRunProgress = null;
            this.currentRunElapsedMs = 0;
            this.currentRunEstimatedMaxMs = 0;
            this.finishInquiryRunToken(runToken);
            // Clear only if this run still owns the marker — a newer run
            // (or an already-recovered reopen) must not be cleared by this
            // possibly-orphaned instance's finally.
            if (this.plugin._inquiryRunInFlight?.sessionKey === key) {
                this.plugin._inquiryRunInFlight = null;
            }
        }
    }

    public reopenSessionByKey(sessionKey: string): boolean {
        if (!sessionKey || this.state.isRunning || this.isInquiryBlocked()) return false;
        const session = this.sessionStore.peekSession(sessionKey);
        if (!session) return false;
        this.activateSession(session);
        return true;
    }

    public async runOmnibusPass(): Promise<void> {
        if (Platform.isMobile) { // SAFE: Platform imported from obsidian at top of file
            new Notice(t('inquiry.notice.omnibusMobileOnly'));
            return;
        }

        this.refreshCorpus();
        this.guidanceState = this.resolveGuidanceState();

        const questions = this.getOmnibusQuestions();
        const providerPlan = this.buildOmnibusProviderPlan();
        const runDisabledReason = this.getOmnibusRunDisabledReason(questions, providerPlan);

        const priorProgress = this.settingsAccessor.getOmnibusProgress();
        const resumeCheck = priorProgress
            ? this.checkOmnibusResumeEligibility(priorProgress, questions, providerPlan)
            : { available: false };

        // Piggyback signals for the plan modal: a still-open provider cache
        // window from a recent run (manual or omnibus) of the same engine +
        // corpus, and any questions that engine already answered on the
        // byte-identical corpus (suggested skips).
        const warmCacheExpiresAt = this.getActiveCacheWindowExpiry() ?? undefined;
        const recentResults = providerPlan.choice
            ? this.buildOmnibusRecentResults(questions, providerPlan.choice)
            : undefined;

        const plan = await this.promptOmnibusPlan({
            initialScope: this.state.scope,
            bookLabel: this.getActiveBookLabel(),
            bookTitle: this.getActiveBookTitleForMessages() ?? undefined,
            questions,
            providerSummary: providerPlan.summary,
            providerLabel: providerPlan.label,
            logsEnabled: this.plugin.settings.logApiInteractions ?? true, // SAFE: unset logging setting defaults to logging on
            runDisabledReason,
            priorProgress: priorProgress ?? undefined,
            resumeAvailable: resumeCheck.available,
            resumeUnavailableReason: resumeCheck.reason,
            costRange: this.buildOmnibusCostRangePlan(questions.length, providerPlan, !!warmCacheExpiresAt),
            recentResults,
            warmCacheExpiresAt
        });
        if (!plan) return;

        if (this.state.isRunning) {
            new Notice(t('inquiry.notice.running'));
            return;
        }

        if (plan.scope !== this.state.scope) {
            this.handleScopeChange(plan.scope);
        } else {
            this.refreshCorpus();
        }
        this.guidanceState = this.resolveGuidanceState();
        if (this.isInquiryRunDisabled()) {
            const message = this.isInquiryBlocked()
                ? t('inquiry.runner.inquiryNotConfigured')
                : t('inquiry.runner.noScenesAvailable');
            new Notice(message);
            return;
        }

        let nextQuestions = this.getOmnibusQuestions();
        if (!nextQuestions.length) {
            new Notice(t('inquiry.notice.noEnabledQuestions'));
            return;
        }

        // Filter to remaining questions if resuming
        if (plan.resume && priorProgress) {
            const completed = new Set(priorProgress.completedQuestionIds);
            nextQuestions = nextQuestions.filter(q => !completed.has(q.id));
            if (!nextQuestions.length) {
                new Notice(t('inquiry.notice.omnibusResumeNothing'));
                return;
            }
        } else {
            // Fresh run: clear any prior progress
            this.clearOmnibusProgress();
        }

        // Drop questions the author chose to skip in the plan modal (already
        // answered by this engine on the identical corpus).
        const excludedIds = new Set(plan.excludedQuestionIds ?? []); // SAFE: a plan with no exclusion list excludes nothing
        if (excludedIds.size) {
            nextQuestions = nextQuestions.filter(q => !excludedIds.has(q.id));
            if (!nextQuestions.length) {
                new Notice(t('inquiry.notice.omnibusAllSkipped'));
                return;
            }
        }

        const nextProviderPlan = this.buildOmnibusProviderPlan();
        if (!nextProviderPlan.choice) {
            const reason = nextProviderPlan.disabledReason || 'Provider unavailable'; // SAFE: UX default when the provider plan carries no specific reason
            new Notice(t('inquiry.notice.omnibusUnavailable', { reason }));
            return;
        }

        this.omnibusAbortRequested = false;
        const allQuestions = this.getOmnibusQuestions();
        // Skipped questions leave the progress denominator too — "question 3
        // of 22", not "of 27", when 5 rows were set to skip in the plan modal.
        const plannedTotal = allQuestions.filter(q => !excludedIds.has(q.id)).length;
        const providerChoice = nextProviderPlan.choice;
        try {
            if (!providerChoice.useOmnibus) {
                await this.runOmnibusSequential(nextQuestions, providerChoice, plan.createIndex, plannedTotal);
                return;
            }
            await this.runOmnibusCombined(nextQuestions, providerChoice, plan.createIndex, plannedTotal);
        } finally {
            this.activeOmnibusModal = undefined;
        }
    }

    private async runOmnibusCombined(
        questions: InquiryQuestion[],
        providerChoice: OmnibusProviderChoice,
        createIndex: boolean,
        totalForProgress?: number
    ): Promise<void> {
        const total = totalForProgress ?? questions.length;
        const scopeLabel = this.getScopeLabel();
        const scopeKey = this.getScopeKey();
        const targetSceneIds = this.getActiveTargetSceneIds();
        const selectionMode = this.getSelectionMode(targetSceneIds);
        const activeBookId = this.state.activeBookId ?? this.corpus?.books?.[0]?.id;
        const contextRequired = this.isContextRequiredForQuestions(questions);
        let manifest = this.buildCorpusManifest('omnibus', {
            modelId: providerChoice.modelId,
            contextRequired
        });
        if (!manifest.entries.length) {
            this.handleEmptyCorpusRun();
            return;
        }
        const scenesWithoutIds = manifest.entries.filter(entry => entry.class === 'scene' && !entry.sceneId);
        if (scenesWithoutIds.length > 0) {
            const migrated = await migrateSceneFrontmatterIds(this.plugin);
            if (migrated > 0) {
                manifest = this.buildCorpusManifest('omnibus', {
                    modelId: providerChoice.modelId,
                    contextRequired
                });
            }
        }
        const submittedAt = new Date();

        const omnibusInput: InquiryOmnibusInput = {
            scope: this.state.scope,
            scopeLabel,
            targetSceneIds,
            selectionMode,
            activeBookId,
            mode: this.state.mode,
            questions: questions.map(question => ({
                id: question.id,
                zone: question.zone,
                questionText: this.resolveQuestionPromptForRun(question, selectionMode),
                questionPromptForm: this.resolveQuestionPromptFormForRun(question, selectionMode)
            })),
            corpus: manifest,
            rules: this.getEvidenceRules(),
            ai: {
                provider: providerChoice.provider,
                modelId: providerChoice.modelId,
                modelLabel: providerChoice.modelLabel
            },
            citationsEnabled: this.areInquiryProviderCitationsEnabled(providerChoice.provider)
        };

        this.state.isRunning = true;
        this.setApiStatus('running');
        this.refreshUI({ skipCorpus: true });

        const modal = this.activeOmnibusModal;
        if (modal) modal.updateProgress(1, total, '', 'Combined run in progress...', 'Processing all questions in a single pass...');

        const briefPaths: string[] = [];
        const completedIds: string[] = [];
        let lastSession: InquirySession | null = null;
        let lastResult: InquiryResult | null = null;
        let traceForLogs: InquiryRunTrace | null = null;

        try {
            const runOutput = await this.runner.runOmnibusWithTrace(omnibusInput);
            traceForLogs = runOutput.trace;
            if (modal) {
                modal.setAiAdvancedContext(this.getEffectiveReuseAdvancedContext());
                // Combined path is a single provider call; report cache once for the whole run.
                modal.notePassResult(1, 1, traceForLogs?.usage ?? null);
                const combinedProbe = readOmnibusCacheProbe(traceForLogs?.usage);
                const combinedCost = accumulateOmnibusPassCost(
                    createOmnibusCostAccumulator(),
                    providerChoice.provider,
                    providerChoice.modelId,
                    traceForLogs?.usage ?? null,
                    combinedProbe.cacheReadTokens
                );
                modal.noteRunningCost(combinedCost);
            }
            const completedAt = new Date();
            const questionsById = new Map(questions.map(question => [question.id, question]));

            for (let i = 0; i < runOutput.results.length; i += 1) {
                const result = runOutput.results[i];
                const question = questionsById.get(result.questionId) ?? questions[i];
                if (!question) continue;

                if (modal) {
                    const zoneLabel = question.zone === 'setup' ? 'Setup' : question.zone === 'pressure' ? 'Pressure' : 'Payoff';
                    modal.updateProgress(i + 1, total, zoneLabel, question.label, 'Writing brief/log...');
                }

                const questionManifest = this.buildCorpusManifest(question.id, {
                    modelId: providerChoice.modelId,
                    questionZone: question.zone
                });
                const trace = traceForLogs ? this.cloneTrace(traceForLogs) : await this.buildFallbackTrace({
                    scope: this.state.scope,
                    scopeLabel,
                    targetSceneIds,
                    selectionMode,
                    activeBookId,
                    mode: this.state.mode,
                    questionId: question.id,
                    questionText: this.resolveQuestionPromptForRun(question, selectionMode),
                    questionPromptForm: this.resolveQuestionPromptFormForRun(question, selectionMode),
                    questionZone: question.zone,
                    corpus: questionManifest,
                    rules: this.getEvidenceRules(),
                    ai: omnibusInput.ai,
                    citationsEnabled: omnibusInput.citationsEnabled
                }, 'Omnibus trace unavailable; log created without prompt capture.');

                const persisted = await this.persistOmnibusResult({
                    question,
                    result,
                    trace,
                    manifest: questionManifest,
                    scopeKey,
                    activeBookId,
                    targetSceneIds,
                    submittedAt,
                    completedAt
                });
                if (persisted.briefPath) {
                    briefPaths.push(persisted.briefPath);
                }
                completedIds.push(question.id);
                if (modal) modal.noteQuestionCompleted(question.id);
                lastSession = persisted.session;
                lastResult = persisted.normalized;
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            new Notice(t('inquiry.notice.omnibusFailed', { message }));
        } finally {
            const indexPath = (createIndex && briefPaths.length > 1)
                ? await this.saveOmnibusIndexNote(briefPaths, scopeLabel)
                : undefined;
            const allQuestionIds = this.getOmnibusQuestions().map(q => q.id);
            const isComplete = completedIds.length >= questions.length;
            if (isComplete) {
                this.clearOmnibusProgress();
            } else {
                this.saveOmnibusProgress({
                    totalQuestions: allQuestionIds.length,
                    completedQuestionIds: this.mergeCompletedIds(completedIds),
                    scope: this.state.scope,
                    questionIds: allQuestionIds,
                    useOmnibus: true,
                    corpusSettingsFingerprint: this.buildCorpusSettingsFingerprint(),
                    indexNotePath: indexPath ?? undefined,
                    abortedAt: new Date().toISOString()
                });
            }
            if (modal) modal.showResult(completedIds.length, total, !isComplete);
            if (lastSession && lastResult) {
                this.applySession({
                    result: lastResult,
                    key: lastSession.key,
                    activeBookId: lastSession.activeBookId,
                    targetSceneIds: lastSession.targetSceneIds,
                    scope: lastSession.scope,
                    questionZone: lastSession.questionZone
                }, 'missing');
                if (this.isErrorResult(lastResult)) {
                    this.setApiStatus('error', formatApiErrorReason(lastResult));
                } else {
                    this.setApiStatus('success');
                }
            } else {
                this.state.isRunning = false;
                this.setApiStatus('idle');
                this.refreshUI();
            }
            this.updateBriefingButtonState();
            this.refreshBriefingPanel();
        }
    }

    private async runOmnibusSequential(
        questions: InquiryQuestion[],
        providerChoice: OmnibusProviderChoice,
        createIndex: boolean,
        totalForProgress?: number
    ): Promise<void> {
        const total = totalForProgress ?? questions.length;
        const scopeLabel = this.getScopeLabel();
        const scopeKey = this.getScopeKey();
        const targetSceneIds = this.getActiveTargetSceneIds();
        const selectionMode = this.getSelectionMode(targetSceneIds);
        const activeBookId = this.state.activeBookId ?? this.corpus?.books?.[0]?.id;
        const briefPaths: string[] = [];
        const completedIds: string[] = [];
        let lastSession: InquirySession | null = null;
        let lastResult: InquiryResult | null = null;
        let aborted = false;
        // Cache-health kill-switch state (see runner/omnibusCacheHealth.ts).
        // `cacheArmed` carries forward whether an earlier question created or
        // reused the provider cache, so a question >=2 with no cache read can be
        // distinguished as a costly MISS (abort) vs an uncacheably-small corpus.
        let cacheArmed = false;
        let costAcc: OmnibusCostAccumulator = createOmnibusCostAccumulator();
        let cacheMissDetail: string | undefined;
        const cacheTtlLabel = formatProviderCacheTtlLabel(
            providerChoice.provider,
            this.plugin.settings.aiSettings ?? buildDefaultAiSettings()
        );

        const modal = this.activeOmnibusModal;

        this.state.isRunning = true;
        this.setApiStatus('running');
        this.refreshUI({ skipCorpus: true });

        // Ensure scene IDs exist before the sequential loop.
        {
            const preflightManifest = this.buildCorpusManifest(questions[0]?.id ?? 'preflight', { // SAFE: no questions yet — placeholder id for the preflight manifest
                modelId: providerChoice.modelId,
                questionZone: questions[0]?.zone
            });
            const missingIds = preflightManifest.entries.filter(entry => entry.class === 'scene' && !entry.sceneId);
            if (missingIds.length > 0) {
                await migrateSceneFrontmatterIds(this.plugin);
            }
        }

        try {
            for (let qi = 0; qi < questions.length; qi += 1) {
                // Check abort before starting each question
                if (this.omnibusAbortRequested || (modal && modal.isAbortRequested())) {
                    aborted = true;
                    break;
                }

                const question = questions[qi];
                const questionIndex = qi + 1;
                const zoneLabel = question.zone === 'setup' ? 'Setup' : question.zone === 'pressure' ? 'Pressure' : 'Payoff';

                if (modal) modal.updateProgress(questionIndex, total, zoneLabel, question.label);

                const manifest = this.buildCorpusManifest(question.id, {
                    modelId: providerChoice.modelId,
                    questionZone: question.zone
                });
                if (!manifest.entries.length) {
                    this.handleEmptyCorpusRun();
                    break;
                }
                const runnerInput: InquiryRunnerInput = {
                    scope: this.state.scope,
                    scopeLabel,
                    targetSceneIds,
                    selectionMode,
                    activeBookId,
                    mode: this.state.mode,
                    questionId: question.id,
                    questionText: this.resolveQuestionPromptForRun(question, selectionMode),
                    questionPromptForm: this.resolveQuestionPromptFormForRun(question, selectionMode),
                    questionZone: question.zone,
                    corpus: manifest,
                    rules: this.getEvidenceRules(),
                    ai: {
                        provider: providerChoice.provider,
                        modelId: providerChoice.modelId,
                        modelLabel: providerChoice.modelLabel
                    },
                    citationsEnabled: this.areInquiryProviderCitationsEnabled(providerChoice.provider)
                };
                const submittedAt = new Date();
                let result: InquiryResult;
                let trace: InquiryRunTrace;
                try {
                    const runOutput = await this.runner.runWithTrace(runnerInput);
                    result = runOutput.result;
                    trace = runOutput.trace;
                    if (modal) {
                        modal.setAiAdvancedContext(this.getEffectiveReuseAdvancedContext());
                    }
                } catch (error) {
                    result = this.buildErrorFallback(
                        question,
                        this.resolveQuestionPromptForRun(question, selectionMode),
                        this.resolveQuestionPromptFormForRun(question, selectionMode),
                        scopeLabel,
                        manifest,
                        error
                    );
                    const message = error instanceof Error ? error.message : String(error);
                    trace = await this.buildFallbackTrace(runnerInput, `Runner exception: ${message}`);
                }

                // Cache-health kill-switch: evaluate this pass's cache result
                // against the pure decision that also drives the UI pill. A
                // question >=2 that re-sent the corpus at full price (armed
                // cache, zero cache read) terminates the remaining run.
                const probe = readOmnibusCacheProbe(trace?.usage);
                const cacheDecision = evaluateOmnibusCachePass({
                    passIndex: questionIndex,
                    probe,
                    cacheArmedBefore: cacheArmed
                });
                cacheArmed = cacheDecision.cacheArmed;
                costAcc = accumulateOmnibusPassCost(
                    costAcc,
                    providerChoice.provider,
                    providerChoice.modelId,
                    trace?.usage ?? null,
                    probe.cacheReadTokens
                );

                if (modal) {
                    modal.notePassResult(questionIndex, total, trace?.usage ?? null, cacheDecision.health);
                    modal.noteRunningCost(costAcc);
                    modal.updateProgress(questionIndex, total, zoneLabel, question.label, 'Writing brief/log...');
                }

                const completedAt = new Date();
                const persisted = await this.persistOmnibusResult({
                    question,
                    result,
                    trace,
                    manifest,
                    scopeKey,
                    activeBookId,
                    targetSceneIds,
                    submittedAt,
                    completedAt
                });
                if (persisted.briefPath) {
                    briefPaths.push(persisted.briefPath);
                }
                completedIds.push(question.id);
                if (modal) modal.noteQuestionCompleted(question.id);
                lastSession = persisted.session;
                lastResult = persisted.normalized;

                // The completed question's result is already saved above; only
                // the REMAINING questions are terminated. Fail clearly (RT
                // doctrine) — never continue silently at full price.
                if (cacheDecision.abort) {
                    aborted = true;
                    const corpusInputTokens = trace?.usage?.inputTokens
                        ?? probe.cacheReadTokens + probe.cacheCreatedTokens;
                    cacheMissDetail = buildOmnibusCacheMissMessage({
                        passIndex: questionIndex,
                        totalQuestions: total,
                        questionLabel: question.label,
                        fullPriceInputTokens: corpusInputTokens,
                        remainingQuestions: questions.length - questionIndex,
                        cacheTtlLabel
                    });
                    new Notice(cacheMissDetail);
                    break;
                }
            }
        } finally {
            const indexPath = (createIndex && briefPaths.length > 1)
                ? await this.saveOmnibusIndexNote(briefPaths, scopeLabel)
                : undefined;
            const allQuestionIds = this.getOmnibusQuestions().map(q => q.id);
            const isComplete = !aborted && completedIds.length >= questions.length;
            if (isComplete) {
                this.clearOmnibusProgress();
            } else {
                this.saveOmnibusProgress({
                    totalQuestions: allQuestionIds.length,
                    completedQuestionIds: this.mergeCompletedIds(completedIds),
                    scope: this.state.scope,
                    questionIds: allQuestionIds,
                    useOmnibus: false,
                    corpusSettingsFingerprint: this.buildCorpusSettingsFingerprint(),
                    indexNotePath: indexPath ?? undefined,
                    abortedAt: new Date().toISOString()
                });
            }
            if (modal) modal.showResult(completedIds.length, total, !isComplete, cacheMissDetail);
            if (cacheMissDetail) {
                this.state.isRunning = false;
                this.setApiStatus('error', cacheMissDetail);
                this.refreshUI();
            } else if (lastSession && lastResult) {
                this.applySession({
                    result: lastResult,
                    key: lastSession.key,
                    activeBookId: lastSession.activeBookId,
                    targetSceneIds: lastSession.targetSceneIds,
                    scope: lastSession.scope,
                    questionZone: lastSession.questionZone
                }, 'missing');
                if (this.isErrorResult(lastResult)) {
                    this.setApiStatus('error', formatApiErrorReason(lastResult));
                } else {
                    this.setApiStatus('success');
                }
            } else {
                this.state.isRunning = false;
                this.setApiStatus('idle');
                this.refreshUI();
            }
            this.updateBriefingButtonState();
            this.refreshBriefingPanel();
        }
    }

    private async persistOmnibusResult(options: {
        question: InquiryQuestion;
        result: InquiryResult;
        trace: InquiryRunTrace;
        manifest: CorpusManifest;
        scopeKey: string;
        activeBookId?: string;
        targetSceneIds: string[];
        submittedAt: Date;
        completedAt: Date;
    }): Promise<{ session: InquirySession; briefPath?: string; normalized: InquiryResult }> {
        const timedResult: InquiryResult = {
            ...options.result,
            questionId: options.result.questionId || options.question.id,
            questionZone: options.result.questionZone || options.question.zone,
            submittedAt: options.submittedAt.toISOString(),
            completedAt: options.completedAt.toISOString(),
            roundTripMs: options.completedAt.getTime() - options.submittedAt.getTime(),
            corpusFingerprint: options.manifest.fingerprint,
            corpusOnlyFingerprint: options.manifest.corpusOnlyFingerprint,
            corpusManifestSnapshot: options.manifest.snapshot,
            cacheReuseFingerprint: options.manifest.cacheReuseFingerprint
        };
        this.applyCorpusOverrideSummary(timedResult);
        this.applyTokenEstimateFromTrace(timedResult, options.trace);
        if (typeof timedResult.aiModelNextRunOnly !== 'boolean') {
            timedResult.aiModelNextRunOnly = false;
        }
        const tracedResult = this.applyExecutionObservabilityFromTrace(timedResult, options.trace);
        this.appendAnthropicDispatchTraceNote(tracedResult, options.trace);
        void this.recordInquiryTimingSample(tracedResult, options.trace);

        const normalized = this.normalizeLegacyResult(tracedResult);
        const normalizationNotes = this.collectNormalizationNotes(tracedResult, normalized);
        const baseKey = this.sessionStore.buildBaseKey({
            questionId: normalized.questionId,
            questionPromptForm: normalized.questionPromptForm,
            questionSignature: this.buildQuestionSignature(normalized.questionText),
            scope: normalized.scope,
            scopeKey: options.scopeKey,
            targetSceneIds: options.targetSceneIds
        });
        const key = this.sessionStore.buildKey(baseKey, options.manifest.fingerprint);

        const session: InquirySession = {
            key,
            baseKey,
            result: normalized,
            createdAt: Date.now(),
            lastAccessed: Date.now(),
            status: this.resolveSessionStatusFromResult(normalized),
            activeBookId: options.activeBookId,
            targetSceneIds: options.targetSceneIds,
            scope: normalized.scope,
            questionZone: options.question.zone
        };
        session.cacheReuseFingerprint = options.manifest.cacheReuseFingerprint;
        session.pendingEditsEmpty = this.resolvePendingEditsEmpty(normalized, options.activeBookId);
        this.sessionStore.setSession(session);

        const logPath = await this.saveInquiryLog(normalized, options.trace, options.manifest, {
            sessionKey: session.key,
            normalizationNotes,
            silent: true
        });
        const rawResponse = options.trace.response?.content ?? null;
        const hasRawResponse = typeof rawResponse === 'string' && rawResponse.trim().length > 0;
        const preserveStatus = this.isErrorResult(normalized)
            ? this.resolveSessionStatusFromResult(normalized)
            : undefined;
        const briefPath = await this.saveBrief(normalized, {
            openFile: false,
            silent: true,
            sessionKey: session.key,
            logPath: logPath ?? undefined,
            rawResponse: hasRawResponse ? rawResponse : undefined,
            statusOverride: preserveStatus
        });
        const updated = this.sessionStore.peekSession(session.key) ?? session;
        return {
            session: updated,
            briefPath: briefPath ?? undefined,
            normalized
        };
    }

    private cloneTrace(trace: InquiryRunTrace): InquiryRunTrace {
        return {
            ...trace,
            tokenEstimate: { ...trace.tokenEstimate },
            response: trace.response ? { ...trace.response } : null,
            usage: trace.usage ? { ...trace.usage } : undefined,
            sanitizationNotes: [...(trace.sanitizationNotes || [])], // SAFE: older traces lack this array — clone as empty
            notes: [...(trace.notes || [])] // SAFE: older traces lack this array — clone as empty
        };
    }

    private async saveOmnibusIndexNote(briefPaths: string[], scopeLabel: string): Promise<string | null> {
        const folder = await ensureInquiryArtifactFolder(this.app);
        if (!folder) return null;
        const timestamp = formatInquiryBriefTimestamp(new Date());
        const scopeTitle = this.state.scope === 'saga' ? 'Saga' : `Book ${scopeLabel}`;
        const title = `Inquiry Omnibus — ${scopeTitle} ${timestamp}`;
        const filePath = this.getAvailableArtifactPath(folder.path, title);
        const links = briefPaths
            .map(path => path.split('/').pop())
            .filter((basename): basename is string => typeof basename === 'string' && basename.length > 0)
            .map(basename => basename.replace(/\.md$/, ''))
            .map(name => `- [[${name}]]`);
        const content = [...links, ''].join('\n');
        try {
            const file = await this.app.vault.create(filePath, content);
            return file.path;
        } catch {
            return null;
        }
    }

    private async promptOmnibusPlan(options: InquiryOmnibusModalOptions): Promise<InquiryOmnibusPlan | null> {
        return new Promise(resolve => {
            const modal = new InquiryOmnibusModal(this.app, options, result => {
                this.activeOmnibusModal = modal;
                resolve(result);
            });
            modal.open();
        });
    }

    private saveOmnibusProgress(progress: OmnibusProgressState): void {
        this.plugin.settings.inquiryOmnibusProgress = progress;
        void this.plugin.saveSettings();
    }

    private clearOmnibusProgress(): void {
        this.plugin.settings.inquiryOmnibusProgress = undefined;
        void this.plugin.saveSettings();
    }

    private mergeCompletedIds(newIds: string[]): string[] {
        const prior = this.settingsAccessor.getOmnibusProgress();
        if (!prior) return [...newIds];
        const merged = new Set(prior.completedQuestionIds);
        newIds.forEach(id => merged.add(id));
        return [...merged];
    }

    private buildCorpusSettingsFingerprint(): string {
        const sources = this.settingsAccessor.getSources();
        const classes = sources?.classes ?? []; // SAFE: settings may omit class configs — fingerprint has no parts
        const parts = classes
            .filter(c => c.enabled)
            .map(c => `${c.className}:${c.bookScope}:${c.sagaScope}:${c.referenceScope}`)
            .sort();
        return parts.join('|');
    }

    private checkOmnibusResumeEligibility(
        prior: OmnibusProgressState,
        currentQuestions: InquiryQuestion[],
        providerPlan: OmnibusProviderPlan
    ): { available: boolean; reason?: string } {
        if (prior.completedQuestionIds.length >= prior.totalQuestions) {
            return { available: false, reason: t('inquiry.runner.previousRunCompleted') };
        }
        if (prior.scope !== this.state.scope) {
            return { available: false, reason: t('inquiry.runner.scopeChanged') };
        }
        const currentIds = currentQuestions.map(q => q.id).sort().join(',');
        const priorIds = [...prior.questionIds].sort().join(',');
        if (currentIds !== priorIds) {
            return { available: false, reason: t('inquiry.runner.questionSetChanged') };
        }
        const currentFingerprint = this.buildCorpusSettingsFingerprint();
        if (currentFingerprint !== prior.corpusSettingsFingerprint) {
            return { available: false, reason: t('inquiry.runner.corpusContributionChanged') };
        }
        if (providerPlan.choice && providerPlan.choice.useOmnibus !== prior.useOmnibus) {
            // Allow sequential fallback from combined, but not the reverse
            if (prior.useOmnibus && !providerPlan.choice.useOmnibus) {
                // OK: falling back to sequential
            } else {
                return { available: false, reason: t('inquiry.runner.providerStrategyChanged') };
            }
        }
        return { available: true };
    }

    private getOmnibusQuestions(): InquiryQuestion[] {
        const config = this.getPromptConfig();
        const zones: InquiryZone[] = ['setup', 'pressure', 'payoff'];
        const questions: InquiryQuestion[] = [];
        const seen = new Set<string>();

        zones.forEach(zone => {
            const slots = config[zone] ?? []; // SAFE: zone may be absent from prompt config — no questions contributed
            if (!slots.length) return;
            const zoneLabel = zone === 'setup' ? 'Setup' : zone === 'pressure' ? 'Pressure' : 'Payoff';
            const icon = zone === 'setup' ? 'help-circle' : zone === 'pressure' ? 'activity' : 'check-circle';
            slots.forEach((slot, slotIndex) => {
                if (!slot.enabled) return;
                if (seen.has(slot.id)) return;
                const question = this.buildInquiryQuestion(zone, slot, icon, slotIndex);
                if (!question) return;
                questions.push({
                    ...question,
                    label: question.label || zoneLabel
                });
                seen.add(slot.id);
            });
        });

        return questions;
    }

    private buildOmnibusProviderPlan(): OmnibusProviderPlan {
        const engine = this.getResolvedEngine();
        if (engine.provider === 'none' || engine.blocked) {
            return {
                choice: null,
                summary: engine.blockReason || t('inquiry.runner.inquiryAiUnavailable'),
                label: 'Unavailable',
                disabledReason: engine.blockReason || 'Canonical Inquiry engine unavailable' // SAFE: UX default when the engine carries no specific block reason
            };
        }

        const useOmnibus = engine.provider === 'google';
        // A capability substitution silently upgrades the author to a costlier
        // model. Carry the notice into the run summary so the swap is stated
        // before the run, not discovered on an invoice.
        const substitutionNotice = engine.substitution ? ` ${engine.substitution.notice}` : '';
        return {
            choice: {
                provider: engine.provider,
                modelId: engine.modelId,
                modelLabel: engine.modelLabel,
                useOmnibus,
                reason: useOmnibus ? undefined : 'Combined omnibus is reserved for the canonical Google Inquiry path.'
            },
            summary: (useOmnibus
                ? `Using canonical Inquiry engine ${engine.providerLabel} · ${engine.modelLabel} for a combined omnibus run.`
                : `Using canonical Inquiry engine ${engine.providerLabel} · ${engine.modelLabel}. This provider will execute omnibus sequentially.`)
                + substitutionNotice,
            label: useOmnibus ? `${engine.providerLabel} omnibus` : `Sequential · ${engine.providerLabel}`
        };
    }

    /**
     * Pre-run cost band for the Omnibus plan modal. Uses the synchronous
     * estimate snapshot (byte-on-the-wire input tokens for the current corpus)
     * and the resolved engine's pricing. Returns undefined when either the
     * corpus token estimate or the model pricing is unavailable, so the modal
     * can say "unavailable" honestly rather than show a fabricated number.
     */
    private buildOmnibusCostRangePlan(
        questionCount: number,
        providerPlan: OmnibusProviderPlan,
        cacheAlreadyWarm = false
    ): OmnibusCostRangePlan | undefined {
        const choice = providerPlan.choice;
        if (!choice) return undefined;
        const snapshot = this.plugin.getInquiryEstimateService().getSnapshot();
        const corpusInputTokens = snapshot?.estimate?.estimatedInputTokens;
        if (typeof corpusInputTokens !== 'number' || !Number.isFinite(corpusInputTokens) || corpusInputTokens <= 0) {
            return undefined;
        }
        // Each question returns a bounded findings JSON; the input corpus,
        // not the output, dominates the band, so a conservative fixed
        // per-question output estimate is sufficient for a range.
        const expectedOutputTokensPerQuestion = Math.min(INQUIRY_MAX_OUTPUT_TOKENS, 4000);
        const range = estimateOmnibusCostRange({
            provider: choice.provider,
            modelId: choice.modelId,
            corpusInputTokens,
            expectedOutputTokensPerQuestion,
            questionCount,
            cacheAlreadyWarm,
            cacheWriteTtl: ANTHROPIC_REQUESTED_CACHE_TTL
        });
        return {
            uncachedUSD: range.uncachedUSD,
            cachedUSD: range.cachedUSD,
            corpusInputTokens,
            estimateMethod: snapshot?.estimate?.estimationMethod,
            provider: choice.provider,
            modelId: choice.modelId,
            expectedOutputTokensPerQuestion,
            cacheAlreadyWarm
        };
    }

    /**
     * Questions this omnibus run would merely re-answer: for each question,
     * reconstruct the exact session key the run would persist (question id,
     * resolved prompt form/signature, scope, targets, and the fingerprint that
     * embeds the engine's model id plus every corpus file's mtime) and look for
     * an existing non-error session under it. A match means the same engine
     * already answered this question on the byte-identical corpus — the plan
     * modal offers those rows as suggested skips.
     *
     * The fingerprint reconstruction mirrors buildCorpusManifest exactly, with
     * the entry serialization cached per contextRequired flag (entries only
     * vary on that flag) to avoid redundant corpus scans across ~27 questions.
     * Force-rerun sessions carry a `::rerun-<ts>` key suffix, so matching is by
     * canonical-key prefix over the store rather than one exact peek.
     */
    private buildOmnibusRecentResults(
        questions: InquiryQuestion[],
        choice: OmnibusProviderChoice
    ): Record<string, OmnibusRecentQuestionResult> | undefined {
        const scopeKey = this.getScopeKey();
        const targetSceneIds = this.getActiveTargetSceneIds();
        const selectionMode = this.getSelectionMode(targetSceneIds);
        const allSessions = this.sessionStore.getRecentSessions(this.sessionStore.getSessionCount());
        const fingerprintSourceByContext = new Map<boolean, string>();
        const results: Record<string, OmnibusRecentQuestionResult> = {};

        for (const question of questions) {
            const contextRequired = this.isContextRequiredForQuestion(question.id, question.zone);
            let fingerprintSource = fingerprintSourceByContext.get(contextRequired);
            if (fingerprintSource === undefined) {
                const manifest = this.buildCorpusManifest(question.id, {
                    modelId: choice.modelId,
                    questionZone: question.zone,
                    contextRequired
                });
                fingerprintSource = manifest.entries
                    .map(e => `${e.path}:${e.sceneId ?? ''}:${e.mtime}:${e.mode}:${e.isTarget ? 1 : 0}`) // SAFE: non-scene entries have no sceneId — empty segment keeps the fingerprint stable
                    .sort()
                    .join('|');
                fingerprintSourceByContext.set(contextRequired, fingerprintSource);
            }
            const fingerprint = this.hashString(
                `${INQUIRY_SCHEMA_VERSION}|${question.id}|${choice.modelId}|${fingerprintSource}`
            );
            // Omnibus resolves prompts without per-question overrides (see
            // runOmnibusSequential) — mirror that so a match means THIS run
            // would reproduce the session, not a differently-prompted cousin.
            const questionText = this.resolveQuestionPromptForRun(question, selectionMode);
            const questionPromptForm = this.resolveQuestionPromptFormForRun(question, selectionMode);
            const baseKey = this.sessionStore.buildBaseKey({
                questionId: question.id,
                questionPromptForm,
                questionSignature: this.buildQuestionSignature(questionText),
                scope: this.state.scope,
                scopeKey,
                targetSceneIds
            });
            const canonicalKey = this.sessionStore.buildKey(baseKey, fingerprint);
            const match = allSessions.find(session =>
                (session.key === canonicalKey || session.key.startsWith(`${canonicalKey}::rerun-`))
                && !this.isErrorResult(session.result)
            );
            if (!match) continue;
            results[question.id] = { completedAt: match.createdAt || match.lastAccessed };
        }
        return Object.keys(results).length ? results : undefined;
    }

    private getOmnibusRunDisabledReason(questions: InquiryQuestion[], providerPlan: OmnibusProviderPlan): string | null {
        if (this.state.isRunning) return t('inquiry.runner.inquiryAlreadyRunning');
        if (this.isInquiryBlocked()) return t('inquiry.runner.inquiryNotConfigured');
        if (this.guidanceState === 'no-scenes') return t('inquiry.runner.noScenesAvailable');
        if (this.isInquiryApiKeyMissing()) return t('inquiry.interaction.noApiKey');
        if (!questions.length) return t('inquiry.runner.noEnabledQuestions');
        if (!providerPlan.choice) return providerPlan.disabledReason || 'Provider unavailable'; // SAFE: UX default when the provider plan carries no specific reason
        return null;
    }

    private applySession(
        session: {
            result: InquiryResult;
            key?: string;
            activeBookId?: string;
            targetSceneIds?: string[];
            scope?: InquiryScope;
            questionZone?: InquiryZone;
        },
        cacheStatus: 'fresh' | 'stale' | 'missing'
    ): void {
        this.exitStartupFreshMode();
        const normalized = this.normalizeLegacyResult(session.result);
        const resolvedZone = session.questionZone ?? this.findPromptZoneById(normalized.questionId);
        this.state.scope = session.scope ?? normalized.scope;
        this.selection.adoptModeFromResult(normalized.mode);
        if (resolvedZone && normalized.questionId) {
            const options = this.getPromptOptions(resolvedZone);
            if (options.some(option => option.id === normalized.questionId)) {
                this.state.selectedPromptIds[resolvedZone] = normalized.questionId;
            }
        }
        if (session.activeBookId !== undefined) {
            this.selection.setActiveBookId(session.activeBookId);
        }
        if (session.targetSceneIds !== undefined) {
            this.selection.setTargetSceneIds(this.normalizeTargetSceneIds(session.targetSceneIds));
        }
        // Active-result lifecycle subset — writes 8 fields atomically.
        this.activeSession.adopt({
            sessionKey: session.key,
            result: normalized,
            activeZone: resolvedZone ?? this.state.activeZone,
            cacheStatus,
        });
        this.state.isRunning = false;
        this.hideSceneDossier(true);
        if (this.isErrorResult(normalized)) {
            this.showErrorPreview(normalized);
        } else {
            this.showResultsPreview(normalized);
        }
        this.updateMinimapTargetStates(normalized);
        this.refreshUI({ skipCorpus: true });
    }

    private clearActiveResultState(): void {
        this.cachedRunningStatusStatic = undefined;
        this.activeSession.clearActiveResult();
    }

    private clearRehydrateState(): void {
        this.rehydrateTargetKey = undefined;
        if (this.rehydrateHighlightTimer) {
            window.clearTimeout(this.rehydrateHighlightTimer);
            this.rehydrateHighlightTimer = undefined;
        }
        if (this.rehydratePulseTimer) {
            window.clearTimeout(this.rehydratePulseTimer);
            this.rehydratePulseTimer = undefined;
        }
        this.artifactButton?.classList.remove('is-rehydrate-pulse');
    }

    private resetInquiryToFreshBaseState(options?: { clearPersistedTargets?: boolean }): void {
        const defaults = createDefaultInquiryState();
        this.state.scope = defaults.scope;
        this.selection.setTargetSceneIds([]);
        this.selection.setActiveBookId(undefined);
        this.selection.applyPersistedLastModeOr(defaults.mode);
        this.state.selectedPromptIds = this.buildDefaultSelectedPromptIds();
        this.activeSession.setActiveQuestionId(undefined);
        this.activeSession.setActiveZone(defaults.activeZone);
        this.state.isRunning = false;
        this.activeSession.setLastError(undefined);
        this.state.reportPreviewOpen = defaults.reportPreviewOpen;
        this.state.promptFormOverrides = {};
        this.clearRehydrateState();
        this.clearActiveResultState();
        this.clearResultPreview();
        this.unlockPromptPreview();
        this.setApiStatus('idle');
        this.startupFreshMode = true;
        this.freshModeTouchedBookIds.clear();
        if (options?.clearPersistedTargets) {
            this.selection.clearPersistedTargetCache();
        }
    }

    private dismissResults(): void {
        if (!this.isResultsState()) return;
        this.clearRehydrateState();
        this.clearActiveResultState();
        this.clearResultPreview();
        this.unlockPromptPreview();
        this.setApiStatus('idle');
        this.startupFreshMode = true;
        this.freshModeTouchedBookIds.clear();
        this.refreshUI({ skipCorpus: true });
    }

    private dismissError(): void {
        if (!this.isErrorState()) return;
        this.clearActiveResultState();
        this.unlockPromptPreview();
        this.setApiStatus('idle');
        this.startupFreshMode = true;
        this.freshModeTouchedBookIds.clear();
        this.refreshUI({ skipCorpus: true });
    }

    private normalizeLegacyResult(result: InquiryResult): InquiryResult {
        const verdict = result.verdict;
        let refNormalizationCount = 0;
        const findings = result.findings.map(legacy => {
            const normalizedRef = this.normalizeResultRefId(legacy.refId, result.scope);
            if (normalizedRef.wasNormalized) refNormalizationCount++;
            const role: InquiryFinding['role'] = legacy.role === 'target'
                ? 'target'
                : legacy.role === 'context'
                    ? 'context'
                    : undefined;
            return {
                refId: normalizedRef.refId,
                kind: legacy.kind,
                headline: legacy.headline,
                bullets: legacy.bullets,
                // recommendedAction MUST be carried through: this legacy
                // re-mapper rebuilds findings field-by-field, and omitting it
                // silently strips the model's concrete edit action before the
                // brief is built — producing "No Action Items" on every run
                // even when the model supplied actions.
                ...(legacy.recommendedAction ? { recommendedAction: legacy.recommendedAction } : {}),
                ...(legacy.subject ? { subject: legacy.subject } : {}),
                ...(legacy.span ? { span: legacy.span } : {}),
                ...(legacy.evidenceQuote ? { evidenceQuote: legacy.evidenceQuote } : {}),
                related: legacy.related,
                ...(legacy.supportingRefs?.length ? { supportingRefs: legacy.supportingRefs } : {}),
                evidenceType: legacy.evidenceType,
                lens: legacy.lens,
                role,
                ...(legacy.rawRef ? { rawRef: legacy.rawRef } : {})
            };
        });
        const normalized: InquiryResult = {
            ...result,
            summaryFlow: result.summaryFlow ?? result.summary,
            summaryDepth: result.summaryDepth ?? result.summary,
            selectionMode: result.selectionMode === 'focused' ? 'focused' : 'discover',
            roleValidation: this.computeRoleValidation(
                result.selectionMode === 'focused' ? 'focused' : 'discover',
                findings,
                result.roleValidation
            ),
            questionText: result.questionText?.trim() || this.getQuestionTextById(result.questionId) || undefined,
            questionPromptForm: result.questionPromptForm === 'focused' ? 'focused' : 'standard',
            verdict: {
                flow: verdict.flow,
                depth: verdict.depth
            },
            findings,
            refNormalizationCount: refNormalizationCount > 0 ? refNormalizationCount : undefined
        };
        const inquiryId = this.formatInquiryIdFromResult(normalized);
        if (inquiryId && (!normalized.runId || normalized.runId.startsWith('run-'))) {
            normalized.runId = inquiryId;
        }
        return normalized;
    }

    private normalizeResultRefId(refId: string | undefined, scope: InquiryScope = this.state.scope): { refId: string; wasNormalized: boolean } {
        const trimmed = typeof refId === 'string' ? refId.trim() : '';
        if (!trimmed) return { refId: '', wasNormalized: false };
        if (scope === 'saga') {
            if (/^book_[a-z0-9][a-z0-9_-]{1,80}$/i.test(trimmed)) {
                return { refId: trimmed.toLowerCase(), wasNormalized: false };
            }
            const lower = trimmed.toLowerCase();
            const bookMatch = this.corpus?.books?.find(book =>
                book.id.toLowerCase() === lower
                || book.displayLabel.toLowerCase() === lower
                || book.sceneId?.toLowerCase() === lower
                || book.filePaths?.some(path => path.toLowerCase() === lower)
            );
            if (bookMatch?.sceneId) {
                return { refId: bookMatch.sceneId.toLowerCase(), wasNormalized: true };
            }
            return { refId: trimmed, wasNormalized: false };
        }
        if (!this.corpus?.scenes?.length) {
            return { refId: isStableSceneId(trimmed) ? trimmed.toLowerCase() : '', wasNormalized: false };
        }

        const index = buildSceneRefIndex(this.corpus.scenes
            .filter(scene => isStableSceneId(scene.sceneId))
            .map(scene => ({
                sceneId: String(scene.sceneId).trim().toLowerCase(),
                path: scene.filePath,
                label: scene.displayLabel,
                sceneNumber: scene.sceneNumber,
                aliases: [scene.id, ...(scene.filePaths || [])] // SAFE: scenes without alternate filePaths get no extra aliases
            })));
        const normalized = normalizeSceneRef({ ref_id: trimmed }, index);
        if (normalized.warning) {
            console.warn(`[Inquiry] ${normalized.warning}`);
        }
        return {
            refId: normalized.ref.ref_id || '', // SAFE: unresolved ref normalizes to empty — caller treats empty as unresolved
            wasNormalized: normalized.normalizedFromLegacy && !normalized.unresolved
        };
    }

    private collectNormalizationNotes(raw: InquiryResult, normalized: InquiryResult): string[] {
        const notes: string[] = [];
        if (!raw.summaryFlow && normalized.summaryFlow) {
            notes.push('Filled summaryFlow from summary.');
        }
        if (!raw.summaryDepth && normalized.summaryDepth) {
            notes.push('Filled summaryDepth from summary.');
        }
        if (raw.runId !== normalized.runId && normalized.runId) {
            notes.push('Normalized runId to inquiry id.');
        }
        const refNormCount = normalized.refNormalizationCount ?? 0; // SAFE: older normalizer results lack the count — 0 skips the note
        if (refNormCount > 0) {
            notes.push(`Normalized ${refNormCount} scene ref${refNormCount === 1 ? '' : 's'} from non-standard format to canonical scn_ id.`);
        }
        return notes;
    }

    private resolveInquiryActionNotesFieldLabel(): string {
        return 'Pending Edits';
    }

    private shouldAutoPopulatePendingEdits(): boolean {
        return this.settingsAccessor.getActionNotesAutoPopulate() ?? false; // SAFE: optional setting unset — auto-populate defaults off
    }

    private async writeInquiryPendingEdits(
        session: InquirySession,
        result: InquiryResult,
        options?: { notify?: boolean }
    ): Promise<boolean> {
        if (session.pendingEditsApplied) return true;
        if (session.status === 'simulated' || result.aiReason === 'simulated') {
            if (options?.notify) {
                const fieldLabel = this.resolveInquiryActionNotesFieldLabel();
                this.notifyInteraction(t('inquiry.interaction.writebackDisabledSimulated', { fieldLabel }));
            }
            return false;
        }

        const normalized = this.normalizeLegacyResult(result);
        if (this.isErrorResult(normalized)) return false;
        if (normalized.scope !== 'book') return false;
        if (!this.corpus) return false;

        const pendingPlan = this.buildInquiryPendingEditsPlan(normalized, session.activeBookId);
        const notesByMaterial = pendingPlan.notesByMaterial;
        const briefId = this.formatInquiryBriefId(normalized);
        if (!notesByMaterial.size) {
            session.pendingEditsEmpty = true;
            if (session.key) {
                this.sessionStore.updateSession(session.key, { pendingEditsEmpty: true });
            }
            if (options?.notify) {
                this.notifyInteraction('No action items met the writeback threshold.');
            }
            this.refreshBriefingPanel();
            return false;
        }

        const targetField = 'Pending Edits';
        let wroteAny = false;
        let duplicateAny = false;
        let refusedAny = false;

        for (const [path, notes] of notesByMaterial.entries()) {
            const file = this.app.vault.getAbstractFileByPath(path);
            if (!file || !(file instanceof TFile)) continue;
            try {
                const outcome = await this.appendInquiryNotesToFrontmatter(file, targetField, briefId, notes);
                if (outcome === 'written') wroteAny = true;
                if (outcome === 'duplicate') duplicateAny = true;
                if (outcome === 'refused') refusedAny = true;
            } catch (error) {
                console.warn('[Inquiry] Unable to write Pending Edits.', { path, error });
            }
        }

        const applied = wroteAny || duplicateAny;
        if (applied && session.key) {
            session.pendingEditsApplied = true;
            this.sessionStore.updateSession(session.key, { pendingEditsApplied: true });
            this.briefingPurgeScanner.invalidate();
            this.refreshBriefingPanel();
            void this.briefingPurgeScanner.refresh();
            if (options?.notify) {
                this.notifyInteraction(formatPendingEditsSuccessMessage(pendingPlan.targetLabels));
            }
        }
        if (refusedAny) {
            new Notice(t('inquiry.notice.pendingEditsBroken'), 7000);
        }
        return applied;
    }

    private buildInquiryActionNotes(
        result: InquiryResult,
        briefId: string,
        briefAlias: string,
        activeBookId?: string
    ): Map<string, string[]> {
        const notesByPath = new Map<string, Set<string>>();
        const addNote = (path: string, note: string) => {
            let bucket = notesByPath.get(path);
            if (!bucket) {
                bucket = new Set<string>();
                notesByPath.set(path, bucket);
            }
            bucket.add(note);
        };

        const sceneByLabel = new Map<string, string>();
        const sceneById = new Map<string, string>();
        const sceneBySceneId = new Map<string, string>();
        const sceneByPath = new Map<string, string>();
        if (this.corpus?.scenes?.length) {
            this.corpus.scenes.forEach(scene => {
                sceneByLabel.set(scene.displayLabel, scene.filePath);
                sceneById.set(scene.id, scene.filePath);
                if (scene.sceneId) {
                    sceneBySceneId.set(scene.sceneId, scene.filePath);
                }
                scene.filePaths?.forEach(path => sceneByPath.set(path, scene.filePath));
            });
        }

        const items = this.getResultItems(result);
        const referenceLabels = this.buildInquiryReferenceLabelMap(items);

        result.findings.forEach(finding => {
            if (!this.isFindingHit(finding)) return;
            const targetLabel = resolveFindingChipLabel(finding, result, items)
                ?? (finding.refId && /^s\d+$/i.test(finding.refId.trim()) ? finding.refId.trim().toUpperCase() : undefined);
            const note = this.formatInquiryActionNote(finding, briefId, briefAlias, targetLabel, referenceLabels);
            if (!note) return; // Skip findings that didn't produce an actionable suggestion.
            const refId = finding.refId?.trim();
            const filePath = refId
                ? (sceneByLabel.get(refId)
                    ?? sceneBySceneId.get(refId)
                    ?? sceneById.get(refId)
                    ?? sceneByPath.get(refId))
                : undefined;
            if (filePath) {
                addNote(filePath, note);
                return;
            }
            const outlinePath = this.resolveInquiryOutlinePathForFinding(result, finding, activeBookId);
            if (outlinePath) {
                addNote(outlinePath, note);
            }
        });

        const notesByMaterial = new Map<string, string[]>();
        notesByPath.forEach((notes, path) => {
            const list = Array.from(notes);
            if (list.length) {
                notesByMaterial.set(path, list);
            }
        });

        return notesByMaterial;
    }

    private resolveInquiryOutlinePathForFinding(
        result: InquiryResult,
        finding: InquiryFinding,
        activeBookId?: string
    ): string | null {
        if (result.scope !== 'saga') {
            return this.resolveBookOutlinePath(activeBookId);
        }
        if (finding.span && /b\d+\s*[-–]\s*b?\d+/i.test(finding.span)) {
            return this.resolveSagaOutlinePath() ?? this.resolveBookOutlinePath(activeBookId);
        }
        const refId = finding.refId?.trim().toLowerCase();
        if (!refId) return this.resolveSagaOutlinePath() ?? this.resolveBookOutlinePath(activeBookId);
        const book = this.getResultItems(result).find(item =>
            item.sceneId?.toLowerCase() === refId
            || item.id.toLowerCase() === refId
            || item.displayLabel.toLowerCase() === refId
            || item.filePaths?.some(path => path.toLowerCase() === refId)
        );
        if (book?.id) {
            return this.resolveBookOutlinePath(book.id) ?? this.resolveSagaOutlinePath();
        }
        return this.resolveSagaOutlinePath() ?? this.resolveBookOutlinePath(activeBookId);
    }

    private buildBriefPendingActions(
        result: InquiryResult,
        items: InquiryCorpusItem[] = this.getResultItems(result),
        referenceLabels: ReadonlyMap<string, string> = this.buildInquiryReferenceLabelMap(items)
    ): Array<{ targetLabel?: string; text: string }> {
        return buildBriefPendingActionsPure(result, items, referenceLabels);
    }

    private resolveBookOutlinePath(activeBookId?: string): string | null {
        if (!this.corpus?.bookResolved || !this.corpus.books.length) return null;
        const resolvedBookId = activeBookId ?? this.corpus.activeBookId;
        if (!resolvedBookId) return null;
        const book = this.corpus.books.find(entry => entry.id === resolvedBookId) ?? this.corpus.books[0];
        if (!book) return null;
        const outlineFiles = this.getOutlineFiles();
        const bookOutlines = outlineFiles.filter(file => (this.getOutlineScope(file) ?? 'book') === 'book'); // SAFE: outlines without an explicit scope are book-scoped
        const outline = bookOutlines.find(file => file.path === book.rootPath || file.path.startsWith(`${book.rootPath}/`));
        return outline?.path ?? null;
    }

    private resolveSagaOutlinePath(): string | null {
        const outline = this.getOutlineFiles().find(file => this.getOutlineScope(file) === 'saga');
        return outline?.path ?? null;
    }

    private async appendInquiryNotesToFrontmatter(
        file: TFile,
        fieldKey: string,
        briefId: string,
        notes: string[]
    ): Promise<InquiryWritebackOutcome> {
        if (!notes.length) return 'skipped';
        const originalContent = await this.app.vault.read(file);
        const prepared = prepareFrontmatterRewrite(originalContent);
        if (!prepared || prepared.aliasConflicts.length > 0) {
            return 'refused';
        }
        let outcome: InquiryWritebackOutcome | null = null;

        await this.app.fileManager.processFrontMatter(file, (fm) => {
            const frontmatter = fm as Record<string, unknown>;
            const nextState = appendInquiryNotesToPendingEdits(frontmatter[fieldKey], briefId, notes, INQUIRY_NOTES_MAX);
            if (!nextState.ok) {
                outcome = 'refused';
                return;
            }
            if (nextState.outcome === 'written') {
                frontmatter[fieldKey] = nextState.value ?? ''; // SAFE: writer may return no value — empty string keeps the field defined
            }
            outcome = nextState.outcome ?? 'skipped'; // SAFE: writer without an explicit outcome counts as skipped
        });
        if (outcome === 'written') {
            const verifiedContent = await this.app.vault.read(file);
            const verification = verifyFrontmatterRewrite(verifiedContent, {
                originalBody: prepared.body,
                verifyParsed: (verifiedFrontmatter) => {
                    const validated = validatePendingEditsValue(verifiedFrontmatter[fieldKey]);
                    return validated.ok;
                }
            });
            if (!verification.ok) {
                return 'refused';
            }
        }
        return outcome ?? 'skipped'; // SAFE: processFrontMatter callback may not run — treat as skipped
    }

    private applyExecutionObservabilityFromTrace(
        result: InquiryResult,
        trace?: InquiryRunTrace | null
    ): InquiryResult {
        if (!trace) return result;
        const usageKnown = typeof trace.tokenUsageKnown === 'boolean'
            ? trace.tokenUsageKnown
            : !!trace.usage;
        return {
            ...result,
            executionState: trace.executionState,
            executionPath: trace.executionPath,
            failureStage: trace.failureStage,
            tokenUsageKnown: usageKnown,
            tokenUsageScope: trace.tokenUsageScope
        };
    }

    private applyTokenEstimateFromTrace(result: InquiryResult, trace?: InquiryRunTrace | null): void {
        const inputTokens = trace?.tokenEstimate?.inputTokens;
        if (typeof inputTokens === 'number' && Number.isFinite(inputTokens)) {
            result.tokenEstimateInput = inputTokens;
            result.tokenEstimateTier = this.getTokenTier(inputTokens);
            return;
        }
        result.tokenEstimateInput = undefined;
        result.tokenEstimateTier = undefined;
    }

    private getFiniteTokenEstimateInput(
        trace?: InquiryRunTrace | null,
        result?: InquiryResult | null
    ): number | null {
        const traceInput = trace?.tokenEstimate?.inputTokens;
        if (typeof traceInput === 'number' && Number.isFinite(traceInput)) {
            return traceInput;
        }
        const resultInput = result?.tokenEstimateInput;
        if (typeof resultInput === 'number' && Number.isFinite(resultInput)) {
            return resultInput;
        }
        return null;
    }

    private buildInquiryLogCostEstimateInput(
        trace: InquiryRunTrace,
        result: InquiryResult
    ): {
        executionInputTokens: number;
        expectedOutputTokens: number;
        expectedPasses: number;
        cacheReuseRatio?: number;
    } | null {
        const executionInputTokens = this.getFiniteTokenEstimateInput(trace, result);
        if (typeof executionInputTokens !== 'number' || !Number.isFinite(executionInputTokens) || executionInputTokens <= 0) {
            return null;
        }
        const provider = result.aiProvider as AIProviderId | undefined;
        const modelId = result.aiModelResolved ?? result.aiModelRequested;
        const usageOutputTokens = result.tokenUsage && typeof result.tokenUsage.outputTokens === 'number'
            ? (provider === 'google'
                && typeof result.tokenUsage.inputTokens === 'number'
                && typeof result.tokenUsage.totalTokens === 'number'
                ? Math.max(result.tokenUsage.outputTokens, result.tokenUsage.totalTokens - result.tokenUsage.inputTokens)
                : result.tokenUsage.outputTokens)
            : null;
        const predicted = typeof usageOutputTokens === 'number' && Number.isFinite(usageOutputTokens) && usageOutputTokens > 0
            ? usageOutputTokens
            : (provider && provider !== 'none' && modelId
                ? this.plugin.getOutputProfileStore().predictExpectedOutput(provider, modelId, executionInputTokens)
                : null);
        if (predicted === null) return null;
        const cap = Number.isFinite(trace.outputTokenCap) ? Math.max(0, Math.floor(trace.outputTokenCap)) : 0;
        const expectedOutputTokens = Math.min(predicted, cap || predicted);
        const expectedPasses = Number.isFinite(trace.tokenEstimate?.expectedPassCount)
            ? Math.max(1, Math.floor(trace.tokenEstimate.expectedPassCount))
            : (Number.isFinite(trace.executionPassCount) ? Math.max(1, Math.floor(trace.executionPassCount as number)) : 1);
        const cacheReuseRatio = typeof trace.cachedStableRatio === 'number' && Number.isFinite(trace.cachedStableRatio)
            ? Math.min(1, Math.max(0, trace.cachedStableRatio))
            : undefined;
        return {
            executionInputTokens,
            expectedOutputTokens,
            expectedPasses,
            cacheReuseRatio
        };
    }

    private startApiSimulation(): void {
        if (this.isInquiryRunDisabled()) return;
        if (this.state.isRunning) {
            this.notifyInteraction(t('inquiry.interaction.running'));
            return;
        }
        if (this.state.scope === 'book' && this.corpus && !this.corpus.bookResolved) {
            this.notifyInteraction(t('inquiry.interaction.bookScopeUnresolved'));
            return;
        }
        this.clearErrorStateForAction();
        if (this.apiSimulationTimer) {
            window.clearTimeout(this.apiSimulationTimer);
            this.apiSimulationTimer = undefined;
        }
        const prompt = this.pickSimulationPrompt();
        const fallbackPrompt: InquiryQuestion = {
            id: 'simulation',
            label: 'Simulation',
            standardPrompt: 'Simulated inquiry run.',
            focusedPrompt: 'Simulated inquiry run.',
            zone: this.state.activeZone ?? 'setup', // SAFE: no active zone on first render — setup is the default zone
            icon: 'activity'
        };
        const selectedPrompt = prompt ?? fallbackPrompt;
        this.clearActiveResultState();
        this.activeSession.setActiveQuestionId(selectedPrompt.id);
        this.activeSession.setActiveZone(selectedPrompt.zone);
        const targetSceneIds = this.getActiveTargetSceneIds();
        const selectionMode = this.getSelectionMode(targetSceneIds);
        const questionText = this.resolveQuestionPromptForRun(selectedPrompt, selectionMode);
        const questionPromptForm = this.resolveQuestionPromptFormForRun(selectedPrompt, selectionMode);
        const questionSignature = this.buildQuestionSignature(questionText);
        this.lockPromptPreview(selectedPrompt, questionText);

        const manifest = this.buildCorpusManifest(selectedPrompt.id, {
            questionZone: selectedPrompt.zone
        });
        if (!manifest.entries.length) {
            this.unlockPromptPreview();
            this.handleEmptyCorpusRun();
            return;
        }
        const scopeLabel = this.getScopeLabel();
        const scopeKey = this.getScopeKey();
        const baseKey = this.sessionStore.buildBaseKey({
            questionId: selectedPrompt.id,
            questionPromptForm,
            questionSignature,
            scope: this.state.scope,
            scopeKey,
            targetSceneIds
        });
        const key = this.sessionStore.buildKey(baseKey, manifest.fingerprint);
        const activeBookId = this.state.scope === 'saga' ? this.state.activeBookId : this.state.activeBookId;
        const resolvedEngine = this.getResolvedEngine();
        const simulationProvider: Exclude<AIProviderId, 'none'> = resolvedEngine.provider === 'none'
            ? 'openai'
            : resolvedEngine.provider;
        const runnerInput: InquiryRunnerInput = {
            scope: this.state.scope,
            scopeLabel,
            targetSceneIds,
            selectionMode,
            activeBookId: this.state.scope === 'saga' ? this.state.activeBookId : this.state.activeBookId,
            mode: this.state.mode,
            questionId: selectedPrompt.id,
            questionText,
            questionPromptForm,
            questionZone: selectedPrompt.zone,
            corpus: manifest,
            rules: this.getEvidenceRules(),
            ai: {
                provider: simulationProvider,
                modelId: resolvedEngine.modelId,
                modelLabel: resolvedEngine.modelLabel
            },
            citationsEnabled: this.areInquiryProviderCitationsEnabled(simulationProvider)
        };
        const submittedAt = new Date();
        this.state.isRunning = true;
        this.setApiStatus('running');
        this.refreshUI({ skipCorpus: true });
        this.apiSimulationTimer = window.setTimeout(() => { void (async () => {
            this.apiSimulationTimer = undefined;
            const completedAt = new Date();
            let result = this.buildSimulationResult(selectedPrompt, questionText, questionPromptForm, scopeLabel, manifest);
            result.submittedAt = submittedAt.toISOString();
            result.completedAt = completedAt.toISOString();
            result.roundTripMs = completedAt.getTime() - submittedAt.getTime();
            const simSnapshot = this.plugin.getInquiryEstimateService().getSnapshot();
            if (typeof simSnapshot?.estimate.estimatedInputTokens === 'number'
                && Number.isFinite(simSnapshot.estimate.estimatedInputTokens)) {
                result.tokenEstimateInput = simSnapshot.estimate.estimatedInputTokens;
                result.tokenEstimateTier = this.getTokenTier(simSnapshot.estimate.estimatedInputTokens);
            } else {
                result.tokenEstimateInput = undefined;
                result.tokenEstimateTier = undefined;
            }
            result.aiModelNextRunOnly = false;
            result = this.applyCorpusOverrideSummary(result);
            const rawResult = result;
            result = this.normalizeLegacyResult(result);
            const normalizationNotes = this.collectNormalizationNotes(rawResult, result);

            const session: InquirySession = {
                key,
                baseKey,
                result,
                createdAt: Date.now(),
                lastAccessed: Date.now(),
                status: 'simulated',
                activeBookId,
                targetSceneIds,
                scope: this.state.scope,
                questionZone: selectedPrompt.zone
            };
            this.sessionStore.setSession(session);
            const trace = await this.buildFallbackTrace(runnerInput, 'Simulated run: no provider call.');
            await this.saveInquiryLog(result, trace, manifest, {
                sessionKey: session.key,
                normalizationNotes
            });
            this.applySession({
                result,
                key: session.key,
                activeBookId: session.activeBookId,
                targetSceneIds: session.targetSceneIds,
                scope: session.scope,
                questionZone: session.questionZone
            }, 'missing');
            this.setApiStatus('success');
        })(); }, SIMULATION_DURATION_MS);
    }

    private pickSimulationPrompt(): InquiryQuestion | undefined {
        const preferredZone = this.state.activeZone ?? 'setup'; // SAFE: no active zone on first render — setup is the default zone
        return this.getActivePrompt(preferredZone)
            ?? this.getActivePrompt('setup')
            ?? this.getActivePrompt('pressure')
            ?? this.getActivePrompt('payoff');
    }

    private buildErrorFallback(
        question: InquiryQuestion,
        questionText: string,
        questionPromptForm: InquiryQuestionPromptForm,
        scopeLabel: string,
        manifest: CorpusManifest,
        error: unknown
    ): InquiryResult {
        const message = error instanceof Error ? error.message : 'Runner error';
        return {
            runId: `run-${Date.now()}`,
            scope: this.state.scope,
            scopeLabel,
            mode: this.state.mode,
            selectionMode: this.getSelectionMode(this.getActiveTargetSceneIds()),
            roleValidation: this.computeRoleValidation(this.getSelectionMode(this.getActiveTargetSceneIds()), []),
            questionId: question.id,
            questionText,
            questionPromptForm,
            questionZone: question.zone,
            summary: 'Inquiry failed before results were produced.',
            summaryFlow: 'Inquiry failed before results were produced.',
            summaryDepth: 'Inquiry failed before results were produced.',
            verdict: {
                flow: 0,
                depth: 0
            },
            aiStatus: 'unavailable',
            aiReason: 'exception',
            findings: [{
                refId: scopeLabel,
                kind: 'error',
                headline: 'Inquiry runner error.',
                bullets: [message],
                related: [],
                evidenceType: 'mixed',
                lens: 'both'
            }],
            corpusFingerprint: manifest.fingerprint,
            corpusOnlyFingerprint: manifest.corpusOnlyFingerprint,
            corpusManifestSnapshot: manifest.snapshot
        };
    }

    private buildSimulationResult(
        question: InquiryQuestion,
        questionText: string,
        questionPromptForm: InquiryQuestionPromptForm,
        scopeLabel: string,
        manifest: CorpusManifest
    ): InquiryResult {
        return {
            runId: `run-${Date.now()}`,
            scope: this.state.scope,
            scopeLabel,
            mode: this.state.mode,
            selectionMode: this.getSelectionMode(this.getActiveTargetSceneIds()),
            roleValidation: this.computeRoleValidation(this.getSelectionMode(this.getActiveTargetSceneIds()), []),
            questionId: question.id,
            questionText,
            questionPromptForm,
            questionZone: question.zone,
            summary: 'Simulated inquiry session.',
            summaryFlow: 'Simulated inquiry session.',
            summaryDepth: 'Simulated inquiry session.',
            verdict: {
                flow: GLYPH_PLACEHOLDER_FLOW,
                depth: GLYPH_PLACEHOLDER_DEPTH
            },
            aiStatus: 'success',
            aiReason: 'simulated',
            findings: [],
            corpusFingerprint: manifest.fingerprint,
            corpusOnlyFingerprint: manifest.corpusOnlyFingerprint,
            corpusManifestSnapshot: manifest.snapshot
        };
    }

    private getEvidenceRules(): EvidenceParticipationRules {
        return {
            sagaOutlineScope: 'saga-only',
            bookOutlineScope: 'book-only',
            crossScopeUsage: 'conflict-only'
        };
    }

    private buildCorpusEntryList(
        questionId: string,
        options?: {
            modelId?: string;
            questionZone?: InquiryZone;
            contextRequired?: boolean;
            includeInactive?: boolean;
            applyOverrides?: boolean;
        }
    ): { entries: CorpusManifestEntry[]; resolvedRoots: string[] } {
        const activeBookId = this.getCanonicalActiveBookId();
        const sources = this.normalizeInquirySources(this.settingsAccessor.getSources());
        const entries: CorpusManifestEntry[] = [];
        const now = Date.now();
        const includeInactive = options?.includeInactive ?? false; // SAFE: optional flag — inactive entries excluded unless requested
        const applyOverrides = options?.applyOverrides ?? true; // SAFE: optional flag — overrides apply unless explicitly disabled
        const classConfigMap = new Map(
            (sources.classes || []).map(config => [config.className, config]) // SAFE: settings may omit class configs — empty map means no class modes configured
        );
        const classScope = this.getClassScopeConfig(sources.classScope);
        const contextRequired = typeof options?.contextRequired === 'boolean'
            ? options.contextRequired
            : this.isContextRequiredForQuestion(questionId, options?.questionZone);
        const rootResolution = resolveInquirySourceRoots(this.app.vault, sources, this.plugin.settings.books);
        const { resolvedRoots, resolvedVaultRoots } = rootResolution;
        const bookResolution = resolveBookManagerInquiryBooks(this.plugin.settings.books);

        if (!classScope.allowAll && classScope.allowed.size === 0) {
            return { entries, resolvedRoots };
        }

        const inRoots = (path: string) => {
            return resolvedVaultRoots.some(root => !root || path === root || path.startsWith(`${root}/`));
        };

        const targetSceneIds = new Set(this.getActiveTargetSceneIds());
        const files = this.app.vault.getMarkdownFiles();
        files.forEach(file => {
            if (!inRoots(file.path)) return;
            if (!isPathIncludedByInquiryBooks(file.path, bookResolution.candidates, this.state.scope)) return;
            const cache = this.app.metadataCache.getFileCache(file);
            const frontmatter = cache?.frontmatter;
            if (!frontmatter) return;
            const normalized = normalizeFrontmatterKeys(frontmatter, getActiveFrontmatterMappings(this.plugin.settings));
            const classValues = this.extractClassValues(normalized);
            if (!classValues.length) return;

            classValues.forEach(className => {
                if (!classScope.allowAll && !classScope.allowed.has(className)) return;
                const config = classConfigMap.get(className);
                const isContextClass = INQUIRY_CONTEXT_CLASSES.has(className);
                const contextOverride = contextRequired && isContextClass;
                if (!config && !contextOverride) return;
                // Disabled classes do not participate — skip unless context override applies.
                if (config && !config.enabled && !contextOverride) return;

                let mode: SceneInclusion = 'excluded';
                if (className === 'outline') {
                    const outlineScope = this.getFrontmatterScope(frontmatter) ?? 'book'; // SAFE: outlines without an explicit scope are book-scoped
                    if (config && config.enabled) {
                        mode = this.normalizeContributionMode(
                            outlineScope === 'saga' ? config.sagaScope : config.bookScope,
                            className
                        );
                    }
                    if (contextOverride) {
                        mode = 'full';
                    }
                    if (applyOverrides) {
                        const groupKey = this.getCorpusGroupKey(className, outlineScope);
                        const classOverride = this.corpusService.getClassOverride(groupKey);
                        const itemOverride = this.getCorpusItemOverride(className, file.path, outlineScope);
                        mode = itemOverride ?? classOverride ?? mode;
                        mode = this.normalizeContributionMode(mode, className);
                    }
                    if (!includeInactive && !this.isModeActive(mode)) return;
                    const inclusionMode = this.normalizeEvidenceMode(mode);
                    entries.push({
                        path: file.path,
                        mtime: file.stat.mtime ?? now,
                        class: className,
                        scope: outlineScope,
                        mode: inclusionMode,
                        isTarget: false
                    });
                    return;
                }

                if (!this.isSynopsisCapableClass(className)) {
                    if (config && config.enabled) {
                        mode = this.normalizeContributionMode(config.referenceScope, className);
                    }
                    if (contextOverride) {
                        mode = 'full';
                    }
                    if (applyOverrides) {
                        const groupKey = this.getCorpusGroupKey(className);
                        const classOverride = this.corpusService.getClassOverride(groupKey);
                        const itemOverride = this.getCorpusItemOverride(className, file.path);
                        mode = itemOverride ?? classOverride ?? mode;
                        mode = this.normalizeContributionMode(mode, className);
                    }
                    if (!includeInactive && !this.isModeActive(mode)) return;
                    const inclusionMode = this.normalizeEvidenceMode(mode);
                    entries.push({
                        path: file.path,
                        mtime: file.stat.mtime ?? now,
                        class: className,
                        mode: inclusionMode,
                        isTarget: false
                    });
                    return;
                }

                if (config && config.enabled) {
                    mode = this.normalizeContributionMode(
                        this.state.scope === 'book' ? config.bookScope : config.sagaScope,
                        className
                    );
                }
                const sceneId = className === 'scene' ? readSceneId(normalized) : undefined;
                if (applyOverrides) {
                    const groupKey = this.getCorpusGroupKey(className);
                    const classOverride = this.corpusService.getClassOverride(groupKey);
                    const itemOverride = this.getCorpusItemOverride(className, file.path, undefined, sceneId);
                    mode = itemOverride ?? classOverride ?? mode;
                    mode = this.normalizeContributionMode(mode, className);
                }
                const isTarget = !!sceneId && targetSceneIds.has(sceneId);
                if (isTarget) {
                    mode = 'full';
                }
                if (!includeInactive && !this.isModeActive(mode)) return;
                const inclusionMode = this.normalizeEvidenceMode(mode);

                entries.push({
                    path: file.path,
                    sceneId,
                    mtime: file.stat.mtime ?? now,
                    class: className,
                    mode: inclusionMode,
                    isTarget
                });
            });
        });

        const scopedEntries = scopeEntriesToActiveInquiryTarget({
            entries,
            scope: this.state.scope,
            activeBookId
        });

        if (this.state.scope === 'saga') {
            bookResolution.includedBooks.forEach(book => {
                scopedEntries.push({
                    path: book.rootPath,
                    sceneId: buildInquiryBookAnchorId(book.rootPath),
                    // Book rows are Saga minimap anchors, not evidence-bearing files.
                    // Keep mtime stable so the corpus fingerprint does not churn
                    // between estimate builds and make the UI look stuck on 0/estimating.
                    mtime: 0,
                    class: 'book',
                    scope: 'saga',
                    bookId: book.rootPath,
                    mode: 'excluded',
                    isTarget: false
                });
            });
        }

        return {
            entries: scopedEntries,
            resolvedRoots
        };
    }

    private buildCorpusManifest(
        questionId: string,
        options?: { modelId?: string; questionZone?: InquiryZone; contextRequired?: boolean; applyOverrides?: boolean }
    ): CorpusManifest {
        const now = Date.now();
        const modelIdOverride = options?.modelId;
        const applyOverrides = options?.applyOverrides ?? true; // SAFE: optional flag — overrides apply unless explicitly disabled
        const entryResult = this.buildCorpusEntryList(questionId, {
            modelId: modelIdOverride,
            questionZone: options?.questionZone,
            contextRequired: options?.contextRequired,
            includeInactive: false,
            applyOverrides
        });
        const entries = entryResult.entries.map(entry => ({
            ...entry,
            mode: entry.mode ?? 'excluded', // SAFE: entries without a mode are treated as excluded
            isTarget: entry.class === 'scene' && !!entry.sceneId && entry.isTarget
        }));
        const resolvedRoots = entryResult.resolvedRoots;

        const fingerprintSource = entries
            .map(entry => `${entry.path}:${entry.sceneId ?? ''}:${entry.mtime}:${entry.mode}:${entry.isTarget ? 1 : 0}`) // SAFE: non-scene entries have no sceneId — empty segment keeps the fingerprint stable
            .sort()
            .join('|');
        // The provider prompt-cache reuse key must be corpus-only. Target-scene
        // selection is question-dependent and now lives in the volatile section
        // of the prompt, so it must NOT enter the reuse key — otherwise the
        // prompt_cache_key changes per question and the provider never reuses
        // the corpus prefix across questions. Mirror the corpus-only
        // serialization used by estimateTokensFromVault so the forecast/preview
        // key matches the run key. (Session identity — `fingerprint` and
        // `corpusOnlyFingerprint` — keeps isTarget so target re-selection still
        // produces a distinct session.)
        const reuseFingerprintSource = entries
            .map(entry => `${entry.path}:${entry.sceneId ?? ''}:${entry.mtime}:${entry.mode}`) // SAFE: non-scene entries have no sceneId — empty segment keeps the fingerprint stable
            .sort()
            .join('|');
        const modelId = modelIdOverride ?? this.getResolvedEngine().modelId;
        const fingerprintRaw = `${INQUIRY_SCHEMA_VERSION}|${questionId}|${modelId}|${fingerprintSource}`;
        const fingerprint = this.hashString(fingerprintRaw);
        const corpusOnlyFingerprint = this.hashString(`${INQUIRY_SCHEMA_VERSION}|${questionId}|${fingerprintSource}`);
        const cacheReuseFingerprint = this.hashString(`${INQUIRY_SCHEMA_VERSION}|${modelId}|${reuseFingerprintSource}`);

        const snapshot = entries.map(entry => ({
            path: entry.path,
            sceneId: entry.sceneId,
            mtime: entry.mtime,
            class: entry.class,
            mode: entry.mode,
            isTarget: entry.isTarget
        }));

        const classCounts = entries.reduce<Record<string, number>>((acc, entry) => {
            acc[entry.class] = (acc[entry.class] || 0) + 1; // SAFE: first entry of a class starts its count at 0
            return acc;
        }, {});
        const allowedClasses = Array.from(new Set(entries.map(entry => entry.class)));
        const synopsisOnly = !entries.some(entry => entry.mode === 'full');

        return {
            entries,
            fingerprint,
            corpusOnlyFingerprint,
            cacheReuseFingerprint,
            snapshot,
            generatedAt: now,
            resolvedRoots,
            allowedClasses,
            synopsisOnly,
            classCounts
        };
    }

    private getDefaultMaterialMode(className: string): SceneInclusion {
        return getDefaultMaterialModePure(className);
    }

    private isSynopsisCapableClass(className: string): boolean {
        return isSynopsisCapableClassPure(className);
    }

    private normalizeContributionMode(mode: SceneInclusion, className: string): SceneInclusion {
        return normalizeContributionModePure(mode, className);
    }

    private normalizeMaterialMode(value: unknown, className: string): SceneInclusion {
        return normalizeMaterialModePure(value, className);
    }

    private resolveContributionMode(config: InquiryClassConfig): SceneInclusion {
        return resolveContributionModePure(config);
    }

    private normalizeClassContribution(config: InquiryClassConfig): InquiryClassConfig {
        return normalizeClassContributionPure(config);
    }

    private normalizeEvidenceMode(mode?: SceneInclusion): 'excluded' | 'summary' | 'full' {
        return normalizeEvidenceModePure(mode);
    }

    private isModeActive(mode?: SceneInclusion): boolean {
        return isModeActivePure(mode);
    }

    private normalizeInquirySources(raw?: InquirySourcesSettings): InquirySourcesSettings {
        return normalizeInquirySourcesPure(raw);
    }

    private extractClassValues(frontmatter: Record<string, unknown>): string[] {
        return extractClassValuesPure(frontmatter);
    }

    private getFrontmatterScope(frontmatter: Record<string, unknown>): InquiryScope | undefined {
        return getFrontmatterScopePure(frontmatter, getActiveFrontmatterMappings(this.plugin.settings));
    }

    private hashString(value: string): string {
        return hashStringPure(value);
    }

    private getBriefSceneAnchorId(source: string): string {
        return getBriefSceneAnchorIdPure(source, (value) => this.hashString(value));
    }

    private setFocusByIndex(index: number): void {
        const books = this.getNavigationBooks();
        const book = books[index - 1];
        if (!book) return;
        this.selection.setActiveBookId(book.id);
        if (this.state.scope === 'book') {
            this.selection.setTargetSceneIds(this.getVisibleTargetSceneIdsForBook(book.id));
        }
        this.scheduleTargetPersist();
        this.refreshUI();
    }

    private async openActiveBrief(anchorId?: string): Promise<void> {
        const sessionId = this.state.activeSessionId;
        if (!sessionId) {
            new Notice(t('inquiry.notice.noBriefActive'));
            return;
        }
        const session = this.sessionStore.peekSession(sessionId);
        if (!session?.briefPath) {
            new Notice(t('inquiry.notice.briefNotSaved'));
            return;
        }
        await this.openBriefFromSession(session, anchorId);
    }

    private async openSceneFromMinimap(sceneId: string): Promise<void> {
        const file = this.app.vault.getAbstractFileByPath(sceneId);
        if (file && this.isTFile(file)) {
            await openOrRevealFile(this.app, file);
            return;
        }
        new Notice(t('inquiry.notice.sceneNotFound'));
    }

    private async openActiveBriefForItem(item: InquiryCorpusItem): Promise<void> {
        const anchorSource = this.getMinimapItemFilePath(item) || item.id || item.displayLabel;
        const anchorId = this.getBriefSceneAnchorId(anchorSource);
        await this.openActiveBrief(anchorId);
    }

    private openActiveBriefArticle(): void {
        const sessionId = this.state.activeSessionId;
        if (!sessionId) {
            new Notice(t('inquiry.notice.noBriefActive'));
            return;
        }
        const session = this.sessionStore.peekSession(sessionId);
        if (!session?.briefPath) {
            new Notice(t('inquiry.notice.briefNotSaved'));
            return;
        }
        const file = this.app.vault.getAbstractFileByPath(session.briefPath);
        if (!(file instanceof TFile)) {
            new Notice(t('inquiry.notice.briefNotFound'));
            return;
        }
        const staleDiagnosis = this.diagnoseSessionStaleness(session);
        this.openBriefingPresentation(this.buildInquiryBriefModel(session.result, session.logPath), {
            briefFile: file,
            logFile: this.getArtifactFileAtPath(session.logPath),
            generatedAt: session.result.completedAt ?? session.createdAt,
            isCorpusStale: !!staleDiagnosis,
            staleDiagnosis
        });
    }

    private openActiveBriefArticleForItem(item: InquiryCorpusItem): void {
        const sessionId = this.state.activeSessionId;
        if (!sessionId) {
            new Notice(t('inquiry.notice.noBriefActive'));
            return;
        }
        const session = this.sessionStore.peekSession(sessionId);
        if (!session?.briefPath) {
            new Notice(t('inquiry.notice.briefNotSaved'));
            return;
        }
        const file = this.app.vault.getAbstractFileByPath(session.briefPath);
        if (!(file instanceof TFile)) {
            new Notice(t('inquiry.notice.briefNotFound'));
            return;
        }
        const anchorSource = this.getMinimapItemFilePath(item) || item.id || item.displayLabel;
        const anchorId = this.getBriefSceneAnchorId(anchorSource);
        const staleDiagnosis = this.diagnoseSessionStaleness(session);
        this.openBriefingPresentation(this.buildInquiryBriefModel(session.result, session.logPath), {
            briefFile: file,
            logFile: this.getArtifactFileAtPath(session.logPath),
            generatedAt: session.result.completedAt ?? session.createdAt,
            focusAnchorId: anchorId,
            isCorpusStale: !!staleDiagnosis,
            staleDiagnosis
        });
    }

    private handleMinimapTickContextMenu(item: InquiryCorpusItem, event: MouseEvent): void {
        if (this.state.isRunning) return;
        event.preventDefault();
        if (this.state.scope !== 'book') {
            this.notifyInteraction('Target Scenes are available only in Book scope.');
            return;
        }
        const filePath = this.getMinimapItemFilePath(item);
        if (!filePath) return;
        const isTarget = !!item.sceneId && this.getActiveTargetSceneIds().includes(item.sceneId);
        const hasCitation = this.doesMinimapItemHaveFinding(item);
        this.showMinimapSceneMenu({
            item,
            filePath,
            hasCitation,
            isTarget,
            event
        });
    }

    private drillIntoBook(bookId: string): void {
        if (!bookId) return;
        const wasScope = this.state.scope;
        this.selection.setActiveBookId(bookId);
        this.scheduleTargetPersist();
        if (wasScope === 'saga') {
            this.handleScopeChange('book');
            return;
        }
        this.refreshUI();
    }

    private shiftFocus(delta: number): void {
        if (this.state.isRunning) {
            this.notifyInteraction(t('inquiry.interaction.running'));
            return;
        }
        this.clearErrorStateForAction();
        const books = this.getNavigationBooks();
        const count = books.length;
        if (!count) return;
        const current = this.getNavigationBookIndex(books) + 1;
        const next = Math.min(Math.max(current + delta, 1), count);
        if (next === current) return;
        this.setFocusByIndex(next);
    }

    private getFocusIndex(): number {
        const books = this.getNavigationBooks();
        if (!books.length) return 1;
        return this.getNavigationBookIndex(books) + 1;
    }

    private getNavigationBooks(): InquiryBookItem[] {
        return this.corpus?.books ?? []; // SAFE: corpus not loaded yet — no books to navigate
    }

    private getNavigationBookIndex(books: InquiryBookItem[]): number {
        if (!books.length) return 0;
        const activeBookId = this.state.activeBookId ?? this.corpus?.activeBookId;
        const index = activeBookId ? books.findIndex(book => book.id === activeBookId) : -1;
        return index >= 0 ? index : 0;
    }

    private getActiveBookLabel(): string {
        if (!this.corpus?.bookResolved) return '?';
        const books = this.corpus?.books ?? []; // SAFE: resolved corpus may still omit books — placeholder label below covers it
        if (this.state.activeBookId) {
            const match = books.find(book => book.id === this.state.activeBookId);
            if (match) return match.displayLabel;
        }
        return books[0]?.displayLabel ?? '?'; // SAFE: display placeholder when no book label resolves
    }

    private getActiveBookTitleForMessages(): string | null {
        if (!this.corpus?.bookResolved) return null;
        const activeBookId = this.state.activeBookId ?? this.corpus?.activeBookId;
        return this.getBookTitleForId(activeBookId);
    }

    private getBookTitleForId(bookId: string | undefined): string | null {
        if (!bookId) return null;
        const normalizedBookId = normalizePath(bookId);
        if (!normalizedBookId) return null;
        const match = (this.plugin.settings.books || []).find(book => // SAFE: settings without books — no title match
            normalizePath((book.sourceFolder || '').trim()) === normalizedBookId // SAFE: book without a sourceFolder normalizes to empty and never matches
        );
        const title = match?.title?.trim();
        return title && title.length > 0 ? title : null;
    }

    private getScopeLabel(): string {
        if (this.guidanceState === 'not-configured') return '?';
        if (this.guidanceState === 'no-scenes') return '?';
        if (this.state.scope === 'saga') {
            return String.fromCharCode(931);
        }
        return this.getActiveBookLabel();
    }

    private getActiveTargetSceneIds(): string[] {
        return this.state.scope === 'book' ? [...this.state.targetSceneIds] : [];
    }

    private getSelectionMode(targetSceneIds: string[] = this.state.targetSceneIds): InquirySelectionMode {
        return targetSceneIds.length > 0 ? 'focused' : 'discover';
    }

    private getResultSelectionMode(result: InquiryResult | null | undefined): InquirySelectionMode {
        return getResultSelectionModePure(result);
    }

    private getResultRoleValidation(result: InquiryResult | null | undefined): InquiryRoleValidation {
        return getResultRoleValidationPure(result);
    }

    private computeRoleValidation(
        selectionMode: InquirySelectionMode,
        findings: InquiryFinding[],
        persisted?: InquiryRoleValidation
    ): InquiryRoleValidation {
        return computeRoleValidationPure(selectionMode, findings, persisted);
    }

    private updateMinimapTargetStates(result?: InquiryResult | null): void {
        const targetSceneIds = this.getActiveTargetSceneIds();
        const selectionMode = result ? this.getResultSelectionMode(result) : this.getSelectionMode(targetSceneIds);
        const roleValidation = result ? this.getResultRoleValidation(result) : 'ok';
        this.minimap.updateTargetStates(targetSceneIds, { selectionMode, roleValidation });
    }

    private getTargetSceneKey(sceneIds: string[] | undefined | null): string {
        if (!Array.isArray(sceneIds) || !sceneIds.length) return '';
        return this.normalizeTargetSceneIds(sceneIds).sort().join(',');
    }

    private getPersistedResultTargetSceneIds(result: InquiryResult | null | undefined): string[] {
        if (!result || !this.state.activeSessionId) return [];
        const session = this.sessionStore.peekSession(this.state.activeSessionId);
        if (!session) return [];
        return this.normalizeTargetSceneIds(session.targetSceneIds);
    }

    private getTargetSceneStatusLabel(): string {
        const activeTargetCount = this.getActiveTargetSceneIds().length;
        const storedTargetCount = this.state.targetSceneIds.length;
        const count = this.state.scope === 'book' ? activeTargetCount : storedTargetCount;
        if (!count) {
            return this.state.scope === 'saga'
                ? 'Discover · Target Scenes available only in Book scope'
                : 'Discover';
        }
        const noun = count === 1 ? 'Target Scene' : 'Target Scenes';
        if (this.state.scope === 'saga') {
            return `${count} ${noun} saved · Book-only`;
        }
        return `${count} ${noun}`;
    }

    private getScopeKey(): string {
        if (this.state.scope === 'saga') return 'saga';
        if (this.state.activeBookId) return this.state.activeBookId;
        return this.corpus?.activeBookId ?? 'unresolved'; // SAFE: diagnostic scope key when no book is resolved
    }

    private buildScopeHoverText(): string {
        const label = this.getScopeLabel();
        const scopeLabel = this.state.scope === 'saga' ? 'Saga scope' : 'Book scope';
        if (this.state.activeResult) {
            const targetNote = this.state.scope === 'saga' && this.state.targetSceneIds.length
                ? ' Target Scenes are saved for Book scope and inactive here.'
                : '';
            return `${scopeLabel}: ${label}. ${this.getTargetSceneStatusLabel()}.${targetNote}`;
        }
        const glyphSeed = this.resolveGlyphSeed();
        if (glyphSeed.source === 'session') {
            return `${scopeLabel}: ${label}. ${this.getTargetSceneStatusLabel()}. Rings seeded from the latest saved inquiry for this selection.`;
        }
        return `${scopeLabel}: ${label}. ${this.getTargetSceneStatusLabel()}. No inquiry run yet.`;
    }

    private buildRingHoverText(ring: InquiryLens): string {
        const label = ring === 'flow' ? 'Flow' : 'Depth';
        if (this.state.activeResult) {
            const verdict = this.state.activeResult.verdict;
            const score = ring === 'flow' ? verdict.flow : verdict.depth;
            return `${label} score ${this.formatMetricDisplay(score)}.`;
        }
        const glyphSeed = this.resolveGlyphSeed();
        if (glyphSeed.source === 'session') {
            const score = ring === 'flow' ? glyphSeed.flowValue : glyphSeed.depthValue;
            return `${label} score ${this.formatMetricDisplay(score)} from the latest saved inquiry for this selection. Run an inquiry to refresh it.`;
        }
        return `${label} verdict unavailable. Run an inquiry.`;
    }

    private resolveGlyphSeed(): InquiryGlyphSeed {
        const activeResult = this.state.activeResult;
        if (activeResult) {
            const flowValue = this.normalizeMetricValue(activeResult.verdict.flow);
            const depthValue = this.normalizeMetricValue(activeResult.verdict.depth);
            return {
                source: 'active',
                flowValue,
                depthValue,
                flowVisualValue: flowValue,
                depthVisualValue: depthValue
            };
        }

        const session = this.getLatestSessionForCurrentFocus();
        if (session) {
            const result = this.normalizeLegacyResult(session.result);
            const flowValue = this.normalizeMetricValue(result.verdict.flow);
            const depthValue = this.normalizeMetricValue(result.verdict.depth);
            return {
                source: 'session',
                flowValue,
                depthValue,
                flowVisualValue: flowValue,
                depthVisualValue: depthValue,
                session
            };
        }

        return {
            source: 'empty',
            flowValue: 0,
            depthValue: 0,
            flowVisualValue: GLYPH_EMPTY_STATE_STUB,
            depthVisualValue: GLYPH_EMPTY_STATE_STUB
        };
    }

    private getLatestSessionForCurrentFocus(): InquirySession | undefined {
        if (this.startupFreshMode) {
            return undefined;
        }
        const scope = this.state.scope;
        const scopeKey = this.getScopeKey();
        const activeTargetKey = this.getTargetSceneKey(this.getActiveTargetSceneIds());
        if (scope === 'book' && (!scopeKey || scopeKey === 'unresolved')) {
            return undefined;
        }
        return this.sessionStore
            .getRecentSessions(this.sessionStore.getSessionCount())
            .find(session => {
                const sessionScope = session.scope ?? session.result.scope;
                if (sessionScope !== scope) return false;
                if (this.isErrorResult(session.result)) return false;
                if (scope === 'saga') return true;
                if (this.getSessionScopeKey(session) !== scopeKey) return false;
                return this.getTargetSceneKey(session.targetSceneIds) === activeTargetKey;
            });
    }

    private getSessionScopeKey(session: InquirySession): string | undefined {
        if (session.activeBookId?.trim()) {
            return session.activeBookId;
        }
        const [, , ...focusParts] = session.baseKey.split('::');
        const fallback = focusParts.join('::').trim();
        return fallback || undefined;
    }

    private getVisibleTargetSceneIdsForBook(bookId: string | undefined): string[] {
        if (!bookId) return [];
        if (this.startupFreshMode && !this.freshModeTouchedBookIds.has(bookId)) {
            return [];
        }
        return this.selection.getRememberedTargetSceneIdsForBook(bookId) ?? []; // SAFE: no remembered target selection for this book — none visible
    }

    private exitStartupFreshMode(): void {
        this.startupFreshMode = false;
        this.freshModeTouchedBookIds.clear();
    }

    private buildZoneHoverText(zone: InquiryZone): string {
        const label = zone === 'setup' ? 'Setup' : zone === 'pressure' ? 'Pressure' : 'Payoff';
        if (!this.state.activeResult) {
            return `${label} verdict unavailable. Run an inquiry.`;
        }
        if (this.state.activeZone !== zone) {
            return `${label} verdict unavailable for the current inquiry.`;
        }
        return `${label}: ${this.getResultSummaryForMode(this.state.activeResult, this.state.mode)}`;
    }

    private buildMinimapHoverText(label: string): string {
        return label;
    }

    private handleMinimapHover(item: InquiryCorpusItem, label: string, displayLabel?: string): void {
        const hoverLabel = displayLabel || label;
        const result = this.state.activeResult;
        if (!result || this.isErrorResult(result)) {
            this.hideSceneDossier(true);
            this.setHoverText(this.buildMinimapHoverText(hoverLabel));
            return;
        }
        const finding = this.resolveFindingForMinimapHover(item, label, hoverLabel, result);
        if (!finding) {
            this.hideSceneDossier();
            this.setHoverText(this.buildMinimapHoverText(hoverLabel));
            return;
        }
        this.setHoverText('');
        this.sceneDossier.queue(
            this.buildSceneDossierHoverKey(item, label, finding),
            this.buildSceneDossierModel(item, label, hoverLabel, finding, result)
        );
    }

    private buildSceneDossierHoverKey(item: InquiryCorpusItem, label: string, finding: InquiryFinding): string {
        return buildSceneDossierHoverKeyPure(item, label, finding);
    }

    private resolveFindingForMinimapHover(
        item: InquiryCorpusItem,
        label: string,
        hoverLabel: string,
        result: InquiryResult
    ): InquiryFinding | null {
        const items = this.getResultItems(result);
        const findingMap = this.buildFindingMap(result, items);
        const directMatch = findingMap.get(label)
            || findingMap.get(hoverLabel)
            || findingMap.get(item.displayLabel);
        if (directMatch) return directMatch;

        const ordered = this.getOrderedFindings(result, result.mode || this.state.mode);
        const candidateKeys = new Set<string>([
            label.toLowerCase(),
            hoverLabel.toLowerCase(),
            item.displayLabel.toLowerCase(),
            item.id.toLowerCase(),
            ...(item.sceneId ? [item.sceneId.toLowerCase()] : []),
            ...(item.filePaths ?? []).map(path => path.toLowerCase()) // SAFE: items without filePaths add no candidate keys
        ]);
        for (const finding of ordered) {
            if (!this.isFindingHit(finding)) continue;
            const refId = finding.refId?.trim().toLowerCase();
            if (refId && candidateKeys.has(refId)) {
                return finding;
            }
            const resolvedLabel = resolveFindingChipLabel(finding, result, items)?.toLowerCase();
            if (resolvedLabel && candidateKeys.has(resolvedLabel)) {
                return finding;
            }
        }
        return null;
    }

    private clearResultPreview(): void {
        const hadPreview = this.minimapResultPreviewActive;
        this.hideSceneDossier(true);
        if (!hadPreview) return;
        this.minimapResultPreviewActive = false;
        if (this.previewLocked) return;
        this.hidePromptPreview(true);
    }

    private buildSceneDossierModel(
        item: InquiryCorpusItem,
        label: string,
        hoverLabel: string,
        finding: InquiryFinding,
        result: InquiryResult
    ): InquirySceneDossier {
        return buildSceneDossierModelPure(
            item,
            label,
            hoverLabel,
            finding,
            result,
            (i) => this.getMinimapItemTitle(i)
        );
    }

    /** Host hook: actually paint the dossier into SVG. Called by controller. */
    private renderSceneDossier(dossier: InquirySceneDossier, _hoverKey: string): void {
        if (
            !this.sceneDossierGroup
            || !this.sceneDossierComposition
            || !this.sceneDossierFocusCore
            || !this.sceneDossierFocusGlow
            || !this.sceneDossierFocusOutline
            || !this.sceneDossierBg
            || !this.sceneDossierBraceLeft
            || !this.sceneDossierBraceRight
            || !this.sceneDossierTextGroup
            || !this.sceneDossierCoreGroup
            || !this.sceneDossierHeader
            || !this.sceneDossierAnchor
            || !this.sceneDossierBody
            || !this.sceneDossierBodySecondary
            || !this.sceneDossierBodyDivider
            || !this.sceneDossierFooter
            || !this.sceneDossierSource
        ) {
            return;
        }
        renderInquirySceneDossier({
            refs: {
                group: this.sceneDossierGroup,
                composition: this.sceneDossierComposition,
                focusCore: this.sceneDossierFocusCore,
                focusGlow: this.sceneDossierFocusGlow,
                focusOutline: this.sceneDossierFocusOutline,
                bg: this.sceneDossierBg,
                braceLeft: this.sceneDossierBraceLeft,
                braceRight: this.sceneDossierBraceRight,
                textGroup: this.sceneDossierTextGroup,
                coreGroup: this.sceneDossierCoreGroup,
                header: this.sceneDossierHeader,
                anchor: this.sceneDossierAnchor,
                body: this.sceneDossierBody,
                bodySecondary: this.sceneDossierBodySecondary,
                bodyDivider: this.sceneDossierBodyDivider,
                footer: this.sceneDossierFooter,
                source: this.sceneDossierSource
            },
            dossier,
            rootSvg: this.rootSvg,
            previewGroup: this.previewGroup,
            computeBalancedSvgLines: this.computeBalancedSvgLines.bind(this),
            setPositionedDossierTextBlock: this.setPositionedDossierTextBlock.bind(this)
        });
        this.minimapResultPreviewActive = true;
    }

    /** Host hook: visual hide + reset the cross-cutting preview flag. */
    private clearSceneDossierVisuals(): void {
        this.sceneDossierGroup?.classList.remove('is-visible');
        this.previewGroup?.classList.remove('is-dossier-muted');
        this.minimapResultPreviewActive = false;
    }

    private setPositionedWrappedSvgText(
        textEl: SVGTextElement,
        text: string,
        maxWidth: number,
        maxLines: number,
        lineHeight: number,
        startDy: number
    ): number {
        textEl.setAttribute('y', '0');
        const lineCount = this.setWrappedSvgText(textEl, text, maxWidth, maxLines, lineHeight);
        const firstLine = textEl.firstElementChild;
        if (firstLine instanceof SVGTSpanElement) {
            firstLine.setAttribute('dy', String(startDy));
        }
        return lineCount;
    }

    private computeBalancedSvgLines(
        textEl: SVGTextElement,
        text: string,
        maxWidth: number,
        options?: {
            maxLines?: number;
            preferFrontLoaded?: boolean;
            minNonFinalFillRatio?: number;
        }
    ): string[] {
        const words = text.split(/\s+/).filter(Boolean);
        if (!words.length) return [];
        const maxLines = Math.max(options?.maxLines ?? words.length, 1);
        const minNonFinalFillRatio = Math.max(0, Math.min(options?.minNonFinalFillRatio ?? 0, 0.95)); // SAFE: optional layout tuning — 0 disables the fill-ratio floor

        const widthCache = new Map<string, number>();
        const measureWidth = (content: string): number => {
            const cached = widthCache.get(content);
            if (cached !== undefined) return cached;
            this.perfCounters.svgTextWrites++;
            textEl.textContent = content;
            const measured = textEl.getComputedTextLength();
            widthCache.set(content, measured);
            return measured;
        };

        const solveMemo = new Map<string, { cost: number; lines: string[] }>();
        const solve = (startIndex: number, linesRemaining: number): { cost: number; lines: string[] } => {
            if (startIndex >= words.length) {
                return { cost: 0, lines: [] };
            }
            if (linesRemaining <= 0) {
                return { cost: Number.POSITIVE_INFINITY, lines: [] };
            }
            const memoKey = `${startIndex}:${linesRemaining}`;
            const cached = solveMemo.get(memoKey);
            if (cached) return cached;

            let line = '';
            let best = { cost: Number.POSITIVE_INFINITY, lines: [words.slice(startIndex).join(' ')] };

            for (let endIndex = startIndex; endIndex < words.length; endIndex += 1) {
                line = line ? `${line} ${words[endIndex]}` : words[endIndex];
                const width = measureWidth(line);
                if (width > maxWidth) {
                    if (endIndex === startIndex) continue;
                    break;
                }

                const remaining = solve(endIndex + 1, linesRemaining - 1);
                if (!Number.isFinite(remaining.cost)) continue;

                const isLast = endIndex === words.length - 1;
                const fillRatio = Math.min(1, width / maxWidth);
                const slackRatio = Math.max(0, 1 - fillRatio);
                let linePenalty = slackRatio * slackRatio;
                if (!isLast && fillRatio < 0.52) {
                    linePenalty += (0.52 - fillRatio) * 1.4;
                }
                if (!isLast && minNonFinalFillRatio > 0 && fillRatio < minNonFinalFillRatio) {
                    linePenalty += (minNonFinalFillRatio - fillRatio) * 6.5;
                }
                if (isLast) {
                    linePenalty += slackRatio * slackRatio * 0.45;
                    if (fillRatio < 0.82 && startIndex > 0) {
                        linePenalty += (0.82 - fillRatio) * 4.8;
                    }
                }

                const candidateLines = [line, ...remaining.lines];
                let shapePenalty = 0;
                if (options?.preferFrontLoaded && candidateLines.length > 1) {
                    const widths = candidateLines.map(candidateLine => measureWidth(candidateLine));
                    for (let i = 1; i < widths.length; i += 1) {
                        const prev = widths[i - 1];
                        const curr = widths[i];
                        if (curr > prev) {
                            shapePenalty += ((curr - prev) / maxWidth) * 4.2;
                        }
                    }
                    const firstWidth = widths[0];
                    const lastWidth = widths[widths.length - 1];
                    if (lastWidth > firstWidth) {
                        shapePenalty += ((lastWidth - firstWidth) / maxWidth) * 5.4;
                    }
                }

                const candidateCost = linePenalty + remaining.cost + shapePenalty;
                if (candidateCost < best.cost) {
                    best = {
                        cost: candidateCost,
                        lines: candidateLines
                    };
                }
            }

            solveMemo.set(memoKey, best);
            return best;
        };

        const best = solve(0, maxLines);
        textEl.textContent = '';
        return best.lines.length ? best.lines : [words.join(' ')];
    }

    private setPositionedDossierTextBlock(
        textEl: SVGTextElement,
        text: string,
        maxWidth: number,
        lineHeight: number,
        startDy: number,
        options?: {
            align?: 'center' | 'start';
            justify?: boolean;
            preferFrontLoaded?: boolean;
            minNonFinalFillRatio?: number;
        }
    ): number {
        const align = options?.align ?? 'center'; // SAFE: optional alignment — centered by default
        const x = align === 'start' ? -maxWidth / 2 : 0;
        textEl.setAttribute('y', '0');
        textEl.setAttribute('x', String(x));
        textEl.setAttribute('text-anchor', align === 'start' ? 'start' : 'middle');

        const lines = this.computeBalancedSvgLines(textEl, text, maxWidth, {
            preferFrontLoaded: options?.preferFrontLoaded,
            minNonFinalFillRatio: options?.minNonFinalFillRatio
        });
        this.perfCounters.svgClearCalls++;
        clearSvgChildren(textEl);

        lines.forEach((line, index) => {
            this.perfCounters.svgNodeCreates++;
            const tspan = createSvgElement('tspan');
            tspan.setAttribute('x', String(x));
            tspan.setAttribute('dy', index === 0 ? String(startDy) : String(lineHeight));
            tspan.textContent = line;
            if (
                options?.justify
                && align === 'start'
                && /\s/.test(line)
            ) {
                tspan.setAttribute('textLength', String(maxWidth));
                tspan.setAttribute('lengthAdjust', 'spacing');
            }
            textEl.appendChild(tspan);
        });

        return Math.max(lines.length, 1);
    }

    private hideSceneDossier(immediate = false): void {
        this.sceneDossier?.hide(immediate);
    }

    private buildFindingMap(
        result: InquiryResult | null | undefined,
        items: InquiryCorpusItem[]
    ): Map<string, InquiryFinding> {
        const map = new Map<string, InquiryFinding>();
        if (!result) return map;
        const ordered = this.getOrderedFindings(result, result.mode || this.state.mode);
        ordered.forEach(finding => {
            if (!this.isFindingHit(finding)) return;
            const label = resolveFindingChipLabel(finding, result, items);
            if (!label) return;
            if (map.has(label)) return;
            map.set(label, finding);
        });
        return map;
    }

    private isFindingHit(finding: InquiryFinding): boolean {
        return isFindingHitPure(finding);
    }

    private formatMetricDisplay(value: number): string {
        if (!Number.isFinite(value)) return '0';
        if (value > 1) return String(Math.round(value));
        return String(Math.round(value * 100));
    }

    private normalizeMetricValue(value: number): number {
        if (!Number.isFinite(value)) return 0;
        if (value > 1) {
            const clamped = Math.min(Math.max(value, 5), 100);
            return clamped / 100;
        }
        return Math.min(Math.max(value, 0), 1);
    }

    private setHoverText(text: string): void {
        if (this.guidanceState !== 'running') return;
        if (this.hoverTextEl) {
            this.hoverTextEl.textContent = text;
        }
    }

    private clearHoverText(): void {
        if (this.guidanceState !== 'running') return;
        if (this.hoverTextEl) {
            this.hoverTextEl.textContent = '';
        }
    }

    private showPromptPreview(zone: InquiryZone, mode: InquiryLens, question: string, questionId?: string): void {
        if (this.previewLocked) return;
        if (!this.previewGroup) return;
        if (this.previewHideTimer) {
            window.clearTimeout(this.previewHideTimer);
            this.previewHideTimer = undefined;
        }
        this.previewGroup.classList.remove('is-error');
        this.setPreviewShimmerEnabled(false);
        this.setPreviewRunningNoteText('');
        this.previewLast = { zone, question, questionId };
        this.updatePromptPreview(zone, mode, question, this.getPreviewPayloadRows(zone, questionId), undefined, { hideEmpty: true });
        this.previewGroup.classList.add('is-visible');
        this.updateMinimapPressureGauge();
    }

    /**
     * Request an estimate snapshot from the service.
     *
     * This is the single entry point for triggering an estimate rebuild.
     * Called on scope change, focus book change, engine change, corpus
     * override toggle, vault file change, and view open.
     *
     * While the snapshot is building, UI shows "Estimating…" via the
     * pending flag in buildReadinessUiState().
     */
    private async requestEstimateSnapshot(): Promise<void> {
        const stats = this.getPayloadStats();
        const engine = this.getResolvedEngine();
        const activeBookId = this.getCanonicalActiveBookId();
        // Blocked engines (e.g. ollama) cannot produce estimates — skip the
        // snapshot request entirely and refresh displays to show the blocked state.
        if (engine.blocked) {
            this.refreshEstimateDisplays();
            return;
        }

        const overrides = this.getCorpusOverrideSummary();
        const manifest = this.buildCorpusManifest('estimate-snapshot');
        const targetSceneIds = this.getActiveTargetSceneIds();
        const citationsEnabled = this.areInquiryProviderCitationsEnabled(engine.provider);

        this.refreshEstimateDisplays(); // Shows "Estimating…" if snapshot is null

        const service = this.plugin.getInquiryEstimateService();
        const snapshot = await service.requestSnapshot({
            scope: this.state.scope,
            activeBookId,
            targetSceneIds,
            scopeLabel: this.getScopeLabel(),
            manifest,
            payloadStats: {
                sceneCount: stats.sceneTotal,
                outlineCount: stats.bookOutlineCount + stats.sagaOutlineCount,
                referenceCount: stats.referenceCounts.total,
                evidenceChars: stats.evidenceChars
            },
            vault: this.app.vault,
            metadataCache: this.app.metadataCache,
            frontmatterMappings: getActiveFrontmatterMappings(this.plugin.settings),
            runner: this.runner,
            engine,
            overrideSummary: overrides,
            rules: this.getEvidenceRules(),
            mode: this.state.mode,
            selectionMode: this.getSelectionMode(targetSceneIds),
            citationsEnabled,
        });

        if (!snapshot) {
            return;
        }
        this.refreshEstimateDisplays(); // Renders once with final values
    }

    /**
     * Refresh all estimate-consuming UI elements from the service snapshot.
     *
     * Reads the snapshot (or null) and updates:
     *   - Engine panel (readiness strip, popover)
     *   - Minimap pressure gauge
     *   - Preview panel pills (if visible)
     */
    private refreshEstimateDisplays(): void {
        if (this.activeCancelRunModal) return;
        this.syncEngineBadgePulse();
        this.updateMinimapPressureGauge();
        this.updateRunningHud();
        if (this.enginePanelEl && !this.enginePanelEl.classList.contains('ert-hidden')) {
            this.refreshEnginePanel();
        }
        if (!this.previewLocked
            && this.previewGroup?.classList.contains('is-visible')
            && this.previewLast) {
            this.updatePromptPreview(
                this.previewLast.zone,
                this.state.mode,
                this.previewLast.question,
                this.getPreviewPayloadRows(this.previewLast.zone, this.previewLast.questionId),
                undefined,
                { hideEmpty: true }
            );
        }
    }

    private hidePromptPreview(immediate = false): void {
        if (this.previewLocked) return;
        if (!this.previewGroup) return;
        if (this.previewHideTimer) {
            window.clearTimeout(this.previewHideTimer);
            this.previewHideTimer = undefined;
        }
        const hide = () => {
            this.setPreviewShimmerEnabled(false);
            this.previewGroup?.classList.remove('is-visible');
        };
        if (immediate) {
            hide();
            return;
        }
        this.previewHideTimer = window.setTimeout(hide, 140);
    }

    private setPreviewRowLabels(labels: string[]): void {
        if (!this.previewRows.length) return;
        this.previewRows.forEach((row, idx) => {
            row.label = labels[idx] ?? row.label;
        });
    }

    private resetPreviewRowLabels(): void {
        if (!this.previewRowDefaultLabels.length) return;
        this.previewRows.forEach((row, idx) => {
            row.label = this.previewRowDefaultLabels[idx] ?? row.label;
        });
    }

    private clearPreviewShimmerText(): void {
        if (!this.previewShimmerGroup) return;
        clearSvgChildren(this.previewShimmerGroup);
    }

    private setPreviewShimmerEnabled(enabled: boolean): void {
        if (!this.previewShimmerGroup) return;
        if (enabled) {
            this.previewShimmerGroup.removeAttribute('display');
            return;
        }
        this.clearPreviewShimmerText();
        this.previewShimmerGroup.setAttribute('display', 'none');
    }

    /**
     * Build the deterministic timing-history key for the current run.
     * Keyed by (provider, model, evidenceMode) — see inquiryTimingPrediction
     * for the rationale on why mode must be in the key.
     */
    private getInquiryTimingHistoryKey(
        provider?: string,
        model?: string,
        evidenceMode?: EvidenceModeKey
    ): string | null {
        const mode = evidenceMode ?? this.getCurrentEvidenceModeKey();
        return computeTimingHistoryKey(provider, model, mode);
    }

    /** Normalized evidence-mode key for the current corpus configuration. */
    private getCurrentEvidenceModeKey(): EvidenceModeKey {
        return normalizeEvidenceModeKey(this.describeRunEvidenceMode());
    }

    private getInquiryTimingHistoryEntry(
        provider?: string,
        model?: string,
        evidenceMode?: EvidenceModeKey
    ): InquiryTimingHistoryEntry | null {
        const key = this.getInquiryTimingHistoryKey(provider, model, evidenceMode);
        if (!key) return null;
        return this.settingsAccessor.getTimingHistory()?.[key] ?? null;
    }

    /**
     * Predict a duration range from stored history. Pure computation lives
     * in `predictTimingFromEntry`; this wrapper just routes the lookup.
     */
    private buildTimingEstimateFromHistory(
        estimatedInputTokens: number,
        provider?: string,
        model?: string,
        evidenceMode?: EvidenceModeKey
    ): { minSeconds: number; maxSeconds: number } | null {
        const entry = this.getInquiryTimingHistoryEntry(provider, model, evidenceMode);
        return predictTimingFromEntry(entry, estimatedInputTokens);
    }

    /**
     * Record one (durationMs, provider-input-tokens) sample for the current
     * (provider, model, evidenceMode) bucket.
     *
     * Two rules keep the history honest:
     *   1. Tokens used in the rate denominator come from actual provider
     *      usage, including cache reads. We do not learn from pre-run
     *      estimates.
     *   2. Bucket key includes evidence mode, so summary-mode samples
     *      cannot poison full-corpus rates.
     */
    private async recordInquiryTimingSample(result: InquiryResult, trace: InquiryRunTrace | null | undefined): Promise<void> {
        if (!result || result.aiReason === 'simulated' || result.aiReason === 'stub') return;
        const provider = result.aiProvider?.trim();
        const model = (result.aiModelResolved || result.aiModelRequested || '').trim(); // SAFE: absent model normalizes to empty and yields no history key below
        const evidenceMode = this.getCurrentEvidenceModeKey();
        const key = this.getInquiryTimingHistoryKey(provider, model, evidenceMode);
        if (!key) return;
        const durationMs = typeof result.roundTripMs === 'number' && Number.isFinite(result.roundTripMs)
            ? result.roundTripMs
            : null;

        const usage = trace?.usage
            ?? (trace?.response?.responseData && provider
                ? extractTokenUsage(provider, trace.response.responseData)
                : null);

        const sampleRate = computeSampleRate({
            usage: usage ?? undefined,
            durationMs
        });
        if (!sampleRate) return;

        const history = this.settingsAccessor.getTimingHistory() ?? {}; // SAFE: no timing history recorded yet — start from an empty map
        const previous = history[key];
        const blended = blendSampleRate({
            previousAvg: previous?.avgMsPerInputToken,
            previousSampleCount: previous?.samples,
            newRate: sampleRate.msPerInputToken
        });

        history[key] = {
            samples: blended.samples,
            avgMsPerInputToken: blended.avgMsPerInputToken,
            lastDurationMs: durationMs!,
            lastInputTokens: sampleRate.inputTokens,
            updatedAt: new Date().toISOString()
        };
        this.plugin.settings.inquiryTimingHistory = history;
        this.refreshEstimateDisplays();
        await this.plugin.saveSettings();
    }

    private setPreviewFooterText(text: string): void {
        if (this.previewFooter) {
            this.setTextIfChanged(this.previewFooter, text, 'hudTextWrites');
        }
    }

    private setPreviewRunningNoteText(text: string): void {
        if (!this.previewRunningNote) return;
        const note = text.trim();
        this.setTextIfChanged(this.previewRunningNote, note, 'hudTextWrites');
        this.toggleClassIfChanged(this.previewRunningNote, 'ert-hidden', !note, 'hudAttrWrites');
    }

    private updateRunProgress(progress: InquiryRunProgressEvent | null): void {
        this.perfCounters.progressUpdateCalls++;
        this.currentRunProgress = progress;
        if (!this.shouldApplyRunningProgressUpdates()) return;
        this.applyRunningProgressPreviewState(progress);
        this.refreshRunningProgressChrome();
    }

    private shouldApplyRunningProgressUpdates(): boolean {
        return this.state.isRunning && !this.activeCancelRunModal;
    }

    private applyRunningProgressPreviewState(progress: InquiryRunProgressEvent | null): void {
        this.reconcileRunningEstimate(progress);
        const questionText = this.previewLast?.question || this.getCurrentPromptQuestion() || ''; // SAFE: no question text available — running note renders without it
        this.setPreviewRunningNoteText(this.buildRunningStatusNote(questionText));
        this.setPreviewFooterText('');
    }

    private refreshRunningProgressChrome(): void {
        this.updateMinimapPressureGauge();
        this.updateRunningHud();
        this.perfCounters.progressDomPatches++;
        this.updateRunningState();
    }


    private estimateRunDurationRange(questionText: string): { minSeconds: number; maxSeconds: number } | null {
        const readinessUi = this.buildReadinessUiState();
        const estimatedTokens = Math.max(0, readinessUi.estimateInputTokens || 0); // SAFE: estimate unavailable — 0 tokens skips duration prediction

        // If we have history for this (provider, model, evidenceMode) bucket,
        // trust it. The blended prediction guards against single-sample
        // outliers; see predictTimingFromEntry in inquiryTimingPrediction.ts.
        const timingEstimate = this.buildTimingEstimateFromHistory(
            estimatedTokens,
            readinessUi.provider,
            readinessUi.model?.id
        );
        if (timingEstimate) {
            return timingEstimate;
        }

        if (estimatedTokens <= 0) {
            return null;
        }

        // Cold-start fallback: optimistic rate (~3000 tokens/sec input throughput).
        const coldStartMs = Math.max(6000, estimatedTokens / 3);
        return {
            minSeconds: Math.max(4, (coldStartMs * 0.7) / 1000),
            maxSeconds: Math.max(6, coldStartMs / 1000)
        };
    }

    private buildRunningProgressLabel(progress: InquiryRunProgressEvent | null): string {
        if (!progress || progress.totalPasses <= 1) return '';
        return `Pass ${progress.currentPass} of ${progress.totalPasses}.`;
    }

    private buildRunningStageLabel(progress: InquiryRunProgressEvent | null): string {
        if (!progress) return '';
        if (progress.detail?.trim()) return progress.detail.trim();
        if (progress.phase === 'finalizing') return t('inquiry.runner.finalizing');
        return t('inquiry.runner.waiting');
    }

    private cachedRunningStatusStatic?: string;
    private cachedRunningStatusQuestion?: string;

    private buildRunningStatusNote(questionText: string): string {
        if (!this.cachedRunningStatusStatic || this.cachedRunningStatusQuestion !== questionText) {
            const estimate = this.estimateRunDurationRange(questionText);
            const estimateLabel = estimate
                ? formatRunDurationEstimate(estimate.minSeconds, estimate.maxSeconds)
                : 'unavailable';
            const evidenceMode = this.describeRunEvidenceMode();
            this.cachedRunningStatusStatic = t('inquiry.runner.running', { evidenceMode, estimateLabel });
            this.cachedRunningStatusQuestion = questionText;
        }

        const progressLabel = this.buildRunningProgressLabel(this.currentRunProgress);
        return [
            this.cachedRunningStatusStatic,
            progressLabel
        ].filter(Boolean).join(' ');
    }


    private getAnthropicDispatchDiagnostics(trace: InquiryRunTrace | null | undefined): {
        requestedCacheTtl: string;
        hasCacheablePrefix: boolean;
        cachePrefixFingerprint: string;
        stableTextChars: number;
        documentBlockCount: number;
        documentChars: number;
        volatileTextChars: number;
        blockShape: string;
    } | null {
        const payload = trace?.requestPayload;
        if (!payload || typeof payload !== 'object') return null;
        const dispatchDiagnostics = (payload as Record<string, unknown>).dispatchDiagnostics;
        if (!dispatchDiagnostics || typeof dispatchDiagnostics !== 'object') return null;
        const diagnostics = dispatchDiagnostics as Record<string, unknown>;
        if (typeof diagnostics.cachePrefixFingerprint !== 'string') return null;
        return {
            requestedCacheTtl: typeof diagnostics.requestedCacheTtl === 'string' ? diagnostics.requestedCacheTtl : 'none',
            hasCacheablePrefix: diagnostics.hasCacheablePrefix === true,
            cachePrefixFingerprint: diagnostics.cachePrefixFingerprint,
            stableTextChars: typeof diagnostics.stableTextChars === 'number' ? diagnostics.stableTextChars : 0,
            documentBlockCount: typeof diagnostics.documentBlockCount === 'number' ? diagnostics.documentBlockCount : 0,
            documentChars: typeof diagnostics.documentChars === 'number' ? diagnostics.documentChars : 0,
            volatileTextChars: typeof diagnostics.volatileTextChars === 'number' ? diagnostics.volatileTextChars : 0,
            blockShape: typeof diagnostics.blockShape === 'string' ? diagnostics.blockShape : 'unknown'
        };
    }

    private getAnthropicAcceptedCacheTtl(trace: InquiryRunTrace | null | undefined): '5m' | '1h' | 'mixed' | 'unknown' {
        return getAnthropicAcceptedCacheTtlPure(trace);
    }

    private getDispatchEngineKey(result: InquiryResult): string | null {
        return getDispatchEngineKeyPure(result);
    }

    private appendAnthropicDispatchTraceNote(result: InquiryResult, trace: InquiryRunTrace | null | undefined): void {
        if (result.aiProvider?.trim().toLowerCase() !== 'anthropic' || !trace) return;
        const diagnostics = this.getAnthropicDispatchDiagnostics(trace);
        const engineKey = this.getDispatchEngineKey(result);
        if (!diagnostics || !engineKey) return;
        const previousFingerprint = this.lastAnthropicDispatchPrefixByEngine.get(engineKey);
        const sameAsPrevious = previousFingerprint === diagnostics.cachePrefixFingerprint;
        const acceptedCacheTtl = this.getAnthropicAcceptedCacheTtl(trace);
        const note = [
            'Anthropic dispatch:',
            `requested=${diagnostics.requestedCacheTtl}`,
            `accepted=${acceptedCacheTtl}`,
            `cacheable=${diagnostics.hasCacheablePrefix ? 'yes' : 'no'}`,
            `prefix=${diagnostics.cachePrefixFingerprint}`,
            `shape=${diagnostics.blockShape}`,
            `stable=${diagnostics.stableTextChars} chars`,
            `docs=${diagnostics.documentBlockCount}/${diagnostics.documentChars} chars`,
            `volatile=${diagnostics.volatileTextChars} chars`,
            `same-as-previous=${previousFingerprint ? (sameAsPrevious ? 'yes' : 'no') : 'n/a'}`,
            `previous=${previousFingerprint ?? 'none'}` // SAFE: diagnostic label — first dispatch has no previous fingerprint
        ].join(' · ');
        if (!trace.notes.includes(note)) {
            trace.notes.unshift(note);
        }
        this.lastAnthropicDispatchPrefixByEngine.set(engineKey, diagnostics.cachePrefixFingerprint);
    }

    private resolveCacheWindowMs(provider: AIProviderId, aiSettings: AiSettingsV1): number | null {
        return resolveProviderCacheWindowMs(provider, aiSettings);
    }

    private resolveCacheWindowExpiry(result: InquiryResult, trace?: InquiryRunTrace | null): number | null {
        if (this.isErrorResult(result)) return null;
        const provider = (result.aiProvider ?? '').trim().toLowerCase() as AIProviderId; // SAFE: absent provider normalizes to empty — guarded as no cache window below
        if (!provider || provider === 'none' || provider === 'ollama') return null;
        const aiSettings = this.getCanonicalAiSettings();
        const ttlMs = this.resolveCacheWindowMs(provider, aiSettings);
        if (!ttlMs) return null;

        const usage = trace?.usage;
        const hasAnthropicCacheUsage = !!(
            (usage?.cacheReadInputTokens && usage.cacheReadInputTokens > 0)
            || (usage?.cacheCreationInputTokens && usage.cacheCreationInputTokens > 0)
            || (usage?.cacheCreation5mInputTokens && usage.cacheCreation5mInputTokens > 0)
            || (usage?.cacheCreation1hInputTokens && usage.cacheCreation1hInputTokens > 0)
        );

        if (provider === 'anthropic') {
            if (!hasAnthropicCacheUsage && trace?.cacheReuseState !== 'warm') return null;
            const acceptedCacheTtl = this.getAnthropicAcceptedCacheTtl(trace);
            if (acceptedCacheTtl === '1h') {
                return Date.now() + (60 * 60 * 1000);
            }
            if (acceptedCacheTtl === '5m') {
                return Date.now() + (5 * 60 * 1000);
            }
        } else if (provider === 'google') {
            if (!trace?.cacheStatus && trace?.cacheReuseState !== 'warm') return null;
            // Gemini cache TTL is fixed at creation and does NOT extend on hits.
            // Use the provider-reported expiry so the countdown reflects the
            // actual resource lifetime instead of resetting on every reuse.
            if (typeof trace?.cacheExpiresAt === 'number' && trace.cacheExpiresAt > Date.now()) {
                return trace.cacheExpiresAt;
            }
        } else if (provider === 'openai') {
            if (trace?.cacheReuseState !== 'eligible' && trace?.cacheReuseState !== 'warm') return null;
        }

        return Date.now() + ttlMs;
    }

    private getObservedCacheMetrics(trace?: InquiryRunTrace | null): {
        cachedStableRatio: number;
        cachedStableTokens: number;
        totalInputTokens: number;
    } | null {
        const usage = trace?.usage;
        if (!usage) return null;
        // Cache-CREATE runs report cacheReadInputTokens=0; cache-HIT runs report
        // cacheCreationInputTokens=0. Nullish coalescing short-circuits at 0, so we'd lose the
        // creation-side count on the first run that primes the cache. Prefer the
        // larger of the two so either path populates the persisted metric.
        const readTokens = typeof usage.cacheReadInputTokens === 'number'
            && Number.isFinite(usage.cacheReadInputTokens) && usage.cacheReadInputTokens > 0
            ? usage.cacheReadInputTokens
            : 0;
        const creationTokens = typeof usage.cacheCreationInputTokens === 'number'
            && Number.isFinite(usage.cacheCreationInputTokens) && usage.cacheCreationInputTokens > 0
            ? usage.cacheCreationInputTokens
            : ((usage.cacheCreation5mInputTokens ?? 0) + (usage.cacheCreation1hInputTokens ?? 0)); // SAFE: providers without TTL-split cache counters contribute 0 creation tokens
        const cachedTokens = Math.max(readTokens, creationTokens);
        const totalInputTokens = typeof usage.inputTokens === 'number' && Number.isFinite(usage.inputTokens)
            ? Math.max(0, Math.floor(usage.inputTokens))
            : 0;
        if (cachedTokens <= 0 || totalInputTokens <= 0) {
            return null;
        }
        return {
            cachedStableRatio: Math.min(cachedTokens / totalInputTokens, 1),
            cachedStableTokens: Math.max(0, Math.floor(cachedTokens)),
            totalInputTokens
        };
    }

    private getCurrentCacheReuseFingerprint(): string | null {
        const context = this._currentCorpusContext ?? this.getCurrentCorpusContext();
        return context?.cacheReuseFingerprint?.trim() || null;
    }

    private getPersistedReuseAdvancedContext(): AIRunAdvancedContext | null {
        const engine = this.getResolvedEngine();
        if (!engine.modelId || engine.provider === 'none' || engine.provider === 'ollama') {
            return null;
        }
        const session = this.sessionStore.getLatestActiveCacheSessionForEngine(engine.provider, engine.modelId, {
            cacheReuseFingerprint: this.getCurrentCacheReuseFingerprint() ?? undefined,
            scope: this.state.scope
        });
        return mapSessionToPersistedReuseContextPure(session, engine.provider, engine.modelLabel, Date.now());
    }

    private getLiveReuseAdvancedContext(): AIRunAdvancedContext | null {
        const context = getLastAiAdvancedContext(this.plugin, 'InquiryMode');
        const engine = this.getResolvedEngine();
        if (engine.provider === 'none' || engine.provider === 'ollama') return null;
        return matchLiveReuseAdvancedContextPure(context, engine.provider, engine.modelLabel);
    }


    private getEffectiveReuseAdvancedContext(): AIRunAdvancedContext | null {
        // Preserve persisted-then-live evaluation order (args evaluate
        // left-to-right). Selection logic is the pure module helper.
        const persisted = this.getPersistedReuseAdvancedContext();
        const live = this.getLiveReuseAdvancedContext();
        return pickEffectiveReuseAdvancedContextPure(persisted, live);
    }

    private getActiveCacheWindowExpiry(): number | null {
        const session = this.getLatestCacheSessionForResolvedEngine();
        return resolveActiveCacheWindowExpiryPure(session, Date.now());
    }

    private getLatestCacheSessionForResolvedEngine(): InquirySession | null {
        const engine = this.getResolvedEngine();
        if (!engine.modelId || engine.provider === 'none' || engine.provider === 'ollama') {
            return null;
        }
        return this.sessionStore.getLatestActiveCacheSessionForEngine(engine.provider, engine.modelId, {
            cacheReuseFingerprint: this.getCurrentCacheReuseFingerprint() ?? undefined,
            scope: this.state.scope
        }) ?? null;
    }

    private buildContextCountdownLabel(): string | null {
        const session = this.getLatestCacheSessionForResolvedEngine();
        return formatContextCountdownLabelPure(session, Date.now());
    }

    private clearContextWindow(): void {
        const session = this.getLatestCacheSessionForResolvedEngine();
        if (!session?.cacheWindowExpiresAt) return;
        delete session.cacheWindowExpiresAt;
        this.sessionStore.setSession(session);
        this.updateRunningHud();
    }

    private reconcileRunningEstimate(progress: InquiryRunProgressEvent | null): void {
        if (!progress || this.currentRunElapsedMs <= 0) return;
        if (progress.phase === 'finalizing') {
            this.currentRunEstimatedMaxMs = Math.max(this.currentRunElapsedMs, 1000);
            return;
        }
        const completedPasses = Math.max(0, Math.min(progress.totalPasses, progress.currentPass - 1));
        if (completedPasses <= 0 || progress.totalPasses <= 0) return;
        const observedMsPerPass = this.currentRunElapsedMs / completedPasses;
        const remainingPasses = Math.max(1, progress.totalPasses - completedPasses);
        const projectedTotalMs = this.currentRunElapsedMs + (observedMsPerPass * remainingPasses);
        this.currentRunEstimatedMaxMs = Math.max(this.currentRunElapsedMs + 1000, Math.round(projectedTotalMs));
    }

    private getRunningBackboneProgressRatio(elapsedMs: number): number {
        const estimateMaxMs = Math.max(1000, this.currentRunEstimatedMaxMs || 0); // SAFE: no estimate yet — clamps to the 1s minimum
        const timeRatio = estimateMaxMs > 0 ? Math.min(1, Math.max(0, elapsedMs / estimateMaxMs)) : 0;
        const progress = this.currentRunProgress;
        if (!progress) return timeRatio;
        if (progress.phase === 'finalizing') return 1;
        const completedPassRatio = progress.totalPasses > 0
            ? Math.max(0, Math.min(1, (progress.currentPass - 1) / progress.totalPasses))
            : 0;
        return Math.max(timeRatio, completedPassRatio);
    }

    private updateRunningHudFrame(elapsedMs: number): void {
        if (!this.state.isRunning) return;
        this.currentRunElapsedMs = elapsedMs;
        // HUD text updates are now managed by a decoupled setInterval to prevent 60fps layout thrash
        this.minimap.setRunningBackboneProgress(this.getRunningBackboneProgressRatio(elapsedMs));
    }

    private updateRunningHud(): void {
        const contextLabel = this.state.isRunning ? null : this.buildContextCountdownLabel();
        const hasWarmContextCountdown = !this.state.isRunning && !!this.getActiveCacheWindowExpiry();
        const hasLiveContextCountdown = !this.state.isRunning && !!this.getActiveCacheWindowExpiry();
        renderInquiryRunningHud({
            engineTimerIcon: this.engineTimerIcon,
            engineTimerLabel: this.engineTimerLabel,
            navSessionLabel: this.navSessionLabel,
            isRunning: this.state.isRunning,
            currentRunElapsedMs: this.currentRunElapsedMs,
            currentRunProgress: this.currentRunProgress,
            formatElapsedRunClock,
            buildRunningStageLabel: this.buildRunningStageLabel.bind(this),
            engineTimerText: this.state.isRunning
                ? formatElapsedRunClock(this.currentRunElapsedMs)
                : (contextLabel ?? ''), // SAFE: no warm-context label — engine timer text renders empty
            engineTimerVisible: this.state.isRunning || !!contextLabel,
            engineTimerIconVisible: hasWarmContextCountdown,
            setTextIfChanged: (el, text) => this.setTextIfChanged(el, text, 'hudTextWrites'),
            toggleClassIfChanged: (el, cls, force) => this.toggleClassIfChanged(el, cls, force, 'hudAttrWrites')
        });
        if (this.engineTimerIcon) {
            this.toggleClassIfChanged(this.engineTimerIcon, 'is-context-countdown', !!contextLabel, 'hudAttrWrites');
            this.toggleClassIfChanged(this.engineTimerIcon, 'is-context-warm', hasWarmContextCountdown, 'hudAttrWrites');
        }
        if (this.engineTimerLabel) {
            this.toggleClassIfChanged(this.engineTimerLabel, 'is-context-countdown', !!contextLabel, 'hudAttrWrites');
            this.toggleClassIfChanged(this.engineTimerLabel, 'is-context-warm', hasWarmContextCountdown, 'hudAttrWrites');
        }
        if (!this.state.isRunning) {
            this.reconcileEngineTimerInterval(hasLiveContextCountdown);
        }
    }

    private describeRunEvidenceMode(): string {
        const stats = this.getPayloadStats();
        const summaryCount = stats.sceneSynopsisUsed + stats.bookOutlineSummaryCount + stats.sagaOutlineSummaryCount;
        const bodyCount = stats.sceneFullTextCount + stats.bookOutlineFullCount + stats.sagaOutlineFullCount;
        if (summaryCount > 0 && bodyCount === 0) return 'Summary evidence';
        if (bodyCount > 0 && summaryCount === 0) return 'Full Scene evidence';
        if (summaryCount > 0 && bodyCount > 0) return 'Mixed evidence';
        return 'Corpus evidence';
    }

    private async promptCancelInquiryRun(questionText: string): Promise<boolean> {
        const estimate = this.estimateRunDurationRange(questionText);
        const estimateLabel = estimate
            ? formatRunDurationEstimate(estimate.minSeconds, estimate.maxSeconds)
            : 'unavailable';
        return await new Promise<boolean>(resolve => {
            const modal = new InquiryCancelRunModal(
                this.app,
                estimateLabel,
                confirmed => resolve(confirmed),
                () => {
                    if (this.activeCancelRunModal === modal) {
                        this.activeCancelRunModal = undefined;
                    }
                    this.refreshEstimateDisplays();
                    if (this.state.isRunning) {
                        this.updateRunProgress(this.currentRunProgress);
                    }
                }
            );
            this.activeCancelRunModal = modal;
            modal.open();
        });
    }

    private async handleRunningPreviewCancelClick(): Promise<void> {
        if (!this.state.isRunning) return;
        if (!this.activeInquiryRunToken) {
            this.notifyInteraction(t('inquiry.interaction.cancelOnlySingleQuestion'));
            return;
        }
        const questionText = this.previewLast?.question
            || this.getCurrentPromptQuestion()
            || ''; // SAFE: no question text available — cancel prompt renders without it
        const confirmed = await this.promptCancelInquiryRun(questionText);
        if (!confirmed) return;
        this.requestActiveInquiryCancellation();
    }

    private updatePromptPreview(
        zone: InquiryZone,
        mode: InquiryLens,
        question: string,
        rowsOverride?: string[],
        metaOverride?: string,
        layoutOptions?: { hideEmpty?: boolean }
    ): void {
        this.syncHistoryRowLabel();
        this.previewPanelHeight = renderInquiryPromptPreviewLayout({
            refs: {
                previewGroup: this.previewGroup,
                previewHero: this.previewHero,
                previewMeta: this.previewMeta,
                previewFooter: this.previewFooter,
                previewClickTarget: this.previewClickTarget,
                previewRows: this.previewRows,
                previewRunningNote: this.previewRunningNote,
                previewShimmerGroup: this.previewShimmerGroup,
                previewShimmerMask: this.previewShimmerMask,
                previewShimmerMaskRect: this.previewShimmerMaskRect,
                previewPanelHeight: this.previewPanelHeight
            },
            zone,
            mode,
            question,
            rows: rowsOverride ?? this.getPreviewPayloadRows(zone, this.previewLast?.questionId),
            metaOverride,
            hideEmpty: layoutOptions?.hideEmpty,
            isRunning: this.state.isRunning,
            minimapLayoutLength: this.minimap.layoutLength,
            setBalancedHeroText: this.setBalancedHeroText.bind(this),
            setWrappedSvgText: this.setWrappedSvgText.bind(this),
            onSvgClear: () => {
                this.perfCounters.svgClearCalls++;
            },
            onSvgNodeCreate: () => {
                this.perfCounters.svgNodeCreates++;
            }
        });
        this.updatePreviewShimmerLayout();
        if (this.previewShimmerGroup) {
            if (this.previewGroup?.classList.contains('is-locked')) {
                this.setPreviewShimmerEnabled(true);
                this.updatePreviewShimmerText();
            } else {
                this.setPreviewShimmerEnabled(false);
            }
        }
        this.syncTokensPillState();
        if (this.enginePanelEl && !this.enginePanelEl.classList.contains('ert-hidden')) {
            this.refreshEnginePanel();
        }
    }

    private showResultsPreview(result: InquiryResult): void {
        if (!this.previewGroup || !this.previewHero) return;
        if (this.isErrorResult(result)) return;
        this.hideSceneDossier(true);
        if (this.previewHideTimer) {
            window.clearTimeout(this.previewHideTimer);
            this.previewHideTimer = undefined;
        }
        const zone = result.questionZone ?? this.findPromptZoneById(result.questionId) ?? 'setup'; // SAFE: legacy results predate zone metadata — setup is the default zone
        const mode = this.state.mode;
        this.previewLocked = true;
        this.previewGroup.classList.add('is-visible', 'is-results');
        this.previewGroup.classList.remove('is-locked', 'is-error');
        this.setPreviewShimmerEnabled(false);
        this.setPreviewRunningNoteText('');
        const hero = this.buildResultsHeroText(result, mode);
        const meta = this.buildResultsMetaText(result, mode, zone);
        const emptyRows = Array(this.previewRows.length || 6).fill(''); // SAFE: rows not built yet — render six placeholder rows
        this.resetPreviewRowLabels();
        this.updatePromptPreview(zone, mode, hero, emptyRows, meta, { hideEmpty: true });
        this.setPreviewHeroNormalizationTooltip(result);
        const scopeTypeLabel = result.scope === 'saga' ? 'Saga' : 'Book';
        const resultScopeLabel = result.scopeLabel || this.getScopeLabel();
        this.setPreviewFooterText(t('inquiry.findings.previewFooterDismiss', { scopeTypeLabel, resultScopeLabel }));
        this.updateResultsFooterPosition();
    }

    private setPreviewHeroNormalizationTooltip(result: InquiryResult): void {
        if (!this.previewHero) return;
        const existing = this.previewHero.querySelector('title');
        if (existing) existing.remove();
        if ((result.refNormalizationCount ?? 0) > 0) { // SAFE: older results lack the count — 0 hides the normalization tooltip
            const title = this.previewHero.ownerDocument.win.createSvg('title');
            title.textContent = t('inquiry.findings.referencesNormalized');
            this.previewHero.appendChild(title);
        }
    }

    private buildResultsHeroText(result: InquiryResult, mode: InquiryLens): string {
        return buildResultsHeroTextPure(
            result,
            mode,
            (r, m) => this.getResultSummaryForMode(r, m)
        );
    }

    private buildResultsMetaText(result: InquiryResult, mode: InquiryLens, zone: InquiryZone): string {
        return buildResultsMetaTextPure(
            result,
            mode,
            zone,
            (value) => this.formatMetricDisplay(value),
            (r) => this.getResultSelectionMode(r)
        );
    }

    private getResultItems(result: InquiryResult): InquiryCorpusItem[] {
        if (!this.corpus) return [];
        if (result.scope === 'book' && !this.corpus.bookResolved) return [];
        return result.scope === 'saga' ? this.corpus.books : this.corpus.scenes;
    }



    private getResultSummaryForMode(result: InquiryResult, mode: InquiryLens): string {
        return getResultSummaryForModePure(result, mode);
    }

    private getOrderedFindings(result: InquiryResult, mode: InquiryLens): InquiryFinding[] {
        return getOrderedFindingsPure(result, mode);
    }

    private getFindingRole(finding: InquiryFinding): FindingRole {
        return getFindingRolePure(finding);
    }

    private updateFindingsPanel(): void {
        if (!this.findingsTitleEl || !this.summaryEl || !this.verdictEl || !this.findingsListEl) return;
        const findingsListEl = this.findingsListEl;
        clearSvgChildren(this.findingsListEl);

        const result = this.state.activeResult;
        if (!result) {
            const activeTargetCount = this.getActiveTargetSceneIds().length;
            const storedTargetCount = this.state.targetSceneIds.length;
            const focusedCount = this.state.scope === 'book' ? activeTargetCount : storedTargetCount;
            const targetCountLabel = focusedCount === 1 ? t('inquiry.findings.oneTargetScene') : t('inquiry.findings.multipleTargetScenes', { count: focusedCount });
            this.findingsTitleEl.textContent = focusedCount > 0 ? t('inquiry.findings.findingsWithCount', { label: targetCountLabel }) : t('inquiry.findings.findings');
            this.findingsTitleEl.classList.remove('is-role-validation-warning');
            this.summaryEl.classList.remove('is-role-validation-warning');
            this.verdictEl.classList.remove('is-role-validation-warning');
            this.summaryEl.textContent = t('inquiry.findings.noInquiryRun');
            this.verdictEl.textContent = this.state.scope === 'saga' && storedTargetCount > 0
                ? t('inquiry.findings.verdictBookScoped', { label: targetCountLabel })
                : t('inquiry.findings.runToSeeVerdicts');
            return;
        }

        const selectionMode = this.getResultSelectionMode(result);
        const roleValidation = this.getResultRoleValidation(result);
        const persistedTargetSceneIds = this.getPersistedResultTargetSceneIds(result);
        const focusedCount = persistedTargetSceneIds.length;
        const targetCountLabel = focusedCount === 1 ? t('inquiry.findings.oneTargetScene') : t('inquiry.findings.multipleTargetScenes', { count: focusedCount });
        this.findingsTitleEl.textContent = selectionMode === 'focused'
            ? t('inquiry.findings.findingsWithCount', { label: targetCountLabel })
            : t('inquiry.findings.findings');
        this.findingsTitleEl.classList.toggle('is-role-validation-warning', roleValidation === 'missing-target-roles');
        this.summaryEl.classList.toggle('is-role-validation-warning', roleValidation === 'missing-target-roles');
        this.verdictEl.classList.toggle('is-role-validation-warning', roleValidation === 'missing-target-roles');

        const orderedFindings = this.getOrderedFindings(result, result.mode || this.state.mode);
        const targetFindings = orderedFindings.filter(finding => this.getFindingRole(finding) === 'target');
        const contextFindings = orderedFindings.filter(finding => this.getFindingRole(finding) === 'context');

        this.summaryEl.textContent = this.buildResultsHeroText(result, this.state.mode);
        const selectionText = selectionMode === 'focused'
            ? t('inquiry.findings.selectionFocused', { targetCount: targetFindings.length, contextCount: contextFindings.length })
            : t('inquiry.findings.selectionDiscover');
        const validationNote = roleValidation === 'missing-target-roles'
            ? ` · ${t('inquiry.findings.validationMissingTargetRoles')}`
            : '';
        const scopeNote = this.state.scope === 'saga' && this.state.targetSceneIds.length > 0
            ? ` · ${t('inquiry.findings.scopeNoteTargetBookOnly')}`
            : '';
        const integrity = computeCitationIntegritySummary(result);
        const citationWord = integrity.unverifiedCount === 1 ? 'citation' : 'citations';
        const integrityNote = integrity.evidenceCompromised
            ? ` · ${t('inquiry.findings.integrityCompromised', { count: integrity.unverifiedCount, citationWord })}`
            : integrity.unverifiedCount > 0
                ? ` · ${t('inquiry.findings.integrityWarning', { count: integrity.unverifiedCount, citationWord })}`
                : '';
        this.verdictEl.textContent = `${selectionText}${validationNote}${scopeNote}${integrityNote}`;
        this.verdictEl.classList.toggle('is-citation-integrity-warning', integrity.unverifiedCount > 0 && !integrity.evidenceCompromised);
        this.verdictEl.classList.toggle('is-citation-evidence-compromised', integrity.evidenceCompromised);

        let cursorY = 0;
        const renderSection = (title: string, findings: InquiryFinding[]) => {
            createSvgText(findingsListEl, 'ert-inquiry-finding-section', title, 0, cursorY);
            cursorY += 18;
            if (!findings.length) {
                createSvgText(findingsListEl, 'ert-inquiry-finding-meta', t('inquiry.findings.empty'), 0, cursorY);
                cursorY += 18;
                return;
            }
            findings.forEach(finding => {
                const row = buildFindingRowDataPure(finding, result.mode);
                createSvgText(
                    findingsListEl,
                    `ert-inquiry-finding-head is-role-${row.role}`,
                    `${row.roleLabel} ${row.headline}`,
                    0,
                    cursorY
                );
                cursorY += 16;
                createSvgText(
                    findingsListEl,
                    'ert-inquiry-finding-meta',
                    t('inquiry.findings.lens', { label: row.lensLabel }),
                    0,
                    cursorY
                );
                cursorY += 14;
                row.bullets.forEach(bullet => {
                    createSvgText(findingsListEl, 'ert-inquiry-finding-bullet', `• ${bullet}`, 12, cursorY);
                    cursorY += 14;
                });
                cursorY += 8;
            });
        };

        renderSection(t('inquiry.findings.targetSection'), targetFindings);
        renderSection(t('inquiry.findings.contextSection'), contextFindings);

        const unverifiedFindings = result.unverifiedFindings || []; // SAFE: results without unverified findings render no warning section
        if (unverifiedFindings.length) {
            const severityClass = integrity.evidenceCompromised
                ? 'is-citation-evidence-compromised'
                : 'is-citation-integrity-warning';
            createSvgText(
                findingsListEl,
                `ert-inquiry-finding-section ${severityClass}`,
                t('inquiry.findings.unverifiedSection', { count: unverifiedFindings.length }),
                0,
                cursorY
            );
            cursorY += 18;
            createSvgText(
                findingsListEl,
                `ert-inquiry-finding-meta ${severityClass}`,
                t('inquiry.findings.unverifiedWarning'),
                0,
                cursorY
            );
            cursorY += 16;
            unverifiedFindings.forEach(item => {
                const row = buildUnverifiedFindingRowDataPure(item);
                createSvgText(
                    findingsListEl,
                    `ert-inquiry-finding-head ${severityClass}`,
                    `${t('inquiry.findings.unverifiedHeadlinePrefix')}${row.headline}`,
                    0,
                    cursorY
                );
                cursorY += 16;
                createSvgText(
                    findingsListEl,
                    `ert-inquiry-finding-meta ${severityClass}`,
                    t('inquiry.findings.citedAs', { descriptor: row.citedAsDescriptor }),
                    0,
                    cursorY
                );
                cursorY += 14;
                row.bullets.forEach(bullet => {
                    createSvgText(findingsListEl, 'ert-inquiry-finding-bullet', `• ${bullet}`, 12, cursorY);
                    cursorY += 14;
                });
                cursorY += 8;
            });
        }
    }

    private truncatePreviewValue(value: string, maxChars: number): string {
        const trimmed = value.trim();
        if (trimmed.length <= maxChars) return trimmed;
        return `${trimmed.slice(0, Math.max(0, maxChars - 3)).trim()}...`;
    }

    private setBalancedHeroText(
        textEl: SVGTextElement,
        text: string,
        maxWidth: number,
        lineHeight: number,
        maxLines = 2
    ): number {
        const cacheKey = `${text}|${maxWidth}|${lineHeight}`;
        if (textEl.getAttribute('data-rt-hero-cache') === cacheKey) {
            return Number(textEl.getAttribute('data-rt-hero-lines')) || 1; // SAFE: cached hero renders at least one line
        }
        
        // Wipe existing content for measuring pass.
        // Invalidate the wrapped-text cache since measurement destroys tspans —
        // without this, a subsequent setWrappedSvgText fallback would hit a stale
        // cache and return without re-creating the DOM, leaving only the last
        // measurement string visible (the "ghost fragment" bug).
        this.perfCounters.svgClearCalls++;
        clearSvgChildren(textEl);
        textEl.removeAttribute('data-rt-wrap-cache');
        
        const words = text.split(/\s+/).filter(Boolean);
        if (!words.length) return 0;
        const fullLine = words.join(' ');
        textEl.textContent = fullLine;
        const fullWidth = textEl.getComputedTextLength();
        if (fullWidth <= maxWidth) {
            textEl.setAttribute('data-rt-hero-cache', cacheKey);
            textEl.setAttribute('data-rt-hero-lines', '1');
            return 1;
        }
        if (maxLines <= 1) {
            return this.setWrappedSvgText(textEl, text, maxWidth, 1, lineHeight);
        }

        const minWordsPerLine = 3;
        let bestIndex = -1;
        let bestScore = Number.POSITIVE_INFINITY;
        let bestWidths: { width1: number; width2: number } | null = null;
        for (let i = minWordsPerLine; i <= words.length - minWordsPerLine; i += 1) {
            const line1 = words.slice(0, i).join(' ');
            const line2 = words.slice(i).join(' ');
            textEl.textContent = line1;
            const width1 = textEl.getComputedTextLength();
            textEl.textContent = line2;
            const width2 = textEl.getComputedTextLength();
            const overflow = Math.max(0, width1 - maxWidth) + Math.max(0, width2 - maxWidth);
            const score = Math.abs(width1 - width2) + (overflow * 3);
            if (score < bestScore) {
                bestScore = score;
                bestIndex = i;
                bestWidths = { width1, width2 };
            }
        }

        if (bestIndex < 0 || !bestWidths) {
            return this.setWrappedSvgText(textEl, text, maxWidth, maxLines, lineHeight);
        }

        if (bestWidths.width1 > maxWidth || bestWidths.width2 > maxWidth) {
            return this.setWrappedSvgText(textEl, text, maxWidth, maxLines, lineHeight);
        }

        // Final layout achieved - attach the fixed lines via tspans
        this.perfCounters.svgClearCalls++;
        clearSvgChildren(textEl);
        const x = textEl.getAttribute('x') ?? '0'; // SAFE: text element without an x attribute anchors tspans at 0
        const appendTspan = (content: string, isFirst: boolean): SVGTSpanElement => {
            this.perfCounters.svgNodeCreates++;
            const tspan = createSvgElement('tspan');
            tspan.setAttribute('x', x);
            tspan.setAttribute('dy', isFirst ? '0' : String(lineHeight));
            tspan.textContent = content;
            textEl.appendChild(tspan);
            return tspan;
        };

        const line1Out = words.slice(0, bestIndex).join(' ');
        const line2Out = words.slice(bestIndex).join(' ');
        appendTspan(line1Out, true);
        appendTspan(line2Out, false);
        
        textEl.setAttribute('data-rt-hero-cache', cacheKey);
        textEl.setAttribute('data-rt-hero-lines', '2');
        return 2;
    }

    private ensurePreviewShimmerResources(panel: SVGGElement): void {
        if (this.previewShimmerMask) return;

        // Gradient for the shimmer band
        // Gradients usually live in defs, which is fine. CSS addressing of the rect using the url(#grad) doesn't require the gradient to be in the same scope, just available.
        if (this.svgDefs && !this.svgDefs.querySelector('#ert-inquiry-preview-shimmer-grad')) {
            const gradient = createSvgElement('linearGradient');
            gradient.setAttribute('id', 'ert-inquiry-preview-shimmer-grad');
            gradient.setAttribute('x1', '0%');
            gradient.setAttribute('y1', '0%');
            gradient.setAttribute('x2', '100%');
            gradient.setAttribute('y2', '0%');
            const stops = [
                { offset: '0%', opacity: '0' },
                { offset: '10%', opacity: '0.08' },
                { offset: '25%', opacity: '0.4' },
                { offset: '50%', opacity: '1' },
                { offset: '75%', opacity: '0.4' },
                { offset: '90%', opacity: '0.08' },
                { offset: '100%', opacity: '0' }
            ];
            stops.forEach(stopDef => {
                const stop = createSvgElement('stop');
                stop.setAttribute('offset', stopDef.offset);
                stop.setAttribute('stop-color', '#fff'); // White mask = reveal
                stop.setAttribute('stop-opacity', stopDef.opacity);
                gradient.appendChild(stop);
            });
            this.svgDefs.appendChild(gradient);
        }

        // Mask that contains the moving/animating rect
        const mask = createSvgElement('mask');
        mask.setAttribute('id', 'ert-inquiry-preview-shimmer-mask');
        mask.setAttribute('maskUnits', 'userSpaceOnUse');

        // The moving band
        const band = createSvgElement('rect');
        band.classList.add('ert-inquiry-preview-shimmer-band'); // New class for the band
        band.setAttribute('fill', 'url(#ert-inquiry-preview-shimmer-grad)');
        // Initial values, will be updated by layout
        band.setAttribute('x', '0');
        band.setAttribute('y', '0');
        band.setAttribute('width', '100');
        band.setAttribute('height', '100');

        mask.appendChild(band);
        this.previewShimmerMask = mask;
        this.previewShimmerMaskRect = band;
        // Append mask to panel so its children can be targeted by CSS selectors scoped to the panel
        panel.appendChild(mask);
    }

    private updatePreviewShimmerText(): void {
        updateInquiryPreviewShimmerText({
            previewShimmerGroup: this.previewShimmerGroup,
            previewHero: this.previewHero
        });
    }

    private updatePreviewShimmerLayout(): void {
        updateInquiryPreviewShimmerLayout({
            refs: {
                previewGroup: this.previewGroup,
                previewHero: this.previewHero,
                previewMeta: this.previewMeta,
                previewFooter: this.previewFooter,
                previewClickTarget: this.previewClickTarget,
                previewRows: this.previewRows,
                previewRunningNote: this.previewRunningNote,
                previewShimmerGroup: this.previewShimmerGroup,
                previewShimmerMask: this.previewShimmerMask,
                previewShimmerMaskRect: this.previewShimmerMaskRect,
                previewPanelHeight: this.previewPanelHeight
            },
            isRunning: this.state.isRunning
        });
    }

    private updateResultsFooterPosition(targetY?: number): void {
        const panelY = targetY ?? this.minimap.getPreviewPanelTargetY();
        if (!Number.isFinite(panelY)) return;
        updateInquiryResultsFooterPosition({
            refs: {
                previewGroup: this.previewGroup,
                previewHero: this.previewHero,
                previewMeta: this.previewMeta,
                previewFooter: this.previewFooter,
                previewClickTarget: this.previewClickTarget,
                previewRows: this.previewRows,
                previewRunningNote: this.previewRunningNote,
                previewShimmerGroup: this.previewShimmerGroup,
                previewShimmerMask: this.previewShimmerMask,
                previewShimmerMaskRect: this.previewShimmerMaskRect,
                previewPanelHeight: this.previewPanelHeight
            },
            isRunning: this.state.isRunning,
            panelY,
            backboneBottom: this.minimap.backboneBottomEdge
        });
    }

    private updatePreviewClickTargetLayout(): void {
        updateInquiryPreviewClickTargetLayout({
            refs: {
                previewGroup: this.previewGroup,
                previewHero: this.previewHero,
                previewMeta: this.previewMeta,
                previewFooter: this.previewFooter,
                previewClickTarget: this.previewClickTarget,
                previewRows: this.previewRows,
                previewRunningNote: this.previewRunningNote,
                previewShimmerGroup: this.previewShimmerGroup,
                previewShimmerMask: this.previewShimmerMask,
                previewShimmerMaskRect: this.previewShimmerMaskRect,
                previewPanelHeight: this.previewPanelHeight
            },
            isRunning: this.state.isRunning
        });
    }

    private lockPromptPreview(question: InquiryQuestion, questionText: string): void {
        if (!this.previewGroup) return;
        if (this.previewHideTimer) {
            window.clearTimeout(this.previewHideTimer);
            this.previewHideTimer = undefined;
        }
        const rows = this.getPreviewPayloadRows(question.zone, question.id);
        this.previewLocked = true;
        this.previewGroup.classList.add('is-visible', 'is-locked');
        this.previewGroup.classList.remove('is-results');
        this.previewGroup.classList.remove('is-error');
        this.setPreviewShimmerEnabled(true);
        this.setPreviewRunningNoteText(this.buildRunningStatusNote(questionText));
        this.setPreviewFooterText('');
        this.resetPreviewRowLabels();
        this.previewLast = { zone: question.zone, question: questionText, questionId: question.id };
        this.updatePromptPreview(question.zone, this.state.mode, questionText, rows, undefined, { hideEmpty: true });
        this.updateMinimapPressureGauge();
    }

    private unlockPromptPreview(): void {
        this.previewLocked = false;
        this.currentRunProgress = null;
        if (this.previewHideTimer) {
            window.clearTimeout(this.previewHideTimer);
            this.previewHideTimer = undefined;
        }
        if (this.previewGroup) {
            this.previewGroup.classList.remove('is-locked', 'is-visible', 'is-results');
            this.previewGroup.classList.remove('is-error');
        }
        this.resetPreviewRowLabels();
        this.setPreviewShimmerEnabled(false);
        this.setPreviewRunningNoteText('');
        this.setPreviewFooterText('');
        this.updateMinimapPressureGauge();
    }

    private syncTokensPillState(): void {
        if (!this.previewRows.length) return;
        this.previewRows.forEach(row => {
            row.group.classList.remove('is-token-amber', 'is-token-red');
            row.group.removeAttribute('data-rt-tip');
            row.group.removeAttribute('data-rt-tip-placement');
        });
        if (this.previewGroup?.classList.contains('is-results')) return;

        const staleState = this.getHoveredQuestionStaleState();
        if (staleState.isStale) {
            const historyRow = this.previewRows.find(row => row.group.classList.contains('is-history-slot'));
            if (historyRow && !historyRow.group.classList.contains('ert-hidden')) {
                historyRow.group.classList.add('is-token-amber');
                const detail = staleState.diagnosis?.tooltipLines.length
                    ? staleState.diagnosis.tooltipLines.join('\n')
                    : 'Corpus has changed since this run.';
                addTooltipData(
                    historyRow.group,
                    balanceTooltipText(`Stale - corpus changed.\n${detail}\nClick to run fresh.`),
                    'top'
                );
            }
        }

        const tokensRow = this.previewRows.find(row => row.group.classList.contains('is-tokens-slot'));
        if (!tokensRow) return;
    }

    private syncHistoryRowLabel(): void {
        const historyRow = this.previewRows.find(row => row.group.classList.contains('is-history-slot'));
        if (!historyRow) return;
        const defaultLabel = this.previewRowDefaultLabels.find((_, idx) =>
            this.previewRows[idx]?.group.classList.contains('is-history-slot')
        ) ?? 'Prior result ·'; // SAFE: UX default row label when no default label matches the history slot
        const staleState = this.getHoveredQuestionStaleState();
        historyRow.label = staleState.isStale ? 'Stale - corpus changed ·' : defaultLabel;
    }

    private isHoveredQuestionStale(): boolean {
        return this.getHoveredQuestionStaleState().isStale;
    }

    private getHoveredQuestionStaleDiagnosis(): InquiryStaleDiagnosis | null {
        return this.getHoveredQuestionStaleState().diagnosis;
    }

    private getHoveredQuestionStaleState(): { isStale: boolean; diagnosis: InquiryStaleDiagnosis | null } {
        const hoveredId = this.previewLast?.questionId;
        if (!hoveredId) return { isStale: false, diagnosis: null };
        if (this.previewGroup?.classList.contains('is-results')) return { isStale: false, diagnosis: null };
        const { staleIds, staleDiagnoses } = this.computePromptCacheStates();
        const diagnosis = staleDiagnoses.get(hoveredId);
        return {
            isStale: staleIds.has(hoveredId),
            diagnosis: diagnosis || null
        };
    }

    /**
     * SVG text measurement (getComputedTextLength) returns 0 when the leaf is
     * hidden (display:none) or detached. A probe tspan lets the wrap logic tell
     * "this text genuinely has zero width" from "this element cannot currently
     * be measured" — the latter must never be cached as a real wrap result.
     */
    private isSvgTextMeasurable(textEl: SVGTextElement, sampleText: string): boolean {
        const sample = sampleText.trim();
        if (!sample) return true;
        const probe = createSvgElement('tspan');
        probe.textContent = sample;
        textEl.appendChild(probe);
        const measurable = probe.getComputedTextLength() > 0;
        textEl.removeChild(probe);
        return measurable;
    }

    private setWrappedSvgText(
        textEl: SVGTextElement,
        text: string,
        maxWidth: number,
        maxLines: number,
        lineHeight: number,
        options?: {
            preferFrontLoaded?: boolean;
            minNonFinalFillRatio?: number;
        }
    ): number {
        const preferFrontLoaded = options?.preferFrontLoaded === true;
        const minNonFinalFillRatio = typeof options?.minNonFinalFillRatio === 'number'
            ? Math.max(0, Math.min(options.minNonFinalFillRatio, 0.95))
            : 0;
        const cacheKey = `${text}|${maxWidth}|${maxLines}|${lineHeight}|${preferFrontLoaded ? 1 : 0}|${minNonFinalFillRatio}`;
        if (textEl.getAttribute('data-rt-wrap-cache') === cacheKey) {
            return Number(textEl.getAttribute('data-rt-wrap-lines')) || 1; // SAFE: cached wrap renders at least one line
        }

        // Invalidate sibling cache — setBalancedHeroText may have left a stale
        // hero-cache attribute from a previous render path.
        textEl.removeAttribute('data-rt-hero-cache');

        Array.from(textEl.childNodes).forEach(node => {
            if (node.nodeName !== 'tspan') {
                this.perfCounters.svgClearCalls++;
                textEl.removeChild(node);
            }
        });

        const words = text.split(/\s+/).filter(Boolean);
        const x = textEl.getAttribute('x') ?? '0'; // SAFE: text element without an x attribute anchors tspans at 0

        // Single stamp path for both wrap branches. Skip caching when the
        // element is not currently measurable (hidden leaf) so the one-line
        // collapse it produces is not frozen — active-leaf-change recomputes
        // it when the view becomes visible.
        const measurable = this.isSvgTextMeasurable(textEl, text);
        const stampWrapCache = (exactLines: number): number => {
            if (measurable) {
                textEl.setAttribute('data-rt-wrap-cache', cacheKey);
                textEl.setAttribute('data-rt-wrap-lines', String(exactLines));
            }
            return exactLines;
        };

        // Compute balanced lines BEFORE capturing existingTspans.
        // computeBalancedSvgLines uses textEl.textContent = ... for measurement,
        // which destroys all child nodes (including tspans). Capturing tspan refs
        // before this call creates orphaned references that are never re-appended,
        // causing blank hero text on lens toggle (depth view blank bug).
        const balancedLines = maxLines > 1
            ? this.computeBalancedSvgLines(textEl, text, maxWidth, {
                maxLines,
                preferFrontLoaded,
                minNonFinalFillRatio
            })
            : [];

        const existingTspans = Array.from(textEl.childNodes).filter(n => n.nodeName === 'tspan') as SVGTSpanElement[];
        let tspanCount = 0;

        const getNextTspan = (isFirst: boolean): SVGTSpanElement => {
            let tspan: SVGTSpanElement;
            if (tspanCount < existingTspans.length) {
                this.perfCounters.svgNodeReuses++;
                tspan = existingTspans[tspanCount];
            } else {
                this.perfCounters.svgNodeCreates++;
                tspan = createSvgElement('tspan');
                textEl.appendChild(tspan);
            }
            tspan.setAttribute('x', x);
            tspan.setAttribute('dy', isFirst ? '0' : String(lineHeight));
            tspanCount++;
            return tspan;
        };
        if (balancedLines.length > 0 && balancedLines.length <= maxLines) {
            balancedLines.forEach((lineText, index) => {
                const nextTspan = getNextTspan(index === 0);
                nextTspan.textContent = lineText;
            });

            while (textEl.childNodes.length > tspanCount) {
                if (textEl.lastChild) {
                    this.perfCounters.svgClearCalls++;
                    textEl.removeChild(textEl.lastChild);
                }
            }

            return stampWrapCache(Math.max(balancedLines.length, 1));
        }

        let line = '';
        let lineIndex = 0;
        let tspan = getNextTspan(true);
        let truncated = false;

        for (const word of words) {
            const testLine = line ? `${line} ${word}` : word;
            this.perfCounters.svgTextWrites++;
            tspan.textContent = testLine;
            if (tspan.getComputedTextLength() > maxWidth && line) {
                tspan.textContent = line;
                lineIndex += 1;
                if (lineIndex >= maxLines) {
                    truncated = true;
                    break;
                }
                line = word;
                tspan = getNextTspan(false);
            } else {
                line = testLine;
            }
        }

        if (!truncated) {
            tspan.textContent = line;
        } else {
            tspan.textContent = line;
            this.applyEllipsis(tspan, maxWidth);
        }

        // Clean up unused pooled tspans to prevent ghosting
        while (textEl.childNodes.length > tspanCount) {
            if (textEl.lastChild) {
                this.perfCounters.svgClearCalls++;
                textEl.removeChild(textEl.lastChild);
            }
        }

        Array.from(textEl.childNodes).forEach(node => {
            if (node.nodeName !== 'tspan') {
                this.perfCounters.svgClearCalls++;
                textEl.removeChild(node);
            }
        });

        return stampWrapCache(Math.max(truncated ? maxLines : lineIndex + 1, 1));
    }

    private applyEllipsis(tspan: SVGTSpanElement, maxWidth: number): void {
        let content = tspan.textContent ?? ''; // SAFE: empty tspan normalizes to empty — guarded empty check follows
        if (!content.length) return;
        let next = `${content}…`;
        tspan.textContent = next;
        while (tspan.getComputedTextLength() > maxWidth && content.length > 1) {
            content = content.slice(0, -1).trimEnd();
            next = `${content}…`;
            tspan.textContent = next;
        }
    }

    private refreshPayloadStats(): void {
        this.payloadStats = this.buildPayloadStats();
        if (this.corpusWarningActive) {
            const stats = this.payloadStats;
            const total = stats.sceneTotal
                + stats.bookOutlineCount
                + stats.sagaOutlineCount
                + stats.referenceCounts.total;
            if (total > 0) {
                this.corpusWarningActive = false;
            }
        }
        if (!this.previewLocked
            && this.previewGroup?.classList.contains('is-visible')
            && this.previewLast) {
            this.updatePromptPreview(
                this.previewLast.zone,
                this.state.mode,
                this.previewLast.question,
                this.getPreviewPayloadRows(this.previewLast.zone, this.previewLast.questionId),
                undefined,
                { hideEmpty: true }
            );
        }
    }

    private schedulePayloadStatsRefresh(): void {
        if (this.payloadStatsRefreshTimer !== undefined) {
            window.clearTimeout(this.payloadStatsRefreshTimer);
        }
        this.payloadStatsRefreshTimer = window.setTimeout(() => {
            this.payloadStatsRefreshTimer = undefined;
            if (!this.payloadStatsRefreshDirty) return;
            this.payloadStatsRefreshDirty = false;
            this.payloadStats = undefined;
            this._currentCorpusContext = null;
            this.refreshPayloadStats();
            this.refreshEstimateDisplays();
            void this.requestEstimateSnapshot();
        }, INQUIRY_PAYLOAD_STATS_REFRESH_DEBOUNCE_MS);
    }

    private getPayloadStats(): InquiryPayloadStats {
        const activeBookId = this.getCanonicalActiveBookId();
        if (!this.payloadStats
            || this.payloadStats.scope !== this.state.scope
            || this.payloadStats.activeBookId !== activeBookId) {
            this.payloadStats = this.buildPayloadStats();
        }
        return this.payloadStats;
    }

    private buildPayloadStats(): InquiryPayloadStats {
        const manifest = this.buildCorpusManifest('payload-preview', {
            questionZone: this.previewLast?.zone
        });
        return this.buildPayloadStatsFromEntries(manifest.entries, manifest.resolvedRoots, manifest.fingerprint, true);
    }

    private buildPayloadStatsFromEntries(
        entries: CorpusManifestEntry[],
        resolvedRoots: string[],
        manifestFingerprint: string,
        preservePriorEvidenceChars: boolean
    ): InquiryPayloadStats {
        const scope = this.state.scope;
        const activeBookId = this.getCanonicalActiveBookId();
        const sceneEntries = entries.filter(entry => entry.class === 'scene');
        const outlineEntries = entries.filter(entry => entry.class === 'outline');
        const referenceEntries = entries.filter(entry => entry.class !== 'scene' && entry.class !== 'outline' && entry.class !== 'book');

        const bookOutlineEntries = outlineEntries
            .filter(entry => entry.scope !== 'saga');
        const sagaOutlineEntries = scope === 'saga'
            ? outlineEntries.filter(entry => entry.scope === 'saga')
            : [];

        const sceneStats = this.collectSceneStats(sceneEntries);
        const bookOutlineStats = this.collectEntryStats(bookOutlineEntries);
        const sagaOutlineStats = this.collectEntryStats(sagaOutlineEntries);
        const referenceStats = this.collectReferenceStats(referenceEntries);

        const estimatedEvidenceChars = sceneStats.chars + bookOutlineStats.chars + sagaOutlineStats.chars + referenceStats.chars;
        const priorStats = preservePriorEvidenceChars
            && this.payloadStats
            && this.payloadStats.manifestFingerprint === manifestFingerprint
            && this.payloadStats.scope === scope
            && this.payloadStats.activeBookId === activeBookId
            ? this.payloadStats
            : undefined;
        const evidenceChars = priorStats?.evidenceChars ?? estimatedEvidenceChars;

        return {
            scope,
            activeBookId,
            sceneTotal: sceneStats.total,
            sceneSynopsisUsed: sceneStats.synopsisUsed,
            sceneSynopsisAvailable: sceneStats.synopsisAvailable,
            sceneFullTextCount: sceneStats.fullCount,
            sceneChars: sceneStats.chars,
            bookOutlineCount: bookOutlineStats.count,
            bookOutlineSummaryCount: bookOutlineStats.summaryCount,
            bookOutlineFullCount: bookOutlineStats.fullCount,
            sagaOutlineCount: sagaOutlineStats.count,
            sagaOutlineSummaryCount: sagaOutlineStats.summaryCount,
            sagaOutlineFullCount: sagaOutlineStats.fullCount,
            outlineChars: bookOutlineStats.chars + sagaOutlineStats.chars,
            referenceCounts: referenceStats.counts,
            referenceByClass: referenceStats.byClass,
            referenceChars: referenceStats.chars,
            evidenceChars,
            resolvedRoots,
            manifestFingerprint
        };
    }

    private collectSceneStats(entries: CorpusManifestEntry[]): {
        total: number;
        synopsisUsed: number;
        synopsisAvailable: number;
        fullCount: number;
        chars: number;
    } {
        let synopsisUsed = 0;
        let synopsisAvailable = 0;
        let fullCount = 0;
        let chars = 0;
        entries.forEach(entry => {
            const summary = this.getEntrySummary(entry.path);
            if (summary) {
                synopsisAvailable += 1;
            }
            const mode = this.normalizeEvidenceMode(entry.mode);
            if (mode === 'summary') {
                if (!summary) return;
                synopsisUsed += 1;
                chars += summary.length;
                return;
            }
            if (mode === 'full') {
                fullCount += 1;
                chars += this.getEntryCharCount(entry.path);
            }
        });
        return {
            total: entries.length,
            synopsisUsed,
            synopsisAvailable,
            fullCount,
            chars
        };
    }

    private collectEntryStats(entries: CorpusManifestEntry[]): {
        count: number;
        summaryCount: number;
        fullCount: number;
        chars: number;
    } {
        let summaryCount = 0;
        let fullCount = 0;
        let chars = 0;
        entries.forEach(entry => {
            const mode = this.normalizeEvidenceMode(entry.mode);
            if (mode === 'summary') {
                const summary = this.getEntrySummary(entry.path);
                if (!summary) return;
                summaryCount += 1;
                chars += summary.length;
                return;
            }
            if (mode === 'full') {
                fullCount += 1;
                chars += this.getEntryCharCount(entry.path);
            }
        });
        return {
            count: summaryCount + fullCount,
            summaryCount,
            fullCount,
            chars
        };
    }

    private collectReferenceStats(entries: CorpusManifestEntry[]): {
        counts: { character: number; place: number; power: number; other: number; total: number };
        byClass: Record<string, number>;
        chars: number;
    } {
        const byClass: Record<string, number> = {};
        let chars = 0;
        entries.forEach(entry => {
            if (!this.hasEntryEvidence(entry)) return;
            chars += this.getEntryContentLength(entry);
            byClass[entry.class] = (byClass[entry.class] || 0) + 1; // SAFE: first entry of a class starts its count at 0
        });
        const character = byClass['character'] ?? 0; // SAFE: class absent from the corpus counts as 0
        const place = byClass['place'] ?? 0; // SAFE: class absent from the corpus counts as 0
        const power = byClass['power'] ?? 0; // SAFE: class absent from the corpus counts as 0
        const total = Object.values(byClass).reduce((sum, value) => sum + value, 0);
        const other = Math.max(0, total - character - place - power);
        return { counts: { character, place, power, other, total }, byClass, chars };
    }

    private getEntryCharCount(path: string): number {
        const file = this.app.vault.getAbstractFileByPath(path);
        if (!file || !this.isTFile(file)) return 0;
        const mtime = file.stat.mtime ?? 0; // SAFE: missing mtime treated as 0 — cache lookup simply misses
        const cached = this.entryBodyCharCache.get(path);
        if (cached && cached.mtime === mtime) {
            return cached.chars;
        }
        this.ensureEntryBodyCharCount(file, mtime);
        return 0;
    }

    private getEntrySummary(path: string): string {
        const file = this.app.vault.getAbstractFileByPath(path);
        if (!file || !this.isTFile(file)) return '';
        const frontmatter = this.getNormalizedFrontmatter(file);
        if (!frontmatter) return '';
        return extractSummary(frontmatter);
    }

    private getEntryContentLength(entry: CorpusManifestEntry): number {
        const mode = this.normalizeEvidenceMode(entry.mode);
        if (mode === 'summary') {
            const summary = this.getEntrySummary(entry.path);
            return summary.length;
        }
        if (mode === 'full') {
            return this.getEntryCharCount(entry.path);
        }
        return 0;
    }

    private hasEntryEvidence(entry: CorpusManifestEntry): boolean {
        const mode = this.normalizeEvidenceMode(entry.mode);
        if (mode === 'summary') {
            return this.getEntrySummary(entry.path).length > 0;
        }
        if (mode === 'full') {
            const file = this.app.vault.getAbstractFileByPath(entry.path);
            return !!file && this.isTFile(file);
        }
        return false;
    }

    private ensureEntryBodyCharCount(file: TFile, mtime: number): void {
        if (this.entryBodyCharLoads.has(file.path)) return;
        const load = (async () => {
            try {
                const raw = await this.app.vault.cachedRead(file);
                const chars = cleanEvidenceBody(raw).length;
                const currentMtime = file.stat.mtime ?? mtime;
                const previous = this.entryBodyCharCache.get(file.path);
                this.entryBodyCharCache.set(file.path, { mtime: currentMtime, chars });
                if (!previous || previous.mtime !== currentMtime || previous.chars !== chars) {
                    this.payloadStatsRefreshDirty = true;
                }
            } catch {
                this.entryBodyCharCache.delete(file.path);
            } finally {
                this.entryBodyCharLoads.delete(file.path);
                if (this.payloadStatsRefreshDirty && this.entryBodyCharLoads.size === 0) {
                    this.schedulePayloadStatsRefresh();
                }
            }
        })();
        this.entryBodyCharLoads.set(file.path, load);
    }

    private getNormalizedFrontmatter(file: TFile): Record<string, unknown> | null {
        const cache = this.app.metadataCache.getFileCache(file);
        const frontmatter = cache?.frontmatter;
        if (!frontmatter) return null;
        return normalizeFrontmatterKeys(frontmatter, getActiveFrontmatterMappings(this.plugin.settings));
    }

    /**
     * Extract extended Summary from frontmatter for Inquiry context.
     * Reads exclusively from frontmatter["Summary"]. Synopsis is never used.
     */

    private getPreviewPayloadRows(zone?: InquiryZone, questionId?: string): string[] {
        return [
            this.getPreviewScopeValue(),
            this.getPreviewScenesValue(),
            this.getPreviewOutlinesValue(),
            this.getPreviewModelValue(),
            this.getPreviewTokensValue(),
            this.getPreviewCostValue(zone, questionId),
            this.getPreviewHistoryValue(zone, questionId)
        ];
    }

    private getPreviewScopeValue(): string {
        if (this.state.scope === 'saga') return `${SIGMA_CHAR} Saga`;
        return `Book ${this.getScopeLabel()}`;
    }

    private getPreviewScenesValue(): string {
        const stats = this.getPayloadStats();
        if (stats.sceneFullTextCount > 0) {
            return `Scenes · ${stats.sceneFullTextCount} (Full Scene)`;
        }
        if (stats.sceneSynopsisUsed > 0) {
            return `Scenes · ${stats.sceneSynopsisUsed} (Summary)`;
        }
        return '';
    }

    private getPreviewOutlinesValue(): string {
        const stats = this.getPayloadStats();
        const summaryCount = stats.bookOutlineSummaryCount + stats.sagaOutlineSummaryCount;
        const fullCount = stats.bookOutlineFullCount + stats.sagaOutlineFullCount;
        if (fullCount > 0) {
            return `Outline · ${fullCount} (Full)`;
        }
        if (summaryCount > 0) {
            return `Outline · ${summaryCount} (Summary)`;
        }
        return '';
    }

    private getPreviewModelValue(): string {
        return `Model · ${this.getResolvedEngine().modelLabel}`;
    }

    private getPreviewTokensValue(): string {
        const context = this.getCurrentCorpusContext();
        if (context.requestTokens <= 0) {
            // Keep this pill clean — failure detail goes to the AI
            // Engine popover (the canonical error surface), NOT here.
            // See `getEngineFailureGuidance`.
            return context.requestEstimateMethod === 'unavailable'
                ? 'Full request · unavailable'
                : 'Full request · Estimating…';
        }
        const requestLabel = this.formatTokenEstimate(context.requestTokens);
        if (context.corpus.estimatedTokens <= 0) {
            return `Full request · ~${requestLabel}`;
        }
        return `Full request · ~${requestLabel} (Corpus ~${this.formatTokenEstimate(context.corpus.estimatedTokens)})`;
    }

    private getLatestPreviewQuestionActualCost(zone?: InquiryZone, questionId?: string): number | null {
        const effectiveZone = zone ?? this.previewLast?.zone ?? this.state.activeZone ?? 'setup'; // SAFE: no zone in args, preview, or state — setup is the default zone
        const activeQuestion = questionId
            ? this.getPromptOptions(effectiveZone).find(prompt => prompt.id === questionId)
            : this.getActivePrompt(effectiveZone);
        if (!activeQuestion) return null;
        const engine = this.getResolvedEngine();
        if (engine.blocked || !engine.modelId || engine.provider === 'none' || engine.provider === 'ollama') {
            return null;
        }
        const targetSceneIds = this.getActiveTargetSceneIds();
        const selectionMode = this.getSelectionMode(targetSceneIds);
        const effectiveOverride = this.getEffectivePromptOverride(activeQuestion.id);
        const questionPromptForm = this.resolveQuestionPromptFormForRun(activeQuestion, selectionMode, effectiveOverride);
        const questionText = this.resolveQuestionPromptForRun(activeQuestion, selectionMode, effectiveOverride);
        const baseKey = this.sessionStore.buildBaseKey({
            questionId: activeQuestion.id,
            questionPromptForm,
            questionSignature: this.buildQuestionSignature(questionText),
            scope: this.state.scope,
            scopeKey: this.getScopeKey(),
            targetSceneIds
        });
        const normalizedProvider = engine.provider.trim().toLowerCase();
        const normalizedModelId = engine.modelId.trim();
        const sessions = this.sessionStore.getRecentSessions(this.sessionStore.getSessionCount());
        for (const session of sessions) {
            if (session.baseKey !== baseKey) continue;
            if (this.isErrorResult(session.result)) continue;
            const sessionProvider = (session.result.aiProvider ?? '').trim().toLowerCase(); // SAFE: absent provider normalizes to empty and fails the match below
            if (sessionProvider !== normalizedProvider) continue;
            const resolvedModel = (session.result.aiModelResolved || '').trim(); // SAFE: absent model normalizes to empty and fails the match below
            const requestedModel = (session.result.aiModelRequested || '').trim(); // SAFE: absent model normalizes to empty and fails the match below
            if (resolvedModel !== normalizedModelId && requestedModel !== normalizedModelId) continue;
            const actualCost = this.getActualUsageCostForResult(session.result, session.providerCacheStatus);
            if (typeof actualCost === 'number' && Number.isFinite(actualCost) && actualCost >= 0) {
                return actualCost;
            }
        }
        return null;
    }

    private getPreviewCostValue(zone?: InquiryZone, questionId?: string): string {
        const snapshot = this.plugin.getInquiryEstimateService().getSnapshot();
        const engine = this.getResolvedEngine();
        if (engine.blocked || !snapshot) {
            return 'Cost · Estimating…';
        }
        try {
            const previewQuestionActualCost = this.getLatestPreviewQuestionActualCost(zone, questionId);
            if (previewQuestionActualCost !== null) {
                return `Prior cost · ${formatExactUsdCost(previewQuestionActualCost)}`;
            }
            const sameCorpusActualCost = this.getLatestSameCorpusActualCostForResolvedEngine();
            if (sameCorpusActualCost !== null) {
                return `Recent cost · ${formatExactUsdCost(sameCorpusActualCost)}`;
            }
            // Refuse to compute a cost estimate when the input token count
            // is unavailable. Without this guard the pricing math runs
            // against `estimatedInputTokens === 0` (Gemini countTokens
            // failure path) and renders a fabricated near-zero cost as if
            // it were real. Per RT no-fallback doctrine: render an honest
            // "Cost · unavailable" instead.
            const inputEstimate = tokenEstimateFromMethod(
                snapshot.estimate.estimationMethod,
                snapshot.estimate.estimatedInputTokens
            );
            if (inputEstimate.source === 'unavailable' || inputEstimate.source === 'pending') {
                // Keep this pill clean — failure detail goes to the AI
                // Engine popover (the canonical error surface), NOT here.
                // See `getEngineFailureGuidance`.
                return inputEstimate.source === 'pending'
                    ? 'Cost · Estimating…'
                    : 'Cost · unavailable';
            }
            const learnedOutputTokens = this.plugin.getOutputProfileStore().predictExpectedOutput(
                engine.provider,
                engine.modelId,
                inputEstimate.tokens
            );
            if (learnedOutputTokens === null) {
                return 'Cost · Estimate pending';
            }
            const cacheSession = this.getLatestCacheSessionForResolvedEngine();
            const nextRunCanReuseCache = !!cacheSession?.cacheWindowExpiresAt
                && cacheSession.cacheWindowExpiresAt > Date.now();
            const cacheReuseRatio = nextRunCanReuseCache && typeof cacheSession.cachedStableRatio === 'number' && Number.isFinite(cacheSession.cachedStableRatio)
                ? Math.min(1, Math.max(0, cacheSession.cachedStableRatio))
                : 0;
            const cost = estimateCorpusCost(
                engine.provider,
                engine.modelId,
                inputEstimate.tokens,
                Math.min(learnedOutputTokens, snapshot.estimate.maxOutputTokens),
                snapshot.estimate.expectedPassCount,
                // Inquiry on Anthropic always primes a 1h cache; pass the
                // matching write rate so the priming pass isn't priced as 5m.
                {
                    ...(engine.provider === 'anthropic' ? { cacheWriteTtl: ANTHROPIC_REQUESTED_CACHE_TTL } : {}),
                    cacheReuseRatio
                }
            );
            const freshLabel = formatApproxUsdCost(cost.freshCostUSD);
            const cachedLabel = typeof cost.cachedCostUSD === 'number'
                ? formatApproxUsdCost(cost.cachedCostUSD)
                : '—';
            // Disclosure suffix when the underlying input was a local
            // heuristic (not the authoritative provider count). Keeps the
            // user from mistaking the estimate for an exact figure.
            const provenanceSuffix = inputEstimate.source === 'local_estimate' ? ' (local input)' : '';
            const corpusWasRun = snapshot.corpus.corpusFingerprint === this.state.corpusFingerprint;
            if (nextRunCanReuseCache) {
                return `Cached est · ${cachedLabel}${provenanceSuffix}`;
            }
            return (corpusWasRun
                ? `Fresh est · ${freshLabel} / ${cachedLabel} cached`
                : `Fresh est · ${freshLabel}`) + provenanceSuffix;
        } catch {
            return 'Cost · Estimate unavailable';
        }
    }

    private buildQuestionSignature(questionText?: string | null): string {
        const normalized = (questionText ?? '') // SAFE: no question text — signature hashes the empty form
            .trim()
            .toLowerCase()
            .replace(/\s+/g, ' ');
        return this.hashString(normalized || 'question'); // SAFE: empty question hashes a stable placeholder token
    }

    private getPreviewHistoryValue(zone?: InquiryZone, questionId?: string): string {
        const effectiveZone = zone ?? this.previewLast?.zone ?? this.state.activeZone ?? 'setup'; // SAFE: no zone in args, preview, or state — setup is the default zone
        const activeQuestion = questionId
            ? this.getPromptOptions(effectiveZone).find(prompt => prompt.id === questionId)
            : this.getActivePrompt(effectiveZone);
        if (!activeQuestion) return '';
        const targetSceneIds = this.getActiveTargetSceneIds();
        const selectionMode = this.getSelectionMode(targetSceneIds);
        const questionPromptForm = this.resolveQuestionPromptFormForRun(
            activeQuestion,
            selectionMode,
            this.getEffectivePromptOverride(activeQuestion.id)
        );
        const questionText = this.resolveQuestionPromptForRun(
            activeQuestion,
            selectionMode,
            this.getEffectivePromptOverride(activeQuestion.id)
        );
        const baseKey = this.sessionStore.buildBaseKey({
            questionId: activeQuestion.id,
            questionPromptForm,
            questionSignature: this.buildQuestionSignature(questionText),
            scope: this.state.scope,
            scopeKey: this.getScopeKey(),
            targetSceneIds
        });
        const allSessions = this.sessionStore.getRecentSessions(this.sessionStore.getSessionCount());
        const models: string[] = [];
        const seen = new Set<string>();
        allSessions.forEach(session => {
            if (session.baseKey !== baseKey) return;
            const label = this.formatPreviewHistoryModelLabel(session);
            if (!label) return;
            const key = label.toLowerCase();
            if (seen.has(key)) return;
            seen.add(key);
            models.push(label);
        });
        if (!models.length) return '';
        const visible = models.slice(0, 4);
        const overflow = models.length - visible.length;
        return overflow > 0 ? `${visible.join(' · ')} · +${overflow}` : visible.join(' · ');
    }

    private formatPreviewHistoryModelLabel(session: InquirySession): string {
        const raw = (session.result.aiModelResolved || session.result.aiModelRequested || '').trim(); // SAFE: absent model normalizes to empty — caller renders no label
        if (!raw) return '';
        const normalized = raw.toLowerCase();
        if (normalized.startsWith('gpt-')) {
            return raw.replace(/^gpt-/i, 'GPT-');
        }
        if (normalized.startsWith('claude-')) {
            const body = raw.replace(/^claude-/i, '').replace(/-/g, ' ');
            return `Claude ${body}`;
        }
        if (normalized.startsWith('gemini-')) {
            const body = raw.replace(/^gemini-/i, '').replace(/-/g, ' ');
            return `Gemini ${body.replace(/\bpro\b/gi, 'Pro').replace(/\bflash\b/gi, 'Flash')}`;
        }
        return raw.replace(/-/g, ' ');
    }


    private getTokenTier(inputTokens: number): TokenTier {
        return getTokenTierPure(inputTokens);
    }

    private getTokenTierFromSnapshot(): TokenTier {
        return getTokenTierFromSnapshotPure(this.plugin.getInquiryEstimateService().getSnapshot());
    }

    private estimateTokensFromChars(chars: number): number {
        return estimateTokensFromCharsHeuristic(chars, DEFAULT_CHARS_PER_TOKEN);
    }

    private formatTokenEstimate(value: number): string {
        return formatTokenEstimatePure(value);
    }

    private formatApproxCorpusTokens(value: number): string {
        return `~${this.formatTokenEstimate(value)}`;
    }

    private toggleDetails(): void {
        if (!this.detailsEl || !this.detailsToggle) return;
        const isOpen = !this.detailsEl.classList.contains('ert-hidden');
        this.detailsEl.classList.toggle('ert-hidden', isOpen);
        this.setIconUse(this.detailsIcon, isOpen ? 'chevron-down' : 'chevron-up');
    }

    private toggleHelpTips(): void {
        this.helpTipsEnabled = !this.helpTipsEnabled;
        this.applyHelpTips();
    }

    private applyHelpTips(): void {
        if (this.helpToggleButton) {
            this.helpToggleButton.classList.toggle('is-active', this.helpTipsEnabled);
            this.helpToggleButton.setAttribute('aria-pressed', this.helpTipsEnabled ? 'true' : 'false');
        }
        this.syncHelpTooltips();
    }

    private syncHelpTooltips(): void {
        const targets = this.getHelpTooltipTargets();
        targets.forEach(({ element, text, placement }) => {
            if (!element) return;
            const balancedText = balanceTooltipText(text);
            if (this.helpTipsEnabled) {
                addTooltipData(element, balancedText, placement ?? 'bottom'); // SAFE: optional placement — tooltips default below the element
                return;
            }
            const rtTooltipValue = element.getAttribute('data-rt-tip');
            if (rtTooltipValue === text || rtTooltipValue === balancedText) {
                element.removeAttribute('data-rt-tip');
            }
            element.removeAttribute('data-rt-tip-placement');
        });
    }

    private getHelpTooltipTargets(): Array<{ element?: SVGElement; text: string; placement?: 'top' | 'bottom' | 'left' | 'right' }> {
        return [
            {
                element: this.scopeToggleButton,
                text: t('inquiry.navTooltip.scopeToggle'),
                placement: 'bottom'
            },
            {
                element: this.flowRingHit,
                text: t('inquiry.navTooltip.flowLens'),
                placement: 'top'
            },
            {
                element: this.depthRingHit,
                text: t('inquiry.navTooltip.depthLens'),
                placement: 'top'
            },
            {
                element: this.modeIconToggleHit,
                text: t('inquiry.navTooltip.modeIconToggle'),
                placement: 'top'
            },
            {
                element: this.glyphHit,
                text: t('inquiry.navTooltip.focusRingToggle'),
                placement: 'top'
            },
            {
                element: this.navPrevButton,
                text: t('inquiry.navTooltip.previousBook'),
                placement: 'top'
            },
            {
                element: this.navNextButton,
                text: t('inquiry.navTooltip.nextBook'),
                placement: 'top'
            }
        ];
    }

    private openReportPreview(): void {
        if (!this.state.activeResult) {
            new Notice(t('inquiry.notice.noRunForPreview'));
            return;
        }
        this.state.reportPreviewOpen = true;
        this.updateArtifactPreview();
    }

    private async saveArtifact(): Promise<void> {
        const result = this.state.activeResult;
        if (!result) {
            new Notice(t('inquiry.notice.noRunForSave'));
            return;
        }
        await this.saveBrief(result, {
            openFile: true,
            silent: false,
            sessionKey: this.state.activeSessionId
        });
    }

    private async saveBrief(
        result: InquiryResult,
        options: {
            openFile: boolean;
            silent: boolean;
            sessionKey?: string;
            logPath?: string;
            rawResponse?: string | null;
            statusOverride?: InquirySessionStatus;
        }
    ): Promise<string | null> {
        const folder = await ensureInquiryArtifactFolder(this.app);
        if (!folder) {
            if (!options.silent) {
                new Notice(t('inquiry.notice.briefFolderFailed'));
            }
            return null;
        }

        const briefTitle = this.formatInquiryBriefTitle(result);
        const briefId = this.formatInquiryBriefId(result);
        const baseName = briefId;
        const filePath = this.getAvailableArtifactPath(folder.path, baseName);
        const sessionLogPath = options.logPath
            ?? (options.sessionKey ? this.sessionStore.peekSession(options.sessionKey)?.logPath : undefined);
        const brief = this.buildInquiryBriefModel(result, sessionLogPath, options.rawResponse);
        const renderedBody = renderInquiryBrief(brief);
        // The brief's filename is the stable IB-id; `aliases` makes it
        // resolvable/searchable by its human title in the quick-switcher and
        // [[wikilinks]] (core Obsidian). A `title:` property is NOT read by
        // Obsidian core (only the Front Matter Title plugin honors it) and was
        // pure duplication of the alias — dropped.
        const aliasYaml = JSON.stringify(briefTitle);
        const content = `---\naliases:\n  - ${aliasYaml}\n---\n\n${renderedBody}`;

        try {
            const file = await this.app.vault.create(filePath, content);
            if (options.openFile) {
                this.openBriefingPresentation(brief, {
                    briefFile: file,
                    logFile: this.getArtifactFileAtPath(sessionLogPath),
                    generatedAt: result.completedAt ?? Date.now()
                });
            }
            if (!options.silent) {
                new Notice(t('inquiry.notice.briefSaved'));
            }
            if (options.sessionKey) {
                this.sessionStore.updateSession(options.sessionKey, {
                    status: options.statusOverride ?? 'saved', // SAFE: no status override — a successful save marks the session saved
                    briefPath: file.path
                });
                // Write-through: the session now holds its final restorable
                // state (saved status + briefPath). Persist it synchronously
                // alongside the brief so the hidden sidecar can never lag the
                // visible brief — the vault stays fully rehydratable even if
                // Obsidian quits or the vault is packaged immediately after.
                await this.sessionStore.flush();
            }
            this.updateBriefingButtonState();
            this.refreshBriefingPanel();
            return file.path;
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (!options.silent) {
                new Notice(t('inquiry.notice.briefSaveFailed', { message }));
            }
            return null;
        }
    }

    private async buildFallbackTrace(
        input: InquiryRunnerInput,
        note?: string
    ): Promise<InquiryRunTrace> {
        try {
            const trace = await this.runner.buildTrace(input);
            if (note) {
                trace.notes.push(note);
            }
            return trace;
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            const notes = note ? [note] : [];
            if (message) {
                notes.push(`Trace build error: ${message}`);
            }
            return {
                systemPrompt: '',
                userPrompt: '',
                evidenceText: '',
                tokenEstimate: {
                    inputTokens: Number.NaN,
                    outputTokens: INQUIRY_MAX_OUTPUT_TOKENS,
                    totalTokens: Number.NaN,
                    inputChars: 0,
                    estimationMethod: 'heuristic_chars',
                    uncertaintyTokens: 0,
                    effectiveInputCeiling: 0,
                    expectedPassCount: 1
                },
                outputTokenCap: INQUIRY_MAX_OUTPUT_TOKENS,
                response: null,
                sanitizationNotes: [],
                notes
            };
        }
    }

    private async saveInquiryLog(
        result: InquiryResult,
        trace: InquiryRunTrace,
        manifest: CorpusManifest | null,
        options?: { sessionKey?: string; normalizationNotes?: string[]; silent?: boolean }
    ): Promise<string | null> {
        const folder = await ensureInquiryLogFolder(this.app);
        const silent = options?.silent ?? true; // SAFE: optional flag — log failures are silent unless requested
        if (!folder) {
            if (!silent) {
                new Notice(t('inquiry.notice.logFolderFailed'));
            }
            return null;
        }

        const logTitle = this.formatInquiryLogTitle(result);
        const filePath = this.getAvailableArtifactPath(folder.path, logTitle);
        const shouldWriteContent = this.plugin.settings.logApiInteractions || this.isErrorResult(result);
        const content = this.buildInquiryLogContent(result, trace, manifest, logTitle, shouldWriteContent);

        let summaryPath: string | null = null;
        try {
            const file = await this.app.vault.create(filePath, content);
            if (options?.sessionKey) {
                this.sessionStore.updateSession(options.sessionKey, {
                    logPath: file.path
                });
            }
            summaryPath = file.path;
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (!silent) {
                new Notice(t('inquiry.notice.logSaveFailed', { message }));
            }
        }

        if (shouldWriteContent) {
            await this.saveInquiryContentLog(result, trace, manifest, {
                normalizationNotes: options?.normalizationNotes,
                silent
            });
        }
        return summaryPath;
    }

    private async saveInquiryContentLog(
        result: InquiryResult,
        trace: InquiryRunTrace,
        manifest: CorpusManifest | null,
        options?: { normalizationNotes?: string[]; silent?: boolean }
    ): Promise<void> {
        const silent = options?.silent ?? true; // SAFE: optional flag — log failures are silent unless requested
        const folder = await ensureInquiryContentLogFolder(this.app);
        if (!folder) {
            if (!silent) {
                new Notice(t('inquiry.notice.logContentFolderFailed'));
            }
            return;
        }

        const logTitle = this.formatInquiryContentLogTitle(result);
        const filePath = this.getAvailableArtifactPath(folder.path, logTitle);
        const content = this.buildInquiryContentLogContent(result, trace, manifest, logTitle, options?.normalizationNotes);

        try {
            await this.app.vault.create(filePath, content);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (!silent) {
                new Notice(t('inquiry.notice.logContentSaveFailed', { message }));
            }
        }
    }

    private buildArtifactContent(
        result: InquiryResult,
        logPath?: string,
        rawResponse?: string | null
    ): string {
        const brief = this.buildInquiryBriefModel(result, logPath, rawResponse);
        return renderInquiryBrief(brief);
    }

    private buildInquiryBriefModel(
        result: InquiryResult,
        logPath?: string,
        rawResponse?: string | null
    ): InquiryBriefModel {
        const items = this.getResultItems(result);
        const referenceLabels = this.buildInquiryReferenceLabelMap(items);
        return buildInquiryBriefModelPure(result, {
            items,
            referenceLabels,
            sceneNotes: this.buildInquirySceneNotes(result, items, referenceLabels),
            sceneReferences: this.buildInquirySceneReferenceIndex(items),
            pendingActions: this.buildBriefPendingActions(result, items, referenceLabels),
            promptLabel: this.findPromptLabelById(result.questionId),
            questionTextById: this.getQuestionTextById(result.questionId),
            scopeIndicator: this.resolveInquiryBriefScopeIndicator(result),
            logTitle: this.resolveInquiryLogLinkTitle(result, logPath),
            isError: this.isErrorResult(result),
            rawResponse
        });
    }

    private getBriefModelLabel(result: InquiryResult): string | null {
        return getBriefModelLabelPure(result);
    }

    private buildInquirySceneNotes(
        result: InquiryResult,
        items: InquiryCorpusItem[] = this.getResultItems(result),
        referenceLabels: ReadonlyMap<string, string> = this.buildInquiryReferenceLabelMap(items)
    ): Array<{
        label: string;
        header: string;
        anchorId?: string;
        entries: Array<{
            headline: string;
            bullets: string[];
            lens: string;
        }>;
    }> {
        return buildInquirySceneNotesPure(
            result,
            items,
            referenceLabels,
            (item) => this.getMinimapItemFilePath(item),
            (source) => this.getBriefSceneAnchorId(source),
            (item, label) => this.formatInquiryReferenceDisplay(item, label)
        );
    }

    private buildInquiryReferenceLabelMap(items: InquiryCorpusItem[]): Map<string, string> {
        return buildInquiryReferenceLabelMapPure(
            items,
            (item) => this.formatInquiryReferenceDisplay(item, item.displayLabel)
        );
    }

    private buildInquirySceneReferenceIndex(items: InquiryCorpusItem[]): Array<{ label: string; anchorId?: string }> {
        return buildInquirySceneReferenceIndexPure(
            items,
            (item) => this.formatInquiryReferenceDisplay(item, item.displayLabel),
            (item) => this.getBriefSceneAnchorId(this.getMinimapItemFilePath(item) || item.id || item.displayLabel)
        );
    }

    private formatInquiryReferenceDisplay(item: InquiryCorpusItem, fallbackLabel?: string): string {
        return buildSceneDossierHeader({
            label: fallbackLabel || item.displayLabel || item.id,
            itemDisplayLabel: item.displayLabel,
            itemTitle: this.getMinimapItemTitle(item),
            hoverLabel: fallbackLabel || item.displayLabel || item.id || 'Scene' // SAFE: display fallback chain for the scene hover label
        });
    }

    private normalizeInquiryBriefText(value: string | undefined, referenceLabels: ReadonlyMap<string, string>): string {
        return normalizeInquiryBriefTextPure(value, referenceLabels);
    }

    private resolveInquiryBriefScopeIndicator(result: InquiryResult): string | null {
        const canonical = resolveInquiryScopeIndicator(result);
        if (result.scope !== 'book') return canonical;
        const scopeLabel = result.scopeLabel?.trim();
        const match = scopeLabel?.match(/^B(\d+)$/i);
        if (!match) return canonical;
        const sequence = Number(match[1]);
        if (!Number.isFinite(sequence) || sequence < 1) return canonical;
        const book = getSequencedBooks(this.plugin.settings.books).find(entry => entry.sequenceNumber === sequence)?.book;
        const title = book?.title?.trim();
        return title || canonical;
    }

    private resolveSceneLogLabel(frontmatter: Record<string, unknown> | null, file: TFile): string {
        const rawSceneNumber = frontmatter ? frontmatter['Scene Number'] : undefined;
        const parsedNumber = Number(typeof rawSceneNumber === 'string' ? rawSceneNumber.trim() : rawSceneNumber);
        const sceneNumber = Number.isFinite(parsedNumber) ? Math.max(1, Math.floor(parsedNumber)) : null;
        const rawTitle = frontmatter ? (frontmatter['Title'] ?? frontmatter['title']) : undefined;
        const title = typeof rawTitle === 'string' ? rawTitle.trim() : '';
        if (sceneNumber && title) return `${title} (S${sceneNumber})`;
        if (sceneNumber) return `S${sceneNumber}`;
        if (title) return title;
        return file.basename;
    }

    private resolveManifestEntryLabel(entry: CorpusManifestEntry): string {
        const file = this.app.vault.getAbstractFileByPath(entry.path);
        if (file && this.isTFile(file)) {
            const frontmatter = this.getNormalizedFrontmatter(file);
            if (entry.class === 'scene') {
                return this.resolveSceneLogLabel(frontmatter, file);
            }
            const rawTitle = frontmatter ? (frontmatter['Title'] ?? frontmatter['title']) : undefined;
            if (typeof rawTitle === 'string' && rawTitle.trim()) {
                return rawTitle.trim();
            }
            return file.basename;
        }
        const fallback = entry.path.split('/').pop();
        return fallback || entry.path;
    }

    private buildInquiryLogContent(
        result: InquiryResult,
        trace: InquiryRunTrace,
        manifest: CorpusManifest | null,
        logTitle?: string,
        contentLogWritten?: boolean
    ): string {
        return buildInquiryLogContent({
            result,
            trace,
            manifest,
            logTitle: logTitle ?? this.formatInquiryLogTitle(result),
            contentLogWritten,
            deps: {
                getQuestionLabel: (currentResult) => this.resolveInquiryQuestionPrefixForResult(currentResult)
                    || this.findPromptLabelById(currentResult.questionId)
                    || this.getQuestionTextById(currentResult.questionId)
                    || currentResult.questionId
                    || 'Inquiry Question', // SAFE: UX default label when the question cannot be resolved
                getBriefModelLabel: this.getBriefModelLabel.bind(this),
                getFiniteTokenEstimateInput: this.getFiniteTokenEstimateInput.bind(this),
                getTokenTier: this.getTokenTier.bind(this),
                buildInquiryLogCostEstimateInput: this.buildInquiryLogCostEstimateInput.bind(this),
                formatTokenUsageVisibility,
                isErrorResult: this.isErrorResult.bind(this),
                isDegradedResult: this.isDegradedResult.bind(this),
                formatMetricDisplay: this.formatMetricDisplay.bind(this),
                resolveManifestEntryLabel: this.resolveManifestEntryLabel.bind(this),
                normalizeEvidenceMode: this.normalizeEvidenceMode.bind(this),
                normalizeLegacyResult: this.normalizeLegacyResult.bind(this),
                resolveInquiryBriefZoneLabel: this.resolveInquiryBriefZoneLabel.bind(this),
                resolveInquiryBriefLensLabel: this.resolveInquiryBriefLensLabel.bind(this),
                formatInquiryIdFromResult: this.formatInquiryIdFromResult.bind(this),
                pluginVersion: this.plugin.manifest.version,
                estimateSnapshot: this.plugin.getInquiryEstimateService().getSnapshot(),
                geminiCacheTtlSeconds: normalizeGeminiCacheTtlSeconds(this.getCanonicalAiSettings().cacheWindows?.googleTtlSeconds)
            }
        });
    }

    private buildInquiryContentLogContent(
        result: InquiryResult,
        trace: InquiryRunTrace,
        manifest: CorpusManifest | null,
        logTitle?: string,
        normalizationNotes?: string[]
    ): string {
        return buildInquiryContentLogContent({
            result,
            trace,
            manifest,
            logTitle: logTitle ?? this.formatInquiryContentLogTitle(result),
            normalizationNotes,
            deps: {
                getQuestionLabel: (currentResult) => this.resolveInquiryQuestionPrefixForResult(currentResult)
                    || this.findPromptLabelById(currentResult.questionId)
                    || this.getQuestionTextById(currentResult.questionId)
                    || currentResult.questionId
                    || 'Inquiry Question', // SAFE: UX default label when the question cannot be resolved
                getBriefModelLabel: this.getBriefModelLabel.bind(this),
                getFiniteTokenEstimateInput: this.getFiniteTokenEstimateInput.bind(this),
                getTokenTier: this.getTokenTier.bind(this),
                buildInquiryLogCostEstimateInput: this.buildInquiryLogCostEstimateInput.bind(this),
                formatTokenUsageVisibility,
                isErrorResult: this.isErrorResult.bind(this),
                isDegradedResult: this.isDegradedResult.bind(this),
                formatMetricDisplay: this.formatMetricDisplay.bind(this),
                resolveManifestEntryLabel: this.resolveManifestEntryLabel.bind(this),
                normalizeEvidenceMode: this.normalizeEvidenceMode.bind(this),
                normalizeLegacyResult: this.normalizeLegacyResult.bind(this),
                resolveInquiryBriefZoneLabel: this.resolveInquiryBriefZoneLabel.bind(this),
                resolveInquiryBriefLensLabel: this.resolveInquiryBriefLensLabel.bind(this),
                formatInquiryIdFromResult: this.formatInquiryIdFromResult.bind(this),
                pluginVersion: this.plugin.manifest.version,
                estimateSnapshot: this.plugin.getInquiryEstimateService().getSnapshot(),
                geminiCacheTtlSeconds: normalizeGeminiCacheTtlSeconds(this.getCanonicalAiSettings().cacheWindows?.googleTtlSeconds)
            }
        });
    }

    private formatInquiryLogTitle(result: InquiryResult): string {
        const timestampSource = this.getInquiryTimestamp(result, true) ?? new Date();
        const timestamp = formatInquiryBriefTimestamp(timestampSource);
        const zoneLabel = this.resolveInquiryBriefZoneLabel(result);
        const lensLabel = this.resolveInquiryBriefLensLabel(result, zoneLabel);
        const questionPrefix = this.resolveInquiryQuestionPrefixForResult(result);
        const parts: string[] = [];
        if (result.aiReason === 'simulated' || result.aiReason === 'stub') {
            parts.push('TEST RUN');
        }
        if (result.scope === 'saga') {
            parts.push('Saga');
        }
        if (questionPrefix) {
            parts.push(questionPrefix);
        } else {
            parts.push(zoneLabel, lensLabel);
        }
        return `Inquiry Log — ${parts.join(' · ')} ${timestamp}`;
    }

    private formatInquiryContentLogTitle(result: InquiryResult): string {
        const timestampSource = this.getInquiryTimestamp(result, true) ?? new Date();
        const timestamp = formatInquiryBriefTimestamp(timestampSource);
        const zoneLabel = this.resolveInquiryBriefZoneLabel(result);
        const lensLabel = this.resolveInquiryBriefLensLabel(result, zoneLabel);
        const questionPrefix = this.resolveInquiryQuestionPrefixForResult(result);
        const parts: string[] = [];
        if (result.aiReason === 'simulated' || result.aiReason === 'stub') {
            parts.push('TEST RUN');
        }
        if (result.scope === 'saga') {
            parts.push('Saga');
        }
        if (questionPrefix) {
            parts.push(questionPrefix);
        } else {
            parts.push(zoneLabel, lensLabel);
        }
        return `Inquiry Content Log — ${parts.join(' · ')} ${timestamp}`;
    }

    private resolveInquiryLogLinkTitle(result: InquiryResult, logPath?: string): string {
        if (logPath) {
            const basename = logPath.split('/').pop();
            if (basename) {
                return basename.replace(/\.md$/, '');
            }
        }
        return this.formatInquiryLogTitle(result);
    }

    private formatInquiryBriefTitle(result: InquiryResult): string {
        const timestampSource = this.getInquiryTimestamp(result, true) ?? new Date();
        const zoneLabel = this.resolveInquiryBriefZoneLabel(result);
        const lensLabel = this.resolveInquiryBriefLensLabel(result, zoneLabel);
        const questionPrefix = this.resolveInquiryQuestionPrefixForResult(result);
        return formatInquiryBriefTitlePure(result, timestampSource, zoneLabel, lensLabel, questionPrefix);
    }

    private formatInquiryBriefId(result: InquiryResult): string {
        const timestampSource = this.getInquiryTimestamp(result, true) ?? new Date();
        return formatInquiryBriefId(timestampSource);
    }

    private formatInquiryBriefShortDate(result: InquiryResult): string {
        const timestampSource = this.getInquiryTimestamp(result, true) ?? new Date();
        return formatInquiryBriefShortDate(timestampSource);
    }

    private resolveInquiryBriefZoneLabel(result: InquiryResult): string {
        return resolveInquiryBriefZoneLabelPure(result, (qid) => this.findPromptZoneById(qid));
    }

    private resolveInquiryBriefLensLabel(result: InquiryResult, zoneLabel: string): string {
        const promptLabel = this.findPromptLabelById(result.questionId);
        if (promptLabel && promptLabel.toLowerCase() !== zoneLabel.toLowerCase()) {
            return promptLabel;
        }
        return result.mode === 'depth' ? 'Depth' : 'Flow';
    }

    private findPromptLabelById(questionId: string): string | null {
        if (!questionId) return null;
        const config = this.getPromptConfig();
        const zones: InquiryZone[] = ['setup', 'pressure', 'payoff'];
        for (const zone of zones) {
            const slot = (config[zone] || []).find(entry => entry.id === questionId); // SAFE: zone may be absent from prompt config — no slot match
            if (slot?.label?.trim()) {
                return slot.label.trim();
            }
        }
        return null;
    }

    private findPromptZoneById(questionId: string): InquiryZone | null {
        if (!questionId) return null;
        const config = this.getPromptConfig();
        const zones: InquiryZone[] = ['setup', 'pressure', 'payoff'];
        for (const zone of zones) {
            if ((config[zone] || []).some(entry => entry.id === questionId)) { // SAFE: zone may be absent from prompt config — no slot match
                return zone;
            }
        }
        return null;
    }

    private isContextRequiredForQuestion(questionId: string, questionZone?: InquiryZone): boolean {
        if (!questionId) return false;
        const config = this.getPromptConfig();
        const zones: InquiryZone[] = ['setup', 'pressure', 'payoff'];
        for (const zone of zones) {
            const slot = (config[zone] || []).find(entry => entry.id === questionId); // SAFE: zone may be absent from prompt config — no slot match
            if (slot?.requiresContext) return true;
        }
        if (questionZone) {
            const slots = config[questionZone] || []; // SAFE: zone may be absent from prompt config — no slots to check
            return slots.some(entry => entry.id === questionId && entry.requiresContext);
        }
        return false;
    }

    private isContextRequiredForQuestions(questions: InquiryQuestion[]): boolean {
        return questions.some(question => this.isContextRequiredForQuestion(question.id, question.zone));
    }

    private getQuestionTextById(questionId?: string): string | null {
        if (!questionId) return null;
        const config = this.getPromptConfig();
        const zones: InquiryZone[] = ['setup', 'pressure', 'payoff'];
        for (const zone of zones) {
            const slot = (config[zone] || []).find(entry => entry.id === questionId); // SAFE: zone may be absent from prompt config — no slot match
            if (!slot) continue;
            const questionText = this.getQuestionTextForSlot(zone, slot);
            if (questionText.trim()) return questionText;
        }
        return null;
    }


    private getInquiryTimestamp(result: InquiryResult, fallbackToNow = false): Date | null {
        const completedAt = result.completedAt ? new Date(result.completedAt) : null;
        if (completedAt && Number.isFinite(completedAt.getTime())) {
            return completedAt;
        }
        const submittedAt = result.submittedAt ? new Date(result.submittedAt) : null;
        if (submittedAt && Number.isFinite(submittedAt.getTime())) {
            return submittedAt;
        }
        if (fallbackToNow) return new Date();
        return null;
    }


    private formatInquiryIdFromResult(result: InquiryResult): string | null {
        const timestamp = this.getInquiryTimestamp(result);
        if (!timestamp) return null;
        return formatInquiryId(timestamp);
    }

    private formatInquiryActionNote(
        finding: InquiryFinding,
        briefId: string,
        briefAlias: string,
        targetLabel: string | undefined,
        referenceLabels: ReadonlyMap<string, string>
    ): string | null {
        const actionText = this.getInquiryActionText(finding, referenceLabels);
        if (!actionText) return null;
        const briefLink = formatInquiryBriefLink(briefId, briefAlias);
        const prefix = targetLabel?.trim() ? `${targetLabel.trim()} ` : '';
        return `${briefLink} ${prefix}${actionText}`;
    }

    private buildInquiryPendingAction(
        finding: InquiryFinding,
        result: InquiryResult,
        items: InquiryCorpusItem[] = this.getResultItems(result),
        referenceLabels: ReadonlyMap<string, string> = this.buildInquiryReferenceLabelMap(items)
    ): { targetLabel?: string; text: string } | null {
        return buildInquiryPendingActionPure(finding, result, items, referenceLabels);
    }

    private getInquiryActionText(
        finding: InquiryFinding,
        referenceLabels: ReadonlyMap<string, string>
    ): string | null {
        return getInquiryActionTextPure(finding, referenceLabels);
    }


    private getAvailableArtifactPath(folderPath: string, baseName: string): string {
        const sanitizedFolder = normalizePath(folderPath);
        const safeName = baseName.replace(/[/:*?"<>|\\]/g, ' ').replace(/\s+/g, ' ').trim();
        let attempt = 0;
        while (attempt < 50) {
            const suffix = attempt === 0 ? '' : `-${attempt}`;
            const filePath = `${sanitizedFolder}/${safeName}${suffix}.md`;
            if (!this.app.vault.getAbstractFileByPath(filePath)) {
                return filePath;
            }
            attempt += 1;
        }
        return `${sanitizedFolder}/${safeName}-${Date.now()}.md`;
    }

    private async openArtifactsFolder(): Promise<void> {
        const folderPath = resolveInquiryArtifactFolder();
        const folder = await ensureInquiryArtifactFolder(this.app);
        if (!folder) {
            new Notice(t('inquiry.notice.folderAccessFailed', { folderPath }));
            return;
        }
        this.revealInFileExplorer(folder);
    }

    private async openMostRecentArtifact(): Promise<void> {
        const file = getMostRecentArtifactFile(this.app);
        if (!file) {
            new Notice(t('inquiry.notice.noBriefs'));
            return;
        }
        await openOrRevealFile(this.app, file);
    }

    private revealInFileExplorer(file: TAbstractFile): void {
        const explorerLeaf = this.app.workspace.getLeavesOfType('file-explorer')[0];
        if (!explorerLeaf?.view) {
            new Notice(t('inquiry.notice.fileExplorerUnavailable'));
            return;
        }
        const explorerView = explorerLeaf.view as unknown as { revealInFolder?: (target: TAbstractFile) => void };
        if (!explorerView.revealInFolder) {
            new Notice(t('inquiry.notice.revealFolderFailed'));
            return;
        }
        explorerView.revealInFolder(file);
        void this.app.workspace.revealLeaf(explorerLeaf);
    }
}
