# Codebase Health Report — YYYY-MM-DD

**Cadence:** Weekly
**Audited by:** <agent / human>
**Branch / commit:** `<branch>` @ `<sha>`
**Build status at audit time:** `<pass | fail | not-run>` (`build-only` / `tsc --noEmit` / `vitest`)
**Previous report:** `reports/<prev-date>-codebase-health.md` (or "none")

---

## Executive summary

_2–4 sentences. What's the headline? Is the codebase trending healthier
or worse since the last cycle?_

---

## Top metrics

| Metric | This cycle | Prev cycle | Δ |
|---|---|---|---|
| Largest TS file (lines) | | | |
| Largest CSS file (lines) | | | |
| Files > 600 lines | | | |
| Functions > 80 lines | | | |
| Dead exports (count) | | | |
| Unused CSS classes (count) | | | |
| `// TODO` / `// FIXME` count | | | |
| `main.js` size (KB) | | | |
| `styles.css` size (KB) | | | |

---

## Findings

For each finding use:

### CH-YYYY-MM-DD-#N — `<short title>`

- **Status:** Confirmed | Hypothesis
- **Category:** cleanup | stabilization | modernization | doctrine correction | test hardening | no action
- **Severity:** GREEN | YELLOW | ORANGE | RED
- **Confidence:** Low | Medium | High
- **Risk:** _what breaks if ignored_
- **Effort:** _hours / days_
- **Evidence:** `path/to/file.ts:L120-L189`, …
- **Suggested next action:** _smallest unit of useful work_

---

## Historical Context

Classify each finding (or each theme, if you've clustered them) against
the audit history under `reports/`. Keep it short — one row per item.

| Finding / Theme | Classification |
|---|---|
| `CH-…` | New / Regressed / Previously resolved, resurfaced / Chronic hotspot / Stable or improving / Intentional debt / Deferred by doctrine |

Notes (optional, only when a classification needs a sentence):

- `CH-…` —

---

## Do Nothing / Monitor

For findings that are real but not yet worth acting on. Include:

- **What it is**
- **Why we're not acting**
- **What would change our mind** (the trigger)

---

## Product Doctrine Check

For each pillar, write one line: `OK` / `Concern — <details>`.

- Author trust:
- Non-destructive workflows:
- Core vs Pro gating consistency:
- Terminology consistency:
- Obsidian-native behavior:
- Manuscript safety:
- Export safety:
- AI analysis vs AI prose rewriting:

---

## Escalations to other audits

Findings that belong to a different track:

- → Architecture Drift: `<finding IDs and one-line reason>`
- → Obsidian Ecosystem: `<finding IDs and one-line reason>`
- → Refactor Board (next monthly): `<finding IDs and one-line reason>`

---

## Next cycle

- Run on (date):
- Specific things to re-check:
- If skipping this cadence, why:
