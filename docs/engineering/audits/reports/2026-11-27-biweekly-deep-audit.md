# Biweekly Deep Audit

- Version: 8.3.0
- Branch: main
- Upstream: origin/main
- Baseline: HEAD~1 (5d39454b)
- Risk Level: High

## Files Changed
- src/styles/writing-studio.css
- Major systems touched: src(1)

## Recent Commits
- 6c99a24f 2026-11-27 Writing Studio: hollow steppers at the dropdowns' height
- 5d39454b 2026-11-27 Writing Studio: fades about two and a half lines tall
- f107b160 2026-11-27 Writing Studio: steppers match the dropdowns; text fades at the edges
- 2fb9058a 2026-11-27 Writing Studio: labeled steppers, an act menu that shows the act, clear edges
- 86a5b8dd 2026-11-27 Writing Studio: the wheel stays put, only the contents scroll
- 04f0938d 2026-11-27 8.3.0 notes: link the Panels picture that shows places
- d10e6655 2026-11-27 Panels picture: the turned panel between two panels showing their places
- 1466396e 2026-11-27 Panels: place background + character by default
- 005373af 2026-11-27 [backup] 2026-11-27 17:56 — docs — docs(1) — Friday Release Gate — 1 files — +96/-0
- 841384aa 2026-11-27 docs: sync release notes for 8.3.0
- 702b31e0 2026-11-27 docs: sync release notes for 8.3.0
- 35574c59 2026-11-27 Release version 8.3.0
- a34592bb 2026-11-27 Wiki for 8.3.0: Writing Studio page, Chapter source, Timetable chapters
- 153037a9 2026-11-27 8.3.0 notes: plain wording, Panels, the turned-over panel picture
- a0132a66 2026-11-27 Writing Studio details close; Timetable Panels are panels
- cb2fb5f0 2026-11-27 Draft release notes for 8.3.0, for approval
- 7752bb01 2026-11-27 Release images for 8.3.0: Writing Studio, Timetable chapters, card reader, Renumber
- 891ed92e 2026-11-27 Renumber copy says what it does; Writing Studio first in the title bar
- 9bef022d 2026-11-27 Renumber the book on demand: Settings, export window and a command
- 506e0b50 2026-11-27 Reorder test: a decimal insert normalized beside a same-title scene

## Validation Gates
- API feature audit: Pass (379ms)
- Model coverage: Pass (126ms)
- CSS duplicates: Pass (157ms)
- Shipped assets: Pass (134ms)
- Production build: Pass (15.2s)
  > tsc --noEmit -p tsconfig.scripts.json
  Build copied to: Author/New/Fresh/Sherlock Holmes/P&P/Model Onboarding/Timelapse/P&P Demo/Sherlock Demo/Faerie Queene Demo/Odyssey Demo/Miki Projects/Scrivener/release/build
  Production build complete!
- Code quality: Pass (643ms)
  ✅ Code quality check passed!
  📖 See docs/engineering/standards/code-standards.md for full guidelines.
- Obsidian review: Pass (801ms)
  - Runtime network/platform/filesystem checks passed.
  - No eslint-disable directives in shipped source.
  - Release eyeball checklist is present.
- Obsidian lint baseline: Pass (12.9s)
    - obsidianmd/prefer-active-doc: 0 (baseline 0, delta 0)
    - obsidianmd/no-tfile-tfolder-cast: 0 (baseline 0, delta 0)
  [obsidian-lint-enforced] PASS: selected Obsidian lint debt did not increase.
- Obsidian lint (report-only): Pass (25.7s)
  Obsidian lint (report-only): 2 problems total, 2 from obsidianmd rules — top: prefer-create-el(2). See .gate-logs/eslint-obsidian.json.
- CSS drift: Pass (628ms)
  > radial-timeline@8.3.0 css-drift
  > node scripts/css-drift-check.mjs --maintenance
  [css-drift] 944 warnings (baseline 1002), 0 failures · full list: .gate-logs/css-drift-report.txt
- Unused CSS ratchet: Pass (24.5s)
      1 src/styles/legacy/rt-ui-legacy.css
      1 src/styles/settings.css
  ✅ Unused CSS ratchet held (240 <= baseline 243).
- Compliance: Pass (1.5s)
  Compliance: 3 below the baseline; lock it in with npm run check-compliance -- --update-baseline.
- Spec coverage: Pass (295ms)
  Allow-listed:  17/50
  Failures:      0/50
  ✅ Audit passed.
- Unit tests: Pass (18.5s)
        Tests  6837 passed | 2 expected fail | 56 skipped (6895)
     Start at  19:37:34
     Duration  17.97s (transform 13.81s, setup 2.19s, import 97.38s, tests 20.65s, environment 44ms)
- i18n release readiness: Pass (597ms)
  [i18n-release] th: 6678/7396 (90.3%), 718 in English
  [i18n-release] vi: 6678/7396 (90.3%), 718 in English
  [i18n-release] Locale source, stale-key, and release bundle checks passed.
- Fallback debt: Fail (1.1s)
  Fallback gate summary:
  - total: 2113
    - silent-catch: 17
    - or-chain-3: 0
    - nullish-literal: 1094
    - or-literal: 979
    - switch-default-return: 23
  Baseline: /Users/ericrhystaylor/Documents/Radial Timeline LLC/Plugin/radial-timeline/scripts/fallback-baseline.json (key: maintenance)
  - baseline total: 2110
  - current total:  2113
  - delta: +3
  Fallback gate failed.
    - total: 2113 > baseline 2110 (delta +3)
    - nullish-literal: 1094 > baseline 1069 (delta +25)
  See docs/engineering/standards/fallback-policy.md for the policy and how to fix.
- Pricing drift: Fail (120ms)
  Pricing drift: [check-pricing-drift] age 11d / 30d
- Obsidian version watch: Pass (320ms)
  Obsidian version watch: 🔍 Checking for Obsidian updates...

## Changed-Code Scope
- 1 changed file(s) across: src(1).
- Scope only. This audit does not perform automated changed-code defect analysis; see Validation Gates above for pass/fail.

## Critical Risks
- Fallback debt failed.
- Pricing drift failed.

## Notices
- Pricing drift: [check-pricing-drift] age 11d / 30d
- Obsidian version watch: 🔍 Checking for Obsidian updates...

- Overall Repository Health: Needs Attention
- Ship Readiness: Do Not Ship

## Recommended Actions
### Do Now
- Fix failing gate: Fallback debt.
- Fix failing gate: Pricing drift.
### Schedule Later
- Obsidian lint (report-only): 2 problems total, 2 from obsidianmd rules — top: prefer-create-el(2). See .gate-logs/eslint-obsidian.json.
- Compliance: 3 below the baseline; lock it in with npm run check-compliance -- --update-baseline.
### Ignore
- None.
