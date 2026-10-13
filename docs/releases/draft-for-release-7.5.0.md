## Radial Timeline 7.5.0

The new Timetable puts your book’s notes beside the wheel. Write sketches, promote them to scenes, move scenes between subplots, and place events in story time by dragging. Manuscript onboarding now works without AI, and publishing reaches beyond timeline books to folders and standalone Markdown documents.

### The Timetable

- **The wheel and the rows, together.** Open **Timetable** from the timeline’s title bar or **Radial timeline: Open timetable**. Scenes, beats, sketches, and other manuscript notes sit together, with status in the number cell, colored subplot squares in **Rings**, and dates, durations, and synopses alongside. Hover a row to highlight its scene on the wheel; hover the wheel to reveal the row. Click to open a note, **Shift-click** to show a scene on the timeline, or right-click for its scene menu.
- **It follows your book.** Switching books on the timeline switches a following Timetable tab. Saga scope groups the books and their acts. Each book’s `.base` file lives in `Radial Timeline/Timetables/`, ready for your own columns, filters, and sorting. The same file includes an editable **Table** and **Not on the timeline** view; Obsidian 1.14 adds **Act board** and **Status board**. Enable Obsidian’s **Bases** core plugin first.
- **Sketch where the idea belongs.** **New sketch**, or **+** beside an act, creates a note with `Class: Sketch`. Expand its drawer and write directly beside the scenes; its text stays in the note body. Sketches appear in the Timetable and stay off the wheel until you promote them. Unresolved author queries have their own marker.
- **Promote a note to a scene.** Use **Promote to scene** from a sketch or unclassified note, the file explorer, or the command palette. Review the proposed scene properties and placement. Existing text and property values stay; missing scene properties are filled from your templates.

<img src="https://raw.githubusercontent.com/EricRhysTaylor/radial-timeline/41fe233a255b27bb32aec0ae04ebcc0090884b26/wiki/images/timetable-sidebyside.webp" alt="The new Timetable beside the radial timeline, showing scene properties and subplot membership together" width="900">

See [Timetable](https://github.com/EricRhysTaylor/radial-timeline/wiki/Timetable).

### Drag scenes between subplots and dates

- **Change subplot membership by dragging.** In Narrative, Chronologue, and Progress, drag a scene from one subplot ring onto another. It leaves the subplot you grabbed and joins the destination, keeping its other memberships. **Shift-drag** adds the destination instead. The ring lights up and the pointer label previews the change. Only **Subplot** changes; narrative order, numbering, and act stay. Each change offers **Undo**. In Narrative and Chronologue, the outer **All Scenes** ring keeps its own reorder or date behavior; start subplot changes from a subplot ring. In Progress, the outer **Main Plot** ring participates too.
- **Place a scene in story time.** In regular Chronologue, drag on the outer ring and drop beside a dated scene. **Place scene in time** shows the available gap and suggested dates, or lets you enter a specific date and time. At the top of the circle, choose before the opening scene or after the closing scene. Placing writes **When** and preserves narrative order.
- **Choose what happens to undated followers.** The placement panel names attached undated scenes. Let them travel with the moved scene while their dates stay blank, or choose **Keep them where they are** to write dates at their current displayed times. Review the dates before applying.
- **Clearer drag and date displays.** Narrative and Chronologue drag arcs travel clockwise. Chronologue’s arc stays beneath the date labels; date lines and scene titles keep their space. File-explorer and tab-header scene highlighting also work reliably again.

See [Subplot dragging](https://github.com/EricRhysTaylor/radial-timeline/wiki/How-to#move-scenes-between-subplots) and [Chronologue placement](https://github.com/EricRhysTaylor/radial-timeline/wiki/Chronologue-Mode#drag-a-scene-to-change-its-date).

### Publishing for more than timeline manuscripts

- **Choose an RT book, folder, or Markdown file.** Publish essays, reports, collections of notes, and standalone documents as well as timeline books. Review a folder’s included notes and their order before export; plain sources keep existing Markdown headings and do not require scene YAML. Enter their title and author in the panel. Source notes remain unchanged.
- **Save a manuscript selection for reuse.** A saved manuscript remembers its source, title, author, included notes, and reviewed order. Update it or save another selection. Export formatting stays in your presets separately.
- **Export for the reader.** **Editor round** prepares Word with scene IDs and author queries as margin comments. **AI review** prepares Markdown with IDs and queries. **Readers** produces clean Word or PDF. The panel reads back what the file will carry and flags private notes or review material that would reach the wrong reader. It remembers the last preset; **Reload preset** restores it after changes.
- **Review actual PDF pages.** **Generate proof** renders the manuscript into a page-by-page proof workspace. Refresh after changing the manuscript or options. Proofs stay in the destination’s **Proofs** folder; final export renders the current manuscript again. Delivery review lists the files actually saved, including split outputs, for you to open and inspect.
- **Cleaner Word exports.** US Letter pages with 1-inch margins, current Word document format, centered `#` scene breaks, and **Every line is a paragraph** for drafts written with single returns. Kept `%%query:` author questions become margin comments signed with the author’s name; the older `%%ai:` marker is still recognized.
- **Export reliability.** Format switches preserve scene selections. Long PDF literal blocks wrap within the page. Part epigraphs follow authored Part markers. Cleanup keeps prose between author queries and ordinary comments, and export checks and delivery paths agree.

See [Manuscript export](https://github.com/EricRhysTaylor/radial-timeline/wiki/Manuscript-Export) and [Publishing](https://github.com/EricRhysTaylor/radial-timeline/wiki/Publishing).

### Easier manuscript onboarding

- **Import from Welcome.** Choose a Scrivener export, a Word document, or one big text, Markdown, or HTML file, then review scenes before creating notes. The import writes a separate `<Book> RT` folder and registers the book, leaving the source untouched. Book Manager refreshes after import.
- **Structure only — no AI is the default.** It uses document structure and scene markers, carries exported synopses and metadata, and makes no AI requests. Choose **AI assisted** explicitly for AI splitting or summaries.
- **Find the export and review its outline.** Pick a suggested manuscript or choose its folder directly. Scrivener’s **Outliner Contents as CSV** supplies narrative order; numbered filenames do so when no CSV is supplied. Scene files and the outline are shown separately, with reported mismatches available to review and recheck. Where offered, **Continue anyway** lets you proceed with the available material after inspecting the problems.
- **Map metadata once.** During import, map exported columns to scene properties, custom fields, or subplot membership. This does not change your ongoing property-name mappings.

See [Manuscript onboarding](https://github.com/EricRhysTaylor/radial-timeline/wiki/Onboard-Existing-Manuscript), and [Volume 10 — Quick Start](https://youtu.be/n53fYUejH44).

### AI, language, and polish

- **Local model context is yours to declare.** Configure your local model’s context window rather than working within a fixed 32k assumption. Cancelling a Local LLM run stops the active request.
- **Clearer AI processing.** Request-size estimates stay local; provider requests and cancellation paths are hardened, with clearer processing disclosures in the wiki.
- **Retired model selections move within their lane.** Retired built-in pins migrate to their designated same-lane successor, with refreshed bundled pricing and model lifecycle information.
- **German, Japanese, Korean, and Chinese completed.** More UI strings are translated, counted phrases follow each language’s grammar, and placeholder values are inserted literally.
- **Quieter, clearer details.** Timeline and Inquiry have distinct ribbon marks and tooltips, imported editorial feedback stays out of prose word counts, and act labels read into their own acts.
