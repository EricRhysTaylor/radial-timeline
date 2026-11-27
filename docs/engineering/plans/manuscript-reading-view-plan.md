# Writing Studio for Obsidian

**High priority · In progress** · Obsidian plugin · November 25, 2026

> **Stage 1 built (November 26, 2026), not released.** Reading View in `src/writingStudio/`: the three-column studio with the compact wheel, contents and scene details; the narrow-pane strip; continuous Markdown from the scene notes, re-rendered in place on edit; whole book, chapter or scene scope; scene and chapter stepping; act jumps; **Open source note**. It opens from the **Writing Studio open** command and from **Read in Writing Studio** on a scene's right-click menu. Chapters use the scene property only, with a repeated title continuing its chapter as Publish documents it. Not yet built: Timetable Outline chapter headings and **Read chapter**, the per-book **Chapter source** setting and Folder mode, and opening from Timetable.

Authors can draft a chapter across several scene notes and still want to read it as a chapter. Give them a live, continuous Markdown view of the book inside Obsidian that they can open during a writing session without running an export. Use the original scene notes as the source of the prose, and let readers return directly to the scene they want to revise.

## Studio layout

Use the Community Writing Studio as the layout reference for a dedicated book workspace in the plugin. The [Community book reader](https://community.radialtimeline.com/timeline/cf9250b7-e3ea-4a6a-9de5-215706b1a292/read/1) shows how to keep the timeline, prose, and scene context in view together.

- **Left rail.** Keep the compact radial timeline and contents visible beside the manuscript. Highlight the current scene as the author scrolls. Clicking a wedge or contents entry jumps to that location in the same manuscript.
- **Center.** Give the continuous Markdown manuscript the main reading column. Put the current location and previous/next controls by the reading header.
- **Right rail.** Show the active scene’s details and an **Open source note** action. The details and wheel follow the same scene as the manuscript scrolls.
- **Narrow panes.** Collapse the navigator into a strip above the manuscript and let the author expand it on demand. Fold the scene details away so the prose has room.

Use Obsidian’s theme and workspace conventions. **Reading View** is the first workflow in the studio, with editing available through the source note.

## Reading and navigation

- Open **Reading View** for the current book from the timeline or Timetable. When opened from a scene, start at that scene. Render the draft in manuscript order with native Obsidian Markdown, chapter headings, and quiet scene breaks. Give each scene its own anchor.
- Keep scrolling across scenes and chapters in the full-book view. Let readers narrow the same pane to a single scene or chapter for a focused review. Keep reading scope independent of the unit used for jumps.
- Step by scene or chapter with the previous and next buttons. Include act jumps where the book has meaningful act boundaries. A chapter can span several wedges.

## Chapters in Timetable Outline

- Add a collapsible heading above each chapter’s scene rows in **Timetable → Outline**. Keep the act headings and manuscript scene order. Scenes without a resolved chapter appear in their usual act and position.
- Put **Read chapter** on each heading. It opens the current book in Writing Studio at the start of that chapter.

## Chapter source and manuscript order

Use a per-book **Chapter source** setting to resolve the same headings and scene ranges in Timetable Outline, Reading View, and Publish.

- **Scene property.** The default uses the existing `Chapter` marker on the opening scene. Following scenes continue in that chapter until the next marker.
- **Folder.** The author chooses which level under the book’s manuscript folder represents chapters. Use the folder at that level for membership and its name for the heading. Chapter folders can sit directly under the manuscript folder or under an act folder.

Both modes use Radial Timeline’s existing narrative scene order, including its scene index sorting. Folder names need no index prefix, and Obsidian’s File Explorer sort has no effect on Reading View or Publish. In Folder mode, a heading appears when the ordered scenes enter a different chapter folder. For example, if scenes 01 and 02 are in **The Arrival** and scene 03 is in **The Escape**, **The Arrival** comes first.

If scene 04 belongs to **The Arrival** again, keep the order 01, 02, 03, 04. Show **The Arrival** again at scene 04 and flag the split folder so the author can adjust the scene index or folder. Scenes with no resolved chapter remain readable in order.

## Checks before shipping

- In a wide pane, the navigator, prose, and scene details are visible together. In a narrow pane, the prose has the full reading width and the navigation remains available.
- A chapter with several scene notes reads as one section. Scrolling into each scene updates the wheel, scene details, and source-note link, while choosing a scene in the navigator scrolls to its prose.
- In Timetable Outline, a chapter heading expands and collapses its scene rows, and **Read chapter** jumps to its opening scene in Writing Studio.
- Unnumbered chapter folders and an act/chapter folder hierarchy produce the same chapter sequence in Timetable Outline, Reading View, and the published manuscript. Interleaved folders preserve scene order and surface the split.
- A draft without chapter markers can still be read and navigated by scene. A draft using the existing `Chapter` workflow keeps its chapter starts.
- Changes to scene prose appear in the reader without another export. Scene jumps and chapter jumps both follow manuscript order, including when the timeline is showing story chronology.

## Open questions

- Confirm how authors already use the `Chapter` property. The [publishing docs](../../../wiki/Publishing.md#the-chapter-field) describe repeated values collapsing to one heading, while the [current resolver](../../../src/utils/timelineChapters.ts) emits a marker for each scene with a value. Verify the behavior before sharing the resolver with Publish.
- Confirm whether authors who write in beats keep draft prose in separate scene notes or also expect prose from beat notes to appear in the reader.
- Consider a chapter grouping mode on the main timeline separately if authors also want to plan at chapter scale.
