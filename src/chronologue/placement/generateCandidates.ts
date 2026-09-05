/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 *
 * Chronologue Placement — Deterministic Candidates
 *
 * Free, offline, instant. Every candidate goes through the validator before it
 * reaches the modal, so a generator producing nothing (a forty-minute interval
 * has no room for "the next morning") is the normal case, not an error.
 */

import { validatePlacement } from './validatePlacement';
import type { PlacementCandidate, PlacementInterval } from './types';

/**
 * Build the candidate list for a drop interval.
 *
 * @param interval - The open interval the drop must land strictly inside.
 * @param currentWhen - The dragged scene's existing When, or null when it has none.
 * @param draggedDurationMs - The dragged scene's parsed `Duration`, or null.
 */
export function generateCandidates(
    interval: PlacementInterval,
    currentWhen: Date | null,
    draggedDurationMs: number | null
): PlacementCandidate[] {
    const proposals = [
        ...keepTimeAdvanceDay(interval, currentWhen),
        midpoint(interval)
    ];

    const candidates: PlacementCandidate[] = [];
    const seenStored = new Set<string>();

    for (const proposal of proposals) {
        const verdict = validatePlacement(proposal.when, interval, draggedDurationMs);
        if (verdict.kind !== 'ok') continue;
        if (seenStored.has(verdict.storedWhen)) continue;
        seenStored.add(verdict.storedWhen);
        candidates.push({
            id: proposal.id,
            label: proposal.label,
            when: verdict.when,
            storedWhen: verdict.storedWhen,
            overlapWarning: verdict.overlapWarning
        });
    }

    return candidates;
}

interface CandidateProposal {
    id: string;
    label: string;
    when: Date;
}

/**
 * Keep the scene's own time of day and move it to the first day that falls
 * inside the interval — the "it still happens at dawn, just a day later" edit.
 */
function keepTimeAdvanceDay(interval: PlacementInterval, currentWhen: Date | null): CandidateProposal[] {
    if (!currentWhen) return [];

    const hours = currentWhen.getHours();
    const minutes = currentWhen.getMinutes();
    const lower = new Date(interval.lowerMs);

    // At most two tries: that time on the lower bound's day, else the next day.
    for (let dayOffset = 0; dayOffset <= 1; dayOffset += 1) {
        const attempt = new Date(
            lower.getFullYear(),
            lower.getMonth(),
            lower.getDate() + dayOffset,
            hours,
            minutes,
            0,
            0
        );
        const attemptMs = attempt.getTime();
        if (attemptMs > interval.lowerMs && attemptMs < interval.upperMs) {
            return [{
                id: 'keep-time',
                label: describeKeepTime(lower, attempt),
                when: attempt
            }];
        }
    }

    return [];
}

function describeKeepTime(lowerBound: Date, attempt: Date): string {
    const sameDay = lowerBound.getFullYear() === attempt.getFullYear()
        && lowerBound.getMonth() === attempt.getMonth()
        && lowerBound.getDate() === attempt.getDate();
    return sameDay ? 'Same time, same day' : 'Same time, next day';
}

/** The centre of the interval — always available when there is any room at all. */
function midpoint(interval: PlacementInterval): CandidateProposal {
    return {
        id: 'midpoint',
        label: 'Midway between the two scenes',
        when: new Date(Math.floor((interval.lowerMs + interval.upperMs) / 2))
    };
}
