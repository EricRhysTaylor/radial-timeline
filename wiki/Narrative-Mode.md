**Keyboard Shortcut**: `2`

Narrative Mode is your primary manuscript-order workspace. It displays all scenes from all subplots on the outer ring, organized by **act divisions** (default 3 acts, configurable in **Settings → Core → Acts**). Each act spans an equal segment of the 360° circle. This view emphasizes **Narrative time** (the order readers will experience the story). Status and progress stage overlays are hidden so the focus stays on story structure and subplot balance.

<div style="text-align: center; margin: 20px 0;">
  <img src="images/mode-narrative.jpeg" alt="Narrative Mode Timeline" style="width: 300px; max-width: 100%; border-radius: 8px;" />
</div>

## Key Features

*   **Structure**: Scenes are distributed across Act 1..Act N (based on your **Settings → Core → Acts → Act count**).
*   **Book or Saga scope**: Switch between one active book and a combined Saga view.
*   **Subplot Colors**: The outer ring segments are colored by their subplot. This lets you quickly visualize which plot threads are dominant in each section of the book.
*   **Publishing markers**: Optional outer-ring placards show the part and chapter markers you have placed on scenes.
*   **Story Beats**: Displays story beats (like Save the Cat) along the timeline, helping you pace your narrative structure.
*   **Interactive Reordering**: You can drag scenes on the outer ring to reorder them. See [Reorder Scenes](How-to#reorder-scenes) for details.
*   **Scene right-click menu**: Add a scene after the current one, set a chapter marker, change Status, change Publish Stage, or flag it for Pulse — see below.
*   **Recent moves overlay**: Narrative Mode can show a top-left list of recent committed scene and beat moves. Toggle it in [Settings → Advanced → Configuration](Settings-Advanced#configuration).

## Scene Right-Click Menu

Right-click any scene on the timeline to open a context menu that lets you add a scene or update scene frontmatter without opening the note. The current value in each group is marked with a checkmark.

<div style="text-align: center; margin: 20px 0;">
  <img src="images/menu-rightclick-chapter.png" alt="Narrative scene right-click context menu" style="width: 282px; max-width: 100%; border-radius: 8px;" />
  <div style="font-size: 0.85em; margin-top: 8px; color: #666;">Scene right-click menu — Add scene, chapter markers, Status, Publish Stage, and Pulse actions</div>
</div>

**Add scene** — inserts a new scene after the selected one, using that scene as the anchor for placement and context.

**Set chapter** — adds, edits, or clears the `Chapter:` marker on the selected scene. The modal previews current chapter containers so you can see how the marker affects the manuscript structure.

**Status** — set `Status` to **Todo**, **Working**, or **Complete**. When you mark a scene **Complete**, the `Due` date is automatically set to today, keeping the [Progress Mode](Progress-Mode) completion estimate and pace tracker accurate.

**Publish Stage** — set `Publish Stage` to **Zero**, **Author**, **House**, or **Press**. Useful for moving scenes through revision tiers without leaving the timeline.

**Flag Triplet Pulse** — sets `Pulse Update: Yes` on the scene so the next [Scene pulse analysis](Commands#scene-pulse-analysis-manuscript-order) run will reprocess it.

The timeline refreshes immediately to reflect the change.

## Book and Saga Scope

The title-bar book selector controls which manuscript the timeline shows.

*   Choose a book to inspect one Book Manager profile.
*   Choose **Saga** to combine all configured books into one multi-book Narrative timeline.
*   Saga scope is available when more than one Book Manager profile is configured.
*   Saga scope stays in Narrative Mode, because multi-book scene order is a narrative-structure view rather than a chronology or progress view.

<div style="text-align: center; margin: 20px 0;">
  <img src="images/feature-saga.png" alt="Narrative Mode saga view across multiple books" style="width: 560px; max-width: 100%; border-radius: 8px;" />
  <div style="font-size: 0.85em; margin-top: 8px; color: #666;">Saga view in Narrative Mode — multiple books combined into one manuscript-order timeline</div>
</div>

## Chapter and Part Placards

Narrative Mode can show publishing-aware placards on the outside of the scene ring:

*   **C** — a `Chapter:` field starts a chapter at that scene.
*   **P** — a `Part:` field starts a part at that scene.
*   **P/C** — a scene that opens both.

Both are author-placed markers on scene notes, so a placard means *you* marked that scene, not that the plugin inferred something. Set them from the scene right-click menu (**Set part…**, **Set chapter…**) or by editing the field directly.

Placards appear whether or not the selected PDF layout prints them — the marker is your structure, and the layout only decides what reaches the page. Hovering a **P** tells you what the current layout will do with it, including when that layout prints no Parts at all.

Turn placards on with **Settings → Core → Show part and chapter markers**.

<div style="text-align: center; margin: 20px 0;">
  <img src="images/feature-parts-chapters.png" alt="Narrative Mode chapter and part markers around the perimeter" style="width: 560px; max-width: 100%; border-radius: 8px;" />
  <div style="font-size: 0.85em; margin-top: 8px; color: #666;">Publishing markers on the perimeter — chapter starts, part boundaries, and combined Part/Chapter breaks</div>
</div>

## Dominant Subplots

When a scene belongs to multiple subplots, the outer All Scenes ring must choose one color. You control which subplot wins:

*   **Click a scene**: Sets its dominant subplot. That subplot's color is used for the scene on the outer ring, taking precedence over all others.
*   **Folded corner indicator**: Each subplot ring shows a small folded corner motif at its start. The corner has three states:
    *   **Missing** — the subplot is not assigned to this scene.
    *   **Gray** — the subplot is assigned but is not dominant.
    *   **Darker hue** of the subplot ring color — this subplot is dominant and expressed on the outer ring above all others.
