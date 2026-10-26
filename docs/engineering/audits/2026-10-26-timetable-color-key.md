# Timetable category key and date grouping — feature audit

Scope: complete list-member discovery, an explicit eight-category palette, date grouping, and the timeline key. No manuscript properties, commands, shortcuts, network calls, or public release were added.

## Design reference lock

Existing Radial Timeline controls and Obsidian theme tokens are the primary design-system target. Refero research supplied these bounded references:

| Decision | Reference | Applied rule |
| --- | --- | --- |
| Neutral panel, compact capsule controls | [Linear changelog](https://linear.app/changelog), Refero style `11d3e58a-87d7-4a9a-bbf5-720f4fd3ffc6` | Thin neutral borders and pill interaction shapes; no copied fonts, hardcoded colors, or atmospheric effects |
| Dense, searchable category choices | [Rows](https://rows.com), Refero style `984071b0-dd6d-4d43-a7b7-e71af93052df` | Compact labels and clear category boundaries; no decorative gradient |
| Draft date range with Apply/Cancel | [Chargetrip date filters](https://refero.design/pages/43bb6709-4273-4ad8-860b-52f3d40e6699), plus `ea3058f8-27fb-47d4-909b-ec14a634778b` | Separate start/end fields, presets, explicit Apply and reversible Cancel |
| Category tint and checkmark on selection | Approved user brief | Reserve palette colors for the category dot, border, and selected tint; keep text theme-native |

Media: code-native controls and Lucide icons. Reject new typography, blurred overlays, glow, and a new palette independent of the timeline.

## Implementation surface and cleanup

- `timetableModel.ts`: count every distinct list member once per scene, expose all categories, paint at most eight chosen values, match all/any, and normalize versioned saved choices. Old unversioned picks remain readable and discoverable after complete list discovery.
- `coloringDates.ts`: pure calendar grouping and range validation; stable category identifiers with localized display labels. Due separates completion dates from unfinished overdue work.
- `TimetableColoringModal.ts`: view-owned draft editor; search and at-most-eight selection, date controls only for date-compatible columns, Apply/Cancel, and visible actions with a scrolling body.
- `TimetableView.ts`: gather cached scene values and completion state; the shared planner serves both the saved view and editor. The `.base` view remains the only persisted owner.
- `timetableRegistry.ts`: publish key labels/counts and actions. Refresh callbacks even when the painted scene set is unchanged; avoid redrawing unchanged overlays.
- `TimeLineView.ts` and `timetable.css`: rounded category chips, category tints/checkmarks, counts, Edit key/Clear selection, focus restoration and narrow-pane wrapping. Existing wheel/table hover color resolution is unchanged.
- Nine locale catalogs, model/date tests, and `wiki/Timetable.md`.

Dead code removed: obsolete `tooMany` plan state and its translated refusal message. Naming/comments now distinguish an eight-color palette from the complete category set and describe all/any matching correctly. No broad architectural refactor or speculative service layer was introduced.

## Verification

Before implementation: TypeScript passed; 4,927 tests passed, 35 skipped.

Final source: `npm run build-only` passed (including TypeScript, scripts typecheck, quality checks and CSS duplicate checks). Full Vitest: 4,939 passed, 35 skipped. Changed runtime files passed ESLint. `npm run release:i18n` passed all nine catalogs at 100% (6,503 keys), protected-token checks and bundled locale checks. `git diff --check` passed. No public release was invoked.

Native acceptance used an isolated Timetable Color Key QA copy in `Demo Vaults/Testing Vaults/2026-10-26 Timetable color key/Working/`, with invented scenes:

- Fourteen character categories found, including supporting names never listed first. Replaced a default category with Supporting 12 through search while preserving the eight-category limit.
- Shared + Supporting 12 narrowed twelve test scenes to their one-scene intersection. April + June selected eight scenes by union.
- Category choices and an active date selection survived app reloads.
- An inclusive April custom range selected four scenes. Reversed/incomplete intervals blocked Apply; Cancel preserved the earlier month selection.
- Due presets distinguish completed scenes, unfinished overdue/today/upcoming work, and missing dates. The final native fixture showed Overdue 1, Today 1, Next 7 days 1, Completed 9, and Not set 4; Clear selection restored all 16 scenes. The key also retained its counts in Progress and Narrative mode. Unit tests additionally cover invalid dates, leap days, timestamps at boundaries, and DST.
- Real computed styles resolved the key's 8px/12px padding, 8px gap, palette variable and selected fill; modal padding/gap resolved to 16px/12px. Apply remained inside the viewport.
- At a forced 140px key width, the final CSS had no horizontal overflow and retained a one-line property label. Light-theme selected text/fill and checkmark were inspected; the dark theme was restored.

## Audit findings and disposition

Release-blocking/high/medium findings: none remaining in this feature's changed surface.

During implementation verification, fixed hidden modal actions, narrow-header overflow, any-match tooltip wording, rollover-date validation, and completed Due dates being classified as overdue. The subsequent audit is read-only; no additional cleanup edits are proposed.

Ownership, type safety, deterministic grouping, callback freshness, token scope, focus behavior, and compatibility were reviewed. No scene YAML writes are required by the feature. Work is local; no new background timers or vault scans were introduced.

## Deferred concerns and follow-up

- Word/runtime bands and multiple separately named custom intervals remain outside this change; the custom date option defines one inclusive interval plus before/after groups.
- Relative Due groups recompute when the Timetable renders, consistent with its existing Due readouts; no midnight polling was added.
- Non-English strings have automated coverage/token/runtime validation, but have not had fluent-speaker editorial review.
- Review the appearance in the author's preferred workspace as normal product acceptance. Native synthetic fixtures establish behavior, not manuscript/canon judgments.

Intended coloring, list intersection, date union, palette persistence, and linked hover behavior remain intact. Build/test safety is verified; this document does not claim a public release.
