# PDF literal-block wrapping and full-manuscript acceptance

Date: October 11, 2026. Baseline: `535caae7`. Eric approved fixing PDF wrapping and repeating acceptance after the full-manuscript audit found clipped text. **The bounded acceptance run now passes.** The final full PDF contains all 61 chapters and all 537,174 normalized source characters, with zero extracted words outside the page.

## Change

`runPandocOnContent` adds one shared PDF preamble using [fvextra's automatic line breaking](https://www.ctan.org/pkg/fvextra). It wraps plain verbatim environments, highlighted code and long unbroken tokens without modifying the Markdown source. Break symbols are suppressed; continuation lines contain source text rather than added arrow glyphs. Literal blocks use ordinary discretionary-break penalties locally, so screenplay's global no-hyphenation setting cannot force code strings off the page. Ordinary screenplay prose retains its existing setting.

The default preamble precedes the existing optional binding gutter and author-supplied LaTeX preamble. Those explicit author overrides remain last. Word uses its existing rendering branch and reference document.

Bundled and newly generated style templates now include Pandoc's conditional highlighting definitions, allowing recognized-language fences to use their normal Highlighting/Shaded environments. One shared fragment supplies that template slot to the fiction generator and the two script templates. No new format, option, command, keyboard binding, CSS, source schema or author-note field was added.

## Acceptance results

Used the same corrected *Pride and Prejudice* fixture documented in the [initial full-manuscript audit](2026-10-11-publish-full-manuscript-acceptance.md): 61 notes, 121,754 RT-counted words. Original Author Vault prose was not used or edited.

| Check | Final result |
|---|---|
| Full proof | Generated natively from the final build. 433 actual pages. Page 30 shows the formerly clipped letter wrapping; final-page navigation was verified during the run. |
| Full PDF | Final build generated a real 433-page file and two working Markdown artifacts. All 61 headings occur once. All 537,174 normalized source characters match in order. Zero extracted words outside the physical page, versus 366 on 20 pages before the fix. |
| Split PDF | Final build generated three PDFs, 134 / 124 / 176 pages, and six working Markdown artifacts. Chapters I–XXI, XXII–XLI and XLII–LXI occur once. Their joined normalized rendered text matches the entire source, and every part has zero words outside the page. |
| Markdown | Regenerated during the fix run; exact consecutive source-body match. |
| Word | Regenerated and opened in Microsoft Word; still 402 pages. Complete normalized body match. Every package part matches the previously rendered/visually inspected document except `docProps/core.xml` (generation timestamp). Content, styles, relationships and layout parts are unchanged. |
| Receipts | All four selected jobs have no structural-check problems, correct source paths and current hashes for every final/working file. Native review lists all final split filenames and actual page counts. |
| Source integrity | All 61 manuscript source fingerprints still match the pre-export manifest. No source prose, frontmatter or word-count writes. |

Final PDF jobs are in the controlled Scrivener Import vault under `QA Full Manuscript Acceptance/Wrapped Final`. Word and Markdown reruns are under `QA Full Manuscript Acceptance/Wrapped`. The final PDF-only penalty adjustment does not touch either non-PDF branch. Earlier failed/exploratory artifacts remain separate. Obsidian was returned to the Author Vault after native checks.

## Visual verification

All 433 pages of the corrected full novel were opened in page-indexed contact sheets for gross layout inspection. Enlarged checks covered the wrapped letter and its continuation, long letter passages, the ending, and all six split first/last pages. Native proof and delivery-review screens were inspected.

After the final screenplay penalty adjustment, the full novel was generated again through Obsidian and all 433 pages were rasterized again. **Every page PNG is byte-identical to the visually inspected corrected run.** All six final split-boundary PNGs are also byte-identical to their enlarged inspected counterparts. Word's unchanged layout/package parts preserve the earlier 402-page rendering evidence, and its regenerated file opened successfully in Word.

This is bounded layout/content QA, not a glyph-by-glyph editorial proofread or approval of an author's submission manuscript. Normalized text comparison uses Unicode NFKC and ignores punctuation/whitespace; it verifies coverage/order. Markdown separately passes an exact source-body comparison. Source indentation still denotes literal/code formatting; the fix preserves that meaning rather than converting imported letters into prose or blockquotes.

## Regression and repository verification

The live Pandoc/Poppler test checks the default LaTeX template and all six shipped layouts. Its fixture includes an indented long letter, a plain fence, a highlighted Python fence containing an unbroken string, and a 70-line block spanning pages. It compares the complete normalized rendered body with Pandoc's plain-text projection and checks every extracted word against page/text margins, allowing 2pt for existing optical glyph protrusion. It also verifies that an authored preamble survives and existing Word outputs remain intact.

- Nine live output tests passed against the final renderer.
- 102 targeted output-safety/template/spec tests passed.
- Existing four-style PDF visual baselines passed without updates.
- All 15 final repository gates passed, including production build-only, TypeScript, lint/CSS/compliance ratchets and 4,253 tests (17 skipped). Nine of those opt-in render tests were also run explicitly above. No baseline was raised.
- Final gate receipt: `/tmp/rt-full-manuscript-qa/wrapping-final-gates.json`; log: `/tmp/rt-full-manuscript-qa/wrapping-final-gates.log`.

## Post-fix audit and cleanup

Reviewed the shared runner's preparation, header ordering, template/filter arguments, atomic publication and cleanup; the generated template slots; canonical bundled-template synchronization; and the complete live regression. The earlier report-first audit and Eric's approval cover this remediation.

- **Ownership:** one PDF header in the existing render boundary serves proofs and final exports. One shared template fragment supplies Pandoc's language-block definitions. No new controller/service layer or alternate render path.
- **State and safety:** existing staging, collision handling, failure propagation and receipts remain intact. Templates retain the author-preamble-last contract. Source bytes remain read-only. Word output and non-code style baselines stay stable.
- **Naming/dead code:** no unrelated renames or removals; temporary diagnostic logging was removed from the test.
- **UI:** no new chrome or CSS-variable references; no additional inspector-token check is applicable. Existing native proof/review surfaces display actual results.
- **Prioritized findings:** the known literal-block clipping blocker is resolved in the tested paths. No further blocking finding identified within this scope.
- **Limits:** fvextra is a LaTeX dependency available in TeX Live/MiKTeX; an installation lacking it surfaces the existing compilation error rather than silently exporting an unwrapped substitute. Hand-authored templates still need the existing `$header-includes$` hook to consume the shared preamble. Older stored custom templates need the highlighting slot to render recognized-language fences; newly generated/synchronized RT templates include it. Wider raw LaTeX/math/table layout and cross-platform/VoiceOver certification remain outside this run.
- **Delivery:** development build deployed to configured vault folders and the controlled QA vault. Author Vault needs a plugin/app reload to load it. No public release was made.

Next: prepare the export tutorial using an actual finished PDF first, then the ordinary-folder source/review/export workflow.

## Evidence

- [Final acceptance summary](2026-10-11-publish-pdf-wrapping-evidence/acceptance-summary.json)
- [Final full-PDF raster comparison](2026-10-11-publish-pdf-wrapping-evidence/pixel-comparison.json), [split-boundary comparison](2026-10-11-publish-pdf-wrapping-evidence/split-pixel-comparison.json)
- [Native proof at page 30](2026-10-11-publish-pdf-wrapping-evidence/native-proof-page-30.png), [final split review](2026-10-11-publish-pdf-wrapping-evidence/native-split-review.png)
- [Wrapped letter, page 30](2026-10-11-publish-pdf-wrapping-evidence/pdf-page-30.png), [continuation, page 31](2026-10-11-publish-pdf-wrapping-evidence/pdf-page-31.png)
- [Letter, page 68](2026-10-11-publish-pdf-wrapping-evidence/pdf-page-68.png), [page 163](2026-10-11-publish-pdf-wrapping-evidence/pdf-page-163.png), [page 353](2026-10-11-publish-pdf-wrapping-evidence/pdf-page-353.png), [ending](2026-10-11-publish-pdf-wrapping-evidence/pdf-page-433.png)
- [Part 1 ending](2026-10-11-publish-pdf-wrapping-evidence/part-1-last.png), [part 2 opening](2026-10-11-publish-pdf-wrapping-evidence/part-2-first.png), [part 2 ending](2026-10-11-publish-pdf-wrapping-evidence/part-2-last.png), [part 3 opening](2026-10-11-publish-pdf-wrapping-evidence/part-3-first.png), [part 3 ending](2026-10-11-publish-pdf-wrapping-evidence/part-3-last.png)
- [Gate summary](2026-10-11-publish-pdf-wrapping-evidence/gate-summary.json), [live render tests](2026-10-11-publish-pdf-wrapping-evidence/live-render-tests.txt), [style baselines](2026-10-11-publish-pdf-wrapping-evidence/style-baseline-tests.txt)
