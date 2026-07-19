import type RadialTimelinePlugin from '../../main';
import { callAnthropicApi } from '../../api/anthropicApi';
import { classifyProviderError } from '../../api/providerErrors';
import { extractTokenUsage } from '../usage/providerUsage';
import { getCredential } from '../credentials/credentials';
import { ANTHROPIC_REQUESTED_CACHE_TTL, buildDefaultAiSettings } from '../settings/aiSettings';
import { validateAiSettings } from '../settings/validateAiSettings';
import type { AIProvider, AnthropicCacheTtl, Capability, GenerateJsonRequest, GenerateTextRequest, ProviderExecutionResult } from '../types';

const CAPS: Capability[] = ['longContext', 'jsonStrict', 'reasoningStrong'];

export class AnthropicProvider implements AIProvider {
    id = 'anthropic' as const;

    constructor(private plugin: RadialTimelinePlugin) {}

    supports(capability: Capability): boolean {
        return CAPS.includes(capability);
    }

    /**
     * Map the provider `stop_reason` to a normalized outcome. Two non-success
     * stop reasons need explicit handling:
     *
     *   - `refusal` (Fable 5 and newer): HTTP 200 with empty (pre-output) or
     *     partial (mid-stream) content plus a `stop_details` object. The model
     *     declined for safety/policy reasons — this is terminal, NOT a
     *     transport error and NOT retryable. We surface it as a 'refusal'
     *     rejection with a clear message (including `stop_details.category`
     *     when present). We branch on stop_reason only, because category can be
     *     null even on a genuine refusal. No silent model fallback (fail
     *     clearly, per RT doctrine).
     *   - `max_tokens`: the response hit the output cap; the partial text is
     *     unusable (e.g. a JSON object cut off mid-array). We surface this as a
     *     'truncated' rejection so the runner routes to its truncation recovery
     *     (chunk + synthesize) instead of failing downstream as "malformed
     *     JSON". Without this check a too-low output cap silently masquerades
     *     as a model JSON error.
     */
    private resolveResponseOutcome(
        result: { success: boolean; responseData: unknown },
        classification: { aiStatus: ProviderExecutionResult['aiStatus']; aiReason?: string }
    ): { aiStatus: ProviderExecutionResult['aiStatus']; aiReason?: string; errorOverride?: string } {
        const responseData = result.responseData && typeof result.responseData === 'object'
            ? result.responseData as { stop_reason?: unknown; stop_details?: unknown }
            : undefined;
        const stopReason = responseData?.stop_reason;

        if (stopReason === 'refusal') {
            const stopDetails = responseData?.stop_details && typeof responseData.stop_details === 'object'
                ? responseData.stop_details as { category?: unknown }
                : undefined;
            const category = typeof stopDetails?.category === 'string' && stopDetails.category
                ? stopDetails.category
                : undefined;
            const detail = category ? ` (category: ${category})` : '';
            return {
                aiStatus: 'rejected',
                aiReason: 'refusal',
                errorOverride: `Model refused to generate a response${detail}. This is a safety/policy refusal (HTTP 200, stop_reason "refusal"), not a transport or parameter error — retrying the same request will not help.`
            };
        }

        if (result.success && stopReason === 'max_tokens') {
            return { aiStatus: 'rejected', aiReason: 'truncated' };
        }
        return {
            aiStatus: result.success ? 'success' : classification.aiStatus,
            aiReason: result.success ? undefined : classification.aiReason
        };
    }

    private deriveCacheResult(responseData: unknown): Pick<ProviderExecutionResult, 'cacheUsed' | 'cacheStatus'> {
        const usage = extractTokenUsage('anthropic', responseData);
        const cacheRead = usage?.cacheReadInputTokens ?? 0;
        const cacheWrite = usage?.cacheCreationInputTokens ?? 0;
        if (cacheRead > 0) {
            return {
                cacheUsed: true,
                cacheStatus: 'hit'
            };
        }
        if (cacheWrite > 0) {
            return {
                cacheUsed: false,
                cacheStatus: 'created'
            };
        }
        return {};
    }

    async generateText(req: GenerateTextRequest): Promise<ProviderExecutionResult> {
        const apiKey = await getCredential(this.plugin, 'anthropic');
        validateAiSettings(this.plugin.settings.aiSettings ?? buildDefaultAiSettings());
        const cacheTtl: AnthropicCacheTtl | undefined = req.bypassProviderReuse
            ? undefined
            : ANTHROPIC_REQUESTED_CACHE_TTL;
        const result = await callAnthropicApi(
            apiKey,
            req.modelId,
            req.systemPrompt ?? null,
            req.userPrompt,
            req.maxOutputTokens,
            true,
            req.temperature,
            req.topP,
            req.thinkingBudgetTokens,
            req.citationsEnabled,
            req.evidenceDocuments,
            undefined,
            cacheTtl
        );
        const classification = classifyProviderError(result);
        const outcome = this.resolveResponseOutcome(result, classification);
        const cacheResult = this.deriveCacheResult(result.responseData);
        return {
            success: result.success && outcome.aiStatus === 'success',
            content: result.content,
            responseData: result.responseData,
            requestPayload: result.requestPayload,
            aiStatus: outcome.aiStatus,
            aiReason: outcome.aiReason,
            aiProvider: 'anthropic',
            aiModelRequested: req.modelId,
            aiModelResolved: req.modelId,
            error: outcome.errorOverride ?? result.error,
            citations: result.citations,
            ...cacheResult
        };
    }

    async generateJson(req: GenerateJsonRequest): Promise<ProviderExecutionResult> {
        const apiKey = await getCredential(this.plugin, 'anthropic');
        validateAiSettings(this.plugin.settings.aiSettings ?? buildDefaultAiSettings());
        const cacheTtl: AnthropicCacheTtl | undefined = req.bypassProviderReuse
            ? undefined
            : ANTHROPIC_REQUESTED_CACHE_TTL;
        const result = await callAnthropicApi(
            apiKey,
            req.modelId,
            req.systemPrompt ?? null,
            req.userPrompt,
            req.maxOutputTokens,
            true,
            req.temperature,
            req.topP,
            req.thinkingBudgetTokens,
            req.citationsEnabled,
            req.evidenceDocuments,
            req.jsonSchema,
            cacheTtl
        );
        const classification = classifyProviderError(result);
        const outcome = this.resolveResponseOutcome(result, classification);
        const cacheResult = this.deriveCacheResult(result.responseData);
        return {
            success: result.success && outcome.aiStatus === 'success',
            content: result.content,
            responseData: result.responseData,
            requestPayload: result.requestPayload,
            aiStatus: outcome.aiStatus,
            aiReason: outcome.aiReason,
            aiProvider: 'anthropic',
            aiModelRequested: req.modelId,
            aiModelResolved: req.modelId,
            error: outcome.errorOverride ?? result.error,
            citations: result.citations,
            ...cacheResult
        };
    }
}
