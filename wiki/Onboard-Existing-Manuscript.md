Onboarding imports your draft as scene notes with frontmatter. Review scene splits and properties before creating the book folder. Your source manuscript is preserved.

Start it from the Welcome screen (**Onboard manuscript**) or the Command Palette: **Radial timeline: Onboard existing manuscript (BETA)**.

> **Beta — development/testing builds.** Onboarding is available from the Welcome screen and Command Palette in these builds. [Report issues](https://github.com/EricRhysTaylor/radial-timeline/issues).

---

## Three import lanes

Onboarding detects the right lane from what you point it at, and you can override the detection on the Prepare step.

*   **Scrivener export** — one file per scene, produced with Scrivener's **File ▸ Export ▸ Files…** (turn on "number exported files" so each filename carries its binder position) plus, optionally, **Outliner Contents as CSV** exported alongside. Scene order comes from the filename numbering, or from the CSV's row order; the CSV's Synopsis and metadata columns are carried into each scene's frontmatter. Acts, subplots, and outline metadata are mapped into Radial Timeline's schema, with Main Plot as the spine.
*   **Word document** — the whole manuscript in **one** `.docx`. Word's built-in **Heading 1–3 / Title** paragraph styles become the chapter structure, in document order, and scenes are split inside each chapter (markers and Auto-split, same as the single-file lane). Combine per-scene Word files into a single document before importing.
*   **One big file** — a whole book in a single text, Markdown, or HTML file (a Project Gutenberg classic, for example). Its internal divisions (books/chapters) become the starting structure. Convert PDF source material to one of these formats before importing.

## With or without AI

Every lane works both ways:

*   **Structure-only (no AI).** Deterministic splitting from your document's structure and scene markers. No manuscript text leaves your machine and no model is required.
*   **With a local LLM.** The model proposes scene breaks inside unmarked prose (**Auto-split with AI**), writes grounded synopses, and can generate opt-in Character and Place notes. AI requests go to your configured Local LLM endpoint, never to the selected cloud AI provider. Use a server on the same machine to keep manuscript text on-device.

> **Local model requirement:** onboarding is tested and verified with **Qwen3-Next-80B-A3B-Instruct (4-bit)**, the recommended model; the previously verified **Qwen3-30B-A3B-2507 (4-bit)** also performs, though not as strongly. Onboarding reads and reasons over your entire manuscript, which demands far more than everyday AI features — smaller or lesser models may fail to follow the workflow or produce unreliable scene splits. See [Settings → AI](Settings-AI#local-llm) for hardware notes and local server setup.

## The flow

1.  **Prepare.** Onboarding shows what it detected: import lane (with override), local model status, and the chapter/division count. Continue with AI, or without it.
2.  **Confirm scenes.** Each chapter is split into its scenes. Marker breaks split automatically; Auto-split proposes the rest, and you adjust. Set the book's **Publish Stage** here (a first draft is Zero; a finished, published book is Press).
3.  **Checkpoints.** Review scene titles, synopses, and structure in an accordion view — including any scenes flagged as needing a human decision — before anything is written to the vault.

**Scene markers:** `***`, `---`, `⁂`, a `# heading`, or a similar separator (`* * *`, `___`, `• • •`, `. . .`) on its own line in your manuscript forces a scene break at that spot. Markers are exact, survive re-runs, and the AI won't override them.

Onboarding sessions are **resumable** — if you close the panel or Obsidian mid-run, you can pick up where you left off.

## What you get

Scene notes with real frontmatter (`Act`, `Synopsis`, `Subplot`, `When`, and the rest of the [scene schema](YAML-Frontmatter)), subplot mapping with Main Plot as the spine, and optional Character and Place notes for use in the timeline. Review dates and durations for Chronologue and add beat notes for Gossamer.

Want to see the end state before onboarding your own book? Explore the [Pride & Prejudice sample vault](Sample-Vault).
