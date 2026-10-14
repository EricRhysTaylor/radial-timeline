# Recent exports and optional sign-off — implementation and stabilization

Date: 2026-10-13. Eric explicitly requested simplified post-export actions, optional manual review and links to recent exported files. Scope is the export workflow; the video project is untouched.

## Result and design decisions

- Automatic file checks remain part of every export. **Open file** becomes the primary footer action on success; Close and Reveal remain secondary. Changing export settings restores Generate as the primary action.
- **Recent exports** is accessible from the export header and Destination, before generating another file. It shows the five most recent jobs with dates, formats, exact file links and Open file controls. Split jobs list every final file. Details leads to the existing receipt/check surface.
- **Export details** keeps checks and file opening visible. Manual checkboxes and Save sign-off are in a collapsed **Optional sign-off** section; the save action has neutral styling. Expanding it and changing a check preserves the expanded state.
- A saved sign-off remains bound to checked file hashes. Recent exports rechecks files before displaying a recorded sign-off. Missing output is explicitly reported and cannot be opened; opening a file never marks it reviewed.
- Word now uses one shared system-opener path from the export footer, history and details. PDF/Markdown use the vault viewer. The helper checks existence so a stale file link cannot create a blank note.

### Reference lock / decision ledger

Primary reference: existing RT ERT modal system and Eric's screenshot/request. Keep its type, surfaces, accent roles, panel treatment and spacing tokens. Refero full styles reviewed: Linear Changelog (11d3e58a-87d7-4a9a-bbf5-720f4fd3ffc6, https://linear.app/changelog) and Paste (1c0fbb80-f4ca-4c30-8f72-4a8f95a83005, https://pasteapp.io). Concrete file-history screen: Memotron 566af3d2-efb9-41c4-9228-d371c263466d, https://refero.design/pages/566af3d2-efb9-41c4-9228-d371c263466d.

| Decision | Source / role | Adaptation |
| --- | --- | --- |
| Flat panels, restrained metadata | RT primary; Linear grouping and spacing | Existing ERT panels; no new palette, font or shadows. |
| Chronological file entries and exact paths | Memotron file-history pattern | Date and format below the title; file link and direct action on one wrapping row. |
| Open first; approval optional | Eric's explicit brief; Paste's direct retrieval emphasis | Primary Open file; neutral Details; collapsed sign-off. |
| Keep history out of the main form | Eric's spacing request | Header entry opens a bounded recent-jobs list, leaving current source/selection intact underneath. |

## Persistence and compatibility

Receipts remain schema-versioned JSON alongside the output, with source paths, original options and review hashes. Existing receipt schema is unchanged. Settings retain at most twenty recent receipt **pointers**, plus the previous last-export pointer for compatibility. No receipts or exported files are deleted when the shortcut list rolls over.

History merges indexed paths with JSON receipts found in the configured destination, the current destination, their immediate split-output subfolders and the last receipt directory. It validates every record, deduplicates paths, sorts by original creation time and displays five jobs. Existing exports in these known folders work without an index migration. Records in arbitrary old locations are not located by a vault-wide scan. Missing/corrupt records are reported separately; available jobs remain accessible.

History reopens actual delivered files. It does not restore/regenerate an earlier source/settings snapshot. Those options remain inspectable in the receipt; safe restoration would need to reconcile missing/renamed notes, changed book IDs/layouts and current content. This separation satisfies the requested minimum of direct access to recent files without promising reproduction of an old manuscript from changed source notes.

## Native acceptance

Separate background Obsidian 1.14.4 profile and synthetic Working vault; no Author Vault interaction or manuscript edits. Inspected desktop and 620px window screenshots. Measured new sign-off body: display flex, gap 12px, top padding 8px. History file rows use the existing centered inline archetype and wrap long paths without losing their direct action.

| Acceptance | Observed result |
| --- | --- |
| Legacy discovery | Four pre-existing PDF, Word and Markdown export receipts appeared without history pointers. |
| Fresh PDF | Generated a seven-page PDF into a different destination; file checks passed 1/1 and Open file was the sole primary footer action. |
| Direct opening | Footer opened that exact PDF in Obsidian. A history PDF path link also opened its exact file and closed the covering dialogs. |
| Reopening / reload | Reopened export workflow and reloaded Obsidian; history still contained the newest PDF and earlier jobs in descending order. Five jobs visible. |
| Saved sign-off | Exercised the optional Word-receipt check/save UI; reopened history showed Review recorded for that same job. This was a synthetic UI persistence test, not content acceptance of a production document. |
| Missing output | Temporarily moved the new synthetic PDF; history showed its missing-path error and disabled Open file. Restored the file afterward. |
| Split export | Fresh two-part Markdown export passed checks 2/2; newest history job listed both exact files with separate open actions. |
| Multiple sign-off checks | With one of two parts checked, Save sign-off remained disabled; checking the second enabled it. |
| Source integrity | SHA-256 hashes of both synthetic scene notes and Book Details were identical to their pre-change values. |

Evidence in [recent-exports-evidence](2026-10-13-recent-exports-evidence/): history-five.png, details-collapsed.png, signoff-final.png, fresh-export.png, history-narrow.png, history-missing.png, split-success.png, split-history.png and split-signoff.png.

## Stabilization review

Reviewed the changed modal methods, new history service/modal/opener, receipt indexing, settings field, translations and tests. No release-blocking issue identified. Export generation/selection algorithms, receipt validation and review hash semantics remain intact. Removed the duplicate Word-opening implementation; the shared opener is now the canonical route. Renamed the old review-last button reference to recentExportsButton. No new YAML fields, keyboard commands, AI calls or external storage.

The new raw adapter operations are intentional: portable JSON receipts and newly generated artifacts may not be indexed by Obsidian. Each operation has its required same-line SAFE explanation; path validation still occurs at the receipt boundary. The code-quality issue with a direct core class toggle was corrected by using ButtonComponent.setCta/removeCta. The full-suite button stub was updated to expose those real Obsidian APIs.

Remaining limits: tested the existing dark theme on desktop/narrow windows, not every community theme or mobile platform. The Word system-opener route was unit-tested without launching Word during this pass. No new full-manuscript pagination acceptance is claimed; export formatting engines were unchanged. No architectural refactor or additional feature was introduced during the report-first stabilization pass.

## Verification

- Production build / TypeScript passed.
- History, delivery and opener tests passed (22 targeted tests before the full suite).
- All 14 repository gates passed. Full suite: 407 test files passed, 4 skipped; 4,468 tests passed, 17 skipped. Existing nonblocking lint/CSS baseline notices remain unchanged.

Local plugin copies rebuilt. Existing Obsidian windows need RT reloaded. No public release.
