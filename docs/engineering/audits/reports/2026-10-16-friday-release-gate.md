# Friday Release Gate

- Version: 7.5.1
- Branch: main
- Upstream: origin/main
- Baseline: HEAD~1 (795c3d94)
- Risk Level: Low

## Files Changed
- docs/releases/draft-for-release-7.5.2.md
- Major systems touched: docs(1)

## Recent Commits
- 46c5509c 2026-10-16 Release notes 7.5.2: short bug-fix notes
- 795c3d94 2026-10-16 Keep Progress and status on the active book while settings is open
- 75d216b2 2026-10-16 Only a book whose folder exists can be clicked active
- ae926218 2026-10-16 Stop calling an author's own vault a sample on the Welcome screen
- 90cfa6d7 2026-10-16 Remove the "already onboarded, skipped" path from the import
- cf0ff4a5 2026-10-16 Add existing book folders as books, never through the import
- 7c110c12 2026-10-16 Keep indexed concept search on the single configured local model
- d20bf5a4 2026-10-16 Show independent local search service availability
- 8f87e531 2026-10-16 Keep completion progress visible without recent pace data
- b14e9826 2026-10-16 Update launched demo vault cards with bundled artwork and direct links
- e24e568e 2026-10-16 Fix settings layouts for narrow Obsidian floating windows
- 49e14e39 2026-10-15 Keep Chronologue references within primary dates and mark off-range seams

## Validation Gates
- API feature audit: Pass (205ms)
- Model coverage: Pass (38ms)
- CSS duplicates: Pass (57ms)
- Shipped assets: Pass (44ms)
- Production build: Pass (8.0s)
  Production build: npm warn Unknown env config "global-ignore-file". This will stop working in the next major version of npm. See `npm help npmrc` for supported config options.
- Code quality: Pass (344ms)
  ✅ Code quality check passed!
  📖 See docs/engineering/standards/code-standards.md for full guidelines.
- Obsidian review: Pass (438ms)
  Obsidian review: npm warn Unknown env config "global-ignore-file". This will stop working in the next major version of npm. See `npm help npmrc` for supported config options.
- Obsidian lint baseline: Pass (7.4s)
  Obsidian lint baseline: npm warn Unknown env config "global-ignore-file". This will stop working in the next major version of npm. See `npm help npmrc` for supported config options.
- Obsidian lint (report-only): Pass (13.8s)
  Obsidian lint (report-only): 5 problems total, 1 from obsidianmd rules — top: settings-tab/prefer-setting-definitions(1). See .gate-logs/eslint-obsidian.json.
- CSS drift: Pass (286ms)
    - shadow-rgba: 20 (baseline 22, delta -2)
    - rt-legacy: 549 (baseline 562, delta -13)
  ✅ CSS drift gate passed.
- Unused CSS ratchet: Pass (14.7s)
  Unused CSS: 243 producer-less classes remain (ratchet holds them from growing).
- Compliance: Pass (896ms)
    - node-core-require: 6 / 6 (+0)
    - raw-addEventListener: 80 / 80 (+0)
  ✅ Compliance maintenance gate passed (no regressions vs baseline).
- Spec coverage: Pass (118ms)
  Spec coverage: npm warn Unknown env config "global-ignore-file". This will stop working in the next major version of npm. See `npm help npmrc` for supported config options.
- Unit tests: Pass (7.2s)
  Unit tests: npm warn Unknown env config "global-ignore-file". This will stop working in the next major version of npm. See `npm help npmrc` for supported config options.
- i18n release readiness: Pass (365ms)
  [i18n-release] th: 6414/6414 (100.0%)
  [i18n-release] vi: 6414/6414 (100.0%)
  [i18n-release] Locale source, full coverage, and release bundle checks passed.

## Changed-Code Scope
- 1 changed file(s) across: docs(1).
- Scope only. This audit does not perform automated changed-code defect analysis; see Validation Gates above for pass/fail.

## Critical Risks
- None.

## Notices
- Production build: npm warn Unknown env config "global-ignore-file". This will stop working in the next major version of npm. See `npm help npmrc` for supported config options.
- Obsidian review: npm warn Unknown env config "global-ignore-file". This will stop working in the next major version of npm. See `npm help npmrc` for supported config options.
- Obsidian lint baseline: npm warn Unknown env config "global-ignore-file". This will stop working in the next major version of npm. See `npm help npmrc` for supported config options.
- Spec coverage: npm warn Unknown env config "global-ignore-file". This will stop working in the next major version of npm. See `npm help npmrc` for supported config options.
- Unit tests: npm warn Unknown env config "global-ignore-file". This will stop working in the next major version of npm. See `npm help npmrc` for supported config options.

- Overall Repository Health: Excellent
- Ship Readiness: Ship

## Recommended Actions
### Do Now
- None.
### Schedule Later
- Obsidian lint (report-only): 5 problems total, 1 from obsidianmd rules — top: settings-tab/prefer-setting-definitions(1). See .gate-logs/eslint-obsidian.json.
- Unused CSS: 243 producer-less classes remain (ratchet holds them from growing).
### Ignore
- None.
