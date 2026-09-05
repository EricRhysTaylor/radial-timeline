# Prompt: Weekly Codebase Health Audit

You are running the **Weekly Codebase Health Audit** for the Radial Timeline
Obsidian plugin. Your job is to detect mechanical drift and produce a
prioritized cleanup list. You do **not** modify product code.

## Before you begin

Read the following so your recommendations align with project doctrine:

- `docs/engineering/INDEX.md`
- `docs/engineering/standards/code-doctrine.md`
- `docs/engineering/standards/refactor-playbook.md`
- `docs/engineering/standards/feature-audit-playbook.md`
- `docs/engineering/standards/fallback-policy.md`
- `docs/engineering/audits/README.md`

Use the report template at
`docs/engineering/audits/templates/codebase-health-report.md`. Save the
finished report to
`docs/engineering/audits/reports/YYYY-MM-DD-codebase-health.md`.

## Scope

Inspect, at minimum:

- `src/` — TypeScript source (all subdirs).
- `styles.css` and `src/styles/` — CSS scope and growth.
- `tests/` and any `*.test.ts` files near source.
- `scripts/` — only flag duplication or dead scripts; do not propose
  refactors here unless they block the product code.

Skip: `node_modules/`, `release/`, `main.js`, `vault-restore-point/`,
`private-patent-docs/`, `.gate-logs/`.

## What to look for

For each finding, cite specific files and line ranges.

1. **Large files** — TypeScript files over ~600 lines or CSS files over
   ~1500 lines. Note the largest 10 by line count and call out any that
   grew >15% since the last weekly report (if a prior report exists in
   `reports/`).
2. **Long methods / functions** — bodies over ~80 lines, or with
   cyclomatic complexity that's visibly high (deep nesting, many branches).
3. **Duplicated utilities** — near-identical helpers in different files.
   Look especially at date/time helpers, file-path helpers, debounce/throttle,
   formatters, and DOM builders.
4. **Dead exports** — exported symbols with zero in-repo references.
   Cross-check `npm run audit:tsc-unused` output if available.
5. **Unused CSS** — `ert-*` classes (and any stragglers) with no producer
   in TS/HTML. Coordinate with `scripts/scan-ert-classes.mjs` if it runs.
6. **Brittle tests** — tests that skip, are `.only`'d, depend on real
   time/clocks/network, or rely on snapshot comparisons without normalization.
7. **Rising complexity** — files with many `if/else if` chains, deeply
   nested conditionals, or growing switch statements. Flag candidates for
   pattern simplification (do not propose the simplification here — that's
   the Refactor Board's job).
8. **Failing patterns** — fallback chains, try/catch swallowing errors,
   `any` types in new code, magic numbers, console.log left in product code,
   `// TODO` / `// FIXME` older than 30 days.
9. **Build-output health** — note the size of `main.js` and `styles.css`
   from the last build, if visible.

## Rules

- Cite file paths with line ranges (e.g. `src/inquiry/InquiryView.ts:412-489`).
- Distinguish **Confirmed** findings (grep/read evidence) from **Hypothesis**
  findings (pattern-matched but not verified).
- Recommend the smallest unit of action. Prefer **YELLOW: targeted cleanup**.
- Do **not** propose architectural refactors — escalate those to the
  Architecture Drift audit by adding them to the report's "Escalations"
  section.
- Include a **"Do Nothing / Monitor"** category for findings that are real
  but not yet worth acting on. Note what would change your mind.
- Every recommendation must include: **risk**, **effort**, **confidence**,
  **suggested next action**, and a **category** from:
  `cleanup | stabilization | modernization | doctrine correction | test hardening | no action`.

## Product Doctrine Check

Before finalizing, scan recent diffs (`git log --since="14 days ago" --stat`)
and flag any change that touches:

- Author trust
- Non-destructive workflows
- Core vs Pro gating consistency
- Terminology consistency (Progress, Narrative, Chronologue, Gossamer, Inquiry)
- Obsidian-native behavior
- Manuscript safety
- Export safety
- AI analysis vs AI prose rewriting boundary

A doctrine violation auto-promotes the related finding to **ORANGE** or
**RED**.

## Output

Fill the report template. Keep prose tight. Under 800 lines total. Number
findings so the Refactor Board can reference them as `CH-2026-05-19-#3`.

## OUTPUT FORMAT

Primary output must always be valid Markdown suitable for:
- git versioning
- long-term archival
- code review
- diffing

**HTML rendering for this cadence: DISABLED.** Weekly Codebase Health is a
high-frequency, diff-oriented report — keep it Markdown-only. Do not emit
an HTML version even if asked, unless this policy is changed in
`docs/engineering/audits/README.md`.

(The shared HTML style policy below applies only on tracks that explicitly
enable HTML — see the Monthly Refactor Board prompt for an example.)
