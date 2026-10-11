# Publish export: direct manuscript sources

RT manuscript export now accepts an RT book, an ordinary vault folder, or a single Markdown file. This implements the direct-source portion of the [professionalization audit](2026-10-10-publish-export-professionalization.md), following [consistent selection across formats](2026-10-11-publish-export-selection.md). It extends the existing assembler, cleanup, readiness and Pandoc pipeline; it does not implement Longform compatibility or introduce another export engine.

Date: October 11, 2026. Baseline: `744939c9`. Native acceptance: Obsidian 1.14.4, macOS dark theme, the existing Scrivener Import test vault. The purpose-built `QA Publish Plain` folder contains three invented Markdown notes outside the RT book source. No author-vault manuscript was used.

## User-facing behavior

- The source card offers **RT book**, **Folder**, and **Single file**. Choosing an RT book does not change the timeline's active book. Modal validation, scene loading, publishing preferences, style options and generation refer to the selected book identity.
- Folder selection proposes natural path order, includes Markdown notes in subfolders, and shows every candidate. The author can uncheck notes and move them earlier/later with visible buttons. Generation requires **Use this order and selection**; changing the selection or order requires review again. It does not infer chapters, scenes or publishing roles from ordinary notes.
- Single-file export retains the file's own Markdown headings. Folder export joins the selected note bodies with blank lines and also retains their headings. YAML is stripped from the output, without changing the original notes. Plain sources do not gain RT scene/matter interpretation, synthetic scene headings, scene IDs or word-count writes.
- Title and author for plain sources are entered in the dialog. PDF and Word validate those fields independently of the active RT book. Markdown needs neither publishing metadata nor external publishing tools.
- Reviewed contents apply to PDF, Word and Markdown. A saved RT range, subplot or chronology cannot narrow or reorder an explicit reviewed note list. Missing, duplicate, non-Markdown or out-of-scope paths block generation instead of disappearing from the document.
- Source controls are inert during generation and become available again when the job completes. Stale asynchronous scene-load responses are ignored. Submitted source identity, note paths and metadata are captured for the job.
- Plain PDF body numbering starts at Arabic page 1. Existing style geometry, font policy, cleanup choices, optional output splitting and safe binary publication remain on their existing paths.

Source selection, title, author and note order are **in-session choices** in this phase. They are not yet saved as a reusable manuscript source. Source bytes are read at generation, not frozen at selection time.

## Design reference and decisions

Primary visual reference: the existing RT ERT export shell and its captured audit screens. Preserve the current modal surface, typography, flat panels, spacing tokens, visible format/purpose controls and theme accent. Refero's bundled form/focus guidance supplements this established product target; no new visual language or external screen was copied.

| Decision | Reference / constraint | Result |
|---|---|---|
| Source identity precedes purpose and format | Approved export workspace contract | Authors can enter from their manuscript rather than the timeline. |
| Explicit inclusion and visible move controls | Author-reviewed order requirement; keyboard preference | No bespoke shortcut or modifier handler was added. |
| Inline title/author | Setup-free plain-source requirement | No BookMeta note or new source YAML is required. |
| Retain note headings | Author-owned manuscript structure | Formatting does not invent RT scenes or chapters. |
| Compact grid rows, bounded contents list | ERT primitives and form guidance | Reorder actions sit beside their note; labels and fields align. |

The initial native review found oversized vertically stacked reorder buttons, a timeline-only introduction, an incomplete review readiness state, and Roman body numbering for plain PDF exports. These were corrected during implementation and rechecked. The compact source list and metadata grid were inspected in DevTools through the GUI, without executing console code: list padding resolves to 12px, list gaps to 8px, max height to 320px with vertical scrolling; metadata rows resolve to a grid with 80px label columns and 8px gaps.

## Native and output verification

The folder was reviewed to exclude `03 Research.md` and place `02 Crossing.md` before `01 Arrival.md`. The selected two-note scope survived PDF → Markdown → Word format changes. The first native PDF revealed Roman body numbering; the corrected output was then generated and rasterized again.

| Output | Observed result |
|---|---|
| Folder PDF, 10:12 AM | One page; Crossing precedes Arrival; both original heading levels retained; research and private comment absent; Arabic page 1. Raster opened and inspected. |
| Folder Markdown, 10:13 AM | Same two-note order and prose; private-comment cleanup explicitly enabled; source YAML absent. Output content read and checked. |
| Folder Word, 10:14 AM | Opened in Microsoft Word; title/author, two body pages, retained headings and note order inspected. Existing bundled reference document supplies Word styling. OOXML content checked for exclusions and cleanup. |
| Single-file PDF, 10:20 AM | Opened in Obsidian and rasterized; only Crossing, including its nested heading; body prose appears once; Arabic page 1. Raster opened and inspected. |
| Final source-locking job | Native AX observation during Pandoc showed the source controls absent from interaction while Generate PDF was disabled. Completion restores the source controls. |

All three original QA source files match their pre-export SHA-256 hashes byte for byte, including the custom YAML field. Successful PDF and Word generation used real installed tools. These checks are local acceptance evidence, not a public release or an exhaustive manuscript certification.

## Post-feature audit, cleanup and hardening

Reviewed the changed source type/helpers, complete source selector and review methods, modal source-dependent state/persistence and submission paths, runner selection and assembly calls, readiness override, CSS, and regression tests under the feature-audit playbook. This is the report-first audit; no additional cleanup edits are proposed after this report.

- **Cleanup / ownership:** selected source is the modal's single identity; plain note membership/order has one reviewed path list. The runner resolves exactly that list without rescanning. Book-only writes use the selected book or are omitted for plain sources.
- **Refactors performed:** active-book reads in the modal were replaced with the selected source book; the existing scene loader accepts an explicit folder. Source selection uses two concrete helpers in `exportContext.ts`, rather than a provider framework.
- **Dead code removed:** the long timeline-specific modal introduction and redundant active-title/source imports were removed from the modal. No unrelated extraction or fallback path was added.
- **Naming:** plain manuscript counts say notes; RT book counts retain scenes. Direct metadata failures point to the dialog's fields.
- **Safety:** in-flight source locking, stale-load rejection, path validation, source-copy submission, format-independent reviewed membership, saved-range rejection for plain sources, and read-only plain-source exports are covered. Existing RT range/ordering/open-scene tests continue to pass.
- **Findings:** no additional release-blocking issue identified within this bounded surface after the implementation fixes and verification. Large-folder performance, accessibility and broader platform coverage remain acceptance work below.
- **Verification:** all 15 final gates passed, including production `build-only`, TypeScript checks, CSS/lint/compliance ratchets and 4,212 unit tests (10 skipped). Receipt: `/tmp/rt-manuscript-source-accepted-gates.json`; log: `/tmp/rt-manuscript-source-accepted-gates.log`. Existing report-only lint and unused-CSS debt remains within its baseline.

## Deferred work and acceptance limits

Next: the actual document proof workspace, using the existing assembler and renderer, with page count and visible stale-proof state. Word requires truthful treatment of its own pagination; a PDF cannot certify Word pages.

Other follow-up work: reusable plain-manuscript source/order persistence in plugin data or sidecars; explicit plain-source front/back matter choices; source-change detection between proof and final delivery; richer note/chapter navigation; destination review; long-manuscript and large-folder performance; light theme, VoiceOver, narrow windows, Windows and Linux. Structure-specific style diagrams remain schematic and do not rewrite plain-source headings. This phase does not establish those additional acceptance results.

## Visual evidence

All images below were opened for inspection. GUI inspector observations are saved alongside them.

- [Final folder source and compact review controls](2026-10-11-publish-export-direct-sources-evidence/final-folder.png)
- [Single-file source and metadata controls](2026-10-11-publish-export-direct-sources-evidence/single-file.png)
- [Reviewed folder PDF](2026-10-11-publish-export-direct-sources-evidence/folder-pdf-1.png)
- [Single-file PDF](2026-10-11-publish-export-direct-sources-evidence/single-pdf-1.png)
- [Word title page](2026-10-11-publish-export-direct-sources-evidence/word.png)
- [Word body pages](2026-10-11-publish-export-direct-sources-evidence/word-body.png)
- [Source list computed styles](2026-10-11-publish-export-direct-sources-evidence/source-list-computed.txt)
- [Metadata field computed styles](2026-10-11-publish-export-direct-sources-evidence/source-field-computed.txt)
