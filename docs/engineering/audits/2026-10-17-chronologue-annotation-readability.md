# Chronologue annotation readability — 2026-10-17

Read-only post-implementation review of the requested text-band and opacity
correction. No further cleanup edits are proposed.

## Changes

Date squares now explicitly use opacity 1, including during reference selection.
Selection still enlarges its square and displays only its own source connector.
Other date labels and unrelated master markers retain their existing emphasis.
Overflow counts remain readable at full opacity.

Reference-label baselines are capped at the inner 40 percent of the scene ring,
including reversed lower-half source captions. Overflow counts use the first
date's baseline rather than climbing into a fourth stack row beside scene titles.
Counts and date labels follow circular arcs: Earlier reads as date plus count,
and Later reads as date plus count. Their spacing is measured from the actual
rendered font, without estimating the label width.

The view attaches its SVG fragment after interaction setup, so measurement runs
once on the next frame. That frame is cancelled with the render scope. A shared
selection updater refreshes any already-selected overflow connector after its
count moves. Hit areas and connector endpoints follow the rendered count.

Overflow tooltips reuse the existing localized reference-cluster wording. No
translation keys, settings, persistence, dependencies or note metadata were added.
Two obsolete dimming selectors and the old straight overflow alignment variables
were removed. Existing square/line styling remains unoutlined.

## Native evidence

Installed only in the existing Chronologue Seam QA working vault. Native captures,
inspector output and the previous plugin build are outside the active vault under
`Demo Vaults/Testing Vaults/2026-10-17 Chronologue annotation readability/`.

- In both Fill and Sequence, all nine visible date squares have opacity 1.
- With a 1952 date selected, effective opacity through every ancestor remains 1
  for all date squares; one marker and one source connector are active.
- The +6 menu contains six additional 1952 references, beyond three shown squares
  (nine total). The +2 menu contains two additional 2040 references, beyond three
  shown squares (five total). Both menus opened from the relocated visible text.
- Choosing The council proposal for 2040 from +2 selects The council vote, with
  one connector ending at the relocated count. Measured endpoint error is below
  0.1 SVG viewport unit at the inspected window size.
- Native detail captures show the counts and source/date captions below the
  scene-title band, with the question icons still in front of subplot headlines.
  The vault is restored to Sequence with the 1952 reference selected.

## Verification and findings

Final `CI=true npm run gates`: all 14 passed, including production build,
TypeScript and the full test suite. Focused reference coverage passed 32 tests.
The overflow regression now checks its inner date baseline and bounded curved
text radius at several ring sizes. `git diff --check` passed.

No release-blocking, high or medium findings in this scope. No further extraction,
state changes or cleanup are recommended. Scene geometry, primary date domain,
reference ownership and declarations remain intact. Existing report-only lint
notices and the unused CSS ratchet remain outside this work. Native light theme,
mobile and alternate calendars were not exercised in this pass.
