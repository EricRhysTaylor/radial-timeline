# Architecture Drift Report — YYYY-MM-DD

**Cadence:** Weekly
**Audited by:** <agent / human>
**Branch / commit:** `<branch>` @ `<sha>`
**Previous report:** `reports/<prev-date>-architecture-drift.md` (or "none")
**Input reports loaded:** _list any CH-* reports consulted_

---

## Executive summary

_2–4 sentences. What seams are drifting? Anything new since last cycle?_

---

## Architecture map snapshot

A short description (5–15 bullets) of the current boundaries:

- View layer: _which views, which files_
- Service layer: _which services, who owns state_
- Modal layer: _which modals, who closes them_
- Command surface: _where commands are registered_
- AI runtime: _cache → passes → citations path_
- Settings / Pro gating: _where gates live_

This is **descriptive**, not prescriptive — used as a diff point for next
cycle.

---

## Findings

### AD-YYYY-MM-DD-#N — `<short title>`

- **Status:** Confirmed | Hypothesis
- **Concerns:** state | ownership | boundary | command | orchestration | terminology | fallback | cleanup _(one or more)_
- **Category:** cleanup | stabilization | modernization | doctrine correction | test hardening | no action
- **Severity:** GREEN | YELLOW | ORANGE | RED
- **Confidence:** Low | Medium | High
- **Risk:** _concrete consequence_
- **Effort:** _hours / days / weeks_
- **Evidence:** `path/to/file.ts:L120-L189`, `path/to/other.ts:L45`, …
- **Suggested next action:** _smallest clarifying change_
- **Cycles seen:** _N — auto-promote at 3_

---

## Cross-cycle patterns

Findings that have appeared in 2+ consecutive cycles. List with current
severity and whether they should escalate to the Refactor Board.

| ID | Title | Cycles seen | Current severity | Escalate? |
|---|---|---|---|---|
| | | | | |

---

## Historical Context

Classify each finding (or each theme, if you've clustered them) against
the audit history under `reports/`. Keep it short — one row per item.

| Finding / Theme | Classification |
|---|---|
| `AD-…` | New / Regressed / Previously resolved, resurfaced / Chronic hotspot / Stable or improving / Intentional debt / Deferred by doctrine |

Notes (optional, only when a classification needs a sentence):

- `AD-…` —

---

## Do Nothing / Monitor

- **What it is**
- **Why we're not acting**
- **Trigger to escalate**

---

## Product Doctrine Check

- Author trust:
- Non-destructive workflows:
- Core vs Pro gating consistency:
- Terminology consistency:
- Obsidian-native behavior:
- Manuscript safety:
- Export safety:
- AI analysis vs AI prose rewriting:

---

## Escalations to Refactor Board

Findings recommended for the next Monthly Refactor Board, with one-line
rationale each.

- AD-…
- AD-…

---

## Next cycle

- Run on (date):
- Specific seams to re-check:
- If skipping this cadence, why:
