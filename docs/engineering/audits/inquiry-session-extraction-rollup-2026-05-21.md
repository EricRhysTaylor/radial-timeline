# Inquiry Session Extraction — Rollup

**Date:** 2026-05-21
**Tag:** `inquiry-session-extraction-2026-05-21`
**Status:** Campaign closed. Stabilization milestone reached.
**Audit input:** [`inquiry-session-controller-map-2026-05-21.md`](./inquiry-session-controller-map-2026-05-21.md)

The campaign moved the most dangerous `InquiryView` state mutations behind
small, tested controllers. This rollup is the consolidation note for the
work. It is **not** an architecture proposal — the next-tier work
(corpus, scope, run, AI) lives behind its own future audits.

---

## Commits landed

In chronological order on `master`:

| SHA | Subject | Role |
|---|---|---|
| `6727471a` | docs(inquiry): map session controller extraction | Audit (input) |
| `70173f2f` | refactor(inquiry): extract active session state from InquiryView | Slice 1 |
| `3d668d55` | test(inquiry): characterization tests for selection state | Pre-Slice-2 safety net |
| `ebd162af` | refactor(inquiry): extract selection mode state | Slice 2a |
| `db59356d` | refactor(inquiry): extract target selection state | Slice 2b |
| `ab03dfdb` | refactor(inquiry): converge activeBookId on selection controller | Slice 2c |
| `e0763f87` | refactor(inquiry): wrap inquiry settings reads behind an accessor | Slice 3 |
| `9745eca8` | docs(inquiry): document session architecture + inline dead delegator | Cleanup |

**Prerequisite (not in this campaign):**
`a8a5071a feat(core): disposable contract and timer-clear helper` — the
shared `Disposable` / `DisposableRegistry` / `clearTrackedTimer`
primitives the controllers depend on. Landed during the prior
stabilization pass.

---

## Fields moved out of InquiryView

State that now has a single tested mutation entry point:

### Owned by `InquiryActiveSessionState` (Slice 1)

- `activeSessionId`
- `activeResult`
- `activeQuestionId`
- `activeZone`
- `cacheStatus`
- `corpusFingerprint`
- `corpusOnlyFingerprint`
- `corpusManifestSnapshot`
- `lastError`

Public surface: `adopt(input)`, `clearActiveResult()`, `setActiveZone(...)`,
`setActiveQuestionId(...)`, `setCacheStatus(...)`, `setLastError(...)`.

Doctrine invariant pinned: the corpus-fingerprint trio is always written as
a unit (audit §5).

### Owned by `InquirySelectionState` (Slices 2a + 2b + 2c)

- `mode` (Slice 2a) + the `inquiryLastMode` settings round-trip
- `targetSceneIds` (Slice 2b)
- `lastTargetSceneIdsByBookId` per-book Map (Slice 2b — was a view field)
- 300ms debounced persistence to `inquiryTargetCache` (Slice 2b)
- `activeBookId` (Slice 2c — Risk #1 convergence)

Public surface (alphabetical):
`adoptModeFromResult`, `applyPersistedLastModeOr`, `cancelPendingPersist`,
`cleanup`, `clearPersistedTargetCache`, `getActiveBookId`,
`getRememberedTargetSceneIdsForBook`, `hydrateRememberedTargetSceneIdsFromCache`,
`rememberTargetSceneIdsForBook`, `schedulePersist`, `setActiveBookId`,
`setActiveLens`, `setTargetSceneIds`.

`InquirySelectionState` implements `Disposable` because it owns the debounce
timer; `InquiryView.onClose` calls `selection.cleanup()` alongside the other
controllers.

Doctrine invariants pinned: `setActiveLens` state→settings→save ordering;
`schedulePersist` write-before-save ordering (audit Risk #3); `setActiveBookId`
is the **only** mutation entry point for `state.activeBookId` (audit Risk #1).

### Owned by `InquirySettingsAccessor` (Slice 3)

Read-side facade over 7 inquiry-namespaced settings keys:
`inquirySources`, `inquiryActionNotesAutoPopulate`, `inquiryPromptConfig`,
`inquiryTargetCache`, `inquiryOmnibusProgress`, `inquiryTimingHistory`,
`inquiryCorpusThresholds`.

No defaulting, no normalization, no event system — strict pass-through.
~22 direct `this.plugin.settings.inquiry*` reads collapsed to accessor
calls. Reflective ownership-boundary test enforces read-only (any `set*`
/ `write*` / `clear*` method on the prototype fails the surface check).

---

## Fields intentionally left inline

Not touched in this campaign. Behind the hard stop line until each gets
its own audit:

- `scope` — coupled to corpus + saga availability + Pro-feature gating
- `isRunning` — coupled to AbortController, `cacheReuseState`, retry
  counters, `InquiryRunnerService` invocation pattern
- `selectedPromptIds`, `promptFormOverrides`, `reportPreviewOpen` —
  minor; can ride a future architectural pass

Settings **writes** that remain inline (Slice 3 was read-only):

- `inquiryPromptConfig` — first-run seed
- `inquiryOmnibusProgress` — 2 write sites
- `inquiryTimingHistory` — 1 write site

(`inquiryLastMode` and `inquiryTargetCache` writes are already
encapsulated in controller closures.)

The campaign's characterization tests pin every pending field still has
an inline `this.state.<field> =` write today. Any future slice absorbing
one of these fields must update the "pending" list — silent drift fails
the test loudly.

---

## Tests added

| File | Tests |
|---|---|
| `src/inquiry/session/inquiryActiveSessionState.test.ts` | 15 |
| `src/inquiry/session/inquirySelectionState.test.ts` | 43 |
| `src/inquiry/session/inquirySelectionState.characterization.test.ts` | 42 |
| `src/inquiry/settings/inquirySettingsAccessor.test.ts` | 11 |
| **Total this campaign** | **111** |

Categories:

- **Controller unit tests** — exercise the controllers directly with
  fake hosts. Verify field isolation, atomic writes, debounce timing,
  Disposable cleanup, doctrine guards (no `compute*`/`estimate*`/`hover*`
  methods on the prototype).
- **Characterization tests** — read `InquiryView.ts` as a string and
  assert (a) every controlled field has zero direct mutations in the
  view, (b) every pending field still has the inline form, and (c) the
  controller wiring lives where it should. Same forcing-function pattern
  as the existing `src/inquiry/InquiryView.test.ts`.
- **Compile-time type guards** — `Pick<InquiryState, …>` on each
  controller's `SelectionStateHost` so any future widening produces a
  tsc error rather than silent boundary creep.

The previously-existing `src/inquiry/InquiryView.test.ts` had two pre-
extraction source-pattern assertions that were updated to the new
controller-routed form (`70173f2f` for activeSession, `db59356d` for
clearPersistedTargetCache).

---

## Gates (final state at tag)

| Gate | Result |
|---|---|
| `npx tsc --noEmit` | clean |
| `npx vitest run` | **2120 passed**, 2 skipped, 0 failed (208 test files) |
| `npm run build-only` (4 ert-lock scripts → tsc → code-quality → css-duplicates → esbuild prod → css-duplicates) | **Production build complete** |

---

## InquiryView LOC trajectory

| Point | LOC | Note |
|---|---|---|
| Audit baseline | 11,515 | Pre-campaign measurement |
| Slice 1 lands | 11,516 | +1 (state ownership leaves; getter delegation comes in) |
| Slice 2a lands | 11,528 | +13 (constructor settings-host closure block) |
| Slice 2b lands | 11,505 | −23 (Map + persist timer fields move out) |
| Slice 2c lands | 11,505 | 0 (8 inline mutations swap to 8 controller calls) |
| Slice 3 lands | 11,513 | +8 (accessor instantiation) |
| Cleanup | **11,509** | −4 (dead delegator inlined) |
| **Net** | **−6** | Behind the LOC story is real structural change. |

The LOC delta is roughly neutral by design. The win is structural — every
mutation has a single tested entry point with documented invariants.

---

## New shared infrastructure

| File | Purpose |
|---|---|
| `src/inquiry/session/inquiryActiveSessionState.ts` | Slice 1 controller |
| `src/inquiry/session/inquirySelectionState.ts` | Slices 2a + 2b + 2c controller; Disposable |
| `src/inquiry/settings/inquirySettingsAccessor.ts` | Slice 3 read-side facade |
| `src/inquiry/session/README.md` | Architecture-surface documentation |
| `src/inquiry/session/inquirySelectionState.characterization.test.ts` | Forcing-function safety net |
| `src/core/disposable.ts` (prerequisite) | Disposable contract + `clearTrackedTimer` |

---

## Remaining architectural boundary

The next tier is **architectural, not extractive**. Each needs its own
audit + pre-extraction characterization tests before any code moves:

1. **Corpus** (recommended next) — `InquiryCorpusResolver`, `corpus` field,
   `refreshCorpus`, corpus-shape coupling that `scope` and `run` will
   inherit. Audit first.
2. **Scope** — depends on corpus shape (single-book vs saga). Deferred
   until corpus is mapped.
3. **Run controller** — `isRunning` (9 mutation sites),
   `AbortController`, `cacheReuseState`, retry counters,
   `InquiryRunnerService` invocation pattern, AI provider accounting.
   Deferred until corpus and scope are extracted.

**Hard stop — do not touch without a fresh audit:**

- `isRunning`
- `AbortController`
- `cacheReuseState`
- `InquiryRunnerService` invocation
- AI provider accounting (per `inquiry-critical-path-rules.md` §1–10)

---

## Verdict

`InquiryView` went from "scary god-class" to "orchestrator with owned
seams." The most dangerous state mutations — session lifecycle, mode
round-trip, target-cache persistence, activeBookId convergence,
inquiry-namespaced settings reads — now flow through controllers with
unit tests, characterization tests, doctrine guards, type guards, and
documented host boundaries.

The campaign deliberately stopped before scope / corpus / run /
AI-execution work. That boundary is structural: those systems share
state and lifecycle in ways that need their own audit-first treatment.
