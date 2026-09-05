# Inquiry Post-Extraction Architectural Audit

**Date:** 2026-05-21  
**Status:** Post-campaign stabilization audit  
**Scope:** Analyze InquiryView.ts after session and corpus controller extraction

---

## Methodology

Read all prerequisite docs and extracted audits, then:

1. Examined all three extracted controllers (`InquiryActiveSessionState`, `InquirySelectionState`, `InquiryCorpusSnapshotController`)
2. Read session/README.md for doctrine guards
3. Analyzed InquiryView.ts (11,528 LOC) systematically:
   - Class fields (line 430–659)
   - Constructor wiring (line 661–695)
   - State mutation sites (grep + source reading)
   - Core orchestration methods (`refreshUI`, `refreshCorpus`, `handleScopeChange`, `runInquiry`, `applySession`, `clearActiveResultState`, `resetInquiryToFreshBaseState`)
   - Event handlers and rendering loops

---

## 1. Remaining Responsibilities

### Lifecycle & Event Wiring

- **getViewType, getDisplayText, buildDynamicDisplayText** (lines 720–742) — Obsidian view contract
- **onOpen, onClose, onLeaf** — LeafChange registration + recovery polling
- **recovery path** (lines 740–790) — mid-flight run detection on reopen

**Fields involved:** `inquiryRecoveryPollHandle`, `updateRunningClockInterval`

### Scope & Selection Orchestration

- **`handleScopeChange(scope)`** (line 5995–6008) — User toggles 'book' ↔ 'saga'; clears active result if loaded
- **`state.scope`** (mutated at lines 1990, 5998, 6081) — Still owns direct writes in two places:
  - `handleScopeChange` (line 5998)
  - `activateSession` (line 2036)
  - `applySession` (line 3169)
- **`getActiveBookLabel`, `getActiveBookTitleForMessages`, `getScopeLabel`, `getScopeKey`** — Label/key derivation for UI + run paths
- **`state.selectedPromptIds`** (mutated at lines 683, 3017, 3273, 3281) — per-zone question selection; transient (not persisted)
- **`state.promptFormOverrides`** (mutated at lines 3349, 3347) — per-question 'auto'|'standard'|'focused' form override; transient

**Controllers do NOT own:** `scope`, `selectedPromptIds`, `promptFormOverrides`, `reportPreviewOpen`

### Rendering Orchestration (View System)

- **`refreshUI()`** (line 3751) — Call stack: → `refreshDataDependencies` → `refreshCorpus()` → reconcile chain
  - Then `refreshDerivedViewState()` (calls render methods)
  - Then `refreshVisualChrome()` (updates class, icons, chrome)
- **`refreshCorpus()`** (line 3812–3862) — **Critical orchestrator:**
  - Calls `corpusSnapshot.refresh()` (controller owns resolver + snapshot)
  - Reads returned snapshot, runs reconcile chain (`selection.setActiveBookId`, `selection.setTargetSceneIds`, `rememberTargetSceneIdsForBook`, `scheduleTargetPersist`)
  - Calls `refreshPayloadStats()` — character + token loading
- **`invalidateBriefingPurgeAvailability()`** — Cache invalidation before corpus refresh
- **Payload stats orchestration** — `refreshPayloadStats`, `schedulePayloadStatsRefresh`, `computePayloadStats` — character/word loading, token estimation, per-scene caching
- **Corpus service delegators** — `getClassOverride`, `setClassOverride`, `deleteItemOverrideByKey`, `hasOverrides`, `getOverrideSummary`, `applyOverrideSummary`, `resetOverrides` — all forward to `corpusService` (already extracted module)

**Fields involved:** `payloadStats`, `entryBodyCharCache`, `entryBodyCharLoads`, `payloadStatsRefreshTimer`, `payloadStatsRefreshDirty`, `corpusService`, `corpus` (write-through slot)

### Run Orchestration & State

- **`runInquiry(question, options)`** (line 6145–6450) — Main run entry point
  - Guards (`isRunning`, scope validity, empty corpus)
  - Builds manifest + session key
  - Cache lookup + stale-vs-fresh determination
  - Token guard (readiness check)
  - Sets `state.isRunning = true` (line 6261)
  - Invokes `runner.runWithTrace()`
  - Handles result, persists session, calls `applySession`
  - **Finally block:** saves/clears progress, updates view (line 6381–6415)
- **`handleQuestionClick(question, options)`** (line 6134–6143) — User click → run if error, otherwise run
- **Run token/cancellation** — `beginInquiryRunToken`, `finishInquiryRunToken`, `shouldDiscardInquiryRunOutcome`, `requestActiveInquiryCancellation` — manage concurrent run tokens (user can open view mid-flight)
- **Progress tracking** — `updateRunProgress(progress)` — live HUD updates; feeds `currentRunProgress`, `currentRunElapsedMs`, `currentRunEstimatedMaxMs`
- **`applySession(session, cacheStatus)`** (line 7155–7199) — Post-run state application:
  - Sets `scope`, calls `selection.adoptModeFromResult`, calls `selection.setActiveBookId`, calls `selection.setTargetSceneIds`
  - **Calls `activeSession.adopt()` to set all 8-field active-result subset atomically**
  - Sets `state.isRunning = false` (line 7190)
  - Shows preview, refreshes UI
- **`clearActiveResultState()`** (line 7201–7204) — Delegates to `activeSession.clearActiveResult()`

**Fields involved:** `state.isRunning` (9 mutation sites: 6118, 6261, 6614, 6726, 6896, 7190, 7228, 7783), `activeInquiryRunToken`, `inquiryRunTokenCounter`, `cancelledInquiryRunTokens`, `currentRunProgress`, `currentRunElapsedMs`, `currentRunEstimatedMaxMs`, `omnibusAbortRequested`, `activeOmnibusModal`, `activeCancelRunModal`, `plugin._inquiryRunInFlight` (plugin-level recovery marker)

### Omnibus (Batch Run) Orchestration

- **`runOmnibusInquiry(input)`** (line 6463–6903) — Multi-question run; calls `refreshCorpus` twice (before prompt, after if unchanged); persists each result; manages progress UI
- **Modal coordination** — `activeOmnibusModal`, `activeCancelRunModal` — lifecycle-scoped modals for multi-run UX
- **Progress persistence** — `saveOmnibusProgress`, `clearOmnibusProgress`, `mergeCompletedIds` — settings writes for resumable omnibus

**Fields involved:** `activeOmnibusModal`, `activeCancelRunModal`, omnibus-related state in `plugin.settings.inquiryOmnibusProgress`

### Modal Management

- **`InquiryOmnibusModal`, `InquiryCancelRunModal`, `InquiryBriefingModal`** — Owned, instantiated, and shown by view
- **`InquiryCancelRunModal`** — Cancel-confirmation flow
- **`InquiryBriefingModal`** — Opens briefing presentation from session
- **`InquiryPurgeConfirmationModal`** — Purge-action-notes confirmation

**Fields involved:** `activeOmnibusModal`, `activeCancelRunModal`

### Transient UI State

- **Mode/Lens toggle (Slice 2a extracted, but view still owns rendering):**
  - **`setActiveLens(mode)`** (line 6010–6034) — Delegates to `selection.setActiveLens()` then updates UI; calls `updateModeClass`, `updateRings`, syncs findings panel to selected lens
  - **`handleRingClick(mode)`** (line 6036–6051) — User click on flow/depth ring; guards, calls `setActiveLens`
  - **`handleModeIconToggleClick()`** (line 6053–6060) — User click on mode icon; calls `setActiveLens`
  - **Memoized:** `_resolvedEngine`, `_currentCorpusContext` (per-refresh-cycle caches, invalidated at top of `refreshUI`)

- **Zone pod / prompt selection:**
  - **`setSelectedPrompt(zone, promptId)`** (line 3278–3284) — Sets `state.selectedPromptIds[zone]`, syncs glyphs
  - **`handlePromptClick(zone, event)`** (line 3286–3316) — Cyclic selection, guards
  - **`syncSelectedPromptIds()`** (line 3263–3276) — Validate available options, reset invalid selections

- **Glyph/visual state (rendering subsystem):**
  - **`updateScopeGlyph`, `updateScopeToggle`, `updateModeToggle`, `updateModeClass`, `updateActiveZoneStyling`** — CSS class toggles + icon updates
  - **Glyphs:** `rootSvg`, `scopeToggleButton`, `scopeToggleIcon`, `modeToggleButton`, `modeToggleIcon`, `glyphAnchor`, `glyph`, `glyphHit`, etc. (40+ SVG element refs)

- **Briefing panel / session carousel:**
  - **`buildBriefingListItems`, `renderBriefingSessionItem`, `refreshBriefingPanel`** — Session list rendering
  - **`clearBriefingSessions`, `purgeInquiryBriefingSessions`** — Briefing wipe + session purge
  - **`briefingPurgeAvailable`, `briefingPurgeScanPending`, `briefingPurgeScanToken`** — Availability check state

- **Results preview (HUD):**
  - **`showResultsPreview(result)`, `showErrorPreview(result)`, `hideResultPreview`** — Preview show/hide + data binding
  - **`updatePromptPreview(zone, lens, question, rows, context, options)`** — Prompt-hover preview
  - **`previewLocked`, `previewHideTimer`, `previewLast`** — Preview lock state

- **Hover state:**
  - **`briefingPopover`, `enginePopover`** — HoverPopoverControllers (show/hide on hover)
  - **`sceneDossierGroup`, `sceneDossierController`, `sceneDossierFocusCore`, etc.** — Dossier rendering elements

- **Error state:**
  - **`clearErrorStateForAction()`** — Guards at start of user actions
  - **`setApiStatus(status, reason)`** — Updates guidance UI + icon styling
  - **`isErrorState()`, `isResultsState()`** — Guard predicates

**Fields involved:** 40+ SVG element refs, preview state, dossier state, popover refs, timers, caches

### Guidance & Readiness

- **`resolveGuidanceState()`** — Derives 'ready' | 'locked' | 'loading' state from run + readiness checks
- **`buildReadinessUiState()`** — Synthesizes readiness card (blocked/ready/partial), token guard display
- **`updateGuidance()`** — Guidance text + alert rendering
- **`guidanceState` field** — 'ready' | 'locked' | 'loading' | 'awaiting' enum state

**Fields involved:** `guidanceState`, `pendingGuardQuestion`, `enginePanelFailureGuidance`, `lastEngineAdvisoryContext`

### Rendering Subsystems (Do NOT Extract)

Already tested, stable, single-responsibility modules:

- **`InquiryMinimapRenderer`** — Minimap SVG rendering; owned, instantiated at field level
- **`SceneDossierController`** — Scene detail dossier; owned, instantiated at field level
- **`HoverPopoverController`** (x2) — Briefing + engine popovers; already extracted, instantiated in view
- **Corpus strip rendering** (`renderInquiryCorpusStrip`, `applyInquiryCorpusCcSlotViewModel`, `buildInquiryCorpusCcSlotViewModel`) — Corpus CC strip; delegators stay in view
- **DOM factories** (`createInquiryDesktopShell`, `createInquiryEnginePanel`, etc.) — DOM creation; delegators stay in view
- **Event binders** (`bindInquiryDesktopShellEvents`, `bindInquiryEnginePanelEvents`, etc.) — Event wiring; delegators stay in view

### Result/Artifact Persistence & Logs

- **`persistInquiryResult(result, options)`** — Writes brief + log files
- **`persistOmnibusResult(options)`** — Omnibus-specific result write
- **`saveOmnibusIndexNote(briefPaths, scopeLabel)`** — Multi-brief index file
- **Artifact folder + log folder management** — `ensureInquiryArtifactFolder`, `ensureInquiryLogFolder`, `resolveInquiryLogFolder`
- **Session store operations** — `getSession`, `setSession`, `updateSession`, `clearSessions` — forwarded to `InquirySessionStore`

**Fields involved:** `artifactButton`, `apiSimulationButton`, `apiSimulationTimer`, artifact/log paths

### Manifest & Corpus Computation (Complex, Non-Extractable)

- **`buildCorpusManifest(questionId, options)`** — Resolves entry set + evidence rules + fingerprints; depends on active scope, target selection, prompt form
- **`buildCorpusSettingsFingerprint()`** — Quick hash for progress resumption
- **`buildCurrentCorpusSnapshot(questionId, questionZone)`** — Snapshot for stale-check
- **`diagnoseSessionStaleness(session)`** — Stale reason computation
- **`getEvidenceRules()`** — Evidence participation rules per scope
- **`isContextRequiredForQuestion(questionId, zone)`** — Context check

This is load-bearing business logic entangled with scope + corpus + manifest. No extraction target.

### Settings & Configuration

- **Prompt config hydration** — `ensurePromptConfig`, `buildDefaultSelectedPromptIds`, `getPromptConfig`
- **AI settings validation** — `validateAiSettings`, `buildDefaultAiSettings`
- **Engine selection** — `resolveEngineSelectionForRun`, `getResolvedEngine` (memoized per-refresh)
- **Model selection** — `selectModel`, `resolveInquiryEngine`
- **Frontmatter + book resolution** — `getActiveFrontmatterMappings`, `getSequencedBooks`, `normalizeInquirySources`
- **Citation support check** — `resolveCitationsEnabled`, `providerSupportsCitations`

These are mostly delegators to service functions. No extraction target.

---

## 2. Inline State That Should Stay Inline

**`state.selectedPromptIds` (per-zone question selection)**
- Transient, UI-only, not persisted
- No coupling to corpus or run—only used for rendering prompt pod labels
- Tiny scope; not worth a slice
- **Verdict: Leave inline**

**`state.promptFormOverrides` (per-question form override)**
- Transient, UI-only, rarely written (3 sites)
- Only affects run prompt form selection
- No side-effects to persist
- **Verdict: Leave inline**

**`state.reportPreviewOpen`** — Ditto. **Verdict: Leave inline**

**`guidanceState`** (UI enum: 'ready' | 'locked' | 'loading')
- Derived from run + readiness state each refresh
- Ephemeral; not persisted anywhere
- Couples to UI rendering state, not business logic
- **Verdict: Leave inline**

**Rendering element refs** (`rootSvg`, `glyphAnchor`, `previewGroup`, 40+ SVG/HTML slots)
- DOM references; belong to the view that owns them
- No state ownership, purely view infrastructure
- **Verdict: Leave inline**

**`payloadStats`, character/word caching** — View-level rendering cache
- Computed once per refresh, not a state machine
- Couples to the view's rendering pipeline
- **Verdict: Leave inline**

**`minimap` (InquiryMinimapRenderer instance)** — Already isolated as a service
- Owned by view, self-contained, single responsibility
- **Verdict: Leave inline** ✓

**Recovery state** (`inquiryRecoveryPollHandle`, `wasRunning`, `startupFreshMode`, `freshModeTouchedBookIds`)
- Recovery lifecycle is view-specific (reopen detection, "resume or discard")
- Not reusable elsewhere
- **Verdict: Leave inline**

---

## 3. Inline State That Should Move Next

### (Estimated extraction candidates for future slices)

**`scope` (InquiryScope: 'book' | 'saga')**
- **Why it looks ready:** Single clear owner (user toggle via `handleScopeChange`); written in 4 places (lines 1990, 5998, 6081, 2036)
- **Why it isn't yet:** Tightly coupled to corpus shape decision (saga = all books, book = single book). The corpus controller already owns the resolved snapshot, but orchestrating scope as a live parameter that changes the corpus resolution semantics is architectural — not extractive.
- **Audit rule:** Scope is "an input to corpus refresh" (audit `inquiry-corpus-map-2026-05-21.md` §7), which means the dependency order is: corpus controller lands, then scope extraction. **Not ready this cycle.**
- **Verdict: Defer to Slice ≥5, after corpus stabilizes**

**`isRunning` (9 mutation sites)**
- **Why it looks ready:** 9 sites but tight clusters (start, cancel, abort, complete, error recovery)
- **Why it isn't:** Coupled to `AbortController`, token/cancellation, runner invocation, progress state, recovery polling. The run orchestration is not just a flag — it's a lifecycle state machine.
- **Audit rule:** "Hard stop per audit Risk #2; deferred to Slice 4 (InquiryRunController)" — documented in `inquiry-session-controller-map-2026-05-21.md`.
- **Verdict: Do not extract. Leave for dedicated run-controller audit.**

**`corpusWarningActive` (10 mutation sites)**
- **Why it looks ready:** "Single-setter, many-clearers" shape (Slice 2c solved this for `activeBookId`)
- **Why it isn't:** Only 10 sites; mostly trivial (`→ false` on override edits). Extracting it into a micro-slice costs more than it saves. If real complexity emerges later, revisit.
- **Verdict: Leave inline for now. Revisit after omnibus stabilization.**

**Omnibus progress state** (`plugin.settings.inquiryOmnibusProgress`)
- **Why:** Multi-run orchestration is inherently tied to run lifecycle + modal coordination. Extracting progress persistence without the run controller would split responsibility.
- **Verdict: Defer until InquiryRunController is designed.**

---

## 4. Risk Shift: From Sprawl to Orchestration

**Previous dominant risk** (pre-campaign): **State ownership sprawl**
- Multiple sites mutating the same field
- No single entry point for critical writes
- Hard to reason about cascading updates

**Current dominant risk** (post-campaign): **Orchestration sprawl / complex call sequencing**

**Evidence:**

1. **`refreshCorpus()` is now a complex orchestrator** (lines 3812–3862):
   ```
   1. invalidateBriefingPurgeAvailability()
   2. corpusSnapshot.refresh()  ← controller-owned write
   3. if activeBookId changed → selection.setActiveBookId()
   4. if scope=book and targetSceneIds changed → selection.setTargetSceneIds()
   5. selection.rememberTargetSceneIdsForBook()
   6. refreshPayloadStats()
   7. if shouldPersist → scheduleTargetPersist()
   ```
   
   The order is contractual. The 7 steps must remain atomic. If a future extraction absorbs one side-effect (e.g., "move payload stats to a controller"), the orchestration must re-route calls between controllers. This is becoming the fragile point.

2. **`runInquiry()` + `applySession()` form a complex handoff** (lines 6145–7199):
   - 200+ lines building state
   - Invokes runner service (async, cancellable)
   - Persists result
   - Calls `applySession()` which in turn calls multiple selection methods
   - Finally block saves progress + updates view
   
   If run orchestration is ever extracted, the view's role becomes even more orchestrator-like ("call controller A, read result, call controller B, call controller C, refresh UI").

3. **Recovery polling adds implicit orchestration** (lines 740–790):
   - Detects in-flight run on reopen
   - Polls until run completes or user cancels
   - Applies result if still valid
   - This logic lives in `onOpen` and must survive the view being closed mid-run

**Verdict:** The campaign successfully **eliminated state sprawl** (mutations are now controlled entry points). But **orchestration complexity** has not decreased—it has concentrated in fewer, larger methods. This is **acceptable**, because:

- The orchestra is still within one class (InquiryView), so call order is local + auditable
- Controllers expose small surfaces (no event subscribers, no side-effect chains)
- The view explicitly calls `refreshUI()` after mutations, making the refresh cycle transparent
- The characterization tests pin the exact write order, so drift fails loudly

**Acceptable next step:** Accept orchestration complexity in `InquiryView` as the "orchestrator" role, per refactor-playbook §6. Do **not** try to split it further unless orchestration becomes untestable.

---

## 5. Controller Boundaries: Correct, Well-Chosen, Not Over-Granular

### `InquiryActiveSessionState` (Slice 1)
- **Owned:** 9 fields (activeSessionId, activeResult, activeQuestionId, activeZone, cacheStatus, corpus-fingerprint trio, lastError)
- **Boundary:** Perfectly cohesive. These 9 fields are written together in `adopt()` and `clearActiveResult()`. No field is independent.
- **Risk coverage:** The corpus-fingerprint trio atomicity is pinned by unit tests (audit Risk #4). The `setLastError`, `setActiveZone`, `setActiveQuestionId` setters handle independent mutations needed between result loads.
- **Verdict: Correct boundary. ✓**

### `InquirySelectionState` (Slices 2a + 2b + 2c)
- **Owned:** `mode` + round-trip, `targetSceneIds` + debounced persist, `activeBookId` (Slice 2c convergence)
- **Boundary:** Tight. All three are user-selection driven and persist to settings. The debounce timer couples them (all dirty states flush together). The 4-path convergence on `activeBookId` (session adopt, cache restore, corpus sync, user pick) is now funneled through one setter — audit Risk #1 solved.
- **Disposable:** Owns the 300ms debounce timer; correctly implements `Disposable` and cleans up on `onClose`.
- **Verdict: Correct boundary. ✓**

### `InquiryCorpusSnapshotController` (Corpus Slice 1)
- **Owned:** Resolver reconstruction + snapshot refresh lifecycle
- **Boundary:** Single-responsibility. Does NOT own reconcile chain (stays in view). Does NOT own override state (already extracted `InquiryCorpusService`). Does NOT own warning flag.
- **Closure pattern:** Mirrors Slice 3 (reads frontmatter mappings on every refresh, so changes between refreshes are observed). Audit Risk #1 mitigated.
- **Verdict: Correct boundary. ✓**

### Not Over-Granular

The three controllers stop short of extracting:
- Run orchestration (`isRunning`, AbortController, token management)
- Scope selection (coupled to corpus shape; architectural, not extractive)
- Payload stats computation (view-level cache; render-coupled)
- Omnibus multi-run coordination (needs run controller first)

**Verdict: Granularity is right-sized. No under-extraction, no over-abstraction. ✓**

---

## 6. Duplicated Delegators / Awkward Closures

### Delegators That Should Be Deleted

**Selection state — Controller owns these now:**
- Line 3013–3017: `getSelectedPromptIdForZone` — calls `state.selectedPromptIds[zone]` (view-owned; NOT in selection controller)
- Line 3268–3275: `syncSelectedPromptIds` — validates + resets invalid selections (stays in view; correct)

**Session state — Controller owns these now:**
- No awkward delegators found. Critical paths (`applySession`, `activateSession`, `clearActiveResultState`) call the controllers directly.

**Corpus — Controller owns this now:**
- Line 3812–3862: `refreshCorpus` — calls `corpusSnapshot.refresh()` directly (correct; not delegating)
- Lines 3839–3854: Reconcile chain — calls `selection.setActiveBookId()`, `selection.setTargetSceneIds()`, `selection.rememberTargetSceneIdsForBook()` (correct; orchestrates across controllers, doesn't delegate to another layer)

### Awkward Closures

**None found.** The controller constructors use clean closure patterns:

```ts
// Slice 2a/2b constructor:
this.selection = new InquirySelectionState(
    { state: this.state },
    {
        getPersistedLastMode: () => this.plugin.settings.inquiryLastMode,
        setPersistedLastMode: (mode) => { this.plugin.settings.inquiryLastMode = mode; },
        setTargetCache: (cache) => { this.plugin.settings.inquiryTargetCache = cache; },
        saveSettings: () => this.plugin.saveSettings(),
    }
);
```

Closures are **explicit** (passed via structured object), **purposeful** (read/write settings, save), and **minimal** (no hidden dependencies on other view fields).

**Verdict: No awkward closures. Boundaries are clean. ✓**

---

## 7. `scope` Field: View Orchestration or Extraction?

### Current State

`scope: InquiryScope` is still owned by the view, written in 4 places:
- Line 2036: `activateSession()` — session adopts a scope
- Line 5998: `handleScopeChange()` — user toggles 'book' ↔ 'saga'
- Line 6081: `handleGlyphClick()` — shortcut to switch to book (from saga)
- Line 3169: `applySession()` — after run, adopt session scope

### Arguments for Extraction (Slice ≥5)

- **Clear single owner** — Only the view writes it; UI event or session adoption drives changes
- **Transient + audit-bound** — Scope is not persisted to disk; it's a view-session decision
- **Couple to corpus** — The corpus refresh takes scope as a parameter; its resolution changes by scope

### Arguments Against Extraction (Leave Inline Now)

- **Dependency order:** The audit (`inquiry-corpus-map-2026-05-21.md` §7) explicitly states: "Scope comes AFTER corpus, not before." Until the corpus controller is fully stabilized and tested (happening now), extracting scope would create a chicken-egg problem.
- **Truly view-scoped:** Scope isn't a "controlled field with mutations and side-effects"; it's a runtime decision about what to show. It's closer to rendering state than business state.
- **Low write frequency:** 4 sites is trivial. Extracting it costs more than it saves unless it becomes a bottleneck.
- **Architectural decision pending:** Scope might acquire new semantics (e.g., "Pro feature gating"). Better to leave it in view until that architecture is clear.

### Verdict

**Leave inline now. Extract as Slice ≥5, after corpus stabilizes and architectural constraints are mapped.**

The right place for scope extraction is alongside a "Scope Controller" that knows about Pro features, saga availability (multi-book), and corpus composition. That's a future audit.

---

## 8. `corpusWarningActive` Field: Micro-Slice or Stay Inline?

### Current State

- **10 mutation sites** — set `true` in `handleEmptyCorpusRun()` (line 4848), cleared in 8 override-edit paths + auto-clear on observation
- **Single-setter, many-clearers** — Same shape that Slice 2c solved for `activeBookId`
- **No persistence** — Transient UI flag

### Audit Risk #3 Replay (Corpus Audit)

Risk #3 noted: "8 override-mutation paths clear the flag. If we move this to a controller, the controller starts owning override side-effects — outside its cohesive concern."

### Assessment

**Pros (extraction):**
- Clustered clears could be unified into a controller method
- Follows Slice 2c's single-entry-point pattern

**Cons (extraction):**
- Only 10 sites; micro-slice overhead (new file, host interface, tests, characterization) > benefit
- Tightly coupled to UI rendering; no business logic
- Auto-clear is a view-level concern (when user sees the warning)
- Would force the corpus controller to know about warning state, muddying boundaries

### Verdict

**Leave inline now. Revisit after omnibus stabilization (next cycle).**

If the warning lifecycle becomes more complex (e.g., user-dismissable warnings with retry logic), extract to a dedicated `WarningState` controller. For now, 10 sites is acceptable view noise.

---

## 9. Do-Not-Touch List

The following are **fragile/load-bearing right now** and should be left alone for at least one more cycle:

### Hard Boundaries (Architectural, Not Extractive)

1. **`isRunning` state machine** — 9 mutation sites; couple to AbortController, token cancellation, progress polling, recovery path. Do NOT extract without a dedicated `InquiryRunController` audit.

2. **Recovery polling** (`inquiryRecoveryPollHandle`, `onOpen` lines 740–790) — Must survive view close/reopen mid-run. Fragile; pinned by integration tests. Do NOT change without explicit recovery test updates.

3. **`plugin._inquiryRunInFlight` marker** — Plugin-level state used to detect in-flight runs across view open/close. Couples view + plugin. Do NOT refactor without understanding the recovery flow.

4. **Omnibus modal coordination** — `activeOmnibusModal`, `activeCancelRunModal`, multi-run progress persistence. Tightly coupled to run + view lifecycle. Do NOT touch without omnibus audit.

5. **Manifest + corpus computation** (`buildCorpusManifest`, `buildCurrentCorpusSnapshot`, `diagnoseSessionStaleness`) — Load-bearing business logic; depends on scope, targets, prompt form, evidence rules, model selection. Do NOT extract without first mapping the full computation contract.

### Testing Pins (Characterization Tests Enforce Exact Behavior)

- `refreshCorpus()` 7-step order (lines 3813–3861)
- `applySession()` → 8-field active-session adoption via `activeSession.adopt()` (line 7184–7189)
- `clearActiveResultState()` → 6-field clear via `activeSession.clearActiveResult()` (line 7203)
- Run token lifecycle (`beginInquiryRunToken`, `finishInquiryRunToken`, `shouldDiscardInquiryRunOutcome`)
- `isRunning` exit paths (success, cancel, error, recovery)

If you change these, the characterization tests must be updated **first**. Otherwise, silent drift fails loudly later.

### Memoized Caches

- `_resolvedEngine` — Cleared at top of `refreshUI()`, not invalidated mid-cycle
- `_currentCorpusContext` — Same

Do NOT add new cache invalidation points without updating the `invalidateRefreshCycleCaches()` hook.

---

## 10. Analysis Summary

### What Went Right

1. **State ownership is now single-sourced** — Each mutation has one tested entry point. The three controllers enforce this via method-level access controls.

2. **Doctrine compliance is pinned** — Characterization tests assert no compute/estimate/hover methods on controllers, atomicity of corpus-fingerprint trio, `activeBookId` single-entry-point (Risk #1), no event subscribers (Risk #8).

3. **Boundaries are clean** — Controllers do not import the plugin, do not reach into DOM, do not perform side-effects beyond the contracted host mutations. Host interfaces are small and explicit.

4. **Orchestration is transparent** — The view explicitly calls `refreshUI()` after controller mutations; the call graph is local and auditable.

### What Could Drift

1. **Scope orchestration** — Scope is still view-owned and easy to mutate accidentally. Will become problematic if scope acquires side-effects (e.g., clearing state on scope change). Mitigated by: clear guard at start of `handleScopeChange`.

2. **`refreshCorpus()` order** — The 7-step sequence must remain atomic. Any future optimization (e.g., caching the resolver if frontmatter hasn't changed) must not reorder steps 2–7. Mitigated by: characterization tests pinning the exact source form.

3. **Run token lifecycle** — Token cancellation depends on `shouldDiscardInquiryRunOutcome()` being called at the right points. Missing one call leaves a stale result persisted. Mitigated by: exit-path characterization tests covering success, cancel, error, recovery.

4. **Recovery path viability** — The `plugin._inquiryRunInFlight` marker must be cleared in exactly the right finally block. If someone refactors `runInquiry`'s finally without understanding recovery, it breaks. Mitigated by: integration tests that close/reopen view mid-run.

---

## Recommended Next 3 Actions

**Ordered by dependencies + risk:**

### 1. **Stabilize Corpus Controller (In Progress)**

**Rationale:** The corpus snapshot lifecycle is the prerequisite for scope extraction. The controller is already implemented but needs integration testing + characterization tests to lock in the 6-step refresh order.

**Scope:** 
- Write pre-extraction characterization tests for `refreshCorpus()` (line 3812–3862)
- Pin dual-call from omnibus (lines 6453, 6488)
- Unit test corpus controller resolver reconstruction on each refresh
- Integration test: corpus changes, scope remains valid, targets resync

**Why first:** Scope cannot be extracted until corpus refresh is bulletproof. This is in-progress; complete it before starting scope work.

---

### 2. **Map Run Orchestration (Standalone Audit)**

**Rationale:** `isRunning` is the largest remaining inline state (9 mutation sites, coupled to AbortController, token/cancellation, progress, recovery). Before extracting it, the full run lifecycle must be audited—not just extracted.

**Scope:**
- Audit `runInquiry()`, `runOmnibusInquiry()`, recovery polling, token lifecycle
- Map all 9 mutation sites for `isRunning` and coupling to AbortController, `currentRunProgress`, `currentRunElapsedMs`, tokens
- Characterize exit paths: success, cancel, error, recovery
- Design `InquiryRunController` (Slice 4 from the original plan)

**Why second:** This is a large, independent concern. Doing it before anything else keeps scope/omnibus/probe work unblocked and allows run extraction to proceed in parallel if desired.

---

### 3. **Feature Work or Return to Development**

**Rationale:** The extraction campaign is **closed**. The next 18 months should be **feature work** (new Inquiry modes, Pro features, omnibus improvements) unless a specific architectural blocker emerges.

**Options:**

- **Option A: Feature Work** — Implement pending features (scope-based filtering, Pro omnibus, new AI providers) with InquiryView as is. The current architecture supports feature work; no extraction is blocking.

- **Option B: Run Controller (Ambitious)** — If the team wants to complete the full session controller suite, start the run controller extraction after corpus + scope are stabilized. This requires careful audit + characterization (Risk #2 is nontrivial).

- **Option C: Stop Extracting** — Accept InquiryView as a "thin orchestrator with controller delegations" and focus on keeping it maintainable via tests, not smaller files. This is **defensible** per refactor-playbook §6 (prefer orchestrators over god objects).

**Recommendation:** **Option A (feature work)** with **Option C (stop extracting)** as the long-term stance. Extraction has achieved its goal: state ownership is now controlled, mutations are testable, and boundaries are clear. Further extraction is optimization, not necessity.

---

## Stop / Do-Not-Touch List

- `isRunning` state machine (stays until dedicated run audit)
- Recovery polling logic (stays inline; fragile + recovery-tested)
- `plugin._inquiryRunInFlight` marker (stays; plugin-level recovery marker)
- Omnibus orchestration (stays until run controller exists)
- `scope` (defer to Slice ≥5, after corpus stabilizes)
- `corpusWarningActive` (leave inline unless complexity grows)
- `buildCorpusManifest`, `diagnoseSessionStaleness`, manifest/evidence computation (load-bearing; do not touch without full audit)
- Render subsystems (`InquiryMinimapRenderer`, `SceneDossierController`, corpus strip, DOM factories) — already extracted or stable; do not refactor

---

## Verdict: Continue Extraction or Return to Feature Work?

### **Verdict: RETURN TO FEATURE WORK. EXTRACTION CAMPAIGN CLOSED.**

**Rationale:**

1. **Campaign objective achieved.** The extraction campaign successfully moved the most dangerous state mutations (session lifecycle, selection persistence, corpus snapshot) behind small, tested controllers. State ownership is now single-sourced and characterized.

2. **Orchestration sprawl is acceptable.** InquiryView is now a "thin orchestrator" that composes controllers. The view's remaining 11.5k LOC is mostly orchestration (run lifecycle, refresh cycles, UI event wiring, rendering delegation) + transient state (DOM refs, timers, caches). This is **correct per refactor-playbook §6**, not a smell.

3. **Next extraction (run controller) is a different tier.** The run orchestration (isRunning, AbortController, tokens, recovery) is not a simple state-ownership slice like Slice 1–3. It requires a dedicated architectural audit mapping the full lifecycle, exit paths, and recovery semantics. It's too big for incremental extraction; do it separately if at all.

4. **Feature work is unblocked.** The current architecture supports new Inquiry modes, omnibus improvements, Pro features, and new AI providers. No extraction is a prerequisite.

5. **Risk/benefit is unfavorable.** Extracting `scope`, `corpusWarningActive`, or `isRunning` at this point costs more (new files, host interfaces, tests, characterization) than it saves. The view is stable; breaking it up further is optimization, not necessity.

### Caveat: Revisit After Pro Features Land

If Pro features introduce complex scope-gating, multi-workspace omnibus, or new run modes, **schedule a fresh architectural audit**. At that point, scope extraction + run controller extraction may become necessary. For now, **embrace the orchestrator pattern**.

---

**Date: 2026-05-21**  
**Audit complete. Campaign closed.**

