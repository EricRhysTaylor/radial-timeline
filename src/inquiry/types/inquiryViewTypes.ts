import type { AIProviderId, AIRunAdvancedContext } from '../../ai/types';
import type {
    InquiryCanonicalQuestionTier,
    InquiryClassConfig,
    SceneInclusion,
    InquiryTimingHistoryEntry,
    OmnibusProgressState
} from '../../types/settings';
import type {
    FindingRole,
    InquiryRoleValidation,
    InquiryScope,
    InquiryZone
} from '../state';
import type { InquirySession } from '../sessionTypes';
import type { SynopsisQuality } from '../../sceneAnalysis/synopsisQuality';

export type InquiryQuestion = {
    id: string;
    label: string;
    standardPrompt: string;
    focusedPrompt?: string;
    zone: InquiryZone;
    icon: string;
    tier?: InquiryCanonicalQuestionTier;
};

export type InquiryBriefModel = {
    questionTitle: string;
    questionText: string;
    scopeIndicator?: string | null;
    mode?: 'flow' | 'depth';
    selectionMode: 'discover' | 'focused';
    roleValidation: InquiryRoleValidation;
    pills: string[];
    flowSummary: string;
    depthSummary: string;
    findings: Array<{
        headline: string;
        sceneLabel?: string;
        role: FindingRole;
        lens: string;
        bullets: string[];
    }>;
    sources: Array<{
        title: string;
        excerpt: string;
        classLabel: string;
        path?: string;
        url?: string;
        /** Number of citations referencing this source document. */
        citationCount?: number;
    }>;
    sceneNotes: Array<{
        label: string;
        header: string;
        anchorId?: string;
        entries: Array<{
            headline: string;
            bullets: string[];
            lens: string;
        }>;
    }>;
    sceneReferences: Array<{
        label: string;
        anchorId?: string;
    }>;
    pendingActions: Array<{
        targetLabel?: string;
        text: string;
    }>;
    /**
     * True only for a usable, completed inquiry pass (not error / simulated /
     * stub / evidence-compromised). Gates the "No Action Items" empty-state so
     * it reads as a real result, never as the mere absence of actions on a
     * failed or non-completed run.
     */
    showNoActionItems?: boolean;
    logTitle?: string | null;
    rawResponse?: string | null;
    refNormalized?: boolean;
    /**
     * Run-level citation integrity warnings rendered as a blunt banner so
     * unverified citations never masquerade as verified findings.
     */
    citationIntegrityWarnings?: Array<{
        stage: 'unresolved_ref' | 'ref_label_mismatch';
        message: string;
    }>;
    /**
     * Findings the AI cited but which could not be matched to the active
     * corpus. Rendered in a visually distinct "Unverified AI citations"
     * section beneath verified findings.
     */
    unverifiedFindings?: Array<{
        headline: string;
        bullets: string[];
        lens: string;
        rawRefId?: string;
        rawRefLabel?: string;
        rawRefPath?: string;
        warning: string;
    }>;
    /**
     * True when the run has at least one unverified citation AND zero verified
     * findings — the whole evidence base is suspect and the UI should show a
     * harsher state than the normal warning.
     */
    evidenceCompromised?: boolean;
};

export type InquiryPreviewRow = {
    group: SVGGElement;
    bg: SVGRectElement;
    text: SVGTextElement;
    label: string;
};

export type InquirySceneDossier = {
    title: string;
    anchorLine: string;
    bodyLines: string[];
    metaLine?: string;
    sourceLabel?: string;
};

export type InquiryOmnibusPlan = {
    scope: InquiryScope;
    createIndex: boolean;
    resume?: boolean;
};

export type InquiryPurgePreviewItem = {
    label: string;
    path: string;
    lineCount: number;
};

export type InquiryOmnibusModalOptions = {
    initialScope: InquiryScope;
    bookLabel: string;
    bookTitle?: string;
    questions: InquiryQuestion[];
    providerSummary: string;
    providerLabel: string;
    logsEnabled: boolean;
    runDisabledReason?: string | null;
    priorProgress?: OmnibusProgressState;
    resumeAvailable?: boolean;
    resumeUnavailableReason?: string;
    /**
     * Pre-run cost band (healthy cached total vs costly uncached total) for the
     * selected corpus, provider, and question count. Undefined when the model
     * has no usable pricing or the corpus token estimate is unavailable.
     */
    costRange?: OmnibusCostRangePlan;
};

export type OmnibusCostRangePlan = {
    uncachedUSD: number;
    cachedUSD?: number;
    corpusInputTokens: number;
    estimateMethod?: string;
};

export type CorpusCcEntry = {
    id: string;
    entryKey: string;
    label: string;
    filePath: string;
    sceneId?: string;
    bookId?: string;
    bookLabel?: string;
    className: string;
    classKey: string;
    scope?: InquiryScope;
    mode: SceneInclusion;
    isTarget: boolean;
    sortLabel?: string;
};

export type CorpusCcGroup = {
    key: string;
    className: string;
    items: CorpusCcEntry[];
    count: number;
    mode: SceneInclusion;
    headerLabel?: string;
    headerTooltipLabel?: string;
};

export type CorpusCcSlot = {
    group: SVGGElement;
    base: SVGRectElement;
    fill: SVGRectElement;
    border: SVGRectElement;
    lowSubstanceX: SVGGElement;
    lowSubstanceXPrimary: SVGLineElement;
    lowSubstanceXSecondary: SVGLineElement;
    icon: SVGGElement;
    iconOuter: SVGCircleElement;
    iconInner: SVGCircleElement;
    targetLetter: SVGTextElement;
};

export type CorpusCcHeader = {
    group: SVGGElement;
    hit: SVGRectElement;
    icon: SVGGElement;
    iconOuter: SVGCircleElement;
    iconInner: SVGCircleElement;
    text: SVGTextElement;
};

export type CorpusCcStats = {
    bodyWords: number;
    synopsisWords: number;
    synopsisQuality: SynopsisQuality;
    statusRaw?: string;
    due?: string;
    title?: string;
};

export type InquiryWritebackOutcome = 'written' | 'duplicate' | 'skipped' | 'refused';
export type InquiryGuidanceState = 'not-configured' | 'no-scenes' | 'no-api-key' | 'ready' | 'running' | 'results';

export type OmnibusProviderChoice = {
    provider: Exclude<AIProviderId, 'none'>;
    modelId: string;
    modelLabel: string;
    useOmnibus: boolean;
    reason?: string;
};

export type OmnibusProviderPlan = {
    choice: OmnibusProviderChoice | null;
    summary: string;
    label: string;
    disabledReason?: string;
};

export type EngineChoice = {
    provider: Exclude<AIProviderId, 'none'>;
    providerLabel: string;
    modelId: string;
    modelLabel: string;
    isActive: boolean;
    enabled: boolean;
    disabledReason?: string;
};

export type AiSettingsFocus =
    | 'provider'
    | 'thinking-style'
    | 'access-level'
    | 'pinned-model'
    | 'large-manuscript-handling';

export type EngineFailureGuidance = {
    message: string;
};

export type InquiryGlyphSeedSource = 'active' | 'session' | 'empty';

export type InquiryGlyphSeed = {
    source: InquiryGlyphSeedSource;
    flowValue: number;
    depthValue: number;
    flowVisualValue: number;
    depthVisualValue: number;
    session?: InquirySession;
};

export type InquirySceneNoteEntry = {
    headline: string;
    bullets: string[];
    lens: string;
};

export type InquirySceneNoteSection = {
    label: string;
    header: string;
    anchorId?: string;
    entries: InquirySceneNoteEntry[];
};

export type InquiryBriefDependencies = {
    formatMetricDisplay: (value: number) => string;
    formatBriefLabel: (value?: string | null) => string;
    normalizeInquiryHeadline: (headline: string) => string;
};

export type InquiryBriefRenderContext = {
    brief: InquiryBriefModel;
};

export type InquiryCorpusModeDependency = {
    normalizeEvidenceMode: (mode?: SceneInclusion) => 'excluded' | 'summary' | 'full';
};

export type InquiryClassContributionDependency = {
    normalizeClassContribution: (config: InquiryClassConfig) => InquiryClassConfig;
};

export type InquiryTimingLookup = (provider?: string, model?: string) => InquiryTimingHistoryEntry | null;
export type InquiryAdvancedContext = AIRunAdvancedContext | null;
