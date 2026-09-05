# Radial Timeline Audit System

A lightweight, recurring audit framework for preventing architectural drift,
stale Obsidian practices, and refactor debt. Reports are written for human
review — they recommend, they do not modify product code.

> Legacy / one-off audits live alongside this README at the top of
> `docs/engineering/audits/` (e.g. `compliance-debt.md`, `sanitation-audit.md`,
> `css-drift-debt.md`). The framework below covers the **recurring** cadence
> going forward.

---

## Audit tracks

| Track | Cadence | Prompt | Template |
|---|---|---|---|
| Codebase Health | Weekly | [prompts/weekly-codebase-health-audit.md](prompts/weekly-codebase-health-audit.md) | [templates/codebase-health-report.md](templates/codebase-health-report.md) |
| Architecture Drift | Weekly | [prompts/weekly-architecture-drift-audit.md](prompts/weekly-architecture-drift-audit.md) | [templates/architecture-drift-report.md](templates/architecture-drift-report.md) |
| Obsidian Ecosystem | Biweekly | [prompts/biweekly-obsidian-ecosystem-audit.md](prompts/biweekly-obsidian-ecosystem-audit.md) | [templates/obsidian-ecosystem-report.md](templates/obsidian-ecosystem-report.md) |
| Refactor Board | Monthly | [prompts/monthly-refactor-board.md](prompts/monthly-refactor-board.md) | [templates/refactor-board-report.md](templates/refactor-board-report.md) |

---

## How to run an audit (agent-run)

1. Pick the track and open its prompt file under `prompts/`.
2. Give the full prompt to an IDE agent (Claude Code, Cursor, Codex, etc.) at
   the repo root.
3. The agent inspects the codebase, cites files and line numbers, and
   produces a report.
4. The agent saves the report under `reports/` using the filename convention
   `YYYY-MM-DD-<track>.md` (e.g. `2026-05-19-codebase-health.md`).
5. Review with a human. Do not auto-apply any recommendation.

For the recurring shortcut audits in this repo, the agent is also responsible
for executing and recording them rather than telling Eric to run shell
commands manually:

- `npm run auditDaily`
- `npm run auditFriday`
- `npm run auditDeep`

When preserving one of those runs as a backup note, the agent should also run
`npm run backup -- --note "<Audit Name>"` itself.

The `package.json` audit shortcuts simply echo the prompt path:

```
npm run audit:codebase
npm run audit:architecture
npm run audit:obsidian
npm run audit:refactor-board
```

These scripts intentionally do not run analysis themselves — they exist as
mnemonic entry points.

---

## Output format policy

**Markdown is canonical, always.** Every report is authored in Markdown
and committed under `reports/`. Markdown is what gets diffed, reviewed,
and archived.

**HTML rendering is a presentation layer, not a source.** It exists for
reports that are worth making archival-beautiful — never for routine
cycles. Authoring HTML by hand or generating HTML *instead of* Markdown
is out of scope.

| Cadence | Markdown | HTML rendering |
|---|---|---|
| Weekly Codebase Health | Required | Disabled |
| Weekly Architecture Drift | Required | Disabled |
| Biweekly Obsidian Ecosystem | Required | Disabled (enable per-run for milestone / RC reviews) |
| Monthly Refactor Board | Required | Optional |
| Milestone / RC readiness / annual *State of the Codebase* | Required | Recommended |

The HTML style is **restrained, print-friendly, archival engineering
memo** — single file, inline CSS, no JS, no external assets, no
frameworks, dark/light compatible, typography-first. It should feel like
an internal Apple engineering review, not a SaaS analytics dashboard.
No dashboards, no charts (unless explicitly requested), no animated
widgets, no AI-insight cards, no gradient hero sections. Full HTML
constraints live in the Monthly Refactor Board prompt — other prompts
reference them when they opt in.

To change a track's HTML policy, update the table above **and** update
the OUTPUT FORMAT block in the relevant prompt. Don't change one without
the other.

---

## Longitudinal memory — the "Historical Context" section

Every report template carries a short **Historical Context** section
that classifies each finding (or theme) against the audit archive in
`reports/`. The taxonomy is fixed:

- **New** — first appearance.
- **Regressed** — previously resolved, now back.
- **Previously resolved, resurfaced** — same root cause as an old issue,
  different surface.
- **Chronic hotspot** — present across three or more cycles.
- **Stable or improving** — trending the right way; included so we
  notice and stop fussing.
- **Intentional debt** — a known shortcut, accepted by doctrine or
  schedule.
- **Deferred by doctrine** — a refactor we *chose not to do* and the
  Refactor Board already adjudicated it.

The point isn't bookkeeping. Isolated audits are snapshots; engineering
wisdom comes from trend recognition. After 6–12 months of these reports
the archive answers questions a single snapshot cannot:

- Which systems repeatedly drift?
- Which refactors actually worked?
- Which "urgent" issues were noise?
- Where does churn keep happening?
- Which doctrines survived pressure?

Keep the section short. One row per finding. Notes only when a
classification needs a sentence of justification.

---

## Cadence

- **Weekly (Mondays):** Codebase Health + Architecture Drift.
- **Biweekly (every other Friday):** Obsidian Ecosystem.
- **Monthly (first weekday):** Refactor Board, synthesizing the prior month
  of weekly/biweekly reports.

Skip a cycle when there has been no meaningful product change since the last
report — record the skip in the previous report's "Next cycle" section so the
gap is intentional, not forgotten.

---

## Doctrine the audits enforce

Every recurring audit must read and respect:

- `docs/engineering/INDEX.md`
- `docs/engineering/standards/code-doctrine.md`
- `docs/engineering/standards/inquiry-critical-path-rules.md`
- `docs/engineering/standards/refactor-playbook.md`
- `docs/engineering/standards/feature-audit-playbook.md`
- `docs/engineering/standards/fallback-policy.md`
- `docs/engineering/standards/css-namespace-policy.md`
- `docs/engineering/standards/ui-architecture.md`

Refactor recommendations must **reduce** complexity and remove fallback
logic, not layer new abstractions. When in doubt, recommend **Monitor**
rather than refactor.

---

## Severity scale (used by Refactor Board)

| Severity | Meaning | Default action |
|---|---|---|
| **GREEN** | Healthy. No action. | Do nothing. |
| **YELLOW** | Localized issue. | Targeted cleanup in a single PR. |
| **ORANGE** | Multi-file drift. | Schedule a short stabilization sprint. |
| **RED** | Doctrine violation or actively blocking feature work. | Refactor before more feature work. |

Each recommendation also carries a **confidence** rating (Low / Medium /
High) and an **evidence** section. Low-confidence findings stay as Monitor
until a second audit confirms them.

---

## Product Doctrine Check (Radial Timeline-specific)

Every audit must include a "Product Doctrine Check" section evaluating the
changes against the following Radial Timeline pillars. These are written
to be **testable** — each one names its failure mode so audit agents have
a yardstick, not a vibe.

1. **Author trust** — the writer's words and structural choices are
   sovereign. AI and automation *describe*; they never mutate manuscript
   content without explicit, opt-in, reversible user action.
2. **Non-destructive workflows** — every action is undoable or leaves a
   recoverable previous state. Destructive operations require explicit
   confirmation; silent overwrite is never the default.
3. **Core vs Pro gating consistency** — Pro gates are declared in one
   canonical helper, applied uniformly across every entry point
   (commands, UI affordances, settings, AI runtime), and
   machine-auditable. Ad-hoc `if (isPro)` checks duplicated across the
   codebase are a violation.
4. **Terminology consistency** — Progress, Narrative, Chronologue,
   Gossamer, and Inquiry are used identically across UI, code, docs,
   analytics, and AI prompts. Synonyms, aliases, or surface-specific
   renamings of these terms are a violation.
5. **Obsidian-native behavior** — follow Obsidian conventions for
   keyboard, command palette, settings tab, workspace lifecycle, modal
   Esc / click-outside semantics, and mobile parity. Custom behavior
   that overrides or diverges from native conventions requires
   explicit, documented justification.
6. **Manuscript safety** — never overwrite, lose, silently mutate, or
   auto-replace the writer's `.md` files. Safety artifacts (caches,
   backups, exports, AI passes) must be non-destructive and must not
   become alternate manuscript sources of truth.
7. **Export safety** — exports are reproducible, deterministic, and
   faithful to the canonical manuscript. Exports never mutate the
   source; export failures surface visibly rather than silently
   dropping content.
8. **AI analysis must not become AI prose rewriting** — AI features
   describe, classify, and surface what the manuscript contains. They
   do not rewrite, polish, or substitute prose unless the user
   explicitly invokes a tool whose name and UI are unambiguous about
   rewriting.

Any change that violates one of these is automatically **ORANGE or higher**
regardless of size.

---

## What stays manual vs. what could be automated later

**Stay manual (judgment required):**

- Severity assignment (GREEN / YELLOW / ORANGE / RED).
- "Refactor vs Monitor vs Do Nothing" decisions.
- Product Doctrine Check.
- Obsidian Ecosystem modernization choices.

**Could later be automated (mechanical signals):**

- File-size / function-length thresholds (extend `code-quality-check.mjs`).
- Dead exports (extend `audit:tsc-unused`).
- Unused CSS classes (extend `check-css-duplicates.mjs` / `scan-ert`).
- Duplicate utility detection (jscpd or similar).
- Command-registration drift (grep + schema).

A future `audit:weekly` GitHub Action could run the mechanical checks
nightly and post a Markdown summary to a draft issue, leaving the human
judgment steps (severity, doctrine, refactor decision) for the weekly
review. Do not build this until the manual cadence has produced at least
four reports of each track — pattern first, automation second.
