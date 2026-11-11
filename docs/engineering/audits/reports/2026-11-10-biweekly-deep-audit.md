# Biweekly Deep Audit

- Version: 7.7.0
- Branch: main
- Upstream: origin/main
- Baseline: HEAD~1 (774eafbc)
- Risk Level: Low

## Files Changed
- scripts/fallback-baseline.json
- src/chronologue/timeReferences/interactions.ts
- src/chronologue/timeReferences/model.ts
- src/chronologue/timeReferences/popover.ts
- src/chronologue/timeReferences/render.ts
- src/communityShare/communityShareClient.ts
- src/communityShare/communityShareSettings.ts
- src/inquiry/InquiryView.ts
- src/inquiry/storyVaultSources.ts
- src/modals/BookDesignerModal.ts
- src/modals/WritingSessionCompletionModal.ts
- src/sceneProperties/scenePropertyAdapter.ts
- src/services/WritingSessionService.ts
- src/settings/povToNarrationAlert.ts
- src/settings/refactorAlerts.ts
- src/settings/sections/BookDetailsModal.ts
- src/settings/sections/CommunityTimelineBlock.ts
- src/settings/sections/ConfigurationSection.ts
- src/settings/sections/PovSection.ts
- src/settings/sections/scene/ScenePropertiesSection.ts
- src/timetable/NoteDropCapture.ts
- src/timetable/TextSketchCapture.ts
- src/timetable/mainWorkspace.ts
- src/timetable/sceneIntakeTemplate.ts
- src/timetable/storyCardImages.ts
- src/timetable/storyImageMatching.ts
- src/timetable/storyImageMenu.ts
- src/timetable/storyImageSelection.ts
- src/timetable/storyImageStore.ts
- src/timetable/timetableModel.ts
- src/utils/frontmatter.ts
- src/utils/frontmatterText.ts
- src/utils/sceneGenerator.ts
- src/utils/templateMerge.ts
- src/utils/yamlTemplateNormalize.ts
- Major systems touched: src(34), scripts(1)

## Recent Commits
- d5f83967 2026-11-10 Bring fallback debt back under the baseline for 8.0
- 774eafbc 2026-11-10 [backup] 2026-11-10 15:55 — docs — docs(1) — Biweekly Deep Audit — 1 files — +126/-0
- ff5844b8 2026-11-10 [backup] 2026-11-10 15:53 — docs — wiki(5), docs(1) — Daily Control Tower — 6 files — +80/-0
- a7a95e33 2026-11-10 Clear the four lint errors added this week
- 79cf329c 2026-11-10 Bring the 8.0.0 notes up to this week's changes
- dba62925 2026-11-10 Retake the 8.0 Panels, Canvas map and time reference screenshots
- 46ee673a 2026-11-10 Translate the 8.0 strings into every language
- f8da6b14 2026-11-10 Time references: Earlier and Later labels sit level with their marks
- 79cb362a 2026-11-10 Timetable: timeline hover lights rows; only Shift scrolls to them
- 33bd3769 2026-11-10 Time references: hover a source circle to see all of its scene's references
- fffb9dbb 2026-11-10 Time references: line at the mark radius, readable popover
- 1ff15dab 2026-11-10 Preserve decimal scene labels in export ranges
- 94a56c49 2026-11-10 Pictures belong to people and places; a card's menu says where each comes from
- be2a61f4 2026-11-10 Configuration settings use sentence case; vertical icon for the time notation bar
- b3a39269 2026-11-10 Panels: the title stands beside a scene's pictures, and its buttons in a column
- 589a6fb4 2026-11-10 Timeline Display settings get icons; the cue bar becomes the time notation bar
- 835b3b30 2026-11-10 Runtime view freezes the character lanes
- d0a4633e 2026-11-10 Set safer content logging and manuscript rename defaults
- b46bd453 2026-11-10 One set of card image settings for Panels and Canvas, with shared focus points
- c6bad075 2026-11-10 Time references point the way their dates lie, and paint above the backdrops

## Validation Gates
- API feature audit: Pass (148ms)
- Model coverage: Pass (90ms)
- CSS duplicates: Pass (101ms)
- Shipped assets: Pass (96ms)
- Production build: Pass (10.1s)
  > tsc --noEmit -p tsconfig.scripts.json
  Build copied to: Author/New/Fresh/Sherlock Holmes/P&P/Timelapse/P&P Demo/Sherlock Demo/Faerie Queene Demo/Odyssey Demo/Miki Projects/Scrivener/release/build
  Production build complete!
- Code quality: Pass (415ms)
  ✅ Code quality check passed!
  📖 See docs/engineering/standards/code-standards.md for full guidelines.
- Obsidian review: Pass (567ms)
  - Runtime network/platform/filesystem checks passed.
  - No eslint-disable directives in shipped source.
  - Release eyeball checklist is present.
- Obsidian lint baseline: Pass (7.9s)
    - @typescript-eslint/no-unnecessary-type-assertion: 0 (baseline 0, delta 0)
    - @typescript-eslint/no-floating-promises: 0 (baseline 0, delta 0)
  [obsidian-lint-enforced] PASS: selected Obsidian lint debt did not increase.
- Obsidian lint (report-only): Pass (18.0s)
  Obsidian lint (report-only): 1 problems total, 1 from obsidianmd rules — top: settings-tab/prefer-setting-definitions(1). See .gate-logs/eslint-obsidian.json.
- CSS drift: Pass (409ms)
    - shadow-rgba: 22 (baseline 22, delta +0)
    - rt-legacy: 504 (baseline 562, delta -58)
  ✅ CSS drift gate passed.
- Unused CSS ratchet: Pass (18.2s)
  Unused CSS: 241 producer-less classes remain (ratchet holds them from growing).
- Compliance: Pass (1.0s)
  Compliance: delta -1. See the compliance log.
- Spec coverage: Pass (226ms)
  Allow-listed:  17/50
  Failures:      0/50
  ✅ Audit passed.
- Unit tests: Pass (9.1s)
        Tests  6026 passed | 40 skipped (6066)
     Start at  16:03:27
     Duration  8.70s (transform 16.29s, setup 1.96s, import 79.30s, tests 17.54s, environment 29ms)
- i18n release readiness: Pass (451ms)
  [i18n-release] th: 7022/7022 (100.0%)
  [i18n-release] vi: 7022/7022 (100.0%)
  [i18n-release] Locale source, stale-key, and release bundle checks passed.
- Fallback debt: Pass (814ms)
  - current total:  2213
  - delta: +0
  Fallback gate passed.
- Pricing drift: Pass (92ms)
  Pricing drift: [check-pricing-drift] age 28d / 30d
- Obsidian version watch: Pass (164ms)
  Obsidian version watch: 🔍 Checking for Obsidian updates...

## Changed-Code Scope
- 35 changed file(s) across: src(34), scripts(1).
- Scope only. This audit does not perform automated changed-code defect analysis; see Validation Gates above for pass/fail.

## Critical Risks
- None.

## Notices
- Pricing drift: [check-pricing-drift] age 28d / 30d
- Obsidian version watch: 🔍 Checking for Obsidian updates...

- Overall Repository Health: Excellent
- Ship Readiness: Ship

## Recommended Actions
### Do Now
- None.
### Schedule Later
- Obsidian lint (report-only): 1 problems total, 1 from obsidianmd rules — top: settings-tab/prefer-setting-definitions(1). See .gate-logs/eslint-obsidian.json.
- Unused CSS: 241 producer-less classes remain (ratchet holds them from growing).
- Compliance: delta -1. See the compliance log.
### Ignore
- None.
