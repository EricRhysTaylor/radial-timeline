/*
 * Characterization tests for the Corpus Slice 1 surface
 * (InquiryCorpusSnapshotController).
 *
 * Pre-extraction safety net — pins the CURRENT shape of refreshCorpus,
 * the single this.corpus write site, the dual-call from omnibus, and the
 * resolver re-instantiation. The Slice 1 rewire will flip the assertions
 * to the controller-routed form. Same forcing-function pattern as the
 * session campaign.
 *
 * Reference:
 *   docs/engineering/audits/inquiry-corpus-map-2026-05-21.md
 *   §5 (tests to add BEFORE extraction)
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const INQUIRY_VIEW_SRC = readFileSync(
    resolve(process.cwd(), 'src/inquiry/InquiryView.ts'),
    'utf8'
);

// ─────────────────────────────────────────────────────────────────────────
//  Single this.corpus write site (audit §5 #1)
// ─────────────────────────────────────────────────────────────────────────

describe('characterization: this.corpus write surface (post Slice 1)', () => {
    it('InquiryView contains zero direct this.corpus = ... writes (controller writes through the host)', () => {
        // Post-extraction the write is performed by the controller's
        // `this.host.corpus = snapshot;` line, which lives in
        // InquiryCorpusSnapshotController.ts — NOT in InquiryView. Any
        // future code path that adds a direct `this.corpus = ...` in
        // the view fails this test loudly.
        const writes = INQUIRY_VIEW_SRC.match(/this\.corpus\s*=(?!=)/g) ?? [];
        expect(writes.length).toBe(0);
    });

    it('refreshCorpus delegates to corpusSnapshot.refresh with the canonical params shape', () => {
        const refreshFn = INQUIRY_VIEW_SRC.match(
            /private refreshCorpus\(\)[\s\S]+?\n\s{4}\}/
        )?.[0] ?? '';
        expect(refreshFn).toContain('this.corpusSnapshot.refresh({');
        // The 4 params survived the rewire unchanged. The controller
        // accepts them verbatim — no reshape, no defaulting.
        expect(refreshFn).toContain('scope: this.state.scope,');
        expect(refreshFn).toContain('activeBookId: this.state.activeBookId,');
        expect(refreshFn).toContain('bookProfiles: this.plugin.settings.books,');
        // Sources still flow through normalizeInquirySources + settingsAccessor.
        expect(refreshFn).toContain('this.normalizeInquirySources(this.settingsAccessor.getSources())');
    });

    it('InquiryView no longer declares a corpusResolver field (controller owns the resolver)', () => {
        expect(INQUIRY_VIEW_SRC).not.toMatch(/private corpusResolver/);
        // The legacy inline `new InquiryCorpusResolver(` site is gone too.
        expect(INQUIRY_VIEW_SRC).not.toContain('new InquiryCorpusResolver(');
    });
});

// ─────────────────────────────────────────────────────────────────────────
//  refreshCorpus six-step shape (audit §5 #2 + §2d)
// ─────────────────────────────────────────────────────────────────────────

describe('characterization: refreshCorpus six-step shape (post Slice 1)', () => {
    function extractRefreshCorpus(): string {
        const fn = INQUIRY_VIEW_SRC.match(
            /private refreshCorpus\(\)[\s\S]+?\n\s{4}\}/
        )?.[0];
        if (!fn) throw new Error('refreshCorpus not found in InquiryView.ts');
        return fn;
    }

    it('step 1 → briefingPurgeScanner.invalidate runs before controller.refresh (audit Risk #8)', () => {
        const fn = extractRefreshCorpus();
        const invalidateIdx = fn.indexOf('this.briefingPurgeScanner.invalidate()');
        const refreshIdx = fn.indexOf('this.corpusSnapshot.refresh(');
        expect(invalidateIdx).toBeGreaterThan(-1);
        expect(refreshIdx).toBeGreaterThan(-1);
        expect(invalidateIdx).toBeLessThan(refreshIdx);
    });

    it('step 2 + 3 → resolver reconstruction and resolve are owned by the controller', () => {
        // The view no longer constructs the resolver inline. The
        // controller's refresh() method owns both responsibilities; its
        // own unit tests pin the per-refresh reconstruction (audit Risk #1).
        const fn = extractRefreshCorpus();
        expect(fn).not.toContain('new InquiryCorpusResolver(');
        expect(fn).toContain('const snapshot = this.corpusSnapshot.refresh({');
    });

    it('step 4 → activeBookId reconcile reads the just-returned snapshot (Slice 2c routing intact)', () => {
        const fn = extractRefreshCorpus();
        // The reconcile chain now reads `snapshot.activeBookId`, not
        // `this.corpus.activeBookId`. Behavior identical: the controller
        // wrote `this.corpus = snapshot` synchronously, so either reads
        // the same value. The local binding just keeps TS happy without
        // null-check noise.
        expect(fn).toContain('this.selection.setActiveBookId(snapshot.activeBookId);');
        expect(fn).toContain('this.selection.setActiveBookId(undefined);');
    });

    it('step 5 → targetSceneIds reconcile uses selection.setTargetSceneIds + rememberTargetSceneIdsForBook (Slice 2b routing intact)', () => {
        const fn = extractRefreshCorpus();
        expect(fn).toContain('this.selection.setTargetSceneIds(nextTargetSceneIds);');
        expect(fn).toContain('this.selection.rememberTargetSceneIdsForBook(snapshot.activeBookId, nextTargetSceneIds);');
    });

    it('step 6 → conditional scheduleTargetPersist at the end', () => {
        const fn = extractRefreshCorpus();
        expect(fn).toMatch(/if \(shouldPersist\)\s*\{\s*this\.scheduleTargetPersist\(\);\s*\}/);
    });

    it('refreshPayloadStats sits between reconcile and the conditional persist', () => {
        const fn = extractRefreshCorpus();
        const statsIdx = fn.indexOf('this.refreshPayloadStats()');
        const persistIdx = fn.indexOf('this.scheduleTargetPersist()');
        expect(statsIdx).toBeGreaterThan(-1);
        expect(persistIdx).toBeGreaterThan(statsIdx);
    });

    it('reconcile chain reads from the just-returned snapshot, not this.corpus (no narrowing churn)', () => {
        const fn = extractRefreshCorpus();
        // The reconcile chain uses the local `snapshot` binding so TS
        // narrowing is clean (no `if (!this.corpus) return;` guard) and
        // the behavior is identical to the inline form. Both
        // `snapshot.activeBookId` and `snapshot.scenes` appear.
        expect(fn).toContain('snapshot.activeBookId');
        expect(fn).toContain('snapshot.scenes');
    });
});

// ─────────────────────────────────────────────────────────────────────────
//  Caller surface: refreshCorpus is invoked exactly three times today
//  (general refresh + omnibus dual-call) — audit §5 #3 + §2d + Risk #5
// ─────────────────────────────────────────────────────────────────────────

describe('characterization: refreshCorpus callers', () => {
    it('refreshCorpus is invoked exactly 3 times in InquiryView today', () => {
        // refreshDataDependencies (1) + runOmnibusInquiry pre-prompt (1) +
        // runOmnibusInquiry post-prompt scope-unchanged branch (1) = 3.
        // Slice 1 must preserve this exact caller count.
        const calls = INQUIRY_VIEW_SRC.match(/this\.refreshCorpus\(\);/g) ?? [];
        expect(calls.length).toBe(3);
    });

    it('runOmnibusInquiry calls refreshCorpus before AND after the plan prompt', () => {
        // The dual-call shape: once unconditionally before the prompt,
        // once conditionally after if scope did not change. Behavior
        // depends on the side-effects between calls; extraction must
        // not collapse the second call.
        const omnibusFn = INQUIRY_VIEW_SRC.match(
            /this\.refreshCorpus\(\);[\s\S]{0,2500}?this\.refreshCorpus\(\);/
        );
        expect(omnibusFn).toBeTruthy();
        // The second call is gated on scope-unchanged.
        expect(omnibusFn?.[0]).toContain('plan.scope !== this.state.scope');
    });
});

// ─────────────────────────────────────────────────────────────────────────
//  Read surface (audit §2b) — concentrates around five access patterns
// ─────────────────────────────────────────────────────────────────────────

describe('characterization: this.corpus read surface', () => {
    it('has at least 20 read sites today (forcing function for future reroute)', () => {
        // Slice 1 deliberately does NOT change read sites — they continue
        // to read `this.corpus?.X` via the write-through pattern. Counting
        // reads as a floor catches a future PR that accidentally moves a
        // read site off the field without a controller method to back it.
        const reads = INQUIRY_VIEW_SRC.match(/this\.corpus[?.]/g) ?? [];
        expect(reads.length).toBeGreaterThanOrEqual(20);
    });

    it('the five canonical access patterns all appear today', () => {
        // books, scenes, activeBookId, bookResolved, and the union via ?.
        expect(INQUIRY_VIEW_SRC).toContain('this.corpus?.books');
        expect(INQUIRY_VIEW_SRC).toContain('this.corpus?.scenes');
        expect(INQUIRY_VIEW_SRC).toContain('this.corpus?.activeBookId');
        expect(INQUIRY_VIEW_SRC).toContain('this.corpus.bookResolved');
    });
});

// ─────────────────────────────────────────────────────────────────────────
//  Pre-existing extracted modules — must stay untouched (audit §1)
// ─────────────────────────────────────────────────────────────────────────

describe('characterization: existing corpus modules are NOT touched by Slice 1', () => {
    it('InquiryCorpusResolver guardrail comment is unchanged', () => {
        const resolverSrc = readFileSync(
            resolve(process.cwd(), 'src/inquiry/services/InquiryCorpusResolver.ts'),
            'utf8'
        );
        // Public surface markers — if Slice 1 accidentally edits this
        // file the test will fail.
        expect(resolverSrc).toContain('export class InquiryCorpusResolver {');
        expect(resolverSrc).toContain('resolve(params: InquiryCorpusResolveParams): InquiryCorpusSnapshot {');
    });

    it('InquiryCorpusService guardrail header is unchanged', () => {
        const serviceSrc = readFileSync(
            resolve(process.cwd(), 'src/inquiry/services/InquiryCorpusService.ts'),
            'utf8'
        );
        // The audit's quoted guardrail comment.
        expect(serviceSrc).toContain('Owns: corpus computation, override maps, cached payload stats.');
        expect(serviceSrc).toContain('Does NOT own: corpusWarningActive');
    });
});
