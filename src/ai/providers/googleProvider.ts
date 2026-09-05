import type RadialTimelinePlugin from '../../main';
import { callGeminiApi } from '../../api/geminiApi';
import { getOrCreateGeminiCache } from '../../api/geminiCacheManager';
import { classifyProviderError } from '../../api/providerErrors';
import { extractTokenUsage } from '../usage/providerUsage';
import { getCredential } from '../credentials/credentials';
import { CACHE_BREAK_DELIMITER } from '../prompts/composeEnvelope';
import { buildDefaultAiSettings } from '../settings/aiSettings';
import { normalizeGeminiCacheTtlSeconds } from '../settings/cacheWindows';
import { validateAiSettings } from '../settings/validateAiSettings';
import type { AIProvider, Capability, GenerateJsonRequest, GenerateTextRequest, ProviderExecutionResult } from '../types';

const CAPS: Capability[] = ['longContext', 'jsonStrict', 'reasoningStrong', 'highOutputCap', 'streaming'];

export class GoogleProvider implements AIProvider {
    id = 'google' as const;

    constructor(private plugin: RadialTimelinePlugin) {}

    supports(capability: Capability): boolean {
        return CAPS.includes(capability);
    }

    /**
     * Derive the Gemini cache provenance for this call.
     *
     * Key distinction (the doctrine): Gemini's `cachedContentTokenCount`
     * is a BILLING fact, not a provenance fact. Whenever `cachedContent: …`
     * is supplied, Gemini reports `cachedContentTokenCount > 0` — even
     * when the resource was created in THIS very call. So response usage
     * alone cannot distinguish:
     *   - "this call reused a prior cache" (true hit), vs
     *   - "this call created the cache and was billed at the cached
     *     rate for the prefix" (creation + armed for next call).
     *
     * The cache manager is the only source that knows which happened —
     * it tells us via `clientCacheStatus`:
     *   - `'hit'`   → an existing in-memory entry was still valid; reuse.
     *   - `'created'` → no valid entry; we just primed a new resource.
     *
     * Trust `clientCacheStatus` first. Only fall back to response-only
     * derivation in the unreachable case where a `cachedContentName` was
     * supplied without a status (defensive — current call sites always
     * set both together).
     */
    private deriveCacheResult(
        responseData: unknown,
        cachedContentName: string | undefined,
        clientCacheStatus: ProviderExecutionResult['cacheStatus']
    ): Pick<ProviderExecutionResult, 'cacheUsed' | 'cacheStatus'> {
        if (!cachedContentName) return {};
        if (clientCacheStatus === 'hit') {
            // True reuse: a prior valid resource was found and reused.
            // `cacheUsed: true` marks the run as warm downstream.
            return { cacheUsed: true, cacheStatus: 'hit' };
        }
        if (clientCacheStatus === 'created') {
            // Cache was primed for this call. The prefix was billed at
            // the cached rate, but no prior resource was reused — this
            // is NOT a hit. `cacheUsed: false` keeps reuseState at
            // 'eligible' (cache armed for next run) rather than 'warm'
            // (which would imply reuse already happened).
            return { cacheUsed: false, cacheStatus: 'created' };
        }
        // Unreachable defensive: cachedContentName was set but no
        // status. Treat as creation (the safer claim — does not
        // fabricate reuse).
        const usage = extractTokenUsage('google', responseData);
        void (usage?.cacheReadInputTokens); // intentionally unused — we no longer infer hit from usage
        return { cacheUsed: false, cacheStatus: 'created' };
    }

    private buildCacheSetupFailure(
        req: GenerateTextRequest,
        ttlSeconds: number,
        stableText: string,
        error: unknown
    ): ProviderExecutionResult {
        const message = error instanceof Error ? error.message : String(error);
        return {
            success: false,
            content: null,
            responseData: {
                error: {
                    message,
                    type: 'cache_setup_error'
                }
            },
            diagnostics: {
                cacheSetupFailed: true,
                cacheSetupMode: 'cached_content',
                stableTextChars: stableText.length,
                ttlSeconds
            },
            aiStatus: 'rejected',
            aiReason: 'cache_setup_failed',
            aiProvider: 'google',
            aiModelRequested: req.modelId,
            aiModelResolved: req.modelId,
            error: `Gemini cached content setup failed before dispatch: ${message}`
        };
    }

    async generateText(req: GenerateTextRequest): Promise<ProviderExecutionResult> {
        const apiKey = await getCredential(this.plugin, 'google');
        const aiSettings = validateAiSettings(this.plugin.settings.aiSettings ?? buildDefaultAiSettings()).value;
        const ttlSeconds = normalizeGeminiCacheTtlSeconds(aiSettings.cacheWindows?.googleTtlSeconds);
        let userPrompt = req.userPrompt;
        let cachedContentName: string | undefined;
        let cacheStatus: ProviderExecutionResult['cacheStatus'];
        let cacheExpiresAt: number | undefined;
        if (!req.citationsEnabled && !req.bypassProviderReuse) {
            const delimIndex = userPrompt.indexOf(CACHE_BREAK_DELIMITER);
            if (delimIndex > 0) {
                const stableText = userPrompt.slice(0, delimIndex).trimEnd();
                const volatileText = userPrompt.slice(delimIndex + CACHE_BREAK_DELIMITER.length).trimStart();
                if (stableText) {
                    try {
                        const cache = await getOrCreateGeminiCache(
                            apiKey,
                            req.modelId,
                            stableText,
                            req.systemPrompt ?? undefined,
                            ttlSeconds
                        );
                        if (cache) {
                            cachedContentName = cache.cacheName;
                            cacheStatus = cache.status;
                            cacheExpiresAt = cache.expiresAt;
                            userPrompt = volatileText;
                        }
                    } catch (error) {
                        return this.buildCacheSetupFailure(req, ttlSeconds, stableText, error);
                    }
                }
            }
        }
        const result = await callGeminiApi(
            apiKey,
            req.modelId,
            req.systemPrompt ?? null,
            userPrompt,
            req.maxOutputTokens ?? 4000,
            req.temperature,
            undefined,
            cachedContentName,
            req.topP,
            req.citationsEnabled,
            true
        );
        const classification = classifyProviderError(result);
        const cacheResult = this.deriveCacheResult(result.responseData, cachedContentName, cacheStatus);
        return {
            success: result.success,
            content: result.content,
            responseData: result.responseData,
            requestPayload: result.requestPayload,
            aiStatus: result.success ? 'success' : classification.aiStatus,
            aiReason: result.success ? undefined : classification.aiReason,
            aiProvider: 'google',
            aiModelRequested: req.modelId,
            aiModelResolved: req.modelId,
            error: result.error,
            citations: result.citations,
            ...cacheResult,
            ...(cacheExpiresAt !== undefined ? { cacheExpiresAt } : {})
        };
    }

    async generateJson(req: GenerateJsonRequest): Promise<ProviderExecutionResult> {
        const apiKey = await getCredential(this.plugin, 'google');
        const aiSettings = validateAiSettings(this.plugin.settings.aiSettings ?? buildDefaultAiSettings()).value;
        const ttlSeconds = normalizeGeminiCacheTtlSeconds(aiSettings.cacheWindows?.googleTtlSeconds);
        let userPrompt = req.userPrompt;
        let cachedContentName: string | undefined;
        let cacheStatus: ProviderExecutionResult['cacheStatus'];
        let cacheExpiresAt: number | undefined;
        if (!req.citationsEnabled && !req.bypassProviderReuse) {
            const delimIndex = userPrompt.indexOf(CACHE_BREAK_DELIMITER);
            if (delimIndex > 0) {
                const stableText = userPrompt.slice(0, delimIndex).trimEnd();
                const volatileText = userPrompt.slice(delimIndex + CACHE_BREAK_DELIMITER.length).trimStart();
                if (stableText) {
                    try {
                        const cache = await getOrCreateGeminiCache(
                            apiKey,
                            req.modelId,
                            stableText,
                            req.systemPrompt ?? undefined,
                            ttlSeconds
                        );
                        if (cache) {
                            cachedContentName = cache.cacheName;
                            cacheStatus = cache.status;
                            cacheExpiresAt = cache.expiresAt;
                            userPrompt = volatileText;
                        }
                    } catch (error) {
                        return this.buildCacheSetupFailure(req, ttlSeconds, stableText, error);
                    }
                }
            }
        }
        const result = await callGeminiApi(
            apiKey,
            req.modelId,
            req.systemPrompt ?? null,
            userPrompt,
            req.maxOutputTokens ?? 4000,
            req.temperature,
            req.jsonSchema,
            cachedContentName,
            req.topP,
            req.citationsEnabled,
            true
        );
        const classification = classifyProviderError(result);
        const cacheResult = this.deriveCacheResult(result.responseData, cachedContentName, cacheStatus);
        return {
            success: result.success,
            content: result.content,
            responseData: result.responseData,
            requestPayload: result.requestPayload,
            aiStatus: result.success ? 'success' : classification.aiStatus,
            aiReason: result.success ? undefined : classification.aiReason,
            aiProvider: 'google',
            aiModelRequested: req.modelId,
            aiModelResolved: req.modelId,
            error: result.error,
            citations: result.citations,
            ...cacheResult,
            ...(cacheExpiresAt !== undefined ? { cacheExpiresAt } : {})
        };
    }
}
