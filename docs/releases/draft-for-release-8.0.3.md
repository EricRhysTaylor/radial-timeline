## Radial Timeline 8.0.3

Drop text onto story maps, privacy updates for shared timelines and Local AI, and fixes.

### New

- **Drop text onto a story map.** Drag a selection from any note onto a subplot lane of a story map, and Radial Timeline creates a scene there. While you drag, the map shows where it will go. The new scene is numbered between its neighbours and gets the lane's subplot and act, and its card joins the map. Drop outside the lanes to make a sketch instead. This works on maps made with Radial Timeline 8.0.2 or later; for an older map, use **Review map details** to create a tracked copy first.
- **Watch the Beat Manager how-to.** A play icon on **Settings → Core → Story beats system** opens a short video on building and fitting a beat system.

### Privacy

- **Shared timelines:** every shared line of text, including scene titles, synopses, acts, status, publish stage and the book's title, subtitle and author, now carries only the words a reader sees. A link to a note shares as its name or alias, a web link as its shown text, and an embedded picture or PDF is left out. Note folders, file names and web addresses stay in your vault.
- **Local AI:** when the Base URL points to a plain http address outside your computer and local network, the setting now shows a note that the connection is unencrypted, so you can switch to an https address or a server on your own network. Local addresses such as localhost and your home network work as before.
- **Community sharing:** if a change to which scene details you share can't be confirmed, Settings checks the website's current choice again before you can change another.

### Fixes

- **Beat Manager:** **Save changes** on a new blank system saves it to your library under its name. Before, switching to another system marked it as unsaved, and its custom hover fields went missing.
- **Community timeline sync** waits, with a message, when two scenes share a scene ID and it can't tell which is the original. Give each copy its own ID and sync again.
- **Timetable Panels** show the portrait of the character you chose. A chosen character without a portrait shows none, instead of another character's.
- **Runtime estimates** count the text between scene-break lines (`---`) again, and leave out code blocks and display math.
- **Remove from timeline** works when your Class field has a different name in your property mapping.
- **Canvas:** if a note or a book's subplot colors can't be read, the other cards keep working, and the colors are tried again.
- **Book Manager:** the active book's outline shows its top edge.
