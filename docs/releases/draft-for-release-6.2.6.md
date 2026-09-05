## Radial Timeline 6.2.6

This release sharpens three places authors feel every day: Inquiry's minimap, session timing, and AI model setup. It also includes smaller workflow polish for publishing, scene insertion, manuscript export, and Progress Mode docs.

### Highlights

#### Minimap page icons animate during Inquiry runs

The Inquiry minimap now shows activity on the tiny page/file icons themselves while an API run is in progress. The animation stays on the minimap, skips empty/non-page glyphs, and makes long runs easier to read without pulling attention away from the briefing surface.

#### Auto mode timing is steadier

Auto-track now governs author-started writing sessions without silently giving up or auto-saving. Sessions keep running until you explicitly save them, away time is banked separately, and app switching no longer inflates active writing time.

The save popover also breaks down time and words by scene, so a session that moved across several notes is easier to review before you save it.

#### AI model support is leaner and more current

The supported model catalog has been simplified around the current frontier, economy, Gemini, and local lanes. Legacy GPT entries were removed, newer model lanes were promoted, model aliases were refreshed, and pricing/cache estimates were tightened so Settings -> AI and Inquiry cost previews are easier to trust.

### More Improvements

- Added a Publish button beside the Complete dropdown in Social settings for Author Progress Report workflows.
- Added the Bonus Vaults / Website Exclusives card grid in the Pro tab.
- Preserved `%%ai: ...%%` author-query markers in manuscript export so Editorialist can receive directed author questions from exported scenes.
- Kept the Add Scene confirmation panel open with live progress while insert/rename work is still running.
- Cleaned up Narrative reorder context so it no longer includes misleading subplot data.
- Tightened Publish font validation so exact Arial is required when the system sans contract asks for Arial.
- Refreshed Progress Mode wiki language and screenshots around Status and Progress Stage behavior.

### Fixes

- Gemini cache-storage costs now appear in Inquiry run cost breakdowns.
- Older Obsidian versions handle destructive settings buttons more reliably.
- Inquiry settings render in the expected order before Core sections.
- Token-count failure text no longer leaks a stray timestamp fragment into the popover.

### Screenshots

**Inquiry minimap page icons**

<p align="center"><img src="https://raw.githubusercontent.com/EricRhysTaylor/Radial-Timeline/0c3a9b05/wiki/images/release-6-2-6-minimap-icons-rounded.png" alt="Inquiry minimap page icons with rounded screenshot frame" width="137"></p>

**Auto-track session controls**

<p align="center"><img src="https://raw.githubusercontent.com/EricRhysTaylor/Radial-Timeline/0c3a9b05/wiki/images/release-6-2-6-session-start-rounded.png" alt="Radial Timeline auto-track session controls" width="360"></p>

**Session save breakdown**

<p align="center"><img src="https://raw.githubusercontent.com/EricRhysTaylor/Radial-Timeline/0c3a9b05/wiki/images/release-6-2-6-session-active-rounded.png" alt="Session save popover with scene-level timing and word breakdown" width="360"></p>

**Settings AI model support**

<p align="center"><img src="https://raw.githubusercontent.com/EricRhysTaylor/Radial-Timeline/0c3a9b05/wiki/images/release-6-2-6-settings-ai-rounded.png" alt="Settings AI model support with rounded screenshot frame" width="720"></p>
