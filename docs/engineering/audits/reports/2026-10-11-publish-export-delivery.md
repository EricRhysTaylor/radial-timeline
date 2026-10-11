# Publish export destination and delivery review

Date: October 11, 2026. Baseline: `52ebc4ad`. This adds per-export destination review, checks of actual generated files, and resumable review of the most recent export. Existing source selection, saved manuscripts, formatting presets, assembly and rendering remain on their current paths.

## Workflow

The **Destination** card shows the vault folder, selected scene/note count and expected final-file count, including requested working Markdown. Authors can type a new folder or choose an existing folder through Obsidian autocomplete. The choice applies to this job; **Use configured default** restores the existing setting. Split output still receives its own subfolder. Invalid absolute/traversing/hidden paths and a file in the folder chain are blocked before generation, without substituting another destination.

Generation freezes all export controls. The runner verifies that the reviewed scene selection still matches its actual selection before writing. Text outputs cannot overwrite a selected source note, including selected matter pages. PDF/Word retain their existing exclusive publication and collision handling; receipts use the actual returned filenames, not predicted names.

After generation, automatic checks inspect every requested final file and working artifact. PDF checks parse real page counts through the shared public PDF.js loader. Word checks inspect the ZIP package's main document body and required package parts; they do not certify Word pagination or the full OOXML schema. Text outputs must be nonempty and decodable; JSON outputs must parse. The result records actual paths, sizes, SHA-256 fingerprints, source paths, submitted export options and check problems in a vault-local `schemaVersion: 1` receipt beside the output.

**Review exported files** opens a dedicated review dialog. **Review last export** resumes the newest job, even after the export dialog was closed to read a file. Opening a file does not mark it reviewed. Each final file has an explicit content/formatting checkbox; its mark is bound to that file's checked bytes and saved immediately. **Record review complete** requires every requested final file to be reviewed and all automatic checks to pass. It rechecks current bytes before recording completion.

**Recheck files** detects changes and clears affected marks and recorded completion. Changed files must be reviewed again. Invalid, empty, unavailable or missing split output keeps completion disabled. Partial generation retains links to completed files and, when a receipt can be saved, records the unfinished job rather than presenting it as complete. Receipt-write failure surfaces the existing created paths without pretending a review record exists.

Review records contain source identity and export choices, not a frozen copy of manuscript prose. Source paths include selected matter notes; the pre-generation comparison separately verifies the scene range. Final export continues to compile current inputs rather than promote the earlier proof's bytes.

## Design lock and references

The primary target is RT's existing ERT export workspace and the source-card spacing approved in this session. Preserve its typography, theme accent, flat panels, buttons, 16px panel padding, 8px internal gaps and 12px radius. Supplementary Refero research examined [Linear Changelog](https://linear.app/changelog), [shadcn UI](https://ui.shadcn.com), and [Expo](https://expo.dev): restrained borders and text hierarchy, compact functional groups, and a clear distinction between primary and secondary actions. No external palette, font, imagery or component theme was imported.

| Decision | Purpose |
|---|---|
| Destination beside the final action | Review the place and output count immediately before generation. |
| Separate automatic checks and explicit content review | File existence/package checks cannot establish submission readiness. |
| One card per actual final file | Split output cannot disappear behind a single Open file button. |
| Local receipt and Review last export | Resume review after opening the real output. |
| Marks bound to current bytes | Edited documents cannot retain an obsolete completed review. |
| Dedicated review modal using shared ERT primitives | Preserve the export dialog's existing design language. |

The Word package check follows the basic main-part/body structure described by [Microsoft's WordprocessingML documentation](https://learn.microsoft.com/en-us/office/open-xml/word/structure-of-a-wordprocessingml-document). It is a limited structural check, not application-level certification. Actual Word rendering was checked separately below.

GUI inspector verification found 16px padding, 8px gaps, 1px borders, 12px radii and no shadow on destination/review panels; 80px label columns and 8px gaps on the destination field; 8px gaps with wrapping on file actions; and `overflow-wrap: anywhere` on paths. New chrome stays inside `.ert-ui`. Folder autocomplete uses Obsidian's existing global suggestion surface. No new global command or modifier binding was introduced.

## Native and artifact verification

Obsidian 1.14.4, macOS dark theme, and invented material in the controlled Scrivener Import QA vault. Author Vault prose was not used or edited.

| Check | Observed result |
|---|---|
| Invalid destination | `../outside` shows the relative-path error; Generate is disabled. |
| File instead of folder | Selecting the existing Arrival note as the destination shows the folder-chain conflict; Generate is disabled. |
| New nested destination | Real folders created only on generation. Global configured destination remained unchanged. |
| Split Markdown | Two real files generated in the reviewed destination/subfolder; both checked; Crossing precedes Arrival and Research is excluded. |
| Open/resume review | Opening the first file did not check it. Marking it reviewed persisted while opening the second file and reopening Review last export. |
| Record completion | Disabled until both QA files were marked; recorded only after a fresh byte check. This exercises QA state, not author approval of a real manuscript. |
| Change an exported file | Recheck cleared that file's mark and recorded completion, retained the unchanged second file's mark, and showed Changed since export. Original output bytes restored afterward. |
| Split PDF plus working artifacts | Two actual one-page PDFs and all four requested Markdown artifacts checked. Both PDF pages rasterized and opened for visual inspection. |
| Corrupted PDF | Real PDF.js parse rejected the controlled invalid payload; only one of two files checked; review completion disabled. Original bytes restored. |
| Missing PDF part | Only one of two checked; completion disabled. Temporarily moved part restored byte for byte. |
| Polished missing-file message | Final build reported The file is missing at its exported path, without displaying the operating-system stack/path detail. Restoring and rechecking recovered the file check. |
| Word | One actual DOCX package checked and opened by the review button in Microsoft Word. Its title page and two body pages were rendered with the bundled Documents renderer and visually inspected; expected headings/order/prose appear once, without clipping or overlap. Word page count is not exposed as an automatic delivery check. |
| Final receipt fields | Generated local date/time and Export choices visible; submitted options and actual source paths persisted. |
| Source integrity | All three original QA manuscript notes match pre-test SHA-256 hashes. No source prose, YAML or word counts were changed. |

Earlier screenshots include the initial raw filesystem diagnostic before its wording was polished; the final missing-file screenshot verifies the corrected UI. Desktop screenshots and rendered artifacts were opened for inspection. Native checks did not cover every platform/window size or all outline formats.

## Post-feature audit and hardening

Report-first audit covered the complete delivery helper and schema reader, review modal and async lifecycle, destination card/action guards, all four runner completion paths and partial failure path, shared PDF loading/count ownership, desktop path resolver, source-overwrite protection, CSS and new tests. No additional cleanup edits are proposed after this report.

- **Ownership / cleanup:** one delivery helper owns validation, file checks, receipts and review eligibility. The review modal owns display and interaction; the runner supplies its actual paths and source selection. Existing assembly and publication remain authoritative.
- **Refactors:** shared the existing local PDF loader between preview and page-count checks; reused the reviewed desktop path resolver and narrowed its host type to the `app` it actually needs. Removed premature success notices in favor of completion-check results.
- **Dead code / naming:** no unrelated removal; Close now names the export modal's completed action without implying content-review approval. File checks and Review recorded identify different states.
- **State hardening:** all controls inert during generation, stale scene-selection rejection, protected source-note paths, actual collision filenames, schema/path validation before reopening receipts, current-byte review checks, persistent partial checkmarks, cleared marks on file changes, ignored late modal rendering and released PDF loading tasks.
- **Prioritized findings:** no additional release-blocking issue identified in this bounded surface. Word package checking remains intentionally limited; full source-byte freezing, exact proof promotion, older-job browsing, and broader native/platform/accessibility acceptance are deferred.
- **Verification:** all 15 final gates passed, including production build-only, TypeScript, lint/CSS/compliance ratchets and 4,253 tests (10 skipped). Receipt: `/tmp/rt-export-delivery-final-receipt-gates.json`; log: `/tmp/rt-export-delivery-final-receipt-gates.log`. Existing report-only lint and unused-CSS debt stayed within its baselines; no enforcement baseline was raised.
- **Regression coverage:** strict destination validation and folder/file conflicts; actual path/size/hash receipts; split/working-file counts; empty/missing outputs; Word package rejection; changed-byte review invalidation; safe receipt paths; parsed PDF page count/task cleanup; reviewed-source changes; source overwrite protection; whole-control generation locking; partial render failure retaining completed-file checks.

## Boundaries and next work

Only the newest receipt is directly resumable through Review last export; earlier records remain alongside their outputs. A receipt is an operational record of generated files and declared review, not a signature or proof of authorship. Basic file checks do not inspect every glyph, paragraph, comment, or content exclusion; the explicit file review remains necessary.

No immutable manuscript snapshot/exact proof promotion, source-library portability, full export-history browser, native disk-permission failure injection, full-length novel stress test, VoiceOver/narrow-window/light-theme/Windows/Linux certification, or new native CSV/JSON review acceptance is claimed. This is deployed development work, not a public release.

Next: a bounded full-manuscript acceptance run, then the export tutorial showing the finished output first and the ordinary-folder workflow end to end.

## Evidence

- [Destination validation](2026-10-11-publish-export-delivery-evidence/invalid-destination.png)
- [Reviewed destination and split count](2026-10-11-publish-export-delivery-evidence/destination-plan.png)
- [File-path destination conflict](2026-10-11-publish-export-delivery-evidence/file-destination.png)
- [Markdown review](2026-10-11-publish-export-delivery-evidence/md-review.png)
- [Recorded QA review](2026-10-11-publish-export-delivery-evidence/review-recorded.png)
- [Changed output invalidates review](2026-10-11-publish-export-delivery-evidence/changed-output.png)
- [PDF and working-artifact completion](2026-10-11-publish-export-delivery-evidence/pdf-complete.png)
- [PDF review and real page counts](2026-10-11-publish-export-delivery-evidence/pdf-review.png)
- [Corrupted PDF blocks completion](2026-10-11-publish-export-delivery-evidence/corrupt-pdf.png)
- [Final missing-file wording](2026-10-11-publish-export-delivery-evidence/clean-missing.png)
- [Word review](2026-10-11-publish-export-delivery-evidence/word-review.png)
- [Word title page](2026-10-11-publish-export-delivery-evidence/word-page-1.png), [body page 2](2026-10-11-publish-export-delivery-evidence/word-page-2.png), [body page 3](2026-10-11-publish-export-delivery-evidence/word-page-3.png)
- [PDF part 1](2026-10-11-publish-export-delivery-evidence/pdf-part-1.png), [part 2](2026-10-11-publish-export-delivery-evidence/pdf-part-2.png)
- [Final review with recorded export choices](2026-10-11-publish-export-delivery-evidence/final-review.png)
- [Example delivery receipt](2026-10-11-publish-export-delivery-evidence/final-receipt.json)
- [Destination inspector](2026-10-11-publish-export-delivery-evidence/destination-computed.txt), [field](2026-10-11-publish-export-delivery-evidence/destination-field-computed.txt)
- [Review panel inspector](2026-10-11-publish-export-delivery-evidence/review-panel-computed.txt), [file card](2026-10-11-publish-export-delivery-evidence/review-file-computed.txt), [actions](2026-10-11-publish-export-delivery-evidence/review-actions-computed.txt), [paths](2026-10-11-publish-export-delivery-evidence/review-path-computed.txt)
