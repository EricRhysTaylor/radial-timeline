# Chronologue reference ownership and selection — 2026-10-16

Read-only post-feature audit of the requested clarity correction. The author
explicitly selected one relationship on All Scenes rather than subplot copies.
Scope: reference layout/rendering/interactions/selection and their tests, reference
CSS, RingRenderer's reference integration, and Timetable reference-hover handlers.
No audit cleanup edits were performed or proposed.

## Implementation and cleanup summary

References now render only in the existing All Scenes pass. Removed inner-ring
reference layout, slot filtering and duplicate rendering; subplot scene positions
still use the established Fill/Sequence paths. No fake scene or target-scene
relationship is created for a reference date.

A solid circle marks the owning scene near the middle of its inner edge. The
radial feed is offset beside its center Question icon. The selected source's
number and title appear beside the circle; targets remain solid squares. Source
and target use the accepted subdued color treatment, with outlines only on text.
Reference details name the source scene for each declaration, including clusters
that contain declarations from different sources. Titles retain SVG escaping.

Removed ordinary scene-hover route activation, sibling-route display and the
occurrence-ring selection fallback. A direct reference hover/focus previews one
route. A click pins it; further hovering does not replace or republish that pin.
Clicking another reference replaces it, and a timeline background click clears
it. Removed the redundant direct Timetable row-marking call: shared selection
already updates the linked row. Parent-row scene hovering retains its normal
scene behavior and does not activate references.

No new persistence, settings, YAML fields, shortcuts, translations or packages.
Existing primary-only domain, scene numbering, three-square stacks, overflow,
precision labels, exact passage navigation and author editing remain intact.
The ephemeral selection no longer needs an occurrence ring field. No additional
naming normalization was necessary.

## Native verification

Installed and reloaded only in **Chronologue Seam QA**. The vault's four scenes,
including New Scene, were preserved. All seven reference declarations remain.
Before/after screenshots, a prior-plugin backup and inspector output are outside
the active vault in `Demo Vaults/Testing Vaults/2026-10-16 Chronologue clarity/`.

- Fill and Sequence both produce six reference controls, one source origin and
  reference ring set `[2]`: no subplot reference copies.
- Selecting the 2040 reference produces exactly one active route, one named
  source (`3 · At the station`) and one selected Timetable child.
- A native pointer movement/scroll over an inner ring leaves that connection
  pinned. Source-scene copies remain in the subplot rings, without the old
  reference-specific scene-border highlight.
- Clicking the timeline background produces zero active routes and no active
  origin caption. Selecting another reference restores its route.
- Final screenshots show the source feed beside the Question icon and a readable
  source caption separated from the seam labels. The source label's global theme
  token resolves to `rgb(218, 218, 218)` in the tested dark appearance.
- The final native review state is Sequence with the 2040 relationship selected.

## Findings and deferred coverage

No release-blocking, high or medium finding in the reviewed correction. No further
cleanup is recommended. The existing report-only lint notices and 243 unused CSS
classes under the ratchet remain outside scope.

Native light appearance, mobile/touch, alternate calendars, and large-manuscript
label packing remain unverified. Those are follow-up acceptance surfaces, not
claims supported by this QA vault. Author visual acceptance remains distinct from
passing automated checks.

## Verification

Final `CI=true npm run gates`: all 14 passed, including production build-only,
TypeScript, script types, and 4,619 passing tests (24 skipped), across 415 passing
and six skipped files. Focused reference coverage: 30 tests.

The new full-renderer regression exercises both Fill and Sequence: a scene with
two subplot memberships still has three scene occurrences but just one reference
set on All Scenes. Geometry checks anchor the source feed inside its own scene;
selection tests cover pin precedence, replacement, clearing and one-time reveal.
An incorrect 709-unit expectation in the new geometry assertion was corrected to
the actual 708.8-unit source radius; the complete gate run then passed.

`git diff --check` passed. Intended feature behavior remains intact with the
explicitly approved occurrence and interaction changes. No public release or
installation into an author vault is included.
