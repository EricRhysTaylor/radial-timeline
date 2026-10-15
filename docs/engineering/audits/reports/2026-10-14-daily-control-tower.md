# Daily Control Tower

- Version: 7.5.1
- Branch: main
- Upstream: origin/main
- Baseline: upstream merge-base (4b76292d)
- Risk Level: Low

## Files Changed
- src/data/releaseNotesBundle.json
- Major systems touched: src(1)

## Recent Commits
- 20ab5fb0 2026-10-14 docs: sync release notes for 7.5.1
- 4b76292d 2026-10-14 Release version 7.5.1
- 7b2bd296 2026-10-14 Release notes 7.5.1: contents, recent exports, Timetable keys; scanner-clean contents escape
- 56810737 2026-10-14 Preserve nested divisions and verse in manuscript imports
- 99379f06 2026-10-14 Add document contents and PDF manuscript navigation
- 67b73da6 2026-10-14 Timetable key follows the mode
- 1352861a 2026-10-14 Use full Radial Timeline name in manuscript source controls
- 4c922a36 2026-10-14 Timetable key: drop aria-label so Obsidian doesn't show a duplicate tooltip

## Validation Gates
- CSS duplicates: Pass (56ms)
- Production build: Pass (9.6s)
  Production build: npm warn Unknown env config "global-ignore-file". This will stop working in the next major version of npm. See `npm help npmrc` for supported config options.
- Code quality: Pass (324ms)
  ✅ Code quality check passed!
  📖 See docs/engineering/standards/code-standards.md for full guidelines.
- Obsidian review: Pass (455ms)
  Obsidian review: npm warn Unknown env config "global-ignore-file". This will stop working in the next major version of npm. See `npm help npmrc` for supported config options.
- Obsidian lint baseline: Pass (8.3s)
  Obsidian lint baseline: npm warn Unknown env config "global-ignore-file". This will stop working in the next major version of npm. See `npm help npmrc` for supported config options.
- Obsidian lint (report-only): Pass (17.1s)
  Obsidian lint (report-only): 2 problems total, 1 from obsidianmd rules — top: settings-tab/prefer-setting-definitions(1). See .gate-logs/eslint-obsidian.json.
- Unit tests: Pass (8.1s)
  Unit tests: npm warn Unknown env config "global-ignore-file". This will stop working in the next major version of npm. See `npm help npmrc` for supported config options.

## Changed-Code Scope
- 1 changed file(s) across: src(1).
- Scope only. This audit does not perform automated changed-code defect analysis; see Validation Gates above for pass/fail.

## Critical Risks
- None.

## Notices
- Production build: npm warn Unknown env config "global-ignore-file". This will stop working in the next major version of npm. See `npm help npmrc` for supported config options.
- Obsidian review: npm warn Unknown env config "global-ignore-file". This will stop working in the next major version of npm. See `npm help npmrc` for supported config options.
- Obsidian lint baseline: npm warn Unknown env config "global-ignore-file". This will stop working in the next major version of npm. See `npm help npmrc` for supported config options.
- Unit tests: npm warn Unknown env config "global-ignore-file". This will stop working in the next major version of npm. See `npm help npmrc` for supported config options.

- Overall Repository Health: Excellent
- Ship Readiness: Ship

## Recommended Actions
### Do Now
- None.
### Schedule Later
- Obsidian lint (report-only): 2 problems total, 1 from obsidianmd rules — top: settings-tab/prefer-setting-definitions(1). See .gate-logs/eslint-obsidian.json.
### Ignore
- None.
