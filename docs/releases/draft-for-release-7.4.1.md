## Radial Timeline 7.4.1

Manuscript onboarding is out of testing: bring in a Scrivener export, a Word document, or one big file without AI. Manuscript export follows Editorialist's new `%%query:` marker for author queries.

### Manuscript onboarding

- **Import an existing manuscript.** **Manuscript onboarding** is now in every build: open it from the fourth card on the Welcome screen or **Radial timeline: Manuscript onboarding** in the command palette. Bring in a Scrivener export, a Word document, or one big text, Markdown, or HTML file, then review scene boundaries, narrative order, and metadata before any note is written. Onboarding creates a separate `<Book> RT` folder and registers the book; your source stays untouched.
- **No AI needed.** **Structure only — no AI** is the default. It needs no model or API key and makes no AI requests: it uses document structure and scene markers, carries exported synopses and metadata, and leaves missing synopses for you to write. Choose **AI assisted** when you want AI scene splitting or generated summaries.
- **Find your export.** Choose a suggested export or pick its folder yourself; you don't need to set up Book Manager first. **Settings → Core** gains **Choose manuscript** and **Scan for exports**, and the scan runs on its own when no book folder is set up yet.
- **Scrivener order and metadata.** When you supply Scrivener's **Outliner Contents as CSV**, its row order sets narrative order, even where filename numbering differs; without a CSV, numbered filenames set it. Missing scene files, duplicate titles, and scene files absent from the outline stop the import with instructions: fix them in Scrivener, export again, and choose **Recheck export**. Map each exported column once, during import, to a Radial Timeline property, a custom field, or a subplot whose scenes it marks.

See [Manuscript onboarding](https://github.com/EricRhysTaylor/radial-timeline/wiki/Onboard-Existing-Manuscript) in the wiki.

### Manuscript export

- **Author queries are now `%%query:`.** Editorialist writes the questions you leave for your next reviewer as `%%query: Is this scene too slow?%%`. Manuscript export recognizes the new marker and still recognizes `%%ai: …%%` in older manuscripts. **Strip author queries** governs both, and your saved export settings carry over.
- **Who is it for?** The export panel now starts with three built-in presets: **Editor round** (Word, scene IDs, your questions as margin comments, private notes stripped), **AI review** (Markdown with IDs and questions kept), and **Readers** (clean Word or PDF). A line above the Export button reads back what the file will carry, such as "34 scenes with IDs · 3 questions as margin comments · your notes stripped", and warns when notes, queries, or scene IDs would reach the wrong reader.
- **Export presets reopen where you left off.** The panel reopens on the last preset you chose, loaded exactly as saved. Choosing a preset no longer reports that your settings differ from it, and **Reload preset** restores a preset after you change it.
- **Word manuscripts are cleaner.** Scene breaks (`---`) become a centered `#`, pages are US Letter with 1" margins, and Word no longer opens the file in Compatibility Mode. If you write with a single return between paragraphs, the new **Every line is a paragraph** option makes each line its own indented paragraph in Word and PDF.
- **Author queries become Word comments.** In a Word export with **Strip author queries** off, each query becomes a margin comment at the spot you asked it, signed with the book's author, so your editor can answer it in the comment thread instead of reading `%%query: …%%` in the text.

### Fixes

- **Prose near author queries stays in your export.** With **Strip comments** on, the default for PDF and Word, an author query followed anywhere later in the manuscript by an ordinary `%%comment%%` dropped all the prose between the two from the exported file. Exports now keep that prose. Your scene notes were never changed.
- **Dropping a scene on a subplot ring changes only its subplot.** In Narrative Mode, dragging a scene from the outer ring onto another subplot's ring also moved it in the manuscript and renamed the notes around it: with Sequence alignment, to wherever the drop landed in the ring. The scene now keeps its place, and a drop in another act moves it only as far as that act. The confirmation names the subplot the scene is leaving instead of always saying Main Plot, and a drop onto a scene in a subplot ring works too.
