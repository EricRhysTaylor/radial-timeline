/*
 * Radial Timeline Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 */

import type { InquiryResult, InquiryState, InquiryZone } from '../state';

/**
 * Slice 1 of the InquirySessionController extraction
 * (see docs/engineering/audits/inquiry-session-controller-map-2026-05-21.md).
 *
 * Owns the **active-result lifecycle** subset of `InquiryState`:
 *
 *   • activeSessionId
 *   • activeResult
 *   • activeQuestionId
 *   • activeZone
 *   • cacheStatus
 *   • corpusFingerprint, corpusOnlyFingerprint, corpusManifestSnapshot
 *   • lastError
 *
 * Explicitly does **not** own:
 *   • scope, mode, selectedPromptIds, activeBookId, targetSceneIds
 *     (→ Slice 2: InquirySelectionState)
 *   • isRunning, AbortController, retry state
 *     (→ Slice 4: InquiryRunController — deferred per audit Risk #2)
 *   • any settings persistence
 *     (→ Slice 3: InquirySettingsAccessor)
 *
 * The controller does not store data itself — it writes through to the
 * shared `InquiryState` object passed in via {@link ActiveSessionStateHost}.
 * Read sites on InquiryView keep reading `this.state.activeResult` etc.
 * unchanged; this slice centralizes *writes*.
 *
 * Doctrine constraints (inquiry-critical-path-rules.md §5–6):
 *   • Owns persisted state only. No computation, estimation, or hover paths.
 *   • The corpus-fingerprint trio
 *     (corpusFingerprint / corpusOnlyFingerprint / corpusManifestSnapshot)
 *     is always written as a unit — never one without the others.
 */

export type InquiryActiveSessionCacheStatus = 'fresh' | 'stale' | 'missing';

/**
 * The subset of `InquiryState` whose writes this controller owns. Kept as
 * a `Pick` so the controller can be constructed with the live view state
 * object and writes propagate naturally to all existing read sites.
 */
export type InquiryActiveSessionFields = Pick<
    InquiryState,
    | 'activeSessionId'
    | 'activeResult'
    | 'activeQuestionId'
    | 'activeZone'
    | 'cacheStatus'
    | 'corpusFingerprint'
    | 'corpusOnlyFingerprint'
    | 'corpusManifestSnapshot'
    | 'lastError'
>;

export interface ActiveSessionStateHost {
    /** Live, shared state object — controller writes through to it. */
    readonly state: InquiryActiveSessionFields;
}

export interface AdoptActiveSessionInput {
    /**
     * Session key. Matches `InquiryState.activeSessionId` which is
     * `string | undefined`; callers (notably `applySession`) accept session
     * shapes with optional keys, so undefined must round-trip cleanly.
     */
    sessionKey: string | undefined;
    result: InquiryResult;
    /** Final activeZone to commit. Caller is responsible for any `?? prior` fallback. */
    activeZone: InquiryZone | null | undefined;
    cacheStatus: InquiryActiveSessionCacheStatus;
}

export class InquiryActiveSessionState {
    constructor(private readonly host: ActiveSessionStateHost) {}

    /**
     * Atomically write the 8-field active-result subset from a session
     * record. Mirrors the inline writes that used to live in
     * `InquiryView.activateSession` lines 7138, 7139, 7152–7157.
     *
     * Does NOT touch isRunning (owned by InquiryView in this slice).
     * Does NOT touch scope, mode, selectedPromptIds, activeBookId, or
     * targetSceneIds (owned by view selection — Slice 2).
     */
    adopt(input: AdoptActiveSessionInput): void {
        const s = this.host.state;
        s.activeQuestionId = input.result.questionId;
        s.activeZone = input.activeZone;
        s.activeSessionId = input.sessionKey;
        s.activeResult = input.result;
        // Corpus-fingerprint trio — written together; doctrine §5.
        s.corpusFingerprint = input.result.corpusFingerprint;
        s.corpusOnlyFingerprint = input.result.corpusOnlyFingerprint;
        s.corpusManifestSnapshot = input.result.corpusManifestSnapshot;
        s.cacheStatus = input.cacheStatus;
    }

    /**
     * Clear the 6-field active-result subset. Mirrors the inline writes
     * that used to live in `InquiryView.clearActiveResultState`
     * lines 7171–7176.
     *
     * Does NOT clear activeQuestionId, activeZone, or lastError — those
     * are owned but cleared via individual setters by callers that need it
     * (e.g. `resetInquiryToFreshBaseState`). This preserves the existing
     * split-clear semantics where clearActiveResult and resetState clear
     * different subsets.
     */
    clearActiveResult(): void {
        const s = this.host.state;
        s.activeResult = null;
        s.activeSessionId = undefined;
        // Corpus-fingerprint trio — cleared together; doctrine §5.
        s.corpusFingerprint = undefined;
        s.corpusOnlyFingerprint = undefined;
        s.corpusManifestSnapshot = undefined;
        s.cacheStatus = undefined;
    }

    setActiveZone(zone: InquiryZone | null | undefined): void {
        this.host.state.activeZone = zone;
    }

    setActiveQuestionId(id: string | undefined): void {
        this.host.state.activeQuestionId = id;
    }

    setCacheStatus(status: InquiryActiveSessionCacheStatus | undefined): void {
        this.host.state.cacheStatus = status;
    }

    setLastError(error: string | undefined): void {
        this.host.state.lastError = error;
    }
}
