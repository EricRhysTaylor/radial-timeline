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

/** Keep the observed duration and canonical total; cached tokens are already included. */
export function getInquiryTimingSample(
    usage: Pick<TokenUsage, 'inputTokens'> | null | undefined,
    durationMs: number | null | undefined
): { durationMs: number; inputTokens: number } | null {
    const inputTokens = usage?.inputTokens;
    if (typeof durationMs !== 'number' || !Number.isFinite(durationMs) || durationMs <= 0
        || typeof inputTokens !== 'number' || !Number.isFinite(inputTokens) || inputTokens <= 0) return null;
    return { durationMs, inputTokens };
}

/** Also reads existing bucketed observations without discarding their latest duration. */
export function getLatestTimingEntry(
    history: Record<string, InquiryTimingHistoryEntry> | undefined
): InquiryTimingHistoryEntry | null {
    let latest: InquiryTimingHistoryEntry | null = null;
    for (const entry of Object.values(history ?? {})) {
        if (!entry || typeof entry !== 'object'
            || (entry.schemaVersion !== undefined && entry.schemaVersion !== 1)
            || !Number.isFinite(entry.lastDurationMs) || entry.lastDurationMs <= 0
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
    if (!Number.isFinite(centralMs * RANGE_MAX_MULTIPLIER)) return null;
    return {
        minSeconds: Math.max(PREDICT_FLOOR_MS / 1000, centralMs * RANGE_MIN_MULTIPLIER / 1000),
        maxSeconds: Math.max(PREDICT_FLOOR_MS / 1000, centralMs * RANGE_MAX_MULTIPLIER / 1000)
    };
}
