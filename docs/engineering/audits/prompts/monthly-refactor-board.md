# Prompt: Monthly Refactor Recommendation Board

You are running the **Monthly Refactor Recommendation Board** for the
Radial Timeline plugin. Your job is to **synthesize** the prior month of
weekly Codebase Health, weekly Architecture Drift, and biweekly Obsidian
Ecosystem reports into a single severity-ranked decision board. You do
**not** modify product code.

## Before you begin

Read:

- `docs/engineering/INDEX.md`
- `docs/engineering/standards/refactor-playbook.md`
- `docs/engineering/standards/code-doctrine.md`
- `docs/engineering/standards/feature-audit-playbook.md`
- `docs/engineering/audits/README.md`
- Every report in `docs/engineering/audits/reports/` dated within the last
  ~35 days. List the report filenames you actually loaded.
- The previous Refactor Board report, if one exists. Carry forward any
  open items and note status changes.

Template:
`docs/engineering/audits/templates/refactor-board-report.md`. Save to
`docs/engineering/audits/reports/YYYY-MM-DD-refactor-board.md`.

## Method

1. **Collect** every finding from the prior cycle, with its original ID
   (`CH-…`, `AD-…`, `OE-…`).
2. **Cluster** related findings into themes (e.g. "InquiryView cache
   ownership", "command registration drift", "CSS theme-variable
   adoption"). One row per theme on the board, not per finding.
3. **Assess** each theme against the severity scale below.
4. **Decide** the action: `Refactor` / `Fine-tune` / `Monitor` / `Do
   Nothing`.
5. **Sequence** the actions across the upcoming month, with stop
   conditions.

## Severity scale

| Severity | Meaning | Default action |
|---|---|---|
| **GREEN** | Healthy, or resolved since last board. | Do nothing. |
| **YELLOW** | Localized issue. | Fine-tune in one PR. |
| **ORANGE** | Multi-file drift or repeated finding across two+ cycles. | Stabilization sprint. |
| **RED** | Doctrine violation or actively blocking feature work. | Refactor before more feature work. |

A theme appearing in three or more consecutive cycles auto-promotes by
one severity level until it is resolved.

## For each board entry, record

- **Theme name**
- **Severity** (GREEN / YELLOW / ORANGE / RED)
- **Confidence** (Low / Medium / High)
- **Decision** (Refactor / Fine-tune / Monitor / Do Nothing)
- **Evidence** — list of source finding IDs and file citations.
- **Risk if ignored** — concrete consequence, not generic "tech debt".
- **Estimated effort** — hours/days/weeks (rough).
- **Recommended sequence** — what must happen before, during, after.
- **Stop condition** — when would you abandon or downgrade this effort?
- **Product Doctrine relevance** — which pillars are at stake, if any.

## Rules

- Recommend a refactor **only when evidence supports it**. If the
  evidence is one finding from one cycle, the decision is **Monitor**
  unless a doctrine pillar is at stake.
- Refactors must **reduce complexity** and remove fallback logic, per
  `docs/engineering/standards/refactor-playbook.md`. Reject any proposal
  that adds an abstraction layer without removing two.
- Always include a **"Do Nothing / Monitor"** column on the board. Most
  themes should sit there.
- Note any theme being **downgraded** from a prior board (e.g. ORANGE →
  YELLOW) and the evidence supporting the downgrade.

## Product Doctrine Check (board-level)

Evaluate the **whole codebase trajectory** for the month, not just
individual findings:

- Author trust — any new path where AI or automation mutates manuscript
  content without explicit, opt-in, reversible user action?
- Non-destructive workflows — any new destructive path without a
  recoverable previous state or a confirmation gate?
- Core vs Pro gating consistency — are gates still declared in one
  canonical helper and applied uniformly across every entry point, or
  have ad-hoc `if (isPro)` checks reappeared?
- Terminology consistency — have any synonyms, aliases, or
  surface-specific renamings of Progress / Narrative / Chronologue /
  Gossamer / Inquiry crept in?
- Obsidian-native behavior — any lifecycle leaks, custom behavior that
  overrides native conventions without documented justification, or
  mobile-parity regressions?
- Manuscript safety — any new write path to `.md` files? Are safety
  artifacts (caches, backups, exports, AI passes) still non-destructive,
  and have any of them started behaving like an alternate source of
  truth?
- Export safety — any new export format? Is it reproducible and
  deterministic? Do failures surface visibly rather than silently
  dropping content?
- AI analysis vs prose rewriting — has any AI feature crept toward
  rewriting, polishing, or substituting prose outside an explicitly-named
  rewriting tool?

Any pillar violation becomes its own **RED** board entry regardless of
whether it appeared in the source reports.

## Output

Fill the template. Lead with the board table. Keep total length under
1500 lines. End with a one-paragraph **executive summary** the maintainer
can read in 30 seconds.

## OUTPUT FORMAT

Primary output must always be valid Markdown suitable for:
- git versioning
- long-term archival
- code review
- diffing

### Optional HTML rendering — ENABLED for this cadence

After the Markdown report, you **may** additionally provide a restrained
single-file HTML rendering of the same content. The Markdown report is
canonical; the HTML is a presentation layer only — never the source.

Constraints:

- Inline CSS only.
- No JavaScript.
- No external assets (no web fonts, no remote stylesheets, no images
  loaded from URLs).
- No frameworks (no Tailwind, no Bootstrap, no React, no anything).
- Single file, self-contained, `lang="en"`, valid HTML5.
- Print-friendly layout (A4 / US Letter — sensible margins, no
  background fills behind content, page-breaks before each top-level
  section).
- Dark/light compatible — use `prefers-color-scheme` media queries with
  neutral palettes; no hard-coded brand colors.
- Typography-first: system font stack, generous line-height, clear
  hierarchy, table cells that read cleanly at body size.
- An optional sticky in-page table of contents is allowed, but only as a
  plain anchor list with `position: sticky` — no scroll-tracking JS.
- Severity callouts use a small left border accent + label, not a fill.

The HTML should feel like:
- an internal engineering review document
- a premium editorial report
- calm and archival

Avoid:
- dashboards
- charts (unless the human reviewer explicitly requested one)
- flashy visualizations
- SaaS aesthetics
- animated UI
- excessive color
- "AI insights" widgets, metric donuts, gradient cards, glow effects

Prioritize:
- readability
- hierarchy
- scanning
- long-session review comfort
- side-by-side diff review of the Markdown source

Save the HTML alongside the Markdown report with the same basename and
an `.html` extension:
`docs/engineering/audits/reports/YYYY-MM-DD-refactor-board.md`
`docs/engineering/audits/reports/YYYY-MM-DD-refactor-board.html`
