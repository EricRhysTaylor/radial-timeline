# Biweekly Deep Audit

- Version: 7.7.0
- Branch: main
- Upstream: origin/main
- Baseline: HEAD~1 (aaf9af8f)
- Risk Level: Low

## Files Changed
- docs/engineering/audits/reports/2026-11-03-daily-control-tower.md
- Major systems touched: docs(1)

## Recent Commits
- 00065a0a 2026-11-03 [backup] 2026-11-03 19:01 — docs — docs(1) — Daily Control Tower — 1 files — +20/-16
- aaf9af8f 2026-11-03 Keep Canvas cards to notes in a book
- 2628088d 2026-11-03 [backup] 2026-11-03 16:27 — docs — docs(1) — Biweekly Deep Audit — 1 files — +34/-36
- 9de62d99 2026-11-03 [backup] 2026-11-03 16:24 — docs — docs(1) — Daily Control Tower — 1 files — +22/-25
- 9ca7ded8 2026-11-03 Note the Canvas default and pin the new map image in the 8.0.0 notes
- a70baad8 2026-11-03 Update the Canvas map image and card docs for 8.0.0
- d73393cc 2026-11-03 Show the note editor when a Canvas card is edited
- d13d6264 2026-11-03 Compact Canvas card metadata
- 9f05e6d4 2026-11-03 docs(brand): call the visualization a circular timeline, not "a radial timeline"
- d9cdaf98 2026-11-03 Default Canvas cards to Preview
- e01c0a26 2026-11-03 Match the Canvas card view order in the wiki and 8.0.0 notes
- 3811c498 2026-11-03 [backup] 2026-11-03 10:31 — docs — docs(1) — Biweekly Deep Audit — 1 files — +30/-79
- ff3fd546 2026-11-03 Reorder Canvas card view options
- 88bcfc14 2026-11-03 README: Story Vaults, Timetable and Canvas maps, Story Vault download disclosure
- 88925c46 2026-11-03 Pay fallback debt below baseline; count or-chain-3 per value chain
- 269cbd63 2026-11-03 Replace :has() in Timetable panels with classes
- 368a97f0 2026-11-03 Annotate the edition stamp read fallback
- d366eb8f 2026-11-03 [backup] 2026-11-03 09:17 — docs — docs(1) — Biweekly Deep Audit — 1 files — +120/-0
- 67848e13 2026-11-03 [backup] 2026-11-03 09:15 — docs — docs(1) — Daily Control Tower — 1 files — +18/-16
- 3ed76fac 2026-11-03 Translate Saved views and Restore view instead of spreading English

## Validation Gates
- API feature audit: Pass (148ms)
- Model coverage: Pass (89ms)
- CSS duplicates: Pass (100ms)
- Shipped assets: Pass (94ms)
- Production build: Pass (9.3s)
  > tsc --noEmit -p tsconfig.scripts.json
  Build copied to: Author/New/Fresh/Sherlock Holmes/P&P/Timelapse/P&P Demo/Sherlock Demo/Faerie Queene Demo/Odyssey Demo/Miki Projects/Scrivener/release/build
  Production build complete!
- Code quality: Pass (406ms)
  ✅ Code quality check passed!
  📖 See docs/engineering/standards/code-standards.md for full guidelines.
- Obsidian review: Pass (550ms)
  - Runtime network/platform/filesystem checks passed.
  - No eslint-disable directives in shipped source.
  - Release eyeball checklist is present.
- Obsidian lint baseline: Pass (7.5s)
    - @typescript-eslint/no-unnecessary-type-assertion: 0 (baseline 0, delta 0)
    - @typescript-eslint/no-floating-promises: 0 (baseline 0, delta 0)
  [obsidian-lint-enforced] PASS: selected Obsidian lint debt did not increase.
- Obsidian lint (report-only): Pass (16.6s)
  Obsidian lint (report-only): 1 problems total, 1 from obsidianmd rules — top: settings-tab/prefer-setting-definitions(1). See .gate-logs/eslint-obsidian.json.
- CSS drift: Pass (401ms)
    - shadow-rgba: 22 (baseline 22, delta +0)
    - rt-legacy: 562 (baseline 562, delta +0)
  ✅ CSS drift gate passed.
- Unused CSS ratchet: Pass (17.4s)
  Unused CSS: 243 producer-less classes remain (ratchet holds them from growing).
- Compliance: Pass (992ms)
  Compliance: delta -1. See the compliance log.
- Spec coverage: Pass (227ms)
  Allow-listed:  17/50
  Failures:      0/50
  ✅ Audit passed.
- Unit tests: Pass (7.7s)
        Tests  5085 passed | 38 skipped (5123)
     Start at  19:04:04
     Duration  7.29s (transform 14.99s, setup 1.76s, import 62.92s, tests 16.31s, environment 28ms)
- i18n release readiness: Pass (395ms)
  [i18n-release] th: 6735/6735 (100.0%)
  [i18n-release] vi: 6735/6735 (100.0%)
  [i18n-release] Locale source, full coverage, and release bundle checks passed.
- Fallback debt: Pass (795ms)
  - current total:  2236
  - delta: +0
  Fallback gate passed.
- Pricing drift: Pass (95ms)
  Pricing drift: [check-pricing-drift] age 21d / 30d
- Obsidian version watch: Pass (183ms)
  Obsidian version watch: 🔍 Checking for Obsidian updates...

## Changed-Code Scope
- 1 changed file(s) across: docs(1).
- Scope only. This audit does not perform automated changed-code defect analysis; see Validation Gates above for pass/fail.

## Critical Risks
- None.

## Notices
- Pricing drift: [check-pricing-drift] age 21d / 30d
- Obsidian version watch: 🔍 Checking for Obsidian updates...

- Overall Repository Health: Excellent
- Ship Readiness: Ship

## Recommended Actions
### Do Now
- None.
### Schedule Later
- Obsidian lint (report-only): 1 problems total, 1 from obsidianmd rules — top: settings-tab/prefer-setting-definitions(1). See .gate-logs/eslint-obsidian.json.
- Unused CSS: 243 producer-less classes remain (ratchet holds them from growing).
- Compliance: delta -1. See the compliance log.
### Ignore
- None.
