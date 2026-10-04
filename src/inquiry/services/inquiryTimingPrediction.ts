/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 */

/** Shared Inquiry timing: the latest completed run, scaled by input size. */
import type { TokenUsage } from '../../ai/usage/providerUsage';
import type { InquiryTimingHistoryEntry } from '../../types/settings';

export const PREDICT_FLOOR_MS = 4000;
export const RANGE_MIN_MULTIPLIER = 0.8;
export const RANGE_MAX_MULTIPLIER = 1.2;

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

/** Also reads existing bucketed observations without discarding their latest duration. */
export function getLatestTimingEntry(
    history: Record<string, InquiryTimingHistoryEntry> | undefined
): InquiryTimingHistoryEntry | null {
    let latest: InquiryTimingHistoryEntry | null = null;
    for (const entry of Object.values(history ?? {})) {
        if (!Number.isFinite(entry.lastDurationMs) || entry.lastDurationMs <= 0
            || !Number.isFinite(entry.lastInputTokens) || entry.lastInputTokens <= 0
            || !Number.isFinite(Date.parse(entry.updatedAt))) continue;
        if (!latest || Date.parse(entry.updatedAt) > Date.parse(latest.updatedAt)) latest = entry;
    }
    return latest;
}

export interface PredictionRange {
    minSeconds: number;
    maxSeconds: number;
}

export function predictTimingFromEntry(
    entry: InquiryTimingHistoryEntry | null | undefined,
    estimatedTokens: number
): PredictionRange | null {
    if (!entry || !Number.isFinite(entry.lastDurationMs) || entry.lastDurationMs <= 0
        || !Number.isFinite(entry.lastInputTokens) || entry.lastInputTokens <= 0
        || !Number.isFinite(estimatedTokens) || estimatedTokens <= 0) return null;

    const centralMs = Math.max(PREDICT_FLOOR_MS, entry.lastDurationMs * estimatedTokens / entry.lastInputTokens);
    return {
        minSeconds: Math.max(PREDICT_FLOOR_MS / 1000, centralMs * RANGE_MIN_MULTIPLIER / 1000),
        maxSeconds: Math.max(PREDICT_FLOOR_MS / 1000, centralMs * RANGE_MAX_MULTIPLIER / 1000)
    };
}
