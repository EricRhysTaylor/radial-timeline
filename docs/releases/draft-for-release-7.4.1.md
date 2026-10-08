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
- **Author queries become Word comments.** In a Word export with **Strip author queries** off, each query becomes a margin comment at the spot you asked it, signed with the book's author, so your editor can answer it in the comment thread instead of reading `%%query: …%%` in the text.

### Fixes

- **Prose near author queries stays in your export.** With **Strip comments** on, the default for PDF and Word, an author query followed anywhere later in the manuscript by an ordinary `%%comment%%` dropped all the prose between the two from the exported file. Exports now keep that prose. Your scene notes were never changed.
