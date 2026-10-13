## Radial Timeline 7.5.1

The Timetable learns to work with the wheel: it follows the timeline's mode, lights its rows on the timeline, colors the wheel by any column, and edits many rows at once. Timeline search is steadier, and the export panel's controls are reachable again below a PDF proof.

### Timetable

- **The table follows the timeline's mode.** In Chronologue, rows run in story order with a divider for each day; **Shift** adds a **Gap** column, **Runtime** adds **Running time**, and the Alt calendar shows dates in the planetary calendar. In Progress, each heading counts complete scenes, words, and overdue scenes, and overdue Due cells stand out. In Gossamer, beats come forward with their latest score for the selected signal, its change since the previous run, the expected range, and the justification. The mode button in the Timetable's corner pins a mode instead, and a sort set in the Bases toolbar still wins over the mode's order.
- **Light up the table on the timeline.** Turn on the lens in the Timetable's corner, or as a view option, and every scene, beat, and backdrop outside the table dims on the wheel, with a pill naming the view. Any Bases filter becomes a pattern on the wheel, and a saved view is a saved lens.
- **Color the timeline by a column.** Right-click a column header, such as POV or Location, to color the wheel's scenes by its values, up to eight. Scenes without a value turn neutral, a pill on the wheel shows the legend, and **Stop coloring** restores the status and subplot colors.
- **Edit many rows at once.** Tick rows in the Timetable (**Shift** picks a range, **Esc** clears), and the bar under the table sets Status, Stage, Act, or rings on all of them, or promotes the ones that aren't scenes yet. Ring changes come with one notice and one **Undo**.
- **Quick picks in the cells.** Click a scene's number cell for its Status and Publish Stage, or click a Status, Publish Stage, or Act cell for that property's values. Marking a scene Complete sets Due to today, as it does from the wheel.
- **The table and the wheel point at each other.** The note open in an editor is marked in the table. Clicking an act label on the wheel shows that act in the table, and spotlighting a ring in the subplot key fades the rows outside it. Hovering a scene on the wheel lights its row in the color of the ring under the pointer.
- **A reading pane below the table.** Notes opened from a row, or clicked on the wheel while a Timetable is showing, open in a pane below the table, so the wheel, the table, and one note sit side by side. The pane's back button steps through the scenes you visited.
- **Open queries on the wheel.** A scene with unresolved author queries (`%%query: …%%`) shows a question bubble in each of its cells, and the Timetable's badge lists the questions.

See [Timetable](https://github.com/EricRhysTaylor/radial-timeline/wiki/Timetable).

### Search

- **Timeline search holds steady.** Switching books during a search restarts it in the new book. **Cancel** stops a local model mid-reply, edits made while a search runs are read fresh, and a scene in several subplots is searched once.
- **Concept matches check the whole request.** With **Local LLM assist**, OR alternatives are kept, and every part of the request needs support in the scene's text before a match counts. Long notes are covered instead of skipped, and a request too large for your local model's context window says so and points to **Settings → AI**.

### Model support

- **Gemini 4 Argon** replaces Gemini 3.1 Pro Preview, and a 3.1 Pro Preview selection moves to Argon. Argon uses Google's implicit caching, so Inquiry shows no cache countdown for it.

### Fixes

- **Export controls are reachable again.** With **Readers** and **PDF** selected, scrolling the manuscript export panel reaches **Destination**, the export checks, and **Generate PDF** again, with the proof still beside the settings on wide windows.
- **Status and Publish Stage keep your property names.** Setting either from the wheel's menu or the Timetable writes to the note's existing property, such as a lowercase `status:` or your mapped name, instead of adding a second one.
