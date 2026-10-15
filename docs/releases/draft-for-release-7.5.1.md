## Radial Timeline 7.5.1

The Timetable learns to work with the wheel: it follows the timeline's mode, lights its rows on the timeline, colors the wheel by any column, and edits many rows at once. Exports gain a table of contents with clickable PDF bookmarks and a list of recent exports, and timeline search is steadier.

### Timetable

- **The table follows the timeline's mode.** In Chronologue, rows run in story order with a divider for each day; **Shift** adds a **Gap** column, **Runtime** adds **Running time**, and the Alt calendar shows dates in the planetary calendar. In Progress, each heading counts complete scenes, words, and overdue scenes, and overdue Due cells stand out. In Gossamer, beats come forward with their latest score for the selected signal, its change since the previous run, the expected range, and the justification. The mode button in the Timetable's corner pins a mode instead, and a sort set in the Bases toolbar still wins over the mode's order.
- **Light up the table on the timeline.** Turn on the lens in the Timetable's corner, or as a view option, and every scene, beat, and backdrop outside the table dims on the wheel, with a pill naming the view. Any Bases filter becomes a pattern on the wheel, and a saved view is a saved lens.
- **Color the timeline by a column.** Right-click a column header, such as POV or Location, to color the wheel's scenes by its values, up to eight. Scenes without a value turn neutral, a pill on the wheel shows the legend, and **Stop coloring** restores the status and subplot colors.
- **Edit many rows at once.** Tick rows in the Timetable (**Shift** picks a range, **Esc** clears), and the bar under the table sets Status, Stage, Act, or rings on all of them, or promotes the ones that aren't scenes yet. Ring changes come with one notice and one **Undo**.
- **Quick picks in the cells.** Click a scene's number cell for its Status and Publish Stage, or click a Status, Publish Stage, or Act cell for that property's values. Marking a scene Complete sets Due to today, as it does from the wheel.
- **The table and the wheel point at each other.** The note open in an editor is marked in the table. Clicking an act label on the wheel shows that act in the table, and spotlighting a ring in the subplot key fades the rows outside it. Hovering a scene on the wheel lights its row in the color of the ring under the pointer.
- **A reading pane below the table.** Notes opened from a row, or clicked on the wheel while a Timetable is showing, open in a pane below the table, so the wheel, the table, and one note sit side by side. The pane's back button steps through the scenes you visited.
- **Open queries on the wheel.** A scene with unresolved author queries (`%%query: …%%`) shows a question bubble in each of its cells, and the Timetable's badge lists the questions.
- **Keys for the Timetable.** The **✱** button in the Timetable's corner opens a key to its row marks, clicks, and corner buttons; its header names the mode the table follows and what that mode changes. The timeline's own key adds the open-query mark and, while a Timetable is open, how the wheel and the table link.
- **Only manuscript notes in the Timetable.** Scenes, beats, and sketches appear wherever they sit in the book folder; other notes appear only from its top level, so feedback, cuts, and publishing material in subfolders stay out of the table. The **Table** view still lists everything.

See [Timetable](https://github.com/EricRhysTaylor/radial-timeline/wiki/Timetable).

### Publishing

- **Contents for any manuscript.** Under **Table of contents**, choose **Contents** and how many **Heading levels** to include, for PDF, Word, or Markdown, from a Radial Timeline book, a folder, or a single file. PDFs get searchable text, clickable contents with page numbers, and nested bookmarks built from your parts or acts, chapters, and scenes, or from a document's own headings. Word gets an updateable contents field (update it in Word for final page numbers), and Markdown gets linked headings.
- **Open what you exported.** After an export, **Open file** is the main button. **Recent exports**, in the panel's header and beside **Destination**, lists your last five exports with their files, and **Details** shows each one's file checks with an optional sign-off.
- **A tidier export panel.** Spacing and repeated wording are cleaned up, and the source choices name Radial Timeline books in full.

See [Manuscript export](https://github.com/EricRhysTaylor/radial-timeline/wiki/Manuscript-Export#table-of-contents).

### Search

- **Timeline search holds steady.** Switching books during a search restarts it in the new book. **Cancel** stops a local model mid-reply, edits made while a search runs are read fresh, and a scene in several subplots is searched once.
- **Concept matches check the whole request.** With **Local LLM assist**, OR alternatives are kept, and every part of the request needs support in the scene's text before a match counts. Long notes are covered instead of skipped, and a request too large for your local model's context window says so and points to **Settings → AI**.

### Model support

- **Gemini 4 Argon** replaces Gemini 3.1 Pro Preview, and a 3.1 Pro Preview selection moves to Argon. Argon uses Google's implicit caching, so Inquiry shows no cache countdown for it.

### Fixes

- **Subplot dragging shows where the scene lands.** The whole destination ring is outlined in its own color, the dragged scene takes that color on a move, and the confirmation uses it too. A drop that would change nothing outlines nothing.
- **Imports keep nested divisions and verse.** A single-file import keeps repeated chapter numbers distinct under their parent, such as Book I, Canto I and Book II, Canto I, and poetry from Project Gutenberg HTML keeps its line and stanza breaks.

- **Export controls are reachable again.** With **Readers** and **PDF** selected, scrolling the manuscript export panel reaches **Destination**, the export checks, and **Generate PDF** again, with the proof still beside the settings on wide windows.
- **Status and Publish Stage keep your property names.** Setting either from the wheel's menu or the Timetable writes to the note's existing property, such as a lowercase `status:` or your mapped name, instead of adding a second one.
