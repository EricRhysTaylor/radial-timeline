import type RadialTimelinePlugin from '../../main';
import type { RadialTimelineSettings } from '../../types';
import { computeCaps, INPUT_TOKEN_GUARD_FACTOR, type ComputedCaps } from '../caps/computeCaps';
import { mapErrorToUserMessage, mapProviderFailureToError, MalformedJsonError } from '../errors';
import { compilePrompt } from '../prompts/compilePrompt';
import { composeEnvelope, CACHE_BREAK_DELIMITER } from '../prompts/composeEnvelope';
import { buildOutputRulesText } from '../prompts/outputRules';
import { providerSupportsCorpusReuse, sanitizeDispatchParams, type AiProvider, type ProviderDispatchParams } from '../../api/providerCapabilities';
import { ModelRegistry } from '../registry/modelRegistry';
import { BUILTIN_MODELS } from '../registry/builtinModels';
import { findSnapshotModel, loadProviderSnapshot, type ProviderSnapshotLoadResult } from '../registry/providerSnapshot';
import { loadRemotePricing, type RemotePricingLoadResult } from '../cost/remotePricing';
import { mergeRemotePricing } from '../cost/providerPricing';
import { cacheResolvedModel } from '../../utils/modelResolver';
import { selectModel } from '../router/selectModel';
import { resolveActiveRoleTemplate, buildNeutralRoleTemplate } from '../roleTemplate';
import { buildDefaultAiSettings } from '../settings/aiSettings';
import { validateAiSettings } from '../settings/validateAiSettings';
import { getLocalLlmClient } from '../localLlm/client';
import type {
    AIProvider,
    AIProviderId,
    AIRunEstimateResult,
    AIRunPreparedEstimate,
    AIRunRequest,
    AIRunResult,
    AIRunValidation,
    AIRunAdvancedContext,
    AiSettingsV1,
    Capability,
    InputTokenEstimateMethod,
    ModelPolicy,
    ModelInfo,
    AccessTier,
    ProviderExecutionResult,
    RegistryRefreshResult
} from '../types';
import { buildProviders } from '../providers/provider';
import { peekGeminiCache } from '../../api/geminiCacheManager';
import { AICache } from './cache';
import { buildTelemetryEvent, emitTelemetry } from './aiTelemetry';
import { AIRateLimiter } from './rateLimit';
import { validateJsonResponse } from './jsonValidator';
import { estimateHeuristicInputTokens, estimateInputTokens, estimateUncertaintyTokens } from '../tokens/inputTokenEstimate';
import { extractTokenUsage } from '../usage/providerUsage';
import { estimateTokensFromChars } from '../estimates';

const DEFAULT_REMOTE_PROVIDER_SNAPSHOT_URL = 'https://raw.githubusercontent.com/ericrhystaylor/radial-timeline/HEAD/scripts/models/latest-models.json';
const DEFAULT_REMOTE_PRICING_URL = 'https://raw.githubusercontent.com/ericrhystaylor/radial-timeline/main/scripts/models/pricing.json';

interface PluginWithAiDebug extends RadialTimelinePlugin {
    _aiLastRunAdvancedByFeature?: Record<string, AIRunAdvancedContext>;
}

function getAiSettings(settings: RadialTimelineSettings): AiSettingsV1 {
    const validated = validateAiSettings(settings.aiSettings ?? buildDefaultAiSettings());
    return validated.value;
}

function resolveTier(settings: AiSettingsV1, provider: AIProviderId): AccessTier {
    if (provider === 'anthropic') return settings.aiAccessProfile.anthropicTier ?? 1;
    if (provider === 'openai') return settings.aiAccessProfile.openaiTier ?? 1;
    if (provider === 'google') return settings.aiAccessProfile.googleTier ?? 1;
    return 1;
}

function toProviderKey(feature: string, provider: AIProviderId): string {
    return `${feature}:${provider}`;
}

// Third copy of chars/4 removed — see ai/estimates/tokenEstimate.ts.
const estimateTokens = (text: string): number => estimateTokensFromChars(text?.length ?? 0);

function ensureJsonCapability(request: AIRunRequest): Capability[] {
    if (request.returnType !== 'json') return [...request.requiredCapabilities];
    if (request.requiredCapabilities.includes('jsonStrict')) return [...request.requiredCapabilities];
    return [...request.requiredCapabilities, 'jsonStrict'];
}

function mergePolicy(base: ModelPolicy, request: AIRunRequest): ModelPolicy {
    return request.policyOverride ?? base;
}

function hash(input: string): string {
    let h = 2166136261;
    for (let i = 0; i < input.length; i += 1) {
        h ^= input.charCodeAt(i);
        h += (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24);
    }
    return (h >>> 0).toString(16);
}

function mergeOverrides(base: AiSettingsV1['overrides'], request: AIRunRequest): AiSettingsV1['overrides'] {
    return {
        ...base,
        ...(request.overrides || {})
    };
}

function buildCacheKey(params: {
    provider: string;
    modelId: string;
    modelAlias: string;
    returnType: string;
    feature: string;
    task: string;
    prompt: string;
    responseSchema?: Record<string, unknown>;
    citationsEnabled?: boolean;
    useDocumentBlocks?: boolean;
    evidenceDocuments?: Array<{ title: string; content: string }>;
}): string {
    return hash(JSON.stringify({
        provider: params.provider,
        modelId: params.modelId,
        modelAlias: params.modelAlias,
        returnType: params.returnType,
        feature: params.feature,
        task: params.task,
        prompt: params.prompt,
        responseSchema: params.responseSchema ?? null,
        citationsEnabled: params.citationsEnabled ?? false,
        useDocumentBlocks: params.useDocumentBlocks ?? false,
        evidenceDocuments: params.evidenceDocuments ?? []
    }));
}

function withRunTiming(result: AIRunResult, submittedAt: Date | null, returnedAt: Date | null): AIRunResult {
    if (!submittedAt || !returnedAt) return result;
    return {
        ...result,
        submittedAt: submittedAt.toISOString(),
        returnedAt: returnedAt.toISOString(),
        durationMs: Math.max(0, returnedAt.getTime() - submittedAt.getTime())
    };
}

function asRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object'
        ? value as Record<string, unknown>
        : null;
}

function extractAdapterNotes(diagnostics: unknown): string[] {
    const record = asRecord(diagnostics);
    const notes = record?.adapterNotes;
    return Array.isArray(notes)
        ? notes.filter((note): note is string => typeof note === 'string' && note.trim().length > 0)
        : [];
}

function inferProviderReuseRequested(provider: AIProviderId, requestPayload: unknown): boolean {
    const payload = asRecord(requestPayload);
    if (!payload) return false;
    if (provider === 'openai') {
        return typeof payload.prompt_cache_retention === 'string' && payload.prompt_cache_retention.trim().length > 0;
    }
    if (provider === 'google') {
        return typeof payload.cachedContent === 'string' && payload.cachedContent.trim().length > 0;
    }
    if (provider === 'anthropic') {
        const dispatchDiagnostics = asRecord(payload.dispatchDiagnostics);
        if (typeof dispatchDiagnostics?.requestedCacheTtl === 'string' && dispatchDiagnostics.requestedCacheTtl !== 'none') {
            return true;
        }
        const messages = Array.isArray(payload.messages) ? payload.messages : [];
        return messages.some(message => {
            const messageRecord = asRecord(message);
            const content = Array.isArray(messageRecord?.content) ? messageRecord.content : [];
            return content.some(block => asRecord(block)?.cache_control);
        });
    }
    return false;
}

function inferEvidenceTransport(
    provider: AIProviderId,
    requestPayload: unknown,
    useDocumentBlocks: boolean
): AIRunValidation['evidenceTransport'] {
    const payload = asRecord(requestPayload);
    if (provider === 'anthropic' && useDocumentBlocks) return 'document_blocks';
    if (provider === 'google' && typeof payload?.cachedContent === 'string' && payload.cachedContent.trim().length > 0) {
        return 'cached_content';
    }
    if (payload) return 'inline_prompt';
    return 'none';
}

function inferSchemaMode(
    provider: AIProviderId,
    requestPayload: unknown,
    request: AIRunRequest
): AIRunValidation['schemaMode'] {
    const payload = asRecord(requestPayload);
    if (provider === 'openai' && asRecord(payload?.text)?.format) return 'json_schema';
    if (provider === 'google' && asRecord(asRecord(payload?.generationConfig)?.responseSchema)) return 'json_schema';
    if (provider === 'anthropic' && Array.isArray(payload?.tools) && payload.tools.length > 0) return 'json_schema';
    if (provider === 'ollama' && payload?.response_format) return 'json_schema';
    return request.returnType === 'json' && request.responseSchema ? 'json_schema' : 'none';
}

function inferCitationsRequested(
    provider: AIProviderId,
    requestPayload: unknown,
    fallback: boolean
): boolean {
    const payload = asRecord(requestPayload);
    if (!payload) return fallback;
    if (provider === 'google') {
        const tools = Array.isArray(payload.tools) ? payload.tools : [];
        return tools.some(tool => Object.prototype.hasOwnProperty.call(asRecord(tool) ?? {}, 'google_search'));
    }
    if (provider === 'anthropic') {
        const messages = Array.isArray(payload.messages) ? payload.messages : [];
        const hasDocumentCitations = messages.some(message => {
            const messageRecord = asRecord(message);
            const content = Array.isArray(messageRecord?.content) ? messageRecord.content : [];
            return content.some(block => asRecord(asRecord(block)?.citations)?.enabled === true);
        });
        return hasDocumentCitations || fallback;
    }
    return fallback;
}

function withRunValidation(
    request: AIRunRequest,
    estimate: AIRunPreparedEstimate,
    result: AIRunResult,
    options: {
        bypassInMemoryCache: boolean;
        bypassProviderReuse: boolean;
    }
): AIRunResult {
    const provider = result.provider;
    const adapterNotes = extractAdapterNotes(result.diagnostics);
    const providerReuseCapable = provider === 'none' ? false : providerSupportsCorpusReuse(provider);
    const actualUsageCaptured = provider !== 'none' && !!extractTokenUsage(provider, result.responseData);
    const validation: AIRunValidation = {
        schemaVersion: 1,
        feature: request.feature,
        task: request.task,
        provider,
        modelRequested: result.modelRequested,
        modelResolved: result.modelResolved,
        returnType: request.returnType,
        status: result.aiStatus,
        reason: result.aiReason,
        servedFromCache: result.servedFromCache === true,
        bypassedInMemoryCache: options.bypassInMemoryCache,
        bypassedProviderReuse: options.bypassProviderReuse,
        providerReuseCapable,
        providerReuseRequested: !options.bypassProviderReuse && inferProviderReuseRequested(provider, result.requestPayload),
        reuseState: result.advancedContext?.reuseState,
        providerCacheStatus: result.advancedContext?.cacheStatus,
        evidenceTransport: inferEvidenceTransport(provider, result.requestPayload, estimate.useDocumentBlocks),
        schemaMode: inferSchemaMode(provider, result.requestPayload, request),
        citationsRequested: inferCitationsRequested(provider, result.requestPayload, !!estimate.citationsEnabled),
        citationsReturned: result.citations?.length ?? 0,
        requestPayloadCaptured: !!result.requestPayload,
        actualUsageCaptured,
        transportLane: result.aiTransportLane ?? result.advancedContext?.openAiTransportLane,
        sanitizationNotes: [...(result.sanitizationNotes ?? [])],
        adapterNotes,
        submittedAt: result.submittedAt,
        returnedAt: result.returnedAt,
        durationMs: result.durationMs
    };
    return {
        ...result,
        validation
    };
}

function getProjectContext(plugin: RadialTimelinePlugin, request: AIRunRequest): string {
    if (request.projectContext && request.projectContext.trim().length > 0) {
        return request.projectContext;
    }
    const activeBook = typeof plugin.getActiveBookTitle === 'function'
        ? plugin.getActiveBookTitle()
        : 'Unknown Book';
    return `Project: Radial Timeline\nBook: ${activeBook}\nFeature: ${request.feature}\nTask: ${request.task}`;
}

function getOutputRules(request: AIRunRequest): string {
    return buildOutputRulesText({
        outputRules: request.outputRules,
        returnType: request.returnType,
        responseSchema: request.responseSchema
    });
}

/**
 * The one place a request envelope is assembled.
 *
 * Execution and measurement both call this, so a change to what the envelope
 * carries reaches the forecast automatically. An earlier version had the
 * measurement repeat the assembly and claimed "the two cannot drift" — they
 * used the same lower-level helpers but were two orchestrations, and only
 * agreed by coincidence of the current shape.
 */
export function buildRequestEnvelope(
    plugin: RadialTimelinePlugin,
    aiSettings: AiSettingsV1,
    request: AIRunRequest,
    parts: {
        featureModeInstructions: string;
        userInput: string;
        userQuestion?: string;
        placeUserQuestionLast: boolean;
        cacheBreakDelimiter?: string;
    }
): ReturnType<typeof composeEnvelope> {
    const roleTemplate = request.bypassRoleTemplate
        ? buildNeutralRoleTemplate(request.feature)
        : resolveActiveRoleTemplate(plugin, aiSettings);
    const isInquiry = request.feature.toLowerCase().includes('inquiry');
    return composeEnvelope({
        roleTemplateName: roleTemplate.name,
        roleTemplateText: roleTemplate.prompt,
        projectContext: isInquiry ? '' : getProjectContext(plugin, request),
        featureModeInstructions: parts.featureModeInstructions,
        userInput: parts.userInput,
        userQuestion: parts.userQuestion,
        outputRules: getOutputRules(request),
        placeUserQuestionLast: parts.placeUserQuestionLast,
        cacheBreakDelimiter: parts.cacheBreakDelimiter
    });
}

/**
 * Fixed per-call prompt overhead, in characters, for a request shape.
 *
 * A forecast counting only `featureModeInstructions` understates every call:
 * the envelope also carries the role template (name AND body), project
 * context, output rules / JSON schema and section headings. On onboarding's
 * four call shapes that is several hundred to a couple of thousand characters
 * each, charged on every one of ~95 calls.
 *
 * Measured by building the REAL envelope with an empty payload through
 * `buildRequestEnvelope` — the same function execution uses.
 *
 * Excluded, deliberately and by definition: per-call user-input structure
 * (field labels, metadata wrappers around the prose). That is payload, not
 * fixed overhead. Callers must account for it separately, so this is a LOWER
 * BOUND on prompt size.
 *
 * Note it passes no cache-break delimiter: `composeEnvelope` only emits one
 * when a user question is placed last, which no onboarding call does.
 */
export function measureRequestEnvelopeChars(
    plugin: RadialTimelinePlugin,
    request: AIRunRequest
): number {
    const aiSettings = validateAiSettings(plugin.settings.aiSettings ?? null).value;
    const envelope = buildRequestEnvelope(plugin, aiSettings, request, {
        featureModeInstructions: (request.featureModeInstructions ?? '').trim(),
        userInput: '',
        placeUserQuestionLast: false
    });
    return (envelope.finalPrompt || '').length;
}

function setLastRunAdvanced(plugin: RadialTimelinePlugin, feature: string, context: AIRunAdvancedContext): void {
    const target = plugin as PluginWithAiDebug;
    if (!target._aiLastRunAdvancedByFeature) {
        target._aiLastRunAdvancedByFeature = {};
    }
    target._aiLastRunAdvancedByFeature[feature] = context;
}

function toSnapshotProvider(provider: AIProviderId): 'openai' | 'anthropic' | 'google' | null {
    if (provider === 'openai' || provider === 'anthropic' || provider === 'google') return provider;
    return null;
}

export class AIClient {
    private registry: ModelRegistry;
    private providers: Record<AIProviderId, AIProvider | null>;
    private cache = new AICache();
    private limiter = new AIRateLimiter();
    private registryReady = false;
    private providerSnapshot: ProviderSnapshotLoadResult = { source: 'none', snapshot: null };
    private providerSnapshotReady = false;
    private pricingReady = false;

    constructor(private plugin: RadialTimelinePlugin) {
        this.providers = buildProviders(plugin);
        this.registry = this.buildRegistry();
    }

    /**
     * The privacy block in aiSettings is the user's authoritative consent for
     * outbound model-data calls. Reading it on every loader construction —
     * rather than caching at constructor time — means a settings toggle takes
     * effect on the next operation without requiring a plugin reload.
     */
    private isProviderSnapshotAllowed(): boolean {
        return !!getAiSettings(this.plugin.settings).privacy.allowProviderSnapshot;
    }

    private buildRegistry(): ModelRegistry {
        return new ModelRegistry();
    }

    async refreshRegistry(): Promise<RegistryRefreshResult> {
        const result = await this.registry.refresh();
        this.registryReady = true;
        return result;
    }

    async refreshProviderSnapshot(forceRemote?: boolean): Promise<ProviderSnapshotLoadResult> {
        this.providerSnapshot = await loadProviderSnapshot({
            enabled: this.isProviderSnapshotAllowed(),
            forceRemote,
            url: DEFAULT_REMOTE_PROVIDER_SNAPSHOT_URL,
            readCache: async () => this.plugin.settings.aiProviderSnapshotCacheJson ?? null,
            writeCache: async (content: string) => {
                this.plugin.settings.aiProviderSnapshotCacheJson = content;
                await this.plugin.saveSettings();
            }
        });
        this.providerSnapshotReady = true;
        return this.providerSnapshot;
    }

    /**
     * Pricing is model data like the provider snapshot: the same privacy
     * consent gates its fetch. With consent off, built-in (bundled) pricing is
     * used and nothing leaves the machine.
     */
    async refreshPricing(): Promise<RemotePricingLoadResult> {
        const result = await loadRemotePricing({
            enabled: this.isProviderSnapshotAllowed(),
            url: DEFAULT_REMOTE_PRICING_URL,
            readCache: async () => this.plugin.settings.aiPricingCacheJson ?? null,
            writeCache: async (content: string) => {
                this.plugin.settings.aiPricingCacheJson = content;
                await this.plugin.saveSettings();
            }
        });
        if (result.table) {
            mergeRemotePricing(result.table, result.source, result.fetchedAt);
        }
        this.pricingReady = true;
        return result;
    }

    private parseCacheFetchedAt(raw: string | null | undefined): string | null {
        if (!raw) return null;
        try {
            const parsed = JSON.parse(raw) as { fetchedAt?: unknown };
            if (typeof parsed.fetchedAt !== 'string' || !parsed.fetchedAt.trim()) return null;
            const timestamp = Date.parse(parsed.fetchedAt);
            if (!Number.isFinite(timestamp)) return null;
            return new Date(timestamp).toISOString();
        } catch {
            return null; // SAFE: this only reads a display timestamp from cache JSON; unparseable cache means getLastModelUpdateAt reports "never updated" instead of failing the caller
        }
    }

    getLastModelUpdateAt(): string | null {
        const snapshotFetchedAt = this.parseCacheFetchedAt(this.plugin.settings.aiProviderSnapshotCacheJson ?? null);
        const pricingFetchedAt = this.parseCacheFetchedAt(this.plugin.settings.aiPricingCacheJson ?? null);
        const candidates = [snapshotFetchedAt, pricingFetchedAt]
            .filter((value): value is string => !!value)
            .map(value => Date.parse(value))
            .filter(value => Number.isFinite(value));
        if (!candidates.length) return null;
        return new Date(Math.max(...candidates)).toISOString();
    }

    async updateModelData(forceRemote = true): Promise<{
        registry: RegistryRefreshResult;
        snapshot: ProviderSnapshotLoadResult;
        pricing: RemotePricingLoadResult;
        lastUpdatedAt: string | null;
    }> {
        const [registry, snapshot, pricing] = await Promise.all([
            this.refreshRegistry(),
            this.refreshProviderSnapshot(forceRemote),
            this.refreshPricing()
        ]);
        return {
            registry,
            snapshot,
            pricing,
            lastUpdatedAt: this.getLastModelUpdateAt()
        };
    }

    async refreshModelDataIfStale(maxAgeMs = 24 * 60 * 60 * 1000): Promise<boolean> {
        const lastUpdatedAt = this.getLastModelUpdateAt();
        const lastUpdateTs = lastUpdatedAt ? Date.parse(lastUpdatedAt) : Number.NaN;
        const isStale = !Number.isFinite(lastUpdateTs) || (Date.now() - lastUpdateTs) > maxAgeMs;
        if (!isStale) return false;
        try {
            await this.updateModelData(true);
        } catch {
            // Silent background refresh: offline or remote errors should not block UI.
        }
        return true;
    }

    async getRegistryModels(): Promise<ModelInfo[]> {
        if (!this.registryReady) {
            await this.refreshRegistry();
        }
        return this.registry.getAll();
    }

    async getProviderSnapshot(forceRemote?: boolean): Promise<ProviderSnapshotLoadResult> {
        if (!this.providerSnapshotReady || forceRemote) {
            return this.refreshProviderSnapshot(forceRemote);
        }
        return this.providerSnapshot;
    }

    async prepareRunEstimate(request: AIRunRequest): Promise<AIRunEstimateResult> {
        const aiSettings = getAiSettings(this.plugin.settings);
        if (!this.registryReady) {
            await this.refreshRegistry();
        }
        if (!this.pricingReady) {
            await this.refreshPricing();
        }

        const featureProfile = aiSettings.featureProfiles?.[request.feature];
        const provider = request.providerOverride
            ?? featureProfile?.provider
            ?? aiSettings.provider;

        if (provider === 'none') {
            return {
                ok: false,
                result: {
                    content: null,
                    responseData: null,
                    provider,
                    modelRequested: 'none',
                    modelResolved: 'none',
                    aiStatus: 'unavailable',
                    warnings: ['AI provider is disabled.'],
                    reason: 'Provider is set to none.',
                    error: 'AI provider is disabled.'
                }
            };
        }

        const basePolicy = featureProfile?.modelPolicy ?? aiSettings.modelPolicy;
        const policy = mergePolicy(basePolicy, request);
        const requiredCapabilities = ensureJsonCapability(request);

        const compiledPrompt = request.promptTemplate
            ? compilePrompt(request.promptTemplate, request.vars || {})
            : {
                systemPrompt: request.systemPrompt,
                userPrompt: request.promptText || ''
            };
        // Technical scoring features (Gossamer, etc.) opt out of the user's
        // active role template so a "commercial genre editor" or
        // "literary fiction reviewer" persona cannot bias the scoring pass.
        // The feature-named neutral template still gives the model a clean,
        // explicit task framing and surfaces in logs as e.g. "Gossamer
        // Neutral Scoring" — not "Default" — so the audit trail is honest.
        const roleTemplate = request.bypassRoleTemplate
            ? buildNeutralRoleTemplate(request.feature)
            : resolveActiveRoleTemplate(this.plugin, aiSettings);
        const featureModeInstructions = (
            request.featureModeInstructions
            || compiledPrompt.systemPrompt
            || request.systemPrompt
            || ''
        ).trim();
        const useDocumentBlocks = provider === 'anthropic'
            && request.feature.toLowerCase().includes('inquiry')
            && (request.evidenceDocuments?.length ?? 0) > 0;

        const isInquiry = request.feature.toLowerCase().includes('inquiry');
        const hasUserQuestion = typeof request.userQuestion === 'string' && request.userQuestion.trim().length > 0;
        // Volatile-last layout (question after the cache break) is the default for
        // Inquiry; any feature can opt in via request.placeUserQuestionLast to make
        // its stable corpus reusable across provider prompt-cache windows (Gossamer).
        const placeUserQuestionLast = (request.placeUserQuestionLast ?? isInquiry) && hasUserQuestion;
        const envelope = buildRequestEnvelope(this.plugin, aiSettings, request, {
            featureModeInstructions,
            userInput: request.userInput ?? compiledPrompt.userPrompt ?? request.promptText ?? '',
            userQuestion: request.userQuestion,
            placeUserQuestionLast,
            cacheBreakDelimiter: (provider === 'anthropic' || provider === 'google' || provider === 'openai')
                ? CACHE_BREAK_DELIMITER : undefined
        });
        const userPrompt = envelope.userPrompt || '';
        const systemPrompt = envelope.systemPrompt || '';
        const evidenceDocuments = useDocumentBlocks ? request.evidenceDocuments : undefined;

        const heuristicEstimate = Number.isFinite(request.tokenEstimateInput)
            ? Math.max(0, Math.floor(request.tokenEstimateInput as number))
            : estimateHeuristicInputTokens({ systemPrompt, userPrompt, evidenceDocuments });
        const initialSelection = provider === 'ollama'
            ? await getLocalLlmClient(this.plugin).resolveSelectionFromLiveData()
            : selectModel(this.registry.getAll(), {
                provider,
                policy,
                requiredCapabilities,
                accessTier: resolveTier(aiSettings, provider),
                contextTokensNeeded: heuristicEstimate,
                outputTokensNeeded: 0
            });

        // Capability floor for local LLMs. Cloud providers run capability
        // filtering inside selectModel; the Ollama path skips that filter
        // because models come from a live backend probe, not the registry.
        // Without this check, a feature that requires longContext /
        // reasoningStrong / highOutputCap could dispatch to a local model
        // declaring only ['jsonStrict'] and produce garbage results. Local
        // backends publish no capability manifest, so anything above the
        // `jsonStrict` baseline comes from the operator's declaration in
        // Settings → AI → Local LLM (merged into the model by
        // resolveLocalLlmModelInfo). Respect that declaration rather than
        // silently overrunning it.
        if (provider === 'ollama' && requiredCapabilities.length > 0) {
            const localCaps = new Set(initialSelection.model.capabilities ?? []);
            const missing = requiredCapabilities.filter(cap => !localCaps.has(cap));
            if (missing.length > 0) {
                throw new Error(
                    `Local model "${initialSelection.model.label}" lacks required capabilit${missing.length === 1 ? 'y' : 'ies'}: ${missing.join(', ')}. ` +
                    `If your local model supports ${missing.length === 1 ? 'it' : 'them'}, declare ${missing.length === 1 ? 'it' : 'them'} under Settings → AI → Local LLM → Model capabilities. Otherwise switch to a cloud provider for this feature.`
                );
            }
        }

        const overrides = mergeOverrides(aiSettings.overrides, request);
        const caps = computeCaps({
            provider,
            model: initialSelection.model,
            accessTier: resolveTier(aiSettings, provider),
            feature: request.feature,
            overrides,
            userCitationsEnabled: aiSettings.citationsEnabled
        });
        const effectiveInputCeiling = Math.floor(caps.maxInputTokens * INPUT_TOKEN_GUARD_FACTOR);

        // Per RT doctrine (`code-doctrine.md` §2, `inquiry-critical-path-rules.md`
        // §8): when the provider count call fails for Anthropic/Google, the
        // UI must show "unavailable" — never substitute the chars/4
        // heuristic as if it were a provider count. estimateInputTokens
        // throws on failure; we catch here and propagate sentinel values
        // (`inputTokens: 0`, `method: 'unavailable'`) plus the error message
        // as a warning.
        const tokenCountAttemptWarnings: string[] = [];
        let countedEstimate: { inputTokens: number; method: InputTokenEstimateMethod };
        if (Number.isFinite(request.tokenEstimateInput)) {
            countedEstimate = {
                inputTokens: heuristicEstimate,
                method: 'heuristic_chars'
            };
        } else {
            try {
                countedEstimate = await estimateInputTokens({
                    plugin: this.plugin,
                    provider,
                    modelId: initialSelection.model.id,
                    systemPrompt,
                    userPrompt,
                    evidenceDocuments,
                    citationsEnabled: caps.citationsEnabled,
                    jsonSchema: request.responseSchema,
                    safeInputBudget: effectiveInputCeiling
                });
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                // Surface via the structured `warnings` channel only.
                // Obsidian plugins are not supposed to write to the
                // browser console (per project rule), so the diagnostic
                // flows: estimate.warnings → trace.notes → Inquiry Log,
                // and also into the unavailable-pill tooltip via the
                // session's persisted estimate-failure message.
                tokenCountAttemptWarnings.push(
                    `${provider} countTokens failed for model "${initialSelection.model.id}": ${message}`
                );
                countedEstimate = {
                    inputTokens: 0,
                    method: 'unavailable'
                };
            }
        }
        let tokenEstimateInput = countedEstimate.inputTokens;
        let tokenEstimateMethod = countedEstimate.method;
        const tokenEstimateUncertainty = estimateUncertaintyTokens(tokenEstimateMethod, effectiveInputCeiling);
        const expectedPassCount = effectiveInputCeiling > 0
            ? Math.max(1, Math.ceil(tokenEstimateInput / effectiveInputCeiling))
            : 1;

        const cacheKey = buildCacheKey({
            provider,
            modelId: initialSelection.model.id,
            modelAlias: initialSelection.model.alias,
            returnType: request.returnType,
            feature: request.feature,
            task: request.task,
            prompt: envelope.finalPrompt,
            responseSchema: request.responseSchema,
            citationsEnabled: caps.citationsEnabled,
            useDocumentBlocks,
            evidenceDocuments
        });

        return {
            ok: true,
            estimate: {
                provider,
                model: initialSelection.model,
                modelSelectionReason: initialSelection.reason,
                warnings: [...initialSelection.warnings, ...tokenCountAttemptWarnings],
                requiredCapabilities,
                roleTemplateName: roleTemplate.name,
                featureModeInstructions,
                systemPrompt,
                userPrompt,
                finalPrompt: envelope.finalPrompt,
                useDocumentBlocks,
                evidenceDocuments,
                tokenEstimateInput,
                tokenEstimateMethod,
                tokenEstimateUncertainty,
                expectedPassCount,
                maxInputTokens: caps.maxInputTokens,
                maxOutputTokens: caps.maxOutputTokens,
                effectiveInputCeiling,
                requestPerMinute: caps.requestPerMinute,
                temperature: caps.temperature,
                topP: overrides.topP,
                jsonStrict: overrides.jsonStrict ?? true,
                thinkingBudgetTokens: caps.thinkingBudgetTokens,
                citationsEnabled: caps.citationsEnabled,
                retryPolicy: caps.retryPolicy,
                resolvedOverrides: overrides,
                allowTelemetry: aiSettings.privacy.allowTelemetry,
                cacheKey,
                providerReuseKey: request.providerReuseKey
            }
        };
    }

    async run(request: AIRunRequest): Promise<AIRunResult> {
        const prepared = request.preparedEstimate
            ? { ok: true as const, estimate: request.preparedEstimate }
            : await this.prepareRunEstimate(request);
        if (!prepared.ok) {
            return prepared.result;
        }

        const estimate = prepared.estimate;
        const provider = estimate.provider;
        const modelSelection = {
            model: estimate.model,
            warnings: [...estimate.warnings],
            reason: estimate.modelSelectionReason
        };
        const tokenEstimateInput = estimate.tokenEstimateInput;
        const effectiveInputCeiling = estimate.effectiveInputCeiling;
        const caps: ComputedCaps = {
            maxInputTokens: estimate.maxInputTokens,
            maxOutputTokens: estimate.maxOutputTokens,
            safeChunkThreshold: 1,
            temperature: estimate.temperature,
            retryPolicy: estimate.retryPolicy,
            requestPerMinute: estimate.requestPerMinute,
            thinkingBudgetTokens: estimate.thinkingBudgetTokens,
            citationsEnabled: estimate.citationsEnabled
        };
        const systemPrompt = estimate.systemPrompt;
        const userPrompt = estimate.userPrompt;
        const bypassProviderReuse = request.bypassProviderReuse === true;
        const bypassInMemoryCache = request.bypassInMemoryCache === true || bypassProviderReuse;

        if (tokenEstimateInput > effectiveInputCeiling) {
            // Always expose the guard; Inquiry-specific chunking should happen in feature orchestration.
            const message = `Input token estimate ${tokenEstimateInput} exceeds safe threshold (${effectiveInputCeiling}).`;
            return withRunValidation(request, estimate, {
                content: null,
                responseData: null,
                provider,
                modelRequested: modelSelection.model.id,
                modelResolved: modelSelection.model.id,
                modelAlias: modelSelection.model.alias,
                aiStatus: 'rejected',
                aiReason: 'truncated',
                warnings: [...modelSelection.warnings, message],
                reason: `${modelSelection.reason} Token guard rejected request before execution.`,
                error: message,
                advancedContext: {
                    roleTemplateName: estimate.roleTemplateName,
                    provider,
                    modelAlias: modelSelection.model.alias,
                    modelLabel: modelSelection.model.label,
                    modelSelectionReason: modelSelection.reason,
                    availabilityStatus: 'unknown',
                    maxInputTokens: estimate.maxInputTokens,
                    maxOutputTokens: estimate.maxOutputTokens,
                    executionPassCount: 1,
                    totalInputTokens: tokenEstimateInput,
                    reuseState: bypassProviderReuse ? 'idle' : undefined,
                    featureModeInstructions: estimate.featureModeInstructions,
                    finalPrompt: estimate.finalPrompt
                }
            }, {
                bypassInMemoryCache,
                bypassProviderReuse
            });
        }

        const providerClient = this.providers[provider];
        if (!providerClient) {
            return withRunValidation(request, estimate, {
                content: null,
                responseData: null,
                provider,
                modelRequested: modelSelection.model.id,
                modelResolved: modelSelection.model.id,
                modelAlias: modelSelection.model.alias,
                aiStatus: 'unavailable',
                warnings: [...modelSelection.warnings, `Provider client missing for ${provider}.`],
                reason: modelSelection.reason,
                error: `Provider client missing for ${provider}.`
            }, {
                bypassInMemoryCache,
                bypassProviderReuse
            });
        }

        const cacheKey = estimate.cacheKey;
        const recordResolvedAlias = (requestedModelId?: string | null, resolvedModelId?: string | null): void => {
            if (!requestedModelId || !resolvedModelId) return;
            cacheResolvedModel(requestedModelId, resolvedModelId);
        };
        if (!bypassInMemoryCache) {
            const cached = this.cache.get<AIRunResult>(cacheKey);
            if (cached) {
                recordResolvedAlias(cached.modelRequested, cached.modelResolved);
                return withRunValidation(request, estimate, {
                    ...cached,
                    servedFromCache: true,
                    warnings: [...cached.warnings, 'Served from in-memory cache.']
                }, {
                    bypassInMemoryCache,
                    bypassProviderReuse
                });
            }
        }

        await this.limiter.waitForSlot(toProviderKey(request.feature, provider), caps.requestPerMinute);

        const snapshotState = await this.getProviderSnapshot(false);
        const snapshotProvider = toSnapshotProvider(provider);
        const availableModel = snapshotProvider
            ? findSnapshotModel(snapshotState.snapshot, snapshotProvider, modelSelection.model.id)
            : null;
        // A model RT itself curates and ships (in BUILTIN_MODELS) is never
        // marked not_visible by snapshot absence. The provider snapshot is a
        // global catalog fetched from the repo — it is NOT keyed to the user's
        // API key or access tier, and it lags provider releases (a newly
        // promoted model can be missing for days). Claiming such a model is
        // "not visible to your account at your access tier" would be a
        // fabricated reason (code-doctrine § Do Not Lie to the Author). When a
        // curated model is absent from the snapshot we report 'unknown' and let
        // the real provider call be the authority — if the account truly lacks
        // access, the provider returns the real error. Only non-curated models
        // (e.g. a hand-typed id) are gated as not_visible.
        const isCuratedBuiltinModel = BUILTIN_MODELS.some(model => model.id === modelSelection.model.id);
        const availabilityStatus: AIRunAdvancedContext['availabilityStatus'] = !snapshotProvider
            ? 'unknown'
            : !snapshotState.snapshot
            ? 'unknown'
            : availableModel
            ? 'visible'
            : isCuratedBuiltinModel
            ? 'unknown'
            : 'not_visible';

        // Truth-safe reuse state — warm only when provable
        const cacheDelimiterUsed = userPrompt.includes(CACHE_BREAK_DELIMITER);
        const cacheAttempted = provider === 'anthropic'
            ? (cacheDelimiterUsed || ((estimate.useDocumentBlocks ? estimate.evidenceDocuments : undefined)?.length ?? 0) > 0)
            : cacheDelimiterUsed;
        let reuseState: AIRunAdvancedContext['reuseState'] = 'idle';
        if (bypassProviderReuse) {
            reuseState = 'idle';
        } else if (provider === 'anthropic') {
            reuseState = cacheAttempted ? 'eligible' : 'idle';
        } else if (provider === 'google') {
            reuseState = cacheDelimiterUsed ? 'eligible' : 'idle';
        } else if (provider === 'openai') {
            reuseState = cacheDelimiterUsed ? 'eligible' : 'idle';
        }

        // Compute cached stable ratio from delimiter split.
        // Single stableText variable — reused for ratio estimation and optimistic peek.
        // Uses tokenEstimateInput (same estimator as pressure bar fillRatio) for visual consistency.
        let cachedStableRatio: number | undefined;
        let cachedStableTokens: number | undefined;
        let stableText: string | undefined;
        if (cacheDelimiterUsed) {
            const delimIndex = userPrompt.indexOf(CACHE_BREAK_DELIMITER);
            if (delimIndex > 0) {
                stableText = userPrompt.slice(0, delimIndex);
                // Anthropic: only user stable block is cached
                // Gemini: system instruction goes inside cached content too
                const stableTokens = provider === 'google'
                    ? estimateTokens(stableText) + estimateTokens(systemPrompt)
                    : estimateTokens(stableText);
                cachedStableTokens = stableTokens;
                cachedStableRatio = tokenEstimateInput > 0
                    ? Math.min(stableTokens / tokenEstimateInput, 1) : 0;
            }
        }

        // Optimistic warm: if the in-memory cache store already has a valid entry,
        // we know the upcoming execute will hit it. Set warm + ratio immediately
        // so the UI shows the hatched overlay from the start of the run.
        const optimisticWarm = !bypassProviderReuse
            && provider === 'google' && cacheDelimiterUsed
            && stableText !== undefined && cachedStableRatio !== undefined
            && peekGeminiCache(modelSelection.model.id, systemPrompt, stableText);

        if (optimisticWarm) {
            reuseState = 'warm';
        }

        const advancedContext: AIRunAdvancedContext = {
            roleTemplateName: estimate.roleTemplateName,
            provider,
            modelAlias: modelSelection.model.alias,
            modelLabel: modelSelection.model.label,
            modelSelectionReason: modelSelection.reason,
            availabilityStatus,
            maxInputTokens: caps.maxInputTokens,
            maxOutputTokens: caps.maxOutputTokens,
            tokenEstimateMethod: estimate.tokenEstimateMethod,
            tokenEstimateUncertainty: estimate.tokenEstimateUncertainty,
            executionPassCount: 1,
            reuseState,
            // Only expose confirmed cached-prefix metrics when the provider
            // already proved a warm hit.
            cachedStableRatio: optimisticWarm
                ? cachedStableRatio : undefined,
            cachedStableTokens: optimisticWarm
                ? cachedStableTokens : undefined,
            totalInputTokens: tokenEstimateInput,
            featureModeInstructions: estimate.featureModeInstructions,
            finalPrompt: estimate.finalPrompt
        };
        setLastRunAdvanced(this.plugin, request.feature, advancedContext);

        // Pre-dispatch availability gate. Only fires for NON-curated models
        // (e.g. a hand-typed id) that are also absent from the provider
        // snapshot — dispatching those wastes the user's API budget on a
        // guaranteed 404/400. Curated BUILTIN_MODELS are exempt above
        // (snapshot lag must not block a model RT ships). The advancedContext
        // already carries the status into logs/UI before we throw.
        if (availabilityStatus === 'not_visible') {
            throw new Error(
                `Model "${modelSelection.model.label}" (${modelSelection.model.alias}) is not in the current ${provider} model snapshot — it may be retired, misspelled, or not yet published. ` +
                `Pick a model from the list in Settings → AI before running.`
            );
        }

        const providerCallStartedAt = new Date();
        const execution = await this.execute(providerClient, {
            modelId: modelSelection.model.id,
            systemPrompt,
            userPrompt,
            promptCacheKey: !bypassProviderReuse ? estimate.providerReuseKey : undefined,
            maxOutputTokens: caps.maxOutputTokens,
            temperature: caps.temperature,
            topP: estimate.topP,
            jsonSchema: request.responseSchema,
            jsonStrict: estimate.jsonStrict,
            thinkingBudgetTokens: caps.thinkingBudgetTokens,
            citationsEnabled: caps.citationsEnabled,
            bypassProviderReuse,
            evidenceDocuments: estimate.useDocumentBlocks ? estimate.evidenceDocuments : undefined
        }, request.returnType, caps, modelSelection.model.constraints);
        let providerCallReturnedAt = new Date();
        recordResolvedAlias(execution.aiModelRequested, execution.aiModelResolved);

        if (provider === 'openai' && execution.aiTransportLane) {
            advancedContext.openAiTransportLane = execution.aiTransportLane;
            setLastRunAdvanced(this.plugin, request.feature, advancedContext);
        }

        const actualUsage = extractTokenUsage(provider, execution.responseData);
        if (typeof actualUsage?.inputTokens === 'number' && actualUsage.inputTokens > 0) {
            advancedContext.totalInputTokens = actualUsage.inputTokens;
        }

        if (!bypassProviderReuse && provider === 'anthropic') {
            // Cache-CREATE runs report cacheReadInputTokens=0 and cacheCreationInputTokens>0;
            // cache-HIT runs report the inverse. Take the max so both paths populate the
            // cached-prefix metric. (`??` short-circuits at 0 — read=0 would otherwise
            // suppress the creation tokens and leave the cached-overlay metric undefined.)
            const anthropicReadTokens = typeof actualUsage?.cacheReadInputTokens === 'number'
                && Number.isFinite(actualUsage.cacheReadInputTokens) && actualUsage.cacheReadInputTokens > 0
                ? actualUsage.cacheReadInputTokens
                : 0;
            const anthropicCreationTokens = typeof actualUsage?.cacheCreationInputTokens === 'number'
                && Number.isFinite(actualUsage.cacheCreationInputTokens) && actualUsage.cacheCreationInputTokens > 0
                ? actualUsage.cacheCreationInputTokens
                : ((actualUsage?.cacheCreation5mInputTokens ?? 0) + (actualUsage?.cacheCreation1hInputTokens ?? 0));
            const anthropicCachedTokens = Math.max(anthropicReadTokens, anthropicCreationTokens);
            const anthropicTotalInputTokens = actualUsage?.inputTokens ?? tokenEstimateInput;
            if (anthropicCachedTokens > 0 && anthropicTotalInputTokens > 0) {
                advancedContext.cachedStableTokens = anthropicCachedTokens;
                advancedContext.cachedStableRatio = Math.min(anthropicCachedTokens / anthropicTotalInputTokens, 1);
            }
        }
        if (!bypassProviderReuse && provider === 'openai') {
            const openAiCachedTokens = Math.max(0, actualUsage?.cacheReadInputTokens ?? 0);
            const openAiTotalInputTokens = actualUsage?.inputTokens ?? tokenEstimateInput;
            if (openAiCachedTokens > 0 && openAiTotalInputTokens > 0) {
                advancedContext.cachedStableTokens = openAiCachedTokens;
                advancedContext.cachedStableRatio = Math.min(openAiCachedTokens / openAiTotalInputTokens, 1);
            }
        }

        // Post-execute: confirm or downgrade provider cache state using runtime truth.
        if (!bypassProviderReuse && (
            (provider === 'anthropic' && cacheAttempted)
            || (provider === 'google' && cacheDelimiterUsed)
            || (provider === 'openai' && advancedContext.reuseState !== 'idle')
        )) {
            if (execution.cacheUsed) {
                // Confirmed hit — safe to mark warm and surface cache coverage.
                advancedContext.reuseState = 'warm';
                if (provider === 'google' && typeof cachedStableRatio === 'number') {
                    advancedContext.cachedStableRatio = cachedStableRatio;
                }
                if (provider === 'google' && typeof cachedStableTokens === 'number') {
                    advancedContext.cachedStableTokens = cachedStableTokens;
                }
                advancedContext.cacheStatus = execution.cacheStatus;
                if (typeof execution.cacheExpiresAt === 'number') {
                    advancedContext.cacheExpiresAt = execution.cacheExpiresAt;
                }
                setLastRunAdvanced(this.plugin, request.feature, advancedContext);
            } else if (execution.cacheStatus === 'created' || optimisticWarm || advancedContext.reuseState !== 'idle') {
                // Cache was attempted or predicted but did not hit.
                advancedContext.reuseState = 'eligible';
                if (provider === 'google') {
                    advancedContext.cachedStableRatio = undefined;
                    advancedContext.cachedStableTokens = undefined;
                }
                advancedContext.cacheStatus = execution.cacheStatus;
                if (typeof execution.cacheExpiresAt === 'number') {
                    advancedContext.cacheExpiresAt = execution.cacheExpiresAt;
                }
                setLastRunAdvanced(this.plugin, request.feature, advancedContext);
            }
        }

        const warnings = [...modelSelection.warnings];
        if (execution.aiReason === 'truncated') {
            warnings.push('Provider indicated truncation risk.');
        }

        if (execution.aiStatus !== 'success' || !execution.content) {
            const mappedError = mapProviderFailureToError({
                provider,
                error: execution.error,
                aiStatus: execution.aiStatus,
                aiReason: execution.aiReason
            });
            return withRunValidation(request, estimate, withRunTiming({
                content: execution.content,
                responseData: execution.responseData,
                provider,
                modelRequested: execution.aiModelRequested,
                modelResolved: execution.aiModelResolved,
                modelAlias: modelSelection.model.alias,
                aiStatus: execution.aiStatus,
                aiReason: execution.aiReason,
                warnings,
                reason: modelSelection.reason,
                requestPayload: execution.requestPayload,
                aiTransportLane: execution.aiTransportLane,
                error: mapErrorToUserMessage(mappedError),
                retryCount: execution.retryCount,
                sanitizationNotes: execution.sanitizationNotes,
                diagnostics: execution.diagnostics,
                advancedContext,
                citations: execution.citations
            }, providerCallStartedAt, providerCallReturnedAt), {
                bypassInMemoryCache,
                bypassProviderReuse
            });
        }

        if (request.returnType === 'json') {
            const validation = validateJsonResponse(execution.content, request.responseSchema, provider);
            const validationNotes = validation.normalizationWarnings ?? [];
            if (!validation.ok) {
                if (caps.retryPolicy.retryMalformedJson && caps.retryPolicy.maxAttempts > 0) {
                    // Mirror the original dispatch so the retry sees the same corpus
                    // and capability flags. Stripping evidenceDocuments here once
                    // produced silent hallucinations: the retry succeeded against
                    // a 6.5k-token prompt with no manuscript context, while the
                    // first call had been built on the full ~300k-token corpus.
                    const retry = await this.execute(providerClient, {
                        modelId: modelSelection.model.id,
                        systemPrompt,
                        userPrompt,
                        promptCacheKey: !bypassProviderReuse ? estimate.providerReuseKey : undefined,
                        maxOutputTokens: caps.maxOutputTokens,
                        temperature: caps.temperature,
                        topP: estimate.topP,
                        jsonSchema: request.responseSchema,
                        jsonStrict: estimate.jsonStrict,
                        thinkingBudgetTokens: caps.thinkingBudgetTokens,
                        citationsEnabled: caps.citationsEnabled,
                        bypassProviderReuse,
                        evidenceDocuments: estimate.useDocumentBlocks ? estimate.evidenceDocuments : undefined
                    }, request.returnType, caps, modelSelection.model.constraints);
                    providerCallReturnedAt = new Date();

                    if (retry.aiStatus === 'success' && retry.content) {
                        recordResolvedAlias(retry.aiModelRequested, retry.aiModelResolved);
                        const retryValidation = validateJsonResponse(retry.content, request.responseSchema, provider);
                        const retryValidationNotes = retryValidation.normalizationWarnings ?? [];
                        if (retryValidation.ok) {
                            const acceptedRetryContent = retryValidation.normalizedRaw ?? retry.content;
                            const result = withRunValidation(request, estimate, withRunTiming({
                                content: acceptedRetryContent,
                                responseData: retry.responseData,
                                provider,
                                modelRequested: retry.aiModelRequested,
                                modelResolved: retry.aiModelResolved,
                                modelAlias: modelSelection.model.alias,
                                aiStatus: retry.aiStatus,
                                aiReason: retry.aiReason,
                                warnings: [...warnings, 'Initial JSON parse failed; retry succeeded.', ...retryValidationNotes],
                                reason: modelSelection.reason,
                                requestPayload: retry.requestPayload,
                                aiTransportLane: retry.aiTransportLane,
                                retryCount: (retry.retryCount ?? 0) + 1,
                                sanitizationNotes: [
                                    ...(retry.sanitizationNotes ?? []),
                                    ...retryValidationNotes
                                ],
                                diagnostics: retry.diagnostics,
                                advancedContext,
                                citations: retry.citations
                            }, providerCallStartedAt, providerCallReturnedAt), {
                                bypassInMemoryCache,
                                bypassProviderReuse
                            });
                            this.cache.set(cacheKey, result);
                            emitTelemetry(estimate.allowTelemetry, buildTelemetryEvent(request, result));
                            return result;
                        }
                    }
                }

                const parseError = validation.error ?? new MalformedJsonError('Invalid JSON response.', { provider });
                return withRunValidation(request, estimate, withRunTiming({
                    content: execution.content,
                    responseData: execution.responseData,
                    provider,
                    modelRequested: execution.aiModelRequested,
                    modelResolved: execution.aiModelResolved,
                    modelAlias: modelSelection.model.alias,
                    aiStatus: 'rejected',
                    aiReason: 'invalid_response',
                    warnings: [...warnings, 'JSON validation failed.'],
                    reason: modelSelection.reason,
                    requestPayload: execution.requestPayload,
                    aiTransportLane: execution.aiTransportLane,
                    error: mapErrorToUserMessage(parseError),
                    retryCount: execution.retryCount,
                    sanitizationNotes: execution.sanitizationNotes,
                    diagnostics: execution.diagnostics,
                    advancedContext,
                    citations: execution.citations
                }, providerCallStartedAt, providerCallReturnedAt), {
                    bypassInMemoryCache,
                    bypassProviderReuse
                });
            }

            if (validation.normalizedRaw) {
                execution.content = validation.normalizedRaw;
            }
            if (validationNotes.length) {
                execution.sanitizationNotes = [
                    ...(execution.sanitizationNotes ?? []),
                    ...validationNotes
                ];
                warnings.push(...validationNotes);
            }
        }

        const result = withRunValidation(request, estimate, withRunTiming({
            content: execution.content,
            responseData: execution.responseData,
            provider,
            modelRequested: execution.aiModelRequested,
            modelResolved: execution.aiModelResolved,
            modelAlias: modelSelection.model.alias,
            aiStatus: execution.aiStatus,
            aiReason: execution.aiReason,
            warnings,
            reason: modelSelection.reason,
            requestPayload: execution.requestPayload,
            aiTransportLane: execution.aiTransportLane,
            retryCount: execution.retryCount,
            sanitizationNotes: execution.sanitizationNotes,
            diagnostics: execution.diagnostics,
            advancedContext,
            citations: execution.citations
        }, providerCallStartedAt, providerCallReturnedAt), {
            bypassInMemoryCache,
            bypassProviderReuse
        });

        this.cache.set(cacheKey, result);
        emitTelemetry(estimate.allowTelemetry, buildTelemetryEvent(request, result));
        return result;
    }

    private async execute(
        provider: AIProvider,
        params: ProviderDispatchParams,
        returnType: 'text' | 'json',
        _caps: ComputedCaps,
        modelConstraints?: { cacheVsCitationsExclusive?: boolean }
    ): Promise<ProviderExecutionResult> {
        // Central sanitization — authoritative enforcement point.
        // Provider adapters receive only sanitized params.
        const providerId = provider.id as AiProvider;
        const { params: sanitized, notes } = sanitizeDispatchParams(
            providerId, params, modelConstraints
        );
        let result: ProviderExecutionResult;
        if (returnType === 'json') {
            result = await provider.generateJson({
                modelId: sanitized.modelId,
                systemPrompt: sanitized.systemPrompt ?? null,
                userPrompt: sanitized.userPrompt,
                promptCacheKey: sanitized.promptCacheKey,
                maxOutputTokens: sanitized.maxOutputTokens,
                temperature: sanitized.temperature,
                topP: sanitized.topP,
                jsonSchema: sanitized.jsonSchema || { type: 'object' },
                jsonStrict: sanitized.jsonStrict,
                thinkingBudgetTokens: sanitized.thinkingBudgetTokens,
                citationsEnabled: sanitized.citationsEnabled,
                bypassProviderReuse: sanitized.bypassProviderReuse,
                evidenceDocuments: sanitized.evidenceDocuments
            });
        } else {
            result = await provider.generateText({
                modelId: sanitized.modelId,
                systemPrompt: sanitized.systemPrompt ?? null,
                userPrompt: sanitized.userPrompt,
                promptCacheKey: sanitized.promptCacheKey,
                maxOutputTokens: sanitized.maxOutputTokens,
                temperature: sanitized.temperature,
                topP: sanitized.topP,
                thinkingBudgetTokens: sanitized.thinkingBudgetTokens,
                citationsEnabled: sanitized.citationsEnabled,
                bypassProviderReuse: sanitized.bypassProviderReuse,
                evidenceDocuments: sanitized.evidenceDocuments
            });
        }

        if (notes.length) {
            result.sanitizationNotes = [
                ...(result.sanitizationNotes || []),
                ...notes
            ];
        }
        return result;
    }
}

export function getAIClient(plugin: RadialTimelinePlugin): AIClient {
    const anyPlugin = plugin as unknown as { _aiClient?: AIClient };
    if (!anyPlugin._aiClient) {
        anyPlugin._aiClient = new AIClient(plugin);
    }
    return anyPlugin._aiClient;
}

export function getLastAiAdvancedContext(
    plugin: RadialTimelinePlugin,
    feature: string
): AIRunAdvancedContext | null {
    const target = plugin as PluginWithAiDebug;
    return target._aiLastRunAdvancedByFeature?.[feature] ?? null;
}
