# Inquiry Corpus — Map-Only Audit

**Date:** 2026-05-21
**Target:** `src/inquiry/InquiryView.ts` (11,509 LOC)
**Scope:** Map corpus-state ownership before any extraction. No production changes.
**Companion to:** [`inquiry-session-extraction-rollup-2026-05-21.md`](./inquiry-session-extraction-rollup-2026-05-21.md)

The session-controller extraction is closed. The next layer of `InquiryView`
strain is the corpus — the snapshot of resolved books/scenes/sources that
drives everything downstream. This audit maps the surface before any code
moves. The architecture boundary applies: `scope` and run orchestration come
**after** corpus, not before.

---

## 1. What already exists

Two corpus modules are **already extracted** under `src/inquiry/services/`:

| File | Role | Status |
|---|---|---|
| [`InquiryCorpusResolver.ts`](../../../src/inquiry/services/InquiryCorpusResolver.ts) (228 LOC) | Pure resolver. Given `(vault, metadataCache, frontmatterMappings)` at construction and `{ scope, activeBookId, sources, bookProfiles }` per call, returns an `InquiryCorpusSnapshot`. No internal state beyond ctor inputs. | Clean. Don't touch. |
| [`InquiryCorpusService.ts`](../../../src/inquiry/services/InquiryCorpusService.ts) (444 LOC) | Owns override state (class + item Maps) and computed payload stats. Has an explicit header guardrail: "Owns: corpus computation, override maps, cached payload stats. Does NOT own: corpusWarningActive, preview/selection state, DOM selection state, CC strip rendering state." | Clean. Tested. Don't touch. |

The corpus subsystem is therefore **not a god-class problem**. The remaining
strain in `InquiryView` is the **lifecycle orchestration** that ties these
two pieces together with view state.

---

## 2. Corpus surface in `InquiryView`

### 2a. Fields

| Field | Type | Mutation sites | Role |
|---|---|---|---|
| `corpusService` | `InquiryCorpusService` | 1 (ctor) | Owns override state. Already extracted. |
| `corpusResolver` | `InquiryCorpusResolver` | 2 (ctor + `refreshCorpus`) | Reconstructed on every refresh because frontmatter mappings can change. |
| `corpus` | `InquiryCorpusSnapshot \| undefined` | **1** (`refreshCorpus`, line 3800) | The resolved snapshot. 22+ read sites. |
| `corpusWarningActive` | `boolean` | **10** | UI flag — "the corpus is empty and the user tried to run." See §2c. |

### 2b. `corpus` reads — 22+ sites across the view

Concentrate around five access patterns:

- `corpus?.books` — saga-mode item set; book-label lookups
- `corpus?.scenes` — scene-level iteration (briefing purge, pending-edits plan, target resolution)
- `corpus?.activeBookId` — fallback for `state.activeBookId`; persistence keys
- `corpus?.bookResolved` — guidance / blocked-state checks
- `corpus.resolvedRoots` — not currently read; available on the snapshot

Representative sites: 715, 1417, 1650, 1700, 1706, 1745, 1747, 1798, 1850, 1854, 3808, 3809, 3810, 3821, 3826, 3827, 3829, 3831, 3953, 4045, 4588, 4619, 4862, 5019, 5050, 5578.

### 2c. `corpusWarningActive` mutations — 10 sites

| Site | Direction | Path |
|---|---|---|
| 4464 | → false | `resetCorpusOverrides()` (after `corpusService.resetOverrides()`) |
| 4488 | → false | After class-override edit |
| 4529 | → false | After item-override edit (corpus strip) |
| 4550 | → false | After item-override edit (alt path) |
| 4567 | → false | After item-override edit (alt path) |
| 4815 | → false | After scope-driven mode change |
| **4829** | → **true** | `handleEmptyCorpusRun` (user tried to run on empty corpus) |
| 5882 | read | Guidance text composition |
| 10328 | read | Notify gate (suppress duplicate warnings) |
| 10335 | → false | Auto-clear once warning observed |

Pattern: **set true in one place, cleared everywhere a user takes corrective
action**. This is the audit-cluster "single-setter-many-clearers" shape that
benefited from convergence in Slice 2c.

### 2d. `refreshCorpus()` orchestration

Single method (lines 3796–3848). Six steps:

1. `invalidateBriefingPurgeAvailability()` — cache invalidation
2. `corpusResolver = new InquiryCorpusResolver(vault, metadataCache, frontmatterMappings)` — recreate resolver (mappings may have changed)
3. `corpus = corpusResolver.resolve({ scope, activeBookId, sources, bookProfiles })` — single snapshot write
4. **Reconcile activeBookId**: if `corpus.activeBookId !== state.activeBookId`, call `selection.setActiveBookId(...)` (Slice 2c) and mark `shouldPersist`
5. **Reconcile targetSceneIds** (book scope only): resolve next targets from corpus.scenes; if changed, call `selection.setTargetSceneIds(...)` (Slice 2b) and mark `shouldPersist`; also `selection.rememberTargetSceneIdsForBook(...)` for the per-book Map
6. `refreshPayloadStats()`; if `shouldPersist`, `scheduleTargetPersist()`

**Callers (3):** `refreshDataDependencies` (the general refresh path) at line 3752; `runOmnibusInquiry` at lines 6453 and 6488 (dual call — once before prompt, once after if scope unchanged).

### 2e. `InquiryCorpusService` usage — 24 call sites across 15 distinct methods

All routed through `this.corpusService.X` already. No direct override state lives on `InquiryView`. Examples: `getClassOverride`, `setClassOverride`, `deleteItemOverrideByKey`, `hasOverrides`, `getOverrideSummary`, `applyOverrideSummary`, `resetOverrides`. **No surface to extract here** — clean.

---

## 3. Ownership grouping for a future controller

| Concern | Current owner | Future owner |
|---|---|---|
| `corpus` field write + read | `InquiryView` | Future `InquiryCorpusSnapshotController` |
| `corpusResolver` lifecycle (reconstruct per refresh) | `InquiryView` | Future controller |
| Resolve-side params construction (`{ scope, activeBookId, sources, bookProfiles }`) | `InquiryView` (mostly already through Slice 3 accessor) | `InquiryView` (orchestrator builds the params; controller takes them) |
| Reconcile chain (`selection.setActiveBookId`, `selection.setTargetSceneIds`, `rememberTargetSceneIdsForBook`, `scheduleTargetPersist`) | `InquiryView` | **Stay in `InquiryView`** — orchestration of cross-controller side effects |
| `invalidateBriefingPurgeAvailability` | `InquiryView` | **Stay in `InquiryView`** — view-cache concern, not corpus |
| Override state (`corpusService`) | Already extracted | Already extracted |
| `corpusWarningActive` | `InquiryView` | **Stay in `InquiryView`** for the first slice — see §6 risk #3 |
| `isCorpusEmpty()` | `InquiryView` (reads payload stats) | `InquiryView` — depends on `getPayloadStats()` which is separate |

---

## 4. First safe extraction slice

**`InquiryCorpusSnapshotController`** — owns only the snapshot lifecycle.

### What it owns

- `corpus: InquiryCorpusSnapshot | undefined` (write-through to shared state, same pattern as the session controllers)
- `corpusResolver: InquiryCorpusResolver`
- `refresh(params): InquiryCorpusSnapshot` — does the resolver reconstruct + resolve. Returns the new snapshot so callers can read it inline; also stores it.
- `getSnapshot(): InquiryCorpusSnapshot | undefined` — read accessor for the 22 inline reads (or keep them as direct `this.corpus?.x` reads via the write-through pattern, matching prior slices).

### What it does NOT own (preserved)

- The reconcile chain (Slice 2b/2c controller calls). Those stay in `InquiryView.refreshCorpus()` after the controller's `refresh()` returns.
- `invalidateBriefingPurgeAvailability`. View-cache concern.
- `corpusWarningActive`. UI flag; defer to a future micro-slice or leave inline.
- The dual-call shape from `runOmnibusInquiry`. Stays unchanged at the call site.

### Why this slice first

- **Cohesion** — the snapshot field + resolver + refresh method are a self-contained unit. They co-mutate in exactly one method.
- **Single write site** — `this.corpus = …` appears exactly once today (audit measurable forcing function).
- **Low risk** — the reconcile chain already routes through extracted controllers (`selection.setActiveBookId`, `selection.setTargetSceneIds`). The controller boundary cleanly separates "resolve" from "reconcile."
- **No new estimate/hover/cache paths** — doctrine §5–6 safe.
- **Sets up `scope` later** — once corpus has a controlled snapshot lifecycle, `scope` becomes "an input to corpus refresh," which is exactly what the user said depends on having corpus mapped first.

### Proposed shape

```ts
// src/inquiry/corpus/inquiryCorpusSnapshotController.ts
export interface CorpusSnapshotHost {
    readonly state: { corpus?: InquiryCorpusSnapshot };
    // OR: write-through via a shared field, same pattern as session controllers
}

export class InquiryCorpusSnapshotController {
    constructor(
        private readonly vault: Vault,
        private readonly metadataCache: MetadataCache,
        private readonly readFrontmatterMappings: () => Record<string, string>,
    ) {}

    /**
     * Resolve a fresh snapshot. The resolver is rebuilt every call so a
     * frontmatter-mappings change between refreshes is observed.
     */
    refresh(params: {
        scope: InquiryScope;
        activeBookId: string | undefined;
        sources: InquirySourcesSettings;
        bookProfiles: BookProfile[] | undefined;
    }): InquiryCorpusSnapshot { ... }

    getSnapshot(): InquiryCorpusSnapshot | undefined { ... }
}
```

`InquiryView.refreshCorpus()` becomes:

```ts
private refreshCorpus(): void {
    this.invalidateBriefingPurgeAvailability();
    const snapshot = this.corpusSnapshot.refresh({
        scope: this.state.scope,
        activeBookId: this.state.activeBookId,
        sources: this.normalizeInquirySources(this.settingsAccessor.getSources()),
        bookProfiles: this.plugin.settings.books,
    });
    this.corpus = snapshot; // OR drop this.corpus and read via getSnapshot()

    // Reconcile chain — unchanged, already controller-routed
    let shouldPersist = false;
    if (snapshot.activeBookId !== this.state.activeBookId) { ... }
    if (this.state.scope === 'book') { ... }
    this.refreshPayloadStats();
    if (shouldPersist) this.scheduleTargetPersist();
}
```

---

## 5. Tests to add BEFORE extraction

Same forcing-function pattern as the session campaign:

1. **Pin `this.corpus = …` is the **only** direct write site today.** Source-pattern test that `INQUIRY_VIEW_SRC.match(/this\.corpus\s*=(?!=)/g).length === 1`. Post-extraction this drops to 0 (write goes through controller); the test inverts.
2. **Pin the 6-step `refreshCorpus()` shape**: invalidate → resolver-recreate → resolve → activeBookId reconcile → targetSceneIds reconcile → conditional persist. Each step asserted as a source substring in order.
3. **Pin the dual-call from `runOmnibusInquiry`** (lines 6453 + 6488). Counting `this.refreshCorpus()` calls at exactly 3 today catches a removed branch.
4. **Pin frontmatter-mappings recapture** in `refreshCorpus`: source must contain `new InquiryCorpusResolver(this.app.vault, this.app.metadataCache, getActiveFrontmatterMappings(this.plugin.settings))` — proving the resolver is rebuilt on every refresh.
5. **Pin `this.corpus?.books`/`scenes`/`activeBookId`/`bookResolved` access counts** to catch a missed rewire if reads later route through the controller's getSnapshot().
6. **Unit tests on the controller** — given fake vault/metadata, verify resolver reconstruction on each refresh; verify the snapshot is returned and stored; verify no behavior change vs the inline form (snapshot the existing `refreshCorpus` output for a canned input).

---

## 6. Behavior-drift risks

| # | Risk | Mitigation |
|---|---|---|
| 1 | **Frontmatter mappings are re-read on every refresh** (line 3798). A controller that captures mappings at construction would freeze a stale view across settings changes. | Pass mappings as a closure (`readFrontmatterMappings: () => Record<string, string>`) and call it inside `refresh()`. Mirror Slice 3's closure pattern for the settings accessor. |
| 2 | **Reconcile chain depends on extracted state**. `refreshCorpus` calls `selection.setActiveBookId` and `selection.setTargetSceneIds`. If those calls move into the controller, the controller starts carrying view-orchestration responsibility — outside its cohesive concern. | **Keep reconcile in `InquiryView`**. Controller only resolves. View reads the new snapshot and runs the reconcile. |
| 3 | **`corpusWarningActive` is set to false in 8 override-mutation paths** plus once in `auto-clear`. Convergence risk identical to Slice 2c's `activeBookId`. | Defer `corpusWarningActive` to a separate micro-slice **after** the snapshot controller lands. Or leave it inline if the warning lifecycle naturally lives near the view's guidance state. |
| 4 | **`isCorpusEmpty()` reads `getPayloadStats()`, not `corpus.scenes.length`**. Easy to assume corpus shape == emptiness; it does not. | Do not absorb `isCorpusEmpty` into the corpus controller. It belongs with payload stats. |
| 5 | **Omnibus dual-call** (lines 6453 + 6488). The first refresh sets up state for the scope-aware prompt; the second restores corpus if scope DID NOT change. Behavior depends on the side-effects between calls. | Characterization test pins the dual call. Controller must be safe to call twice in sequence with no observable difference. |
| 6 | **`InquiryCorpusResolver` is recreated every refresh** (line 3798) even when frontmatter mappings haven't changed. Acceptable cost today; controller could optimize by caching the resolver if mappings are stable. | Don't optimize in extraction. Match existing behavior exactly. Performance work, if any, is a separate later concern. |
| 7 | **`refreshCorpus` indirectly persists via `scheduleTargetPersist()`**. If the controller's `refresh()` returns the snapshot but the view forgets to run the reconcile-and-persist chain, persistence silently stalls. | Characterization test pins the conditional `scheduleTargetPersist()` call at the end of `refreshCorpus`. Same forcing-function shape that caught issues in Slice 2b. |
| 8 | **`invalidateBriefingPurgeAvailability()` runs at the start of `refreshCorpus`**. Moving the refresh into a controller without moving this call would change the order: cache stays valid through a new resolve, which could yield a stale "purge available" decision. | Keep the call in `InquiryView.refreshCorpus()` before calling `controller.refresh()`. Pin the order via characterization test. |
| 9 | **No new event/subscriber path**. Same constraint as the session campaign. | Controller exposes `refresh(params)` and `getSnapshot()`. No `onChange` subscriber. Audit Risk #8 stands. |

---

## 7. Recommended extraction order

| # | Slice | Touches | Risk | Notes |
|---|---|---|---|---|
| 1 | **`InquiryCorpusSnapshotController`** (this audit's target) | 1 write site, 22 reads, 1 method, 2 fields | Low | First. Snapshot lifecycle only. |
| 2 | `corpusWarningActive` consolidation (optional) | 10 mutation sites | Low–Medium | Same "single-setter, many-clearers" shape Slice 2c solved. Defer unless forced. |
| 3 | **`scope` extraction** | Per the user's order, comes after corpus | Medium | Depends on corpus shape being controlled. **Out of scope for this audit.** |
| 4 | Run controller (`isRunning`, AbortController, runner invocation, AI accounting) | Hard stop boundary | High | **Deferred indefinitely. Needs its own audit.** |

---

## 8. Files likely to change (Slice 1)

| File | Change |
|---|---|
| `src/inquiry/corpus/inquiryCorpusSnapshotController.ts` | NEW |
| `src/inquiry/corpus/inquiryCorpusSnapshotController.test.ts` | NEW |
| `src/inquiry/corpus/inquiryCorpusSnapshot.characterization.test.ts` | NEW — pre-extraction source-pattern net |
| `src/inquiry/InquiryView.ts` | Constructor: instantiate controller. `refreshCorpus`: rewire 6 steps to `controller.refresh(...)`. ~22 read sites unchanged (write-through pattern). |

`src/inquiry/services/InquiryCorpusResolver.ts`: **unchanged.**
`src/inquiry/services/InquiryCorpusService.ts`: **unchanged.**

The controller folder is `src/inquiry/corpus/` to keep it adjacent to the
existing `inquiryCorpusStripRenderer` / `inquiryCorpusStripSlotRenderer`
files (which already live there). It does **not** belong under
`src/inquiry/session/` — corpus and session are different concerns.

---

## 9. Architectural boundary (carried forward from the session campaign)

Hard-stop line preserved per the user's directive:

- `isRunning`
- `AbortController`
- `cacheReuseState`
- `InquiryRunnerService` invocation
- AI provider accounting
- `scope` — comes **after** corpus, not before

Do not touch any of those without a fresh audit + pre-extraction
characterization tests, same discipline as the session campaign.

---

## 10. End-state guarantees this audit assumes

- DOM, class names, i18n keys, keyboard behavior, click behavior, styling
  hooks: unchanged at every call site.
- No new event bus or observer pattern. View calls existing reconcile
  methods after corpus refresh, exactly as today.
- `InquiryCorpusResolver` and `InquiryCorpusService` are unchanged.
  Override behavior and resolver semantics are unchanged.
- No new estimate path. No hover recomputation. No fallback branches.
- The single `this.corpus = …` write site becomes zero in `InquiryView`
  after extraction. The controller becomes the sole writer of the
  snapshot field (write-through to a shared `state.corpus` reference,
  same pattern as the session controllers).
