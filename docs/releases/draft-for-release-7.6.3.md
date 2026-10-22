## Radial Timeline 7.6.3

A bug-fix release.

### Fixes

- **Export presets stay with their book.** Saving a new export preset no longer changes other books' default preset, and deleting one no longer leaves them pointing at a preset that's gone.
- **A failed main-plot rename can't split ring 1.** If any scene can't be updated, the renamed scenes change back and the main plot keeps its old name. Edits you made in the meantime are kept.
- **Book folders can't overlap.** Adding a book or changing its folder refuses a folder that holds, sits inside, or matches another book's folder.
- **One placement at a time in Chronologue.** Clicking inside the **Place scene in time** dialog, such as entering a date or pressing **Cancel**, no longer starts a second placement.
- **Synopses pass their check.** Ordinary words such as "sat." or "sun." no longer reject a refreshed or imported synopsis, and generated summaries leave out scheduling details.
- **Clearer help text.** Hover help no longer appears twice on one control, and reads clearly in light themes. Spanish, French, Thai, and Vietnamese settings tabs and recovery messages read correctly.
