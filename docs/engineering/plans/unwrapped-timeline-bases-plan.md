# Timeline table, sketches, Promote to scene, and Timeline Unwrapped

Date: 2026-10-11
Status: proposed (Eric, 2026-10-11). Design only; nothing here is built.

**Decided 2026-10-11 (Eric):**
- The pre-scene note type is called **Sketch**.
- To begin with, sketches live **only in the table**, so the timeline isn't cluttered with non-manuscript material.
- "Timeline Unwrapped" is the candidate name for the linear view. See §4 and Decisions.

## Problem

The timeline is RT's dashboard. It shows a whole book on one screen, and authors want to plan on it as well as read it. Four gaps get in the way.

1. **Notes the timeline can't see.** A note appears only when its frontmatter says `Class: Scene` (`class === 'scene'` throughout `src/`). Outlines, imports and quick placeholders often lack it. In Eric's own Book 2 folder on 2026-10-11, only 9 of 51 notes had it. Of the rest, 31 were empty title-only stubs, and 8 were drafted scenes with no `Class` line, so they were invisible on the wheel.
2. **No table.** Some authors think in tables. Obsidian Bases already gives them one, but it knows nothing about RT. It has no manuscript order, no beats, no ring colors, no status fills, and no way to turn a row into a proper scene.
3. **No pre-scene material.** While a book is being shaped, an author needs things that hold a place in the story without being manuscript: a placeholder idea, a candidate set piece, an open question. Today the only option is a real `Class: Scene` note. That note then counts in exports, numbering and word targets before the author has committed to it.
4. **No linear view.** Users have asked for the timeline "unwrapped": a YouTube comment, and a GitHub request for horizontal and vertical linear views. Their reasons: scrolling instead of zooming into thin slices, seeing more detail at once, and escaping the automatic inner-to-outer ring order.

Right-click **Add scene** already covers creating a new scene on the wheel (`src/view/interactions/SceneContextMenu.ts` → `SceneInsertService.planSceneInsertion`). This plan does not replace it.

## Principles

- **Timeline first.** The wheel stays the primary view. The table and the linear layout should feel like the same instrument, not a second app.
- **One record.** A note's frontmatter is the only copy of scene data. The timeline, the linear layout and any Base read the same properties, so editing one updates the others with nothing to sync.
- **Scene YAML belongs to the author** (`code-doctrine.md`). Nothing in this plan writes operational state into notes. View configuration lives in the `.base` file, which is an author file and is written only on request, or in plugin data.
- **Reuse, don't parallel.**
  - Numbering: `buildDecimalSceneInsertionPrefix`.
  - Template keys: `buildScenePropertyDefinitions` (base plus advanced, Settings → Core).
  - Field backfill: `insertMissingCoreFields`, `insertMissingAdvancedFields`, `reorderSceneFields` (`src/sceneProperties/sceneNormalizer.ts`).
  - Color: `getFillForScene` (`src/renderer/utils/SceneFill.ts`) and `subplotColors`.
  - Ring order: `masterSubplotOrder` from `computeCacheableValues`.
  - Editing: the scene context menu.
- **No fallbacks** (`fallback-policy.md`). When the target book is ambiguous, or Bases is disabled, the action fails loudly; it never guesses.

## 1. Promote to scene

One action that turns any note in a book folder into a proper scene, and the only way a sketch enters the manuscript.

**Where it's offered**
- A button on each non-scene row in the Timeline table (§2).
- The file menu and the command palette: **Promote to scene**.
- In bulk, on a multi-row selection in the Timeline table, or on a folder.

**What it does** (a confirm modal in the `AddSceneConfirmModal` pattern; a dry-run preview when promoting more than one note)
1. **Book.** The note must sit inside a book's `sourceFolder` (`BookProfile`). If it doesn't, offer to move it. Never infer a book.
2. **Template.** Core or Advanced. The default follows `sceneAdvancedPropertiesEnabled`, and the author can switch it in the modal.
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

**Data.** The Base's own filters choose the rows; `BasesQueryResult.data` gives the entries. RT adds what Bases can't know:
- **Order.** Default to manuscript order, the same as the wheel, with beat notes interleaved where they sit. A sort the author sets in the Base toolbar (`config.getSort()`) overrides it.
- **Groups.** Group by Act, using the timeline's act labels (`actLabelsRaw`). An author-chosen `groupBy` wins.
- **Columns.** By default, the managed keys of the scene template, core plus advanced when enabled, taken from `buildScenePropertyDefinitions`, so the table mirrors the YAML exactly. The author can add or hide columns through the normal Bases properties menu (`config.getOrder()`).

**Visuals: the same color language as the wheel**
- **Status swatch.** A left-edge bar or swatch computed by `getFillForScene`: the publish-stage color for completed scenes, the Todo or Working plaid for the scene's stage (reusing the same SVG pattern defs in a hidden inline `<svg>`), and the Due color when overdue.
- **Subplot chips,** colored by ring through the same resolver as the wheel. Multiple memberships show multiple chips.
- **Beat rows** are white, as on the wheel, and show the beat model and Purpose (read through `readBeatPurpose`).
- **Sketch rows** (§3) are ghosted: dashed border and a translucent ring tint.
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
- **Shown only in the Timeline table** (decided 2026-10-11). The wheel needs no change: it renders `class === 'scene'` only, so sketches already stay off it. They are also excluded from exports, numbering, word counts and targets, Pulse, Summary and Gossamer. Inquiry may read them as outline context; see Decisions.
- **Creating a sketch.** A **+ New sketch** button in the Timeline table calls `createFileForView(baseFileName, frontmatterProcessor)`; the API has had it since 1.10.2. The processor sets `Class: Sketch` and prefills Act and Subplot from the group or the selected row. This is the "add a row and get a timeline entry" flow. The sketch stays in the table until it is promoted.
- **Commitment.** Promote (§1) turns a sketch into a scene. That is the moment it appears on the wheel, and the deliberate moment an idea enters the manuscript.
- **Open questions** don't need a class. Editorialist's `%%query: …%%` author queries already exist, and RT handles them on export (`src/utils/authorQueryComments.ts`). The Timeline table can show a count of open queries on any scene or sketch row, so spine questions show up where they live. No new YAML is needed.
- **Later, only if wanted:** ghost cells for numbered sketches on the wheel, and **Add sketch** in the wheel's right-click menu.

## 4. Timeline Unwrapped (a linear layout of the timeline)

The circle opened into a line: a layout toggle inside the timeline view itself, not a Bases view. It answers the linear-view requests directly while keeping everything the wheel has: modes, hover, context menu, drag and colors.

- **Lanes are rings.** Each subplot ring becomes a horizontal lane, in the wheel's ring order (`masterSubplotOrder`), with the all-scenes lane on top as the outer ring is on the wheel. The ring order work in `welcome-scrivener-and-subplot-ring-drag-plan.md` (saved order, planned empty rings) carries over unchanged. That also answers the complaint about automatic inner-to-outer sorting: the author's saved order is the lane order.
- **The x-axis follows the mode.** Narrative gives manuscript order with acts as sections and beats as white markers across all lanes. Chronologue gives When on a scaled time axis. Progress gives the stage and status fills.
- **Cells** use `getFillForScene`, the same subplot colors and the same hover metadata as the wheel. Cell width is equal by default; sizing by word count is a decision.
- **Scrolling instead of zooming:** horizontal scroll and a minimap. A vertical orientation (lanes as columns, scrolling down) is an option on the same layout, which covers the "vertically linear" request.
- **Interactions** are shared: right-click gives the scene context menu (including Add scene), and dragging between lanes uses the same membership contract as dragging between rings.
- **The cost.** Polar geometry is spread through the renderer (about 23 files use `Math.cos` and `Math.sin`), so Unwrapped needs its own renderer over the same `TimelineItem` data, fills, hover and interaction handlers. It does not need a second data path.

## Phases

1. **Promote to scene:** the command, file menu and bulk preview. It's the smallest piece and is useful on its own.
2. **Timeline table and sketches:** data, visuals, row context menu, the Promote button, **+ New sketch**, query counts, cross-highlighting, and Create book base.
3. **Timeline Unwrapped:** the horizontal layout in Narrative mode first, then Chronologue, Progress and the vertical orientation.
4. **Spikes, only if wanted:**
   - action links in Obsidian's built-in Table view, through a formula such as `link("obsidian://radial-timeline-…")` handled by an RT protocol handler (precedent: `AI_JOBS_PROTOCOL_ACTION`); it's unverified that Bases renders these as clickable;
   - "Follow timeline filters," so the table mirrors the search panel's filter;
   - sketches on the wheel.

## Acceptance (live vault)

- **Phase 1:** in a book folder like Eric's Book 2 (51 notes, 9 visible), a bulk Promote preview lists the 42 non-scene notes. Applying it makes all of them appear on the wheel. No existing value changes, custom fields keep their places, no bodies change, and drafted scenes keep their filenames.
- **Phase 2:**
  - The Timeline table of the same book shows rows in wheel order with matching colors.
  - Changing Status from a row's context menu updates the wheel without a reload, and hovering highlights across views.
  - **+ New sketch** creates a note that appears in the table but not on the wheel or in a manuscript export. Promoting it puts it on the wheel and in the export.
- **Phase 3:** toggling Unwrapped on the same book shows one lane per ring in the saved ring order, with fills identical to the wheel. Dragging a cell to another lane changes its membership exactly as a ring drag would.
- Verification follows the feature-audit playbook (`build-only`, `tsc --noEmit`, `vitest`), plus an Obsidian reload check.

## Decisions for Eric

1. ~~The name of the pre-scene class~~ **Sketch** (decided 2026-10-11).
2. ~~Unnumbered sketches on the wheel~~ **Table only, to begin** (decided 2026-10-11).
3. **Promote's template default:** follow the Core/Advanced setting, or always ask?
4. **Names.** The recommendation is **Timeline Unwrapped** for the linear layout (§4), because the circle literally opens into a line, and **Timeline table** for the Bases view, which is a list rather than an unwrapping. Or use "Unwrapped" for the table instead?
5. **Should sketches feed Inquiry** as outline context? (Recommended: yes for Inquiry, no for Gossamer, Pulse and Summary.)
6. **Unwrapped details:** equal-width cells or word-count widths? Ship horizontal first and vertical second?
7. **Built-in Table support** through protocol links (phase 4), or the Timeline table only?
8. **Pro or core:** for the Timeline table and for Unwrapped, separately.
