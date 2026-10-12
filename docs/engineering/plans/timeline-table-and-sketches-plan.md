# Timeline table, sketches, and Promote to scene

Date: 2026-10-11
Status: proposed (Eric, 2026-10-11). Design only; nothing here is built.

**Decided 2026-10-11 (Eric):**
- The pre-scene note type is called **Sketch**.
- To begin with, sketches live **only in the Timeline table**, so the timeline isn't cluttered with non-manuscript material.
- Sketches feed **Inquiry** as outline context, and nothing else (no Gossamer, Pulse or Summary).
- The feature is called the **Timeline table**. Ring columns (§2) are the linear view users asked for. The separate lanes layout ("Unwrapped") was dropped; see *Considered and set aside*.
- **No gating.** Pro is free for everyone; the Timeline table and sketches are listed on the website's Pro page as Pro features for fun.
- **Promote's template** follows the Core/Advanced setting by default and shows it as a preselected toggle in the dialog. This was Claude's recommendation, since Eric was unsure; it's easy to revisit.

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
- A button on each non-scene row in the Timeline table (§2).
- The file menu and the command palette: **Promote to scene**.
- In bulk, on a multi-row selection in the Timeline table, or on a folder.

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

## 2. Timeline table (a Bases view)

Obsidian 1.10+ lets plugins register Bases view types (`Plugin.registerBasesView(viewId, { name, icon, factory, options })`; the view class extends `BasesView` and implements `onDataUpdated`). RT's minimum app version is 1.13, so this is available. If `registerBasesView` returns `false` because Bases is disabled, show a notice; don't substitute another view.

One row per scene, a page you scroll down, and columns you can rearrange. That's the Obsidian-native way to see a book in more detail than the wheel allows.

**Data.** The Base's own filters choose the rows; `BasesQueryResult.data` gives the entries. RT adds what Bases can't know:
- **Order.** Default to manuscript order, the same as the wheel, with beat notes interleaved where they sit. A sort the author sets in the Base toolbar (`config.getSort()`) overrides it.
- **Groups.** Group by Act, using the timeline's act labels (`actLabelsRaw`). An author-chosen `groupBy` wins.
- **Columns.** By default, the managed keys of the scene template, core plus advanced when enabled, taken from `buildScenePropertyDefinitions`, so the table mirrors the YAML exactly. The author can add, hide or reorder columns through the normal Bases properties menu (`config.getOrder()`).

**Ring columns: the vertical linear view.** One narrow column per subplot ring, in the wheel's ring order (`masterSubplotOrder`). Because that's the author's saved order, it also answers the complaint about automatic inner-to-outer sorting.
- **Cells.** A cell is filled with the ring's color when the scene belongs to that subplot. A scene in two subplots fills two cells.
- **Rhythm.** Read down a ring column to see that plotline's rhythm. A thread that goes quiet shows as a blank run that is easy to spot, where on the wheel it's a thin arc on an inner ring.
- **Not properties.** Ring columns are rendered by the view from `Subplot` and don't appear in the Bases properties menu. A view option (`BasesViewRegistration.options`) turns them on or off.
- **Beat rows** run across the ring columns as white dividers. **Sketch rows** show their planned memberships as hollow cells.
- **Optional editing:** clicking an empty ring cell adds that membership and clicking a filled one removes it, using the same membership actions as the context menu's *Add to subplot* and *Remove from* (see Decisions).

**Visuals: the same color language as the wheel**
- **Status swatch.** A left-edge bar or swatch computed by `getFillForScene`: the publish-stage color for completed scenes, the Todo or Working plaid for the scene's stage (reusing the same SVG pattern defs in a hidden inline `<svg>`), and the Due color when overdue.
- **Beat rows** are white, as on the wheel, and show the beat model and Purpose (read through `readBeatPurpose`).
- **Sketch rows** (§3) are ghosted: dashed border and a translucent tint.
- **Notes the timeline can't see** get a muted row and a **Promote** button (§1).

**Editing, two ways at once**
- **Right-click a row** to get the same menu as right-clicking the scene on the wheel: Add scene, Set chapter, Set part, Status, Publish Stage, and subplot move, add or remove. There's no new editing UI to build or keep in step.
- **Inline cell edits** are optional and later. Authors who want spreadsheet editing can switch the same `.base` file to Obsidian's built-in Table view, which already writes frontmatter. Both views read the same notes.

**Cross-highlighting** keeps the table and wheel feeling like one instrument. Hovering a row highlights the scene on an open timeline, and hovering a scene scrolls to and highlights its row. Clicking a row opens the note; Shift-clicking reveals the scene on the timeline. Selections are shared, so "Promote selected" works from either side.

**Create book base** (command, and a button in Book Manager). This writes a `.base` file for a book, on request only. It holds:
- a filter on the book's `sourceFolder`;
- the Timeline table as the default view;
- a built-in Table view for spreadsheet editing;
- a **Not on the timeline** view (`class != "Scene"`, excluding beats and sketches) that lists everything Promote can fix.

The YAML audit panel can flag a Base whose columns have drifted from the template ("Refresh columns"). It never rewrites the file silently.

## 3. Sketches (table only, to begin)

An author-facing note type, `Class: Sketch`, for story material that has a place but isn't manuscript yet.

- **Fields.** A subset of the scene base template: Act, When, Subplot, Synopsis, Character, Place. There's nothing new to learn, and every field is one the author reads, so it passes the doctrine litmus test.
- **Lives in the book folder** beside the scenes, so the book's Base finds it.
- **Shown only in the Timeline table** (decided 2026-10-11). The wheel needs no change: it renders `class === 'scene'` only, so sketches already stay off it. They are also excluded from exports, numbering, word counts and targets, Pulse, Summary and Gossamer.
- **Feeds Inquiry** as outline context (decided 2026-10-11), and no other AI pass.
- **Creating a sketch.** A **+ New sketch** button in the Timeline table calls `createFileForView(baseFileName, frontmatterProcessor)`; the API has had it since 1.10.2. The processor sets `Class: Sketch` and prefills Act and Subplot from the group or the selected row. This is the "add a row and get a timeline entry" flow. The sketch stays in the table until it is promoted.
- **Commitment.** Promote (§1) turns a sketch into a scene. That is the moment it appears on the wheel, and the deliberate moment an idea enters the manuscript.
- **Open questions** don't need a class. Editorialist's `%%query: …%%` author queries already exist, and RT handles them on export (`src/utils/authorQueryComments.ts`). The Timeline table can show a count of open queries on any scene or sketch row, so spine questions show up where they live. No new YAML is needed.
- **Later, only if wanted:** ghost cells for numbered sketches on the wheel, and **Add sketch** in the wheel's right-click menu.

## Considered and set aside: a lanes layout ("Unwrapped")

We considered a linear layout of the timeline view itself, with each ring pulled into a horizontal lane and a sideways scroll in manuscript order. It answers the same requests and has two real benefits: every scene gets the same size, and gaps in a plotline stand out. It is also the familiar "plot grid" of other writing tools.

It was set aside on 2026-10-11 for two reasons:
- **It needs a second renderer.** Polar geometry runs through the renderer (about 23 files use `Math.cos` and `Math.sin`).
- **It gives up the one-screen overview** that defines RT.

Ring columns in the Timeline table deliver the rhythm benefit and the requested vertical view at a fraction of the cost. Revisit lanes only if users still ask for a horizontal layout once the table ships.

## Phases

1. **Promote to scene:** the command, file menu and bulk preview. It's the smallest piece and is useful on its own.
2. **Timeline table and sketches:** data, visuals, ring columns, row context menu, the Promote button, **+ New sketch**, query counts, cross-highlighting, and Create book base.
3. **Spikes, only if wanted:**
   - action links in Obsidian's built-in Table view, through a formula such as `link("obsidian://radial-timeline-…")` handled by an RT protocol handler (precedent: `AI_JOBS_PROTOCOL_ACTION`); it's unverified that Bases renders these as clickable;
   - "Follow timeline filters," so the table mirrors the search panel's filter;
   - sketches on the wheel.

## Acceptance (live vault)

- **Phase 1:** in a book folder like Eric's Book 2 (51 notes, 9 visible), a bulk Promote preview lists the 42 non-scene notes. Applying it makes all of them appear on the wheel. No existing value changes, custom fields keep their places, no bodies change, and drafted scenes keep their filenames. A single promoted note's YAML matches what right-click Add scene would have produced.
- **Phase 2:**
  - The Timeline table of the same book shows rows in wheel order with matching colors.
  - Ring columns appear in the saved ring order. A scene in two subplots fills two cells, and a subplot absent for several scenes shows as a blank run.
  - Changing Status from a row's context menu updates the wheel without a reload, and hovering highlights across views.
  - **+ New sketch** creates a note that appears in the table but not on the wheel or in a manuscript export. Promoting it puts it on the wheel and in the export.
- Verification follows the feature-audit playbook (`build-only`, `tsc --noEmit`, `vitest`), plus an Obsidian reload check.

## Decisions for Eric

Settled on 2026-10-11 (see the top of this doc): the Sketch name, table-only sketches, Inquiry only, the Timeline table name with lanes set aside, no gating (Pro-page label only), and Promote following the template setting.

Still open:
1. **Clicking ring cells to edit membership.** Should it be on, or should ring columns be read-only, with membership changed only through the context menu?
2. **Built-in Table support** through protocol links (phase 3), or the Timeline table only?
