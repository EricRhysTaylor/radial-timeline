# Manuscript Reading View

**High priority · Planned** · Obsidian plugin · November 25, 2026

Authors can draft a chapter across several scene notes and still want to read it as a chapter. Give them a live, continuous Markdown view of the book inside Obsidian that they can open during a writing session without running an export. Use the original scene notes as the source of the prose, and let readers return directly to the scene they want to revise.

## Reading and navigation

- Open **Reading View** for the current book from the timeline or Timetable. When opened from a scene, start at that scene. Render the draft in manuscript order with native Obsidian Markdown, chapter headings, and quiet scene breaks. Keep each scene addressable and provide **Open source note**.
- Keep scrolling across scenes and chapters in the full-book view. Let readers narrow the same pane to a single scene or chapter for a focused review. Keep reading scope independent of the unit used for jumps.
- Provide previous and next buttons and a contents list for scene and chapter jumps. Include act jumps where the book has meaningful act boundaries. Keep the current location visible as the reader moves.
- Use the [Community book reader](https://community.radialtimeline.com/timeline/cf9250b7-e3ea-4a6a-9de5-215706b1a292/read/1) as the navigation reference. A compact radial timeline highlights the current scene on scroll, and clicking a wedge jumps to that scene. A chapter can span several wedges.

## Chapter source and manuscript order

Offer a per-book **Chapter source** setting shared by Reading View and Publish.

- **Scene property.** The default uses the existing `Chapter` marker on the opening scene. Following scenes continue in that chapter until the next marker.
- **Folder.** The author chooses which level under the book’s manuscript folder represents chapters. Use the folder at that level for membership and its name for the heading. Chapter folders can sit directly under the manuscript folder or under an act folder.

Both modes use Radial Timeline’s existing narrative scene order, including its scene index sorting. Folder names need no index prefix, and Obsidian’s File Explorer sort has no effect on Reading View or Publish. In Folder mode, a heading appears when the ordered scenes enter a different chapter folder. For example, if scenes 01 and 02 are in **The Arrival** and scene 03 is in **The Escape**, **The Arrival** comes first.

If scene 04 belongs to **The Arrival** again, keep the order 01, 02, 03, 04. Show **The Arrival** again at scene 04 and flag the split folder so the author can adjust the scene index or folder. Use the same chapter resolution for reading and publishing so the heading boundaries agree. Scenes with no resolved chapter remain readable in order.

## Checks before shipping

- A chapter with several scene notes reads as one section, and scrolling into each scene updates the wheel and source-note link.
- Unnumbered chapter folders and an act/chapter folder hierarchy produce the same chapter sequence in Reading View and the published manuscript. Interleaved folders preserve scene order and surface the split.
- A draft without chapter markers can still be read and navigated by scene. A draft using the existing `Chapter` workflow keeps its chapter starts.
- Changes to scene prose appear in the reader without another export. Scene jumps and chapter jumps both follow manuscript order, including when the timeline is showing story chronology.

## Open questions

- Confirm how authors already use the `Chapter` property. The [publishing docs](../../../wiki/Publishing.md#the-chapter-field) describe repeated values collapsing to one heading, while the [current resolver](../../../src/utils/timelineChapters.ts) emits a marker for each scene with a value. Verify the behavior before sharing the resolver with Publish.
- Confirm whether authors who write in beats keep draft prose in separate scene notes or also expect prose from beat notes to appear in the reader.
- Consider a chapter grouping mode on the main timeline separately if authors also want to plan at chapter scale.
