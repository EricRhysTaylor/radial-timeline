# Chronologue reference alignment correction — 2026-10-16

Read-only post-implementation review of the requested correction to the previous
visibility revision. Scope: reference layout, renderer, interactions, CSS,
geometry/render tests and the current design contract. No audit cleanup edits
were performed or proposed. The previous visibility audit records an earlier
implementation; its radial lift, fixed pixel offset and outlined paths are
superseded by this correction.

## Implementation and cleanup summary

- Removed duplicate backing paths, their CSS and the halo-specific coloring branch.
- Replaced hand-built double slashes with the Lucide Activity path, rendered at
  18 SVG units with one 1.5 px line. Active connectors retain one 3 px line.
- Returned terminal bases to the scene bottom: half a square plus four units
  above the inner radius. Only Later receives another six units of lift.
- Replaced radius-dependent pixel spacing with a four-degree angular offset.
  Sequence inheritance and locally calculated Fill occurrences share that angle;
  horizontal clearance grows with radius.
- Earlier overflow counts align their right edge away from the seam. Later
  counts align their left edge away from it; mixed-date counts follow the same
  side convention. Text readability outlines remain.
- Solid squares have no outline. The source hue blends with the existing global
  theme text color, keeping squares and routes visible over matching scene fills.
  The same color derivation applies to Timetable column coloring updates.

No author data, persisted settings, migration, translation, timeline domain or
scene allocation changes. No naming normalization or architectural refactor was
needed. Existing selection ownership, lens filtering, tooltip/button semantics,
three-square limit and overflow choices remain intact.

## Native evidence

Installed and reloaded only in the existing **Chronologue Seam QA** Working vault.
Four primary scenes, including New Scene, remain present. Screenshots, the prior
plugin and inspector output are saved outside the active vault under
`Demo Vaults/Testing Vaults/2026-10-16 Chronologue alignment/`.

- Reviewed both Fill and Sequence. Labels are at scene bottoms, with right-only
  lift; the Activity icon is small and unoutlined. Interior arc depth is retained.
- Both native inspector checks find zero halo elements, zero collisions of marks,
  labels or counts with the visible dominance triangle, and no square stroke.
  Hidden dominance copies are excluded from the collision check.
- Full overflow text bounds, including a 1.5 px readability-outline allowance,
  clear the seam by 28.15, 18.30 and 8.46 screen pixels in the inspector's reduced
  viewport. The innermost count is fully on its own side of the seam.
- Theme color mixing resolves to an actual sRGB value; no unresolved scoped
  design token is introduced. Inspector confirms 3 px active lines and a 1.5 px
  Activity line. Native screenshots confirm solid square visibility.
- The +2 target opens Fire recollection 4 and Fire recollection 5. Choosing the
  fourth selects one Timetable child and highlights three source copies.
  All seven reference declarations remain available.

## Findings, deferred concerns and follow-up

No release-blocking, high or medium finding in the reviewed correction. No
additional cleanup is recommended. Existing report-only gate notices remain:
two lint findings, including one Obsidian settings rule, and 243 producer-less
CSS classes held by the ratchet. They are outside this change.

Native light appearance, mobile/touch and large-manuscript/narrow-ring acceptance
remain unverified. Those surfaces should receive acceptance checks before broader
coverage is claimed. This implementation is ready for the author's visual review;
passing checks do not substitute for that review.

## Verification

- Focused reference tests: 29 passed.
- Final `CI=true npm run gates`: all 14 gates passed, including production
  build-only, TypeScript, script types and 4,612 passing tests (24 skipped).
- Regression coverage checks fixed seam angles across radii, scene-bottom
  positions, right-only lift, inherited overflow anchoring, one seam mark per
  route, and preservation of primary positions and reference declarations.
- `git diff --check`: passed.

Intended feature behavior remains intact. No public release or author-vault
installation is part of this change.
