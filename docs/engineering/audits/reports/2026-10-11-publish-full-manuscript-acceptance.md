# Full-manuscript export acceptance

Follow-up: the approved wrapping fix and full rerun now pass. See [PDF wrapping remediation and final acceptance](2026-10-11-publish-pdf-wrapping.md). The initial failure evidence below remains historical.

Date: October 11, 2026. Product baseline: `7b4b5df3`, Obsidian 1.14.4 on macOS. **Overall result: not accepted for PDF delivery.** The full run exposes visible clipping of long literal lines. Markdown and Word preserve the complete manuscript in this bounded run; saved-source loading, proof pagination, split membership, destination handling and structural delivery checks work at novel scale.

## Source and acceptance scope

Used the 61 chapter bodies of *Pride and Prejudice* already present in the controlled AI Certification demo vault. A separate folder, `QA Full Manuscript Source`, was created in the Scrivener Import QA vault. Demo frontmatter was omitted, and each existing chapter label was converted to one Markdown heading. The final fixture contains **121,754 words**, matching RT's displayed counter. Hard-wrapped paragraphs, emphasis and indented letter passages were retained.

My initial fixture conversion missed uppercase chapter labels and introduced duplicate headings. Those exploratory outputs are excluded from acceptance. All evidence below uses the corrected fixture and exports under `QA Full Manuscript Acceptance/Final`. The original demo notes and Author Vault were not edited. The 61 corrected source files match their pre-export SHA-256 fingerprints after all final runs. All delivered artifacts still match their receipt fingerprints. The QA plugin's `main.js` matches the repository's built `release/main.js`.

The workflow used the native export dialog, not a substitute export implementation: choose folder, review all 61 notes in natural order, **Use this order and selection**, set title/author, save as `QA full novel`, close/reopen, choose each format and its destination, generate, and inspect the real files. Reopening restored title, author and all 61 paths. Every-line-is-a-paragraph remained off for this hard-wrapped source. Sources were frozen for the final acceptance sequence after fixture preparation.

## Results

| Surface | Evidence and result |
|---|---|
| Markdown | One 696,297-byte file. The complete source bodies occur consecutively, byte for byte, with exactly 61 headings and the final END. Pass. |
| Word | One 315,509-byte DOCX opened through the review dialog in Microsoft Word. Word reports 402 pages; the bundled Documents renderer also produces 402 pages. Every normalized body character matches the expected Markdown-to-plain manuscript, both in DOCX XML and rendered output. No extracted word extends outside the physical page. Bounded pass. |
| PDF proof | Basic style, 423 actual pages. Native page field reached page 423 and Next became disabled. The last page shows the actual ending. Pass for proof generation/navigation; proof shares the clipping defect below. |
| Final PDF | One 918,589-byte PDF, 423 pages, 6 × 9 inches, plus two working Markdown files. File checks and page parsing pass. Content/layout acceptance fails: long literal lines extend outside the page. |
| Three-part PDF | Three real files, 133 / 123 / 168 pages, plus six working Markdown files. Parts contain chapters I–XXI, XXII–XLI, XLII–LXI. All 61 headings occur once across the actual PDFs. Joined compiled Markdown matches the full normalized source. Splitting preserves membership/order; the same rendering defect remains a delivery blocker. |
| Delivery review | Review lists all three PDF filenames, sizes and actual page counts. Opening part 1 opens the actual 133-page file in Obsidian. Reopening Review last export retains all three unchecked content-review boxes and disabled Record review complete. No failed PDF was marked approved. |
| Local receipts | All four final jobs have schema-versioned local receipts, no structural-check problems, correct selected paths, and current artifact hashes. Structural success is correctly distinguished from explicit content review. No completion stamp was recorded. |
| Source safety | All 61 final source hashes unchanged. No source prose, frontmatter, metadata or word-count writes during the final sequence. |

## P1 — PDF literal blocks can silently clip manuscript text

**Trigger:** Markdown paragraphs indented as code blocks, containing long lines. The imported demo's letter passages provide a real example. Pandoc emits `\begin{verbatim}` for these blocks. In the tested Basic PDF path, literal lines are typeset without wrapping to the page's available width.

**Observed:** PDF page 30 visibly cuts the letter at the right edge. The entire-book physical-bounds scan found **366 extracted words extending outside the page on 20 pages**: 30, 32, 66, 67, 161, 162, 313, 314, 319, 320, 325, 326, 347, 348, 349, 350, 351, 417, 420 and 421. This is a count of words whose boxes cross the physical page, not an exact count of wholly lost words. Text between the intended margin and page edge is also poorly laid out.

The source contains 537,174 normalized alphanumeric characters; the extracted final PDF contains 536,477 after removal of its running headers and folios. The first mismatch occurs in the visibly clipped Chapter VII letter. Word's rendered content matches all 537,174 characters. Normalization uses Unicode NFKC and discards punctuation and whitespace, so it verifies body coverage/order rather than exact punctuation or typography. Markdown separately passes the exact source-body comparison.

This is a PDF rendering failure, not a missing chapter, wrong source selection or split assembly failure. Retaining literal block semantics is correct; allowing their text to run off the page is not acceptable. Automatic delivery checks currently establish parseability, file availability, counts and hashes, not typesetting completeness. Their Passed status must not be read as submission approval.

**Proposed bounded remediation, awaiting audit approval:** wrap literal block output to the available PDF line width while preserving source bytes and literal semantics. Cover indented blocks and fenced blocks, including long unbroken strings and blocks crossing pages. Verify the Basic path and bundled/designed templates rather than masking the failure by flattening author text or changing source notes. Add a rendered regression that checks complete content and physical bounds, then regenerate the full proof, final PDF and three split parts. No renderer edit was made during this acceptance audit.

The repository's feature-audit playbook requires a report and approval before audit-prompted edits. A scoped fix-and-rerun approval request was presented during the run. The PDF tutorial and any submission-ready claim should wait for this blocker to be resolved.

## Visual verification and limits

Rendered every page of the final PDF and Word document. **All 423 PDF and 402 Word pages were inspected in page-indexed contact sheets for gross layout defects.** Enlarged inspection covered PDF page 30 and the ending, and Word title/body/indented letter/ending pages. Native Microsoft Word opening and final-page navigation were confirmed. Native PDF proof first/last pages, delivery review and resumed review were inspected.

Contact-sheet review is not a glyph-by-glyph proofread of 825 pages. No blanket submission approval, all-style certification, proof/final byte identity, full RT-book matter-page acceptance, cross-platform testing or VoiceOver certification is claimed. The large Word file retains monospace literal passages inherited from source Markdown. That is faithful literal-block rendering, not a literary-formatting recommendation for imported letters.

This run changes no product code, architecture, naming, CSS, persistence schema or keyboard bindings; no refactors or dead-code removals were performed. Earlier short-fixture delivery tests remain in the delivery report. A fresh repository gate run accompanies this acceptance record; its results are recorded below. Existing model-data changes are outside this work.

## Verification receipt

All 15 fresh repository gates passed, including the production build-only path, TypeScript checks and 4,253 tests (10 skipped). No ratchet baseline changed. Receipt: `/tmp/rt-full-manuscript-qa/gates.json`; log: `/tmp/rt-full-manuscript-qa/gates.log`. [Compact gate receipt](2026-10-11-publish-full-manuscript-evidence/gate-summary.json). Native and artifact analysis: [acceptance summary](2026-10-11-publish-full-manuscript-evidence/acceptance-summary.json), [source fingerprints](2026-10-11-publish-full-manuscript-evidence/source-manifest.json), [physical PDF overflow evidence](2026-10-11-publish-full-manuscript-evidence/pdf-overflow.json). Detailed rendering, contact sheets, verification scripts, logs and original delivery artifacts remain locally under `/tmp/rt-full-manuscript-qa` and the QA vault's `QA Full Manuscript Acceptance/Final` folder.

## Selected evidence

- [PDF proof ending and real 423-page navigation](2026-10-11-publish-full-manuscript-evidence/proof-last.png)
- [Full PDF receipt](2026-10-11-publish-full-manuscript-evidence/pdf-review.png)
- [Visible clipping on PDF page 30](2026-10-11-publish-full-manuscript-evidence/pdf-page-30-clipped.png)
- [Final PDF page](2026-10-11-publish-full-manuscript-evidence/pdf-last-page.png)
- [Word receipt](2026-10-11-publish-full-manuscript-evidence/word-review.png)
- [Word title](2026-10-11-publish-full-manuscript-evidence/word-title.png), [body](2026-10-11-publish-full-manuscript-evidence/word-body.png), [letter](2026-10-11-publish-full-manuscript-evidence/word-letter.png), [ending](2026-10-11-publish-full-manuscript-evidence/word-last.png)
- [Three-part review with all content marks unchecked](2026-10-11-publish-full-manuscript-evidence/split-review.png)
