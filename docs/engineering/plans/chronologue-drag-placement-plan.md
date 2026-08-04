# Chronologue Drag — Temporal Placement Plan

**Goal:** allow a scene to be dragged to a new position on the Chronologue outer ring. Because
Chronologue position *is* the `When` date, the drop must resolve to a concrete timestamp. Dropping
on scene **B** means *place immediately before B*. A modal offers candidate timestamps for the
resulting slot — deterministic always, AI-proposed later, custom entry any time — and writes the
one the author picks.

**Status:** Phase 1 shipped (`30cc83fa`, hardened in the follow-up below). Phase 2 (AI) not started.

**Verified against** `30cc83fa`.

---

## 1. Why this was blocked, and what actually unblocks it

The stated blocker is "date validation and placement." That is real, but it is not an AI problem.
Dropping a scene before scene B constrains the new `When` to the open interval between B and
whatever scene chronologically precedes B. Whether a candidate is safe is closed-form and
unit-testable with no model in the loop.

So the architecture is:

- A **validator** owns correctness. Every candidate, whoever produced it, passes through it.
- **Deterministic generators** own the baseline candidate set — free, offline, instant. "Keep the
  existing time of day, advance the day" is one of them and needs no model.
- The **AI** (Phase 2) owns narrative judgement only: reading the scene and its neighbours to argue
  for "the following morning" over "eleven days later." Its output is validated like any other
  candidate.

**Phase 1 removes the blocker with no AI at all.**

---

## 2. Current behavior (verified)

### 2.1 Chronologue is an equal-slot ring

`src/renderer/utils/Chronologue.ts:70` — the full circle is divided evenly by scene count:

```ts
const totalAngularSpace = endAngle - startAngle;   // -π/2 → 3π/2
sceneAngularSize = totalAngularSpace / sortedScenes.length;
```

Angular position encodes **chronological rank**, not elapsed time. A drag changes a scene's rank;
the timestamp is whatever satisfies that rank.

### 2.2 Ordering and its tie-break

`sortScenesChronologically` (`src/utils/sceneHelpers.ts:336`):

- Baseline is manuscript order; dated scenes act as anchors.
- Undated scenes inherit `lastTime` from the preceding dated scene.
- Equal times break by manuscript index: `return a.index - b.index`.

So a timestamp *equal* to a neighbour does not reliably land where it was dropped. The stored value
must be strictly between the bounds — see §5.

### 2.3 The top seam is degenerate

`startAngle = -π/2`, `endAngle = 3π/2` — the last scene's end angle is the same point as the first
scene's start angle. "Before the first scene" and "after the last scene" are the same physical
region, so a drop on the first scene must ask which the author meant.

### 2.4 Existing drag is narrative-only

`src/view/interactions/OuterRingDragController.ts:187` hard-returns unless `mode === 'narrative'`,
and its whole commit path is the rename transaction. Chronologue gets its own controller. The pure
geometry both need — rotation offset, drop tick, drop arc, hover indicator, colour resolution — is
extracted to a shared module rather than duplicated.

### 2.5 `When` writing already has a single chokepoint

`src/timelineRepair/frontmatterWriter.ts:112` `writeFrontmatterUpdates`:

- formats `YYYY-MM-DD HH:MM` (`:28`) — **minute precision, seconds truncated**;
- appends to `Radial Timeline/Snapshots/Timeline/when-change-log.jsonl`
  (`src/timelineRepair/whenChangeLog.ts:19`);
- `WhenSource` already includes `'manual'` (`src/timelineRepair/types.ts:154`).

---

## 3. Renumbering: the answer is *don't*

**No renumber. No rename. No ripple.** Chronologue drag writes exactly one field: `When`.

Manuscript order (the number prefix) and chronological order are independent axes, and the gap
between them is the product — Chronologue exists to show that a scene *read* seventh *happens*
second. Renumbering on a chronological drop would collapse the two axes and silently rewrite the
manuscript. The author dragged a scene to say "this happens earlier," not "move this chapter."

Blast radius is therefore one `processFrontMatter` call on one file, versus narrative drag's N-file
rename transaction. Fractional indices, prefix widths and beat-gap preservation do not apply.

---

## 4. The drop model

Drop **on** scene B → place immediately before B. Same drop-target detection as narrative drag.

Neighbours come from the chronological ordering **with the dragged scene removed**. Without that
removal, dragging a scene backward computes bounds from a sequence that still contains it at its
old slot, and the bounds come out wrong.

```
   … prevScene ─────── [ drop here ] ─────── B …
     lowerBound                              upperBound
```

| Case | Rule |
|---|---|
| both bounds dated | normal path |
| B is the first scene | ask: *before the opening scene* / *after the closing scene* |
| either neighbour undated | reject; Notice names the scene: "Give <title> a When date first." |
| B is the dragged scene, or already immediately after it | no-op, reset silently |

One-sided bounds (before-first / after-last) get their open end from the median inter-scene gap.

**The seam is tested before the interior no-op.** Dropping the opening scene on
the second scene reads as an interior no-op — it is already immediately before
it — but that is the *only* gesture that can reach the seam for that scene.
Swallowing it would strand the opening scene at the start of the chronology with
no way to move it to the end. Each seam side is then no-op-checked on its own:
"before the opening scene" is a no-op for the scene that already opens, and
"after the closing scene" is a no-op for the scene that already closes. When only
one reading survives, the modal states which one it took rather than applying it
silently.

---

## 5. The validator

`src/chronologue/placement/validatePlacement.ts`. Pure, no Obsidian imports.

The check runs on the **stored form, not the in-memory `Date`**. `formatWhenForYaml` truncates to
minutes, so a midpoint at `14:30:45` stores as `14:30` and can land exactly on a bound — the
pre-format `Date` would pass while the written value falls into the manuscript-index tie-break.

```
candidate Date → formatWhenForYaml → parseWhenField → strict-between check
```

That round trip is the whole guarantee that the scene lands where the modal promised.

```ts
export type PlacementVerdict =
    | { kind: 'ok'; storedWhen: string; when: Date; overlapWarning: OverlapWarning | null }
    | { kind: 'rejected'; reason: PlacementRejection; message: string };

export type PlacementRejection =
    | 'unparsable'
    | 'outside_bounds'      // ≤ lowerBound or ≥ upperBound after formatting
    | 'no_room';            // bounds < 2 minutes apart
```

`overlapWarning` fires when the previous scene's `Duration` runs past the candidate, or the dragged
scene's `Duration` runs past B. It **warns and lets the author proceed** — a deliberate overlap is
legitimate.

---

## 6. Deterministic candidates

`src/chronologue/placement/generateCandidates.ts`. Each candidate is validated; rejected ones are
dropped before the modal renders. Producing nothing is normal, not an error.

| Candidate | Behaviour |
|---|---|
| **Keep the time, advance the day** | the dragged scene's current time-of-day, on the first day that falls inside the bounds |
| **Midpoint** | exact centre of the interval |
| **Custom** | free-text field parsed by `parseWhenField`, live-validated |

Rows show elapsed-from-previous and elapsed-to-B via `formatElapsedTime`
(`src/utils/date.ts:582`) so the author reads placement in story time.

---

## 7. The modal

`src/modals/ChronologuePlacementModal.ts`, extending `ErtModal`, structurally parallel to
`DragConfirmModal` — confirm → running → done, `waitForBegin()` / `updateProgress()` /
`finishWithDismiss()`, accent from the dragged scene's publish-stage colour.

1. Header — `Place scene in time`, scene title.
2. Context strip — `prev · <when>  →  [ scene ]  →  B · <when>`, plus room available.
3. Seam choice, first-scene drops only.
4. Candidate radio rows, with elapsed figures and any overlap warning.
5. Custom date field.
6. Place / Cancel. **Place is disabled until the selected candidate's stored form validates.**

---

## 8. Write path

```
author confirms
  → writeFrontmatterUpdates(app, [{ file, when, whenSource: 'manual' }],
                            { logTool: 'chronologue' })
  → view refresh
```

`whenSource: 'manual'` matters: `buildScaffoldStampMap` (`whenChangeLog.ts:94`) treats machine
sources as ripple-movable, and a date the author read, compared and chose is authored.

`writeFrontmatterUpdates` **catches per-file errors and reports them in its result rather than
throwing** (`frontmatterWriter.ts:171`). The caller must read `success` / `errors` — a `try/catch`
alone reports a failed write as a successful placement while `When` is unchanged, and the refresh
that follows silently disagrees with the notice.

Requires widening two closed unions: `WhenChangeRecord['tool']` (`whenChangeLog.ts:35`) and
`WriteOptions.logTool` (`frontmatterWriter.ts:95`) to include `'chronologue'`.

No renames, no `applySceneNumberUpdates`, no ripple rename, no structural-move history.

---

## 9. Wiring

New `src/view/interactions/ChronologueDragController.ts`, registered from
`src/view/modes/ChronologueMode.ts`.

Shared geometry extracted to `src/view/interactions/dragGeometry.ts` and consumed by both
controllers in the same change: rotation offset, drop tick, drop arc, hover indicator, publish-stage
and subplot colour resolution, `cssEscape`.

Guards:

- Suppress drag entirely while a sub-mode is active — `isShiftModeActive() || isAlienModeActive()
  || isRuntimeModeActive()` (`ChronologueShiftController.ts:55–69`).
- The click handler at `ChronologueMode.ts:359` consults `wasRecentlyHandledByDrag()` before
  opening the file.
- Drag sources restricted to `[data-item-type="Scene"]`; `Backdrop` is not a source.

---

## 10. Phasing

**Phase 1 — deterministic placement.** Validator, candidates, neighbour resolution incl. seam,
`dragGeometry.ts` extraction, controller, modal, write path. Ships fully useful with
`provider: 'none'`.

**Phase 2 — AI proposals.** Prompt scoped to the full dragged scene, its narrative neighbours, and
the two chronological bounds — no manuscript-wide map. Proposals are validated by §5 and discarded
if out of bounds, never clamped. Modal opens immediately on deterministic candidates and appends AI
rows when they arrive.

---

## 11. Tests

- `validatePlacement`: inside/outside bounds; **seconds-truncation landing on a bound**; equal to
  either bound; open lower and open upper; sub-2-minute room; unparsable input; overlap warning
  from the previous scene's `Duration` and from the dragged scene's.
- `generateCandidates`: wide (weeks), medium (days) and tight (minutes) intervals; keep-the-time
  when the current time-of-day does not fit; empty result when nothing fits.
- `resolvePlacementNeighbors`: dragged scene excluded from the ordering; backward drag; seam;
  undated neighbour; self-adjacent no-op; **the opening scene reaching the seam via a drop on the
  second scene, with before-first rejected as a no-op**.
- Sort stability: after a write, `sortScenesChronologically` puts the scene in the slot the modal
  promised — including the opening scene moved to the very end.

Not covered by tests: the pointer gesture itself and the write result branch, both of which need a
running Obsidian instance.
