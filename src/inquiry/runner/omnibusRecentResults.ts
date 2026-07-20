/**
 * Pure decision logic for the Omnibus plan modal's "already answered"
 * suggestions.
 *
 * A question qualifies as recently answered when a non-error session exists
 * whose full session key matches what THIS omnibus run would produce — the key
 * fingerprint embeds the model id and every corpus file's mtime, so a match
 * means: same question, same prompt form, same scope/targets, same engine, and
 * a byte-identical corpus. Re-running such a question re-bills the corpus to
 * produce an equivalent brief, so the modal suggests skipping it.
 *
 * This module owns only the pure parts (the recency window and the age label);
 * the session-key matching lives in InquiryView, which owns the session store
 * and corpus manifests. Kept separate from omnibusCacheHealth.ts, which owns
 * the in-run cache kill-switch — suggestion is a plan-time concern.
 */

/**
 * How far back a same-key result still earns a default "skip" suggestion.
 * A key match already guarantees the corpus is byte-identical, so the window
 * only bounds how old a brief the modal presumes the author still remembers —
 * beyond it the row shows its age but stays included.
 */
export const OMNIBUS_RECENT_RESULT_SUGGEST_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Plan-modal payload for one already-answered question. */
export interface OmnibusRecentQuestionResult {
    /** Epoch ms when the matching session was persisted. */
    completedAt: number;
}

/** True when a same-key result is fresh enough to default its row to Skip. */
export function shouldSuggestOmnibusSkip(completedAt: number, now: number): boolean {
    if (!Number.isFinite(completedAt) || completedAt <= 0) return false;
    const age = now - completedAt;
    return age >= 0 && age <= OMNIBUS_RECENT_RESULT_SUGGEST_WINDOW_MS;
}

/** Compact age label for the status pill: "just now", "32m ago", "3h ago", "2d ago". */
export function formatOmnibusResultAge(completedAt: number, now: number): string {
    const ageMs = Math.max(0, now - completedAt);
    const minutes = Math.floor(ageMs / 60_000);
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
}
