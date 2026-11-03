# Biweekly Deep Audit

- Version: 7.7.0
- Branch: main
- Upstream: origin/main
- Baseline: HEAD~1 (88925c46)
- Risk Level: Low

## Files Changed
- README.md
- docs/privacy-and-security.md
- src/timetable/CanvasCardPresentation.ts
- Major systems touched: docs(1), root(1), src(1)

## Recent Commits
- 88bcfc14 2026-11-03 README: Story Vaults, Timetable and Canvas maps, Story Vault download disclosure
- 88925c46 2026-11-03 Pay fallback debt below baseline; count or-chain-3 per value chain
- 269cbd63 2026-11-03 Replace :has() in Timetable panels with classes
- 368a97f0 2026-11-03 Annotate the edition stamp read fallback
- d366eb8f 2026-11-03 [backup] 2026-11-03 09:17 — docs — docs(1) — Biweekly Deep Audit — 1 files — +120/-0
- 67848e13 2026-11-03 [backup] 2026-11-03 09:15 — docs — docs(1) — Daily Control Tower — 1 files — +18/-16
- 3ed76fac 2026-11-03 Translate Saved views and Restore view instead of spreading English
- 712300f4 2026-11-03 [backup] 2026-11-03 09:10 — docs — docs(1) — Daily Control Tower — 1 files — +67/-0
- 912cff5c 2026-11-03 Drop the last eslint-disable comments from src tests
- 7f1535c5 2026-11-03 Translate the Outline layout and outline import
- 9530ce54 2026-11-03 Draft 8.0.0 release notes with Canvas, Panels, Outline and Story Vaults
- 75bcccbe 2026-11-03 Document 8.0.0 Timetable layouts, Canvas maps and Story Vaults in the wiki
- eceae856 2026-11-03 Pin patched moment for the Obsidian type package
- 1f755caa 2026-11-03 Clear new Obsidian scanner findings in Canvas and Timetable code
- 7356d428 2026-11-03 Use native Canvas zoom selection icon
- e90af106 2026-11-02 Add zoom to selection to Canvas story navigator
- 681d0a62 2026-11-02 Make Canvas follow and hover highlight apparent
- 6cdb0c7d 2026-11-02 Keep beat-only Gossamer separate from scene hover
- 755b547b 2026-11-02 Connect Canvas cards to timeline hover
- 68b28d8d 2026-11-02 Clarify timetable canvas and book controls

## Validation Gates
- API feature audit: Pass (140ms)
- Model coverage: Pass (85ms)
- CSS duplicates: Pass (96ms)
- Shipped assets: Pass (94ms)
- Production build: Pass (9.3s)
  > tsc --noEmit -p tsconfig.scripts.json
  Build copied to: Author/New/Fresh/Sherlock Holmes/P&P/Timelapse/P&P Demo/Sherlock Demo/Faerie Queene Demo/Odyssey Demo/Miki Projects/Scrivener/release/build
  Production build complete!
- Code quality: Pass (363ms)
  ✅ Code quality check passed!
  📖 See docs/engineering/standards/code-standards.md for full guidelines.
- Obsidian review: Pass (515ms)
  - Runtime network/platform/filesystem checks passed.
  - No eslint-disable directives in shipped source.
  - Release eyeball checklist is present.
- Obsidian lint baseline: Pass (8.1s)
    - @typescript-eslint/no-unnecessary-type-assertion: 0 (baseline 0, delta 0)
    - @typescript-eslint/no-floating-promises: 0 (baseline 0, delta 0)
  [obsidian-lint-enforced] PASS: selected Obsidian lint debt did not increase.
- Obsidian lint (report-only): Pass (17.0s)
  Obsidian lint (report-only): 1 problems total, 1 from obsidianmd rules — top: settings-tab/prefer-setting-definitions(1). See .gate-logs/eslint-obsidian.json.
- CSS drift: Pass (411ms)
    - shadow-rgba: 22 (baseline 22, delta +0)
    - rt-legacy: 562 (baseline 562, delta +0)
  ✅ CSS drift gate passed.
- Unused CSS ratchet: Pass (17.7s)
  Unused CSS: 243 producer-less classes remain (ratchet holds them from growing).
- Compliance: Pass (1.0s)
  Compliance: delta -1. See the compliance log.
- Spec coverage: Pass (227ms)
  Allow-listed:  17/50
  Failures:      0/50
  ✅ Audit passed.
- Unit tests: Pass (8.1s)
        Tests  5082 passed | 38 skipped (5120)
     Start at  10:30:58
     Duration  7.71s (transform 15.69s, setup 1.97s, import 67.69s, tests 16.37s, environment 27ms)
- i18n release readiness: Pass (405ms)
  [i18n-release] th: 6735/6735 (100.0%)
  [i18n-release] vi: 6735/6735 (100.0%)
  [i18n-release] Locale source, full coverage, and release bundle checks passed.
- Fallback debt: Pass (789ms)
  - current total:  2236
  - delta: +0
  Fallback gate passed.
- Pricing drift: Pass (92ms)
  Pricing drift: [check-pricing-drift] age 21d / 30d
- Obsidian version watch: Pass (151ms)
  Obsidian version watch: 🔍 Checking for Obsidian updates...

## Changed-Code Scope
- 3 changed file(s) across: docs(1), root(1), src(1).
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
