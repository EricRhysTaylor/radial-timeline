import type { AiStatus } from '../api/providerErrors';

export type AIProviderId = 'openai' | 'anthropic' | 'google' | 'ollama' | 'none';
export type AccessTier = 1 | 2 | 3 | 4;
export type AnthropicCacheTtl = '5m' | '1h';
export type OpenAiPromptCacheRetention = 'in_memory' | '24h';

export type Capability =
    | 'longContext'
    | 'jsonStrict'
    | 'reasoningStrong'
    | 'highOutputCap'
    | 'toolCalling'
    | 'streaming'
    | 'vision'
    | 'functionCalling';

export type ModelTier = 'DEEP' | 'BALANCED' | 'FAST' | 'LOCAL';
export type ModelStatus = 'stable' | 'preview' | 'legacy' | 'deprecated';
export type ModelRolloutStatus = 'stable' | 'provisional' | 'deprecated';
export type ModelReleaseChannel = 'stable' | 'pro' | 'rollback' | 'snapshot' | 'legacy';

export interface ModelRolloutMeta {
    /** Public release channel used by picker/resolver curation. */
    channel: ModelReleaseChannel;
    /** Hide from normal author-facing picker while keeping model available internally. */
    hiddenFromPicker?: boolean;
}

export interface ModelRolloutInfo extends ModelRolloutMeta {
    /** Lifecycle status for deliberate model rollouts. */
    status: ModelRolloutStatus;
    /** Optional lane classification (for example: default vs pro). */
    lane?: 'default' | 'pro';
    /** Indicates this model is a dated/snapshot variant of a canonical model. */
    datedVariantOf?: string;
}

export interface ModelPersonality {
    reasoning: number;
    writing: number;
    determinism: number;
}

export interface ModelInfo {
    provider: AIProviderId;
    id: string;
    alias: string;
    label: string;
    tier: ModelTier;
    capabilities: Capability[];
    personality: ModelPersonality;
    contextWindow: number;
    maxOutput: number;
    status: ModelStatus;
    releasedAt?: string;
    /** Product line grouping (e.g. 'claude-sonnet', 'claude-opus', 'gpt-5', 'gemini-pro'). */
    line?: string;
    /** Optional rollout metadata used for safe latest-stable promotion and rollback clarity. */
    rollout?: ModelRolloutInfo;
    /** Model-specific runtime constraints that affect capability combinations. */
    constraints?: {
        /** When true, provider cache and citations/grounding cannot be used simultaneously. */
        cacheVsCitationsExclusive?: boolean;
        /** Known limitations for diagnostics/logging (not author-facing UI). */
        knownLimitations?: string[];
        /** Whether the provider accepts request-level temperature for this model. */
        supportsTemperature?: boolean;
        /** Whether the provider accepts request-level top_p/topP for this model. */
        supportsTopP?: boolean;
        /** Whether this model exposes provider reasoning effort controls. */
        supportsReasoningEffort?: boolean;
        /**
         * Whether this model uses adaptive thinking (thinking:{type:'adaptive'}
         * + output_config.effort) instead of the legacy manual budget shape
         * (thinking:{type:'enabled',budget_tokens}). Claude Opus 4.7+ reject the
         * legacy shape with a 400; older Claude models require it.
         */
        supportsAdaptiveThinking?: boolean;
        /**
         * Whether this model's extended thinking is ALWAYS ON and cannot be
         * configured (Claude Fable 5). Implications enforced in anthropicApi:
         *   - The `thinking` field must be omitted entirely — every thinking
         *     shape (`{type:'disabled'}` and `{type:'enabled',budget_tokens}`)
         *     returns 400. Depth is set via `output_config.effort`.
         *   - Forced `tool_choice` is incompatible with active thinking, so the
         *     forced-tool structured-output path cannot run. Structured output
         *     instead uses `output_config.format` (json_schema); the JSON then
         *     arrives in a normal text block, not `tool_use.input`.
         * Distinct from `supportsAdaptiveThinking` (which still emits a
         * `thinking:{type:'adaptive'}` field); an always-on model emits none.
         */
        thinkingAlwaysOn?: boolean;
        /**
         * Thinking runs by default when the `thinking` field is omitted
         * (Claude Opus 5). Unlike `thinkingAlwaysOn`, thinking IS
         * configurable: `thinking:{type:'disabled'}` is accepted at effort
         * `high` or below (400 at xhigh/max). The adapter must therefore emit
         * an explicit `thinking:{type:'disabled'}` on every path where RT
         * relies on thinking being off (structured output via forced tool,
         * plain prose without a thinking budget) — silently omitting the
         * field would run adaptive thinking inside max_tokens and change the
         * request contract vs Opus 4.8.
         */
        thinkingDefaultsOn?: boolean;
        /** Provider endpoint/lane RT should use for this model. */
        preferredOpenAiEndpoint?: 'responses' | 'chat_completions';
    };
}

export type EngineCapabilityStatus =
    | 'available'
    | 'provider_supported_not_used'
    | 'unavailable';

export interface EngineCapabilitySignal {
    status: EngineCapabilityStatus;
    providerSupported: boolean;
    availableInRt: boolean;
}

export interface EngineContextCapabilitySignal extends EngineCapabilitySignal {
    contextWindow: number;
}

export interface EngineCapabilities {
    provider: AIProviderId;
    modelId: string;
    modelAlias: string;
    modelLabel: string;
    /** Direct manuscript citations in RT Inquiry (document-backed source mapping). */
    directManuscriptCitations: EngineCapabilitySignal;
    /** Grounded/tool attribution (for example web/file/tool citation metadata). */
    groundedToolAttribution: EngineCapabilitySignal;
    /** RT can render annotation-style source metadata, even if it does not acquire it. */
    annotationRendering: EngineCapabilitySignal;
    corpusReuse: EngineCapabilitySignal;
    largeContext: EngineContextCapabilitySignal;
    batchAnalysis: EngineCapabilitySignal;
    structuredOutputStrength?: 'strong' | 'basic' | 'limited';
    reasoningSupport?: 'strong' | 'standard' | 'limited';
    /** Model-level constraints affecting capability combinations. */
    constraints: {
        cacheVsCitationsExclusive: boolean;
    };
    /** Whether this model is a preview (not production-stable). */
    isPreview: boolean;
}

export type ModelPolicy =
    | { type: 'pinned'; pinnedAlias?: string }
    | { type: 'latestPro' }
    | { type: 'latestStable' };

export interface AIOverrides {
    temperature?: number;
    topP?: number;
    maxOutputMode?: 'auto' | 'high' | 'max';
    reasoningDepth?: 'standard' | 'deep';
    jsonStrict?: boolean;
    seed?: number;
    /**
     * Force the output cap to the model/provider ceiling, bypassing the
     * rate-limit tier clamp and mode/feature multipliers. Used by the
     * truncation retry: a structured reply that hit the (tier-clamped) cap
     * just needs more room, and capping output below the ceiling saves
     * nothing (billing is per token generated, not per token requested).
     */
    forceMaxOutputCeiling?: boolean;
}

export interface AIPrivacySettings {
    allowTelemetry: boolean;
    allowProviderSnapshot: boolean;
}

export interface AIAccessProfile {
    anthropicTier?: AccessTier;
    openaiTier?: AccessTier;
    googleTier?: AccessTier;
}

export interface AIFeatureProfile {
    provider?: AIProviderId;
    modelPolicy?: ModelPolicy;
    overrides?: AIOverrides;
}

export interface AIProviderCredentials {
    openaiSecretId?: string;
    anthropicSecretId?: string;
    googleSecretId?: string;
    ollamaSecretId?: string;
}

export interface AIProviderConnectionSettings {
    ollamaBaseUrl?: string;
}

export interface AICacheWindowSettings {
    /** @deprecated Anthropic Inquiry requests use a fixed 1h TTL; persisted values are ignored. */
    anthropicTtl: AnthropicCacheTtl;
    googleTtlSeconds: number;
    openaiRetention: OpenAiPromptCacheRetention;
    openaiInMemoryWindowMinutes: number;
}

export type LocalLlmBackendId = 'ollama' | 'lmStudio' | 'openaiCompatible';
export type LocalLlmJsonMode = 'response_format' | 'prompt_only';
export type LocalLlmConfigurationMode = 'auto' | 'custom';

/**
 * Capabilities the operator can declare for their local model. `jsonStrict` is
 * not listed: it is the unconditional baseline every local backend must meet,
 * so it is never a user choice. Local backends expose no machine-readable
 * capability manifest, which is why these are operator assertions rather than
 * probe results.
 */
export type DeclarableLocalCapability = Extract<
    Capability,
    'reasoningStrong' | 'longContext' | 'highOutputCap'
>;

export interface LocalLlmSettings {
    enabled: boolean;
    configurationMode: LocalLlmConfigurationMode;
    backend: LocalLlmBackendId;
    baseUrl: string;
    defaultModelId: string;
    timeoutMs: number;
    maxRetries: number;
    jsonMode: LocalLlmJsonMode;
    /**
     * Operator-declared capabilities, merged on top of the local baseline when
     * the model is resolved. Empty by default: RT never assumes a local model
     * can do more than emit strict JSON until the operator says so.
     */
    declaredCapabilities: DeclarableLocalCapability[];
    /**
     * Declarations scoped to `backend|baseUrl::modelId`.
     *
     * A declaration is a claim about ONE model on ONE server -- ConceptSearch
     * doubles its chunk budget on `longContext`, so carrying an 80B's claim onto a
     * 3B sends prompts that model cannot hold. `declaredCapabilities` above is a
     * cache of this map's entry for the ACTIVE identity; readers get it resolved by
     * getLocalLlmSettings() and should never trust the stored array directly.
     */
    capabilitiesByModel: Record<string, DeclarableLocalCapability[]>;
}

export interface AIRoleTemplate {
    id: string;
    name: string;
    prompt: string;
    isBuiltIn: boolean;
}

export interface AiSettingsV1 {
    schemaVersion: 1;
    provider: AIProviderId;
    modelPolicy: ModelPolicy;
    localLlm: LocalLlmSettings;
    roleTemplateId?: string;
    roleTemplates?: AIRoleTemplate[];
    overrides: AIOverrides;
    aiAccessProfile: AIAccessProfile;
    privacy: AIPrivacySettings;
    cacheWindows?: AICacheWindowSettings;
    featureProfiles?: Record<string, AIFeatureProfile>;
    credentials?: AIProviderCredentials;
    connections?: AIProviderConnectionSettings;
    citationsEnabled?: boolean;
    migrationWarnings?: string[];
    /**
     * Ids of one-time settings migrations already applied to this vault.
     *
     * Provenance, not bookkeeping. A migration that deletes an author's
     * setting cannot tell a value we seeded from an identical value the author
     * chose — shape alone does not carry intent. Recording that the migration
     * has run means it runs ONCE: if the author deliberately re-creates the
     * same profile afterwards, it survives every subsequent load.
     */
    appliedMigrations?: string[];
    upgradedBannerPending?: boolean;
    lastThroughputCheck?: AIThroughputCheckResult;
}

export interface AIThroughputCheckResult {
    checkedAt: string;
    provider: Exclude<AIProviderId, 'none'>;
    endpoint: string;
    statusCode: number;
    observedHeaders: Record<string, string>;
    observedFields?: Record<string, string>;
    noLimitInfoAvailable: boolean;
    heuristicTierSuggestion?: AccessTier;
    heuristicSummary: string;
}

export type SourceAttributionType =
    | 'direct_manuscript'
    | 'tool_file'
    | 'tool_url'
    | 'grounded';

export interface DirectManuscriptCitation {
    attributionType?: 'direct_manuscript';
    citedText: string;
    documentIndex: number;
    documentTitle?: string;
    startCharIndex?: number;
    endCharIndex?: number;
}

export interface ExternalAttributionCitation {
    attributionType: Exclude<SourceAttributionType, 'direct_manuscript'>;
    sourceLabel: string;
    citedText?: string;
    sourceId?: string;
    fileId?: string;
    filename?: string;
    url?: string;
    title?: string;
    startCharIndex?: number;
    endCharIndex?: number;
}

export type SourceCitation = DirectManuscriptCitation | ExternalAttributionCitation;

export interface EvidenceDocument {
    title: string;
    content: string;
}

export interface GenerateTextRequest {
    modelId: string;
    systemPrompt?: string | null;
    userPrompt: string;
    promptCacheKey?: string;
    maxOutputTokens?: number;
    temperature?: number;
    topP?: number;
    thinkingBudgetTokens?: number;
    citationsEnabled?: boolean;
    evidenceDocuments?: EvidenceDocument[];
    /** Skip provider-level prompt/context reuse when the adapter supports it. */
    bypassProviderReuse?: boolean;
}

export interface GenerateJsonRequest extends GenerateTextRequest {
    jsonSchema: Record<string, unknown>;
    jsonStrict?: boolean;
}

export interface ProviderExecutionResult {
    success: boolean;
    content: string | null;
    responseData: unknown;
    requestPayload?: unknown;
    diagnostics?: unknown;
    aiStatus: AiStatus;
    aiReason?: string;
    aiProvider: AIProviderId;
    aiModelRequested: string;
    aiModelResolved: string;
    error?: string;
    sanitizationNotes?: string[];
    retryCount?: number;
    /** True when a provider-level content cache was used (e.g. Gemini cachedContent). */
    cacheUsed?: boolean;
    /** Whether the cache was a hit (reuse) or freshly created. */
    cacheStatus?: 'hit' | 'created';
    /**
     * Provider-bound expiry timestamp (ms since epoch) for the cache resource
     * actually used by this call. For Gemini, this is the original cache
     * creation time + TTL — does NOT extend on hits. Use this instead of
     * `Date.now() + ttl` to keep the displayed countdown honest across reuse.
     */
    cacheExpiresAt?: number;
    /** OpenAI-only transport truth for runtime/log alignment. */
    aiTransportLane?: 'chat_completions' | 'responses';
    /** Normalized source attribution (direct manuscript citations or tool/grounded attribution). */
    citations?: SourceCitation[];
}

export interface AIProvider {
    id: AIProviderId;
    supports(capability: Capability): boolean;
    listModels?(): Promise<ModelInfo[]>;
    generateText(req: GenerateTextRequest): Promise<ProviderExecutionResult>;
    generateJson(req: GenerateJsonRequest): Promise<ProviderExecutionResult>;
}

export interface ModelSelectionRequest {
    provider: AIProviderId;
    policy: ModelPolicy;
    requiredCapabilities: Capability[];
    accessTier?: AccessTier;
    /**
     * Input tokens the request will carry. Omit only when resolving a policy
     * with no request in hand (settings, advisories); then no context-window
     * filter applies. Dispatch must always pass the real estimate.
     */
    contextTokensNeeded?: number;
    outputTokensNeeded?: number;
}

export interface ModelSelectionResult {
    provider: AIProviderId;
    model: ModelInfo;
    warnings: string[];
    reason: string;
}

export interface AIRunRequest {
    feature: string;
    task: string;
    requiredCapabilities: Capability[];
    featureModeInstructions?: string;
    projectContext?: string;
    userInput?: string;
    userQuestion?: string;
    /**
     * Place `userQuestion` after the cache-break delimiter (volatile-last layout).
     * Defaults to true only for Inquiry. Set true for any feature that wants the
     * stable corpus reused across runs via provider prompt caching (Gossamer scores
     * one signal per run on an unchanged manuscript — the rubric is the only volatile
     * part). Requires a non-empty `userQuestion`.
     */
    placeUserQuestionLast?: boolean;
    outputRules?: string;
    promptTemplate?: string;
    vars?: Record<string, unknown>;
    promptText?: string;
    systemPrompt?: string | null;
    returnType: 'text' | 'json';
    responseSchema?: Record<string, unknown>;
    policyOverride?: ModelPolicy;
    providerOverride?: AIProviderId;
    overrides?: Partial<AIOverrides>;
    tokenEstimateInput?: number;
    preparedEstimate?: AIRunPreparedEstimate;
    /** Per-scene evidence documents for provider-level citations. */
    evidenceDocuments?: EvidenceDocument[];
    providerReuseKey?: string;
    /** Skip RT's shared in-memory result cache for this run. */
    bypassInMemoryCache?: boolean;
    /** Skip provider-level prompt/context reuse for this run. */
    bypassProviderReuse?: boolean;
    /**
     * Skip the user's active role template (e.g. "commercial genre editor")
     * and use a feature-named neutral scoring role instead. Set true for
     * technical scoring features where the user's normal writing-assist
     * persona would bias the output (Gossamer is the motivating case).
     */
    bypassRoleTemplate?: boolean;
}

export type InputTokenEstimateMethod = 'heuristic_chars' | 'anthropic_count' | 'google_count' | 'unavailable';
export type TokenCountSource = 'provider_count' | 'estimate';
export type RTCorpusEstimateMethod =
    | 'rt_chars_heuristic'
    | 'rt_cleaned_corpus_exact'
    | 'rt_pending';

export interface TokenCountResult {
    provider: Exclude<AIProviderId, 'none'>;
    modelId: string;
    inputTokens: number;
    source: TokenCountSource;
}

export interface RTCorpusTokenBreakdown {
    scenesTokens: number;
    outlineTokens: number;
    referenceTokens: number;
}

export interface RTCorpusTokenEstimate {
    sceneCount: number;
    outlineCount: number;
    referenceCount: number;
    evidenceChars: number;
    estimatedTokens: number;
    method: RTCorpusEstimateMethod;
    breakdown: RTCorpusTokenBreakdown;
}

export interface AIRunPreparedEstimate {
    provider: Exclude<AIProviderId, 'none'>;
    model: ModelInfo;
    modelSelectionReason: string;
    warnings: string[];
    requiredCapabilities: Capability[];
    roleTemplateName: string;
    featureModeInstructions: string;
    systemPrompt: string;
    userPrompt: string;
    finalPrompt: string;
    useDocumentBlocks: boolean;
    evidenceDocuments?: EvidenceDocument[];
    tokenEstimateInput: number;
    tokenEstimateMethod: InputTokenEstimateMethod;
    tokenEstimateUncertainty: number;
    expectedPassCount: number;
    maxInputTokens: number;
    maxOutputTokens: number;
    effectiveInputCeiling: number;
    requestPerMinute: number;
    temperature: number;
    topP?: number;
    jsonStrict: boolean;
    thinkingBudgetTokens?: number;
    citationsEnabled?: boolean;
    retryPolicy: {
        maxAttempts: number;
        baseDelayMs: number;
        retryMalformedJson: boolean;
    };
    resolvedOverrides: AIOverrides;
    allowTelemetry: boolean;
    cacheKey: string;
    providerReuseKey?: string;
}

export type AIRunEstimateResult =
    | { ok: true; estimate: AIRunPreparedEstimate }
    | { ok: false; result: AIRunResult };

export interface AIRunAdvancedContext {
    roleTemplateName: string;
    provider: AIProviderId;
    modelAlias: string;
    modelLabel: string;
    modelSelectionReason: string;
    availabilityStatus: 'visible' | 'not_visible' | 'unknown';
    maxInputTokens: number;
    maxOutputTokens: number;
    tokenEstimateMethod?: InputTokenEstimateMethod;
    tokenEstimateUncertainty?: number;
    executionPassCount?: number;
    multiPassTriggerReason?: string;
    reuseState?: 'idle' | 'eligible' | 'warm';
    /** 0–1: fraction of total input in the cached stable prefix (only set when reuseState is warm). */
    cachedStableRatio?: number;
    /** Estimated token count of the cached stable portion. */
    cachedStableTokens?: number;
    /** Estimated total input tokens (same estimator as pressure bar fillRatio). */
    totalInputTokens?: number;
    /** Whether the Gemini cache was a hit (reuse) or freshly created. */
    cacheStatus?: 'hit' | 'created';
    /**
     * Absolute expiry timestamp (ms since epoch) for the actual provider cache
     * resource — bound to creation time, NOT extended on hit. Surfaced so the
     * UI countdown reflects the real resource lifetime.
     */
    cacheExpiresAt?: number;
    /** OpenAI-only transport truth for runtime/log alignment. */
    openAiTransportLane?: 'chat_completions' | 'responses';
    featureModeInstructions: string;
    finalPrompt: string;
}

export interface AIRunValidation {
    schemaVersion: 1;
    feature: string;
    task: string;
    provider: AIProviderId;
    modelRequested: string;
    modelResolved: string;
    returnType: 'text' | 'json';
    status: AiStatus;
    reason?: string;
    servedFromCache: boolean;
    bypassedInMemoryCache: boolean;
    bypassedProviderReuse: boolean;
    providerReuseCapable: boolean;
    providerReuseRequested: boolean;
    reuseState?: AIRunAdvancedContext['reuseState'];
    providerCacheStatus?: AIRunAdvancedContext['cacheStatus'];
    evidenceTransport: 'none' | 'inline_prompt' | 'document_blocks' | 'cached_content';
    schemaMode: 'none' | 'json_schema';
    citationsRequested: boolean;
    citationsReturned: number;
    requestPayloadCaptured: boolean;
    actualUsageCaptured: boolean;
    transportLane?: 'chat_completions' | 'responses';
    sanitizationNotes: string[];
    adapterNotes: string[];
    submittedAt?: string;
    returnedAt?: string;
    durationMs?: number;
}

export interface AIRunResult {
    content: string | null;
    responseData: unknown;
    provider: AIProviderId;
    modelRequested: string;
    modelResolved: string;
    modelAlias?: string;
    aiStatus: AiStatus;
    aiReason?: string;
    warnings: string[];
    reason: string;
    /** True when the result was served from the shared in-memory RT cache without a provider call. */
    servedFromCache?: boolean;
    /** ISO timestamp captured immediately before the provider call started. */
    submittedAt?: string;
    /** ISO timestamp captured immediately after the final provider response was accepted. */
    returnedAt?: string;
    /** Measured wall-clock time for the provider call path that produced this result. */
    durationMs?: number;
    requestPayload?: unknown;
    /** OpenAI-only transport truth for runtime/log alignment. */
    aiTransportLane?: 'chat_completions' | 'responses';
    error?: string;
    retryCount?: number;
    sanitizationNotes?: string[];
    diagnostics?: unknown;
    advancedContext?: AIRunAdvancedContext;
    /** Normalized source attribution from provider responses. */
    citations?: SourceCitation[];
    validation?: AIRunValidation;
}

export interface RegistryRefreshResult {
    source: 'builtin';
}

export interface CanonicalModelRecord {
    provider: 'openai' | 'anthropic' | 'google';
    id: string;
    label?: string;
    createdAt?: string;
    inputTokenLimit?: number;
    outputTokenLimit?: number;
    raw: Record<string, unknown>;
}

export interface SceneRef {
    ref_id: string;
    ref_label?: string;
    ref_path?: string;
}

export interface ProviderSnapshotPayload {
    generatedAt: string;
    summary: {
        openai: number;
        anthropic: number;
        google: number;
    };
    models: CanonicalModelRecord[];
}
