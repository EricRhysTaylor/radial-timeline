# Chronologue reference callout line — 2026-11-09

Found while staging time references for the Vol 14 film, in a throwaway copy of the Pride and Prejudice Story
Vault. Darcy's Letter (scene 35) got five references. Hovering "Bingley leaves for London" showed no visible line.
Clicking it opened the scene with the passage flashing, but off screen.

## 1. The line had no guaranteed contrast

Since `0d565549` (2026-10-16) a reference was drawn in the source subplot's color mixed 55% with
`--text-normal`, with no backing stroke. In the dark theme that pushes every line toward light gray.

Measured against WCAG 1.4.11 (3:1 for lines in a graphic), dark theme, the 16 default subplot colors:

| Line | Worst contrast | Fills under 3:1 |
|---|---|---|
| Any source hue mixed with the text color, on scene fills | about 1.0:1 | 9 to 15 of 16, whichever subplot the source is in |
| Main Plot (`#EFBDEB`) line on a Main Plot scene, measured on screen | 1.03:1 | — |
| The same line on the existing dimmed (non-selected) scenes | 1.31:1 | — |
| Other scenes dimmed to 15% toward the background, no casing | 2.88:1 | 1 of 16 (`#273C2C`) |
| **Text-color line on a background-color casing** | **12.2:1 dark, 15.9:1 light** | **none** |

The text-color line alone fails as well: 10 of 16 fills in the dark theme, and the 5 dark fills in the light theme.
Only the casing makes the result independent of the fill.

**Change:** a callout treatment, chosen by Eric from mockups (2026-11-09):
- **The line:** 3.5 px in `--text-normal`.
- **The ends:** hollow circles, 3 px stroke, at both the source and the date.
- **Every stroke:** sits on a `--background-primary` casing 1 px wider on each side.
- **Mockups:** five line designs and four callout variants were compared on the live timeline. They're kept with the
  film project, outside this repo.
- **What goes away:** the subplot-tinted connector and the per-coloring re-tint in `interactions.ts`, along with
  `referenceMarkColor`.
- **Filtering:** a lens or a color-key pick still filters references.
- **The Timeline key:** its sample now draws the same hollow-circle callout.

## 2. Obsidian doesn't scroll to a match past a long Properties block

`openFromWheel` → `openOrRevealFile` opens the scene with an `eState.match`. That's the same state core search
uses. Tested in Obsidian 1.15 with a long note and a match near its end:

| Note | Scrolls to the match? |
|---|---|
| One-line properties | Yes |
| Darcy's Letter's properties (about 40 lines) | No |
| The same, with Properties shown as Source | Yes |
| Darcy's Letter, opened from core search | No |

`Editor.scrollIntoView`, a CodeMirror `scrollIntoView` effect and `setEphemeralState({ line })` don't move it either.
Measuring the match (`coordsAtPos`, or the line's estimated block before it's drawn) and calling `Editor.scrollTo`
does work.

**Change:** `revealHighlight` in `src/utils/fileUtils.ts` runs after a highlighted open, in both the plain and the
Timetable reading-pane paths. It centers the first match in the editing view and stops once the match is drawn
near the middle (at most three passes). Reading view keeps Obsidian's own behavior.

## 3. The marks needed a language, and were painted under the backdrops (2026-11-10)

Eric, on the circles: "we need almost a visual language … One symbol for back in time. one for back so far we are
out of the timeline time range. one for forward in time. one for forward so far we are out of the timeline range."
Also: the marks and lines "must be in front of … the rest of the timeline rings", "move them out … by a few pixels",
and "make the donut hole a little bigger".

- **Layering.** `TimelineRenderer` painted the references in the scene foreground, then appended the Chronologue
  overlays (backdrop ring, micro-backdrops, seam dates) after it, so a backdrop covered the inner edge of each mark.
  References now have their own `referenceElements` in the ring context and their own layer
  (`ert-time-reference-layer`), painted after those overlays and before the synopses.
- **Symbols.** Arrowheads or chevrons were mocked on the live timeline; Eric chose arrowheads.
  - A hollow arrowhead points along the ring the way the date lies from its scene: counter-clockwise for back in
    time, clockwise for forward (`referenceDirection` in `render.ts`).
  - A date past the timeline's start or end takes a double arrowhead.
  - A marker whose references point both ways, or a span around the scene's own time, takes a diamond: the two
    arrowheads joined. Eric's four symbols can't describe those, so this is the fifth.
  - Each mark is grouped (`ert-time-reference-mark`, with `data-direction`), so the selected mark scales as one.
- **Position and size.** The marks are sized from the ring's reference size: two sizes across the ring, one and a
  half along it. Their centers move from four units plus half a size above the inner edge to a size and a half, so
  each mark and its casing sit wholly on the scene.
  - Stacked marks are spaced to match.
  - The source circle is one size in radius, so its core stays open.
  - When the source has to step out past a date mark, it now steps past the mark's span.
  - Mark strokes are 2.5 px on a 1 px casing each side. The line stays 3.5 px.
- **The Timeline key** shows the route and the four kinds of mark (back or forward, before or after the timeline,
  both ways), drawn in the same proportions.

## 4. The line jogged, and the tooltip was unreadable (2026-11-10)

Eric: "the connecting ring line should not move up then down but align with the icon radius. Why does it say
choose a reference? The tooltip is not readable … Possibly we change it to a nicely formatted popover."

- **The line.** `referenceConnector` ran its arc on a track 68% of the way out the ring, with radial legs down
  to the source circle and the date mark, so every route climbed, crossed, and came back down. The arc now runs at
  the date mark's own radius (`terminalRadius`), so the line passes through the marks. The source and range labels
  moved to one mark size outside the lane, so the line no longer runs through them.
- **"Choose a reference."** A group's mark carried an SVG `data-rt-tip` reading "3 dates — choose a reference",
  and a click opened an Obsidian `Menu` of one-line items. Both are gone, along with the `dateGroups` and
  `cluster` strings in every locale.
- **The popover** (`src/chronologue/timeReferences/popover.ts`, `ReferencePopover`):
  - **Where it opens:** on hover or focus, level with the mark and just outside the timeline on the mark's side,
    kept inside the window.
  - **Heading:** the side and the date or the number of dates, such as "Earlier · 3 dates" or "Nov 27, 1811".
  - **Each reference:** its label, its kind and readable date (Recollection · Jul – Aug 1811), its source scene,
    and its passage in italics, two lines at most.
  - **Notes** for an overlap with the displayed period, or for the Earth calendar while a planet calendar is on.
  - **Click on a group:** opens the same popover with each reference as a button, focused on the first. It closes
    on a choice, Escape, a click outside, a scroll or a redraw. A single reference still opens directly.
  - Styled with Obsidian's popover tokens (`--layer-popover`, `--shadow-l`, theme background and border).

## 5. Many scenes with references: a scene-wide hover instead of colors (2026-11-10)

Eric asked what happens with seven or eight scenes carrying references, and whether they'd be color coded. They
aren't: section 1 showed subplot-tinted lines fall to about 1:1 contrast over pale fills, and eight more hues would
compete with the subplot palette the scenes already wear. At rest, nothing tied a date mark to its scene. Only the
hovered mark's line said where it came from.

**Change:** the source circle is a button.
- **Selection:** `ReferenceSelection.key` may be `null`, meaning every reference the scene declares.
  `selectsReference` is the single rule the timeline and the Timetable use to decide what a selection covers.
  `reconcileReferenceSelection` drops a whole-scene selection only when the scene has no references left.
- **Markup:** `render.ts` draws one circle per scene after all the slots, carrying every reference key the scene
  declares in declared order. Before, it carried only the first slot's keys. The circle has a hit circle, `role="button"` and
  `tabindex="0"`.
- **Hover or focus on the circle:** all of the scene's routes draw, each of its marks grows, and the source label
  shows. Other marks, their counts and other source circles dim to 25%. The scene's Timetable reference rows
  highlight. `sourcePopoverContent` heads the popover with the scene and lists its references without repeating it.
- **Dimming:** a single-reference hover now also dims the other date marks to 25%, as this plan already described.
  Before, only their labels dimmed.
- **Click:** the same choosing popover as a group. A scene with one reference opens it directly.

## Verification

- `vitest` on `src/chronologue/timeReferences`. The render tests now cover:
  - circle ends with casings;
  - casings that share their line's keys and route and are painted first;
  - no inline stroke or subplot color.
- `npm run build-only` passed. The full `vitest` run: 5,995 passed, 40 skipped. `npm run lint` passed.
- `subplotColors.test.ts`'s source guard no longer lists `interactions.ts` among the palette-slot readers.
- **Native check** (Obsidian 1.15, a throwaway copy of the Pride and Prejudice film vault, Darcy's Letter with five
  references):
  - At rest, every source and date circle is visible on pale and dark scenes.
  - On hover, the cased line runs from the letter to November 27, and the other source dims to 25%.
  - In the light theme, the line is dark on a white casing.
  - The click opens the letter with the passage highlighted in the middle of the editor.
- **Not checked natively:** the Timetable reading-pane path, which calls the same `revealHighlight` after
  `openInReadingPane`.
- **2026-11-10, arrowheads and layering:**
  - New render tests cover direction (back, forward, both), double marks for Earlier and Later, the tip leading
    counter-clockwise for back, casings matching each shape, references kept out of the scene foreground, and the
    layer's place after the Chronologue overlays.
  - The full `vitest` run: 6,004 passed, 40 skipped. `npm run build-only` and `npm run lint` passed.
  - Natively in the same copy: the Earlier group reads ◁◁ at the seam, Bingley's and Jane's dates read ◁, and every
    mark sits clear of the backdrop band. The hovered line and its enlarged mark paint over the backdrops. The
    Timeline key shows the four rows.
- **2026-11-10, line radius and popover:**
  - Layout and render tests now expect the arc at the mark radius (`A 709 709`, `A 414.4 414.4`, `A 420.4 420.4`).
    New `popover.test.ts` covers readable dates and spans, headings without "choose", the notes, and placement
    outside the timeline with window clamping.
  - The full `vitest` run: 6,021 passed, 40 skipped. `npm run build-only`, `npm run lint` and `lint:obsidian`
    passed.
  - Natively in the same copy:
    - Hovering Bingley draws one arc from the letter through Jane's mark to Bingley's, with no climb.
    - The popover sits right of the timeline: "Nov 27, 1811", then the label, "Recollection · Nov 27, 1811",
      "35 · Darcy's Letter" and the passage.
    - Clicking Earlier opens "Earlier · 3 dates" left of the timeline with four reference buttons; Escape closes it.
- **2026-11-10, scene-wide hover:**
  - New tests cover `selectsReference`, keeping and dropping a whole-scene selection, the source popover's heading
    and rows, and one source circle per scene holding all three keys of references split across two slots, in
    declared order.
  - The full `vitest` run: 6,025 passed, 40 skipped. `npm run build-only`, `npm run lint` and `lint:obsidian`
    passed.
  - Natively in the same copy:
    - Hovering Darcy's Letter's circle draws both of its routes (across the seam to Earlier, and on to Jane's and
      Bingley's dates). The popover reads "35 · Darcy's Letter · 5 references" with all five, and Last Days at
      Hunsford's circle dims to 25%.
    - Hovering Bingley's mark lights one line; the Earlier and Jane marks and the Hunsford circle sit at 25%.
    - Clicking the circle opens the five references as buttons, with focus on the first; Escape closes it.
    - Focusing Hunsford's circle from the keyboard shows its one route and popover; blur hides both.
  - **Not checked natively:** the Timetable rows lighting on a scene-wide hover (the shared rule is unit-tested).
