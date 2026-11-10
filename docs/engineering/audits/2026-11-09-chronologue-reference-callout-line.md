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
