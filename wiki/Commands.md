Radial Timeline provides commands through the Obsidian Command Palette.

To open the Command Palette:
*   **Mac**: `Cmd + P`
*   **Windows/Linux**: `Ctrl + P`

Type `Radial timeline` to filter the list.

<div style="text-align: center; margin: 20px 0;">
  <img src="images/ui-commands.png" alt="Radial Timeline Commands" style="max-width: 100%;" />
  <div style="font-size: 0.85em; margin-top: 8px; color: #666;">Radial Timeline Commands in the palette</div>
</div>

## Command Index

These are the main command-palette entries.

1. **Open** — opens the [Radial Timeline View](Radial-Timeline-View).
2. **[Create note…](#create-note)**
3. **Open inquiry** — opens the [Inquiry View](Inquiry).
4. **[Book designer](Book-Designer)** ← standalone guide
5. **[Onboard manuscript](#onboard-manuscript)** *(beta)*
6. **[Timeline order](#timeline-order)** *(beta)*
7. **[Timeline audit](#timeline-audit)** *(beta)*
8. **[Manage subplots](#manage-subplots)**
9. **[Summary refresh](#summary-refresh)**
10. **[Search timeline](#search-timeline)**
11. **[Gossamer analysis](#gossamer-analysis)**
12. **[Runtime estimator](#runtime-estimator)** *(Pro)*
13. **[Manuscript export](Manuscript-Export)** ← standalone guide
14. **[Inquiry omnibus](#inquiry-omnibus-pass)** *(beta)*
15. **[Gossamer score manager](#gossamer-score-manager)**
16. **[Planetary time calculator](#planetary-time-calculator)**
17. **[Author progress report (APR)](Author-Progress-Report)** ← standalone guide
18. **[Scene pulse analysis (subplot order)](#scene-pulse-analysis-subplot-order)**
19. **[Scene pulse analysis (manuscript order)](#scene-pulse-analysis-manuscript-order)**
20. **[Prepare AI jobs…](#ai-jobs)** *(beta)*
21. **[Apply AI job answers](#ai-jobs)** *(beta)*

## Conditional Visibility

Some commands are hidden until their required feature is enabled. Others remain visible but stop with a setup message if prerequisites are missing:

*   **Scene pulse analysis** and **Summary refresh** appear only when **AI LLM features** are enabled in [Settings → AI](Settings-AI).
*   **Open inquiry** stays listed either way, but the same AI-enabled gate applies: enable AI in Settings → AI to open the view and show its ribbon icon.
*   **Gossamer analysis** is visible, but the run requires an active beat system, story beats, scene content, and usable AI settings.
*   **Runtime estimator** is a **Pro** workflow. Runtime configuration lives in [Settings → Core](Settings-Core#runtime-estimation).
*   **Planetary time calculator** is visible, but it needs at least one configured planetary profile before it can produce a conversion.
*   **Timeline order** and **Timeline audit** show a release-pending notice in public release builds and are usable in development/testing builds.
*   **Inquiry omnibus** appears only in development/testing builds.
*   **Onboard existing manuscript (BETA)** appears in development/testing builds. Choose structure-only import or Local LLM assistance.
*   **Prepare AI jobs** and **Apply AI job answers** appear in development/testing builds when **AI LLM features** are enabled. They need no API key.

---

<a name="create-note"></a>
## Create note…

Opens the guided RT note selector.

<div style="text-align: center; margin: 20px 0;">
  <img src="images/panel-create-note.png" alt="Create note command panel" style="width: 560px; max-width: 100%; border-radius: 8px;" />
</div>

The selector is organized into three families:

*   **Scene** — Core scene, scene with advanced properties, screenplay scene, podcast scene.
*   **Manuscript matter** — Front matter, back matter, `BookMeta`.
*   **Story world** — Beat and Backdrop.

After you choose a subtype, the file is created in the active book folder and opened immediately. Scene creation includes built-in scaffolds: minimal properties for basic scenes, richer metadata for advanced scenes, screenplay/podcast body scaffolds plus runtime defaults for those types.

Related: [Scene Properties (Core + Advanced)](YAML-Frontmatter).

---

<a name="onboard-manuscript"></a>
## Onboard manuscript *(beta)*

Opens the guided onboarding flow for importing an existing manuscript.

> [!NOTE]
> Currently undergoing beta testing. Available only in development/testing builds for now. Choose structure-only import or Local LLM assistance — see [Settings → AI → Local LLM](Settings-AI#local-llm) for setup and the hardware guidance in [Onboarding And Local Model Hardware](Settings-AI#onboarding-and-local-model-hardware).

Walks a book folder through a four-stage sequence — preparing and reading the source text, proposing scene splits for confirmation, generating scene profiles (characters, places, summaries) for review, and writing the accepted result to the vault. Each stage is reviewable before it commits anything.

Related: [Settings → AI → Local LLM](Settings-AI#local-llm), [Book Designer](Book-Designer).

---

<a name="timeline-order"></a>
## Timeline order *(beta)*

Opens the timeline order normalizer (Timeline Repair wizard).

> [!NOTE]
> Currently undergoing beta testing. Public release builds show this command as release-pending; development/testing builds can open the workflow.

<div style="text-align: center; margin: 20px 0;">
  <img src="images/panel-timeline-order.png" alt="Timeline order command panel" style="width: 560px; max-width: 100%; border-radius: 8px;" />
</div>

The wizard helps you normalize `When` values in manuscript order, then review the proposed timeline before writing changes back to frontmatter. It supports scaffold-based chronology setup, anchor date and time selection, time-bucket adjustments (morning/afternoon/evening/night), ripple mode for cascading changes, needs-review filtering, and undo/redo before applying.

Use [Timeline audit](#timeline-audit) to review chronology and continuity findings.

Related: [Chronologue Mode](Chronologue-Mode).

---

<a name="timeline-audit"></a>
## Timeline audit *(beta)*

Opens the timeline audit panel.

> [!NOTE]
> Currently undergoing beta testing. Public release builds show this command as release-pending; development/testing builds can open the workflow.

<div style="text-align: center; margin: 20px 0;">
  <img src="images/panel-timeline-audit.webp" alt="Timeline audit panel" style="width: 560px; max-width: 100%; border-radius: 8px;" />
</div>

Surfaces contradictions, missing `When` values, summary/body disagreement, continuity problems, and unresolved findings. The panel shows overview stats, finding filters, and finding cards with evidence and suggested actions.

The audit includes a deterministic pass and can optionally run a continuity pass. AI findings appear alongside deterministic findings for review. From the panel you can filter findings by issue type, inspect evidence, mark items for review, apply accepted fixes where supported, and rerun the audit after changes.

Related: [Timeline order](#timeline-order), [Chronologue Mode](Chronologue-Mode).

---

<a name="manage-subplots"></a>
## Manage subplots

Opens the subplot manager for bulk cleanup. Use it when subplot names have drifted.

<div style="text-align: center; margin: 20px 0;">
  <img src="images/panel-manage-subplots.png" alt="Manage subplots panel" style="width: 500px; max-width: 100%; border-radius: 8px;" />
</div>

Lists active subplots with scene counts and gives you bulk actions:

*   **Rename** a subplot across scene files.
*   **Remove** a subplot from the timeline.

<div style="text-align: center; margin: 20px 0;">
  <img src="images/panel-manage-subplots-rename.png" alt="Manage subplots — rename detail" style="width: 450px; max-width: 100%; border-radius: 8px;" />
  <div style="font-size: 0.85em; margin-top: 8px; color: #666;">Rename a subplot — automatically updates the frontmatter of every scene using it</div>
</div>

`Main Plot` is protected and cannot be renamed or deleted. Removing a subplot moves any scenes that only belonged to it back to `Main Plot`.

Related: [Narrative Mode](Narrative-Mode), [How to](How-to#manage-subplots-in-bulk).

---

<a name="summary-refresh"></a>
## Summary refresh

Regenerates scene summaries with AI.

<div style="text-align: center; margin: 20px 0;">
  <img src="images/panel-summary-refresh.png" alt="Summary refresh command panel" style="width: 560px; max-width: 100%; border-radius: 8px;" />
</div>

Writes:

*   **Summary** — the longer corpus-oriented summary.
*   **Synopsis** — optional, if you enable `Also update Synopsis`.

Run modes: flagged scenes, missing summaries only, missing/weak/stale, or regenerate all. You can also set target summary length, weak-summary threshold, and optional Synopsis update length.

This command is separate from scene pulse analysis: **Pulse** writes short structured editorial feedback per scene; **Summary refresh** writes longer summary text for corpus-level use.

An AI client you run yourself can write summaries too, within its own subscription: see [AI jobs](#ai-jobs).

Related: [AI Pulse Triplet Analysis](AI-Pulse-Analysis), [Inquiry View](Inquiry).

---

<a name="search-timeline"></a>
## Search timeline

Opens the timeline search bar.

<div style="text-align: center; margin: 20px 0;">
  <img src="images/panel-search-timeline.png" alt="Search timeline panel" style="width: 500px; max-width: 100%; border-radius: 8px;" />
</div>

Choose **Timeline fields**, **Scene body**, or both in **Search options**. Press **Enter** for text search, or enable **Local LLM assist** for concept matching with verified evidence quotes. See [Search](How-to#search) for scope, highlighting, and local AI setup.

Related: [How to → Search](How-to#search).

---

<a name="gossamer-analysis"></a>
## Gossamer analysis

Runs the built-in AI scoring workflow for the active Gossamer signal.

<div style="text-align: center; margin: 20px 0;">
  <img src="images/panel-gossamer-analysis.png" alt="Gossamer analysis command panel" style="width: 560px; max-width: 100%; border-radius: 8px;" />
</div>

Works against the active beat system and the active signal — Momentum, Tension, Activity, or Interiority. AI scores the supplied manuscript material independently of your visual Momentum ranges.

Related: [Gossamer Mode → AI Analysis](Gossamer-Mode#ai-analysis).

---

<a name="runtime-estimator"></a>
## Runtime estimator *(Pro)*

Opens the runtime estimation panel.

<div style="text-align: center; margin: 20px 0;">
  <img src="images/panel-runtime-estimator.png" alt="Runtime estimator panel" style="width: 520px; max-width: 100%; border-radius: 8px;" />
</div>

Used for novels, audiobooks, and screenplays. The panel works with runtime profiles and can estimate duration across different scopes and filters. Available only when **Pro** is active.

Related: [Settings → Core → Runtime estimation](Settings-Core#runtime-estimation), [Chronologue Runtime sub-mode](Chronologue-Mode#runtime-sub-mode).

---

<a name="inquiry-omnibus-pass"></a>
## Inquiry omnibus *(beta)*

Runs all enabled Inquiry questions in one batch.

> [!NOTE]
> Currently undergoing beta testing. Available only in development/testing builds for now.

<div style="text-align: center; margin: 20px 0;">
  <img src="images/panel-inquiry-omnibus.png" alt="Inquiry omnibus command panel" style="width: 560px; max-width: 100%; border-radius: 8px;" />
</div>

Executes enabled questions across the Inquiry zones and returns a combined set of findings for the current corpus. Works with the active scope (Book or Saga). Depending on provider and engine path, the run may execute as a combined omnibus flow or as sequential provider calls behind the scenes.

Related: [Inquiry View](Inquiry), [Running an Inquiry](Inquiry#running-an-inquiry).

---

<a name="gossamer-score-manager"></a>
## Gossamer score manager

Opens the manual score-entry panel for the active signal.

<div style="text-align: center; margin: 20px 0;">
  <img src="images/panel-gossamer-score-manager.png" alt="Gossamer score manager panel" style="width: 560px; max-width: 100%; border-radius: 8px;" />
</div>

Supports manual score entry, score justifications, run history cleanup and normalization, and working with saved beat runs. Create beat notes for the active beat system before opening the panel.

Related: [Gossamer Mode → Manual Entry](Gossamer-Mode#manual-entry).

---

<a name="planetary-time-calculator"></a>
## Planetary time calculator

Opens the planetary conversion panel.

<div style="text-align: center; margin: 20px 0;">
  <img src="images/panel-planet-calculator.png" alt="Planetary time calculator panel" style="width: 440px; max-width: 100%; border-radius: 8px;" />
</div>

Uses the active planetary profile from [Settings → Core](Settings-Core) and lets you select a date and time, convert that Earth timestamp to local planetary time, and copy a YAML-friendly result block. The refreshed panel is designed for quick Alien Calendar checks while writing. Select an active planetary profile in Settings → Core before converting dates.

Related: [Planetary Calendar](Chronologue-Mode#alt-sub-mode).

---

<a name="scene-pulse-analysis-subplot-order"></a>
## Scene pulse analysis (subplot order)

Opens the subplot pulse selector first, then runs pulse analysis for a selected subplot.

<div style="text-align: center; margin: 20px 0;">
  <img src="images/panel-scene-pulse-subplot.png" alt="Scene pulse analysis subplot order command panel" style="width: 560px; max-width: 100%; border-radius: 8px;" />
</div>

The subplot selector shows flagged scenes, processable scenes, and total scenes. From there you can choose **Process flagged scenes**, **Process entire subplot**, or **Purge all pulse** for that subplot.

Related: [AI Pulse Triplet Analysis](AI-Pulse-Analysis), [Manage subplots](#manage-subplots).

---

<a name="scene-pulse-analysis-manuscript-order"></a>
## Scene pulse analysis (manuscript order)

Opens the pulse command panel for manuscript-order analysis.

<div style="text-align: center; margin: 20px 0;">
  <img src="images/panel-scene-pulse-manuscript.png" alt="Scene pulse analysis manuscript order command panel" style="width: 560px; max-width: 100%; border-radius: 8px;" />
</div>

Run modes: process open scenes, process flagged scenes, process unprocessed scenes, or reprocess all scenes.

Related: [AI Pulse Triplet Analysis](AI-Pulse-Analysis), [Summary refresh](#summary-refresh).

---

<a name="ai-jobs"></a>
## AI jobs *(beta)*

**Prepare AI jobs…** hands a book's AI work to an AI client you run yourself, such as Codex or Claude Code, so it runs within your ChatGPT or Claude subscription instead of API billing. Each job carries the prompt the built-in run sends, and each answer is checked and written by the built-in run's own code.

| Feature | Jobs | Choices |
| --- | --- | --- |
| Scene summaries | One per scene | Flagged `Summary Update: Yes`, without a Summary, or all |
| Pulse triplet analysis | One per scene, with the scenes before and after it | Flagged `Pulse Update: Yes`, not yet analyzed, or all |
| Gossamer scoring | One per signal, each carrying the whole manuscript | One signal or all four |
| Inquiry | One per enabled question, over Inquiry's current scope and target scenes | Questions without a current briefing, or all |

1. Make the book active. For Inquiry, set its scope and target scenes too.
2. Run **Prepare AI jobs…**, choose what to prepare, and click **Prepare**. Jobs go to `Radial Timeline/AI Jobs/Pending`.
3. Ask your AI client to work through the jobs in `Radial Timeline/AI Jobs`. The `AGENTS.md` and `CLAUDE.md` files there tell it how.
4. Each answer is checked and applied as soon as the client writes it while Obsidian is open, or the next time Obsidian opens. **Apply AI job answers** runs the check on demand.

**Order.** Inquiry can read scene summaries. While Summary jobs for the book are pending, its Inquiry jobs wait (listed in `Waiting.json`) and are written once the last Summary answer is applied, so the client never answers a question against summaries that are about to change. The client finds them when it looks in `Pending` again.

**Who wrote it.** Accepted answers are written exactly as a built-in run writes them, credited to your AI client as it names itself. For example, `Summary Update: <date> by Claude app · Opus 5.5` (or `by local agent` if it gives no name), a Gossamer run labelled `Codex app · GPT-6 Sol`, or an Inquiry briefing whose model is `Claude app · Opus 5.5`. Built-in runs name the model that answered, for example `by Claude Opus 5.5 API` or `by Local model qwen3:80b`.

**Checks.** An answer that fails the built-in run's checks goes back to the client with the problems noted on the job. If what a job is about changes after it was written, the job is rebuilt from the new text and the earlier answer is discarded. That means the scene for a Summary, the scene or a neighbor for Pulse, and any scene for Gossamer and Inquiry. With `Also update Synopsis` on, applying a Summary creates the Synopsis job next. Inquiry jobs are answered in one pass, never multi-pass. An Inquiry answer none of whose findings cites a scene of the corpus is sent back. A Gossamer or Inquiry answer for another book or scope waits until that book or scope is active again.

### Letting the client prepare a book itself

Your AI client can prepare jobs itself by opening a request link, so it can prepare a book, answer every job and move on to the next book without you:

`obsidian://radial-timeline-ai-jobs?vault=<vault name>&book=<book title>&prepare=all&scope=missing`

*   `prepare`: `all`, or any of `summary`, `pulse`, `gossamer`, `inquiry`, separated by commas.
*   `scope`: `missing` (the default), `flagged` or `all`. Inquiry has no flag, so for Inquiry `flagged` means `missing`.
*   `signals`: Gossamer signals separated by commas (`momentum`, `tension`, `activity`, `interiority`). All four when left out.
*   `book`: a book's title, id or source folder from Book Manager. It becomes the active book. Leave it out to use the active book.

A link Radial Timeline cannot read is refused with a notice, never guessed at. On a Mac the client opens a link with `open "<link>"`.

For example, to prep three demo novels, tell Claude Code: "For each of Pride and Prejudice, Frankenstein and Dracula: open `obsidian://radial-timeline-ai-jobs?vault=Demo&book=<title>&prepare=all`, then work through every job in `Radial Timeline/AI Jobs`, including those that appear after the summaries are applied, before moving to the next book."

Related: [Summary refresh](#summary-refresh), [Gossamer analysis](#gossamer-analysis), [Inquiry View](Inquiry), [AI Pulse Triplet Analysis](AI-Pulse-Analysis).
