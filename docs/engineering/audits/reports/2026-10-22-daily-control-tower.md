# Daily Control Tower

- Version: 7.6.3
- Branch: main
- Upstream: origin/main
- Baseline: upstream merge-base (37aadadd)
- Risk Level: Low

## Files Changed
- src/data/releaseNotesBundle.json
- Major systems touched: src(1)

## Recent Commits
- c6b5f918 2026-10-22 docs: sync release notes for 7.6.3
- 37aadadd 2026-10-22 Release version 7.6.3
- 118280f7 2026-10-22 [backup] 2026-10-22 11:41 — docs — docs(1) — Daily Control Tower — 1 files — +61/-0
- 1fe50804 2026-10-22 Release notes 7.6.3: short bug-fix notes
- 1e2d7236 2026-10-21 Preserve author edits during rename recovery and validate book folders
- c465c75c 2026-10-20 Fix the still-open evening-hardening bugs in onboarding, progress and subplots
- 1ffc2994 2026-10-20 Restore mode-aware Timetable row hover accents
- dbd21161 2026-10-19 Fix localized navigation and preserve recovery folder paths

## Validation Gates
- CSS duplicates: Pass (43ms)
- Production build: Pass (7.6s)
  Production build: npm warn Unknown env config "global-ignore-file". This will stop working in the next major version of npm. See `npm help npmrc` for supported config options.
- Code quality: Pass (297ms)
  ✅ Code quality check passed!
  📖 See docs/engineering/standards/code-standards.md for full guidelines.
- Obsidian review: Pass (393ms)
  Obsidian review: npm warn Unknown env config "global-ignore-file". This will stop working in the next major version of npm. See `npm help npmrc` for supported config options.
- Obsidian lint baseline: Pass (6.6s)
  Obsidian lint baseline: npm warn Unknown env config "global-ignore-file". This will stop working in the next major version of npm. See `npm help npmrc` for supported config options.
- Obsidian lint (report-only): Pass (14.8s)
  Obsidian lint (report-only): 2 problems total, 2 from obsidianmd rules — top: settings-tab/prefer-setting-definitions(1), prefer-create-el(1). See .gate-logs/eslint-obsidian.json.
- Unit tests: Pass (6.9s)
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
- Obsidian lint (report-only): 2 problems total, 2 from obsidianmd rules — top: settings-tab/prefer-setting-definitions(1), prefer-create-el(1). See .gate-logs/eslint-obsidian.json.
### Ignore
- None.
