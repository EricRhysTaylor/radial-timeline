/*
 * Radial Timeline Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 */

import type { MetadataCache, Vault } from 'obsidian';
import type { BookProfile, InquirySourcesSettings } from '../../types/settings';
import type { InquiryScope } from '../state';
import {
    InquiryCorpusResolver,
    type InquiryCorpusSnapshot,
} from '../services/InquiryCorpusResolver';

/**
 * Corpus Slice 1 of the InquiryView extraction
 * (see docs/engineering/audits/inquiry-corpus-map-2026-05-21.md).
 *
 * Owns the **corpus snapshot lifecycle** only:
 *
 *   • the current `InquiryCorpusSnapshot` (via write-through to a host slot)
 *   • the `InquiryCorpusResolver` instance, reconstructed on every refresh
 *     so a frontmatter-mappings change between refreshes is observed
 *     (audit Risk #1)
 *
 * Explicitly does **not** own:
 *
 *   • the reconcile chain (`selection.setActiveBookId`,
 *     `selection.setTargetSceneIds`, `rememberTargetSceneIdsForBook`,
 *     `scheduleTargetPersist`) — that stays in `InquiryView` as
 *     view orchestration
 *   • `invalidateBriefingPurgeAvailability()` — view-cache concern
 *   • `corpusWarningActive` — UI flag; deferred to a future micro-slice
 *   • `corpusService` (override state) — already a separate, tested module
 *   • `scope`, `isRunning`, AbortController, runner invocation, AI
 *     accounting — architectural boundary per the campaign audits
 *
 * Doctrine constraints (inquiry-critical-path-rules.md §5–6):
 *   • Owns persisted snapshot only. No computation, estimation, or hover
 *     paths. Resolver delegates to the already-extracted, pure
 *     `InquiryCorpusResolver`.
 *   • No subscriber/event pattern — Risk #8 carried forward from the
 *     session campaign.
 *
 * Per audit Risk #6: the resolver is reconstructed on every refresh
 * even if frontmatter mappings have not changed. Performance optimization
 * is out of scope for this slice; existing behavior is preserved exactly.
 */

/**
 * Live host providing the snapshot slot the controller writes to.
 * Mirrors the session-controller pattern — controller writes through to
 * the shared `corpus` field on `InquiryView` so existing read sites
 * (`this.corpus?.books`, `this.corpus?.scenes`, etc.) continue working
 * without rewiring.
 */
export interface CorpusSnapshotHost {
    /**
     * Optional property (matches InquiryView's `corpus?: InquiryCorpusSnapshot`
     * declaration). The controller writes through to this slot during
     * `refresh()`; existing read sites on the host continue to read it
     * as `this.corpus?.X` unchanged.
     */
    corpus?: InquiryCorpusSnapshot;
}

export interface CorpusSnapshotRefreshParams {
    scope: InquiryScope;
    activeBookId: string | undefined;
    sources: InquirySourcesSettings;
    bookProfiles?: BookProfile[];
}

export class InquiryCorpusSnapshotController {
    /**
     * Resolver instance. Reconstructed on every `refresh()` call.
     * Kept as a field (rather than a local) because the legacy code
     * exposes the same field on InquiryView; the controller preserves
     * that lifetime shape for parity. No caller reaches into this field
     * directly — it is reset by `refresh()` and never read externally.
     */
    private resolver: InquiryCorpusResolver | null = null;

    constructor(
        private readonly host: CorpusSnapshotHost,
        private readonly vault: Vault,
        private readonly metadataCache: MetadataCache,
        /**
         * Read frontmatter mappings on every refresh (closure pattern,
         * matches Slice 3's InquirySettingsAccessor). The legacy
         * refreshCorpus reads mappings inline via
         * `getActiveFrontmatterMappings(this.plugin.settings)` immediately
         * before constructing the resolver — this closure preserves that
         * read-each-refresh semantic.
         *
         * Return type matches InquiryCorpusResolver's optional
         * `frontmatterMappings?` ctor parameter — undefined is forwarded
         * to the resolver unchanged.
         */
        private readonly readFrontmatterMappings: () => Record<string, string> | undefined
    ) {}

    /**
     * Resolve a fresh snapshot, store it on the host slot, and return it.
     *
     * Step order matches the legacy `refreshCorpus` body verbatim:
     *   1. Reconstruct resolver with current frontmatter mappings
     *   2. Call resolver.resolve(params)
     *   3. Write the snapshot to the host (this.corpus on the view)
     *
     * The reconcile chain (activeBookId, targetSceneIds, payload stats,
     * scheduleTargetPersist) is **not** done here. The caller reads the
     * returned snapshot (or `getSnapshot()`) and runs the reconcile.
     */
    refresh(params: CorpusSnapshotRefreshParams): InquiryCorpusSnapshot {
        this.resolver = new InquiryCorpusResolver(
            this.vault,
            this.metadataCache,
            this.readFrontmatterMappings()
        );
        const snapshot = this.resolver.resolve(params);
        this.host.corpus = snapshot;
        return snapshot;
    }

    /** Read-side accessor for the current snapshot. */
    getSnapshot(): InquiryCorpusSnapshot | undefined {
        return this.host.corpus;
    }
}
