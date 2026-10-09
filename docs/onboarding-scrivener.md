# Import a Scrivener manuscript

1. In Scrivener, select your manuscript in the binder and choose **File → Export → Files…** as plain text, with numbered files. A raw `.scriv` project cannot be imported.
2. Choose **File → Export → Outliner Contents as CSV…** with Title, Synopsis and the columns you want to bring. Save it next to the exported folder.
3. Put both in your vault. On the Welcome screen choose **Import manuscript** (or run **Import manuscript** from the command palette) and pick the export.
4. Review, then **Import**. One screen shows everything:
   - **Book title** and **Stage**. The book is written to a new `<Title> RT` folder beside the export; the export is not changed.
   - **Outline columns**, each with sample values and where it goes. Common Scrivener names are matched for you: Themes, Storyline or Plotline → Subplot; People, Characters or Cast → Character; Location or Setting → Place; Date or Story Date → When; Point of View → POV. Anything else is kept under its own name, or you can send it to a scene field or skip it.
   - **Your timeline**: the subplot rings with their scene counts, where acts come from, and the characters and places named. Open **Show all scenes** to check order and memberships.
5. The timeline opens on your new book.

Details:

- Order comes from the outline CSV. Without one, numbered file names give the order; if numbering restarts in each folder, the folders must be numbered too.
- A cell with several values (`Grief; Sisters` or `Mara, Ines`) gives the scene each of them. A column used as a per-subplot checkbox can be set to **Subplot “<column>” for filled cells**; a scene filled in several such columns joins each subplot. Scenes with no subplot go to Main Plot.
- Acts come from a column you send to Act, otherwise from `ACT 1`, `ACT 2`… export folders, otherwise the book is split evenly into the configured number of acts.
- Word Count and Scrivener's other bookkeeping columns are not imported. Scrivener's Status column is kept as `Scrivener Status`, because Radial Timeline's Status is its own writing state.
- If the outline and the files disagree (a file missing from the outline, a document with text but no file, two documents with one title), the import stops and names the problem. Export Files and Outliner Contents again from the same selection, then choose **Check again**.
- No AI is used. Synopses come from the outline; AI summary refresh can fill gaps later if you use it.
- Closing the window by accident keeps your choices until Obsidian restarts.
