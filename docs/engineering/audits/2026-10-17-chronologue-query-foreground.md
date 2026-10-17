# Chronologue query foreground and source clearance — 2026-10-17

Read-only post-implementation review of the requested query-icon layering and
reported overlapping square. No additional cleanup is proposed.

## Changes and cause

Chronologue question icons and compact query dots now append to the existing
scene foreground, above fixed subplot headlines. Each records its scene group
in a DOM attribute. Pointer events remain disabled, so the scene underneath
continues to handle hover, clicks and dragging. Other modes retain their
existing scene-group placement. Query refresh removes and recreates the same
marks without accumulating duplicates.

The larger overlapping square was the At the station source marker; the smaller
square was the first Earlier 1952 reference. Both occupied the same inner radius
at nearly identical seam angles. Collision-aware source anchoring now keeps the
normal source placement when clear, or uses the opposite side of the source
scene's Question and a slightly higher radius. This also clears the date-label
baseline. The source remains within its own scene. Its caption and every owned
connector use the same anchor; date positions and scene geometry remain fixed.

Source-square size now comes from the shared ring geometry rather than a
second size calculation in the marker renderer. No settings, persistence,
shortcuts, packages, YAML fields or decorative strokes were added.

## Native verification

Installed only in the existing Chronologue Seam QA working vault. Plugin backup,
screenshots and inspector output are outside the active vault at
`Demo Vaults/Testing Vaults/2026-10-17 Chronologue query foreground/`.

- Sequence and Fill each show all seven query icons in the foreground and above
  the fixed headlines. All seven retain pointer-events none.
- The native unselected square bounds have 63.1 screen pixels of minimum
  clearance between the At the station master and the Earlier date stack at
  the inspected window size. Both the 1952 label and white question icon remain
  readable in the native detail capture.
- Directly selecting the first 1952 square activates the At the station source
  and exactly one connector. The enlarged selected date, master square and
  source caption remain separate in the native selected capture.
- The vault is restored to Sequence. The 30 scenes, seven subplots and existing
  reference declarations remain unchanged.

## Checks and findings

`CI=true npm run build-only` and final `CI=true npm run gates` passed all 14
checks. Focused reference/query coverage passed 36 tests, including a new
30-scene seam collision reproduction. It verifies separation, an anchor inside
its source scene, a consistent origin for multiple dates and unchanged primary
positions. `git diff --check` passed.

No release-blocking, high or medium findings in this scope. Existing report-only
lint notices and the unused CSS ratchet remain outside the correction. No
further architectural cleanup or naming changes are recommended. Native mobile,
light theme and alternate calendars were not exercised in this bounded pass.
