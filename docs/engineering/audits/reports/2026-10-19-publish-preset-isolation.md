# Publish preset isolation and final interactions — October 19, 2026

## Corrected finding

Native preset create/delete QA showed that saving a new export preset rewrote
unrelated books' defaults to that preset. Deletion removed the preset but left
those defaults pointing at its missing ID. Publishing normalization ran on every
save and reapplied the global last-used preset as every book's default.

Existing book default/last-used assignments now remain canonical after migration.
Legacy per-book layout selections still update their preferred layouts; migration
seeds a missing book record without rewriting existing records. The export modal
uses a book's own last-used choice, snapshot and default before global activity.

Deleting a saved preset removes its global and per-book assignments together in
one settings save. Other presets, per-book layout choices and last-used snapshots
are retained. A rejected save restores the prior preset/assignments when no newer
settings change has intervened; the existing save error remains visible.

## Evidence

- Two migration regressions failed before the fix. Focused coverage also checks
  deletion across several books, save rejection, reload without reassigning an
  intentionally unset default, and book-default precedence over global last use.
- All 14 gates pass: 426 test files / 4,771 tests pass; six files / 35 normal
  opt-in tests skip. The focused preset/migration suite passes 24 tests.
- Native Output QA Vault, Obsidian 1.14.4: saved a disposable preset on the fixed
  build, compared every book's default and inactive-book last-used assignments,
  confirmed deletion, and verified no persisted assignment retained the removed
  ID. Screenshots and exact settings before/after are retained privately.
- Saved manuscript create, reviewed selection, save and confirmed removal passed.
  Its notice correctly states that source notes remain unchanged. All 115
  pre-existing QA notes are unchanged after testing; BookMeta test edits were
  restored to their original bytes. No author manuscript was used as a fixture.
- Native Microsoft Word's Next Comment control navigated to the exported
  author-query balloon in the actual two-page editor-round output. The balloon
  shows its QA author and query marker beside the expected source passage.
  Its complete query text and comment anchors already passed structural checks.

## Limits and next checks

Book Details Escape and Book Pages drag still require a human replay. Native
automation committed the title edit on blur and did not establish a successful
HTML drag; neither observation alone establishes an application defect. The QA
title was restored. An owner follow-up is pending; no speculative input/drag
change is included.

No PDF generator/template change, beta-import promotion, language activation or
public release is included. Existing report-only settings-search and tooltip-helper
lint notices remain; this patch introduces no new scanner advisory.

Private evidence: Command Center / Agent Runs / 2026-10-19 Publish final
interactions and 2026-10-19 Publish preset isolation.
