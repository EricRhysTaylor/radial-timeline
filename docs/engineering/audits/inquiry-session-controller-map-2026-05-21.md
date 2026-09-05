# Inquiry Session Controller — Map-Only Audit

**Date:** 2026-05-21  
**Target:** `src/inquiry/InquiryView.ts` (11,515 LOC)  
**Scope:** Map session-state ownership before any extraction. No production changes.

---

## 1. `this.state` mutation sites

`this.state: InquiryState` (defined at `src/inquiry/state.ts:233`) is initialized at `InquiryView.ts:459` via `createDefaultInquiryState()`. **~80 mutation sites across 16 distinct fields.**

Grouped by field (line numbers in `InquiryView.ts`):

| Field | Mutation sites | Count |
|---|---|---|
| `scope` | 1990, 5964, 6048, 7136, 7208 | 5 |
| `mode` | 643, 5979, 6025, 6036, 7137, 7211 | 6 |
| `selectedPromptIds` | 646, 7212 | 2 |
| `activeBookId` | 1991, 2212, 3795, 3800, 7147, 7210, 8212, 8301 | 8 |
| `targetSceneIds` | 1992, 2213, 2215, 3808, 4029, 4571, 4602, 7150, 7209, 8214 | 10 |
| `activeQuestionId` | 6222, 7138, 7213, 7716 | 4 |
| `activeZone` | 5455, 5482, 6126, 6223, 7139, 7214 | 6 |
| `activeSessionId` | 7152, 7172 | 2 |
| `activeResult` | 7153, 7171 | 2 |
| `isRunning` | 6085, 6228, 6581, 6693, 6722, 6863, 7158, 7215, 7770 | 9 |
| `cacheStatus` | 6200, 6225, 7157, 7176 | 4 |
| `corpusFingerprint` | 7154, 7173 | 2 |
| `corpusOnlyFingerprint` | 7155, 7174 | 2 |
| `corpusManifestSnapshot` | 7156, 7175 | 2 |
| `lastError` | 7216 | 1 |
| `reportPreviewOpen` | 7217, 10894 | 2 |
| `promptFormOverrides` | 7218 | 1 |

**Two write-clusters dominate:**

- **Adopt cluster** (`activateSession` ~lines 7136–7158): co-writes `scope`, `mode`, `activeQuestionId`, `activeZone`, `activeBookId`, `targetSceneIds`, `activeSessionId`, `activeResult`, `corpusFingerprint`, `corpusOnlyFingerprint`, `corpusManifestSnapshot`, `cacheStatus`, `isRunning`. **13 fields written atomically from a session record.**
- **Reset cluster** (`resetState` lines 7208–7218): writes 11 fields back to defaults during fresh-launch / scope-change.
- **Clear-active cluster** (`clearActiveResultState` lines 7171–7176): clears `activeResult`, `activeSessionId`, `corpusFingerprint`, `corpusOnlyFingerprint`, `corpusManifestSnapshot`, `cacheStatus`.

Outside these three clusters, mutations are scattered: user-driven selection changes (`scope`, `mode`, `targetSceneIds`, `activeBookId`), run-orchestration (`isRunning`, `activeZone`), and corpus syncs (`activeBookId`, `targetSceneIds` from corpus resolver).

---

## 2. `this.plugin.settings` read / write sites

**58 reads, 8 distinct write sites.**

### Reads (grouped)

| Setting key | Sites | Purpose |
|---|---|---|
| `inquirySources` | 12 | corpus / scan-roots resolution |
| `books` | 7 | book scope / sequencing |
| `inquiryActionNotesAutoPopulate` | 2 (1520, 7371) | briefing button label + field write |
| `inquiryPromptConfig` | 3 (2898, 2899, 2905) | prompt config seed + normalize |
| `inquiryTargetCache` | 1 (2202) | target-scene cache restore |
| `inquiryLastMode` | 2 (641, 5980) | mode preference read + write |
| `inquiryOmnibusProgress` | 4 (6446, 7001, 7006, 7011) | mid-run progress persistence |
| `inquiryTimingHistory` | 3 (9117, 9172, 9187) | observed-timing telemetry |
| `inquiryCorpusThresholds` | 1 (5228) | corpus thresholds |
| `logApiInteractions` | 2 (6458, 11023) | log gating |
| `aiSettings` | 1 (1391) | validation before use |
| `settingsTab` (handle) | 4 | open settings tab |
| frontmatter mappings | many (via `getActiveFrontmatterMappings(this.plugin.settings)`) | implicit settings read |

### Writes (8)

| Line | Field | When |
|---|---|---|
| 1392 | `aiSettings` | post-validation update |
| 2232 | `inquiryTargetCache` | restore cycle resave |
| 2899 | `inquiryPromptConfig` | first-run seed |
| 5980 | `inquiryLastMode` | mode toggle |
| 7001 | `inquiryOmnibusProgress` | progress checkpoint |
| 7006 | `inquiryOmnibusProgress = undefined` | run complete |
| 7198 | `inquiryTargetCache` | target selection persisted |
| 9187 | `inquiryTimingHistory` | run timing recorded |

All writes are followed by `this.plugin.saveSettings()` somewhere downstream (no orphan writes detected from this map; verify per-site before extraction).

---

## 3. `InquirySessionStore` call sites

**~50 sites against `this.sessionStore` (instance of `InquirySessionStore` from `src/inquiry/InquirySessionStore.ts`).**

| Method | Sites | Category |
|---|---|---|
| `peekSession(key)` | ~12 | read |
| `getSession(key)` | 1 | read |
| `getRecentSessions(n)` | 3 (1484, 8523, 10755) | read |
| `getSessionCount()` | 3 (1732, 5728, 8523) | read |
| `getLatestByBaseKey(baseKey)` | 2 (3067, 6185) | read |
| `getLatestActiveCacheSessionForEngine(...)` | 3 (3674, 9432, 9465) | read |
| `buildBaseKey(input)` | 5 (3052, 6161, 6906, 7735, 10747) | pure key derivation |
| `buildKey(baseKey, fingerprint)` | 3 (3061, 6169, 6914, 7743) | pure key derivation |
| `setSession(session)` | 5 (6354, 6930, 7807, 9480) | write |
| `updateSession(key, patch)` | ~8 (1518, 1611, 1635, 2006, 7399, 7429, 10951, 11030) | write |
| `clearSessions()` | 1 (1797) | write |
| `clearPendingEditsAppliedFlags(...)` | 1 (1848) | write |
| `markStaleByBaseKey(baseKey)` | 1 (6191) | write |
| `reloadFromSettings()` | 2 (750, 771) | recovery |

**Observation:** the store is already well-encapsulated and read-only access is dominant. A session controller does **not** replace the store — it wraps it together with the `this.state` run-tracking subset so the two co-mutate atomically.

---

## 4. Ownership grouping

### Future `InquirySessionController` (active-result lifecycle)

State fields co-written from a session record. Mutate together during `activateSession`, `clearActiveResultState`, and run completion.

- `activeSessionId`, `activeResult`
- `activeQuestionId`, `activeZone`
- `cacheStatus`
- `corpusFingerprint`, `corpusOnlyFingerprint`, `corpusManifestSnapshot`
- `lastError`

Paired store calls: `peekSession`, `getSession`, `setSession`, `updateSession`, `getLatestByBaseKey`, `markStaleByBaseKey`, `buildBaseKey`, `buildKey`, `getLatestActiveCacheSessionForEngine`.

### Future `InquirySelectionState` (view-driven selection)

State fields driven by user UI events; persisted to settings as a side-effect.

- `scope` ↔ no setting (transient + audit-rule-bound)
- `mode` ↔ `plugin.settings.inquiryLastMode`
- `targetSceneIds` ↔ `plugin.settings.inquiryTargetCache.scenesByBookId[*]`
- `activeBookId` ↔ `plugin.settings.inquiryTargetCache.lastBookId`
- `selectedPromptIds`
- `promptFormOverrides`
- `reportPreviewOpen`

### Run orchestration (stays in view for now; future runner facade)

- `isRunning` (9 mutation sites across run start / cancel / error / recovery)
- Coupled to: AbortController, cacheReuseState, retry counters, the `InquiryRunnerService` invocation pattern.
- `activeZone` is partly orchestration (set when a run starts, reverted when cleared) and partly selection.

Plus `plugin.settings.inquiryOmnibusProgress` (mid-run progress persistence) and `plugin.settings.inquiryTimingHistory` (post-run telemetry).

### Settings / service dependency

Largest read surface (12 sites for `inquirySources`, 7 for `books`) is genuinely **corpus configuration**, not session state. Belongs behind a future `InquirySettingsAccessor` facade (or the existing `getActiveFrontmatterMappings` pattern, generalized).

---

## 5. First safe extraction slice

**`InquiryActiveSessionState` — owns the active-result lifecycle subset only.**

Why this slice first:
1. **Tight cohesion** — the 13 fields in the adopt cluster + 6 in the clear cluster are written together, in a small number of methods (`activateSession`, `clearActiveResultState`, run-completion handler).
2. **Few external callers** — outside the three clusters, only `runIsCacheReuseEligible`-style reads access these fields. They can be served by getters.
3. **Doctrine-safe** — does not introduce any new estimate, hover, or recomputation path. Owns persisted state at activation time only (see `inquiry-critical-path-rules.md` §5 and §6).
4. **No new settings surface** — does not need to wrap any `plugin.settings.*` field; persistence stays via `this.sessionStore.setSession` / `updateSession` exactly as today.

**Proposed shape:**

```ts
// src/inquiry/session/inquiryActiveSessionState.ts
export class InquiryActiveSessionState {
    adopt(session: InquirySession, normalized: InquiryResult, cacheStatus: CacheStatus): void;
    clearActiveResult(): void;
    markRunning(isRunning: boolean): void;
    setCacheStatus(status: CacheStatus | undefined): void;
    setActiveZone(zone: InquiryZone | null | undefined): void;
    setActiveQuestionId(id: string | undefined): void;
    setLastError(error: string | undefined): void;
    // Read-only views
    get activeSessionId(): string | undefined;
    get activeResult(): InquiryResult | null | undefined;
    get isRunning(): boolean;
    get cacheStatus(): CacheStatus | undefined;
    // … etc, one getter per owned field
}
```

InquiryView retains the `state: InquiryState` field but those 10 properties become **delegated getters/setters** during the transition (keeps the 80+ read sites unchanged). When extraction is complete, InquiryView's `state` field shrinks to the selection-only subset.

**Expected impact:**
- ~25 mutation sites in `InquiryView.ts` rewritten to call controller methods
- ~30 read sites unchanged (read through delegated getters)
- New file: ~120 LOC source + ~150 LOC test
- InquiryView LOC delta: roughly flat (mutations move out, delegating getters move in), but **mutation paths centralize** — the audit's R1 §4 "single source of truth" criterion becomes locally satisfied for the active-result subset.

---

## 6. Behavior drift risks

| # | Risk | Mitigation |
|---|---|---|
| 1 | **`activeBookId` is mutated by 4 distinct paths** (session adopt, cache restore, corpus sync, user book pick at lines 8212/8301). Putting it in the controller means all 4 paths must flow through the same setter, or selection-side paths will silently desync. | First slice does **not** absorb `activeBookId` — defer to Slice 2 (`InquirySelectionState`). |
| 2 | **`isRunning` flag has 9 mutation sites** across normal-run / cancel / error / recovery paths. Forgetting one exit path → permanently-stuck running UI. | Slice 1 owns this. Write characterization tests for **every** exit path (success, abort, throw, retry, recovery-on-reopen) **before** rewiring. |
| 3 | **`targetSceneIds` setter must co-persist to `inquiryTargetCache`** (lines 7198 area). Splitting "state set" from "cache write" would let them drift. | Defer to Slice 2. When implemented, controller's setter must be the **only** write path; test that user pick + cache restore both produce the same disk-level cache shape. |
| 4 | **Corpus fingerprint trio** (`corpusFingerprint`, `corpusOnlyFingerprint`, `corpusManifestSnapshot`) must always be written together — partial writes would create a cache-hit decision that disagrees with the manifest snapshot. | Controller's `adopt()` writes all three from `session.result`. No public setter for any single field — they're a unit. Lint via a private encapsulating method. |
| 5 | **`activateSession` writes 13 fields**; `clearActiveResultState` writes 6. If the controller's `adopt` and `clear` write different *subsets* than the current code, we get silent UI desync. | Snapshot the exact field-write set per method in the test before extraction (characterization). Diff after extraction. |
| 6 | **`inquiry-critical-path-rules.md §5 "Snapshot Is the Single Estimate Source"** — must not introduce a second estimate path during this work. | Controller exposes session state only. Estimate snapshots stay in `InquiryEstimateSnapshot`. Add a doctrine assertion in the test file header. |
| 7 | **`inquiry-critical-path-rules.md §6 "Hover Must Not Recompute Estimates"** — getters must not perform computation. | Getters are pure field accessors. No memoization, no fall-back fetches. |
| 8 | **Subscriber pattern temptation** — controller may want `onChange` events for re-render. Adding observers introduces ordering complexity and is a known source of bugs across the audit findings. | Slice 1 does **not** add an event bus. View calls `refreshUI()` explicitly after controller mutations, exactly as today. Defer subscriber pattern to a separate, later iteration with a dedicated audit. |
| 9 | **Recovery path at `onOpen` (lines 740–790)** reads `this.state.isRunning` before the view has constructed the controller. Must initialize controller from the existing state shape; mishandling produces a phantom "not running" notice. | Construct controller in the same statement as `this.state` (field initializer). Test that re-opening a view mid-run preserves `isRunning=true`. |

---

## Recommended extraction order

| # | Slice | Touches | Risk | When |
|---|---|---|---|---|
| 1 | `InquiryActiveSessionState` (active-result subset) | ~25 mutation sites + ~30 read sites | Low–Medium | **First.** Smallest cohesive unit, doctrine-safe. |
| 2 | `InquirySelectionState` (scope/mode/targets + persistence) | ~40 sites incl. settings writes | Medium | After 1 lands. Higher risk due to 4-path `activeBookId` writes. |
| 3 | `InquirySettingsAccessor` (read-side facade for `inquiry*` settings keys) | ~30 read sites | Low | Mechanical. Best after Slice 1+2 reveal the real surface. |
| 4 | `InquiryRunController` (AbortController + cacheReuseState + runner invocation) | run start/cancel/error paths | High | **Deferred.** Genuine R1 scope; requires its own audit. |

---

## Files likely to change (Slice 1)

| File | Change |
|---|---|
| `src/inquiry/session/inquiryActiveSessionState.ts` | NEW |
| `src/inquiry/session/inquiryActiveSessionState.test.ts` | NEW |
| `src/inquiry/InquiryView.ts` | ~25 mutation sites rewritten to controller calls; field declaration narrows; constructor adds controller instance |

`src/inquiry/InquirySessionStore.ts`: **unchanged.** The store is fine where it is; the controller wraps it together with the state subset.

`src/inquiry/state.ts`: **unchanged in Slice 1.** `InquiryState` shape stays the same; only the **owner** of the fields shifts.

---

## Tests to add BEFORE extraction

To capture current behavior so the post-extraction diff is provably no-op:

### Slice 1 characterization tests (write before any production code change)

1. **`adopt(session, result, cacheStatus)`** writes exactly the 13-field set the current `activateSession` writes — snapshot the field set explicitly.
2. **`clearActiveResult()`** writes exactly the 6-field set the current `clearActiveResultState` writes.
3. **`markRunning(true)` then `markRunning(false)`** does not touch any other field.
4. **`isRunning` exit paths** — for each of:
   - successful run completion (line 6863)
   - abort-on-cancel (line 6693)
   - error result (line 6863)
   - simulated/recovered run (line 6722)
   
   verify `isRunning` ends up `false`.
5. **Cache-fingerprint trio atomicity** — `adopt` always sets `corpusFingerprint`, `corpusOnlyFingerprint`, `corpusManifestSnapshot` together; never one without the others.
6. **Doctrine guard** — explicit test that controller has no `compute*`, no `estimate*`, and no `hover*` methods (per `inquiry-critical-path-rules.md` §5–6). Reflective check on the prototype.

### Slice 2+ tests (write before later slices)

- `activeBookId` 4-path convergence (session adopt, cache restore, corpus sync, user pick → same final state).
- `targetSceneIds` setter persists to `inquiryTargetCache` once per call; no orphan in-memory state.
- `mode` toggle persists to `inquiryLastMode` and re-read at startup matches.

---

## End-state guarantees this audit assumes

- DOM, class names, i18n keys, keyboard behavior, click behavior, styling hooks: **unchanged at every call site.** (Same rule as the briefing/engine/dossier extraction campaign.)
- No new event bus or observer pattern introduced. View explicitly calls `refreshUI()` after controller mutations, exactly as today.
- `InquirySessionStore` is unchanged. Persistence is unchanged.
- No new estimate path. No hover recomputation. No fallback branches.
