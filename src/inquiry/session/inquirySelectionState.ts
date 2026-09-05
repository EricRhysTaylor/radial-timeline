/*
 * Radial Timeline Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 */

import type { InquiryLens } from '../state';
import type { InquiryTargetCache } from '../../types/settings';
import type { Disposable } from '../../core/disposable';

/**
 * Slices 2a + 2b of the InquirySessionController extraction
 * (see docs/engineering/audits/inquiry-session-controller-map-2026-05-21.md).
 *
 * Owns:
 *   • `mode` field of `InquiryState` and its inquiryLastMode round-trip (2a)
 *   • `targetSceneIds` field of `InquiryState` (2b)
 *   • per-book Map mirror `lastTargetSceneIdsByBookId` (2b)
 *   • debounced persistence to `plugin.settings.inquiryTargetCache` (2b)
 *
 * Explicitly NOT owned (yet):
 *   • activeBookId — Slice 2c. Controller reads it (callers pass it in for
 *     persistence payloads) but never writes it.
 *   • scope — pending architectural decision after the campaign batches.
 *   • run orchestration (Slice 4 — deferred)
 *   • subscriber/event-bus pattern (deferred indefinitely per audit Risk #8)
 *
 * Save-ordering invariants (audit Risk #3 + characterization tests):
 *   1. `setActiveLens` writes state.mode FIRST, then settings.inquiryLastMode,
 *      then triggers saveSettings(). Reordering would let saveSettings see
 *      a pre-mutation snapshot.
 *   2. `schedulePersist` flushes the cache payload BEFORE calling
 *      saveSettings — never the reverse. The atomic `{ lastBookId,
 *      lastTargetSceneIdsByBookId }` payload is written as a unit.
 *
 * Implements {@link Disposable} because it owns a debounce timer; the host
 * is expected to call `cleanup()` during teardown.
 */

/**
 * Pure validator for the `inquiryLastMode` settings field. Returns the
 * lens if it matches the known set, otherwise `undefined`. Exposed so
 * callers can branch on validity (e.g. constructor adopts only if valid,
 * reset falls back to a default).
 */
export function validatePersistedInquiryLens(value: unknown): InquiryLens | undefined {
    return value === 'flow' || value === 'depth' ? value : undefined;
}

/**
 * Live, mutable host providing the state slots the controller writes to.
 * Mirrors the Slice 1 pattern — controller writes through to the shared
 * `state` object so existing read sites (`this.state.mode === 'depth'`,
 * `this.state.targetSceneIds.length`) continue working without rewiring.
 */
export interface SelectionStateHost {
    readonly state: {
        mode: InquiryLens;
        targetSceneIds: string[];
        activeBookId?: string;
    };
}

/**
 * Thin adapter over the plugin settings layer. The controller never
 * imports `RadialTimelinePlugin` directly — the host supplies closures so
 * the boundary stays minimal (refactor-playbook §8: small host interfaces).
 */
export interface SelectionSettingsHost {
    /** Read the raw persisted value. Type `unknown` because the field can drift across versions. */
    getPersistedLastMode(): unknown;
    /** Write the validated lens back to settings. */
    setPersistedLastMode(mode: InquiryLens): void;
    /**
     * Commit the target-cache payload to settings. The whole 2-field
     * object is written as a unit so a partial save cannot leave
     * lastBookId out of sync with lastTargetSceneIdsByBookId.
     */
    setTargetCache(cache: InquiryTargetCache): void;
    /**
     * Trigger a save. May return a Promise; callers void-await so the
     * controller is fire-and-forget consistent with the legacy
     * `void this.plugin.saveSettings()` shape.
     */
    saveSettings(): void | Promise<void>;
}

/** Default debounce window for `schedulePersist`. Matches the legacy view-side timer. */
const TARGET_PERSIST_DEBOUNCE_MS = 300;

export class InquirySelectionState implements Disposable {
    /**
     * Per-book mirror of `targetSceneIds`. Was previously owned by
     * InquiryView as `lastTargetSceneIdsByBookId`. Kept internal so the
     * controller is the only writer to `inquiryTargetCache.lastTargetSceneIdsByBookId`.
     */
    private readonly lastTargetSceneIdsByBookId = new Map<string, string[]>();
    private persistTimer: number | undefined;

    constructor(
        private readonly host: SelectionStateHost,
        private readonly settings: SelectionSettingsHost
    ) {}

    // ── Mode (Slice 2a) ──────────────────────────────────────────────────

    /**
     * User-initiated lens change. Writes state.mode, then
     * settings.inquiryLastMode, then triggers a save. **Order is part of
     * the contract** — the characterization tests pin
     * state→settings→save.
     */
    setActiveLens(mode: InquiryLens): void {
        this.host.state.mode = mode;
        this.settings.setPersistedLastMode(mode);
        void this.settings.saveSettings();
    }

    /**
     * Adopt a mode from a session result. State-only — does NOT persist
     * to `inquiryLastMode`. A user viewing a saved session in a different
     * lens should not have their "last chosen lens" preference clobbered.
     */
    adoptModeFromResult(mode: InquiryLens): void {
        this.host.state.mode = mode;
    }

    /**
     * Adopt the persisted last-mode if valid, otherwise the supplied
     * fallback. Used by:
     *   • constructor — startup hydration
     *   • resetInquiryToFreshBaseState — preserve user preference across reset
     *
     * Validation guard (`'flow' | 'depth'`) is the audit-pinned invariant.
     */
    applyPersistedLastModeOr(fallback: InquiryLens): void {
        const validated = validatePersistedInquiryLens(this.settings.getPersistedLastMode());
        this.host.state.mode = validated ?? fallback;
    }

    // ── Target scene selection (Slice 2b) ────────────────────────────────

    /**
     * Direct write to `state.targetSceneIds`. Used by paths that already
     * computed the final list (session adopt, reset, corpus resync,
     * cache restore). Does NOT update the per-book Map and does NOT
     * schedule persistence — callers that need those side-effects should
     * invoke {@link rememberTargetSceneIdsForBook} and
     * {@link schedulePersist} explicitly so the call site is auditable.
     */
    setTargetSceneIds(ids: string[]): void {
        this.host.state.targetSceneIds = ids;
    }

    /**
     * Single mutation entry point for `state.activeBookId` (Slice 2c —
     * the audit's Risk #1 convergence). All 4 semantic paths
     * (session adopt, cache restore, corpus sync, user pick) route
     * through here so a missed path fails the ownership-boundary check
     * loudly rather than silently desyncing the UI.
     *
     * Accepts `string | undefined` because both setting and clearing
     * the active book are real call paths (corpus has no resolved
     * book, reset to fresh state, etc.).
     */
    setActiveBookId(id: string | undefined): void {
        this.host.state.activeBookId = id;
    }

    /** Read-side convenience for getRememberedTargetSceneIdsForBook and persist payloads. */
    getActiveBookId(): string | undefined {
        return this.host.state.activeBookId;
    }

    /** Record a per-book selection in the Map. Defensive-copies the array. */
    rememberTargetSceneIdsForBook(bookId: string, ids: readonly string[]): void {
        this.lastTargetSceneIdsByBookId.set(bookId, [...ids]);
    }

    /** Read the per-book selection. Returns undefined if no entry. */
    getRememberedTargetSceneIdsForBook(bookId: string | undefined): string[] | undefined {
        if (!bookId) return undefined;
        return this.lastTargetSceneIdsByBookId.get(bookId);
    }

    /**
     * Rebuild the per-book Map from a persisted-cache shape. Normalization
     * is supplied by the caller because the rules live in InquiryView
     * (`normalizeTargetSceneIds`); the controller stays agnostic to scene-id
     * shape.
     */
    hydrateRememberedTargetSceneIdsFromCache(
        entries: Record<string, string[]> | undefined,
        normalize: (ids: unknown) => string[]
    ): void {
        this.lastTargetSceneIdsByBookId.clear();
        if (!entries) return;
        for (const [bookId, sceneIds] of Object.entries(entries)) {
            this.lastTargetSceneIdsByBookId.set(bookId, normalize(sceneIds));
        }
    }

    /**
     * Debounced persistence to `inquiryTargetCache`. Replaces a previously
     * armed timer so rapid mutations coalesce into one save.
     *
     * `activeBookId` is supplied by the caller because Slice 2b does not
     * own that field (Slice 2c will). The order is contractual:
     *   set cache payload → schedule saveSettings.
     */
    schedulePersist(activeBookId: string | undefined, debounceMs = TARGET_PERSIST_DEBOUNCE_MS): void {
        if (this.persistTimer !== undefined) {
            window.clearTimeout(this.persistTimer);
        }
        this.persistTimer = window.setTimeout(() => {
            this.persistTimer = undefined;
            this.settings.setTargetCache({
                lastBookId: activeBookId,
                lastTargetSceneIdsByBookId: Object.fromEntries(this.lastTargetSceneIdsByBookId),
            });
            void this.settings.saveSettings();
        }, debounceMs);
    }

    /**
     * Cancel any pending persist. Used before hydrating from cache so a
     * stale persist cannot fire mid-hydrate and corrupt the just-restored
     * state.
     */
    cancelPendingPersist(): void {
        if (this.persistTimer !== undefined) {
            window.clearTimeout(this.persistTimer);
            this.persistTimer = undefined;
        }
    }

    /**
     * Atomic clear: cancels any pending persist, wipes the Map, writes
     * an empty cache to settings, and triggers a save. Mirrors the
     * legacy `clearPersistedTargetCache` behavior exactly.
     */
    clearPersistedTargetCache(): void {
        this.cancelPendingPersist();
        this.lastTargetSceneIdsByBookId.clear();
        this.settings.setTargetCache({
            lastBookId: undefined,
            lastTargetSceneIdsByBookId: {},
        });
        void this.settings.saveSettings();
    }

    cleanup(): void {
        this.cancelPendingPersist();
    }
}
