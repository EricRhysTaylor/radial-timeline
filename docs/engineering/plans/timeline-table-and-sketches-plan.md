# Timetable, sketches, and Promote to scene

Date: 2026-10-11
Status: Phases 1 and 2 built 2026-10-12. Phase 3 spikes remain. The feature was renamed from "Timeline table" to **Timetable** on 2026-10-12 (Eric); the abbreviation (TT) and the icons are unchanged.

**Built 2026-10-12: Promote to scene (§1).** It's in `src/services/PromoteToSceneService.ts` (planning and apply, with unit tests), `src/services/PromoteToSceneEntry.ts` (entry points) and `src/modals/PromoteToSceneModal.ts`.
- **Entry points:** the command palette (**Promote note to scene**), the file menu on an eligible note, the file menu on a folder (its direct children only, so cut or archive subfolders are never swept in), and the multi-selection menu.
- **Eligibility:** only notes with no Class, or with `Class: Sketch`. Beats, Backdrops, matter pages and every other classed note are skipped and listed.
- **Writes:** missing template keys are detected under any letter case and through key mappings and built-in aliases, then inserted with `processFrontMatter`. Existing values are never overwritten, the Class key's casing is kept, and the body is never touched. Then come `ensureSceneIds`, a bounded wait for the metadata cache to show the new class, and `reorderSceneFields`.
- **Numbering:** a single unnumbered note can be numbered "after which scene" through `buildDecimalSceneInsertionPrefix`, and the rename goes through `fileManager.renameFile`. A bulk promotion keeps names and reports unnumbered notes.
- **Strings:** translated in all five languages.
- **Difference from the plan:** a note outside every book folder is explained and skipped rather than offered a move. Moving notes between folders is better done in the file explorer, and offering it would mean guessing the target book.


**Built 2026-10-12: the Timetable, sketches and the When formatter (§2 to §6).**
- **Code:** `src/timetable/` holds the row model (`timetableModel.ts`), the `.base` file builder (`timetableFiles.ts`), the Bases view (`TimetableView.ts`), the sketch drawer (`SketchDrawer.ts`), opening and book following (`TimetableService.ts`) and the registry the wheel uses to reach open tables (`timetableRegistry.ts`). The shared When formatter is `src/utils/whenFormat.ts`. The wheel's hover link is `src/view/interactions/TimetableLink.ts`. Styles are in `src/styles/timetable.css`.
- **Commits:** `df7dd9be` (When formatter), `72ff559c` (Timetable view, files, opening, following), `c562cf06` (sketches, drawer, query counts), `7de9ce72` (context menu, cross-highlighting), `2637f956` (fixes from the visual check).
- **Checked visually** in a QA copy of the Sherlock Holmes demo (`Command Center/Agent Runs/2026-10-12 Timetable QA/`): status fills, beats, act groups, the Rings column, + New sketch, drawer saving and the conflict notice, Act and ring edits from the drawer, Promote from a row, the Act board, cross-highlighting in both directions, and book following.

**Differences from the plan, and findings**
- **Folder:** `Radial Timeline/Timetables/` (was `Tables/`), to match the new name.
- **Group order is written only on the two boards.** In Obsidian 1.14, a view with a `groupOrder` hides every group the list leaves out, and `groupedData` for custom views also drops empty groups. A group order on the Timetable or the built-in Table would hide an act beyond the book's act count, so those two views group by Act without one. The Act board lists every act plus "None", so empty acts show as columns to plan into. The Status board lists Todo, Working and Complete plus "None".
- **The saga table** has no Obsidian grouping. When rows span books, the Timetable groups them by book itself (saga order), with act dividers inside each book. It has the Timetable and Table views only; acts from different books would mix on a board.
- **Act dividers:** inside any group whose rows span more than one act, the Timetable draws act dividers, so an ungrouped or differently grouped table still reads like the wheel.
- **A sketch's rings** are written as the exact list the author toggles. The scene membership helpers treat an empty Subplot as Main Plot, which is right for scenes but would add Main Plot to every sketch.
- **Right-click on a row that isn't a scene** shows Obsidian's own file menu, which includes Promote for notes that qualify.
- **Opening a note from a row** never covers the Timetable: it reveals the note where it is open, or uses an editor or empty tab, or splits a pane beside the table.
- **Default columns** leave out what the number cell and Rings column show and the long-form Summary and Pending Edits. Cells stay on one line, as in Obsidian's table.
- **Text size** follows Obsidian's Bases table variables, so the per-device Bases font size applies.
- **Blank properties from Promote** are written blank (`When:`), not as an empty string.
- **Existing bug, not changed:** `SceneHighlighter.highlight()` looks for `.scene-group`, which the renderer no longer emits (it emits `.rt-scene-group`), so file-explorer hover and file-open highlighting on the wheel do nothing. Its un-highlight path also removes old class names. The Timetable uses a new `spotlight()` instead.

**Not built yet**
- **Create book base** as a Book Manager button. The table file is created from the title-bar button or the command, after a confirm.
- The YAML audit's "Refresh columns" for a table whose columns have drifted from the template.
- Shared multi-row selection and "Promote selected" across the table and the wheel.
- Inline cell editing, which the built-in Table view already offers on the same file.
- Embedding check: a Timetable embedded in a note was not tested.

**Decided 2026-10-11 (Eric):**
- The pre-scene note type is called **Sketch**.
- To begin with, sketches live **only in the Timetable**, so the timeline isn't cluttered with non-manuscript material.
- Sketches feed **Inquiry** as outline context, and nothing else (no Gossamer, Pulse or Summary).
- The feature is called the **Timetable**. Its compact **Rings column** (§2) is the linear view users asked for. The separate lanes layout ("Unwrapped") was dropped; see *Considered and set aside*.
- **No gating.** Pro is free for everyone; the Timetable and sketches are listed on the website's Pro page as Pro features for fun.
- **Promote's template** follows the Core/Advanced setting by default and shows it as a preselected toggle in the dialog. This was Claude's recommendation, since Eric was unsure; it's easy to revisit.
**Decided 2026-10-12 (Eric):**
- **One When formatter** for the scene hover and the Timetable. The title bar keeps its own format. It keeps the current hover format with the weekday added and the `@` kept: `Wed Jan 3, 2085 @ 2:20PM`. A date-only When shows no time; it no longer reads "@ Noon". See §4.
- **A sketch's text stays in the note body**, never in YAML.
- **Promote is a Lucide icon button**, and Promote in Obsidian's built-in Table view is wanted (still a spike, phase 3).
- **Opening the table:** a Timetable button on the right side of the timeline's title bar, and a command palette entry. See §5.

- **Compact layout** (Eric, from the mockups): status lives in the scene-number cell, using the stage color and the Working and Todo patterns from settings; subplot membership is one narrow Rings column, not a column per ring. The width goes to the author's other properties.

## Problem

The timeline is RT's dashboard. It shows a whole book on one screen, and authors want to plan on it as well as read it. Four gaps get in the way.

1. **Notes the timeline can't see.** A note appears only when its frontmatter says `Class: Scene` (`class === 'scene'` throughout `src/`). Outlines, imports and quick placeholders often lack it. In Eric's own Book 2 folder on 2026-10-11, only 9 of 51 notes had it. Of the rest, 31 were empty title-only stubs, and 8 were drafted scenes with no `Class` line, so they were invisible on the wheel.
2. **No table.** Some authors think in tables. Obsidian Bases already gives them one, but it knows nothing about RT. It has no manuscript order, no beats, no ring colors, no status fills, and no way to turn a row into a proper scene.
3. **No pre-scene material.** While a book is being shaped, an author needs things that hold a place in the story without being manuscript: a placeholder idea, a candidate set piece, an open question. Today the only option is a real `Class: Scene` note. That note then counts in exports, numbering and word targets before the author has committed to it.
4. **No linear view.** Users have asked for the timeline "unwrapped": a YouTube comment, and a GitHub request for horizontal and vertical linear views. Their reasons: scrolling instead of zooming into thin slices, seeing more detail at once, and escaping the automatic inner-to-outer ring order.

Right-click **Add scene** already covers creating a new scene on the wheel (`src/view/interactions/SceneContextMenu.ts` → `SceneInsertService.planSceneInsertion`). This plan does not replace it.

## Principles

- **Timeline first.** The wheel stays the primary view. The table should feel like the same instrument, not a second app.
- **One record.** A note's frontmatter is the only copy of scene data. The timeline and any Base read the same properties, so editing either one updates both with nothing to sync.
- **Scene YAML belongs to the author** (`code-doctrine.md`). Nothing in this plan writes operational state into notes. View configuration lives in the `.base` file, which is an author file and is written only on request, or in plugin data.
- **Reuse, don't parallel.**
  - Numbering: `buildDecimalSceneInsertionPrefix`.
  - Template keys: `buildScenePropertyDefinitions` (base plus advanced, Settings → Core).
  - Field backfill: `insertMissingCoreFields`, `insertMissingAdvancedFields`, `reorderSceneFields` (`src/sceneProperties/sceneNormalizer.ts`).
  - Color: `getFillForScene` (`src/renderer/utils/SceneFill.ts`) and `subplotColors`.
  - Ring order: `masterSubplotOrder` from `computeCacheableValues`.
  - Editing: the scene context menu and its subplot-membership actions.
- **No fallbacks** (`fallback-policy.md`). When the target book is ambiguous, or Bases is disabled, the action fails loudly; it never guesses.

## 1. Promote to scene

One action that turns any note in a book folder into a proper scene, and the only way a sketch enters the manuscript.

**Where it's offered**
- A button on each non-scene row in the Timetable (§2).
- The file menu and the command palette: **Promote to scene**.
- In bulk, on a multi-row selection in the Timetable, or on a folder.

**What it does** (a confirm modal in the `AddSceneConfirmModal` pattern; a dry-run preview when promoting more than one note)
1. **Book.** The note must sit inside a book's `sourceFolder` (`BookProfile`). If it doesn't, offer to move it. Never infer a book.
2. **Template.** A Core/Advanced toggle, preselected from `sceneAdvancedPropertiesEnabled`, which is the same rule right-click Add scene uses. So a promoted note gets exactly the YAML a newly added scene would. A bulk Promote makes one choice for the whole batch.
3. **Prefill.** Set `Class: Scene`; a sketch's `Class: Sketch` becomes `Class: Scene`. Keep every value the note already has. Fill missing managed keys from the template, using what the row or context provides:
   - **Subplot:** the row's existing value, or the ring the author picks, or `Main Plot`. Multiple memberships are kept.
   - **Act and When:** the row's own values, or the anchor scene's (`resolveAnchorActNumber`, `readAnchorWhen`).
   - **Due:** today, as the template already does.
   - **Scene ID:** `ensureSceneIds`.
4. **Number.** If the filename already has a numeric prefix, keep it. If not, ask "after which scene?" and use `buildDecimalSceneInsertionPrefix`, so nothing else in the manuscript is renamed. Drag reordering stays the tool for larger moves.
5. **Merge rules.** Never overwrite an existing value. Author custom fields stay attached to the managed field above them (`reorderSceneFields`). The note body is never touched.

This phase stands alone and fixes the invisible-notes gap immediately.

## 2. Timetable (a Bases view)

Obsidian 1.10+ lets plugins register Bases view types (`Plugin.registerBasesView(viewId, { name, icon, factory, options })`; the view class extends `BasesView` and implements `onDataUpdated`). RT's minimum app version is 1.13, so this is available. If `registerBasesView` returns `false` because Bases is disabled, show a notice; don't substitute another view.

One row per scene, a page you scroll down, and columns you can rearrange. That's the Obsidian-native way to see a book in more detail than the wheel allows.

**Data.** The Base's own filters choose the rows; `BasesQueryResult.data` gives the entries. RT adds what Bases can't know:
- **Order.** Default to manuscript order, the same as the wheel, with beat notes interleaved where they sit. A sort the author sets in the Base toolbar (`config.getSort()`) overrides it.
- **Groups.** Use Obsidian's own grouping (`groupBy`, read through `BasesQueryResult.groupedData`) rather than grouping inside the view. Default to grouping by Act, with group headers labelled from the timeline's act labels (`actLabelsRaw`). Then the Group menu added in 1.14.3 (reorder, hide, add groups) works in the Timetable unchanged; see §6.
- **Columns.** By default, the managed keys of the scene template, core plus advanced when enabled, taken from `buildScenePropertyDefinitions`, so the table mirrors the YAML exactly. The author can add, hide or reorder columns through the normal Bases properties menu (`config.getOrder()`).

**Rings column: the vertical linear view.** One narrow column (about 80px for five rings) that holds a tiny square for every subplot ring, in the wheel's ring order (`masterSubplotOrder`).
- **Cells.** A square is filled with the ring's color when the scene belongs to that subplot. A scene in two subplots fills two squares, and a pale square means not a member.
- **Rhythm.** Each ring keeps the same slot in every row, so reading down one slot shows that plotline's rhythm. A thread that goes quiet shows as a run of pale squares, where on the wheel it's a thin arc on an inner ring. Because the order is the author's saved ring order, this also answers the complaint about automatic inner-to-outer sorting.
- **Names.** Hovering the strip lists the scene's rings, and hovering the header lists all rings in order. The header strip shows the ring colors in slot order.
- **Not a property.** The column is rendered by the view from `Subplot`. A view option (`BasesViewRegistration.options`) turns it on or off.
- **Beat rows** run across the full width as quiet dividers. **Sketch rows** show planned memberships as hollow squares.
- **Read-only.** The squares are too small to click reliably, so membership changes stay in the row's context menu (*Add to subplot*, *Remove from*).
- **Wrapping** (Eric, 2026-10-12). Past a set number of squares per line (a view option, 3 to 5 by default), the grid wraps onto more lines. Every row wraps at the same point, so each ring keeps its slot and a plotline still reads straight down the page; the column just gets taller.

**Visuals: the same color language as the wheel**
- **Status in the number cell.** The scene number sits in a square filled by `getFillForScene`, the same fill the wheel gives the scene's cell: the publish-stage color for completed scenes, the Todo plaid and the author's Working pattern (`workingPatternId`, including custom Pro patterns) for the scene's stage, and the Due color when overdue. The patterns reuse the timeline's SVG pattern defs, so the table never invents its own status colors. A sketch's cell is an outlined square with a dash; a note not on the timeline gets a grey outline. (The wheel's own number squares are tinted by subplot through `numberSquareVisualResolver`; the table deliberately uses status there, because the Rings column already carries the subplot.)
- **Beat rows** are white, as on the wheel, and show the beat model and Purpose (read through `readBeatPurpose`).
- **Sketch rows** (§3) are ghosted: dashed border and a translucent tint.
- **Notes the timeline can't see** get a muted row and a **Promote** button (§1): a Lucide icon button, `file-up` proposed so it pairs with `file-plus-2` (right-click Add scene), with the tooltip "Promote to scene."
- **When** cells use the shared formatter (§4). **Duration** keeps its own column, because it's its own template key.

**Editing, two ways at once**
- **Right-click a row** to get the same menu as right-clicking the scene on the wheel: Add scene, Set chapter, Set part, Status, Publish Stage, and subplot move, add or remove. There's no new editing UI to build or keep in step.
- **Inline cell edits** are optional and later. Authors who want spreadsheet editing can switch the same `.base` file to Obsidian's built-in Table view, which already writes frontmatter. Both views read the same notes.

**Cross-highlighting** keeps the table and wheel feeling like one instrument. Hovering a row highlights the scene on an open timeline, and hovering a scene scrolls to and highlights its row. Clicking a row opens the note; Shift-clicking reveals the scene on the timeline. Selections are shared, so "Promote selected" works from either side.

**Create book base** (command, and a button in Book Manager). This writes a `.base` file for a book, on request only. It holds:
- a filter on the book's `sourceFolder`;
- the Timetable as the default view;
- a built-in Table view for spreadsheet editing;
- a **Not on the timeline** view (`class != "Scene"`, excluding beats and sketches) that lists everything Promote can fix;
- an **Act board**: Obsidian's built-in Kanban view grouped by Act, with columns in `groupOrder` for every act plus "No act" (decided 2026-10-12, §6);
- a **Status board**: the built-in Kanban view grouped by Status (Todo, Working, Complete) (decided 2026-10-12, §6).

The YAML audit panel can flag a Base whose columns have drifted from the template ("Refresh columns"). It never rewrites the file silently.

## 3. Sketches (table only, to begin)

An author-facing note type, `Class: Sketch`, for story material that has a place but isn't manuscript yet.

- **Fields.** A subset of the scene base template: Act, When, Subplot, Synopsis, Character, Place. There's nothing new to learn, and every field is one the author reads, so it passes the doctrine litmus test.
- **Lives in the book folder** beside the scenes, so the book's table finds it, and Promote converts it in place without moving it (Eric, 2026-10-12).
- **Shown only in the Timetable** (decided 2026-10-11). The wheel needs no change: it renders `class === 'scene'` only, so sketches already stay off it. They are also excluded from exports, numbering, word counts and targets, Pulse, Summary and Gossamer.
- **Feeds Inquiry** as outline context (decided 2026-10-11), and no other AI pass.
- **Creating a sketch.** A **+ New sketch** button in the Timetable creates the note **in the book's `sourceFolder`**, with `Class: Sketch` and Act and Subplot prefilled from the group or the selected row, then opens its drawer. This is the "add a row and get a timeline entry" flow. The sketch stays in the table until it is promoted. Don't use `createFileForView` here: it follows Obsidian's new-note location, and with the tables in `Radial Timeline/Timetables/`, that could drop a sketch outside the book folder. Create the file with the vault API at the book path instead.
- **The sketch drawer** (Eric, 2026-10-12) is how a sketch gets room to be written:
  - **Collapsed,** a sketch row is one line, and its Synopsis cell shows the Synopsis property, or the first line of the note's text when that's empty.
  - **Open,** by clicking the row or its chevron (or Enter), a full-width drawer opens beneath the row, spanning every column. The scene rows around it stay compact. Esc or the chevron closes it. Several drawers can be open at once, and a view option opens all sketches.
  - **The editor is the sketch note's own body,** never a YAML field, so long writing stays out of frontmatter. It's an auto-growing text area of the Markdown source. Past about 60% of the viewport it scrolls inside the drawer. When it isn't focused, it renders with `MarkdownRenderer`, so links work; click to edit.
  - **Saving.** Writes are debounced and go through `app.vault.process`, touching only the body below the frontmatter. If the file changes elsewhere while a drawer is open, an unedited drawer refreshes, and an edited one shows a conflict notice. It never silently overwrites (`fallback-policy.md`).
  - **Properties in the drawer:** small editable Act and When chips, and the rings as named toggles. In the drawer they're big enough to click safely, and they write `Subplot` through the same membership helpers as the context menu. Then come **Promote to scene** (the `file-up` icon button with its label) and **Open note**.
  - **Open and closed state** is view state, kept in memory or `config.set`, never in YAML.
  - **Scenes don't get a body editor.** Manuscript prose is never editable from the table. A later, optional scene drawer would edit Synopsis only.
- **Commitment.** Promote (§1) turns a sketch into a scene. That is the moment it appears on the wheel, and the deliberate moment an idea enters the manuscript. Promote never touches the body, so the sketch's text becomes the new scene's starting notes.
- **Open questions** don't need a class. Editorialist's `%%query: …%%` author queries already exist, and RT handles them on export (`src/utils/authorQueryComments.ts`). The Timetable can show a count of open queries on any scene or sketch row, so spine questions show up where they live. No new YAML is needed.
- **Later, only if wanted:** ghost cells for numbered sketches on the wheel, and **Add sketch** in the wheel's right-click menu.

## 4. One When formatter

Today RT formats a scene's When in two different ways:
- **Hover synopsis:** `formatDateForDisplay` (`src/utils/hoverMetadata.ts`) gives "May 10, 2085 @ 2:20PM", with Duration on its own line.
- **Title bar** (the scene-time badge in a markdown view header): `sceneTimeLabel` (`src/utils/sceneTimeLabel.ts`) gives "☀ 2:20 PM Wed · 2 hours → 4:20 PM", and repeats the raw YAML (`2085-05-10`) for a date-only When.

**Decided 2026-10-12: one formatter for the scene hover and the Timetable.**
- **Format.** The current hover format with the weekday added and the `@` kept: `Wed Jan 3, 2085 @ 2:20PM`.
- **The year always shows**, as it does in the hover today.
- **A date-only When shows no time:** `Thu May 10, 2085`. `parseWhenField` reads date-only values as local noon, so `formatDateForDisplay` currently prints "@ Noon" for a time the author never set. The formatter needs the has-clock signal that `sceneTimeLabel` already computes from the raw string (or an equivalent flag carried on the item). "@ Noon" and "@ Midnight" appear only when the YAML actually says 12:00 or 00:00.
- **Planetary calendars:** when the planetary calendar is active, the same `convertFromEarth` conversion the hover uses.
- **Language:** month and weekday names follow the plugin's language. The current formatter hardcodes English month names, while the rest of RT now has four translations.
- **Search** keeps matching the displayed string. `formatHoverMetadataValue` routes Dates through the same formatter.
- **Sorting** in the table uses the real date, never the text.

**The title bar stays separate** (decided 2026-10-12). The scene-time badge (`sceneTimeLabel`) keeps its own compact clock format, with its sun or moon, end time, elapsed time and cues. The shared formatter covers only the scene hover and the Timetable.

This change is independent of the table and can ship first.

## 5. Opening the table, and following the book

**Entry points** (decided 2026-10-12)
- **Title bar button.** A new entry in `titleActions` in `src/view/TimeLineView.ts`, alongside Commands, Export, Bug and Books, so it gets the same icon-button styling and folds into the ☰ menu (TitleBarFit) when the bar is narrow. It uses the Lucide icon `table-2`, with the tooltip and label "Timetable".
- **Command palette:** **Open Timetable**.
- Both open the table for the timeline's current scope in a tab beside the timeline, or focus it if it's already open.

**Following the book** (decided 2026-10-12)
- **The timeline is the master view.** The table follows it, and the table never changes which book the timeline shows.
- **One `.base` file per book, all kept together in `Radial Timeline/Timetables/`** (Eric, 2026-10-12: keep the tables together, saga included, with no new settings). It sits under the plugin's single system folder (`RT_SYSTEM_FOLDER` and `systemFolderPath('Timetables')` in `src/utils/systemFolder.ts`), whose doctrine is one top-level folder and no siblings. So no new setting is needed, and authors who don't keep an Outline folder aren't left out. Files are named by book title, for example `Radial Timeline/Timetables/Book 2 Saturn & Jupiter.base`. A map from book ID to file lives in plugin data, so renaming a book never orphans its table.
- **Why one file per book.** A single shared Base can't follow the book: the built-in Table view inside it has no idea which book is selected, and the Timetable can only narrow the rows a Base's query returns, never add rows.
- **The filter names the book's `sourceFolder`.** Book Manager's rename and copy flows update that one line, and they leave the author's columns, sorts and views alone. A copied book (a submission snapshot or working draft) gets its own table the first time it's opened.
- **Creating it.** The first time the button or command runs for a book without a table, RT shows a one-line confirm and writes the file.
- **Book switching.** A table tab opened by the button or command follows `setActiveBookId`. It is notified the same way Inquiry is (`notifyBookSettingsChanged`) and re-targets the leaf to the new book's Base. A Base the author opened directly from the file explorer does not follow. If its book differs from the timeline's, the view shows a one-line notice ("This table shows Book 3; the timeline shows Book 2") with a **Switch timeline** action, because cross-highlighting needs both views on the same book.
- **Saga scope** (`timelineScope === 'saga'`) opens a saga table covering every book with `includeInSaga`, grouped by book and then by act. It lives with the book tables as `Radial Timeline/Timetables/Saga.base`.
- **No fallbacks.** If the active book has no `sourceFolder`, the button explains why and opens Book Manager. It never shows a vault-wide table instead.

## 6. Using Obsidian 1.14 Bases features (proposed 2026-10-12)

Reviewed against Obsidian 1.14.4 (Eric's install) and the `obsidian@1.14.4` API typings. The only Bases API change since 1.13.0 is `BasesConfigFileView.groupOrder` (1.14.3). The rest of 1.14's Bases work is in the app: the kanban layout, collapsible groups, the Group menu, better date rendering in group headers, and right-to-left tables. RT's `minAppVersion` can stay 1.13.0; on older versions these extras are simply absent.

- **Group menu and `groupOrder` (1.14.3).** Because the Timetable reads `groupedData` (§2), authors get Obsidian's Group menu for free: reorder acts, hide one, or **add an empty group**. Create book base writes `groupOrder` with every act from the book's act count (for example `[1, 2, 3]`) plus `null`. So an act with nothing in it yet still shows as a header to plan into, and notes without an Act gather in a "No act" group, where unplaced sketches and not-yet-promoted notes sit. To verify: that `groupedData` honors `groupOrder` for custom views as it does for the built-in ones.
- **Collapsible groups (1.14.0).** The built-in Table, Cards and List layouts can now collapse groups, so the Timetable should too: collapse Act 1 while working in Act 2. Collapsed state is view state (`config.set` or in memory), never YAML.
- **A Board view at no cost (kanban, 1.14.0–1.14.4).** Decided 2026-10-12: both the Act board and the Status board are included. Create book base adds a built-in Kanban view to each book's table file, grouped by Act. That gives a Save-the-Cat-style board of scene and sketch cards. Dragging a card to another column writes its Act (Obsidian does this), and the "+" in a column creates a note with that Act. A second board grouped by Status (Todo, Working, Complete) is equally free.
  - **Don't group a board by Subplot.** It's a list, and a column drag would replace memberships rather than follow the move-or-add contract of ring drags.
  - **New notes from a board's "+"** follow Obsidian's new-note location, not the book folder (see *Creating a sketch* above). Either point authors at **+ New sketch** in the Timetable, or verify whether a board can be scoped to create in the book folder.
- **Date rendering in group headers (1.14.3).** Nothing to do. The Timetable's own cells use RT's When formatter (§4).
- **Right-to-left tables (1.14.1).** None of RT's languages are right-to-left today. If one is added, the Timetable should mirror the built-in table's RTL behavior.
- **Base font size per device (1.14.2).** The Timetable should size its text from the same Bases font-size setting, so the author's per-device choice applies to it too.
- **Embedding (not new, but worth using).** A view of a `.base` file can be embedded in any note, so an author can put the live Timetable inside a book's outline note, under the spine. The view must size itself to its content when embedded.

## Considered and set aside: a lanes layout ("Unwrapped")

We considered a linear layout of the timeline view itself, with each ring pulled into a horizontal lane and a sideways scroll in manuscript order. It answers the same requests and has two real benefits: every scene gets the same size, and gaps in a plotline stand out. It is also the familiar "plot grid" of other writing tools.

It was set aside on 2026-10-11 for two reasons:
- **It needs a second renderer.** Polar geometry runs through the renderer (about 23 files use `Math.cos` and `Math.sin`).
- **It gives up the one-screen overview** that defines RT.

The Rings column in the Timetable delivers the rhythm benefit and the requested vertical view at a fraction of the cost. Revisit lanes only if users still ask for a horizontal layout once the table ships.

## Phases

1. **Promote to scene:** the command, file menu and bulk preview. It's the smallest piece and is useful on its own. The **one When formatter** (§4) is equally independent and can ship alongside it.
2. **Timetable and sketches:** the title bar button and command (§5), book following, data, status number cells, the Rings column (with wrapping), the sketch drawer, row context menu, the Promote button, **+ New sketch**, query counts, cross-highlighting, and Create book base.
3. **Spikes, only if wanted:**
   - **Promote in Obsidian's built-in Table view** (wanted, Eric 2026-10-12): a formula column such as `link("obsidian://radial-timeline-…")` handled by an RT protocol handler (precedent: `AI_JOBS_PROTOCOL_ACTION`), shown as the `file-up` icon if Bases allows an icon as link text. It's unverified that Bases renders these as clickable;
   - "Follow timeline filters," so the table mirrors the search panel's filter;
   - sketches on the wheel;
   - whether `groupedData` honors `groupOrder` for custom views, and whether a Kanban view's "+" can create notes in the book folder.

## Acceptance (live vault)

- **Phase 1:** in a book folder like Eric's Book 2 (51 notes, 9 visible), a bulk Promote preview lists the 42 non-scene notes. Applying it makes all of them appear on the wheel. No existing value changes, custom fields keep their places, no bodies change, and drafted scenes keep their filenames. A single promoted note's YAML matches what right-click Add scene would have produced.
- **Phase 2:**
  - The Timetable of the same book shows rows in wheel order with matching colors.
  - The Rings column shows the saved ring order. A scene in two subplots fills two squares, hovering names them, and a subplot absent for several scenes shows as a pale run.
  - Number cells match the wheel's status fills, including the author's Working pattern.
  - Changing Status from a row's context menu updates the wheel without a reload, and hovering highlights across views.
  - **+ New sketch** creates a note that appears in the table but not on the wheel or in a manuscript export. Promoting it puts it on the wheel and in the export.
  - Each book's table file opens with five views: the Timetable, the built-in Table, Not on the timeline, the Act board and the Status board. Dragging a card on the Act board changes that note's Act, and the Timetable and wheel update.
  - Typing in a sketch drawer saves to the note's body and leaves its frontmatter byte-identical. Editing the same note elsewhere while its drawer is open, with unsaved drawer text, raises a conflict notice instead of overwriting.
  - With more rings than fit on a line, the Rings grid wraps identically in every row.
- **Opening and following:** the title bar button and the command open the active book's table beside the timeline. Switching books in the timeline re-targets that tab, and saga scope opens the saga table grouped by book.
- **When formatter:** a date-only When (67.4's `2085-05-10`) shows `Thu May 10, 2085` in both the hover and the table, with no "@ Noon". A When with a clock shows `Wed Jan 3, 2085 @ 2:20PM`, and switching the plugin's language changes the month and weekday names.
- Verification follows the feature-audit playbook (`build-only`, `tsc --noEmit`, `vitest`), plus an Obsidian reload check.

## Decisions for Eric

Settled on 2026-10-11 (see the top of this doc): the Sketch name, table-only sketches, Inquiry only, the Timetable name with lanes set aside, no gating (Pro-page label only), Promote following the template setting, and the compact layout (status in the number cell, a single read-only Rings column).

Settled on 2026-10-12: one When formatter, no "@ Noon" for date-only values, sketch text in the note body, and Lucide icon Promote buttons, with built-in Table support wanted.

The title bar keeps its own format (decided 2026-10-12).

Also settled on 2026-10-12: the icons (`file-up` for Promote, `table-2` for the Timetable button), and one table per book, following the timeline. All tables, saga included, live together in `Radial Timeline/Timetables/`, with no new settings.

Decided 2026-10-12: each book's table file includes the built-in Act board and Status board (§6). Native grouping with `groupOrder` and collapsible act groups remain the proposed approach, since the boards rely on the same grouping.

The remaining unknowns are implementation spikes (phase 3).
