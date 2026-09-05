import type {
    InquiryAiStatus,
    InquiryLens,
    InquiryScope,
    InquirySelectionMode,
    InquiryTokenUsageScope,
    InquiryZone,
    InquiryResult
} from '../state';
import type { SceneInclusion } from '../../types/settings';
import type { AIProviderId } from '../../ai/types';
import type { TokenEstimateMethod } from '../../ai/tokens/inputTokenEstimate';
import type { TokenUsage } from '../../ai/usage/providerUsage';
import type { InquiryQuestionPromptForm } from '../questions/resolveQuestionPrompt';

export type EvidenceClass = string;
export type InquiryExecutionState = 'blocked_before_send' | 'dispatched_to_provider' | 'multi_pass_failed';
export type InquiryExecutionPath = 'one_pass' | 'multi_pass';
export type InquiryFailureStage = 'preflight' | 'chunk_execution' | 'synthesis' | 'provider_response_parsing';

export interface InquiryAiEngineInfo {
    provider: Exclude<AIProviderId, 'none'>;
    modelId: string;
    modelLabel: string;
}

export interface InquiryOmnibusQuestion {
    id: string;
    zone: InquiryZone;
    questionText: string;
    questionPromptForm: InquiryQuestionPromptForm;
}

export interface CorpusManifestEntry {
    path: string;
    /** Canonical primary reference id for scenes and non-evidence anchors such as Saga books. */
    sceneId?: string;
    mtime: number;
    class: EvidenceClass;
    scope?: InquiryScope;
    bookId?: string;
    mode: SceneInclusion;
    isTarget: boolean;
}

export interface CorpusManifestSnapshotEntry {
    path: string;
    sceneId?: string;
    mtime: number;
    class: EvidenceClass;
    mode: SceneInclusion;
    isTarget: boolean;
}

export interface CorpusManifest {
    entries: CorpusManifestEntry[];
    fingerprint: string;
    /** Fingerprint excluding modelId — used for UX staleness (did the source corpus change?). */
    corpusOnlyFingerprint: string;
    cacheReuseFingerprint: string;
    /** Minimal per-entry snapshot persisted with results so we can diff later to explain staleness. */
    snapshot: CorpusManifestSnapshotEntry[];
    generatedAt: number;
    resolvedRoots: string[];
    allowedClasses: EvidenceClass[];
    synopsisOnly: boolean;
    classCounts: Record<EvidenceClass, number>;
}

export interface EvidenceParticipationRules {
    sagaOutlineScope: 'saga-only';
    bookOutlineScope: 'book-only';
    crossScopeUsage: 'conflict-only';
}

export interface InquiryRunnerInput {
    scope: InquiryScope;
    scopeLabel: string;
    targetSceneIds: string[];
    selectionMode: InquirySelectionMode;
    activeBookId?: string;
    // UI emphasis only; inquiry computation must always include both flow + depth regardless of lens.
    mode: InquiryLens;
    questionId: string;
    questionText: string;
    questionPromptForm: InquiryQuestionPromptForm;
    questionZone: InquiryZone;
    corpus: CorpusManifest;
    rules: EvidenceParticipationRules;
    ai: InquiryAiEngineInfo;
    /**
     * Whether citation source-anchoring should be requested for this run.
     * Snapshot at construction time so a setting change mid-run does not
     * flip what we asked for vs what we report.
     */
    citationsEnabled: boolean;
}

export interface InquiryOmnibusInput {
    scope: InquiryScope;
    scopeLabel: string;
    targetSceneIds: string[];
    selectionMode: InquirySelectionMode;
    activeBookId?: string;
    // UI emphasis only; inquiry computation must always include both flow + depth regardless of lens.
    mode: InquiryLens;
    questions: InquiryOmnibusQuestion[];
    corpus: CorpusManifest;
    rules: EvidenceParticipationRules;
    ai: InquiryAiEngineInfo;
    /** See InquiryRunnerInput.citationsEnabled — same semantics. */
    citationsEnabled: boolean;
}

export type InquiryRunProgressEvent = {
    phase: 'one_pass' | 'chunk' | 'synthesis' | 'finalizing';
    currentPass: number;
    totalPasses: number;
    chunkIndex?: number;
    chunkTotal?: number;
    detail?: string;
};

export interface InquiryRunExecutionOptions {
    onProgress?: (event: InquiryRunProgressEvent) => void;
    shouldAbort?: () => boolean;
    forceFreshRun?: boolean;
}

export interface InquiryRunTrace {
    systemPrompt: string;
    userPrompt: string;
    evidenceText: string;
    requestPayload?: unknown;
    tokenEstimate: {
        inputTokens: number;
        outputTokens: number;
        totalTokens: number;
        inputChars: number;
        estimationMethod: TokenEstimateMethod;
        uncertaintyTokens: number;
        effectiveInputCeiling: number;
        expectedPassCount: number;
    };
    outputTokenCap: number;
    retryCount?: number;
    response: {
        content: string | null;
        responseData: unknown;
        aiStatus?: InquiryAiStatus;
        aiReason?: string;
        error?: string;
    } | null;
    executionPassCount?: number;
    multiPassTriggerReason?: string;
    executionState?: InquiryExecutionState;
    executionPath?: InquiryExecutionPath;
    failureStage?: InquiryFailureStage;
    cacheReuseState?: 'idle' | 'eligible' | 'warm';
    cacheStatus?: 'hit' | 'created';
    /**
     * Provider-bound cache resource expiry (ms since epoch). For Gemini, this
     * is bound to the original creation time and does NOT extend on hits.
     */
    cacheExpiresAt?: number;
    cachedStableRatio?: number;
    cachedStableTokens?: number;
    tokenUsageKnown?: boolean;
    tokenUsageScope?: InquiryTokenUsageScope;
    openAiTransportLane?: 'chat_completions' | 'responses';
    usage?: TokenUsage;
    sanitizationNotes: string[];
    notes: string[];
}

export interface InquiryRunner {
    run(input: InquiryRunnerInput): Promise<InquiryResult>;
}
