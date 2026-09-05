/*
 * Characterization tests for the Slice 2 surface (InquirySelectionState).
 *
 * Pre-extraction safety net. These tests pin the CURRENT shape of the
 * five selection-state mutation paths in InquiryView so the Slice 2 rewrite
 * cannot silently miss a site or break a persistence pairing.
 *
 * When Slice 2 lands, each of these source-pattern assertions will fail.
 * Updating them to assert the new (controller-routed) form proves coverage:
 * every mutation path was rewired exactly once, no orphan direct-mutation
 * left behind. Same forcing-function pattern as the existing
 * InquiryView.test.ts.
 *
 * Reference:
 *   docs/engineering/audits/inquiry-session-controller-map-2026-05-21.md
 *   §6 Risks #1, #3
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const INQUIRY_VIEW_SRC = readFileSync(
    resolve(process.cwd(), 'src/inquiry/InquiryView.ts'),
    'utf8'
);

// ─────────────────────────────────────────────────────────────────────────
//  activeBookId — 5 mutation sites (audit Risk #1: 4-path writes, in
//  practice 5 distinct sites across 4 semantic paths)
// ─────────────────────────────────────────────────────────────────────────

describe('characterization: activeBookId mutation paths (post Slice 2c)', () => {
    // Slice 2c landed: all 8 direct-mutation sites flow through
    // selection.setActiveBookId — the audit's Risk #1 convergence is
    // structurally satisfied. Each previously-inline write is pinned
    // here in its new controller-routed form.

    it('path A — rehydrate-from-session preserves the null-coalesce semantics through the controller', () => {
        expect(INQUIRY_VIEW_SRC).toContain(
            'this.selection.setActiveBookId(session.activeBookId ?? this.state.activeBookId);'
        );
    });

    it('path B — loadTargetCache restores via setActiveBookId(cache.lastBookId)', () => {
        expect(INQUIRY_VIEW_SRC).toContain(
            'this.selection.setActiveBookId(cache.lastBookId);'
        );
    });

    it('path C1 — refreshCorpus syncs via setActiveBookId(snapshot.activeBookId) (post Corpus Slice 1)', () => {
        // Corpus Slice 1 introduced a `const snapshot = this.corpusSnapshot.refresh(...)`
        // local; the reconcile chain inside refreshCorpus now reads
        // `snapshot.activeBookId` instead of `this.corpus.activeBookId`.
        // Behavior identical — controller wrote `this.corpus = snapshot`
        // synchronously, so the two reads see the same value. The local
        // binding is just TS-narrowing convenience.
        expect(INQUIRY_VIEW_SRC).toContain(
            'this.selection.setActiveBookId(snapshot.activeBookId);'
        );
    });

    it('path C2 + E — refreshCorpus and resetInquiryToFreshBaseState both clear via setActiveBookId(undefined)', () => {
        // Two paths clear to undefined. Both must route through the
        // same setter — counting catches a divergence.
        const undefMatches = INQUIRY_VIEW_SRC.match(
            /this\.selection\.setActiveBookId\(undefined\)/g
        ) ?? [];
        expect(undefMatches.length).toBe(2);
    });

    it('path D — applySession adopts via setActiveBookId(session.activeBookId)', () => {
        expect(INQUIRY_VIEW_SRC).toContain(
            'this.selection.setActiveBookId(session.activeBookId);'
        );
    });

    it('path F — setFocusByIndex sets via setActiveBookId(book.id)', () => {
        expect(INQUIRY_VIEW_SRC).toContain(
            'this.selection.setActiveBookId(book.id);'
        );
    });

    it('path G — drillIntoBook sets via setActiveBookId(bookId)', () => {
        expect(INQUIRY_VIEW_SRC).toContain(
            'this.selection.setActiveBookId(bookId);'
        );
    });

    it('state.activeBookId has zero direct-mutation sites (Risk #1 convergence)', () => {
        // The audit's headline Slice 2 risk. Pre-extraction count: 8.
        // Post Slice 2c: 0. Every path must enter through one setter.
        const mutations = INQUIRY_VIEW_SRC.match(/this\.state\.activeBookId\s*=(?!=)/g) ?? [];
        expect(mutations.length).toBe(0);
    });

    it('total selection.setActiveBookId call count covers all 8 semantic paths', () => {
        // Exact count: 8 controller calls replacing 8 direct mutations.
        // Adding a new write must add a new test above OR fail this count.
        const calls = INQUIRY_VIEW_SRC.match(/this\.selection\.setActiveBookId\(/g) ?? [];
        expect(calls.length).toBe(8);
    });
});

// ─────────────────────────────────────────────────────────────────────────
//  targetSceneIds — 10 direct-mutation sites
// ─────────────────────────────────────────────────────────────────────────

describe('characterization: targetSceneIds mutation paths (post Slice 2b)', () => {
    // Slice 2b landed: state.targetSceneIds writes go through
    // selection.setTargetSceneIds. The previous direct-mutation
    // assertions failed loudly when the rewire landed; these new
    // assertions pin the controller-routed form at each call site.

    it('applySession routes session targetSceneIds through the controller', () => {
        expect(INQUIRY_VIEW_SRC).toContain(
            'this.selection.setTargetSceneIds(this.normalizeTargetSceneIds(session.targetSceneIds));'
        );
    });

    it('loadTargetCache restores via getRememberedTargetSceneIdsForBook + setTargetSceneIds', () => {
        expect(INQUIRY_VIEW_SRC).toContain(
            'this.selection.getRememberedTargetSceneIdsForBook(cache.lastBookId)'
        );
        expect(INQUIRY_VIEW_SRC).toMatch(
            /this\.selection\.setTargetSceneIds\(\s*this\.selection\.getRememberedTargetSceneIdsForBook/
        );
    });

    it('refreshCorpus resyncs via setTargetSceneIds (no direct state.targetSceneIds write)', () => {
        expect(INQUIRY_VIEW_SRC).toContain('this.selection.setTargetSceneIds(nextTargetSceneIds);');
    });

    it('removeEmptyTargetSceneItems and toggle/clear paths use the controller', () => {
        expect(INQUIRY_VIEW_SRC).toContain('this.selection.setTargetSceneIds(next);');
        expect(INQUIRY_VIEW_SRC).toContain('this.selection.setTargetSceneIds([]);');
    });

    it('setFocusByIndex syncs via setTargetSceneIds + getVisibleTargetSceneIdsForBook', () => {
        expect(INQUIRY_VIEW_SRC).toContain(
            'this.selection.setTargetSceneIds(this.getVisibleTargetSceneIdsForBook(book.id));'
        );
    });

    it('state.targetSceneIds has zero direct-mutation sites (Slice 2b boundary)', () => {
        const mutations = INQUIRY_VIEW_SRC.match(/this\.state\.targetSceneIds\s*=(?!=)/g) ?? [];
        expect(mutations.length).toBe(0);
    });
});

describe('characterization: per-book selection Map (post Slice 2b)', () => {
    it('lastTargetSceneIdsByBookId field is gone from InquiryView', () => {
        // The Map moved into InquirySelectionState. The field must not
        // be redeclared on the view.
        expect(INQUIRY_VIEW_SRC).not.toMatch(/private lastTargetSceneIdsByBookId/);
    });

    it('rememberTargetSceneIdsForBook covers refreshCorpus, toggle, clear, removeEmpty paths', () => {
        const calls = INQUIRY_VIEW_SRC.match(/this\.selection\.rememberTargetSceneIdsForBook\(/g) ?? [];
        // Four call sites: refreshCorpus, toggle, clear, removeEmpty.
        expect(calls.length).toBeGreaterThanOrEqual(4);
    });

    it('getRememberedTargetSceneIdsForBook is used for both reads', () => {
        // refreshCorpus pre-compare read + getVisibleTargetSceneIdsForBook read.
        const calls = INQUIRY_VIEW_SRC.match(/this\.selection\.getRememberedTargetSceneIdsForBook\(/g) ?? [];
        expect(calls.length).toBeGreaterThanOrEqual(2);
    });

    it('Map normalization is delegated via hydrateRememberedTargetSceneIdsFromCache', () => {
        expect(INQUIRY_VIEW_SRC).toContain(
            'this.selection.hydrateRememberedTargetSceneIdsFromCache('
        );
    });
});

// ─────────────────────────────────────────────────────────────────────────
//  inquiryTargetCache — persistence atomicity (audit Risk #3)
// ─────────────────────────────────────────────────────────────────────────

describe('characterization: inquiryTargetCache persistence (post Slice 2b)', () => {
    // After Slice 2b, the cache shape, debounce timer, and Risk #3
    // write-before-save ordering all live inside InquirySelectionState
    // and are pinned by its own unit tests (see inquirySelectionState.test.ts).
    // The characterization tests here pin the InquiryView-side wiring:
    // every previously-inline persist responsibility now reaches the
    // controller through a documented method.

    it('scheduleTargetPersist is a 1-line delegator to selection.schedulePersist', () => {
        expect(INQUIRY_VIEW_SRC).toContain(
            'this.selection.schedulePersist(this.state.activeBookId);'
        );
        // The inline window.setTimeout + cache-shape build is gone.
        expect(INQUIRY_VIEW_SRC).not.toContain(
            'lastTargetSceneIdsByBookId: Object.fromEntries(this.lastTargetSceneIdsByBookId)'
        );
    });

    it('cache payload shape is no longer built in InquiryView', () => {
        // The canonical { lastBookId, lastTargetSceneIdsByBookId } shape
        // is now built inside the controller. InquiryView must not
        // duplicate the construction.
        expect(INQUIRY_VIEW_SRC).not.toContain('lastBookId: this.state.activeBookId,');
    });

    it('resetInquiryToFreshBaseState invokes selection.clearPersistedTargetCache directly (no view-side wrapper)', () => {
        // Cleanup pass: the 1-line view-side `clearPersistedTargetCache`
        // delegator was inlined. The single caller — the
        // `resetInquiryToFreshBaseState({ clearPersistedTargets: true })`
        // branch — now invokes the controller method directly.
        expect(INQUIRY_VIEW_SRC).toContain(
            'this.selection.clearPersistedTargetCache();'
        );
        // The view no longer declares the wrapper method.
        expect(INQUIRY_VIEW_SRC).not.toMatch(
            /private clearPersistedTargetCache\(\)/
        );
        // The inline { lastBookId: undefined, lastTargetSceneIdsByBookId: {} }
        // construction is gone (was already removed in Slice 2b).
        expect(INQUIRY_VIEW_SRC).not.toMatch(
            /this\.plugin\.settings\.inquiryTargetCache\s*=\s*\{\s*lastBookId:\s*undefined/
        );
    });

    it('user-driven targetSceneIds mutations still schedule persistence', () => {
        // Same caller-side expectation as before: every user-driven path
        // calls scheduleTargetPersist (now a delegator). The count is
        // unchanged across Slice 2b — it only moved through one extra layer.
        const persistCalls = INQUIRY_VIEW_SRC.match(/this\.scheduleTargetPersist\(\);/g) ?? [];
        expect(persistCalls.length).toBeGreaterThanOrEqual(3);
    });

    it('toggleTargetSceneSelection updates the Map then persists (controller-routed)', () => {
        // The visible ordering is now: setTargetSceneIds → Map update
        // (rememberTargetSceneIdsForBook) → scheduleTargetPersist. Pin
        // this so a future refactor cannot reorder.
        const fn = INQUIRY_VIEW_SRC.match(
            /this\.selection\.setTargetSceneIds\(next\);[\s\S]{0,500}?this\.scheduleTargetPersist\(\)/
        );
        expect(fn).toBeTruthy();
        expect(fn?.[0]).toContain('this.selection.rememberTargetSceneIdsForBook(activeBookId, next);');
    });

    it('inquiryTargetCache settings access is via the controller closure (single write site)', () => {
        // Pre-extraction: 2 direct write sites (scheduleTargetPersist,
        // clearPersistedTargetCache). Post-Slice-2b: exactly 1, inside
        // the constructor's setTargetCache closure feeding the controller.
        const writes = INQUIRY_VIEW_SRC.match(
            /this\.plugin\.settings\.inquiryTargetCache\s*=/g
        ) ?? [];
        expect(writes.length).toBe(1);
    });

    it('targetPersistTimer field is gone from InquiryView', () => {
        // The debounce timer moved into the controller. The Disposable
        // contract ensures cleanup; the viewDisposables track() call for
        // this field was also removed.
        expect(INQUIRY_VIEW_SRC).not.toMatch(/private targetPersistTimer/);
        expect(INQUIRY_VIEW_SRC).not.toContain("track('targetPersistTimer')");
    });

    it('controller cleanup is wired into onClose alongside other disposables', () => {
        const onCloseFn = INQUIRY_VIEW_SRC.match(
            /async onClose\(\)[\s\S]+?\n\s{4}\}/
        )?.[0] ?? '';
        expect(onCloseFn).toContain('this.selection?.cleanup();');
    });

    it('controller construction includes setTargetCache closure', () => {
        const ctor = INQUIRY_VIEW_SRC.match(/constructor\(leaf:[\s\S]+?\n\s{4}\}/)?.[0] ?? '';
        expect(ctor).toContain('setTargetCache: (cache) => { this.plugin.settings.inquiryTargetCache = cache; }');
    });
});

// ─────────────────────────────────────────────────────────────────────────
//  mode round-trip — inquiryLastMode read at startup, write on toggle
// ─────────────────────────────────────────────────────────────────────────

describe('characterization: mode round-trip via inquiryLastMode (post Slice 2a)', () => {
    // Slice 2a landed: the `mode` field and its inquiryLastMode round-trip
    // are now owned by InquirySelectionState. These tests pin the new
    // controller-routed shape and prove every previously-inline path was
    // rewired. inquirySelectionState.test.ts covers the controller's
    // internal contract; this group pins the *integration* points where
    // InquiryView calls into the controller.

    it('constructor hydrates mode via selection.applyPersistedLastModeOr (replaces inline read+if)', () => {
        // No more inline `const lastMode = this.plugin.settings.inquiryLastMode` in the constructor.
        const constructorBody = INQUIRY_VIEW_SRC.match(
            /constructor\(leaf:[\s\S]+?\n\s{4}\}/
        )?.[0] ?? '';
        expect(constructorBody).toContain('this.selection.applyPersistedLastModeOr(createDefaultInquiryState().mode);');
        expect(constructorBody).not.toContain("lastMode === 'flow' || lastMode === 'depth'");
    });

    it('controller, not InquiryView, owns the flow|depth validation guard', () => {
        // The guard moved into validatePersistedInquiryLens. InquiryView
        // must not retain a duplicate validator (single source of truth).
        // resetInquiryToFreshBaseState used to contain this literal; it
        // now delegates.
        expect(INQUIRY_VIEW_SRC).not.toMatch(/lastMode === 'flow' \|\| lastMode === 'depth'/);
    });

    it('setActiveLens delegates the state→settings→save triple to the controller', () => {
        const fn = INQUIRY_VIEW_SRC.match(
            /private setActiveLens\([\s\S]+?\n\s{4}\}/
        )?.[0] ?? '';
        // Guard stays in the view (cheap early-return for no-op toggles).
        expect(fn).toContain('if (!mode || mode === this.state.mode) return;');
        // Mutation triple moved to the controller. View no longer touches
        // state.mode or plugin.settings.inquiryLastMode directly here.
        expect(fn).toContain('this.selection.setActiveLens(mode);');
        expect(fn).not.toContain('this.state.mode = mode;');
        expect(fn).not.toContain('this.plugin.settings.inquiryLastMode = mode;');
    });

    it('applySession adopts mode via selection.adoptModeFromResult (no settings persist)', () => {
        const fn = INQUIRY_VIEW_SRC.match(
            /private applySession\([\s\S]+?refreshUI\(\{ skipCorpus: true \}\);[\s\S]*?\n\s{4}\}/
        )?.[0] ?? '';
        expect(fn).toContain('this.selection.adoptModeFromResult(normalized.mode);');
        // Critical UX invariant: session adoption must NOT clobber user's
        // last-chosen lens preference in settings.
        expect(fn).not.toContain('this.plugin.settings.inquiryLastMode');
    });

    it('resetInquiryToFreshBaseState delegates mode hydration to the controller', () => {
        const resetFn = INQUIRY_VIEW_SRC.match(
            /private resetInquiryToFreshBaseState\([\s\S]+?\n\s{4}\}/
        )?.[0] ?? '';
        expect(resetFn).toContain('this.selection.applyPersistedLastModeOr(defaults.mode);');
        // Old inline read removed.
        expect(resetFn).not.toContain('const lastMode = this.plugin.settings.inquiryLastMode;');
    });

    it('inquiryLastMode access is collapsed to a single read site and a single write site (the controller closures)', () => {
        // Pre-extraction: 2 reads (constructor + reset) + 1 write (setActiveLens) = 3 occurrences.
        // Post-extraction: 1 read closure + 1 write closure inside the
        // controller's settings host. View has zero direct accesses.
        const reads = INQUIRY_VIEW_SRC.match(
            /this\.plugin\.settings\.inquiryLastMode(?!\s*=)/g
        ) ?? [];
        const writes = INQUIRY_VIEW_SRC.match(
            /this\.plugin\.settings\.inquiryLastMode\s*=/g
        ) ?? [];
        // Exactly one read closure + one write closure in the controller's
        // settings host setup. If a future change introduces another
        // direct access (bypassing the controller), this assertion fails.
        expect(reads.length).toBe(1);
        expect(writes.length).toBe(1);
    });

    it('controller construction wires the three settings closures in the constructor', () => {
        // The settings host shape is part of the boundary between
        // InquiryView and the controller. Pin the closure surface so a
        // future refactor cannot quietly drop or rename one of them.
        const constructorBody = INQUIRY_VIEW_SRC.match(
            /constructor\(leaf:[\s\S]+?\n\s{4}\}/
        )?.[0] ?? '';
        expect(constructorBody).toContain('new InquirySelectionState(');
        expect(constructorBody).toContain('getPersistedLastMode: () => this.plugin.settings.inquiryLastMode');
        expect(constructorBody).toContain('this.plugin.settings.inquiryLastMode = mode;');
        expect(constructorBody).toContain('saveSettings: () => this.plugin.saveSettings()');
    });

    it('state.mode is no longer directly mutated in InquiryView (Slice 2a ownership)', () => {
        // Mirrors the Slice 1 boundary check: post-extraction, no
        // `this.state.mode = …` direct writes remain in the view. Reads
        // (e.g. `this.state.mode === 'depth'`) are unchanged.
        const mutations = INQUIRY_VIEW_SRC.match(/this\.state\.mode\s*=(?!=)/g) ?? [];
        expect(mutations.length).toBe(0);
    });
});

// ─────────────────────────────────────────────────────────────────────────
//  loadTargetCache — atomic activeBookId + targetSceneIds restoration
// ─────────────────────────────────────────────────────────────────────────

describe('characterization: loadTargetCache atomicity (post Slice 2b)', () => {
    it('restores activeBookId and targetSceneIds together when adopting persisted selection', () => {
        // Post Slice 2c: BOTH writes go through the controller. The
        // adjacency still matters — separating them would create a
        // momentary state where activeBookId is set but targetSceneIds
        // is stale.
        const fn = INQUIRY_VIEW_SRC.match(
            /this\.selection\.setActiveBookId\(cache\.lastBookId\);[\s\S]{0,300}?this\.selection\.setTargetSceneIds\(/
        );
        expect(fn).toBeTruthy();
    });

    it('hydrates the per-book Map via the controller, injecting normalizeTargetSceneIds', () => {
        // The normalizer stays in InquiryView (its rules live there).
        // The controller hydrates the Map via the injected callback.
        const fn = INQUIRY_VIEW_SRC.match(
            /this\.selection\.hydrateRememberedTargetSceneIdsFromCache\([\s\S]{0,200}?this\.normalizeTargetSceneIds/
        );
        expect(fn).toBeTruthy();
    });

    it('options.adoptPersistedSelection !== false defaults to true (preserves UX)', () => {
        expect(INQUIRY_VIEW_SRC).toContain('const adoptPersistedSelection = options?.adoptPersistedSelection !== false;');
    });

    it('loadTargetCache cancels any pending persist via the controller', () => {
        // Pre-extraction: inline `if (this.targetPersistTimer) { clearTimeout; }`.
        // Post-Slice-2b: delegated to selection.cancelPendingPersist().
        expect(INQUIRY_VIEW_SRC).toContain('this.selection.cancelPendingPersist();');
    });
});

// ─────────────────────────────────────────────────────────────────────────
//  Slice 2 ownership boundary — owned vs deferred fields
// ─────────────────────────────────────────────────────────────────────────

describe('characterization: Slice 2 ownership scope (per audit §4)', () => {
    it('remaining pending fields are still directly mutated on this.state today', () => {
        // Architectural-tier fields (scope, selectedPromptIds, etc.)
        // remain pending the post-Slice-3 review boundary. Pre-extraction,
        // they must still appear as direct writes.
        const pendingFields = [
            'scope',
            'selectedPromptIds',
            'promptFormOverrides',
            'reportPreviewOpen',
        ];
        for (const field of pendingFields) {
            const pattern = new RegExp(`this\\.state\\.${field}\\s*=`);
            expect(pattern.test(INQUIRY_VIEW_SRC)).toBe(true);
        }
    });

    it('Slices 1 + 2a + 2b + 2c fields are NOT directly mutated in InquiryView', () => {
        // Doctrine check — guards against regression. These fields route
        // through their controllers (InquiryActiveSessionState or
        // InquirySelectionState). The forbidden form is the direct write;
        // reads (`===`, `.length`) are unchanged.
        const controlledFields = [
            // Slice 1
            'activeSessionId',
            'activeResult',
            'activeQuestionId',
            'activeZone',
            'cacheStatus',
            'corpusFingerprint',
            'corpusOnlyFingerprint',
            'corpusManifestSnapshot',
            'lastError',
            // Slice 2a
            'mode',
            // Slice 2b
            'targetSceneIds',
            // Slice 2c
            'activeBookId',
        ];
        for (const field of controlledFields) {
            const pattern = new RegExp(`this\\.state\\.${field}\\s*=(?!=)`);
            expect(pattern.test(INQUIRY_VIEW_SRC)).toBe(false);
        }
    });
});
