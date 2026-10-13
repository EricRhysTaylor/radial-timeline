# Daily Control Tower

- Version: 7.5.0
- Branch: main
- Upstream: origin/main
- Baseline: HEAD~1 (b1baaa58)
- Risk Level: Low

## Files Changed
- src/ai/runtime/aiClient.ts
- src/ai/tokens/inputTokenEstimate.ts
- src/api/providerTransport.ts
- src/sceneAnalysis/SynopsisCommands.ts
- src/services/PromoteToSceneService.ts
- src/utils/authorQueryComments.ts
- src/view/interactions/TimetableLink.ts
- Major systems touched: src(7)

## Recent Commits
- e66ad0ab 2026-10-13 fix(lint): clear the Obsidian scan's latest-rule findings before 7.5.1
- b1baaa58 2026-10-13 [backup] 2026-10-13 16:00 — docs — docs(1) — Daily Control Tower — 1 files — +62/-0
- 13dc5afc 2026-10-13 Release notes 7.5.1 and wiki: Timetable mode following, lens, coloring, bulk edits
- 2e35cb90 2026-10-13 Fix manuscript export controls clipped below PDF proof
- f09029d7 2026-10-13 Open queries on the wheel: the Timetable's question bubble, sized to the cell
- 8d407f6e 2026-10-13 Wheel hover lights the table row in the hovered cell's color
- ee930ac4 2026-10-13 Watch list: Volume 9, Editorialist (uoGUkF6RQ2E)
- 0356f04b 2026-10-13 model(promote): Gemini 4 Argon replacing Gemini 3.1 Pro Preview

## Validation Gates
- CSS duplicates: Pass (47ms)
- Production build: Pass (7.6s)
  Production build: npm warn Unknown env config "global-ignore-file". This will stop working in the next major version of npm. See `npm help npmrc` for supported config options.
- Code quality: Pass (296ms)
  ✅ Code quality check passed!
  📖 See docs/engineering/standards/code-standards.md for full guidelines.
- Obsidian review: Pass (393ms)
  Obsidian review: npm warn Unknown env config "global-ignore-file". This will stop working in the next major version of npm. See `npm help npmrc` for supported config options.
- Obsidian lint baseline: Pass (6.5s)
  Obsidian lint baseline: npm warn Unknown env config "global-ignore-file". This will stop working in the next major version of npm. See `npm help npmrc` for supported config options.
- Obsidian lint (report-only): Pass (14.8s)
  Obsidian lint (report-only): 2 problems total, 1 from obsidianmd rules — top: settings-tab/prefer-setting-definitions(1). See .gate-logs/eslint-obsidian.json.
- Unit tests: Pass (5.5s)
  Unit tests: npm warn Unknown env config "global-ignore-file". This will stop working in the next major version of npm. See `npm help npmrc` for supported config options.

## Changed-Code Scope
- 7 changed file(s) across: src(7).
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
