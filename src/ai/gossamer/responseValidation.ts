/*
 * Gossamer AI Response Validation
 *
 * Pure validator that proves an AI Gossamer response actually corresponds to
 * the beat list we submitted, before any score is written to a beat note.
 *
 * Why this exists: index-only matching plus silent parse fallbacks (`score
 * ?? 0`, `signal ?? selectedSignal`) made the failure mode "wrong score
 * written to the wrong beat" indistinguishable from a healthy run. A
 * reordered, dropped, or wrong-signal response would happily ship as
 * authoritative data. The validator either returns strongly-typed beats
 * known to align with the submitted list, or returns the full list of
 * failures for the run log — never a partial, silently-corrected payload.
 */

import type { GossamerSignalType } from '../../types/gossamerSignals';

/** Minimal projection of UnifiedBeatInfo the validator needs. */
export interface SubmittedBeat {
    beatName: string;
    placement?: string;
}

/** A validated, strongly-typed beat row safe to write to a beat note. */
export interface ValidatedBeat {
    beatName: string;
    signal: GossamerSignalType;
    score: number;
    justification: string;
}

export type ValidationFailureCode =
    | 'shape'        // response is not an object / beats not an array
    | 'count'        // beat count != submitted count
    | 'beatName'     // returned beatName does not match submitted beatName at this index
    | 'signal'       // returned signal != selectedSignal
    | 'score'        // missing, non-finite, or outside 0..100
    | 'justification'; // missing or empty

export interface ValidationFailure {
    /** Index into beats[] this failure belongs to, or -1 for structural failures. */
    index: number;
    code: ValidationFailureCode;
    detail: string;
}

export type ValidationResult =
    | { ok: true; beats: ValidatedBeat[] }
    | { ok: false; failures: ValidationFailure[] };

/**
 * Normalize a beat label for cross-side matching. The prompt sends labels
 * like `[0.01] Opening Image — Purpose text` and the AI may echo any of:
 * the bare name, the bracketed-prefix form, the prefix + em-dash purpose,
 * or a leading ordinal like `1. Opening Image`. We strip the placement
 * prefix and everything after the em-dash, then lowercase + trim.
 */
export function normalizeBeatLabelForMatch(label: unknown): string {
    if (typeof label !== 'string') return '';
    return label
        .replace(/^\s*\[?\d+(?:\.\d+)?\]?[.\s]+/, '')
        .replace(/\s*—.*$/, '')
        .trim()
        .toLowerCase();
}

/**
 * Validate an AI Gossamer response against the submitted beat list. Returns
 * ok: true only when every row passes every check; otherwise returns the
 * complete list of failures so the run log captures exactly what the model
 * got wrong.
 *
 * No fabricated defaults: a missing score is a validation failure, never a
 * silent 0. A wrong signal is a failure, never a coerced "I'll just write
 * the one you asked for" overwrite.
 */
export function validateGossamerResponse(
    parsed: unknown,
    submittedBeats: readonly SubmittedBeat[],
    selectedSignal: GossamerSignalType
): ValidationResult {
    if (!parsed || typeof parsed !== 'object') {
        return { ok: false, failures: [{ index: -1, code: 'shape', detail: 'response is not an object' }] };
    }
    const shaped = parsed as { beats?: unknown };
    if (!Array.isArray(shaped.beats)) {
        return { ok: false, failures: [{ index: -1, code: 'shape', detail: 'response.beats is not an array' }] };
    }

    const failures: ValidationFailure[] = [];
    if (shaped.beats.length !== submittedBeats.length) {
        failures.push({
            index: -1,
            code: 'count',
            detail: `beat count mismatch: submitted ${submittedBeats.length}, returned ${shaped.beats.length}`
        });
    }

    const validated: ValidatedBeat[] = [];
    const len = Math.min(shaped.beats.length, submittedBeats.length);
    for (let i = 0; i < len; i++) {
        const ai = shaped.beats[i] as Record<string, unknown> | null | undefined;
        const our = submittedBeats[i];
        const rowFailureCount = failures.length;

        const aiName = normalizeBeatLabelForMatch(ai?.beatName);
        const ourName = normalizeBeatLabelForMatch(our.beatName);
        if (!aiName || aiName !== ourName) {
            failures.push({
                index: i,
                code: 'beatName',
                detail: `beatName mismatch at index ${i}: submitted ${JSON.stringify(our.beatName)}, returned ${JSON.stringify(ai?.beatName ?? null)}`
            });
        }

        const signal = ai?.signal;
        if (typeof signal !== 'string' || signal !== selectedSignal) {
            failures.push({
                index: i,
                code: 'signal',
                detail: `signal mismatch at index ${i} (${our.beatName}): expected ${JSON.stringify(selectedSignal)}, returned ${JSON.stringify(signal ?? null)}`
            });
        }

        const score = ai?.score;
        if (typeof score !== 'number' || !Number.isFinite(score) || score < 0 || score > 100) {
            failures.push({
                index: i,
                code: 'score',
                detail: `score out of range at index ${i} (${our.beatName}): ${JSON.stringify(score ?? null)}`
            });
        }

        const justification = ai?.justification;
        if (typeof justification !== 'string' || justification.trim().length === 0) {
            failures.push({
                index: i,
                code: 'justification',
                detail: `justification missing or empty at index ${i} (${our.beatName})`
            });
        }

        if (failures.length === rowFailureCount) {
            validated.push({
                beatName: ai!.beatName as string,
                signal: signal as GossamerSignalType,
                score: score as number,
                justification: justification as string
            });
        }
    }

    if (failures.length > 0) return { ok: false, failures };
    return { ok: true, beats: validated };
}
