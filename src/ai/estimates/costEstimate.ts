/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 */

/**
 * Canonical cost-estimate contract.
 *
 * Cost surfaces previously consumed raw `freshCostUSD` / `cachedCostUSD`
 * fields directly. When the upstream token estimate was 0 (provider count
 * failed), the cost rounded to ~$0.00 and rendered as if authoritative —
 * the exact pattern that produced the misleading "$0.01" Gemini row in
 * the Cost Estimate panel.
 *
 * Every cost-displaying surface must consume `CostEstimate` and disclose
 * the source.
 */

// ── Types ──────────────────────────────────────────────────────────

/**
 * Cost estimate with explicit source provenance.
 *
 * - `pricing_estimate`: deterministic cost from a known token estimate
 *   times the pricing table. Carries an `inputEstimateSource` so the UI
 *   can disclose whether the underlying tokens came from `provider_count`
 *   or `local_estimate`.
 * - `prior_run`: exact cost from a real provider-reported usage on a
 *   previous run. The most trustworthy source.
 * - `pending`: pricing or token snapshot still loading.
 * - `unavailable`: no trustworthy number — pricing missing, token count
 *   failed, or model unsupported.
 */
export type CostEstimate =
    | {
          source: 'pricing_estimate';
          /** Estimated fresh-run cost (no cache reuse). */
          freshCostUSD: number;
          /** Estimated cached-run cost when a known cache reuse ratio applied; absent when not applicable. */
          cachedCostUSD?: number;
          /**
           * Provenance of the token count that fed the pricing math. UIs
           * use this to tell the user whether the input figure was a real
           * provider count or a local heuristic.
           */
          inputEstimateSource: 'provider_count' | 'local_estimate' | 'prior_run';
      }
    | {
          source: 'prior_run';
          /** Exact cost from a previous same-corpus/model run's tokenUsage. */
          actualCostUSD: number;
      }
    | { source: 'pending' }
    | {
          source: 'unavailable';
          /** Optional machine-readable reason — surfaced to the dev console for diagnostics. */
          reason?: 'pricing_missing' | 'token_count_failed' | 'output_sample_needed' | 'unsupported_provider' | 'other';
      };

export const COST_ESTIMATE_DISCLOSURE: Record<CostEstimate['source'], string | null> = {
    pricing_estimate: null,
    prior_run: 'Cost from a prior same-corpus/model run.',
    pending: 'Cost estimate still loading.',
    unavailable: 'Cost estimate unavailable. The provider token count was not produced for this run.'
};

// ── Formatting helpers ────────────────────────────────────────────

/**
 * Short USD formatter that handles `null`/`undefined` honestly. We do NOT
 * round tiny values to "$0.00" — anything that would round to under one
 * cent renders as `<$0.01` so the user sees a real number, not a zero
 * that could be confused with "free" or "failed".
 *
 * Matches the existing `formatUsdCost` convention (always two decimals
 * for displayed cents) for visual continuity across the cost surfaces;
 * only the sub-cent floor and the null-handling differ.
 */
export function formatShortUsd(cost: number | null | undefined): string {
    if (typeof cost !== 'number' || !Number.isFinite(cost) || cost < 0) return '—';
    if (cost === 0) return '$0.00';
    if (cost < 0.01) return '<$0.01';
    return `$${cost.toFixed(2)}`;
}

/** Headline for the fresh/cached cost rows in the cost comparison table. */
export function formatCostHeadline(estimate: CostEstimate, variant: 'fresh' | 'cached'): string {
    if (estimate.source === 'unavailable') return 'Unavailable';
    if (estimate.source === 'pending') return 'Estimating…';
    if (estimate.source === 'prior_run') {
        // Prior-run actual cost has no fresh/cached distinction — there is
        // one real number from the past observation.
        return formatShortUsd(estimate.actualCostUSD);
    }
    // pricing_estimate
    const cost = variant === 'fresh' ? estimate.freshCostUSD : estimate.cachedCostUSD;
    if (typeof cost !== 'number' || !Number.isFinite(cost)) return 'No active cache';
    return formatShortUsd(cost);
}

/** Build a cost-source label for UI provenance disclosure. */
export function describeCostSource(estimate: CostEstimate): string {
    if (estimate.source === 'unavailable') return 'unavailable';
    if (estimate.source === 'pending') return 'pending';
    if (estimate.source === 'prior_run') return 'from prior run';
    return estimate.inputEstimateSource === 'provider_count'
        ? 'pricing estimate'
        : estimate.inputEstimateSource === 'prior_run'
            ? 'estimate from prior run usage'
            : 'pricing estimate (local input count)';
}
