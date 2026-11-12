## Radial Timeline 8.0.2

Story map updates, settings search, and fixes.

### New

- **Find Radial Timeline settings from Obsidian's settings search.** Search for a section such as Scene properties, Story beats, PDF fonts or an API key, and the result opens Radial Timeline's settings at that section.
- **Review updates to a story map.** When a subplot map you generated no longer matches the manuscript, its navigation bar shows **Map out of date — review updates**. The review lists new and removed scenes, changed acts and subplots, a changed scene order, and your own edits to the Canvas. **Create updated copy** rebuilds the scene layout in a new Canvas and places your added or edited cards to its right. The original map stays as it is.
- **Bring your cards from an older map.** A map created before this release has no record of its original settings, so the review offers a clean map instead. Select your own cards on the old Canvas first, and they are placed beside the new map.
- **Switch a story map between horizontal and vertical lanes** from its navigation bar, and back.

### Fixes

- **Beat Manager:** **Repair** works for library systems such as Hero's Journey, as well as custom ones. A new blank system can be named before it is saved, and its beat notes use that name.
- **Story maps:** a new map is kept and opened even if its details can't be saved, so trying again no longer makes a duplicate. Deleting a story map's Canvas also removes its stored copy from the plugin's settings.
- **Canvas conversion:** if converting cards stops partway, the notes already created stay linked to their cards, and the notice lists them. A conversion that finished is no longer reported as stopped when the timeline can't open afterward.
- **Sketches:** if a new sketch's position can't be saved, the sketch is kept and the notice says where it is. A failed placement puts the sketches back in their acts.
- **Hover:** hovering the timeline dims the other beat titles so the hovered one stands out. Hovering a Timetable row or Canvas card does the same, and mutes the character ring as a timeline hover does.
- **Story map navigation bar:** the drag bar is wider and keeps its size while you drag.
- **Timetable:** in a narrow pane, the Canvas menu opens under the compact menu instead of the window's corner.
- **Time references:** Escape closes the chooser and returns focus to its marker without reopening it, including in pop-out windows.
- **Image menu:** when a card's chosen place picture has been deleted or renamed, the menu says the picture is missing.
- **Export presets:** applying a preset to a single-file or folder export no longer marks the preset as changed.
