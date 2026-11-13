# Friday Release Gate

- Version: 8.0.3
- Branch: main
- Upstream: origin/main
- Baseline: upstream merge-base (41fcc1a8)
- Risk Level: Low

## Files Changed
- src/data/releaseNotesBundle.json
- Major systems touched: src(1)

## Recent Commits
- a86b2203 2026-11-13 docs: sync release notes for 8.0.3
- 41fcc1a8 2026-11-13 Release version 8.0.3
- de0c9bf8 2026-11-13 Prepare 8.0.3: scene drops say Scene text; full release notes
- a9713cf6 2026-11-13 Recheck Community privacy details after failed saves
- 070d0a93 2026-11-13 Draft 8.0.3 release notes: shared timeline links, Local AI http note
- 88ce3e08 2026-11-13 Merge pull request #65 from EricRhysTaylor/security/2026-11-12
- 79fe9191 2026-11-12 Honor mapped class when removing a scene
- 1f5c2677 2026-11-12 Keep scene-break dialogue in runtime estimates
- 63ec826e 2026-11-12 Keep Canvas cards working after a read failure
- 401e272f 2026-11-12 Stop timeline sync when a duplicate scene owner is unknown
- 53b23b1b 2026-11-12 Respect selected character without a portrait
- 7305cfd1 2026-11-12 Clarify Canvas drop placement guidance

## Validation Gates
- API feature audit: Pass (132ms)
- Model coverage: Pass (79ms)
- CSS duplicates: Pass (88ms)
- Shipped assets: Pass (84ms)
- Production build: Pass (8.6s)
  > tsc --noEmit -p tsconfig.scripts.json
  Build copied to: Author/New/Fresh/Sherlock Holmes/P&P/Timelapse/P&P Demo/Sherlock Demo/Faerie Queene Demo/Odyssey Demo/Miki Projects/Scrivener/release/build
  Production build complete!
- Code quality: Pass (353ms)
  ✅ Code quality check passed!
  📖 See docs/engineering/standards/code-standards.md for full guidelines.
- Obsidian review: Pass (491ms)
  - Runtime network/platform/filesystem checks passed.
  - No eslint-disable directives in shipped source.
  - Release eyeball checklist is present.
- Obsidian lint baseline: Pass (7.0s)
    - @typescript-eslint/no-unnecessary-type-assertion: 0 (baseline 0, delta 0)
    - @typescript-eslint/no-floating-promises: 0 (baseline 0, delta 0)
  [obsidian-lint-enforced] PASS: selected Obsidian lint debt did not increase.
- Obsidian lint (report-only): Pass (14.5s)
  Obsidian lint (report-only): 1 problems total, 0 from obsidianmd rules — top: none. See .gate-logs/eslint-obsidian.json.
- CSS drift: Pass (367ms)
    - shadow-rgba: 22 (baseline 22, delta +0)
    - rt-legacy: 506 (baseline 562, delta -56)
  ✅ CSS drift gate passed.
- Unused CSS ratchet: Pass (16.8s)
  Unused CSS: 240 producer-less classes remain (ratchet holds them from growing).
- Compliance: Pass (923ms)
  Compliance: delta -1. See the compliance log.
- Spec coverage: Pass (193ms)
  Allow-listed:  17/50
  Failures:      0/50
  ✅ Audit passed.
- Unit tests: Pass (8.0s)
        Tests  6153 passed | 40 skipped (6193)
     Start at  11:08:48
     Duration  7.64s (transform 15.07s, setup 1.62s, import 67.71s, tests 16.17s, environment 28ms)
- i18n release readiness: Pass (377ms)
  [i18n-release] th: 7010/7110 (98.6%), 100 in English
  [i18n-release] vi: 7010/7110 (98.6%), 100 in English
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
