# Story card image settings: one setting for Panels and Canvas — 2026-11-10

Eric asked for an audit of every place that sets card portraits and place images, then "Do all the fixes".

## What overlapped

| Setting | Panels kept it in | Canvas kept it in |
|---|---|---|
| Image combination | the Timetable `.base` view (`panelImage`), 6 choices | memory only, 2 choices, reset when the Canvas reopened |
| Text backing over a place | `.base` (`placeTextBacking`) | none |
| Fill or Fit | `.base` (`panelFit`) | none |
| Portrait shape | `.base` (`portraitShape`) | memory only |
| Image focus | `.base` (`panelFocus`), by image path | not used |

Already shared, and unchanged:
- `storyImageStrategy`, the character selection;
- `storyImageChoices`, each card's character, card image and place background;
- `panelPlaceImage`, the place lookup.

## What changed

- **One rule:** `src/timetable/storyCardImages.ts` holds the card image settings (`settings.storyCardImages`), the focus
  points (`settings.storyImageFocus`, by image path, rebased on rename), and the shared menu groups. It also holds the
  rule for which images a card shows (`cardImages`).
  - Panels and Canvas both read it.
  - Each view redraws on `rt-story-images-changed`.
  - Panel size stays with each Timetable view, since it's layout.
- **Adoption:** a Timetable that still carries `panelImage`, `placeTextBacking`, `panelFit`, `portraitShape` or
  `panelFocus` hands them over once, on its first data update (`adoptViewImageSettings`), and they're cleared from the
  view.
  - The first view sets the card settings.
  - Every view's focus points join the shared map, without replacing a saved one.
- **Canvas** offers all six combinations, the Background treatment (it sets the strength of the veil), Fill or Fit, and
  the shared focus points.
- **The menus** label every group: Image combinations, Background treatment, Character selection, Image sizing and
  Portrait shape. Panels adds Panel size. The single "Formatting" heading and its string are gone.
- **Place + character** shows the place and the character side by side, each a full-size tile.
  - The 48 px character inset under the action buttons is used only in Small panels, where the cover fills the card.
  - With two tiles, a title that would get under 180 px starts its own line beneath them.
  - The scene artwork inset is gone from this combination; Scene artwork is its own choice.
- **None** no longer indents the title: with no cover, the drag grip joins the scene's buttons at the top right.
- `combinedPanelImage` is removed; `cardImages` covers its rule.

## Verification

- `storyCardImages.test.ts` covers:
  - each combination for scenes and sketches;
  - None;
  - defaults and unknown values;
  - adoption from a view, including a second view;
  - focus rebasing;
  - the menu's groups.
- The full `vitest` run: 6,013 passed, 40 skipped. `npm run build-only` and `npm run lint` passed.
- **Native check** in a throwaway copy of the Pride and Prejudice film vault:
  - The Timetable's `panelImage: layered` was adopted and cleared from its `.base`.
  - Place + character shows two equal tiles with the title beneath, in four columns.
  - None starts the title at the card's edge.
  - A Canvas with three scene cards shows the full menu and the place-and-character tiles.
