/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 */

/**
 * Pure helpers for the Inquiry duration estimator.
 *
 * Three rules baked in to keep timing history grounded in observed runs:
 *
 *   1. Timing samples use provider-reported input tokens only. Cache-read
 *      tokens still count because observed Gemini runs spend roughly the same
 *      wall-clock time thinking over cached corpus context.
 *
 *   2. History is keyed by (provider, model, evidenceMode). A summary-mode
 *      run with a 6k payload no longer overwrites the rate for a 300k
 *      full-scene run on the same model.
 *
 *   3. Predictions blend the EWMA average and the latest sample 50/50.
 *      No flag exists to "prefer the latest sample wholesale" — one
 *      anomaly should not hijack future predictions.
 */

import type { TokenUsage } from '../../ai/usage/providerUsage';

// ── Tunables ───────────────────────────────────────────────────────────

/** EWMA blend weight on every new sample (0.25 = old, 0.75 = new). */
export const EWMA_NEW_WEIGHT = 0.75;

/** Floor on predicted run time — anything faster is unrealistic for a real API roundtrip. */
export const PREDICT_FLOOR_MS = 4000;

/** Floor and ceiling multipliers around the central prediction for the min/max range. */
export const RANGE_MIN_MULTIPLIER = 0.8;
export const RANGE_MAX_MULTIPLIER = 1.2;

// ── Evidence mode normalization ────────────────────────────────────────

export type EvidenceModeKey = 'full' | 'summary' | 'mixed' | 'corpus' | 'unknown';

/**
 * Normalize a free-form evidence mode label (e.g. "Full Scene evidence",
 * "Summary evidence") into a stable short key for use in the history map.
 */
export function normalizeEvidenceModeKey(label: string | undefined | null): EvidenceModeKey {
    const lower = (label ?? '').trim().toLowerCase();
    if (lower.includes('summary')) return 'summary';
    if (lower.includes('full')) return 'full';
    if (lower.includes('mixed')) return 'mixed';
    if (lower.includes('corpus')) return 'corpus';
    return 'unknown';
}

// ── History key ────────────────────────────────────────────────────────

/**
 * Build the deterministic history key for a (provider, model, evidenceMode)
 * triple. Returns null if any required piece is missing — the caller should
 * skip both reads and writes in that case.
 */
export function computeTimingHistoryKey(
    provider: string | undefined | null,
    model: string | undefined | null,
    evidenceMode: EvidenceModeKey
): string | null {
    const providerKey = (provider ?? '').trim().toLowerCase();
    const modelKey = (model ?? '').trim().toLowerCase();
    if (!providerKey || !modelKey) return null;
    return `${providerKey}::${modelKey}::${evidenceMode}`;
}

// ── Sample recording ──────────────────────────────────────────────────

export interface ComputeSampleRateInput {
    /** Provider's actual usage report from the response. May be null/undefined. */
    usage: Pick<TokenUsage, 'inputTokens' | 'cacheReadInputTokens' | 'cacheCreationInputTokens'> | undefined | null;
    /** Round-trip duration of the actual API call in ms. */
    durationMs: number | undefined | null;
}

export interface SampleRateResult {
    /** ms per provider-reported input token, including cache reads. */
    msPerInputToken: number;
    /** Input tokens used in the rate denominator — for diagnostics. */
    inputTokens: number;
    /** Source of the token count. */
    source: 'provider_usage';
}

/**
 * Compute a per-token rate for a completed run, or return null when real
 * provider usage is unavailable.
 *
 * Skip conditions:
 *   - Duration missing or non-positive.
 *   - Provider usage missing.
 *   - Provider usage yields no positive input token count.
 *
 * Denominator convention: `usage.inputTokens` is the provider-reported total
 * prompt size, already including any cache-read / cache-creation tokens. This
 * matches the contract enforced by `extractTokenUsage` for every supported
 * provider (Anthropic: pre-summed from raw+cacheRead+cacheCreation;
 * OpenAI: `prompt_tokens`; Gemini: `promptTokenCount`). Cached tokens still
 * count because observed Inquiry wall time is dominated by the model's
 * reasoning over the supplied corpus.
 *
 * If `inputTokens` is missing or zero but cache fields are present, fall back
 * to summing the cache components — mirrors `computeCachePillState` in
 * inquiryEngineRenderer.ts so this helper is robust against incomplete usage
 * shapes (legacy tests, partial provider responses).
 */
export function computeSampleRate(input: ComputeSampleRateInput): SampleRateResult | null {
    const durationMs = input.durationMs;
    if (typeof durationMs !== 'number' || !Number.isFinite(durationMs) || durationMs <= 0) {
        return null;
    }

    const usage = input.usage;
    if (usage) {
        const reportedInput = Number.isFinite(usage.inputTokens) ? Math.max(0, usage.inputTokens ?? 0) : 0;
        const cacheRead = Number.isFinite(usage.cacheReadInputTokens) ? Math.max(0, usage.cacheReadInputTokens ?? 0) : 0;
        const cacheCreation = Number.isFinite(usage.cacheCreationInputTokens) ? Math.max(0, usage.cacheCreationInputTokens ?? 0) : 0;
        const cacheSum = cacheRead + cacheCreation;
        const providerInputTokens = reportedInput >= cacheSum
            ? reportedInput
            : reportedInput + cacheSum;
        if (providerInputTokens > 0) {
            return {
                msPerInputToken: durationMs / providerInputTokens,
                inputTokens: providerInputTokens,
                source: 'provider_usage'
            };
        }
    }

    return null;
}

// ── Sample blending (EWMA) ────────────────────────────────────────────

export interface BlendSampleInput {
    previousAvg?: number;
    previousSampleCount?: number;
    newRate: number;
    /** Cap on stored sample count (older blend influence saturates). */
    sampleCountCap?: number;
}

export interface BlendSampleResult {
    avgMsPerInputToken: number;
    samples: number;
}

export function blendSampleRate(input: BlendSampleInput): BlendSampleResult {
    const { previousAvg, previousSampleCount, newRate } = input;
    const cap = input.sampleCountCap ?? 19;
    const previousValid = typeof previousAvg === 'number' && Number.isFinite(previousAvg) && previousAvg > 0;
    const blended = previousValid
        ? (previousAvg * (1 - EWMA_NEW_WEIGHT)) + (newRate * EWMA_NEW_WEIGHT)
        : newRate;
    const previousSamples = Math.min(Math.max(0, previousSampleCount ?? 0), cap);
    return {
        avgMsPerInputToken: blended,
        samples: previousSamples + 1
    };
}

// ── Prediction ────────────────────────────────────────────────────────

export interface PredictionEntry {
    samples: number;
    avgMsPerInputToken: number;
    lastDurationMs: number;
    lastInputTokens: number;
}

export interface PredictionRange {
    minSeconds: number;
    maxSeconds: number;
}

/**
 * Predict a duration range for a run of `estimatedTokens` fresh input
 * tokens, based on stored history.
 *
 * Returns null when the entry is empty or has an invalid rate. The caller
 * should fall back to a cold-start estimate.
 *
 * Strategy: blend the EWMA average rate and the latest-sample rate 50/50.
 * Neither source dominates. This keeps a single anomaly from hijacking
 * predictions while still giving recent runs meaningful weight.
 *
 * The min/max range is RANGE_MIN_MULTIPLIER..RANGE_MAX_MULTIPLIER × the
 * central prediction, floored at PREDICT_FLOOR_MS for both ends.
 */
export function predictTimingFromEntry(
    entry: PredictionEntry | null | undefined,
    estimatedTokens: number
): PredictionRange | null {
    if (!entry) return null;
    if (!Number.isFinite(entry.avgMsPerInputToken) || entry.avgMsPerInputToken <= 0) return null;
    const tokens = Math.max(0, estimatedTokens);
    if (tokens <= 0) return null;

    const avgPredictedMs = Math.max(PREDICT_FLOOR_MS, tokens * entry.avgMsPerInputToken);
    const lastDuration = entry.lastDurationMs;
    const lastTokens = entry.lastInputTokens;
    const lastIsValid = Number.isFinite(lastDuration) && lastDuration > 0
        && Number.isFinite(lastTokens) && lastTokens > 0;

    const centralMs = lastIsValid
        ? Math.max(PREDICT_FLOOR_MS, ((avgPredictedMs * 0.5) + ((tokens * (lastDuration / lastTokens)) * 0.5)))
        : avgPredictedMs;

    return {
        minSeconds: Math.max(PREDICT_FLOOR_MS / 1000, (centralMs * RANGE_MIN_MULTIPLIER) / 1000),
        maxSeconds: Math.max(PREDICT_FLOOR_MS / 1000, (centralMs * RANGE_MAX_MULTIPLIER) / 1000)
    };
}
