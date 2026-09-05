# Draft — Release 6.2.7 (Professional manuscript export)

One release, five workstreams. Origin: Command Center Decision 2026-07-09
"Professional manuscript export — DOCX, metadata, print-ready PDF".

## New

- **Word (DOCX) submission export — Core.** New "Word" output format in the
  manuscript export panel. Produces standard manuscript format (Times New
  Roman 12 pt, double-spaced, 0.5" first-line indent, centered chapter
  headings on new pages) via Pandoc `--reference-doc` and a bundled
  `reference-manuscript.docx` installed into the Pandoc folder. No LaTeX
  engine, PDF layout, or font setup required. Front/back matter Book Pages
  and export-cleanup toggles apply. Formal title-first filenames
  (`<Title> Word <timestamp>.docx`).
- **Print binding gutter — Core.** Opt-in PDF toggle adds
  `\geometry{twoside,bindingoffset=0.25in}` so the inner margin clears the
  spine on duplex-printed paperbacks (KDP/IngramSpark). Persisted setting;
  off by default (screen PDFs unchanged).
- **Advanced Pandoc (Pro), Settings → Publish.** Two migration escape
  hatches for authors arriving with an existing Pandoc/LaTeX setup:
  *Custom Pandoc metadata* (`key: value` lines → `--metadata`, with
  skipped-line feedback on edit; BookMeta title/author always win) and
  *Custom LaTeX preamble* (raw LaTeX via `--include-in-header`, injected
  after the layout's preamble so user definitions win).

## Fixed

- **Running headers restored on Standard and Contemporary Literary.** The
  wizard's per-corner override comparator treated bundled specs' absent
  corner fields as explicit clears, emitting `\fancyhead[POS]{}` after the
  named-mode baseline — wiping running headers on both free layouts in every
  export since the per-corner feature landed (June 11). Absent now means
  "use the preset"; a deliberate wizard clear is the distinct `'empty'`
  value. Caught by the revived `RT_PUBLISH_PDF_ASSEMBLY` suite (below).
- **Revived the gated PDF assembly test.** It silently drifted (`bundledFontPath`
  option renamed to `vaultFontDir`), so it depended on machine-installed
  fonts; it now resolves Source Serif 4 from the repo's bundled files and
  asserts the running-header contract by scanning pages instead of pinning
  page numbers, so legitimate typography changes can't false-fail it.

## Improved

- **Widow/orphan control in all bundled fiction layouts.**
  `\widowpenalty`/`\clubpenalty`/`\displaywidowpenalty` 10000 +
  `\raggedbottom` emitted by the style generator — no more single stranded
  lines at page tops/bottoms. Installed templates refresh automatically via
  spec-drift overwrite.
- **`$header-includes$` hook in every bundled template** (generated fiction
  + hand-coded screenplay/podcast), enabling `--include-in-header` content
  that Pandoc previously dropped silently.
- **Cleanup strippers are now syntax-aware.** Raw LaTeX environments, fenced
  code blocks, and display math are masked before the opt-in strippers
  (comments/links/callouts/block-IDs/task-markers) run — `%%…%%` or
  `[..](..)` patterns inside raw blocks survive verbatim. NUL-token masking,
  nested-environment aware, unclosed blocks pass through untouched.

## Docs

- New wiki contract section: **Publishing → What Survives Export** (inline
  LaTeX preserved; YAML blocks always stripped — use Advanced Pandoc
  instead; DOCX drops raw LaTeX). Manuscript-Export page covers Word export
  and the binding gutter.

## Verification

- 2549 vitest tests pass (5 new sanitize-masking tests); `build-only` green.
- Real-render battery (Pandoc 3.10 + XeLaTeX/TeX Live 2026): all four
  regenerated fiction templates assert the new penalties + hook; Standard
  (oneside) and Contemporary Literary (twoside, bundled Source Serif 4 via
  `Path=`) render with the gutter header; DOCX renders with the bundled
  reference doc and verified styles (TNR 12/double/indent/centered H1);
  inline `\newpage`/`\vspace`/custom-macro passthrough confirmed end-to-end.

## Deferred (tracked in the Decision doc)

- Bundled body font for the free Standard layout (currently system Arial):
  silent font change to existing users' output — needs a deliberate design
  choice, likely alongside Design Wizard work.
- Drop caps (`lettrine`), half-title/`\frontmatter` machinery, EPUB, PDF/X.
