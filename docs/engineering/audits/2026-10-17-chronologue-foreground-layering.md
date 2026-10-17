# Chronologue foreground layering — 2026-10-17

Read-only post-implementation review of the requested draw-order correction.
Scope: ring rendering, SVG assembly, rotation synchronization, title styles and
existing reference-render tests. No additional cleanup edits are proposed.

## Result and cleanup

Chronologue date markers, labels, source markers and connectors now paint after
the fixed subplot headlines. Scene titles paint in the same foreground layer.
Their original text nodes remain inside their scene groups as SVG definitions;
a single SVG use paints each title. This preserves the canonical text, hover
lookups, live text-path changes, scene clipping and style classes. There is no
second title string or independent title geometry to synchronize.

The two repeated title templates were consolidated into one local renderer.
Narrative and other modes retain direct title rendering. The foreground layer
follows the scene layer's rotation; the subplot headlines stay fixed.

Native validation caught two SVG-instance requirements before delivery:
clipping must be applied to the painted use, outside its shadow tree, and title
style selectors must work without external ancestors. The base/title-size rules
now target the existing title classes directly. Alien and Runtime colors inherit
through two SVG-local variables, including publish-stage title colors. No new
settings, dependencies, shortcuts, persistence or scene YAML fields were added.

## Native evidence

Installed only in the existing Chronologue Seam QA working vault, with its
30-scene, seven-subplot fixture intact. Plugin backup, native screenshots and
inspector output are outside the vault in
`Demo Vaults/Testing Vaults/2026-10-17 Chronologue layering/`.

- Directly clicking The photograph's June 4 square selects source 7 with one
  active route. Clicking The council vote's June 4 square selects source 22 with
  one active route. Captures were taken with the pointer off the timetable so
  ordinary scene hover does not wash out the manuscript.
- Both selected dates remain June 4, 2026. The different stack squares and
  source captions identify the two owners of that shared date.
- In both Sequence and Fill, the foreground follows the headline group in SVG
  paint order. All 67 subplot occurrences of scene titles have nonempty bounds;
  inspected geometry contains no NaN or Infinity coordinates.
- Native upper-left detail shows scene titles and reference labels/squares in
  front of the headline. Scene title clipping remains visible in narrow cells.
- Runtime retains its blue title color and 0.8 opacity, confirmed in computed
  styles and a native screenshot. The normal date view is restored afterward.

The final installed build matches the verified build's main.js and styles.css.
The vault is left in Sequence with the council's June 4 date selected.

## Verification and findings

`CI=true npm run gates`: all 14 passed, including production build, TypeScript,
script types and 4,628 passing tests (24 skipped). A final assertion strengthening
the three painted title clips passed all eight reference-render tests. Earlier
focused reference/layout/headline coverage passed all 45 tests. `git diff --check`
passed. Existing report-only lint notices and the 243-class unused CSS ratchet
remain unchanged and outside this correction.

No release-blocking, high or medium findings in the reviewed change. No dead
code or compatibility branches were added. No further naming normalization or
cleanup is recommended. Original scene ownership, shared-date selection,
primary-only date range and once-on-All-Scenes projection remain intact.

Native mobile/touch, alternate calendars and export rendering were not exercised
in this pass. This correction does not claim broader release acceptance.
