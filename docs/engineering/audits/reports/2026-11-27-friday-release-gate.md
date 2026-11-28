# Friday Release Gate

- Version: 8.4.0
- Branch: main
- Upstream: origin/main
- Baseline: upstream merge-base (a4afee25)
- Risk Level: Low

## Files Changed
- src/data/releaseNotesBundle.json
- Major systems touched: src(1)

## Recent Commits
- fd686b8f 2026-11-27 docs: sync release notes for 8.4.0
- a4afee25 2026-11-27 Release version 8.4.0
- e63229b2 2026-11-27 Draft notes for 8.4.0
- 95e1bf2d 2026-11-27 Recent moves overlay: turning it off redraws the timeline without it
- df1bebd8 2026-11-27 Beats: a beat belongs to the scene it follows, as the demo vaults place them
- d4ae7b92 2026-11-27 Beats as stages: a Beat line in Writing Studio, and a beat hover that lights its stage
- 18c582ce 2026-11-27 Pay fallback debt back under the baseline
- ca1d7cd7 2026-11-27 Scene time: a confirmed cue stays confirmed while you keep writing
- d2aada35 2026-11-27 [backup] 2026-11-27 20:30 — docs — docs(1) — Daily Control Tower — 1 files — +66/-0
- dd33731b 2026-11-27 [backup] 2026-11-27 20:28 — docs — docs(1) — Biweekly Deep Audit — 1 files — +123/-0
- 6c99a24f 2026-11-27 Writing Studio: hollow steppers at the dropdowns' height
- 5d39454b 2026-11-27 Writing Studio: fades about two and a half lines tall

## Validation Gates
- API feature audit: Pass (203ms)
- Model coverage: Pass (121ms)
- CSS duplicates: Pass (136ms)
- Shipped assets: Pass (129ms)
- Production build: Pass (13.7s)
  Build copied to: Author/New/Fresh/Sherlock Holmes/P&P/Model Onboarding/Timelapse/P&P Demo/Sherlock Demo/Faerie Queene Demo/Odyssey Demo/Miki Projects/Scrivener/release/build
  Production build complete!
- Code quality: Pass (568ms)
  ✅ Code quality check passed!
  📖 See docs/engineering/standards/code-standards.md for full guidelines.
- Obsidian review: Pass (765ms)
  - Runtime network/platform/filesystem checks passed.
  - No eslint-disable directives in shipped source.
  - Release eyeball checklist is present.
- Obsidian lint baseline: Pass (12.0s)
    - obsidianmd/prefer-active-doc: 0 (baseline 0, delta 0)
    - obsidianmd/no-tfile-tfolder-cast: 0 (baseline 0, delta 0)
  [obsidian-lint-enforced] PASS: selected Obsidian lint debt did not increase.
- Obsidian lint (report-only): Pass (25.6s)
  Obsidian lint (report-only): 2 problems total, 2 from obsidianmd rules — top: prefer-create-el(2). See .gate-logs/eslint-obsidian.json.
- CSS drift: Pass (602ms)
  [css-drift] 944 warnings (baseline 1002), 0 failures · full list: .gate-logs/css-drift-report.txt
- Unused CSS ratchet: Pass (24.1s)
      1 src/styles/legacy/rt-ui-legacy.css
      1 src/styles/settings.css
  ✅ Unused CSS ratchet held (240 <= baseline 243).
- Compliance: Pass (1.5s)
  Compliance: 3 below the baseline; lock it in with npm run check-compliance -- --update-baseline.
- Spec coverage: Pass (293ms)
  Allow-listed:  17/50
  Failures:      0/50
  ✅ Audit passed.
- Unit tests: Pass (17.1s)
        Tests  6848 passed | 2 expected fail | 56 skipped (6906)
     Start at  21:53:20
     Duration  16.55s (transform 13.77s, setup 1.96s, import 87.24s, tests 20.06s, environment 39ms)
- i18n release readiness: Pass (581ms)
  [i18n-release] th: 6678/7397 (90.3%), 719 in English
  [i18n-release] vi: 6678/7397 (90.3%), 719 in English
  [i18n-release] Locale source, stale-key, and release bundle checks passed.

## Changed-Code Scope
- 1 changed file(s) across: src(1).
- Scope only. This audit does not perform automated changed-code defect analysis; see Validation Gates above for pass/fail.

## Critical Risks
- None.

## Notices
- None.

- Overall Repository Health: Excellent
- Ship Readiness: Ship

## Recommended Actions
### Do Now
- None.
### Schedule Later
- Obsidian lint (report-only): 2 problems total, 2 from obsidianmd rules — top: prefer-create-el(2). See .gate-logs/eslint-obsidian.json.
- Compliance: 3 below the baseline; lock it in with npm run check-compliance -- --update-baseline.
### Ignore
- None.
