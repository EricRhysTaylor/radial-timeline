## Radial Timeline 7.7.0

The Timetable becomes a working surface: row controls for Pending Edits, Synopsis, and Due, a coloring key you can narrow by clicking, and a lens that follows your filters. The Runtime view moves to Narrative mode, and the Zero Draft and Writing Session panels are redesigned.

### Timetable

- **Row controls.** Beside each scene number: the stage letter, a pencil while Pending Edits has text (hover to read them), the Synopsis icon on every row (hover to read it in full, or hold **Shift** for the Summary), and a dot when Due is late or near. On hover, **+** and **++** move Due on by a day or a week.

<img src="https://raw.githubusercontent.com/EricRhysTaylor/radial-timeline/4eb9e8369be6037f13b9b2b41339c37c06372483/wiki/images/timetable-row-panel.webp" alt="Row controls on scene 6 of Pride and Prejudice: hovering the pencil shows its Pending Edits, with + and ++ beside the Synopsis icon" width="586">

- **Color the wheel by any category, then narrow it.** Right-click a column header such as Character, Place, or POV to color the timeline by it. Every member of a list counts, not only the first. Click names in the key to show only the scenes they share; Timetable rows that don't match fade. **When** colors by month (or day, year, or a range you set), and **Due** by Overdue, Today, Next 7 days, and Later. **Edit key** changes the choices, and the coloring is saved with the view.
- **The lens follows your filter.** A Timetable view with its own filter lights its rows on the wheel by itself, and the rest of the wheel recedes.
- **Readable from the start.** New Timetables lead with When, Character, Place, Due, and Words, columns fit their content, and **Shift**-hover reads a cut-off cell in full. **Reset columns to recommended** brings an existing table in line. The **✱** key explains the number cell and the Words bar.

See [Timetable](https://github.com/EricRhysTaylor/radial-timeline/wiki/Timetable).

### Runtime view moves to Narrative mode

- **Runtime follows the order readers meet your scenes.** Turn it on with the **RT** keycap or the **Runtime** chip beside **Narrative**. Each scene keeps its slice of the ring, a blue arc shows its runtime, the perimeter shows the running time, and the book's total sits at the center. Chronologue keeps **Shift** and **Alt** for story time.
- **The runtime estimator times only what is read aloud.** Comments, callouts, review blocks, and link syntax no longer count as narration.

<img src="https://raw.githubusercontent.com/EricRhysTaylor/radial-timeline/4eb9e8369be6037f13b9b2b41339c37c06372483/wiki/images/runtime-narrative.webp" alt="The Runtime view in Narrative mode: a blue runtime arc in every scene, running times around the perimeter, and the book's total of 13:30:34 at the center" width="600">

See [Runtime view](https://github.com/EricRhysTaylor/radial-timeline/wiki/Narrative-Mode#runtime-view).

### Zero Draft and Writing Session

- **Zero Draft keeps your earlier ideas.** The dialog shows the scene's current Pending Edits above the field, and **Save** adds what you type after them instead of replacing them.
- **A calmer Writing Session panel.** One accent color, a title block with a ring that shows a count-up session or a countdown sprint, and a compact target.

<img src="https://raw.githubusercontent.com/EricRhysTaylor/radial-timeline/4eb9e8369be6037f13b9b2b41339c37c06372483/wiki/images/panel-zero-draft.png" alt="The Zero Draft dialog for 13 Collins Arrives: current Pending Edits in a dashed block above a field for new ones, with Save enabled" width="480">

### Fixes

- **Backslashes print in PDF exports.** A `\` in a title, heading, or epigraph prints as written instead of breaking the export.
- **Saga table filters stay.** Filters you add to a saga's Timetable survive when a book joins, leaves, or moves.
- **The wheel stays upright.** Chronologue and Gossamer no longer apply a rotation saved in Narrative.
- **Hover text reads clearly** on solid strips, and hover panels near the bottom of the timeline fit inside it.
- **Settings fit their pane.** Settings controls and AI strategy cards adapt to narrow panes.
