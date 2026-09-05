/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 */

/**
 * InquiryEstimateService — plugin-level owner of InquiryEstimateSnapshot.
 *
 * Caches the latest snapshot by state key.  If the key is unchanged, returns
 * the cached snapshot instantly.  If the key has changed, invalidates and
 * rebuilds.  Concurrent requests for the same key share a single Promise.
 *
 * Both InquiryView and Settings AI access the service via
 * plugin.getInquiryEstimateService().
 */

import {
    type EstimateSnapshotParams,
    type InquiryEstimateSnapshot,
    buildInquiryEstimateSnapshot,
    computeEstimateStateKey
} from './inquiryEstimateSnapshot';

export class InquiryEstimateService {
    private snapshot: InquiryEstimateSnapshot | null = null;
    private pending: Promise<InquiryEstimateSnapshot | null> | null = null;
    private currentStateKey: string | null = null;

    // ── Accessors ───────────────────────────────────────────────────

    /** Return the cached snapshot, or null if not yet computed / invalidated. */
    getSnapshot(): InquiryEstimateSnapshot | null {
        return this.snapshot;
    }

    /** True when a snapshot build is in-flight. */
    isPending(): boolean {
        return this.pending !== null;
    }

    // ── Request ─────────────────────────────────────────────────────

    /**
     * Request a snapshot for the given params.
     *
     * - Cache hit (same stateKey) → instant return.
     * - Already computing this key → returns the in-flight Promise.
     * - New key → invalidates current, starts fresh build.
     *
     * Returns null if the request becomes stale (a newer request supersedes it)
     * or if the build fails.
     */
    async requestSnapshot(params: EstimateSnapshotParams): Promise<InquiryEstimateSnapshot | null> {
        const stateKey = computeEstimateStateKey({
            scope: params.scope,
            activeBookId: params.activeBookId,
            corpusFingerprint: params.manifest.fingerprint,
            provider: params.engine.provider,
            modelId: params.engine.modelId,
            overrideClassCount: params.overrideSummary.classCount,
            overrideItemCount: params.overrideSummary.itemCount,
            citationsEnabled: params.citationsEnabled
        });

        // Cache hit — same key, snapshot already available.
        if (this.snapshot && this.currentStateKey === stateKey) {
            return this.snapshot;
        }

        // Already computing this exact key — share the in-flight Promise.
        if (this.currentStateKey === stateKey && this.pending) {
            return this.pending;
        }

        // New key — invalidate and rebuild.
        this.snapshot = null;
        this.currentStateKey = stateKey;

        this.pending = this.buildSnapshot(params, stateKey);
        return this.pending;
    }

    // ── Invalidation ────────────────────────────────────────────────

    /** Drop the cached snapshot and cancel any in-flight build. */
    invalidate(): void {
        this.snapshot = null;
        this.currentStateKey = null;
        this.pending = null;
    }

    // ── Internal ────────────────────────────────────────────────────

    private async buildSnapshot(
        params: EstimateSnapshotParams,
        stateKey: string
    ): Promise<InquiryEstimateSnapshot | null> {
        try {
            const result = await buildInquiryEstimateSnapshot(params);

            // Guard: if a newer request has superseded this one, discard.
            if (this.currentStateKey !== stateKey) {
                return null;
            }

            this.snapshot = result;
            this.pending = null;
            return result;
        } catch (error) {
            // Build failed — clear pending but preserve stateKey so a retry
            // with the same key will attempt a fresh build.
            console.warn('[Inquiry] Estimate snapshot build failed:', error instanceof Error ? error.message : error);
            if (this.currentStateKey === stateKey) {
                this.pending = null;
            }
            return null;
        }
    }
}
