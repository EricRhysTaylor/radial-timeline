Keep the book’s notes beside the wheel in an Obsidian Bases view. The Timetable shows scenes, story beats, sketches, and other manuscript notes in rows, with scene status, subplot membership, dates, durations, and synopses visible together.

> **Available in 7.5.0.** Enable **Bases** under **Settings → Core plugins**. The Timetable works with Obsidian 1.13; the Act and Status boards require Obsidian 1.14 or later.

![The Timetable beside the radial timeline, with scene numbers, colored subplot squares, dates, durations, and synopses](images/timetable-sidebyside.webp)

## Open the Timetable

Click the table button in the timeline title bar, or run **Radial timeline: Open timetable**. On first use, confirm creation of the book’s `.base` file in `Radial Timeline/Timetables/`. It opens beside the timeline. Switching books on the timeline switches a following Timetable tab to that book; Saga scope opens a combined table grouped by book and act.

The `.base` file is yours to customize. Change its columns, filters, sorting, or views in Bases. Radial Timeline preserves those choices; for a book table, it updates the original folder filter when the manuscript folder changes, provided you have not replaced that filter yourself.

## Read the rows

- **Scene number:** the number cell carries writing status and Publish Stage colors. Story beats have their own number treatment; sketches remain distinct from scenes.
- **Rings:** colored squares show subplot membership in the wheel’s ring order. Hover for the subplot names. Outlined squares can show a subplot planned for a sketch before it appears on the wheel. **Rings per line** controls wrapping.
- **Properties:** columns come from your scene property templates and respect your field-name mappings. Use **Properties** to show or hide columns and drag a column edge to resize it.
- **When:** dates use the same display formatter as the timeline hover, including the active planetary calendar where applicable.
- **Open queries:** a marker identifies unresolved author queries in a note; hover to read them.

Hover a scene row to highlight it on the wheel. Hover a scene on the wheel to highlight and reveal its row. Click a scene row to open its note; **Shift-click** brings the timeline forward and highlights that scene. Right-click a scene row for the timeline’s scene menu.

## Write sketches beside scenes

Use **New sketch**, or the **+** beside an act heading, to create a sketch in the book’s manuscript folder. A sketch has `Class: Sketch` and appears in the Timetable, keeping a place for an idea without putting it on the wheel yet. In Saga scope, use a book heading’s **+** to choose the book.

Click a sketch row or its drawer control to open it. Write directly in the drawer and edit its Act and When there. The text is saved in the note body. If the note changes elsewhere while you type, the drawer asks which text to keep before overwriting anything. **Open every sketch** expands the sketch drawers together.

## Promote a note to a scene

Use **Promote to scene** on a sketch or a note with no Class. Review the proposed properties and placement, then promote it. Existing property values and body text are preserved; missing scene-template properties are added. A note already classified as a scene, beat, or another kind of note is not reclassified by this action.

You can also run **Radial timeline: Promote note to scene** or use the file-explorer context menu, including a folder’s direct children or a multi-selection. Notes must be inside a registered book’s manuscript folder; notes outside every book are explained and skipped. The scene then appears on the wheel and in the Timetable.

## Other views in the same file

| View | What it provides |
|---|---|
| **Timetable** | The compact book view with status numbers, Rings, and sketch drawers |
| **Table** | Obsidian’s editable property table for spreadsheet-style changes |
| **Not on the timeline** | Notes without a Class, ready to review or promote |
| **Act board** | A board grouped by Act, on Obsidian 1.14 or later |
| **Status board** | A board grouped by Todo, Working, and Complete, on Obsidian 1.14 or later |

The Saga file provides Timetable and Table views. To change scene order or subplot membership on the wheel, see [How to](How-to). For story-time placement, see [Chronologue Mode](Chronologue-Mode#drag-a-scene-to-change-its-date).
