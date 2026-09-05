# Refactor Recommendation Board — YYYY-MM-DD

**Cadence:** Monthly
**Audited by:** <agent / human>
**Branch / commit:** `<branch>` @ `<sha>`
**Reports synthesized:** _list every reports/* file consulted_
**Previous board:** `reports/<prev-date>-refactor-board.md` (or "none")

---

## Board

| # | Theme | Severity | Confidence | Decision | Cycles seen | Owner | Effort | Stop condition |
|---|---|---|---|---|---|---|---|---|
| 1 | | | | Refactor / Fine-tune / Monitor / Do Nothing | | | | |
| 2 | | | | | | | | |

Use one row per **theme**, not per finding.

Severity legend: **GREEN** none · **YELLOW** targeted cleanup · **ORANGE**
stabilization sprint · **RED** refactor before more feature work.

---

## Theme details

### Theme 1 — `<name>`

- **Severity:** GREEN | YELLOW | ORANGE | RED
- **Confidence:** Low | Medium | High
- **Decision:** Refactor | Fine-tune | Monitor | Do Nothing
- **Source findings:** `CH-…`, `AD-…`, `OE-…`
- **Evidence (files):** `path/to/file.ts:L120-L189`, …
- **Risk if ignored:** _concrete consequence — not generic "tech debt"_
- **Estimated effort:** _hours / days / weeks_
- **Recommended sequence:**
  1. _before_
  2. _during_
  3. _after / verification_
- **Stop condition:** _when would we abandon or downgrade?_
- **Product Doctrine relevance:** _which pillars are at stake (or "none")_
- **Reduces complexity by:** _what gets removed / collapsed_
- **Cycles seen:** _N_

_(Repeat per theme.)_

---

## Historical Context

One row per board theme. The classification answers: *what kind of
problem is this, in the arc of the codebase?*

| # | Theme | Classification |
|---|---|---|
| 1 | | New / Regressed / Previously resolved, resurfaced / Chronic hotspot / Stable or improving / Intentional debt / Deferred by doctrine |
| 2 | | |

Trend notes (use sparingly — only when a pattern is worth narrating):

- _Theme name_ —

---

## Carried forward from previous board

| Theme | Prior severity | New severity | Change | Why |
|---|---|---|---|---|
| | | | upgraded / downgraded / unchanged / resolved | |

---

## Refactor decisions (this cycle)

Themes whose decision is **Refactor** or **Fine-tune**, sequenced.
Include:

1. _Theme name_ — start by `<date>`, success looks like `<measurable
   outcome>`.

---

## Monitor list

Themes that are real but not yet actionable. Each entry shows the
trigger that would escalate it.

- _Theme name_ — escalate if: _trigger_

---

## Do Nothing list

Themes that were considered but consciously dismissed this cycle, with
rationale (so future audits don't re-litigate the same ground).

- _Theme name_ — reason:

---

## Product Doctrine Check (board-level)

Trajectory of the codebase across the prior month — not individual
findings.

- Author trust:
- Non-destructive workflows:
- Core vs Pro gating consistency:
- Terminology consistency:
- Obsidian-native behavior:
- Manuscript safety:
- Export safety:
- AI analysis vs AI prose rewriting:

Any pillar marked "Concern" must be a board entry with severity ≥ ORANGE.

---

## Executive summary

_One paragraph. 30-second read. What did we decide, what comes next,
what's on hold?_

---

## Next board

- Run on (date):
- What to re-evaluate first:
