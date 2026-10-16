# Chronologue reference seam audit — 2026-10-15

Scope: the revision from narrow allocated reference slices to square overlays,
interior concentric tracks, and categorical off-range terminals. This is the
required read-only post-feature audit of the completed implementation. No audit
cleanup edits were applied, and no additional feature work is proposed.

## Cleanup summary and architecture

Primary scene allocation now has one owner: the existing scene layout. The
reference layout returns those positions unchanged. Reference dates cannot
expand the primary domain or displace scene boundaries, number squares or
perimeter ticks. The domain excludes beats and derives only from valid primary
When dates and their declared precision. Fill uses the manuscript domain with
local dated corners; Sequence uses outer-ring reference placement.

Reviewed the changed reference layout, renderer, interactions, CSS, tests and
nine locale blocks, plus their scene-layout, number-square, Chronologue label,
outer-sequence and ring-rendering integration. Author declarations, editor
writes, passage validation, selection lifetime and Timetable ownership remain
on the existing shared boundaries. No new persistent state, settings, scene
records, author YAML properties or external services were introduced.

## Findings, prioritized

- **Release-blocking/high:** none found within this revision's scope.
- **Medium, deferred acceptance coverage:** native mobile/touch, alternate
  calendars, light appearance and large-manuscript performance have not been
  established by this test. The 500-declaration automated case establishes
  bounded clustering and lossless declarations, not native performance.
- **Low, existing repository notices:** the passing gate reports five lint
  problems in its report-only inventory (one Obsidian settings rule) and 243
  producer-less CSS classes held by the existing ratchet. This revision does
  not raise those inventories.

Off-range terminals intentionally convey Earlier/Later and declared dates,
not the magnitude of omitted time. Multiple distinct dates at one seam terminal
use an explicit date-count cluster and a selectable list. This is the agreed
bounded presentation, not lost data. Year/month bounds preserve uncertainty;
a period overlapping the manuscript has an overlap explanation rather than an
invented precise date. An undated ring uses the source corner with an explicit
No dated scenes in this ring explanation when it cannot place an in-range date.

## Refactors and dead code removed during implementation

- Removed angular-space reservation and scene rescaling by reference count.
- Removed the old border-radius connector helper.
- Removed reference-driven number-square layout caches.
- Restored primary perimeter labels to the ordinary scene positions.
- Renamed the renderer to `renderTimeReferenceMarkers` to match square glyphs.
- Consolidated coincident source/date paths; only the selected occurrence's
  family becomes visible, while other source copies remain highlighted.

These changes preceded the audit. No speculative abstraction, migration,
compatibility path or global keyboard command was added.

## Native evidence

Test vault: **Chronologue Seam QA**, under
`Demo Vaults/Testing Vaults/2026-10-15 Chronologue reference seam/Working/`.
It is synthetic and disposable; its preserved Baseline is a sibling outside
that active vault. The build was installed only in this Working copy.

- Three primary scenes span June 1–7, 2026. Five recollections of 1952, one
  June 4 reference and a possible future in 2040 do not change that range.
  The central scene count stays three and Runtime remains 6:00.
- Fill and Sequence display inherited reference occurrences in All Scenes,
  History and Family. The existing question icon remains at the scene center.
- Each same-date group shows three squares and `+2`; its menu offers references
  four and five. All seven declarations remain in the source's Timetable list.
- Earlier and Later terminals lie on opposite sides of the 12 o'clock seam.
  Their interior routes have real gaps and double-slash discontinuity marks.
  The central status grid is clear.
- Native activation of a range label pins the reference, expands its source
  list, selects one child row and opens the highlighted exact passage. The
  label and square are both valid targets. A click-target issue found during
  implementation was corrected before this audit.
- Final installed-build inspector: 15 square markers and six seam marks across
  the three rings. Activating the Family occurrence yields active ring stamps
  `["0", "0"]` (route plus seam mark), three highlighted source copies and one
  selected child row. The outer occurrence previously yielded `["2", "2"]`.
- Inspector confirms square fill/stroke and range-label fill/backing resolve
  to actual RGB colors. SVG buttons use title/data attributes, not aria-label.
  Labels inherit filtering/spotlight from their owning reference group;
  filtered descendants cannot override disabled hit targets, and filtered
  connectors remain hidden.

No author manuscript or author-vault plugin was modified. Existing reference
save/reopen, stale-write and Undo behavior was not redesigned; its previous
acceptance is recorded in the 2026-10-14 audit. This revision's native evidence
covers geometry and linked navigation, not a repetition of every editor case.

## Verification and follow-up

- Pre-change baseline: TypeScript passed; 4,549 tests passed, 24 skipped.
- Final `CI=true npm run build-only`: passed, including TypeScript and script
  type checks; output went to `build/`, without auto-backup or author deploys.
- Final `CI=true npm run gates`: all 14 gates passed. Unit tests: 4,557 passed,
  24 skipped, across 413 passing and six skipped files.
- Regression cases include unchanged primary positions with/without references,
  primary-only bounds, both seam directions and true gaps, in-range routing,
  overlapping year precision, manuscript versus Fill domains, undated rings,
  500 declarations, inherited ring occurrences, escaping, three-square overflow
  and explicit clusters of different off-range dates.
- `git diff --check`: passed.

Behavior is intact within the stated scope. Recommended next acceptance work is
mobile/light/alternate-calendar and native density coverage before making broad
claims about those surfaces. Automatic extraction and a standalone linear
reference timeline remain separate product work. There is no audit cleanup
requiring approval in this pass. No public release was performed.
