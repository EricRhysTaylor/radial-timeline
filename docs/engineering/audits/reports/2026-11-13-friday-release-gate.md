# Friday Release Gate

- Version: 8.0.4
- Branch: main
- Upstream: origin/main
- Baseline: upstream merge-base (b566b4f1)
- Risk Level: Low

## Files Changed
- src/data/releaseNotesBundle.json
- Major systems touched: src(1)

## Recent Commits
- 01362851 2026-11-13 docs: sync release notes for 8.0.4
- b566b4f1 2026-11-13 docs: add the Beat Manager how-to and Beats Update Short to the README and wiki
- ab3f53f7 2026-11-13 Release version 8.0.4
- 89e17887 2026-11-13 Help links open docs.radialtimeline.com instead of the GitHub wiki
- 048b151b 2026-11-13 Publish wiki: redeploy docs.radialtimeline.com afterwards
- aab8a2a9 2026-11-13 feat(videos): the workflow video button in YouTube red
- 9bf343c2 2026-11-13 feat(videos): a gold play button, first, for workflow videos
- c0636a2f 2026-11-13 Add scene-specific Canvas background shade
- a3672658 2026-11-13 Restore separate settings rows in the dashboard
- ce148280 2026-11-13 Docs: story map review, lane switch, text drops, settings search, 8.0.4 draft
- 38b2cbe5 2026-11-13 Keep scene-break dialogue in exported manuscripts
- 28859a1f 2026-11-13 Keep story map details while Canvas files sync

## Validation Gates
- API feature audit: Pass (133ms)
- Model coverage: Pass (79ms)
- CSS duplicates: Pass (88ms)
- Shipped assets: Pass (87ms)
- Production build: Pass (8.9s)
  > tsc --noEmit -p tsconfig.scripts.json
  Build copied to: Author/New/Fresh/Sherlock Holmes/P&P/Timelapse/P&P Demo/Sherlock Demo/Faerie Queene Demo/Odyssey Demo/Miki Projects/Scrivener/release/build
  Production build complete!
- Code quality: Pass (382ms)
  ✅ Code quality check passed!
  📖 See docs/engineering/standards/code-standards.md for full guidelines.
- Obsidian review: Pass (545ms)
  - Runtime network/platform/filesystem checks passed.
  - No eslint-disable directives in shipped source.
  - Release eyeball checklist is present.
- Obsidian lint baseline: Pass (7.8s)
    - @typescript-eslint/no-unnecessary-type-assertion: 0 (baseline 0, delta 0)
    - @typescript-eslint/no-floating-promises: 0 (baseline 0, delta 0)
  [obsidian-lint-enforced] PASS: selected Obsidian lint debt did not increase.
- Obsidian lint (report-only): Pass (16.9s)
  Obsidian lint (report-only): 1 problems total, 0 from obsidianmd rules — top: none. See .gate-logs/eslint-obsidian.json.
- CSS drift: Pass (412ms)
    - shadow-rgba: 22 (baseline 22, delta +0)
    - rt-legacy: 506 (baseline 562, delta -56)
  ✅ CSS drift gate passed.
- Unused CSS ratchet: Pass (18.0s)
  Unused CSS: 240 producer-less classes remain (ratchet holds them from growing).
- Compliance: Pass (997ms)
  Compliance: delta -1. See the compliance log.
- Spec coverage: Pass (209ms)
  Allow-listed:  17/50
  Failures:      0/50
  ✅ Audit passed.
- Unit tests: Pass (8.8s)
        Tests  6167 passed | 40 skipped (6207)
     Start at  20:33:58
     Duration  8.42s (transform 15.64s, setup 1.86s, import 75.88s, tests 17.06s, environment 31ms)
- i18n release readiness: Pass (407ms)
  [i18n-release] th: 7010/7116 (98.5%), 106 in English
  [i18n-release] vi: 7010/7116 (98.5%), 106 in English
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
- Obsidian lint (report-only): 1 problems total, 0 from obsidianmd rules — top: none. See .gate-logs/eslint-obsidian.json.
- Unused CSS: 240 producer-less classes remain (ratchet holds them from growing).
- Compliance: delta -1. See the compliance log.
### Ignore
- None.
