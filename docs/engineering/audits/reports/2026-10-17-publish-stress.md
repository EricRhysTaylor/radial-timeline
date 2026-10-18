# Publish: current-system stress test — October 17, 2026

Recommendation: retain the beta gates for custom import and from-scratch design
for the next release. Stabilize the existing-template customization workflow
first. This pass found four concrete defects, including two that passed the
standard gates and the template-only PDF visual suite.

## Confirmed defects and fixes

1. **New designs overwrote unregistered files.** Filename uniqueness considered
   settings IDs but ignored existing files in the designed-template folder.
   Reserve occupied file names and use exclusive creation. A collision now
   creates a suffixed design; existing author files remain untouched.
2. **Repeated Save overlapped writes.** Add a save-in-progress guard and keep
   Save disabled during persistence. Failed template writes leave the existing
   layout unchanged and permit retry; regression coverage exercises both paths.
3. **Popout proof fonts rendered as boxes.** PDF.js registered embedded fonts in
   the main document while the proof canvas lived in the Settings popout.
   Supply the canvas-owning document to the PDF loader. Native before/after
   screenshots verify readable Roman, body, header, and monospace text.
4. **Designed Signature output bypassed its scene treatment.** A customized
   Signature carried the right spec and template, but manuscript assembly
   followed the generic Markdown-heading branch. This printed headings such as
   `0.0.1 1` instead of Roman separators and retained Roman page folios.
   Designed styles now use the existing structural assembly path, selecting
   dedicated openers, Roman separators, or inline separators from their spec.
   Disabled parts stay suppressed, chapter markers use their template macros,
   Roman counters honor the chapter-reset option, and running titles are set.
   Existing bundled and static imported-layout routing remains unchanged.

No feature gate was opened. No public release was published. No UI redesign,
new commands, architectural extraction, or unrelated naming cleanup was made.

## Verification

| Surface | Result |
| --- | --- |
| Four bundled PDF styles | 18 pages compiled, rasterized, inspected; zero baseline pixel differences |
| Eleven wizard fixture configurations | 22 pages compiled, rasterized, inspected; zero baseline pixel differences |
| Actual designed-manuscript assembly | Three scene treatments; parts/chapters and disabled parts; 15 rendered pages inspected |
| Existing Contemporary assembly contract | Actual assembler → Pandoc → PDF continuation-header check passed |
| Native released visibility | Import/from-scratch disabled without beta marker; existing-template customization reachable |
| Native validation | Impossible width and blank name disable Save; category reset restores values |
| Native cancel | All pre-existing layouts and 12 source/template files unchanged |
| Native collision/save/reload | Existing file preserved; distinct suffixed template created; A4, mirrored margins, Latin Modern 14 pt survive reload |
| Native proof → final PDF | Corrected four-page A4 export; all pages inspected; proof and final page images identical |
| Proof controls | Next, Previous, numeric page selection, first/last page boundaries verified |
| Source preservation | Scene, cut, other-book, existing template hashes unchanged; private queries/other-book sentinels absent from reader PDF |
| Standard gates | All 14 passed; 417 test files and 4,691 tests passed; 6 files/27 tests skipped |
| Opt-in real PDF assembly tests | All four passed separately, including the three new designed-style cases |
| Localization release check | 6,425 keys in each of nine catalogs; passed |

Final gate logs: `.gate-logs/2026-10-18T02-37-06-381Z`.
Pre-existing report-only lint/CSS/compliance notices remain; these are not a
claim that the public Obsidian scanner caution label has been cleared.

The visual matrix is bounded coverage, not every possible wizard permutation.
The new assembly tests close a specific hole in the earlier fixture suite:
hand-written macro bodies could render correctly while the actual exporter
emitted the wrong macros.

## Release and importer threshold

The current limited workflow is the recommended release scope. Include these
four fixes and preserve both beta gates. Before release, retain the normal
release checks and finish any other explicitly queued release blockers; this
report does not certify the whole codebase audit complete.

Before promoting custom import, require a separate acceptance pass covering:

- Valid imported templates produce inspected PDFs, and invalid/empty/unreadable
  templates remain inactive. Structural Ready must not imply compile success.
- Missing fonts/packages, unsupported macros, path portability and external
  drag/drop produce clear results; source templates are never overwritten.
- Changed/deleted templates, settings-write failures and interrupted/repeated
  saves have explicit recovery behavior; no false success after reload.
- Structured multi-book manuscripts and per-book preferences retain their
  intended parts, chapters, scene treatments, contents and pagination.
- Native proof rendering and exported PDFs agree for representative fonts and
  supported windows/platforms; release and localization gates stay green.

Remaining current-system coverage: broad Header/Folio/Epigraph combinations,
large structured manuscripts, cross-book preference isolation, and failure
between template-file persistence and settings persistence. Do not infer those
outcomes from the passing checks above. Editorialist recovered-round totals
remain a separate queued issue.

Private evidence: Command Center/Agent Runs/2026-10-17 Publish stress test.
It includes retained PDFs/PNGs, native AX/screenshots, before/after hashes,
failure/green test logs, build/gate logs, and output verification JSON.

Continuation: [Publish acceptance follow-up](2026-10-17-publish-completion.md) closes the interrupted-save and broader output gaps, and records the remaining owner guidance/native interaction checks.
