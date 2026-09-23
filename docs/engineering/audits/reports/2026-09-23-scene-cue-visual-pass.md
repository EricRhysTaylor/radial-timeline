# Scene cue typography and hover pass

## Reference lock

Existing Radial Timeline is the implementation target. The user's screenshot and request
set the scope: larger JetBrains Mono time labels, slashed zeros, and oversized braces on
hover over the clickable dotted rail. No new font asset or palette is introduced.

| Decision | Reference | Adaptation |
| --- | --- | --- |
| Monospaced time hierarchy | Linear changelog, https://linear.app/changelog (Refero style 11d3e58a-87d7-4a9a-bbf5-720f4fd3ffc6) | Technical timestamps get their own type treatment; existing bundled JetBrains Mono replaces the reference's Berkeley Mono. |
| Precise, sparse margin controls | Superlative, https://playsuperlative.com (Refero style 4ee42a45-82e7-4a4b-8cc3-86c6b77bbca4) | Flat typography-led presentation; no decorative cards, shadows, or imported brand colors. |
| Gutter affordance | VS Code, https://code.visualstudio.com/docs/editor/debugging | Reveal an action at the line's gutter; user's braces distinguish the interaction from a breakpoint. |
| Zero and size | User request and existing session tracker | Bundled JetBrains Mono Thin at 20px; enable `zero` rather than the session tracker's disabled alternate. |

## Implementation and cleanup

All cue labels align beside the rail. Removed separate confirmed/manual horizontal overrides.
Labels use 28px stack spacing, the existing font at its native weight, and slashed/tabular
numerals. Braces follow pointer Y without affecting cue positions, source data, or totals.
Editor and reading rails share one positioning helper. Decorative pseudo-elements ignore
pointer events so the existing click-to-open behavior receives the event. Motion is limited
to a short opacity fade and disabled for reduced motion. Semantic state colors are retained.

## Verification / read-only audit

All 15 gates passed, including TypeScript, production build and full tests. Existing four
lint warnings remain. `git diff --check` passed. A standalone Chromium fixture using the
actual ruler stylesheet and bundled WOFF2 was rendered and visually inspected on dark and
light backgrounds. Computed styles confirmed the font loaded, 20px size, active zero feature,
and reduced-motion transition duration of 0s. Hover braces and slashed zeros were visible.
New styles use global Obsidian tokens; the fixture resolved the text/rail tokens successfully.

No accounting, persistence, note prose or metadata changes. No architectural refactor or
new settings. No blocking finding in the changed surface. This verifies the stylesheet in
isolation, not a live Obsidian click-through; full in-app/popout visual checks remain a
follow-up after plugin reload. Keyboard operation of the bare dotted rail is an existing
limitation; existing cue buttons and the command palette provide keyboard entry paths.
