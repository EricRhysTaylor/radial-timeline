# Biweekly Deep Audit

- Version: 7.7.0
- Branch: main
- Upstream: origin/main
- Baseline: HEAD~1 (a7a95e33)
- Risk Level: High

## Files Changed
- docs/engineering/audits/reports/2026-11-10-daily-control-tower.md
- wiki/Timetable.md
- wiki/images/homepage-outline-note.webp
- wiki/images/homepage-timeline-canvas.webp
- wiki/images/homepage-timeline-panels.webp
- wiki/images/homepage-timetable-full.webp
- Major systems touched: wiki(5), docs(1)

## Recent Commits
- ff5844b8 2026-11-10 [backup] 2026-11-10 15:53 — docs — wiki(5), docs(1) — Daily Control Tower — 6 files — +80/-0
- a7a95e33 2026-11-10 Clear the four lint errors added this week
- 79cf329c 2026-11-10 Bring the 8.0.0 notes up to this week's changes
- dba62925 2026-11-10 Retake the 8.0 Panels, Canvas map and time reference screenshots
- 46ee673a 2026-11-10 Translate the 8.0 strings into every language
- f8da6b14 2026-11-10 Time references: Earlier and Later labels sit level with their marks
- 79cb362a 2026-11-10 Timetable: timeline hover lights rows; only Shift scrolls to them
- 33bd3769 2026-11-10 Time references: hover a source circle to see all of its scene's references
- fffb9dbb 2026-11-10 Time references: line at the mark radius, readable popover
- 1ff15dab 2026-11-10 Preserve decimal scene labels in export ranges
- 94a56c49 2026-11-10 Pictures belong to people and places; a card's menu says where each comes from
- be2a61f4 2026-11-10 Configuration settings use sentence case; vertical icon for the time notation bar
- b3a39269 2026-11-10 Panels: the title stands beside a scene's pictures, and its buttons in a column
- 589a6fb4 2026-11-10 Timeline Display settings get icons; the cue bar becomes the time notation bar
- 835b3b30 2026-11-10 Runtime view freezes the character lanes
- d0a4633e 2026-11-10 Set safer content logging and manuscript rename defaults
- b46bd453 2026-11-10 One set of card image settings for Panels and Canvas, with shared focus points
- c6bad075 2026-11-10 Time references point the way their dates lie, and paint above the backdrops
- 772e07df 2026-11-10 Wiki: Radial Timeline reads BCE dates
- cc2c60d3 2026-11-10 Timetable color key: label a CE year under 1000 as a date

## Validation Gates
- API feature audit: Pass (139ms)
- Model coverage: Pass (87ms)
- CSS duplicates: Pass (98ms)
- Shipped assets: Pass (95ms)
- Production build: Pass (9.6s)
  > tsc --noEmit -p tsconfig.scripts.json
  Build copied to: Author/New/Fresh/Sherlock Holmes/P&P/Timelapse/P&P Demo/Sherlock Demo/Faerie Queene Demo/Odyssey Demo/Miki Projects/Scrivener/release/build
  Production build complete!
- Code quality: Pass (394ms)
  ✅ Code quality check passed!
  📖 See docs/engineering/standards/code-standards.md for full guidelines.
- Obsidian review: Pass (541ms)
  - Runtime network/platform/filesystem checks passed.
  - No eslint-disable directives in shipped source.
  - Release eyeball checklist is present.
- Obsidian lint baseline: Pass (7.7s)
    - @typescript-eslint/no-unnecessary-type-assertion: 0 (baseline 0, delta 0)
    - @typescript-eslint/no-floating-promises: 0 (baseline 0, delta 0)
  [obsidian-lint-enforced] PASS: selected Obsidian lint debt did not increase.
- Obsidian lint (report-only): Pass (17.2s)
  Obsidian lint (report-only): 1 problems total, 1 from obsidianmd rules — top: settings-tab/prefer-setting-definitions(1). See .gate-logs/eslint-obsidian.json.
- CSS drift: Pass (407ms)
    - shadow-rgba: 22 (baseline 22, delta +0)
    - rt-legacy: 504 (baseline 562, delta -58)
  ✅ CSS drift gate passed.
- Unused CSS ratchet: Pass (17.8s)
  Unused CSS: 241 producer-less classes remain (ratchet holds them from growing).
- Compliance: Pass (999ms)
  Compliance: delta -1. See the compliance log.
- Spec coverage: Pass (216ms)
  Allow-listed:  17/50
  Failures:      0/50
  ✅ Audit passed.
- Unit tests: Pass (8.6s)
        Tests  6026 passed | 40 skipped (6066)
     Start at  15:55:37
     Duration  8.28s (transform 15.97s, setup 1.71s, import 74.56s, tests 16.82s, environment 29ms)
- i18n release readiness: Pass (427ms)
  [i18n-release] th: 7022/7022 (100.0%)
  [i18n-release] vi: 7022/7022 (100.0%)
  [i18n-release] Locale source, stale-key, and release bundle checks passed.
- Fallback debt: Fail (794ms)
  Fallback gate summary:
  - total: 2284
    - silent-catch: 17
    - or-chain-3: 0
    - nullish-literal: 1208
    - or-literal: 1032
    - switch-default-return: 27
  Baseline: /Users/ericrhystaylor/Documents/Radial Timeline LLC/Plugin/radial-timeline/scripts/fallback-baseline.json (key: maintenance)
  - baseline total: 2236
  - current total:  2284
  - delta: +48
  Fallback gate failed.
    - total: 2284 > baseline 2236 (delta +48)
    - nullish-literal: 1208 > baseline 1153 (delta +55)
    - switch-default-return: 27 > baseline 26 (delta +1)
  See docs/engineering/standards/fallback-policy.md for the policy and how to fix.
- Pricing drift: Pass (91ms)
  Pricing drift: [check-pricing-drift] age 28d / 30d
- Obsidian version watch: Pass (153ms)
  Obsidian version watch: 🔍 Checking for Obsidian updates...

## Changed-Code Scope
- 6 changed file(s) across: wiki(5), docs(1).
- Scope only. This audit does not perform automated changed-code defect analysis; see Validation Gates above for pass/fail.

## Critical Risks
- Fallback debt failed.

## Notices
- Pricing drift: [check-pricing-drift] age 28d / 30d
- Obsidian version watch: 🔍 Checking for Obsidian updates...

- Overall Repository Health: Needs Attention
- Ship Readiness: Do Not Ship

## Recommended Actions
### Do Now
- Fix failing gate: Fallback debt.
### Schedule Later
- Obsidian lint (report-only): 1 problems total, 1 from obsidianmd rules — top: settings-tab/prefer-setting-definitions(1). See .gate-logs/eslint-obsidian.json.
- Unused CSS: 241 producer-less classes remain (ratchet holds them from growing).
- Compliance: delta -1. See the compliance log.
### Ignore
- None.
