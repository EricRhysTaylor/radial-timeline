# Publish export: reusable manuscript sources

Date: October 11, 2026. Baseline: `65e1e833`. This completes reusable source selection for ordinary manuscript folders and Markdown files, following direct-source export and the PDF proof workspace. RT books continue to use their existing book profiles and publishing preferences.

## Author workflow

Choose a folder or file, enter its title/author, and review its included notes and order. **Save manuscript** creates a named record. **Saved manuscript** loads an existing record; the last explicitly saved or loaded record opens again on the next export-dialog launch, including after an app reload. Choosing RT book clears that remembered direct-source choice.

**Update saved manuscript** explicitly saves changes to the current record. **Save as new** creates a separate record using a different name. Changes to source metadata, membership, order or the record name display an unsaved-changes message. Closing the dialog does not overwrite a saved selection. Export formatting remains in the existing export presets; these records save source identity, title/author, included paths and candidate order, rather than duplicating the formatting preset system.

Saved folders retain excluded notes and their positions in the reviewed candidate list. Newly discovered Markdown notes appear at the end, excluded, with review required. Missing paths remain visible. A missing selected note blocks export instead of silently shortening the manuscript; **Remove missing** explicitly removes that path from the draft selection and requires review. A renamed note appears as a missing old path and a new excluded path. RT does not guess a replacement from its filename. A missing folder/file can be replaced through the normal source picker, then explicitly updated.

Removing a saved record uses a confirmation dialog stating that manuscript notes stay unchanged. This removes the record only. The current in-session selection remains available as an unsaved manuscript.

## Persistence and design

Records use `schemaVersion: 1` in the existing plugin settings, with unique local IDs and a separate last-used source ID. Source objects and path lists are copied at save/restore boundaries; editing a draft cannot mutate the saved record. Save/update detects duplicate names and rejects an update whose record no longer exists. Unsupported or invalid library data is surfaced and preserved, with new writes blocked; it is not partially discarded or silently rewritten. Failed disk writes restore the prior in-memory state, and the plugin's settings-persistence block prevents false save success.

The reference lock is RT's existing ERT export shell and the source-card spacing approved in this session. The saved selector sits above source-type controls; source-specific details remain below the divider. Name fields reuse the metadata grid and actions reuse the wrapping pill row. No new CSS, global shortcut or modifier behavior was introduced. The shared deletion dialog was renamed to describe both publishing item types, while preserving export-preset behavior.

GUI DevTools inspection confirmed the saved selector's flex wrapping and 8px gaps, metadata/name grid's 80px label column and 8px gaps, and action row's wrapping and 8px gaps. All controls remain within the `.ert-ui` modal scope.

## Native and output acceptance

Native checks used Obsidian 1.14.4, macOS dark theme, and invented notes in the controlled Scrivener Import QA vault. No Author Vault prose was edited.

| Check | Observed result |
|---|---|
| Save folder selection | Crossing before Arrival; Research excluded; title/author and all candidate paths persisted in `data.json`. |
| Close/reopen dialog | Same record, metadata, membership and note order restored. |
| Update record | Updated author persisted in the existing folder record. |
| Save separate single-file record | One Crossing note restored on reopening; the folder record retained its own metadata and two-note selection. |
| Full QA app reload | Both records survived; last-used folder reopened with its updated author and reviewed two-note selection. |
| Add a note after saving | New note shown unchecked; existing membership/order unchanged; review required. |
| Rename selected note | Old selected path visibly Missing; renamed path excluded; generation and review blocked until correction. |
| Remove missing path | Blocker cleared; review enabled; after the implementation correction the old inline error disappeared. Draft changes were not written over the saved record. |
| Restored folder Markdown export | Real artifact generated with Crossing before Arrival and Research/late addition absent. Content read and checked. Existing cleanup options remained authoritative. |
| Restored folder PDF proof | Real one-page Basic PDF generated and rendered in the proof pane; title, headings, order and exclusions matched the saved selection. Saved PDF independently rasterized and opened for visual inspection. |
| Removal confirmation | Opened, visually inspected, then cancelled. Record deletion behavior tested with mocked persistence; no native saved record was deleted. |
| Source integrity | All three original QA notes matched their pre-test SHA-256 hashes. Renamed fixture restored; temporary added note moved outside the vault. |

Initial captures include pre-polish singular/plural wording; final native recovery also verified the corrected “1 new note” and “1 saved path” wording. The final build's confirmation was inspected after reload. Screenshot layout review found no clipping or overlap in these desktop fixtures. This is bounded acceptance, not certification of all screen sizes and platforms.

## Post-feature audit, cleanup and hardening

Report-first review covered the saved data types/defaults, complete validation/restore/update helper, all modal save/load/delete/change/error paths, common action guards, source loading, shared confirmation dialog, and new regression tests. Existing export assembly/rendering and formatting-profile persistence remain intact. No additional cleanup edits are proposed after this report.

- **Cleanup / ownership:** source state remains in the modal; persisted record validation and restoration have one helper boundary; existing reviewed-selection validation remains the export authority. No second export engine or source-provider framework.
- **Refactors:** moved the shared manuscript source type into the settings/types contract and re-exported it from its old utility location. Reused the existing publishing confirmation dialog rather than introducing another modal shell.
- **Dead code / naming:** replaced the export-only deletion-dialog name with the publishing-item name; no obsolete compatibility or unrelated code removal. Saved manuscript and export preset labels describe distinct responsibilities.
- **Hardening during implementation:** save/delete guards, snapshot isolation, write rollback, unsupported-schema rejection, stale source-load protection, disabled proof/export during writes, ignored UI refresh after modal closure, cleared obsolete scene counts on source failure, explicit missing-path removal, and recovery of the source-error/review state.
- **Prioritized findings:** no additional release-blocking defect identified in this bounded surface after the implementation corrections. Native filesystem write-failure injection, simultaneous-window library edits, and broad platform/accessibility coverage remain unverified. Saved records are in plugin data; a separate portable library export and retention across plugin uninstall are not implemented.
- **Build safety:** all 15 final gates passed, including production build-only, TypeScript, CSS/lint/compliance ratchets and 4,235 tests (10 skipped). Receipt: `/tmp/rt-saved-manuscripts-complete-gates.json`; log: `/tmp/rt-saved-manuscripts-complete-gates.log`. Existing report-only lint and unused-CSS debt remains within its baselines.
- **Regression evidence:** JSON round-trip restoration, author order/exclusions, copied snapshots, new/missing/renamed paths, single-file availability, duplicate names, disappeared records, invalid/unsupported persisted data preservation, save failure, blocked settings, record removal isolation and cleared recovery errors. Existing PDF/Word/Markdown selection contracts still pass.

## Next and acceptance limits

Next: destination review and a clear final-delivery check connecting the reviewed manuscript to its generated output. Follow-on work may include a portable source-library artifact, deliberate path-repair tools, long-manuscript/large-folder performance, light theme, narrow windows, VoiceOver and Windows/Linux. Word pagination was not newly certified in this phase. Source notes are read at generation; saved records do not freeze manuscript prose. This is deployed development work, not a public release.

## Evidence

- [Saved folder workspace](2026-10-11-publish-export-saved-sources-evidence/saved.png)
- [Reopened folder](2026-10-11-publish-export-saved-sources-evidence/reopened.png)
- [New note excluded](2026-10-11-publish-export-saved-sources-evidence/new-note.png)
- [Missing selected note](2026-10-11-publish-export-saved-sources-evidence/missing-note.png)
- [Recovered missing path](2026-10-11-publish-export-saved-sources-evidence/recovered-missing.png)
- [Reopened single file](2026-10-11-publish-export-saved-sources-evidence/single-reopened.png)
- [Saved-selection proof workspace](2026-10-11-publish-export-saved-sources-evidence/saved-proof.png)
- [Saved-selection PDF page](2026-10-11-publish-export-saved-sources-evidence/saved-proof-artifact.png)
- [Markdown output](2026-10-11-publish-export-saved-sources-evidence/restored-export.md)
- [QA saved records](2026-10-11-publish-export-saved-sources-evidence/records.json)
- [Removal confirmation](2026-10-11-publish-export-saved-sources-evidence/remove-confirmation.png)
- [Selector computed styles](2026-10-11-publish-export-saved-sources-evidence/saved-picker-computed.txt)
- [Field computed styles](2026-10-11-publish-export-saved-sources-evidence/saved-fields-computed.txt)
- [Action computed styles](2026-10-11-publish-export-saved-sources-evidence/saved-actions-computed.txt)
