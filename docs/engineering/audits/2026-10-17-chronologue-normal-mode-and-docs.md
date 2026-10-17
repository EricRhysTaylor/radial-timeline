# Chronologue normal-mode references and documentation — 2026-10-17

Read-only post-implementation review of the requested sub-mode visibility fix and author documentation. No additional cleanup is proposed.

## Change and scope

A single CSS visibility rule hides the time-reference date groups, source groups and connector paths whenever the SVG is outside Chronologue or has a Chronologue sub-mode attribute. This uses the existing controller state for Shift (`active`), planetary (`alien`) and Runtime (`runtime`), including live transitions; it adds no mode state or observers. `display: none` removes painted content, hit regions and tab stops together. Actual scene titles and author Question icons remain outside this rule. The Timetable's author-facing reference list remains available in every mode.

One canonical Time References wiki page documents author YAML, required fields, date precision and optional periods/passages, context-menu editing, source and date marks, selection, off-range seam notation, same-date counts and Timetable child rows. Chronologue, Scene Properties, Timetable and sidebar entries link to it. Three screenshots are native captures from the synthetic Chronologue Seam QA vault, cropped without altering the UI. The page explicitly identifies development-build availability.

## Native verification

Inspected the actual QA vault in Obsidian 1.14.4, with 30 scenes and seven subplots. Normal Chronologue has 11 reference date/overflow groups and five source groups. Shift, Runtime and Alien Calendar each have zero displayed reference groups, source groups or connector paths. All 67 painted scene-title occurrences and seven Question marks remain present. Returning from Alien Calendar to normal restores all reference elements. A pinned source-07 relationship is also hidden by Shift. In normal view its connector is inline at opacity 1 and identifies `Scenes/07 The photograph.md`.

Alien Calendar was exercised with a temporary 26-hour/400-day QA calendar; the previous calendar settings were backed up and restored. Scene text and reference YAML were not changed. Only the QA vault's plugin stylesheet was replaced; no production or Author vault plugin installation was changed.

Evidence: `Demo Vaults/Testing Vaults/2026-10-17 Chronologue mode documentation/` contains the prior stylesheet, installed stylesheet hash, original calendar settings, inspector captures and full native screenshots. The wiki carries the cropped YAML, timeline and Timetable images.

## Verification and findings

`CI=true npm run build-only`, all 14 `CI=true npm run gates` checks, all 32 focused time-reference tests and `git diff --check` passed. Checked local wiki page/image links and reviewed all three screenshot crops. Existing report-only Obsidian lint and unused-CSS notices remain outside this scope.

No release-blocking, high or medium findings in this change. No refactor, dead-code removal, naming migration, settings migration, shortcut or new YAML field was needed. Reference ownership, scene positions, author metadata and primary date range remain intact. Mobile/touch and light theme were not exercised. No public plugin release was made.

## Follow-up: Question marks in sub-modes

At the author's request, a scoped rule in `scenes.css` now hides `.rt-query-mark` only when a Chronologue SVG has a sub-mode attribute. This includes both the bubble and compact dot; normal Chronologue and other modes preserve them. Native QA inspected seven marks: seven visible in normal Chronologue, zero in Shift, zero in Runtime, and zero in Alien Calendar. Narrative retained all seven. Scene title occurrences remained at 67 in the Chronologue sub-modes. The temporary calendar settings were restored. Evidence is in `Demo Vaults/Testing Vaults/2026-10-17 Chronologue query submodes/`. The Time References guide now notes this behavior; its normal-mode screenshots remain current. The four query-mark tests and all 14 verification gates passed.

## Follow-up: smaller Question icons

The requested 20% reduction scales the fitted bubble dimensions by 0.8 before positioning, preserving its center and the existing compact-dot threshold. Dot geometry and sub-mode hiding are unchanged. Native QA measured all seven full-size icons at 28 × 28 wheel units before and 22.4 × 22.4 after, and reviewed the top-seam detail. The four query-mark tests passed; evidence and the prior QA bundle are in `Demo Vaults/Testing Vaults/2026-10-17 Chronologue query size/`.
