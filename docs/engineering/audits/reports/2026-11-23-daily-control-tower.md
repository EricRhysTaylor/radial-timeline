# Daily Control Tower

- Version: 8.2.1
- Branch: main
- Upstream: origin/main
- Baseline: upstream merge-base (9bb243ee)
- Risk Level: Low

## Files Changed
- src/data/releaseNotesBundle.json
- Major systems touched: src(1)

## Recent Commits
- 005415f8 2026-11-23 docs: sync release notes for 8.2.1
- 9bb243ee 2026-11-23 Release version 8.2.1
- 1eeb3b9f 2026-11-23 Pop-out windows: scene drag, click and the timeline key follow their window
- 34ed24a6 2026-11-23 Clear the community-store scan warnings: popout-safe DOM checks
- 79e4f72c 2026-11-23 Settings → Community: a short Connect line; drop the notes line about it
- dc7ed416 2026-11-23 Privacy doc: the book list is sent from Connect until the author chooses Private or pauses
- 0554ffa3 2026-11-23 Community book list: say truthfully what Connect sends; stop sending the logline
- 10c703de 2026-11-23 Merge pull request #85 from EricRhysTaylor/harden/2026-11-23

## Validation Gates
- CSS duplicates: Pass (99ms)
- Production build: Pass (8.9s)
  > tsc --noEmit -p tsconfig.scripts.json
  Build copied to: Author/New/Fresh/Sherlock Holmes/P&P/Model Onboarding/Timelapse/P&P Demo/Sherlock Demo/Faerie Queene Demo/Odyssey Demo/Miki Projects/Scrivener/release/build
  Production build complete!
- Code quality: Pass (370ms)
  ✅ Code quality check passed!
  📖 See docs/engineering/standards/code-standards.md for full guidelines.
- Obsidian review: Pass (511ms)
  - Runtime network/platform/filesystem checks passed.
  - No eslint-disable directives in shipped source.
  - Release eyeball checklist is present.
- Obsidian lint baseline: Pass (7.3s)
    - obsidianmd/prefer-active-doc: 0 (baseline 0, delta 0)
    - obsidianmd/no-tfile-tfolder-cast: 0 (baseline 0, delta 0)
  [obsidian-lint-enforced] PASS: selected Obsidian lint debt did not increase.
- Obsidian lint (report-only): Pass (15.9s)
  [obsidian-lint] 0 problems (0 errors, 0 warnings) across 0 files — report-only
- Unit tests: Pass (8.5s)
        Tests  6772 passed | 2 expected fail | 56 skipped (6830)
     Start at  11:56:32
     Duration  8.14s (transform 14.39s, setup 1.70s, import 73.26s, tests 16.28s, environment 31ms)

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
- None.
### Ignore
- No follow-up work surfaced from this audit.
