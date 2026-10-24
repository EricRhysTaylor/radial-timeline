Open the Obsidian Command Palette and type `Radial timeline` to filter the list:
*   **Mac**: `Cmd + P`
*   **Windows/Linux**: `Ctrl + P`

<p align="center"><img src="images/ui-commands.png" alt="Radial Timeline Commands" width="600"></p>
<p align="center"><sub>Radial Timeline Commands in the palette</sub></p>

## Command Index

These are the main command-palette entries.

1. **Open** — opens the [Radial Timeline View](Radial-Timeline-View).
2. **[Create note…](#create-note)**
3. **Open inquiry** — opens the [Inquiry View](Inquiry).
4. **[Book designer](Book-Designer)** ← standalone guide
5. **[Import manuscript](#onboard-manuscript)**
6. **[Timeline date scaffold](#timeline-order)** *(beta)*
7. **[Timeline date audit](#timeline-audit)** *(beta)*
8. **[Subplot manager](#manage-subplots)**
9. **[Summary scene refresh](#summary-refresh)**
10. **[Timeline search](#search-timeline)**
11. **[Gossamer analysis](#gossamer-analysis)**
12. **[Runtime estimator](#runtime-estimator)** *(Pro)*
13. **[Manuscript export](Manuscript-Export)** ← standalone guide
14. **[Inquiry omnibus](#inquiry-omnibus-pass)** *(in testing — not yet released)*
15. **[Gossamer score manager](#gossamer-score-manager)**
16. **[Planetary time calculator](#planetary-time-calculator)**
17. **[Author progress report (APR)](Author-Progress-Report)** ← standalone guide
18. **[Scene pulse analysis (subplot order)](#scene-pulse-analysis-subplot-order)**
19. **[Scene pulse analysis (manuscript order)](#scene-pulse-analysis-manuscript-order)**
20. **[Timeline share export](#timeline-share-export)**
21. **[Open timetable](#open-timetable)**
22. **[Promote note to scene](#promote-note-to-scene)**
23. **[Reset timetable columns to recommended](#reset-timetable-columns-to-recommended)**
24. **[Scene time assignment](Scene-Time)** ← standalone guide

## Conditional Visibility

Some commands are hidden until their required feature is enabled. Others remain visible but stop with a setup message if prerequisites are missing:

*   **Scene pulse analysis**, **Summary scene refresh**, and **Gossamer analysis** appear only when **AI LLM features** are enabled in [Settings → AI](Settings-AI).
*   **Open inquiry** stays listed and opens with AI off, so you can read saved sessions, including the demo vaults', without an API key. Running a new question needs AI turned on and a provider. See [Inquiry](Inquiry).
*   **Gossamer analysis** also needs an active beat system, story beats, and scene content. To score by hand without AI, use **[Gossamer score manager](#gossamer-score-manager)**.
*   **Runtime estimator** is a **Pro** workflow. Runtime configuration lives in [Settings → Core](Settings-Core#runtime-estimation).
*   With AI off, the **Timeline date audit** AI scan and the runtime estimator's AI mode tell you AI is off instead of running.
*   **Planetary time calculator** is visible, but it needs at least one configured planetary profile before it can produce a conversion.
*   **Inquiry omnibus** is undergoing testing and is not released yet. It does not appear in release builds.

---

<a name="create-note"></a>
## Create note…

Opens the guided Radial Timeline note selector.

<p align="center"><img src="images/panel-create-note.png" alt="Create note command panel" width="560"></p>

The selector is organized into three families:

*   **Scene** — Core scene, scene with advanced properties, screenplay scene, podcast scene.
*   **Manuscript matter** — Front matter, back matter, `BookMeta`.
*   **Story world** — Beat and Backdrop.

After you choose a subtype, the file is created in the active book folder and opened immediately. Scene creation includes built-in scaffolds: minimal properties for basic scenes, richer metadata for advanced scenes, screenplay/podcast body scaffolds plus runtime defaults for those types.

Related: [Scene Properties (Core + Advanced)](YAML-Frontmatter).

---

<a name="onboard-manuscript"></a>
## Import manuscript

Opens the guided flow for importing a Scrivener export, a Word document, or one large text file. **Structure only — no AI** is the default; AI assistance is an explicit choice.

Choose the source, check export readiness and narrative order, confirm scene boundaries and metadata mappings, then review before applying. The Welcome flow accepts a source folder without prior Book Manager setup. Imports create a separate book folder and preserve the original source.

See [Import a manuscript](Onboard-Existing-Manuscript) for Scrivener export instructions and one-time metadata mapping.

---

<a name="timeline-order"></a>
## Timeline date scaffold *(beta)*

Opens Timeline Date Scaffold, an optional tool for assigning provisional `When` dates in story order. No AI is involved. Chronologue already keeps undated scenes with their narrative neighbors, so scaffolding is not required to use it.

<p align="center"><img src="images/panel-timeline-order.png" alt="Timeline date scaffold command panel" width="560"></p>

The wizard helps you normalize `When` values in manuscript order, then review the proposed timeline before writing changes back to frontmatter. It supports scaffold-based chronology setup, anchor date and time selection, time-bucket adjustments (morning/afternoon/evening/night), ripple mode for cascading changes, needs-review filtering, and undo/redo before applying.

Use [Timeline date audit](#timeline-audit) to review chronology and continuity findings.

Related: [Chronologue Mode](Chronologue-Mode).

---

<a name="timeline-audit"></a>
## Timeline date audit *(beta)*

Opens the Timeline Date Audit panel.

<p align="center"><img src="images/panel-timeline-audit.webp" alt="Timeline date audit panel" width="560"></p>

Surfaces contradictions, invalid dates, summary/body disagreement, continuity problems, and unresolved findings. Undated scenes remain visible in their Chronologue display order and have their own **Undated** count and filter; a blank `When` alone is not a warning or an unresolved problem. The panel shows overview stats, finding filters, and finding cards with evidence and suggested actions.

You can audit a partially dated or completely undated book without scaffolding it first. Relative-time checks do not skip across undated scenes to assume a calendar interval, and a date without a clock time is not checked as though noon were authored. Optional AI can examine undated scenes, but should leave their dates unset when the text does not support one. Changes are written only when you accept and apply a suggestion.

The audit includes a deterministic pass and can optionally run a continuity pass. AI findings appear alongside deterministic findings for review. From the panel you can filter findings by issue type, inspect evidence, mark items for review, apply accepted fixes where supported, and rerun the audit after changes.

Related: [Timeline date scaffold](#timeline-order), [Chronologue Mode](Chronologue-Mode).

---

<a name="manage-subplots"></a>
## Subplot manager

Opens the subplot manager for bulk cleanup. Use it when subplot names have drifted.

<p align="center"><img src="images/panel-manage-subplots.png" alt="Subplot manager panel" width="500"></p>

Lists active subplots with scene counts and gives you bulk actions:

*   **Rename** a subplot in the active book's scene files.
*   **Remove** a subplot from the timeline.

<p align="center"><img src="images/panel-manage-subplots-rename.png" alt="Subplot manager — rename detail" width="450"></p>
<p align="center"><sub>Rename a subplot — updates the Subplot field of every scene in the active book that uses it</sub></p>

The main plot is marked with a map pin. It stays in ring 1 whatever it is called and includes any scene without a Subplot. Each book names its own main plot (**Main Plot** until you rename it): renaming it updates only the active book's scenes, the dialog says how many before anything is written, and a name another subplot already uses is refused. The main plot can't be deleted. Removing a subplot moves any scenes that only belonged to it back to the main plot.

Related: [Narrative Mode](Narrative-Mode).

---

<a name="summary-refresh"></a>
## Summary scene refresh

Regenerates scene summaries with AI.

<p align="center"><img src="images/panel-summary-refresh.png" alt="Summary scene refresh command panel" width="560"></p>

Writes:

*   **Summary** — the longer corpus-oriented summary.
*   **Synopsis** — optional, if you enable `Also update Synopsis`.

Run modes: flagged scenes, missing summaries only, missing/weak/stale, or regenerate all. You can also set target summary length, weak-summary threshold, and optional Synopsis update length.

This command is separate from scene pulse analysis: **Pulse** writes short structured editorial feedback per scene; **Summary scene refresh** writes longer summary text for corpus-level use.

Related: [AI Pulse Triplet Analysis](AI-Pulse-Analysis), [Inquiry View](Inquiry).

---

<a name="search-timeline"></a>
## Timeline search

Opens the timeline search bar.

<p align="center"><img src="images/panel-search-timeline.png" alt="Timeline search panel" width="500"></p>

Choose **Timeline fields**, **Scene body**, or both in **Search options**. Press **Enter** for text search, or enable **Local LLM assist** for concept matching with verified evidence quotes. See [Search](How-to#search) for scope, highlighting, and local AI setup.

Related: [How to → Search](How-to#search).

---

<a name="gossamer-analysis"></a>
## Gossamer analysis

Runs the built-in AI scoring workflow for the active Gossamer signal. Appears only when AI LLM features are on; to score by hand, use [Gossamer score manager](#gossamer-score-manager).

<p align="center"><img src="images/panel-gossamer-analysis.png" alt="Gossamer analysis command panel" width="560"></p>

Works against the active beat system and the active signal — Momentum, Tension, Activity, or Interiority. AI scores the supplied manuscript material independently of your visual Momentum ranges.

Related: [Gossamer Mode → AI Analysis](Gossamer-Mode#ai-analysis).

---

<a name="runtime-estimator"></a>
## Runtime estimator *(Pro)*

Opens the runtime estimation panel.

<p align="center"><img src="images/panel-runtime-estimator.png" alt="Runtime estimator panel" width="520"></p>

Used for novels, audiobooks, and screenplays. The panel works with runtime profiles and can estimate duration across different scopes and filters. Available only when **Pro** is active.

Related: [Settings → Core → Runtime estimation](Settings-Core#runtime-estimation), [Narrative Runtime view](Narrative-Mode#runtime-view).

---

<a name="inquiry-omnibus-pass"></a>
## Inquiry omnibus *(in testing — not yet released)*

Runs all enabled Inquiry questions in one batch.

> [!NOTE]
> Undergoing testing and not released yet — it does not appear in release builds of the plugin.

<p align="center"><img src="images/panel-inquiry-omnibus.png" alt="Inquiry omnibus command panel" width="560"></p>

Executes enabled questions across the Inquiry zones and returns a combined set of findings for the current corpus. Works with the active scope (Book or Saga). Depending on provider and engine path, the run may execute as a combined omnibus flow or as sequential provider calls behind the scenes.

Related: [Inquiry View](Inquiry), [Running an Inquiry](Inquiry#running-an-inquiry).

---

<a name="gossamer-score-manager"></a>
## Gossamer score manager

Opens the manual score-entry panel for the active signal.

<p align="center"><img src="images/panel-gossamer-score-manager.png" alt="Gossamer score manager panel" width="560"></p>

Supports manual score entry, score justifications, run history cleanup and normalization, and working with saved beat runs. Create beat notes for the active beat system before opening the panel.

Related: [Gossamer Mode → Manual Entry](Gossamer-Mode#manual-entry).

---

<a name="planetary-time-calculator"></a>
## Planetary time calculator

Opens the planetary conversion panel.

<p align="center"><img src="images/panel-planet-calculator.png" alt="Planetary time calculator panel" width="440"></p>

Uses the active planetary profile from [Settings → Core](Settings-Core) and lets you select a date and time, convert that Earth timestamp to local planetary time, and copy a YAML-friendly result block. The panel is designed for quick planet calendar checks while writing. Select an active planetary profile in Settings → Core before converting dates.

Related: [Planetary Calendar](Chronologue-Mode#alt-sub-mode).

---

<a name="scene-pulse-analysis-subplot-order"></a>
## Scene pulse analysis (subplot order)

Opens the subplot pulse selector first, then runs pulse analysis for a selected subplot.

<p align="center"><img src="images/panel-scene-pulse-subplot.png" alt="Scene pulse analysis subplot order command panel" width="560"></p>

The subplot selector shows flagged scenes, processable scenes, and total scenes. From there you can choose **Process flagged scenes**, **Process entire subplot**, or **Purge all pulse** for that subplot.

Related: [AI Pulse Triplet Analysis](AI-Pulse-Analysis), [Subplot manager](#manage-subplots).

---

<a name="scene-pulse-analysis-manuscript-order"></a>
## Scene pulse analysis (manuscript order)

Opens the pulse command panel for manuscript-order analysis.

<p align="center"><img src="images/panel-scene-pulse-manuscript.png" alt="Scene pulse analysis manuscript order command panel" width="560"></p>

Run modes: process open scenes, process flagged scenes, process unprocessed scenes, or reprocess all scenes.

Related: [AI Pulse Triplet Analysis](AI-Pulse-Analysis), [Summary scene refresh](#summary-refresh).

---

<a name="timeline-share-export"></a>
## Timeline share export

Writes the file you upload on your Community **My Share** page to build your Interactive Timeline. Exporting shares nothing: the file is written to `Radial Timeline/Community/` in your vault and stays there until you upload it and activate the share.

Before anything is written, a dialog lists what the file contains:

*   **Shared when you activate:** scene numbers, acts, subplot names, status, publish stage, book title, and author.
*   **Held for per-scene reveal:** scene titles, synopses, characters, POV, and story dates. They stay hidden on your public timeline until you reveal each scene from My Share.

If your subplot names could themselves reveal plot, turn on **Generic ring names** in the dialog to export them as "Subplot 1, Subplot 2…".

Related: [Settings → Community](Settings-Community).

---

## Open timetable

**Radial timeline: Open timetable** opens or focuses the Bases view for the timeline’s current book or saga. Enable the Bases core plugin first. See [Timetable](Timetable).

---

## Promote note to scene

**Radial timeline: Promote note to scene** reviews a sketch or unclassified note for conversion to a scene, preserving its text and existing properties. See [Promoting notes](Timetable#promote-a-note-to-a-scene).

---

## Reset timetable columns to recommended

**Radial timeline: Reset timetable columns to recommended** gives the active Timetable view the recommended columns for its scenes, after a confirm, and clears its saved column widths. Filters, sorts, grouping, and the file’s other views stay as they are. The same action is in the column header menu. See [Columns](Timetable#columns).
