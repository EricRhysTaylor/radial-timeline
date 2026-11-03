# Biweekly Deep Audit

- Version: 7.7.0
- Branch: claude/vigorous-almeida-1c7f56
- Upstream: (none)
- Baseline: HEAD~1 (d366eb8f)
- Risk Level: Low

## Files Changed
- src/demoVaults/demoEdition.ts
- docs/engineering/standards/fallback-policy.md
- scripts/fallback-gate.mjs
- src/ai/runtime/aiClient.ts
- src/demoVaults/importDemoVault.ts
- src/inquiry/briefing/InquiryBriefingArticle.ts
- src/inquiry/briefing/inquiryBriefingRenderer.ts
- src/inquiry/render/inquiryLogFields.ts
- src/inquiry/runner/InquiryRunnerService.ts
- src/inquiry/state.ts
- src/inquiry/utils/inquiryFindingsPanel.ts
- src/modals/BookDesignerModal.ts
- src/modals/ChronologuePlacementModal.ts
- src/modals/ManuscriptOptionsModal.ts
- src/modals/PromoteToSceneModal.ts
- src/publishing/exportDelivery.ts
- src/publishing/matterRepair.ts
- src/publishing/templateDetection.ts
- src/renderer/ChangeDetection.ts
- src/services/PromoteToSceneService.ts
- src/services/PublishingValidationService.ts
- src/services/SceneInsertService.ts
- src/services/SceneReorderService.ts
- src/settings/sections/AiSection.ts
- src/settings/sections/CampaignManagerSection.ts
- src/settings/sections/PublishSection.ts
- src/storyBeats/beatSystemStatus.ts
- src/timetable/CanvasCardPresentation.ts
- src/timetable/CanvasSketchEntry.ts
- src/timetable/CanvasSketchModal.ts
- src/timetable/CanvasStoryNavigator.ts
- src/timetable/SubplotCanvasModal.ts
- src/timetable/TimetableView.ts
- src/timetable/canvasPortals.ts
- src/timetable/canvasSketchOrdering.ts
- src/timetable/canvasSketches.ts
- src/timetable/outlineImport.ts
- src/timetable/outlineInspiration.ts
- src/timetable/panelPlaceImage.ts
- src/timetable/sketchPlacement.ts
- src/timetable/sketchPlacementFields.ts
- src/timetable/sketchSceneMove.test.ts
- src/timetable/sketchSceneMove.ts
- src/timetable/subplotCanvas.ts
- src/timetable/timetablePlacement.ts
- src/utils/acts.ts
- src/utils/sceneIds.ts
- src/utils/yamlAudit.ts
- src/view/interactions/OuterRingDragController.ts
- tests/fallback-gate.test.ts
- src/utils/frontmatterKeys.ts
- Major systems touched: src(48), docs(1), scripts(1), tests(1)

## Recent Commits
- 368a97f0 2026-11-03 Annotate the edition stamp read fallback
- d366eb8f 2026-11-03 [backup] 2026-11-03 09:17 — docs — docs(1) — Biweekly Deep Audit — 1 files — +120/-0
- 67848e13 2026-11-03 [backup] 2026-11-03 09:15 — docs — docs(1) — Daily Control Tower — 1 files — +18/-16
- 3ed76fac 2026-11-03 Translate Saved views and Restore view instead of spreading English
- 712300f4 2026-11-03 [backup] 2026-11-03 09:10 — docs — docs(1) — Daily Control Tower — 1 files — +67/-0
- 912cff5c 2026-11-03 Drop the last eslint-disable comments from src tests
- 7f1535c5 2026-11-03 Translate the Outline layout and outline import
- 9530ce54 2026-11-03 Draft 8.0.0 release notes with Canvas, Panels, Outline and Story Vaults
- 75bcccbe 2026-11-03 Document 8.0.0 Timetable layouts, Canvas maps and Story Vaults in the wiki
- eceae856 2026-11-03 Pin patched moment for the Obsidian type package
- 1f755caa 2026-11-03 Clear new Obsidian scanner findings in Canvas and Timetable code
- 7356d428 2026-11-03 Use native Canvas zoom selection icon
- e90af106 2026-11-02 Add zoom to selection to Canvas story navigator
- 681d0a62 2026-11-02 Make Canvas follow and hover highlight apparent
- 6cdb0c7d 2026-11-02 Keep beat-only Gossamer separate from scene hover
- 755b547b 2026-11-02 Connect Canvas cards to timeline hover
- 68b28d8d 2026-11-02 Clarify timetable canvas and book controls
- 47d02b27 2026-11-02 Keep Canvas act labels visible when zoomed out
- 7b8172d8 2026-11-02 Expose canvas maps and timeline tooltips
- 162f38b1 2026-11-02 Make quick workspaces available across timetable layouts

## Validation Gates
- API feature audit: Pass (149ms)
- Model coverage: Pass (87ms)
- CSS duplicates: Pass (101ms)
  ⚠️  styles.css not built yet — skipping duplicate/empty-ruleset check (source !important check passed; the post-build check enforces the artifact).
- Shipped assets: Pass (103ms)
- Production build: Pass (9.7s)
  ⚠️  styles.css not built yet — skipping duplicate/empty-ruleset check (source !important check passed; the post-build check enforces the artifact).
  Build copied to: Author/New/Fresh/Sherlock Holmes/P&P/Timelapse/P&P Demo/Sherlock Demo/Faerie Queene Demo/Odyssey Demo/Miki Projects/Scrivener/release/build
  Production build complete!
- Code quality: Pass (384ms)
  ✅ Code quality check passed!
  📖 See docs/engineering/standards/code-standards.md for full guidelines.
- Obsidian review: Pass (555ms)
  - Runtime network/platform/filesystem checks passed.
  - No eslint-disable directives in shipped source.
  - Release eyeball checklist is present.
- Obsidian lint baseline: Pass (8.3s)
    - @typescript-eslint/no-unnecessary-type-assertion: 0 (baseline 0, delta 0)
    - @typescript-eslint/no-floating-promises: 0 (baseline 0, delta 0)
  [obsidian-lint-enforced] PASS: selected Obsidian lint debt did not increase.
- Obsidian lint (report-only): Pass (16.9s)
  Obsidian lint (report-only): 1 problems total, 1 from obsidianmd rules — top: settings-tab/prefer-setting-definitions(1). See .gate-logs/eslint-obsidian.json.
- CSS drift: Pass (412ms)
    - shadow-rgba: 22 (baseline 22, delta +0)
    - rt-legacy: 562 (baseline 562, delta +0)
  ✅ CSS drift gate passed.
- Unused CSS ratchet: Pass (17.5s)
  Unused CSS: 243 producer-less classes remain (ratchet holds them from growing).
- Compliance: Pass (1.0s)
  Compliance: delta -1. See the compliance log.
- Spec coverage: Pass (224ms)
  Allow-listed:  17/50
  Failures:      0/50
  ✅ Audit passed.
- Unit tests: Pass (8.2s)
        Tests  5082 passed | 38 skipped (5120)
     Start at  10:12:18
     Duration  7.76s (transform 15.46s, setup 1.87s, import 67.86s, tests 16.62s, environment 28ms)
- i18n release readiness: Pass (397ms)
  [i18n-release] th: 6735/6735 (100.0%)
  [i18n-release] vi: 6735/6735 (100.0%)
  [i18n-release] Locale source, full coverage, and release bundle checks passed.
- Fallback debt: Pass (789ms)
  - current total:  2236
  - delta: -261
  Fallback gate passed.
- Pricing drift: Pass (90ms)
  Pricing drift: [check-pricing-drift] age 21d / 30d
- Obsidian version watch: Pass (240ms)
  Obsidian version watch: 🔍 Checking for Obsidian updates...

## Changed-Code Scope
- 51 changed file(s) across: src(48), docs(1), scripts(1), tests(1).
- Scope only. This audit does not perform automated changed-code defect analysis; see Validation Gates above for pass/fail.

## Critical Risks
- None.

## Notices
- Pricing drift: [check-pricing-drift] age 21d / 30d
- Obsidian version watch: 🔍 Checking for Obsidian updates...

- Overall Repository Health: Excellent
- Ship Readiness: Ship

## Recommended Actions
### Do Now
- None.
### Schedule Later
- Obsidian lint (report-only): 1 problems total, 1 from obsidianmd rules — top: settings-tab/prefer-setting-definitions(1). See .gate-logs/eslint-obsidian.json.
- Unused CSS: 243 producer-less classes remain (ratchet holds them from growing).
- Compliance: delta -1. See the compliance log.
### Ignore
- None.
