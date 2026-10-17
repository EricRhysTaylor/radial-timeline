## Radial Timeline 7.5.2

A bug-fix release, plus time references in Chronologue, a name of your own for the main plot, and a way to take a scene off the timeline without deleting it.

### Fixes

- **Settings edit the book you see.** Switching books with Settings open left **Progress and status** showing the previous book while its date edits landed on the new one. The panel now follows the active book.
- **Your own vault isn't mistaken for a demo.** The Welcome screen could treat an author's vault as a packaged demo vault and offer to register its books and Inquiry sources.
- **Importing an existing book adds it.** Pointing the import at a folder that's already a Radial Timeline book now opens **Add book**, or **Show on timeline**, instead of copying it into a new folder.
- **Book cards without a folder can't be made active.** Activating one showed an empty timeline and the Welcome screen.
- **The Timetable stays in view.** **Add scene** from its scene menu opens the new note in the reading pane, and **Shift-click** with no timeline open places the timeline beside the table instead of over it.
- **Drag arcs follow the book's order.** Dragging a scene to an earlier position no longer draws its arc past the closing scene and across the opening seam.
- **Completion progress stays visible** without recent writing-pace data, and settings fit narrow floating windows.

### Also new

- **Time references in Chronologue.** A scene keeps its own `When` and can now point to other periods in its prose: a memory, a mention, an enacted flashback, or a possible future. Right-click a scene note and choose **Time references…**, or select a passage in the editor and choose **Add time reference…**. In normal Chronologue, each reference appears as a dated square on the outer ring, linked to its scene; clicking it opens the passage. The Timetable lists a scene's references as rows you can expand. See [Time references](https://github.com/EricRhysTaylor/radial-timeline/wiki/Time-References).
- **Name your main plot.** In **Subplot manager**, rename the main plot like any subplot. It stays in ring 1, keeps scenes with no Subplot, and is marked with a map pin. Each book names its own, and the dialog says how many of that book's scenes it updates before writing.
- **Remove from timeline.** Right-click a scene and choose **Remove from timeline** to take it off the timeline and out of the manuscript without deleting the note. Only its `Class` is removed; **Promote to scene** brings the same scene back.
- **Spanish, French, Thai, and Vietnamese.** The interface follows Obsidian's language in four more languages.
