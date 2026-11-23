## Radial Timeline 8.2.1

Fixes for Book from Community, Canvas subplot branches, Community sharing, imported templates and the property audit.

### Fixes

- **Book from Community, Continue:** if the download stopped and the book's folder has since been replaced by a folder of your own at the same path, Continue leaves your folder as it is and asks you to choose a new folder for the book.
- **Book from Community, a lost reply:** when Community has taken the book but its reply did not arrive, Radial Timeline keeps the book's place until Community answers, even if its folder changes, and tells you the next step.
- **Book from Community, scene IDs:** every Continue checks the book's folder for two notes with the same scene ID before it finishes the book.
- **Book from Community, Book Manager:** if a book you add in Book Manager overlaps the new book's folder before it finishes, Radial Timeline names that book and tells you what to change, then Continue completes the book. Community keeps the book until then.
- **Canvas subplot branches:** after you rename a book's folder, the branches' details follow the folder and its notes together, so they stay up to date on your other devices.
- **Keep timeline updated:** when a book's folder is missing, or Obsidian is still reading one of its notes, Settings → Community shows that updates are held and what to do next.
- **Keep timeline updated, a book disconnected on Community:** the book's entry in Settings → Community says when you disconnected it from this vault, and turning Keep timeline updated on sends this vault's book to Community as a new private book.
- **Settings → Community:** the timeline preview and its detail switches stay on screen while Radial Timeline checks the website again each minute.
- **Scenes sent to Community:** a scene that arrives held, or waiting for review, says so when you send it and in its entry in Settings, with the reason a person gave and the next step.
- **Imported templates, Check again:** a template you have given `\rtPart`, `\rtChapter` and `\rtSceneSep` now prints chapters and parts in its test PDF and in every export.
- **Property audit:** an AI Synopsis that Radial Timeline kept as written now passes the audit's length check.
- **Pop-out windows:** clicks, drags, hovers and tooltips on the timeline, Timetable, Outline, Canvas cards, Inquiry and the timeline key work in a pop-out window as they do in the main window, and writing or scrolling a scene there keeps a writing session going.
