# Localization and workflow closure — 2026-10-19

## Changes

Native language checks found ambiguous machine translations in settings navigation and manuscript source controls. Corrected Spanish settings tabs and Single file, Thai settings tabs and Folder, Vietnamese Publish, French Advanced, and French/Thai book-scope nouns. Export manuscript uses an action label in Spanish and Thai. The tabbed interface and publishing workflow are preserved.

The recovery notice in Spanish, French, Thai and Vietnamese had also translated or changed the case of literal vault paths. Restored the exact Recover, Logs, legacy recovery and live Snapshots paths. A nine-locale regression protects those paths: four cases failed before the correction; all nine pass afterward. No files are moved by this change.

## Automated evidence

- All 14 gates pass: 427 test files, 4,783 passing tests and 35 existing opt-in skips.
- Focused locale suite: 34 tests pass, including all nine recovery-path cases.
- Catalog and release-bundle checks cover all 6,427 English keys in every translated catalog.
- Additional closure checks: 37 boundary-test files, 524 passing tests; the four initially skipped demo cases were exercised separately against all three pinned demo editions. Explicit demo integration: 2 files, 23 tests, no skips.
- Existing report-only settings-search and DOM-creation notices and unused-CSS ratchet remain unchanged. These are not new failures.

## Native acceptance

Used an isolated synthetic QA vault with AI disabled, no configured provider key and Community disconnected. Obsidian was fully relaunched for each supported language: English, German, Japanese, Korean, Simplified Chinese, Spanish, French, Thai and Vietnamese. Checked representative Core/Publish settings, export dialog navigation and cancellation, multilingual source names, and disconnected Inquiry state. Corrected labels were replayed with the candidate build. Saved Editorialist agenda progress and manuscript scope survived relaunches; its current English fallback remains usable.

Native import checks cover ordered plain text, actual multilingual Word output, corrupt Word rejection and repeated-destination protection. Imported prose and source files were compared directly. Native Editorialist checks cover answered-query resolution, exact destination preview, Spanish Apply, French Apply/Undo, goal save/cancel/complete/reopen, blocked unknown-effort scheduling, valid two-session scheduling, and independent session completion. Agenda import, instruction completion/question persistence and deactivate/reactivate preserve progress.

The actual Word export was opened in Microsoft Word. All four passages and margin comments render, including Thai; this closes the earlier headless-render uncertainty. The original export remains unchanged. All 115 pre-existing QA notes and the four import inputs remain byte-identical.

## Limits and retained deferrals

These are representative workflow and rendering checks, not a claim that every text string has received linguistic certification. Some English diagnostics/descriptions and rough translated prose remain; no broad stylistic rewrite was attempted. Editorialist has an English i18n foundation, not nine completed translations.

Book Details Escape and Book Pages HTML dragging still need human replay because automation evidence was ambiguous. Native modifier-drag combinations and some hover-only transitions remain bounded by the automation API; deterministic controller checks cover their contracts. Live Community and paid-provider acceptance require account or credential choices. Word segmentation policy, declarative settings search and beta template-import promotion remain owner decisions. No public release, account connection or live AI request was performed.

Local screenshots, accessibility captures, output checks, red/green tests and gate logs are retained in the audit closure evidence directory.
