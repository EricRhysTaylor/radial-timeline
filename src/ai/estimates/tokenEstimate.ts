/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 */

/**
 * Canonical token-estimate contract — shared across every AI-facing UI
 * surface (AI Settings, Inquiry HUD, Cost Estimate, Gossamer modal, logs).
 *
 * Doctrine (no silent fallbacks):
 *   - `0` must NEVER mean "unknown". Every consumer must check `source`
 *     before reading `tokens`. A discriminated union forces that check at
 *     the type level.
 *   - A degraded value is allowed ONLY when it is based on deterministic
 *     local math or a real prior run, and the UI MUST disclose the source.
 *   - We do not silently substitute chars/4 as if it were provider truth.
 *   - We do not invent token counts.
 *
 * This module used to live under `src/settings/sections/aiPanelEstimate.ts`
 * as `PanelTokenEstimate`. It was promoted to `src/ai/estimates/` once it
 * had multiple consumers across the codebase — UI fragmentation was the
 * root cause of the original "Estimating…" stall bugs (the panel was
 * fixed; the cost estimate header was not, because each surface
 * interpreted raw `requestTokens` independently).
 */

import type { TokenEstimateMethod } from '../tokens/inputTokenEstimate';

/**
 * Token estimate with explicit source provenance.
 *
 * - `provider_count`: provider's authoritative tokenizer succeeded
 *   (Anthropic count_tokens, Gemini countTokens). Use as-is.
 * - `local_estimate`: deterministic local chars/4 (or sum thereof). Allowed
 *   only when labeled in the UI. Do NOT promote this to a provider-count
 *   substitute.
 * - `prior_run`: exact provider-reported usage from a previous same-corpus
 *   run. The most trustworthy source after a real run completes.
 * - `pending`: snapshot/count call is in flight. The UI may show
 *   "Estimating…" honestly. Distinct from `unavailable`.
 * - `unavailable`: snapshot completed but no trustworthy number exists.
 *   The UI must render "Unavailable" — NOT "Estimating…" (which implies
 *   in-flight work) and NOT `~0k` (which implies actually-zero).
 */
export type TokenEstimate =
    | { source: 'provider_count'; tokens: number }
    | { source: 'local_estimate'; tokens: number }
    | { source: 'prior_run'; tokens: number }
    | { source: 'pending' }
    | { source: 'unavailable' };

/** Human-readable source label for UI provenance disclosure. */
export const TOKEN_ESTIMATE_SOURCE_LABEL: Record<TokenEstimate['source'], string> = {
    provider_count: 'Provider count',
    local_estimate: 'Local estimate',
    prior_run: 'Prior run',
    pending: 'Estimating',
    unavailable: 'Unavailable'
};

/** One-line disclosure shown under headlines when the source is not the authoritative provider count. */
export const TOKEN_ESTIMATE_DISCLOSURE: Record<TokenEstimate['source'], string | null> = {
    provider_count: null,
    local_estimate: 'Provider count unavailable. Showing local estimate.',
    prior_run: 'Estimate derived from a prior same-corpus/model run.',
    pending: 'Token count in flight.',
    unavailable: 'Token count unavailable. The provider rejected or did not respond to the count request.'
};

// ── Source-precedence ──────────────────────────────────────────────

/**
 * Pick the best available estimate from a precedence list:
 *   `prior_run` > `provider_count` > `local_estimate` > `pending` > `unavailable`.
 *
 * Rationale: a real provider-reported usage from a past run beats a
 * pre-flight count (no ambiguity about what the model actually saw).
 * `pending` outranks `unavailable` so an in-flight snapshot isn't reported
 * as failure.
 *
 * A `local_estimate` with `tokens <= 0` is treated as no-signal and
 * skipped (chars/4 of nothing carries no information). Authoritative
 * sources (`provider_count`, `prior_run`) keep zero values because a real
 * zero is a meaningful observation.
 */
/**
 * Char → estimated token count using the canonical 4-char-per-token heuristic.
 *
 * This is THE chars→tokens conversion for the plugin. It lives here, beside
 * the estimate doctrine it serves, so that every surface quoting a token
 * number derives it the same way. A second copy anywhere is a bug: two
 * surfaces disagreeing about the size of the same text is exactly the kind of
 * conflict the `TokenEstimate` provenance model exists to prevent.
 *
 * Note the source label: anything derived from this is `local_estimate`,
 * never `provider_count`.
 */
export const estimateTokensFromChars = (chars: number): number =>
    chars > 0 ? Math.ceil(chars / 4) : 0;

export function pickBestTokenEstimate(...candidates: Array<TokenEstimate | null | undefined>): TokenEstimate {
    const order: TokenEstimate['source'][] = ['prior_run', 'provider_count', 'local_estimate', 'pending'];
    for (const source of order) {
        for (const candidate of candidates) {
            if (!candidate || candidate.source !== source) continue;
            if (candidate.source === 'local_estimate' && candidate.tokens <= 0) continue;
            return candidate;
        }
    }
    return { source: 'unavailable' };
}

/**
 * Convert the runner/forecast `TokenEstimateMethod` plus a raw token
 * number into a typed `TokenEstimate`. The single canonical converter so
 * every surface gets the same mapping.
 *
 * - `anthropic_count` / `google_count` → `provider_count` when tokens > 0;
 *   `unavailable` otherwise (a positive method with zero tokens is still
 *   a failure — the count call did not produce a usable value).
 * - `heuristic_chars` → `local_estimate` when tokens > 0; `unavailable`
 *   when 0.
 * - `unavailable` (sentinel from `aiClient.prepareRunEstimate`'s catch
 *   block) → `unavailable` regardless of token value.
 * - `undefined` method → `pending` when no token value at all, or
 *   `local_estimate` when a positive number is supplied (legacy paths).
 */
export function tokenEstimateFromMethod(
    method: TokenEstimateMethod | undefined,
    tokens: number | undefined
): TokenEstimate {
    if (typeof tokens !== 'number' || !Number.isFinite(tokens) || tokens < 0) {
        return method === 'unavailable' ? { source: 'unavailable' } : { source: 'pending' };
    }
    if (method === 'anthropic_count' || method === 'google_count') {
        return tokens > 0 ? { source: 'provider_count', tokens } : { source: 'unavailable' };
    }
    if (method === 'heuristic_chars') {
        return tokens > 0 ? { source: 'local_estimate', tokens } : { source: 'unavailable' };
    }
    if (method === 'unavailable') {
        return { source: 'unavailable' };
    }
    // Undefined method: caller has a number from somewhere without a
    // method label. Treat positive values as local_estimate (the safe
    // assumption) and zero/missing as pending.
    return tokens > 0 ? { source: 'local_estimate', tokens } : { source: 'pending' };
}

// ── Formatting helpers ────────────────────────────────────────────

/**
 * Token shorthand: `'—'` for unavailable/pending, else `~Nk` (one-decimal,
 * trailing `.0` stripped). Mirrors the legacy `formatCorpusBreakdownToken`
 * formatter for visual continuity.
 */
export function formatTokenShorthand(estimate: TokenEstimate): string {
    if (estimate.source === 'unavailable' || estimate.source === 'pending') return '—';
    const tokens = estimate.tokens;
    if (!Number.isFinite(tokens) || tokens <= 0) return '—';
    return `~${(Math.round(tokens / 100) / 10).toFixed(1).replace(/\.0$/, '')}k`;
}

/**
 * Headline number + unit pair. Returns `unitText: null` for
 * unavailable/pending so the caller can omit the unit pill (which would
 * otherwise read as "~0 tokens" — the very bug this contract prevents).
 */
export function formatTokenHeadline(estimate: TokenEstimate): { numericText: string; unitText: string | null } {
    if (estimate.source === 'unavailable') return { numericText: 'Unavailable', unitText: null };
    if (estimate.source === 'pending') return { numericText: 'Estimating…', unitText: null };
    return { numericText: formatTokenShorthand(estimate), unitText: 'tokens' };
}
