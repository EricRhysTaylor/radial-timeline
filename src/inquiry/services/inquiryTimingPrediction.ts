/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 */

/**
 * Inquiry run timing: the latest completed question's time per provider pass.
 *
 * Manuscript size is deliberately not a factor. Observed runs on one 85k-token
 * book took 68s, 45s and 85s; each divided by its output tokens gives
 * 9.2-9.5 ms/token whether the cache was written or read. Wall time follows
 * answer length, not input size, so scaling by input misleads in both
 * directions.
 */
import type { InquiryTimingHistoryEntry } from '../../types/settings';

/** A vault's first question: a typical full-book answer (observed 45-85s). */
export const FIRST_RUN_PASS_MS = 60_000;
export const PREDICT_FLOOR_MS = 4000;
export const RANGE_MIN_MULTIPLIER = 0.8;
export const RANGE_MAX_MULTIPLIER = 1.2;
/** Share of the track filled when the predicted time arrives. */
export const PROGRESS_AT_PREDICTION = 0.9;
/** The bar never fills past this until the response arrives. */
export const PROGRESS_CEILING = 0.98;
/** Overrun easing: the gap to the ceiling shrinks by e^-2 per predicted duration. */
const OVERRUN_EASE_RATE = 2;

export type RunDurationSource = 'latest_run' | 'first_run_default';

export interface RunDurationPrediction {
    durationMs: number;
    source: RunDurationSource;
}

export interface PredictionRange {
    minSeconds: number;
    maxSeconds: number;
}

/** One provider pass of a completed question, or null when the duration is unusable. */
export function getInquiryTimingSample(
    durationMs: number | null | undefined,
    passCount: number
): { passDurationMs: number } | null {
    if (typeof durationMs !== 'number' || !Number.isFinite(durationMs) || durationMs <= 0
        || !Number.isInteger(passCount) || passCount < 1) return null;
    return { passDurationMs: durationMs / passCount };
}

/** The saved observation; anything written before schema 2 scaled by input size and is ignored. */
export function getLatestTimingEntry(
    history: { latest?: InquiryTimingHistoryEntry } | undefined
): InquiryTimingHistoryEntry | null {
    const entry: unknown = history?.latest;
    if (!entry || typeof entry !== 'object') return null;
    const candidate = entry as Partial<InquiryTimingHistoryEntry>;
    if (candidate.schemaVersion !== 2
        || typeof candidate.passDurationMs !== 'number'
        || !Number.isFinite(candidate.passDurationMs) || candidate.passDurationMs <= 0) return null;
    return entry as InquiryTimingHistoryEntry;
}

export function predictRunDuration(
    entry: InquiryTimingHistoryEntry | null,
    expectedPassCount: number
): RunDurationPrediction {
    const passes = Math.max(1, Math.floor(expectedPassCount));
    if (!entry) return { durationMs: FIRST_RUN_PASS_MS * passes, source: 'first_run_default' };
    return { durationMs: Math.max(PREDICT_FLOOR_MS, entry.passDurationMs * passes), source: 'latest_run' };
}

/** Rough ETA shown while a run is in flight. */
export function getRunDurationRange(durationMs: number): PredictionRange {
    const centralMs = Math.max(PREDICT_FLOOR_MS, durationMs);
    return {
        minSeconds: centralMs * RANGE_MIN_MULTIPLIER / 1000,
        maxSeconds: centralMs * RANGE_MAX_MULTIPLIER / 1000
    };
}

/**
 * Track fill for a run in flight: linear to PROGRESS_AT_PREDICTION at the
 * predicted time, then easing toward PROGRESS_CEILING. Answer length varies
 * by question, so the bar must never claim "done" before the response does.
 */
export function getRunProgressRatio(elapsedMs: number, predictedMs: number): number {
    if (elapsedMs <= 0) return 0;
    const t = elapsedMs / Math.max(PREDICT_FLOOR_MS, predictedMs);
    if (t <= 1) return PROGRESS_AT_PREDICTION * t;
    return PROGRESS_AT_PREDICTION
        + (PROGRESS_CEILING - PROGRESS_AT_PREDICTION) * (1 - Math.exp(-OVERRUN_EASE_RATE * (t - 1)));
}
