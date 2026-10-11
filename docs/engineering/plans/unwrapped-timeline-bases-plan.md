# Unwrapped timeline: a Bases view, Promote to scene, and sketches

Date: 2026-10-11
Status: proposed (Eric, 2026-10-11). Design only; nothing here is built.

## Problem

The timeline is RT's dashboard. It shows a whole book on one screen, and authors want to plan on it as well as read it. Three gaps get in the way.

1. **Notes the timeline can't see.** A note appears only when its frontmatter says `Class: Scene` (`class === 'scene'` throughout `src/`). Outlines, imports and quick placeholders often lack it. In Eric's own Book 2 folder on 2026-10-11, only 9 of 51 notes had it. Of the rest, 31 were empty title-only stubs, and 8 were drafted scenes with no `Class` line, so they were invisible on the wheel.
2. **No table.** Users have asked to "unwrap" the timeline into a table. Obsidian Bases already gives them one, but it knows nothing about RT. It has no manuscript order, no beats, no ring colors, no status fills, and no way to turn a row into a proper scene.
3. **No pre-scene objects.** While a book is being shaped, an author needs things that occupy a place in the story without being manuscript: a placeholder idea, a candidate set piece, an open question. Today the only option is a real `Class: Scene` note. That note then counts in exports, numbering and word targets before the author has committed to it.

Right-click **Add scene** already covers creating a new scene on the wheel (`src/view/interactions/SceneContextMenu.ts` → `SceneInsertService.planSceneInsertion`). This plan does not replace it.

## Principles

- **Timeline first.** The wheel stays the primary view. Tables supplement it and should feel like the same instrument, not a second app.
- **One record.** A note's frontmatter is the only copy of scene data. The timeline and any Base read the same properties, so editing either one updates both with nothing to sync.
- **Scene YAML belongs to the author** (`code-doctrine.md`). Nothing in this plan writes operational state into notes. View configuration lives in the `.base` file, which is an author file and is written only on request, or in plugin data.
- **Reuse, don't parallel.** Numbering comes from `buildDecimalSceneInsertionPrefix`. Template keys come from `buildScenePropertyDefinitions` (base plus advanced, Settings → Core). Field backfill comes from `insertMissingCoreFields`, `insertMissingAdvancedFields` and `reorderSceneFields` (`src/sceneProperties/sceneNormalizer.ts`). Color comes from `getFillForScene` (`src/renderer/utils/SceneFill.ts`) and `subplotColors`. Row editing comes from the scene context menu.
- **No fallbacks** (`fallback-policy.md`). When the target book is ambiguous, or Bases is disabled, the action fails loudly; it never guesses.

## 1. Promote to scene

One action that turns any note in a book folder into a proper scene.

**Where it's offered**
- A button on each non-scene row in the RT Bases view (§2).
- The file menu and the command palette: **Promote to scene**.
- In bulk, on a multi-row selection in the RT Bases view, or on a folder.

**What it does** (a confirm modal in the `AddSceneConfirmModal` pattern; a dry-run preview when promoting more than one note)
1. **Book.** The note must sit inside a book's `sourceFolder` (`BookProfile`). If it doesn't, offer to move it. Never infer a book.
2. **Template.** Core or Advanced. The default follows `sceneAdvancedPropertiesEnabled`, and the author can switch it in the modal.
3. **Prefill.** Set `Class: Scene`. Keep every value the note already has. Fill missing managed keys from the template, using what the row or context provides:
   - **Subplot:** the row's existing value, or the ring the author picks, or `Main Plot`. Multiple memberships are kept.
   - **Act and When:** the row's own values, or the anchor scene's (`resolveAnchorActNumber`, `readAnchorWhen`).
   - **Due:** today, as the template already does.
   - **Scene ID:** `ensureSceneIds`.
4. **Number.** If the filename already has a numeric prefix, keep it. If not, ask "after which scene?" and use `buildDecimalSceneInsertionPrefix`, so nothing else in the manuscript is renamed. Drag reordering stays the tool for larger moves.
5. **Merge rules.** Never overwrite an existing value. Author custom fields stay attached to the managed field above them (`reorderSceneFields`). The note body is never touched.

This phase stands alone and fixes the invisible-notes gap immediately.

## 2. The Radial Timeline Bases view ("unwrapped timeline")

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
- the RT view as the default;
- a built-in Table view for spreadsheet editing;
- a **Not on the timeline** view (`class != "Scene"`, excluding beats and sketches) that lists everything Promote can fix.

The YAML audit panel can flag a Base whose columns have drifted from the template ("Refresh columns"). It never rewrites the file silently.

## 3. Sketches: pre-scene objects

A new author-facing note type for story material that has a place but isn't manuscript yet. The working name is `Class: Sketch` (see Decisions).

- **Fields.** A subset of the scene base template: Act, When, Subplot, Synopsis, Character, Place. There's nothing new to learn, and every field is one the author reads, so it passes the doctrine litmus test.
- **On the wheel.** A numbered sketch renders at its position as a ghost cell: dashed outline, translucent ring tint, no status fill. How unnumbered sketches appear is a decision (see Decisions).
- **Excluded from manuscript surfaces:** exports, scene numbering, word counts and targets, Pulse, Summary and Gossamer. Inquiry may read sketches as outline context; that's a decision too.
- **Creation.** Right-click on the wheel offers **Add sketch** next to **Add scene**, using the same insertion path and a different template. The RT Bases view offers it too.
- **Commitment.** Promote (§1) turns a sketch into a scene: `Class: Sketch` becomes `Class: Scene`, and the missing keys are merged in. Promotion is the deliberate moment an idea enters the manuscript.
- **Open questions** don't need a class. Editorialist's `%%query: …%%` author queries already exist, and RT handles them on export (`src/utils/authorQueryComments.ts`). The wheel and the table can badge any scene or sketch with its count of open queries, so spine questions show up where they live. No new YAML is needed.

## Phases

1. **Promote to scene**: the command, file menu and bulk preview. It's the smallest piece and is useful on its own.
2. **RT Bases view**: data, visuals, row context menu, the Promote button, cross-highlighting, and Create book base.
3. **Sketches**: the class, ghost rendering, Add sketch, exclusion from manuscript surfaces, and query badges.
4. **Spikes, only if wanted:**
   - action links in Obsidian's built-in Table view, through a formula such as `link("obsidian://radial-timeline-…")` handled by an RT protocol handler (precedent: `AI_JOBS_PROTOCOL_ACTION`); it's unverified that Bases renders these as clickable;
   - "Follow timeline filters," so the table mirrors the search panel's filter.

## Acceptance (live vault)

- **Phase 1:** in a book folder like Eric's Book 2 (51 notes, 9 visible), a bulk Promote preview lists the 42 non-scene notes. Applying it makes all of them appear on the wheel. No existing value changes, custom fields keep their places, no bodies change, and drafted scenes keep their filenames.
- **Phase 2:** the RT view of the same book shows rows in wheel order with matching colors. Changing Status from a row's context menu updates the wheel without a reload, and hovering highlights across views.
- **Phase 3:** a sketch added on the wheel appears ghosted in both views and is absent from a manuscript export. Promoting it adds it to the export.
- Verification follows the feature-audit playbook (`build-only`, `tsc --noEmit`, `vitest`), plus an Obsidian reload check.

## Decisions for Eric

1. **The name of the pre-scene class:** Sketch, Seed, Card or Proto? The recommendation is **Sketch**: it reads as "not yet a scene" and doesn't collide with existing RT terms.
2. **Unnumbered sketches on the wheel:** shown in a per-act tray at the act boundary, or only in the table until they're numbered?
3. **Promote's template default:** follow the Core/Advanced setting, or always ask?
4. **The view's name:** "Unwrapped timeline" or "Timeline table"?
5. **Should sketches feed Inquiry** as outline context? (Recommended: yes for Inquiry, no for Gossamer, Pulse and Summary.)
6. **Built-in Table support** through protocol links (phase 4), or the RT view only?
7. **Pro or core:** is the RT Bases view a Pro feature, as some working patterns are?
