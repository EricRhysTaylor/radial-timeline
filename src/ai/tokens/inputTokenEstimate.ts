import type {
    EvidenceDocument,
    InputTokenEstimateMethod
} from '../types';
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
    systemPrompt?: string | null;
    userPrompt: string;
    evidenceDocuments?: EvidenceDocument[];
    jsonSchema?: Record<string, unknown>;
    safeInputBudget?: number;
    charsPerToken?: number;
}

const HEURISTIC_UNCERTAINTY_RATIO = 0.04;
const HEURISTIC_UNCERTAINTY_MIN = 3000;
// Retained only to interpret estimates stored by older plugin versions.
const PROVIDER_COUNT_UNCERTAINTY_RATIO = 0.005;
const PROVIDER_COUNT_UNCERTAINTY_MIN = 256;

export function describeTokenEstimateMethod(method: TokenEstimateMethod): string {
    if (method === 'anthropic_count') return 'Anthropic provider count';
    if (method === 'google_count') return 'Gemini provider count';
    if (method === 'unavailable') return 'Provider count unavailable';
    return 'Local estimate (no provider request)';
}

// Canonical implementation lives in ai/estimates/tokenEstimate.ts — a pure
// module with no plugin/API dependencies, so it can be shared downward without
// dragging this file's provider clients along. Re-exported, never re-written.
export { estimateTokensFromChars };

export function estimateTokensFromText(text: string, charsPerToken = DEFAULT_CHARS_PER_TOKEN): number {
    return estimateTokensFromChars(text.length, charsPerToken);
}

/**
 * Local execution estimate, separate from the UI corpus chars/4 metric.
 * Non-ASCII text reserves its UTF-8 byte count: chars/4 badly undercounts
 * CJK and other scripts. No provider tokenizer or network request is used.
 */
function estimateExecutionTextTokens(text: string, charsPerToken = DEFAULT_CHARS_PER_TOKEN): number {
    const ascii = text.replace(/[^\x00-\x7f]/g, '');
    const unicode = text.replace(/[\x00-\x7f]/g, '');
    return estimateTokensFromChars(ascii.length, charsPerToken) + new TextEncoder().encode(unicode).length;
}

export function estimateHeuristicInputTokens(params: {
    systemPrompt?: string | null;
    userPrompt?: string | null;
    evidenceDocuments?: ReadonlyArray<{ title?: string; content?: string }>;
    jsonSchema?: Record<string, unknown>;
    charsPerToken?: number;
}): number {
    const parts = [params.systemPrompt, params.userPrompt];
    for (const doc of params.evidenceDocuments ?? []) { // SAFE: no documents means only system/user content contributes
        parts.push(doc.title, '    ', doc.content);
    }
    if (params.jsonSchema) parts.push(JSON.stringify(params.jsonSchema));
    return estimateExecutionTextTokens(parts.filter((part): part is string => typeof part === 'string').join(''), params.charsPerToken);
}

export function estimateUncertaintyTokens(method: TokenEstimateMethod, safeInputBudget?: number): number {
    const budget = Number.isFinite(safeInputBudget) ? Math.max(0, Math.floor(safeInputBudget as number)) : 0;
    if (method === 'anthropic_count' || method === 'google_count') {
        return Math.max(PROVIDER_COUNT_UNCERTAINTY_MIN, Math.floor(budget * PROVIDER_COUNT_UNCERTAINTY_RATIO));
    }
    return Math.max(HEURISTIC_UNCERTAINTY_MIN, Math.floor(budget * HEURISTIC_UNCERTAINTY_RATIO));
}

/** All estimates are local. This module must never import credentials or a transport. */
export function estimateInputTokens(request: EstimateInputTokensRequest): InputTokenEstimate {
    return {
        inputTokens: estimateHeuristicInputTokens(request),
        method: 'heuristic_chars',
        uncertaintyTokens: estimateUncertaintyTokens('heuristic_chars', request.safeInputBudget)
    };
}
