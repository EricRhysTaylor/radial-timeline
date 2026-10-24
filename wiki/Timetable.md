Keep the book’s notes beside the wheel in an Obsidian Bases view. The Timetable shows scenes, story beats, sketches, and other manuscript notes in rows, with scene status, subplot membership, dates, durations, and synopses visible together. Scenes, beats, and sketches appear wherever they sit in the book folder; other notes appear only from the book folder’s top level, so feedback, cuts, and publishing material kept in subfolders stay out of the way. The **Table** view in the same file lists everything.

> [!NOTE]
> Enable **Bases** under **Settings → Core plugins**. The Timetable works with Obsidian 1.13; the Act and Status boards require Obsidian 1.14 or later.

![The Timetable beside the radial timeline, with scene numbers, colored subplot squares, dates, durations, and synopses](images/timetable-sidebyside.webp)

## Open the Timetable

Click the table button in the timeline title bar, or run **Radial timeline: Open timetable**. On first use, confirm creation of the book’s `.base` file in `Radial Timeline/Timetables/`. It opens beside the timeline. Switching books on the timeline switches a following Timetable tab to that book; Saga scope opens a combined table grouped by book and act.

The `.base` file is yours to customize. Change its columns, filters, sorting, or views in Bases. Radial Timeline preserves those choices. When a book’s manuscript folder changes, or a book joins or leaves the saga, it updates only the folder filter it wrote, wherever you have moved it, provided you have not replaced that filter yourself.

## Read the rows

- **Scene number:** the number cell carries writing status and Publish Stage colors. Story beats have their own number treatment; sketches remain distinct from scenes. Click a scene's number cell to set its Status or Publish Stage, or click a Status, Publish Stage, or Act cell for that property's values. Marking a scene Complete sets Due to today, as it does from the wheel.
- **Rings:** colored squares show subplot membership in the wheel’s ring order. Hover for the subplot names. Outlined squares can show a subplot planned for a sketch before it appears on the wheel. **Rings per line** controls wrapping.
- **Properties:** columns come from your scene property templates and respect your field-name mappings. Use **Properties** to show or hide columns and drag a column edge to resize it.
- **When:** dates use the same display formatter as the timeline hover, including the active planetary calendar where applicable.
- **Open queries:** a marker identifies unresolved author queries in a note; hover to read them. On the wheel, the same scene shows a question bubble in each of its cells.

The **✱** button in the table’s corner opens the Timetable keys: what the row marks mean, what each click does, and the corner buttons. A badge names the mode the table follows, and a section on top explains what that mode changes (Chronologue’s date dividers and its Gap or Running time column, Progress’s act totals and overdue dates, Gossamer’s beats and scores). The timeline’s own **✱** key covers the wheel, including the open-query mark and the clicks that link to a Timetable.

Hover a scene row to highlight it on the wheel and give its row a solid leading accent and a muted color wash. The color follows the rendered scene: subplot color in Narrative and Chronologue, status or Publish Stage color in Progress, or the active column coloring. Hover a scene on the wheel to reveal its row in that specific cell’s color. Click a scene row to open its note; **Shift-click** brings the timeline forward and highlights that scene. Right-click a scene row for the timeline’s scene menu.

The table and the wheel point at each other. The note open in an editor is marked in the table. Clicking an act label on the wheel (a book label in Saga scope) shows that act in the table, expanding it if collapsed. Spotlighting a ring in the subplot key fades the rows outside that ring.

### Time references within a scene

Expand the reference control beside a scene number to see its dated passages, then click a child row to open the passage or **Manage time references** to edit the list. See [Time references](Time-References) for the YAML format and how child rows connect to the Chronologue wheel.

### Follow the timeline’s mode

The Timetable draws itself in the timeline’s mode, and the mode button in its corner shows which. Click it to pin a mode instead. A sort set in the Bases toolbar still wins over the mode’s order.

| Timeline mode | What the table shows |
|---|---|
| **Narrative** | Rows in manuscript order. The **Runtime** view adds a **Running time** column: the runtime through each scene in reading order. |
| **Chronologue** | Rows in story order with a divider for each day; beats are left out, as on the wheel. **Shift** adds a **Gap** column (time since the previous dated row), and the Alt calendar shows dates, days, and gaps in the planetary calendar. |
| **Progress** | Each heading counts complete scenes, words, and overdue scenes; overdue Due cells stand out. |
| **Gossamer** | Beats come forward with their latest score for the selected signal, its change since the previous run, the expected range (flagged when a score is outside it), and the justification. Other rows recede. |

### Light up the table on the timeline

Turn on the lens in the Timetable’s corner, or as a view option saved in the `.base` file. Every scene, beat, and backdrop outside the table’s rows dims on the wheel, and a pill names the view, with a button that turns the lens off. Any Bases filter becomes a pattern on the wheel, so a saved view is a saved lens.

### Color the timeline by a column

Right-click a column header to color the timeline’s scenes by that column’s values, such as POV or Location: any field with up to eight values. Each value takes a ring color, scenes without one are drawn neutral, and a pill on the wheel shows the legend. **Stop coloring** restores the status and subplot colors. Coloring isn’t saved, and one table colors the timeline at a time.

### Edit many rows at once

Each scene, sketch, and not-yet-promoted row has a checkbox. **Shift** picks a range and **Esc** clears the selection. While rows are picked, a bar under the table sets Status, Stage, or Act on all of them, adds them to a ring or removes them from one, or promotes the ones that aren’t scenes yet. Status and Stage follow the wheel menu’s rules, so Complete sets Due. Ring changes come with one notice and one **Undo** for every note changed.

### The reading pane

Notes you open from the Timetable appear in a pane below the table, so the wheel, the table and one note sit side by side. While a Timetable is showing, scenes clicked on the wheel open there too, and their row is marked in the table.

- The first note splits the table downward. Each later note replaces the one in the pane, and the pane’s back and forward buttons step through the scenes you visited. Drag the divider to give the table or the note more room; you can also drag the pane above the table.
- A note that is already open somewhere is shown where it is, not opened twice.
- **Cmd-click** (Ctrl-click on Windows and Linux) opens a new tab instead.
- Pin the note in the pane to keep it: the next note opens in a tab beside it.
- The reading pane is used only while a Timetable is showing.

## Write sketches beside scenes

Use **New sketch**, or the **+** beside an act heading, to create a sketch in the book’s manuscript folder. A sketch has `Class: Sketch` and appears in the Timetable, keeping a place for an idea without putting it on the wheel yet. In Saga scope, use a book heading’s **+** to choose the book.

Click a sketch row or its drawer control to open it. Write directly in the drawer and edit its Act and When there. The text is saved in the note body. If the note changes elsewhere while you type, the drawer asks which text to keep before overwriting anything. **Open every sketch** expands the sketch drawers together.

## Promote a note to a scene

Use **Promote to scene** on a sketch or a note with no Class. Review the proposed properties and placement, then promote it. Existing property values and body text are preserved; missing scene-template properties are added. A note already classified as a scene, beat, or another kind of note is not reclassified by this action.

You can also run **Radial timeline: Promote note to scene** or use the file-explorer context menu, including a folder’s direct children or a multi-selection. Notes must be inside a registered book’s manuscript folder; notes outside every book are explained and skipped. The scene then appears on the wheel and in the Timetable.

To go the other way, right-click a scene and choose **Remove from timeline**. Only its `Class` is removed: the note stays where it is, keeps its ID, act, subplots and text, and stays in its row here as a note with no Class, wherever it sits in the book folder. Promote it to bring the same scene back.

## Other views in the same file

| View | What it provides |
|---|---|
| **Timetable** | The compact book view with status numbers, Rings, and sketch drawers |
| **Table** | Obsidian’s editable property table for spreadsheet-style changes |
| **Not on the timeline** | Notes without a Class, ready to review or promote |
| **Act board** | A board grouped by Act, on Obsidian 1.14 or later |
| **Status board** | A board grouped by Todo, Working, and Complete, on Obsidian 1.14 or later |

The Saga file provides Timetable and Table views. To change scene order or subplot membership on the wheel, see [How to](How-to). For story-time placement, see [Chronologue Mode](Chronologue-Mode#drag-a-scene-to-change-its-date).
