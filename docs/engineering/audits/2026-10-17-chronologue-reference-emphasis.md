# Chronologue reference emphasis and circular labels — 2026-10-17

Read-only post-implementation review of the requested visual refinement. Scope:
reference rendering, reference selection styling/update, and renderer tests.
No audit cleanup edits are proposed or applied.

## Implementation and cleanup review

The selected date square scales to 135% around its own center. Other reference
squares/counts and unrelated date labels dim to 25% while a selection exists.
The selected date label stays readable when a sibling in its same-date stack is
selected. Clearing selection restores normal opacity. Existing lens filtering
and noninteractive filtered targets remain in place.

A source square up to 16 SVG units replaces the source circle. Ordinary date
squares remain up to 10 units, with a selected maximum of 13.5 units. All square
orientations follow the ring tangent. Scaling is on the inner rectangle, so it
does not replace the enclosing rotation or change the reference date position.
The 20-unit hit rectangle accommodates the rotated selected square.

Source and Earlier/Later labels now use circular SVG text paths. Lower-half
paths reverse to keep text upright and use a raised baseline to preserve inner
edge clearance. Guide IDs use the existing scene-ID helper and source path hash.
Guide paths live inside SVG definitions: an initial native click exposed that a
visible-geometry guide enlarged the marker's accessibility bounds. Moving it into
definitions corrected that issue; clicking Later now selects the intended date.

Same-date stacks retain one shared route. Selection updates only its final line
to the selected marker's declared SVG coordinates. This removes ambiguity when
the second or third square is active. Route ownership and pin lifetime retain
the existing shared selection boundary. No new persistence, author YAML fields,
settings, translations, packages or shortcuts were added.

The previous rotated straight source caption was removed. Existing line and
shape styles remain unoutlined; readability strokes remain on text only. No
additional architectural refactor or naming normalization was needed.

## Native evidence

Installed only into the existing **Chronologue Seam QA** Working vault. Its four
scenes and seven declared references remain intact. Plugin backup, screenshots
and inspector output are outside the vault under
`Demo Vaults/Testing Vaults/2026-10-17 Chronologue emphasis/`.

- Both Fill and Sequence show one source and one active route on All Scenes.
- Selecting Fire recollection 2 reports a scale matrix of 1.35, a 16-unit source
  square and 0.25 computed opacity on all other date squares.
- The selected 1952 date label retains opacity 1 even though the first square in
  that stack is inactive. The shared route ends exactly at the second marker:
  measured endpoint error rounds to 0.0000 SVG units in both alignments.
- All three label guide paths resolve to SVG definitions. Native screenshots
  show source and date labels following their circular baselines, tangentially
  rotated squares and no new outlines on lines or shapes.
- Clicking the background produces no active marker and opacity 1 on all five
  date squares. A final 2040 selection remains pinned while pointing into an
  inner ring. The final review state is Sequence with that future date selected.

## Findings and deferred coverage

No release-blocking, high or medium finding in the reviewed scope. No further
cleanup is recommended. Existing report-only lint notices and 243 unused CSS
classes held by the ratchet remain outside this work.

Native light appearance, touch/mobile, alternate calendars and long-title/dense
manuscript packing remain unverified. Lower-half label direction and baseline
have automated coverage; this vault's active source label is in the upper half.
Visual acceptance remains the author's decision.

## Verification

Focused reference tests: 31 passed. Final `CI=true npm run gates`: all 14 passed,
including build-only, TypeScript, script types and 4,628 passing tests (24 skipped)
in 415 passing and six skipped files. Updated geometry assertions account for
marker orientation; new coverage checks circular paths, upright lower-half text
and the larger source marker. `git diff --check` passed.

Feature behavior remains intact: one relationship projection, stable pinning,
primary-only domain, same-date overflow and passage navigation. No public
release or author-vault installation is included.
