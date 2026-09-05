/*
 * Radial Timeline Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 */

import type {
    InquiryCorpusThresholds,
    InquiryPromptConfig,
    InquirySourcesSettings,
    InquiryTargetCache,
    InquiryTimingHistoryEntry,
    OmnibusProgressState,
} from '../../types/settings';

/**
 * Slice 3 of the InquirySessionController extraction
 * (see docs/engineering/audits/inquiry-session-controller-map-2026-05-21.md).
 *
 * Read-side facade over the `inquiry*` keys on `plugin.settings`. Pure
 * mechanical wrapping — no defaulting, no normalization, no
 * behavior change. Callers continue to apply their own `?? fallback`
 * logic exactly as before; the accessor only centralizes the read
 * surface so future settings-schema changes have one place to look.
 *
 * NOT in scope (deferred or out of scope):
 *   • Writes — stay inline at their existing call sites. Where a
 *     controller already encapsulates writes (mode, target cache),
 *     those continue to flow through that controller's closures.
 *   • Defaults — the accessor returns the raw field. Callers keep
 *     their `?? false` and normalization wrappers.
 *   • Event/subscriber pattern — explicitly out of scope per the user's
 *     Slice 3 directive and audit Risk #8.
 *
 * The reader is passed as a closure so the accessor never imports
 * `RadialTimelinePlugin` directly — same pattern as the
 * InquirySelectionState settings host (refactor-playbook §8: keep host
 * interfaces small and inversion-friendly).
 */

/** Subset of RadialTimelineSettings the accessor reads. Kept narrow on purpose. */
export interface InquirySettingsShape {
    readonly inquirySources?: InquirySourcesSettings;
    readonly inquiryActionNotesAutoPopulate?: boolean;
    readonly inquiryPromptConfig?: InquiryPromptConfig;
    readonly inquiryTargetCache?: InquiryTargetCache;
    readonly inquiryOmnibusProgress?: OmnibusProgressState;
    readonly inquiryTimingHistory?: Record<string, InquiryTimingHistoryEntry>;
    readonly inquiryCorpusThresholds?: InquiryCorpusThresholds;
}

export class InquirySettingsAccessor {
    /**
     * The closure is invoked on every read so the accessor always sees
     * the current settings object (settings may be reassigned by
     * plugin.loadData() during reloads — capturing a reference at
     * construction would freeze a stale view).
     */
    constructor(private readonly readSettings: () => InquirySettingsShape) {}

    getSources(): InquirySourcesSettings | undefined {
        return this.readSettings().inquirySources;
    }

    getActionNotesAutoPopulate(): boolean | undefined {
        return this.readSettings().inquiryActionNotesAutoPopulate;
    }

    getPromptConfig(): InquiryPromptConfig | undefined {
        return this.readSettings().inquiryPromptConfig;
    }

    getTargetCache(): InquiryTargetCache | undefined {
        return this.readSettings().inquiryTargetCache;
    }

    getOmnibusProgress(): OmnibusProgressState | undefined {
        return this.readSettings().inquiryOmnibusProgress;
    }

    getTimingHistory(): Record<string, InquiryTimingHistoryEntry> | undefined {
        return this.readSettings().inquiryTimingHistory;
    }

    getCorpusThresholds(): InquiryCorpusThresholds | undefined {
        return this.readSettings().inquiryCorpusThresholds;
    }
}
