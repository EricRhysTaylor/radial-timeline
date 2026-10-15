# Chronologue time references: feature audit

Date: 2026-10-14. Scope: the manual prototype in
`src/chronologue/timeReferences/`, its four test files, ring/number/label layout
integration, Chronologue interaction setup, subplot spotlight, Timetable
registry/view, plugin registration, CSS bundling, five locales, and YAML docs.
Read-only stabilization review after implementation and native corrections;
no cleanup refactors were applied during this review.

## Result and cleanup summary

No release-blocking defect was found in the implemented reference flow. The
prototype retains one manuscript scene per file. References use separate typed
declarations and rendered occurrences, never synthetic scene items. Pure parsing,
placement, and SVG rendering are isolated from vault writes and ephemeral
selection. Existing feature integrations remain small, targeted additions.

Implementation verification corrected seven Timetable listeners to use the
existing root delegation, and corrected pinned selection so expansion happens
once per activation. A regression test covers restoring a pin without reopening
collapsed children. Metadata changes, rename, and deletion invalidate captured
selection keys; navigation and modal writes also revalidate current data.

## Findings, in priority order

- **Medium, separate shared UI concern:** native plugin disable/enable produced
  SVG `text` elements with `y="NaN"` in `.rt-synopsis-text`. Reproduced in
  Narrative with zero reference slices (24 invalid synopsis text elements), as
  well as Chronologue. Switching modes rebuilt valid text. This is not evidence
  of a clean reload console. `SynopsisManager.ts` is untouched by this feature;
  its reload/layout lifecycle needs a separately scoped investigation. No
  speculative fix or baseline suppression was added.
- **Low, existing repository debt:** the standalone fallback ratchet reports
  `or-chain-3` at 79 against a maintenance baseline of 52. Scanning the exact
  pre-feature HEAD source independently also returned 79. This change does not
  increase that count or change its baseline. This extra check is outside the
  current 14-step core gate profile. Core gates pass; report-only lint and
  producer-less CSS notices remain recorded in their logs.
- **Low, acceptance coverage:** native evidence is a three-scene desktop study,
  not a large manuscript benchmark or mobile/touch acceptance. Dense 500-entry
  allocation is unit-tested. Keyboard activation, alternate-calendar display,
  lens/coloring, narrow/light appearance, rename/deletion, and full publishing
  flows have code/test review where applicable, but no complete native matrix
  is claimed for those surfaces.

## Ownership and release safety

The author explicitly enrolls `Time References` in the advanced Scene template
before editor writes. No backfill, operational YAML IDs, persisted selection,
AI extraction, or new sidecar was introduced. Unknown entry fields survive
edits; unrelated fields and prose are not targeted. Unsupported declarations
produce diagnostics, and missing/repeated excerpts never navigate by guesswork.
Guarded writes reject concurrent array changes; Undo uses the same guard.

Per-ring allocation reserves at most a quarter of its angular space for narrow
reference slots and retains dense declarations in explicit clusters. Fill uses
local ring positions; Sequence shares outer placement. Both connector endpoints
use the parent ring's inner radius. Primary scene positions are identical when
there are no references. Primary scene counts, Runtime, elapsed gaps, drag
neighbors, and export inputs continue to consume scene records only.

The CSS inspector found no unresolved values among the global size, icon,
text, accent, and hover tokens used by reference chrome. Nine slices and nine
connectors represented three references in three visible rings. Timetable
children stayed outside file-row/bulk-selection maps. No new global shortcuts,
timers, vault scans on hover, or background jobs were added. Timetable hover
does reparse the hovered parent's small declaration array; benchmark dense real
usage before introducing another cache.

## Verification evidence

- `npx tsc --noEmit` and `git diff --check`: pass.
- `CI=true npm run gates`: all 14 core gates pass, including production
  `build-only`, quality, Obsidian review/lint baseline, CSS ratchets, compliance,
  specification coverage, and the complete suite.
- Vitest: **412 files passed, 6 skipped; 4,505 tests passed, 24 skipped**.
  Final core run: `.gate-logs/2026-10-15T04-12-24-820Z/` (local ignored logs).
- Native **Chronologue References QA** vault: three synthetic scenes, three
  references on a scene in multiple subplots, nine ring occurrences, Fill and
  Sequence, linked selection, nested rows, passage highlighting, explicit
  enrollment, creation, Undo, rejected stale save, and final pinned-list
  collapse. The primary count stayed three and Runtime stayed six minutes.
- The final QA `main.js` matches the verified build SHA-256:
  `7c9041eea40192770483e91e2453e906f9ffd8948a144cbb328e67938680c776`.
  Only the isolated QA vault received plugin files. No author manuscript or
  author-vault installed plugin was changed. No public release was performed.

## Refactors, dead code, naming, and follow-up

No architectural cleanup, dead-code removal, or naming migration was required
by this audit. UI copy and comments use Radial Timeline; persisted technical
identifiers retain their established names. Locale coverage exists for English,
German, Japanese, Korean, and Chinese; translation polish can follow author QA.

Recommended next work is author review of the manual prototype, then native
density/accessibility/alternate-display acceptance before release. Automatic
reference discovery remains a later feature. Track the shared synopsis reload
warning independently. The implemented behavior remains intact after the
verification corrections described above.
