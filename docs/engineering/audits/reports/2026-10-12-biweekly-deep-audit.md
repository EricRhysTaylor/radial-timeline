# Biweekly Deep Audit

- Version: 7.4.0
- Branch: main
- Upstream: origin/main
- Baseline: HEAD~1 (41fe233a)
- Risk Level: High

## Files Changed
- docs/engineering/audits/reports/2026-10-12-daily-control-tower.md
- docs/releases/preparation-7.5.0.md
- wiki/Pro.md
- wiki/Radial-Timeline-View.md
- wiki/YAML-Frontmatter.md
- Major systems touched: wiki(3), docs(2)

## Recent Commits
- c01c3640 2026-10-12 [backup] 2026-10-12 17:21 — docs — docs(2) — Daily Control Tower — 2 files — +107/-0
- 41fe233a 2026-10-12 docs: prepare 7.5.0 notes and document Timetable, placement and publishing
- 33ecb1d3 2026-10-12 Watch lists: add Volume 10 — Quick Start
- c4373cb9 2026-10-12 Plan: record the scene highlighter fix
- 3a2fcb01 2026-10-12 Fix scene highlighting from the file explorer and tab headers; Timetable row hover
- b290d918 2026-10-12 Timetable refinements from Eric's first look at a real book
- eeee0f41 2026-10-12 Plan: Timetable built (phases 1 and 2), with differences and open items
- 2637f956 2026-10-12 Timetable and Promote: fixes from the visual check
- 7de9ce72 2026-10-12 Timetable: one instrument with the wheel
- c562cf06 2026-10-12 Timetable: sketches, the sketch drawer and open queries
- 72ff559c 2026-10-12 Add the Timetable: a Bases view of the book beside the timeline
- 38641130 2026-10-12 AI: retired model pins move to their same-lane successor
- df7dd9be 2026-10-12 One When formatter for the hover and the Timeline table
- 7fa04de9 2026-10-12 model(promote): Claude Haiku 5.5 replacing Claude Haiku 4.5; Sonnet 5.5 cache-read price fix
- 04493389 2026-10-12 Project metadata: describe Description as community-site details
- 602dcb0d 2026-10-12 Model registry refresh 2026-10-11: lifecycle fields on Anthropic models
- 4501e1fb 2026-10-12 Add Promote to scene
- 7a9db60b 2026-10-12 Plan: include Act and Status boards in each book's table
- 3fa3da27 2026-10-12 Plan: review Obsidian 1.14 Bases features for the Timeline table
- 58924b92 2026-10-12 Plan: all Timeline tables together in Radial Timeline/Tables

## Validation Gates
- API feature audit: Pass (75ms)
- Model coverage: Pass (33ms)
- CSS duplicates: Pass (46ms)
- Shipped assets: Pass (41ms)
- Production build: Pass (7.2s)
  Production build: npm warn Unknown env config "global-ignore-file". This will stop working in the next major version of npm. See `npm help npmrc` for supported config options.
- Code quality: Pass (275ms)
  ✅ Code quality check passed!
  📖 See docs/engineering/standards/code-standards.md for full guidelines.
- Obsidian review: Pass (355ms)
  Obsidian review: npm warn Unknown env config "global-ignore-file". This will stop working in the next major version of npm. See `npm help npmrc` for supported config options.
- Obsidian lint baseline: Pass (6.0s)
  Obsidian lint baseline: npm warn Unknown env config "global-ignore-file". This will stop working in the next major version of npm. See `npm help npmrc` for supported config options.
- Obsidian lint (report-only): Pass (13.3s)
  Obsidian lint (report-only): 17 problems total, 1 from obsidianmd rules — top: settings-tab/prefer-setting-definitions(1). See .gate-logs/eslint-obsidian.json.
- CSS drift: Pass (281ms)
    - shadow-rgba: 20 (baseline 22, delta -2)
    - rt-legacy: 537 (baseline 562, delta -25)
  ✅ CSS drift gate passed.
- Unused CSS ratchet: Pass (11.7s)
  Unused CSS: 243 producer-less classes remain (ratchet holds them from growing).
- Compliance: Pass (731ms)
    - node-core-require: 6 / 6 (+0)
    - raw-addEventListener: 80 / 80 (+0)
  ✅ Compliance maintenance gate passed (no regressions vs baseline).
- Spec coverage: Pass (111ms)
  Spec coverage: npm warn Unknown env config "global-ignore-file". This will stop working in the next major version of npm. See `npm help npmrc` for supported config options.
- Unit tests: Pass (5.3s)
  Unit tests: npm warn Unknown env config "global-ignore-file". This will stop working in the next major version of npm. See `npm help npmrc` for supported config options.
- i18n release readiness: Pass (176ms)
  [i18n-release] ko: 6248/6248 (100.0%)
  [i18n-release] de: 6248/6248 (100.0%)
  [i18n-release] Locale source, full coverage, and release bundle checks passed.
- Fallback debt: Fail (134ms)
  Fallback gate summary:
  - total: 2287
    - silent-catch: 17
    - or-chain-3: 73
    - nullish-literal: 1123
    - or-literal: 1049
    - switch-default-return: 25
  Baseline: /Users/ericrhystaylor/Documents/Radial Timeline LLC/Plugin/radial-timeline/scripts/fallback-baseline.json (key: maintenance)
  - baseline total: 2497
  - current total:  2287
  - delta: -210
  Fallback gate failed.
    - or-chain-3: 73 > baseline 52 (delta +21)
  See docs/engineering/standards/fallback-policy.md for the policy and how to fix.
- Pricing drift: Pass (37ms)
  Pricing drift: [check-pricing-drift] age 0d / 30d
- Obsidian version watch: Pass (105ms)
  Obsidian version watch: 🔍 Checking for Obsidian updates...

## Changed-Code Scope
- 5 changed file(s) across: wiki(3), docs(2).
- Scope only. This audit does not perform automated changed-code defect analysis; see Validation Gates above for pass/fail.

## Critical Risks
- Fallback debt failed.

## Notices
- Production build: npm warn Unknown env config "global-ignore-file". This will stop working in the next major version of npm. See `npm help npmrc` for supported config options.
- Obsidian review: npm warn Unknown env config "global-ignore-file". This will stop working in the next major version of npm. See `npm help npmrc` for supported config options.
- Obsidian lint baseline: npm warn Unknown env config "global-ignore-file". This will stop working in the next major version of npm. See `npm help npmrc` for supported config options.
- Spec coverage: npm warn Unknown env config "global-ignore-file". This will stop working in the next major version of npm. See `npm help npmrc` for supported config options.
- Unit tests: npm warn Unknown env config "global-ignore-file". This will stop working in the next major version of npm. See `npm help npmrc` for supported config options.
- Pricing drift: [check-pricing-drift] age 0d / 30d
- Obsidian version watch: 🔍 Checking for Obsidian updates...

- Overall Repository Health: Needs Attention
- Ship Readiness: Do Not Ship

## Recommended Actions
### Do Now
- Fix failing gate: Fallback debt.
### Schedule Later
- Obsidian lint (report-only): 17 problems total, 1 from obsidianmd rules — top: settings-tab/prefer-setting-definitions(1). See .gate-logs/eslint-obsidian.json.
- Unused CSS: 243 producer-less classes remain (ratchet holds them from growing).
### Ignore
- None.
