# Chronologue reference visibility audit — 2026-10-16

Read-only post-implementation review of the approved visual refinement. Scope:
reference layout/rendering/interactions, feature CSS and geometry/render tests.
No audit cleanup edits are proposed or applied. The author data model, scene
allocation and primary-only domain remain unchanged.

## Cleanup and implementation review

The old 12-unit capped track inset looked like a scene border in the supplied
screenshots. Marker bases at inner radius plus nine units also placed labels
beside the dominance triangles and central core. Shared `referenceRingGeometry`
now owns the track, marker, stack and endpoint measurements, removing duplicated
track calculations and scattered size/pitch/base calculations.

The approved result uses a track 32% inside the outer border, marker bases 36%
into the ring from its inner edge, up to 10-unit squares, and endpoints offset
64 units from the seam at the base radius. Three same-date squares remain the
maximum; narrow rings use fewer squares and explicit overflow/clustering.
The 32-unit seam gap contains two 18-by-16-unit overall slash strokes.
Active lines are 3 px and seam marks 4 px, with theme-aware contrasting strokes
behind both. Labels are 13 units with a larger square-to-label gap.

The backing paths reuse their foreground path geometry and selection/ring keys;
they own no separate state or listeners. Overlay coloring deliberately leaves
the backing stroke theme-neutral. All paths remain noninteractive. Date labels
and enlarged square hit targets retain ordinary button activation. No settings,
persistence, author YAML fields, translations or global shortcuts were added.

## Visual reference lock

Primary: the user's two screenshots and existing Radial Timeline SVG interface.
Preserve scene colors, question icons, chronology, square notation and concentric
routing. Correct the specific border ambiguity, weak marks and corner collision.
Secondary Refero references: Uniswap Cup's crisp connector/marker separation and
Timescale's technical diagram spacing. Borrow only functional contrast and clear
spacing, not palette, typeface, brand or decorative treatments. No raster assets,
new product flow or broader restyling were introduced.

## Findings and deferred coverage

No release-blocking, high or medium defect found in the reviewed refinement.
The passing repository gates retain two report-only lint notices (one Obsidian
settings rule) and 243 producer-less CSS classes under the existing ratchet.
Those are not cleanup work for this scope.

Native light appearance, mobile/touch and large-manuscript performance remain
unverified. Narrow-ring packing and inherited occurrences have automated
coverage; native evidence below covers the actual QA ring dimensions only.

## Native evidence

Installed only in the existing **Chronologue Seam QA** Working vault. All four
current scenes, including the user's added New Scene, were preserved. The
previous plugin and before/after screenshots are outside the active vault under
`Demo Vaults/Testing Vaults/2026-10-16 Chronologue visibility/`.

- Sequence and Fill show clearly interior arcs, visible double slashes, larger
  squares and labels raised away from the core. Question icons remain clear.
- Native DOM bounding-rectangle comparisons found **zero intersections** between
  all reference squares/labels and all subplot dominance triangles in Fill.
- Inspector confirms 3 px active foreground, 4 px seam foreground, 6/7 px backing
  strokes, 10-unit squares and 13 px computed label text. Theme colors resolve
  to actual RGB values; the background stroke resolves independently of the
  source-colored foreground.
- Both routes still cross the seam. Activating the 2040 label selects one child
  row, highlights three source copies and shows the outer occurrence's routes.
- The same-date `+2` target opens both remaining references. Selecting the fourth
  reference opens its exact passage. All seven child declarations remain present.
- Central scene count stays four and Runtime 6:00. Primary June 1–7 range remains.

## Verification and handoff

Baseline: TypeScript and 4,578 tests passed, 24 skipped.
Final `CI=true npm run build-only`: passed, including TypeScript and script types.
Final `CI=true npm run gates`: all 14 passed; **4,580 tests passed**, 24 skipped,
across 414 passing and six skipped files. Focused reference suite: 27 passed.
`git diff --check`: passed.

New regression assertions measure track clearance, terminal clearance above the
inner edge and beside the dominance zone, enlarged seam dimensions and actual
rendered square bounds. Existing chronology, clustering, inheritance and
selection lifetime checks still pass. No old renderer/helper or compatibility
path was retained for this treatment. No audit-driven naming changes were needed.

Approved behavior remains intact. Recommended follow-up is acceptance on the
unverified surfaces before claiming those are covered. No cleanup approval is
needed for this report. This is not a public release or author-vault deployment.
