# Biweekly Deep Audit

- Version: 7.7.0
- Branch: main
- Upstream: origin/main
- Baseline: HEAD~1 (3ed76fac)
- Risk Level: High

## Files Changed
- docs/engineering/audits/reports/2026-11-03-daily-control-tower.md
- Major systems touched: docs(1)

## Recent Commits
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
- 47d02b27 2026-11-02 Keep Canvas act labels visible when zoomed out
- 7b8172d8 2026-11-02 Expose canvas maps and timeline tooltips
- 162f38b1 2026-11-02 Make quick workspaces available across timetable layouts
- a64a2f0a 2026-11-02 Group panel image controls together
- f6b96b6d 2026-11-02 Clarify timetable layouts and saved views

## Validation Gates
- API feature audit: Pass (140ms)
- Model coverage: Pass (86ms)
- CSS duplicates: Pass (96ms)
- Shipped assets: Pass (92ms)
- Production build: Pass (9.1s)
  > tsc --noEmit -p tsconfig.scripts.json
  Build copied to: Author/New/Fresh/Sherlock Holmes/P&P/Timelapse/P&P Demo/Sherlock Demo/Faerie Queene Demo/Odyssey Demo/Miki Projects/Scrivener/release/build
  Production build complete!
- Code quality: Pass (361ms)
  ✅ Code quality check passed!
  📖 See docs/engineering/standards/code-standards.md for full guidelines.
- Obsidian review: Pass (507ms)
  - Runtime network/platform/filesystem checks passed.
  - No eslint-disable directives in shipped source.
  - Release eyeball checklist is present.
- Obsidian lint baseline: Pass (7.8s)
    - @typescript-eslint/no-unnecessary-type-assertion: 0 (baseline 0, delta 0)
    - @typescript-eslint/no-floating-promises: 0 (baseline 0, delta 0)
  [obsidian-lint-enforced] PASS: selected Obsidian lint debt did not increase.
- Obsidian lint (report-only): Pass (16.0s)
  Obsidian lint (report-only): 1 problems total, 1 from obsidianmd rules — top: settings-tab/prefer-setting-definitions(1). See .gate-logs/eslint-obsidian.json.
- CSS drift: Pass (392ms)
    - shadow-rgba: 22 (baseline 22, delta +0)
    - rt-legacy: 562 (baseline 562, delta +0)
  ✅ CSS drift gate passed.
- Unused CSS ratchet: Pass (17.3s)
  Unused CSS: 243 producer-less classes remain (ratchet holds them from growing).
- Compliance: Pass (975ms)
  Compliance: delta -1. See the compliance log.
- Spec coverage: Pass (212ms)
  Allow-listed:  17/50
  Failures:      0/50
  ✅ Audit passed.
- Unit tests: Pass (7.3s)
        Tests  5079 passed | 38 skipped (5117)
     Start at  09:17:32
     Duration  6.93s (transform 14.63s, setup 1.62s, import 60.97s, tests 13.01s, environment 27ms)
- i18n release readiness: Pass (390ms)
  [i18n-release] th: 6735/6735 (100.0%)
  [i18n-release] vi: 6735/6735 (100.0%)
  [i18n-release] Locale source, full coverage, and release bundle checks passed.
- Fallback debt: Fail (213ms)
  Fallback gate summary:
  - total: 2437
    - silent-catch: 18
    - or-chain-3: 101
    - nullish-literal: 1246
    - or-literal: 1046
    - switch-default-return: 26
  Baseline: /Users/ericrhystaylor/Documents/Radial Timeline LLC/Plugin/radial-timeline/scripts/fallback-baseline.json (key: maintenance)
  - baseline total: 2497
  - current total:  2437
  - delta: -60
  Fallback gate failed.
    - or-chain-3: 101 > baseline 52 (delta +49)
    - nullish-literal: 1246 > baseline 1170 (delta +76)
  See docs/engineering/standards/fallback-policy.md for the policy and how to fix.
- Pricing drift: Pass (90ms)
  Pricing drift: [check-pricing-drift] age 20d / 30d
- Obsidian version watch: Pass (178ms)
  Obsidian version watch: 🔍 Checking for Obsidian updates...

## Changed-Code Scope
- 1 changed file(s) across: docs(1).
- Scope only. This audit does not perform automated changed-code defect analysis; see Validation Gates above for pass/fail.

## Critical Risks
- Fallback debt failed.

## Notices
- Pricing drift: [check-pricing-drift] age 20d / 30d
- Obsidian version watch: 🔍 Checking for Obsidian updates...

- Overall Repository Health: Needs Attention
- Ship Readiness: Do Not Ship

## Recommended Actions
### Do Now
- Fix failing gate: Fallback debt.
### Schedule Later
- Obsidian lint (report-only): 1 problems total, 1 from obsidianmd rules — top: settings-tab/prefer-setting-definitions(1). See .gate-logs/eslint-obsidian.json.
- Unused CSS: 243 producer-less classes remain (ratchet holds them from growing).
- Compliance: delta -1. See the compliance log.
### Ignore
- None.
