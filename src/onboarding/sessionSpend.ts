/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 */

/**
 * The spend-forecast slice of an onboarding session, and its round trip.
 *
 * Resume does not re-run preflight, so anything the spend pill needs must
 * survive the session snapshot. It did not: `costProvider` / `costModelId` were
 * instance-only, so every resumed session lost its price — and a missing price
 * reads as "free", the most expensive thing this UI could imply.
 *
 * The fix that matters is not "remember to add the field to both lists". Both
 * lists are derived from `SPEND_SESSION_KEYS`, so a field added to the type
 * without being added to that array fails to compile, and a field in the array
 * is captured and restored by construction. The hand-maintained pairs this
 * replaces are exactly how the original defect got in.
 */

import type { AIProviderId } from '../ai/types';

export interface SpendSessionFields {
    /** Characters of prose the run will send. 0 until ingest measures it. */
    manuscriptChars: number;
    chapterCount: number;
    /** Null until the split reports how many scenes the run will create. */
    forecastSceneCount: number | null;
    /** Cloud pricing identity — null when unresolved. */
    costProvider: AIProviderId | null;
    costModelId: string | null;
    /** Alias the policy asked for when the resolver had to substitute. */
    costSubstitutedFrom: string | null;
}

/**
 * The single list both directions are built from.
 *
 * Typed as `readonly (keyof SpendSessionFields)[]` with an exhaustiveness check
 * below, so omitting a key is a compile error rather than a silent data loss.
 */
export const SPEND_SESSION_KEYS = [
    'manuscriptChars',
    'chapterCount',
    'forecastSceneCount',
    'costProvider',
    'costModelId',
    'costSubstitutedFrom'
] as const satisfies readonly (keyof SpendSessionFields)[];

// Compile-time exhaustiveness: if a field is added to SpendSessionFields and
// not to SPEND_SESSION_KEYS, this assignment fails to typecheck.
type KeysCovered = (typeof SPEND_SESSION_KEYS)[number];
type _ExhaustiveCheck = keyof SpendSessionFields extends KeysCovered
    ? KeysCovered extends keyof SpendSessionFields ? true : never
    : never;
const _exhaustive: _ExhaustiveCheck = true;
void _exhaustive;

/** Snapshot the spend slice out of a live modal. */
export function captureSpendFields(source: SpendSessionFields): SpendSessionFields {
    const out = {} as SpendSessionFields;
    for (const key of SPEND_SESSION_KEYS) {
        (out as unknown as Record<string, unknown>)[key] = source[key];
    }
    return out;
}

/** Restore the spend slice into a live modal. */
export function applySpendFields(target: SpendSessionFields, source: SpendSessionFields): void {
    for (const key of SPEND_SESSION_KEYS) {
        (target as unknown as Record<string, unknown>)[key] = source[key];
    }
}
