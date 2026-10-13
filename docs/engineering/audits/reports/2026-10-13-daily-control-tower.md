# Daily Control Tower

- Version: 7.5.0
- Branch: main
- Upstream: origin/main
- Baseline: HEAD~1 (2e35cb90)
- Risk Level: High

## Files Changed
- docs/releases/draft-for-release-7.5.1.md
- wiki/Timetable.md
- Major systems touched: docs(1), wiki(1)

## Recent Commits
- 13dc5afc 2026-10-13 Release notes 7.5.1 and wiki: Timetable mode following, lens, coloring, bulk edits
- 2e35cb90 2026-10-13 Fix manuscript export controls clipped below PDF proof
- f09029d7 2026-10-13 Open queries on the wheel: the Timetable's question bubble, sized to the cell
- 8d407f6e 2026-10-13 Wheel hover lights the table row in the hovered cell's color
- ee930ac4 2026-10-13 Watch list: Volume 9, Editorialist (uoGUkF6RQ2E)
- 0356f04b 2026-10-13 model(promote): Gemini 4 Argon replacing Gemini 3.1 Pro Preview
- e0fdd559 2026-10-13 Query dots at scene cell centers; act header on one line
- e5371c16 2026-10-13 Add local semantic index for fast scoped concept search

## Validation Gates
- CSS duplicates: Pass (52ms)
- Production build: Pass (7.7s)
  Production build: npm warn Unknown env config "global-ignore-file". This will stop working in the next major version of npm. See `npm help npmrc` for supported config options.
- Code quality: Pass (276ms)
  ✅ Code quality check passed!
  📖 See docs/engineering/standards/code-standards.md for full guidelines.
- Obsidian review: Pass (392ms)
  Obsidian review: npm warn Unknown env config "global-ignore-file". This will stop working in the next major version of npm. See `npm help npmrc` for supported config options.
- Obsidian lint baseline: Pass (7.4s)
  Obsidian lint baseline: npm warn Unknown env config "global-ignore-file". This will stop working in the next major version of npm. See `npm help npmrc` for supported config options.
- Obsidian lint (report-only): Pass (14.4s)
  Obsidian lint (report-only): 18 problems total, 2 from obsidianmd rules — top: settings-tab/prefer-setting-definitions(1), prefer-create-el(1). See .gate-logs/eslint-obsidian.json.
- Unit tests: Fail (5.0s)
  Unit tests: npm warn Unknown env config "global-ignore-file". This will stop working in the next major version of npm. See `npm help npmrc` for supported config options.

## Changed-Code Scope
- 2 changed file(s) across: docs(1), wiki(1).
- Scope only. This audit does not perform automated changed-code defect analysis; see Validation Gates above for pass/fail.

## Critical Risks
- Unit tests failed.

## Notices
- Production build: npm warn Unknown env config "global-ignore-file". This will stop working in the next major version of npm. See `npm help npmrc` for supported config options.
- Obsidian review: npm warn Unknown env config "global-ignore-file". This will stop working in the next major version of npm. See `npm help npmrc` for supported config options.
- Obsidian lint baseline: npm warn Unknown env config "global-ignore-file". This will stop working in the next major version of npm. See `npm help npmrc` for supported config options.
- Unit tests: npm warn Unknown env config "global-ignore-file". This will stop working in the next major version of npm. See `npm help npmrc` for supported config options.

- Overall Repository Health: Needs Attention
- Ship Readiness: Do Not Ship

## Recommended Actions
### Do Now
- Fix failing gate: Unit tests.
### Schedule Later
- Obsidian lint (report-only): 18 problems total, 2 from obsidianmd rules — top: settings-tab/prefer-setting-definitions(1), prefer-create-el(1). See .gate-logs/eslint-obsidian.json.
### Ignore
- None.
