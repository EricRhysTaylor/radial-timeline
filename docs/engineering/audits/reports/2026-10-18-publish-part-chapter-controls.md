# Publish Part and Chapter control visibility — October 18, 2026

## Change

The Design Wizard previously displayed Part formatting with Part pages off and
Chapter formatting with Chapters off. Those fields cannot affect the selected
output treatment and made the available customization look broader than it was.

- Part numeral, title, page-break and epigraph fields appear only with Part pages
  on. Epigraph placement appears when either the Part epigraph setting or the
  shared epigraph setting enables its rendering, matching the existing generator.
- Chapter page-break, scene-counter reset and heading-position fields appear for
  Numbered, Titled and Numbered + titled; Off retains the treatment selector.
- Glossary entries follow the available fields.
- `Allow openany` stays available with Parts off: it also sets the document class
  binding option and therefore is not an inactive Part-only control.
- Hiding fields does not clear their stored values. Existing mode-selection
  semantics remain unchanged: enabling Parts from Off starts with Roman numbering.
  No new persisted keys, translations, templates or PDF rendering behavior.

## Verification

- Production build and all 14 gates pass: 419 files / 4,716 tests pass;
  normal opt-in skips remain unchanged.
- Native Obsidian 1.14.4, controlled Output QA Vault: Parts off/on; epigraph
  placement hidden/shown; shared epigraph enabled with Part epigraph off;
  Chapters Off, Numbered, Titled and Numbered + titled observed.
- Distinctive Part title/page-break/own-page epigraph values and Chapter
  page-break/reset/heading-position values survive saving both features Off,
  reopening, and enabling them again. Screenshots and persisted JSON retained.
- With both features Off, the generated TeX remains byte-identical to the
  original despite the changed dormant values. The QA layout was restored
  exactly and the separate structured-layout fixture was left unchanged.
- Prior actual PDF visual acceptance remains applicable: this change does not
  edit the generator or template. No new PDF output was generated in this pass.

## Remaining broader Publish limits

Book Pages drag-reordering and Book Details Escape still require reliable manual
reproduction. Custom import remains beta gated; this work does not promote it or
claim cross-platform certification. No public release was made.

Private evidence: Command Center / Agent Runs /
2026-10-18 Publish Part Chapter controls.
