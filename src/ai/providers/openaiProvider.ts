import type RadialTimelinePlugin from '../../main';
import { callOpenAiResponsesApi } from '../../api/openaiApi';
import { classifyProviderError } from '../../api/providerErrors';
import { extractTokenUsage } from '../usage/providerUsage';
import { getCredential } from '../credentials/credentials';
import { buildDefaultAiSettings } from '../settings/aiSettings';
import { validateAiSettings } from '../settings/validateAiSettings';
import type { AIProvider, Capability, GenerateJsonRequest, GenerateTextRequest, ProviderExecutionResult } from '../types';

const CAPS: Capability[] = ['longContext', 'jsonStrict', 'reasoningStrong', 'toolCalling', 'functionCalling', 'streaming'];

export class OpenAIProvider implements AIProvider {
    id = 'openai' as const;

    constructor(private plugin: RadialTimelinePlugin) {}

    supports(capability: Capability): boolean {
        return CAPS.includes(capability);
    }

    /**
     * Derive OpenAI cache provenance.
     *
     * Unlike Anthropic (which reports both `cache_read_input_tokens` and
     * `cache_creation_input_tokens` in the response) or Gemini (where the
     * cache manager tracks create-vs-hit explicitly), OpenAI prompt
     * caching is implicit:
     *   - Response shows `cached_tokens > 0` → confirmed reuse this call.
     *   - Response shows `cached_tokens === 0` → either (a) no prior
     *     cache existed (so this call PRIMED the prefix for next time)
     *     or (b) caching wasn't attempted at all.
     *
     * We disambiguate (a) vs (b) using `promptCacheKeySupplied`: if the
     * caller passed a `prompt_cache_key` and the run succeeded with no
     * cached tokens, this run armed the cache for the next call.
     *
     * OpenAI auto-caches prefixes ≥ ~1024 tokens, and Inquiry runs are
     * always far above that threshold, so the 'created' claim is
     * reliable enough to surface in the UI alongside the cache-window
     * countdown the Settings preview already shows.
     */
    private deriveCacheResult(
        responseData: unknown,
        promptCacheKeySupplied: boolean,
        runSucceeded: boolean
    ): Pick<ProviderExecutionResult, 'cacheUsed' | 'cacheStatus'> {
        const usage = extractTokenUsage('openai', responseData);
        const cacheRead = usage?.cacheReadInputTokens ?? 0;
        if (cacheRead > 0) {
            return {
                cacheUsed: true,
                cacheStatus: 'hit'
            };
        }
        if (promptCacheKeySupplied && runSucceeded) {
            // Run primed the cache for next call. Not a hit (cacheUsed=false
            // keeps reuseState='eligible' downstream rather than 'warm') but
            // explicitly armed.
            return {
                cacheUsed: false,
                cacheStatus: 'created'
            };
        }
        return {};
    }

    async generateText(req: GenerateTextRequest): Promise<ProviderExecutionResult> {
        const apiKey = await getCredential(this.plugin, 'openai');
        const aiSettings = validateAiSettings(this.plugin.settings.aiSettings ?? buildDefaultAiSettings()).value;
        const promptCacheRetention = req.bypassProviderReuse
            ? undefined
            : aiSettings.cacheWindows?.openaiRetention;
        const promptCacheKeySupplied = !req.bypassProviderReuse
            && typeof req.promptCacheKey === 'string'
            && req.promptCacheKey.length > 0;
        const result = await callOpenAiResponsesApi(
            apiKey,
            req.modelId,
            req.systemPrompt ?? null,
            req.userPrompt,
            req.maxOutputTokens,
            undefined,
            req.temperature,
            req.topP,
            promptCacheRetention,
            req.promptCacheKey
        );
        const cacheResult = this.deriveCacheResult(result.responseData, promptCacheKeySupplied, result.success);
        return result.success
            ? {
                success: true,
                content: result.content,
                responseData: result.responseData,
                requestPayload: result.requestPayload,
                diagnostics: result.adapterNotes?.length ? { adapterNotes: result.adapterNotes } : undefined,
                aiStatus: 'success',
                aiProvider: 'openai',
                aiModelRequested: req.modelId,
                aiModelResolved: req.modelId,
                citations: result.citations,
                aiTransportLane: 'responses',
                ...cacheResult
            }
            : {
                success: false,
                content: result.content,
                responseData: result.responseData,
                requestPayload: result.requestPayload,
                diagnostics: result.adapterNotes?.length ? { adapterNotes: result.adapterNotes } : undefined,
                aiStatus: classifyProviderError(result).aiStatus,
                aiReason: classifyProviderError(result).aiReason,
                aiProvider: 'openai',
                aiModelRequested: req.modelId,
                aiModelResolved: req.modelId,
                error: result.error,
                citations: result.citations,
                aiTransportLane: 'responses',
                ...cacheResult
            };
    }

    async generateJson(req: GenerateJsonRequest): Promise<ProviderExecutionResult> {
        const apiKey = await getCredential(this.plugin, 'openai');
        const aiSettings = validateAiSettings(this.plugin.settings.aiSettings ?? buildDefaultAiSettings()).value;
        const promptCacheRetention = req.bypassProviderReuse
            ? undefined
            : aiSettings.cacheWindows?.openaiRetention;
        const promptCacheKeySupplied = !req.bypassProviderReuse
            && typeof req.promptCacheKey === 'string'
            && req.promptCacheKey.length > 0;
        const result = await callOpenAiResponsesApi(
            apiKey,
            req.modelId,
            req.systemPrompt ?? null,
            req.userPrompt,
            req.maxOutputTokens,
            {
                type: 'json_schema',
                json_schema: {
                    name: 'ai_result',
                    schema: req.jsonSchema
                }
            },
            req.temperature,
            req.topP,
            promptCacheRetention,
            req.promptCacheKey
        );
        const cacheResult = this.deriveCacheResult(result.responseData, promptCacheKeySupplied, result.success);
        return result.success
            ? {
                success: true,
                content: result.content,
                responseData: result.responseData,
                requestPayload: result.requestPayload,
                diagnostics: result.adapterNotes?.length ? { adapterNotes: result.adapterNotes } : undefined,
                aiStatus: 'success',
                aiProvider: 'openai',
                aiModelRequested: req.modelId,
                aiModelResolved: req.modelId,
                citations: result.citations,
                aiTransportLane: 'responses',
                ...cacheResult
            }
            : {
                success: false,
                content: result.content,
                responseData: result.responseData,
                requestPayload: result.requestPayload,
                diagnostics: result.adapterNotes?.length ? { adapterNotes: result.adapterNotes } : undefined,
                aiStatus: classifyProviderError(result).aiStatus,
                aiReason: classifyProviderError(result).aiReason,
                aiProvider: 'openai',
                aiModelRequested: req.modelId,
                aiModelResolved: req.modelId,
                error: result.error,
                citations: result.citations,
                aiTransportLane: 'responses',
                ...cacheResult
            };
    }
}
