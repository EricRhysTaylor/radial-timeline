# Scrivener import — usability audit and two-step refactor

Date: 2026-10-08. Scenario: empty vault → Welcome → Scrivener plain-text export with numbered files, plus an Outliner CSV whose names diverge from Radial Timeline's (Themes, People, Location, Story Date, POV, Label, Status, Keywords, Tension, Word Count).

## What the author met before

Six screens, four numbered stages, and up to five buttons per screen:

1. **Start your book** — a 60-word instruction paragraph above a bare folder field; the detected exports appeared last, under the buttons, behind an "Inspect" verb.
2. **Prepare** — an AI mode dropdown first (irrelevant to a Scrivener export), "Import flow" and "Treat this folder as" (internal lane machinery), "Chapters found: 12" for what are scenes, two more instruction paragraphs, five buttons including a "Book Manager" dead end that closed the import.
3. **Confirm scenes** — a split editor and a `***` marker tip for files that are already scenes; a Publish stage dropdown defaulting to Press; the metadata mapping, the one decision that matters, buried at the bottom.
4. **Review** — a 12-row accordion with "0 chars 0 places" pills and a disabled AI checkbox.
5. **Complete** — counts and a Done button; the timeline was left to the author to find.

Hint, warning and error lines used `ert-muted` / `ert-warning` / `ert-error`, which have no CSS: every line rendered at body weight, so guidance and failures read as one wall of text.

## Data the old path lost or misrouted

- Themes, People and Story Date were not recognized; all stayed custom fields. Location was proposed as Place, but Place was missing from the dropdown's options, so the row displayed blank.
- A mapped Subplot cell `Smuggling Run; Sisters` became one ring named `Smuggling Run; Sisters`; structure-only imports were held to one subplot per scene (an AI-run policy). Per-subplot flag columns kept only the first flagged column.
- A column mapped to Act was silently overwritten by folder or positional acts.
- Scrivener Status mapped to RT Status was a silent no-op (the importer writes Status itself).
- Without an outline, per-folder file numbering (`01 Chapter/01`, `02 Chapter/01`) interleaved chapters.
- The outline search climbed to the vault root and took any CSV, so an unrelated spreadsheet could be read as the outline.
- Importing twice merged into the existing `<Source> RT` folder note by note and registered a duplicate book.
- Every file was read twice (validation, then ingest).

## Now

**Welcome → Import manuscript → choose the export → Review → Import → timeline.**

- **Choose**: detected exports as one-click rows (`The Salt Road — 12 scenes · The Salt Road Outline.csv`), a folder field for anything else, export help collapsed.
- **Review** (one screen): book title and stage (default Zero); one row per outline column with sample values and a target select (scene fields, then "Subplot “<column>” for filled cells", "Keep as “<column>”", "Skip"); a live **Your timeline** panel built from the exact proposals the import writes (subplot rings with scene counts, act source, cast counts with an optional notes toggle, collapsible full scene list); the destination folder, blocked if it already exists. Blocking export problems replace the screen with the named problem, the fix, and **Check again**.
- **Import** writes, closes, and opens the timeline on the new book.

Scrivener exports never enter the split editor or AI; other sources (Word, single file, notes folder) keep the existing Prepare → Confirm → Review path.

## Engineering changes

- `scrivenerAdapter`: synonym automap limited to fields the importer honors (`SCRIVENER_FIELD_TARGETS`); list fields accumulate across columns, single-value conflicts are reported (`mappingConflicts`); validation runs inside ingest on the one listing (`inspectScrivenerExport`); ingest returns the outline name and warnings; per-folder numbering is ordered by numbered path segments and blocks when folders are unnumbered; `findScrivenerOutline` requires a Title column and prefers a CSV named after the export folder.
- `extraction`: structure-only keeps every authored subplot (`authoredSubplots`); a mapped Synopsis fills an empty outline synopsis; acts resolve from a mapped Act column, then ACT folders, then position (`resolveImportActs`), and the review says which, and warns when the source names more acts than the timeline has.
- `OnboardingService`: `buildStructureOnlyProposals` reports the act source; `destinationFor`/`destinationExists`; `materialize` refuses an existing destination; destination is `<Book title> RT`.
- `importSummary`: pure counts for the review, derived from the proposals that will be written.
- Removed: the old mapping table and its bulk "mark all custom fields as subplots" button, Scrivener branches in Prepare, the Book Manager dead-end button, the settings scroll helper, `checkScrivenerExport`, `findScrivenerSidecarFile`.

## Verification

- `npx tsc --noEmit`; `npm run build-only`; `npm run gates` (15/15).
- Full suite: 4,098 passed, 7 skipped. New `scrivenerImport.test.ts` runs the divergent-names export end to end (Themes → two subplots on one scene, People → three wiki-linked characters, Story Date → When, Status kept as `Scrivener Status`, Word Count dropped, Main Plot for an unthemed scene) and covers Act columns and per-folder numbering.
- Test vault: `Plugin/Test Vaults/Obsidian Vault Scrivener Import` (12-scene "The Salt Road" export in numbered chapter folders plus `The Salt Road Outline.csv`).

## Deferred

- Word and single-file imports still use the four-stage path; the same one-screen review would suit them once scene splitting is folded in.
- Scrivener's per-document `<Title> MetaData.txt` files (Export meta-data) carry custom metadata the CSV may lack; they are skipped as export furniture.
- Planned empty subplots and editable act boundaries (plan Phase 1–2) are not built.
- Authored Character/Place lists still pass through the AI-era caps (12 characters, 8 places per scene).
