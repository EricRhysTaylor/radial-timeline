# Onboard an Existing Manuscript (Beta)

Bring a finished or in-progress manuscript into Radial Timeline without retyping anything. Onboarding reads your draft, splits it into scene notes with proper frontmatter, and previews everything before a single file is written. Your original manuscript is never modified.

Start it from the Welcome screen (**Onboard manuscript**) or the Command Palette: **Radial timeline: Onboard existing manuscript (BETA)**.

> **Beta.** The workflow is functional and tested end-to-end, but expect rough edges. [Report issues](https://github.com/EricRhysTaylor/radial-timeline/issues) — real-world manuscripts are exactly what it needs.

---

## Three import lanes

Onboarding detects the right lane from what you point it at, and you can override the detection on the Prepare step.

*   **Scrivener export** — point it at an exported Scrivener project (the exported manuscript tree with its outline CSV alongside). Acts, subplots, and outline metadata are mapped into Radial Timeline's schema, with Main Plot as the spine.
*   **Word document** — a full manuscript in a single `.docx`, split into scenes.
*   **One big file** — a whole book in a single text, Markdown, or HTML file (a Project Gutenberg classic, for example). Its internal divisions (books/chapters) become the starting structure. PDF is not supported yet.

## With or without AI

Every lane works both ways:

*   **Structure-only (no AI).** Deterministic splitting from your document's structure and scene markers. Nothing leaves your machine and no model is required.
*   **With a local LLM.** The model proposes scene breaks inside unmarked prose (**Auto-split with AI**), writes grounded synopses, and can generate opt-in Character and Place notes. Everything runs on your machine — the manuscript is never sent to a cloud provider during onboarding.

> **Local model requirement:** onboarding is tested and verified with **Qwen3-30B-A3B-2507 (4-bit)**. It reads and reasons over your entire manuscript, which demands far more than everyday AI features — smaller or lesser models may fail to follow the workflow or produce unreliable scene splits. See [Settings → AI](Settings-AI#local-llm) for hardware notes and local server setup.

## The flow

1.  **Prepare.** Onboarding shows what it detected: import lane (with override), local model status, and the chapter/division count. Continue with AI, or without it.
2.  **Confirm scenes.** Each chapter is split into its scenes. Marker breaks split automatically; Auto-split proposes the rest, and you adjust. Set the book's **Publish Stage** here (a first draft is Zero; a finished, published book is Press).
3.  **Checkpoints.** Review scene titles, synopses, and structure in an accordion view — including any scenes flagged as needing a human decision — before anything is written to the vault.

**Scene markers:** `***`, `---`, `⁂`, a `# heading`, or a similar separator (`* * *`, `___`, `• • •`, `. . .`) on its own line in your manuscript forces a scene break at that spot. Markers are exact, survive re-runs, and the AI won't override them.

Onboarding sessions are **resumable** — if you close the modal or Obsidian mid-run, you can pick up where you left off.

## What you get

Scene notes with real frontmatter (`Act`, `Synopsis`, `Subplot`, `When`, and the rest of the [scene schema](YAML-Frontmatter)), subplot mapping with Main Plot as the spine, and optional Character and Place notes — a vault that lights up every timeline mode immediately.

Want to see the end state before onboarding your own book? Explore the [Pride & Prejudice sample vault](Sample-Vault).
