# Publish export native and visual QA

The changed Publish/export surfaces have now been inspected in native Obsidian on macOS, and real native exports have been opened and visually reviewed. This closes the primary visual acceptance gap in the [reliability](2026-10-10-publish-export-phase1.md) and [scene-selection](2026-10-11-publish-export-selection.md) work. It does not certify every platform, custom template or failure scenario.

**Environment:** Obsidian 1.14.4, existing Scrivener Import test vault, Broken Draft (three scenes). The verified plugin files were installed and RT was unloaded/reloaded through Community plugins. A second reload loaded the corrections found during this visual pass. The source baseline was `677b3c40`; the accompanying change fixes three UI defects described below.

## Observed acceptance

| Surface or job | Native/visual result |
|---|---|
| Publish overview and Basic style | Updated Word/PDF requirements and optional pages are visible. Basic describes its actual reading-draft geometry. Export remains available while PDF requirements are missing. [Publish](2026-10-11-publish-export-visual-evidence/02-publish-header.png), [Basic](2026-10-11-publish-export-visual-evidence/01-publish-reloaded.png). |
| Range keyboard and focus | Tab reaches both sliders. Arrow keys and Home/End change the range, respect its boundaries and show a visible accent focus ring. Selecting scene two produces the intended one-scene summary. [Keyboard range](2026-10-11-publish-export-visual-evidence/05-single-scene-keyboard.png). |
| PDF and Word preflight | With no BookMeta, missing title and author appear before generation; Generate is disabled. PDF's style-only Ready status is distinct from overall readiness. [PDF](2026-10-11-publish-export-visual-evidence/06-pdf-blocked-footer.png), [Word](2026-10-11-publish-export-visual-evidence/07-word-blocked-footer.png). |
| Metadata-free Markdown | The one-scene excerpt generated successfully and Open file displayed it in Obsidian. It contained The Hall and its prose, excluding the other scenes. No BookMeta was required. |
| Format switching | The same scene-two range survived Markdown → PDF → Word → Markdown. Changing format/options after completion restored Generate and cleared the prior completed-file state. |
| Metadata and successful PDF | Created a QA Book Details note through Publish and edited its title/author. The modal became Ready. A native Basic PDF excerpt generated, opened in Obsidian and was rasterized for visual inspection. It contains only the selected scene. |
| Successful Word | Native Word generation completed and Open file opened the exported document in Microsoft Word. The one-page document shows the QA title/author, selected scene and readable body, using Times New Roman 12. A separate LibreOffice render was also inspected. [Microsoft Word](2026-10-11-publish-export-visual-evidence/14-word-opened.png). |
| Full-book outputs | Native full-book Basic PDF and Word jobs completed. All three PDF pages and the one-page Word render were inspected; all three scenes appear in narrative order. No clipping, overlap or missing glyphs was observed in these fixtures. |
| Repeat output | Rapid native PDF re-export produced a numbered `(2)` sibling and the UI linked to that actual filename. The earlier excerpt PDF remained byte-identical to its captured hash. [Repeat result](2026-10-11-publish-export-visual-evidence/16-collision-result-list-detail.png). |
| Split output | Native full-book splitting completed with three PDFs. The result panel visibly lists links for all three files. [Complete results](2026-10-11-publish-export-visual-evidence/17-split-results-detail.png). |
| Open-scene excerpt after corrections | With two source scenes and BookMeta open, the dropdown now says Open Scenes (2). Selecting only the second scene displays singular wording, returns from an impossible split to single-file Generate, and exports only The Hall. [Final controls](2026-10-11-publish-export-visual-evidence/18-final-open-scene-controls-detail.png), [final PDF](2026-10-11-publish-export-visual-evidence/pdf-open-scenes-final-1.png). |

Every linked screenshot/image above was opened for inspection. Images from before the three UI corrections are evidence of the earlier tested states; the final controls image is from the reloaded corrected build.

## Computed styles and layout regressions

Used Obsidian's native Elements/Computed inspector without executing console code. Selected the real `div.ert-panel[role="status"]` and its heading. The panel resolves to 16px padding, 8px row/column gaps, a 1px border, 12px corner radii, `rgb(28, 28, 28)` background, and no shadow/backdrop filter. The heading resolves to 16px, weight 700, 20.8px line height and zero margins. [Panel values](2026-10-11-publish-export-visual-evidence/computed-readiness-panel.txt), [heading values](2026-10-11-publish-export-visual-evidence/computed-readiness-heading.txt). The inspector was closed afterward.

The four bundled PDF visual fixtures passed pixel comparison without baseline updates: Basic 2 pages, Standard 7, Professional 2, Signature 7. All 18 pages were inspected as contact sheets; dense continuation pages and the part epigraph were additionally inspected individually. The fixture output remains under `/tmp/rt-publish-visual-2026-10-11`, with the run receipt at `/tmp/rt-publish-visual-2026-10-11.log`.

## Defects found and corrected

1. The scope dropdown counted every open Markdown note under the book, including BookMeta. Its actual scene selection correctly excluded metadata. The label now counts only scene records with matching open paths. Regression coverage includes two scenes plus an open metadata note.
2. One-scene summaries used plural wording. The header and range summary now distinguish scene/scenes and word/words. The reloaded native view shows `1 scene selected`.
3. Narrowing a split range to one scene normalized the model/radio controls to single-file output but left the action label saying `3 files`. Split-state synchronization now refreshes the action label itself, and its duplicate outer refresh was removed. A behavioral test covers the normalization, and native reinspection confirmed plain `Generate PDF` followed by one completed PDF.

No renderer, persisted schema, source-provider abstraction, template geometry or fallback was added. The count fix reads the same scene data already loaded for the scope options. Post-change review found no further release-blocking issue within this bounded surface.

## Verification and ownership

All 15 final repository gates passed after the corrections, including production build, TypeScript checks, lint/compliance/CSS ratchets and the complete unit suite: **4,192 passed, 10 skipped**. Receipt: `/tmp/rt-publish-visual-final2-gates.json`. Existing report-only lint/unused-CSS notices remain unchanged. Earlier installed-tool and runner regression checks remain recorded in the selection report.

The first plugin reload assigned missing scene IDs using RT's existing initialization behavior. A byte-hash baseline was then captured for the three scene notes. Word-count updates were explicitly turned off and visually checked before exports. All three original scene files remained byte-identical to that baseline through Markdown, PDF, Word, split, repeated-output and final-reload tests. No source prose was changed. The QA BookMeta note and generated outputs remain in the controlled test vault; Author Vault prose was not edited.

## Remaining boundary and next work

Visual acceptance applies to the exercised macOS dark-theme surfaces and fixtures. Concurrent jobs, injected failures/partial-job retention and missing-tool/engine cases have automated coverage; they were not all fault-injected through the native UI. VoiceOver speech, light theme, Windows/Linux, custom/imported styles, a long real manuscript and populated matter-page composition remain additional acceptance surfaces. Pixel comparison is regression evidence, not a substitute for inspecting a recipient's manuscript requirements.

Next implement direct ordinary-folder/single-file selection with author-reviewed inclusion and order, then the real document proof workspace. Preserve the existing assembler, cleanup, validation and renderer contract. Full Phase 2/3 professionalization and a public release are not claimed by this QA pass.
