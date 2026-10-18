# Publish PDF customizer audit and triage — 2026-10-17

Baseline: Radial Timeline `f76cc629`, 7.6.0; Obsidian 1.14.4. Author requested
adding Settings → Publish → PDF customizer and the possible template importer
to the stabilization list. Work used the existing synthetic Output QA Vault.

## Current workflow and triage

| Surface | Current behavior | Disposition |
| --- | --- | --- |
| Bundled style pencil | Opens the wizard with that template's spec; Save creates an editable designed copy | Intended; keep |
| Designed copy pencil | Reopens the saved spec; Update edits the same layout | Intended; path defect fixed below |
| Design your own | Separate archetype-starting wizard entry | Development/beta gated; unchanged |
| Import template | Four-step `.tex` importer; creates a static imported layout, not a wizard design | Still exists, Pro and beta gated; unchanged |
| Imported layout editing | Name/description can change; raw template is edited as a file, without a designed-spec pencil | Intended distinction; keep |
| Import readiness | File/placeholder/structural checks; not a TeX compilation proof | Keep separate from actual PDF acceptance |

The normal build was inspected before enabling the test-only development marker:
Design your own and Import template were disabled with BETA release pending
labels. Bundled customization remained available with the existing Pro access.
No entitlement or shipped feature gate changed. The test-only marker was then
enabled only in Output QA Vault to inspect the importer.

## Confirmed defects addressed

### P1 — Updating a designed style wrote to the wrong vault location

Native reproduction: customize Basic as QA Letter Audit, choose US Letter and
14pt body, save, reopen, change to A4, update. Settings reported A4, but the
original Pandoc template still contained `paperwidth=8.5in`; a second file at
vault-root `designed/qa-letter-audit.tex` contained `paperwidth=210mm`.

The update now resolves the existing vault template through the established
path helper before writing. Missing templates fail without creating a root
replacement or changing the saved layout. New and updated designs store the
exact vault-relative path, preventing compact-name collisions from selecting
an unrelated/historical root file during export. Existing compact paths remain
readable. No historical or author file is automatically removed.

Five persistence regressions cover compact and full paths, missing files,
legacy root duplicates and a fresh design whose compact name already exists
at the root. Two original cases failed before remediation. Native fixed replay
updates the canonical file; a staged root shadow remains byte-identical and
its sentinel is excluded from the exported PDF.

### P1 within beta importer — Empty/unreadable template reported Ready

An empty `.tex` file passed the native Check step as Ready. The `$body$` check
was skipped when content was empty, including the empty result after a failed
read. The same existing placeholder check now rejects those inputs. Two
regressions failed before the fix and pass afterward. Native empty-file replay
shows Blocked with a missing-placeholder message; final Save template is disabled.
Unreadable-file failure was injected in tests, not by changing OS permissions.

### P2 — Final import summary ignored the entered name

Enter QA Imported Audit during setup: the final summary still displayed the
inferred QA valid name even though Save correctly persisted QA Imported Audit.
The summary now prioritizes the current entered name, matching the commit path.
Native final-build replay shows QA Renamed Summary / QA Light Summary correctly;
those extra replay imports were canceled. No new persistent identifier convention.

## Native and actual-output acceptance

- Cancel after changing paper size leaves the existing layout/profile settings
  unchanged. Reopen restores the bundled baseline; no partial custom layout.
- Creating a copy preserves every original bundled layout record. Page-category
  reset does not erase the 14pt body change. Reopen/update preserves the copy's
  identity and saved values.
- All eight Signature categories opened through Next navigation: Page, Body,
  Headers, Folio, Parts, Chapters, Scenes, Epigraph. Captured panel views and
  generated-LaTeX preview were visually inspected; the Signature fork was canceled.
  This is panel/navigation coverage, not every value combination or full visibility
  of every lower control in each scrolled category.
- The corrected importer summary was rendered and inspected with light/dark
  themes at the normal settings-window size and full-screen width. Appearance
  and window mode were restored afterward. No CSS changes were needed.
- Valid local template selection → detection → setup → summary → Save works.
  The custom label persists. Imported layout remains static, without a designed
  spec; both custom and imported copies appear in the export layout picker.
- A deliberately incomplete template passed structural checks but failed actual
  PDF generation with a visible Pandoc/LaTeX error: Environment Shaded undefined.
  No success receipt was claimed. Correcting the synthetic template definitions
  and retrying the same native export succeeded, proving file edits are reread.
- **Customized PDF:** A4, 14pt body, four pages. All pages rendered and visually
  inspected. Long indented/fenced literals fit the margins; Unicode, prose order,
  headers and folios survive. After final duplicate-path hardening, the native
  re-export excludes the root shadow and all four page PNGs are byte-identical
  to the already-inspected output.
- **Imported-template PDF:** A4, two pages. All pages rendered and visually
  inspected. The QA import header appears once; expected manuscript prose,
  Unicode and literal blocks survive. Queries, scene IDs, cut archives and the
  other book are excluded. Imported generic headings/pagination follow the
  static template contract; wizard-specific structure is not inferred as a spec.
- Every Book A/Book B source note, BookMeta and cut archive remains byte-identical
  to the start-of-pass hashes. Only synthetic template/settings artifacts changed.
  Author manuscript files were never used as fixtures.

## Verification

- Focused neighbors: 6 files / 105 tests pass.
- Final `CI=true npm run gates`: all 14 standard gates pass; 417 files / 4,683
  tests pass, 6 files / 24 tests intentionally skipped.
- Separate `npm run release:i18n` passes: nine catalogs, 6,425 keys each.
- Final gate logs: `.gate-logs/2026-10-18T02-21-33-362Z` (UTC filename);
  the private `final-gates.log` records the complete run.
- Existing notices remain: settings definitions/minimum-version policy and the
  unused-CSS ratchet. This audit does not establish public scanner reclassification.
- Build uses CI/build-only/gates; no backup or public release command was run.

## Remaining audit list

1. Editorialist recovered mixed-batch totals still overcount suggestions on
   shared scenes; unchanged by this Publish-focused batch.
2. Exercise customizer Header/Folio/Part/Chapter/Scene/Epigraph value combinations
   through proofs, multiple structured-book fixtures and cross-book preferences.
   Opening all panels does not establish all their rendering outcomes.
3. Importer external drag/drop and absolute-path portability; missing fonts,
   missing packages across environments, file replacement during checks, and
   persistence-write fault injection need separate coverage.
4. Treat import Ready as structural validation. If a compiled proof at import
   time or different wording is wanted, triage that as a workflow decision;
   no automatic compilation step or gate expansion was added here.
5. Normal release/beta/Core/Pro visibility is inventoried, but this pass did not
   sign out or change the user's entitlement to retest every tier live.

Local evidence: Command Center/Agent Runs/2026-10-17 Publish PDF customizer audit.
It contains source hashes, pre/post JSON/TeX reproductions, failing/green logs,
native AX/screenshots and the two inspected PDFs (`customizer-a4.pdf`,
`imported-template.pdf`). This is focused acceptance, not exhaustive release QA.
