import type RadialTimelinePlugin from '../../main';
import { getCredential } from '../credentials/credentials';
import type {
    AIProviderId,
    EvidenceDocument,
    InputTokenEstimateMethod,
    TokenCountResult
} from '../types';
import { countAnthropicTokens } from '../../api/anthropicApi';
import { countGeminiTokens } from '../../api/geminiApi';
import { estimateTokensFromChars, DEFAULT_CHARS_PER_TOKEN } from '../estimates';

export { DEFAULT_CHARS_PER_TOKEN };

export type TokenEstimateMethod = InputTokenEstimateMethod;

export interface InputTokenEstimate {
    inputTokens: number;
    method: TokenEstimateMethod;
    uncertaintyTokens: number;
    error?: string;
}

export interface EstimateInputTokensRequest {
    plugin?: RadialTimelinePlugin;
    provider?: AIProviderId;
    modelId?: string;
    systemPrompt?: string | null;
    userPrompt: string;
    evidenceDocuments?: EvidenceDocument[];
    citationsEnabled?: boolean;
    jsonSchema?: Record<string, unknown>;
    safeInputBudget?: number;
    charsPerToken?: number;
}

const HEURISTIC_UNCERTAINTY_RATIO = 0.04;
const HEURISTIC_UNCERTAINTY_MIN = 3000;
// Provider-counted estimates are exact for the prompt envelope, but we keep
// a small uncertainty band to account for any per-request envelope additions
// (cache markers, structured-output tools) the count call doesn't include.
const PROVIDER_COUNT_UNCERTAINTY_RATIO = 0.005;
const PROVIDER_COUNT_UNCERTAINTY_MIN = 256;

function normalizeProvider(provider: EstimateInputTokensRequest['provider']): AIProviderId | 'none' {
    if (provider === 'anthropic' || provider === 'openai' || provider === 'google' || provider === 'ollama') {
        return provider;
    }
    return 'none';
}

export function describeTokenEstimateMethod(method: TokenEstimateMethod): string {
    if (method === 'anthropic_count') return 'Anthropic provider count';
    if (method === 'google_count') return 'Gemini provider count';
    if (method === 'unavailable') return 'Provider count unavailable';
    return 'Heuristic estimate';
}

// Canonical implementation lives in ai/estimates/tokenEstimate.ts — a pure
// module with no plugin/API dependencies, so it can be shared downward without
// dragging this file's provider clients along. Re-exported, never re-written.
export { estimateTokensFromChars };

export function estimateTokensFromText(text: string, charsPerToken = DEFAULT_CHARS_PER_TOKEN): number {
    return estimateTokensFromChars(text.length, charsPerToken);
}

export function estimateUncertaintyTokens(method: TokenEstimateMethod, safeInputBudget?: number): number {
    const budget = Number.isFinite(safeInputBudget) ? Math.max(0, Math.floor(safeInputBudget as number)) : 0;
    if (method === 'anthropic_count' || method === 'google_count') {
        return Math.max(PROVIDER_COUNT_UNCERTAINTY_MIN, Math.floor(budget * PROVIDER_COUNT_UNCERTAINTY_RATIO));
    }
    return Math.max(HEURISTIC_UNCERTAINTY_MIN, Math.floor(budget * HEURISTIC_UNCERTAINTY_RATIO));
}

function toCountedEstimate(
    result: TokenCountResult,
    safeInputBudget?: number
): InputTokenEstimate {
    let method: TokenEstimateMethod;
    if (result.source === 'provider_count') {
        method = result.provider === 'google' ? 'google_count' : 'anthropic_count';
    } else {
        method = 'heuristic_chars';
    }
    return {
        inputTokens: Math.max(0, Math.floor(result.inputTokens)),
        method,
        uncertaintyTokens: estimateUncertaintyTokens(method, safeInputBudget)
    };
}

/**
 * Provider-counted token estimation.
 *
 * Dispatches to the provider's authoritative tokenizer when available:
 *   - anthropic: HTTP /v1/messages/count_tokens (knows document blocks + citations)
 *   - google:    HTTP models/{id}:countTokens   (free, no quota cost)
 *   - openai:    Returns chars/4 (the canonical RT corpus count per
 *                doctrine §1). OpenAI does not expose a free pre-flight
 *                count endpoint and we do not ship a local tokenizer.
 *                The chars/4 number is NOT a fallback for a failed
 *                provider count — it is the legitimate corpus metric for
 *                OpenAI runs because no provider-count endpoint exists.
 *   - ollama:    Same as OpenAI — chars/4 corpus count, no provider count.
 *
 * **No silent fallback for Anthropic/Google.** Per the RT doctrine
 * (`code-doctrine.md` §2 and `inquiry-critical-path-rules.md` §8): when
 * the provider count call fails for any reason (no API key, network
 * error, malformed response, model-id rejected), this function THROWS.
 * The caller is responsible for catching the throw and surfacing
 * "unavailable" in the UI — NOT substituting the heuristic and labeling
 * it as if it were authoritative.
 *
 * Earlier versions of this function returned the heuristic with an
 * `error` field attached on the assumption that callers would display
 * "Heuristic estimate — {reason}". They didn't — the headline number
 * was shown without the badge, which was a doctrine violation
 * ("substitute incorrect numbers"). The throw makes the unavailability
 * impossible to ignore.
 */
export async function estimateInputTokens(request: EstimateInputTokensRequest): Promise<InputTokenEstimate> {
    const provider = normalizeProvider(request.provider);

    // OpenAI / Ollama / 'none' have no provider count endpoint. The
    // chars/4 corpus count is the canonical metric for these providers.
    if (provider === 'openai' || provider === 'ollama' || provider === 'none') {
        const combinedPrompt = `${request.systemPrompt || ''}${request.userPrompt || ''}`;
        const evidenceChars = (request.evidenceDocuments || []).reduce((sum, doc) => (
            sum + (doc.title?.length ?? 0) + 4 + (doc.content?.length ?? 0)
        ), 0);
        return {
            inputTokens: estimateTokensFromChars(
                combinedPrompt.length + evidenceChars,
                request.charsPerToken
            ),
            method: 'heuristic_chars',
            uncertaintyTokens: estimateUncertaintyTokens('heuristic_chars', request.safeInputBudget),
        };
    }

    if (!request.plugin || !request.modelId) {
        throw new Error('Plugin or modelId missing; cannot resolve provider credentials for token counting.');
    }

    if (provider === 'anthropic') {
        const apiKey = await getCredential(request.plugin, 'anthropic');
        if (!apiKey) {
            throw new Error('Anthropic API key unavailable for token counting.');
        }
        const counted = await countAnthropicTokens(
            apiKey,
            request.modelId,
            request.systemPrompt ?? null,
            request.userPrompt,
            request.citationsEnabled,
            request.evidenceDocuments,
            undefined,
            request.jsonSchema
        );
        return toCountedEstimate(counted, request.safeInputBudget);
    }

    if (provider === 'google') {
        const apiKey = await getCredential(request.plugin, 'google');
        if (!apiKey) {
            throw new Error('Gemini API key unavailable for token counting.');
        }
        // Gemini has no document-block/citations distinction at the API
        // level — evidence is concatenated into the user prompt by the
        // runner before this point. Just count system + user.
        const counted = await countGeminiTokens(
            apiKey,
            request.modelId,
            request.systemPrompt ?? null,
            request.userPrompt
        );
        return toCountedEstimate(counted, request.safeInputBudget);
    }

    // Exhaustive check — should be unreachable.
    throw new Error(`Unsupported provider for token counting: ${String(provider)}`);
}
