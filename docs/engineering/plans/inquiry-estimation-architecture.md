# Inquiry Estimation Architecture Audit

## Status: Active reference

Point-in-time audit of all estimation/context paths through Inquiry as of March 2026. The map's structure is still useful for debugging discrepancies between settings forecast and view preview; specific function names may have drifted. Re-verify before acting.

## Part 1 — Map of All Current Estimate / Context Computation Paths

### 1.1 Token Estimation

| # | Surface | File | Function | What It Computes | Data Source | Async | focusBookId? |
|---|---------|------|----------|------------------|-------------|-------|-------------|
| T1 | **Settings forecast** | `estimateTokensFromVault.ts` | `estimateInquiryTokens()` | Token estimate for vault-level forecast pill | Builds own corpus from `selectInquiryFiles()`, then optionally calls `prepareRunEstimate()` for precise count | Yes | Yes (after recent fix) |
| T2 | **Inquiry View — heuristic preview** | `InquiryView.ts` | `getTokenEstimateForQuestion()` | Quick heuristic token estimate from cached payload stats | `getPayloadStats()` → `evidenceChars` / 4 + overhead | No | Yes (via payloadStats which filters) |
| T3 | **Inquiry View — precise preview** | `InquiryView.ts` | `requestPayloadEstimate()` | Precise estimate via runner trace | Calls `runner.buildTrace()` → `buildEvidenceBlocks()` (filtered) → `buildTokenEstimate()` → `prepareRunEstimate()` | Yes | Yes |
| T4 | **Inquiry View — readiness** | `InquiryView.ts` | `buildReadinessUiState()` | Token estimate + readiness evaluation | Reads from `getTokenEstimateForQuestion()` (T2 or cached T3) | No | Yes (inherited) |
| T5 | **Runner — pre-run trace** | `InquiryRunnerService.ts` | `buildInitialTrace()` → `buildTokenEstimate()` | Precise token estimate for actual dispatch | Builds evidence blocks from manifest (filtered by focusBookId), calls `prepareRunEstimate()` | Yes | Yes |
| T6 | **Runner — packaging precheck** | `InquiryRunnerService.ts` | `getPackagingPrecheck()` | Determines if multi-pass needed | Calls `prepareRunEstimate()` with evidence blocks | Yes | Yes |

### 1.2 Corpus / Evidence Selection

| # | Surface | File | Function | What It Selects | focusBookId? |
|---|---------|------|----------|-----------------|-------------|
| C1 | **Settings forecast** | `estimateTokensFromVault.ts` | `selectInquiryFiles()` | Raw TFile list from vault scan | Yes (after recent fix) |
| C2 | **Inquiry View — UI corpus** | `InquiryCorpusResolver.ts` | `resolve()` | `InquiryCorpusSnapshot` (books, scenes, activeBookId) for minimap/scene list | Yes |
| C3 | **Inquiry View — manifest** | `InquiryView.ts` | `buildCorpusManifest()` → `buildCorpusEntryList()` | `CorpusManifest` (entries + fingerprint + classCounts) | **No** — includes all included books |
| C4 | **Inquiry View — payload stats** | `InquiryView.ts` | `buildPayloadStats()` | Filtered scene/outline/reference counts + char estimates | Yes (filters manifest by focusBookId) |
| C5 | **Runner — evidence blocks** | `InquiryRunnerService.ts` | `buildEvidenceBlocks()` | Actual `EvidenceBlock[]` sent to AI | Yes |
| C6 | **Inquiry Log — corpus TOC** | `InquiryView.ts` | `buildManifestTocLines()` | TOC written to log file | Yes (after recent fix — `filterManifestForLog()`) |

### 1.3 Model / Context Resolution

| # | Surface | File | Function | What It Resolves |
|---|---------|------|----------|------------------|
| M1 | **Canonical engine resolver** | `inquiryModelResolver.ts` | `resolveInquiryEngine()` | Provider, model, contextWindow, maxOutput, policySource |
| M2 | **Settings capacity preview** | `AiSection.ts` | calls `prepareRunEstimate()` | `effectiveInputCeiling`, `maxOutputTokens` via `computeCaps()` |
| M3 | **Inquiry View — readiness** | `InquiryView.ts` | `buildReadinessUiState()` | `safeInputBudget` — from cached `effectiveInputCeiling` (T3) or fallback `computeCaps()` |
| M4 | **Runner dispatch** | `aiClient.ts` | `prepareRunEstimate()` | `effectiveInputCeiling` = `floor(caps.maxInputTokens * 0.9)` |
| M5 | **Settings forecast** | `estimateTokensFromVault.ts` | `estimateInquiryTokens()` → `prepareRunEstimate()` | Uses `prepareRunEstimate()` if plugin/provider available |

### 1.4 Safe Input Ceiling

The safe ceiling is: `floor(contextWindow × safeUtilization × INPUT_TOKEN_GUARD_FACTOR)`.

| # | Surface | Source | Notes |
|---|---------|--------|-------|
| S1 | **Settings "Safe input (per pass)"** | `prepareRunEstimate()` → `estimate.effectiveInputCeiling` | Authoritative — computed from `computeCaps()` |
| S2 | **Inquiry popover** | `buildReadinessUiState()` → `safeInputBudget` | From cached `effectiveInputCeiling` (if precise estimate ran), else falls back to local `computeCaps()` |
| S3 | **Runner guard** | `aiClient.run()` → `effectiveInputCeiling` | Same `computeCaps()` path as S1 |
| S4 | **Advisory** | `inquiryAdvisory.ts` | Receives `safeInputBudget` as parameter from readiness |

### 1.5 Pass Expectation / Readiness

| # | Surface | File | Function |
|---|---------|------|----------|
| P1 | **Inquiry readiness strip** | `readiness.ts` | `evaluateInquiryReadiness()` — determines ready/large/blocked |
| P2 | **Inquiry pass indicator** | `readiness.ts` | `buildPassIndicator()` — shows pass marks in UI |
| P3 | **Settings forecast pills** | `AiSection.ts` | `formatForecastPasses()` — local `ceil(tokens / safeBudget)` |
| P4 | **Advisory pass count** | `inquiryAdvisory.ts` | `estimatePassCount()` — `ceil(tokens / safeBudget)` |
| P5 | **Runner packaging precheck** | `InquiryRunnerService.ts` | `getPackagingPrecheck()` — `tokenEstimate > effectiveInputCeiling` |

---

## Part 2 — Divergence Points

### D1: Settings Inquiry forecast (T1) vs Inquiry View payload estimate (T3)
**Status: B — still possible**

Settings `estimateInquiryTokens()` builds its **own corpus** via `selectInquiryFiles()`. Inquiry View `requestPayloadEstimate()` builds its corpus via `buildCorpusManifest()` → `buildEvidenceBlocks()`.

These are two completely independent corpus-building pipelines. They share no code. They differ:
- `selectInquiryFiles()` applies scope/book filtering at the file level, then iterates files building evidence blocks inline.
- `buildCorpusEntryList()` scans vault files with class/scope/override logic, then `buildEvidenceBlocks()` filters by focusBookId and reads content.
- Settings knows no overrides (no `corpusClassOverrides`, no item overrides).
- Settings has no focusBookId from InquiryView state (uses first book fallback).
- Mode resolution in Settings (`resolveInquiryModeForClass`) vs InquiryView (class configs + overrides) can diverge.

**Verdict: Should be eliminated.**

### D2: Inquiry View heuristic (T2) vs Inquiry View precise (T3)
**Status: C — structurally unavoidable, but managed**

`getTokenEstimateForQuestion()` first returns a heuristic (chars/4), then gets replaced when `requestPayloadEstimate()` completes and caches the trace-based estimate into `payloadStats.tokenEstimate`. Until the async call completes, the readiness UI shows the heuristic.

**Verdict: Acceptable. The heuristic is a fast preview; the precise estimate arrives async and replaces it.**

### D3: Corpus manifest (C3) vs evidence blocks (C5)
**Status: A — fixed (for logs)**

The manifest includes all books. `buildEvidenceBlocks()` filters by focusBookId. Logs now use `filterManifestForLog()`. But **the manifest's `classCounts` and fingerprint still reflect all books**, which affects cache key computation and any UI reading manifest counts directly.

**Verdict: Partially fixed. The manifest itself is still not scope-filtered, causing stale data in any surface that reads `manifest.classCounts`.**

### D4: Settings safe ceiling (S1) vs Inquiry View safe ceiling (S2)
**Status: B — still possible**

Settings calls `prepareRunEstimate()` directly with provider/policy overrides. Inquiry View reads `effectiveInputCeiling` from the cached trace estimate (T3), or falls back to local `computeCaps()`. These use the same underlying math, BUT:
- They can compute at different times (settings opened vs inquiry active).
- If the user changes AI settings while Inquiry View is open, the cached `effectiveInputCeiling` is stale until `requestPayloadEstimate()` re-fires.

**Verdict: Should be eliminated — both should read the same resolved value.**

### D5: Settings pass expectation (P3) vs Inquiry readiness (P1)
**Status: B — still possible**

Settings computes `ceil(forecastTokens / safeBudgetTokens)`. Inquiry readiness computes `estimatedInputTokens > safeInputBudget`. These use different token estimates (D1) and potentially different safe ceilings (D4), so they can show different pass counts.

**Verdict: Should be eliminated — downstream of fixing D1 and D4.**

### D6: Model in popover vs model at dispatch
**Status: C — structurally unavoidable, minimal risk**

If settings change between popover render and actual run, the model could differ. The run captures its own `preparedEstimate` at dispatch time, so it's always self-consistent. The popover is a preview.

**Verdict: Acceptable. No fix needed. The run is authoritative.**

### D7: Log corpus vs dispatched evidence
**Status: A — fixed**

`filterManifestForLog()` now scopes the manifest before writing to logs.

**Verdict: Fixed.**

---

## Part 3 — Should Inquiry Use a Single Source of Truth?

**Yes.**

The core problem is that three independent pipelines build their own corpus and estimate tokens:

1. **Settings** — `estimateInquiryTokens()` with `selectInquiryFiles()` (its own file scan + its own evidence assembly)
2. **Inquiry View** — `buildCorpusManifest()` + `buildPayloadStats()` + `requestPayloadEstimate()` (its own manifest + runner trace)
3. **Runner** — `buildEvidenceBlocks()` + `buildTokenEstimate()` (the actual dispatched corpus)

Pipeline 3 is authoritative. Pipelines 1 and 2 are approximations that attempt to predict pipeline 3's output but diverge because they use different code paths.

### The Shared Truth Object

For a given Inquiry state snapshot (scope + focusBookId + overrides + engine), the truth object should contain:

```
InquiryEstimateSnapshot {
    // Identity
    scope: InquiryScope
    focusBookId: string | undefined
    corpusFingerprint: string

    // Corpus
    sceneCount: number
    outlineCount: number
    referenceCount: number
    evidenceChars: number
    evidenceMode: 'none' | 'summary' | 'full' | 'mixed'

    // Engine
    provider: AIProviderId
    modelId: string
    contextWindow: number

    // Budget
    effectiveInputCeiling: number        // the safe window
    maxOutputTokens: number

    // Estimate
    estimatedInputTokens: number
    estimationMethod: TokenEstimateMethod
    uncertaintyTokens: number

    // Pass expectation
    expectedPassCount: number
    fitsInSinglePass: boolean

    // Metadata
    generatedAt: number
    stale: boolean                       // true if inputs changed since generation
}
```

### Consumers

**Should read from it:**
- Engine popover (token estimate, safe ceiling, pass expectation)
- Readiness strip (readiness state derived from snapshot)
- Payload stats display (scene/outline counts, evidence mode)
- Advisory service (receives estimate + ceiling as input)
- Inquiry logs (corpus counts, token estimate)
- Settings forecast (for Inquiry pill — reads or triggers generation)

**Should NOT be part of the truth object (presentation-only):**
- Readiness state string ("Ready", "Multi-pass", "Exceeds limits") — derived from snapshot
- Pressure ratio / pressure tone — derived from snapshot
- Advisory recommendation — derived from snapshot + alternative models
- Pass indicator marks — derived from snapshot

---

## Part 4 — Evaluate `prepareRunEstimate()`

### What it already computes

| Field | Provided? |
|-------|-----------|
| Model resolution | Yes — full `ModelInfo` + selection reason |
| Context window | Yes — via resolved model |
| Safe input ceiling (`effectiveInputCeiling`) | Yes — `computeCaps().maxInputTokens * 0.9` |
| Max output tokens | Yes |
| Token estimate (input) | Yes — heuristic or Anthropic count |
| Estimation method | Yes |
| Uncertainty | Yes |
| System/user prompt | Yes |
| Temperature, topP, etc. | Yes |

### What it does NOT know

| Field | Missing? | Why |
|-------|----------|-----|
| Inquiry scope | Not its concern — caller provides evidence |
| focusBookId | Not its concern — caller provides evidence |
| Corpus counts (scenes, outlines) | Not its concern — operates on pre-built evidence |
| Corpus fingerprint | Not computed |
| Evidence mode (body/summary/mixed) | Not tracked |
| Pass expectation | Not computed — caller derives from ceiling vs estimate |
| Stale flag | Not tracked |

### Assessment

`prepareRunEstimate()` is a **model-layer** function. It resolves the engine, computes caps, and estimates tokens for a given prompt. It is correct for its level of abstraction.

It should NOT be promoted to the shared truth source because:
1. It has no knowledge of Inquiry corpus semantics (scope, books, overrides).
2. It requires a fully-built prompt as input — it cannot trigger corpus assembly.
3. It is async and expensive (may call Anthropic token-count API).
4. Settings would need to build an entire fake prompt just to call it, which is what `estimateInquiryTokens()` already does awkwardly.

### Recommendation: **Wrap it, don't elevate it.**

`prepareRunEstimate()` should remain the model-layer estimator. A new Inquiry-layer function should own corpus assembly + scope filtering + calling `prepareRunEstimate()` + packaging the result into `InquiryEstimateSnapshot`. All surfaces read the snapshot.

---

## Part 5 — Ownership Boundaries

### Canonical AI Strategy Settings
**Owner:** `aiSettings` (persistent)
- Provider selection
- Model policy (pinned / latestPro / latestStable)
- Access tier per provider
- Analysis packaging preference (automatic / singlePassOnly / segmented)
- Feature profile overrides
- Temperature/topP overrides

### Inquiry Persistent Settings
**Owner:** `inquirySources` + `inquiryClassConfigs` (persistent)
- Scan roots
- Book inclusion/exclusion
- Class configs (scene bookScope=full, outline bookScope=full, etc.)
- Class scope whitelist

### Inquiry Ephemeral View State
**Owner:** `InquiryView.state` (session-lived)
- scope ('book' | 'saga')
- focusBookId
- focusSceneId
- mode ('flow' | 'depth')
- activeQuestionId
- corpusClassOverrides (user toggle overrides)
- corpusItemOverrides (user toggle overrides)

### Shared Prepared Estimate Truth
**Owner:** New `InquiryEstimateSnapshot` (derived, cached, invalidated on input change)
- Derived from: AI Strategy + Inquiry Settings + View State
- Contains: corpus counts + engine + ceiling + token estimate + pass expectation
- Invalidated when: scope changes, focusBookId changes, overrides change, AI settings change, vault files change (manifest fingerprint)
- Built by: a single function that assembles corpus → builds evidence → calls `prepareRunEstimate()` → packages snapshot

**What must NOT happen:**
- Settings building its own independent Inquiry file scan (currently does via `estimateInquiryTokens`)
- Multiple surfaces each calling `computeCaps()` independently
- Logs reading unfiltered manifest counts
- Readiness using a heuristic when a precise estimate is available

---

## Part 6 — Migration Plan

### Phase 1: Unify model + context ceiling (low risk)

**Goal:** All surfaces read the same engine and safe ceiling.

**Changes:**
1. `InquiryView` already calls `resolveInquiryEngine()` — this is canonical. No change needed.
2. Settings forecast should use the same `resolveInquiryEngine()` instead of its own `prepareRunEstimate()` for model display. Currently it does this correctly (same function). Confirmed no divergence on model.
3. Safe ceiling: Both Settings and InquiryView compute via `computeCaps()` with `INPUT_TOKEN_GUARD_FACTOR`. These already agree IF the same provider/model/tier is used. The divergence risk is timing-based only.

**Action:** No code change needed for Phase 1. Model and ceiling are already unified.

### Phase 2: Unify corpus selection (medium risk)

**Goal:** Settings forecast uses the same corpus as Inquiry View, not its own.

**Current problem:** `estimateInquiryTokens()` in `estimateTokensFromVault.ts` builds its own corpus via `selectInquiryFiles()`. This is a completely separate code path from `buildCorpusEntryList()` + `buildEvidenceBlocks()`.

**Option A — Expose `buildPayloadStats` from InquiryView:**
Settings reads the Inquiry View's `payloadStats.evidenceChars` and applies its own `chars/4` heuristic. This eliminates the independent file scan but couples Settings to InquiryView being open.

**Option B — Extract shared corpus builder:**
Factor out the corpus-filtering logic from `buildCorpusEntryList` into a pure function that both Settings and InquiryView call. Both produce the same entries from the same inputs.

**Option C — Settings uses snapshot:**
Settings reads the `InquiryEstimateSnapshot` if available, falls back to vault forecast if Inquiry has never run. This is pragmatic: Settings shows the best available data.

**Recommended: Option C** — Settings shows snapshot data when available, vault forecast as fallback. The vault forecast (`estimateInquiryTokens`) remains for first-open scenarios but is understood to be approximate.

**Changes:**
1. Add `InquiryEstimateSnapshot` type.
2. InquiryView computes and caches snapshot on scope/book/engine change.
3. Expose snapshot via plugin-level accessor (e.g., `plugin.getInquiryEstimateSnapshot()`).
4. Settings reads snapshot if available; falls back to `estimateInquiryTokens()`.
5. Mark `estimateInquiryTokens()` as approximate/fallback in comments.

### Phase 3: Unify token estimate + pass expectation (medium risk)

**Goal:** One estimate computation, one pass count.

**Changes:**
1. `InquiryEstimateSnapshot` is built by a single async function: `buildInquiryEstimateSnapshot()`.
2. This function:
   - Reads scope, focusBookId, overrides from InquiryView state
   - Builds corpus manifest (existing `buildCorpusManifest()`)
   - Builds evidence blocks (via `runner.buildTrace()` — already does this)
   - Extracts: token estimate, effective ceiling, corpus counts, pass expectation
   - Packages into snapshot
3. `buildReadinessUiState()` reads from snapshot instead of calling `getTokenEstimateForQuestion()`.
4. Engine popover reads from snapshot.
5. Advisory reads from snapshot.
6. `requestPayloadEstimate()` becomes the snapshot builder.
7. `getTokenEstimateForQuestion()` becomes the fast heuristic fallback (before snapshot is ready).

**Key constraint:** The snapshot builder is async. UI must show heuristic until async completes. This is already the pattern (`getTokenEstimateForQuestion` → heuristic, then `requestPayloadEstimate` → precise). The change is formalizing this into a typed snapshot.

### Phase 4: Unify logs and popover consumption (low risk)

**Goal:** Logs and popover read snapshot, not raw manifest.

**Changes:**
1. Logs already use `filterManifestForLog()`. Migrate to reading snapshot counts when available.
2. Popover already reads from `buildReadinessUiState()`. After Phase 3, this reads snapshot. Done.
3. Settings forecast pill reads snapshot when available (Phase 2).

### Phase 5: Lock consistency with tests

**Tests to add:**
1. **Corpus parity test:** Given identical inputs (scope, focusBookId, settings), verify that `selectInquiryFiles` and `buildCorpusEntryList` + focusBookId filtering produce the same file set.
2. **Ceiling parity test:** Given identical engine settings, verify that Settings and InquiryView compute the same `effectiveInputCeiling`.
3. **Snapshot staleness test:** Verify snapshot is invalidated when scope, focusBookId, or engine changes.
4. **Log accuracy test:** Verify log corpus counts match dispatched evidence block counts.

---

## Part 7 — Summary

### 1. Map of computation paths
See Part 1 tables above. Six token estimation paths, six corpus selection paths, five model resolution paths, five pass expectation paths.

### 2. Divergence points
- **D1** (Settings vs Inquiry estimate): Still possible — independent corpus pipelines. **Should be eliminated.**
- **D2** (Heuristic vs precise): Structurally unavoidable. **Acceptable.**
- **D3** (Manifest vs evidence): Partially fixed (logs). Manifest classCounts still unfiltered. **Should be eliminated.**
- **D4** (Settings ceiling vs Inquiry ceiling): Still possible — timing-based. **Should be eliminated.**
- **D5** (Settings pass vs Inquiry pass): Downstream of D1+D4. **Should be eliminated.**
- **D6** (Popover model vs dispatch model): Structurally unavoidable. **Acceptable.**
- **D7** (Log corpus vs dispatched): Fixed. **Done.**

### 3. Single source of truth needed?
**Yes.** An `InquiryEstimateSnapshot` that packages corpus counts + engine + ceiling + token estimate + pass expectation, built from the canonical corpus pipeline.

### 4. Recommended owner
A new function `buildInquiryEstimateSnapshot()` — lives in InquiryView (or extracted service), wraps `runner.buildTrace()` + packages result. `prepareRunEstimate()` remains the model-layer estimator called by the runner.

### 5. Phased migration
Phase 1: Confirm model/ceiling already unified (done).
Phase 2: Settings reads snapshot when available, vault forecast as fallback.
Phase 3: InquiryView builds snapshot; readiness/popover/advisory read from it.
Phase 4: Logs consume snapshot.
Phase 5: Tests.

### 6. Files likely to change
- `src/inquiry/InquiryView.ts` — snapshot builder, readiness, popover, logs
- `src/ai/forecast/estimateTokensFromVault.ts` — mark as fallback
- `src/settings/sections/AiSection.ts` — read snapshot when available
- `src/inquiry/runner/types.ts` — `InquiryEstimateSnapshot` type
- `src/inquiry/services/readiness.ts` — consume snapshot
- `src/inquiry/services/inquiryAdvisory.ts` — consume snapshot

### 7. Risks / edge cases
- **Cold start:** When Inquiry View has never opened, no snapshot exists. Settings must fall back to vault forecast. This is acceptable but should be documented.
- **Stale snapshot:** If AI settings change while Inquiry View is backgrounded, snapshot is stale. Need invalidation on settings change (already partially handled by fingerprint checks).
- **Async gap:** Between heuristic preview and precise snapshot, UI shows approximate data. This is the current behavior and is acceptable.
- **Corpus override complexity:** User toggles (corpusClassOverrides, corpusItemOverrides) change the effective corpus. Snapshot must be invalidated when these change.
- **Manifest fingerprint scope:** The manifest fingerprint currently includes all books. If we scope the manifest to focusBookId, switching books changes the fingerprint. This is correct behavior but will invalidate more caches.
