## Radial Timeline 7.0.0

Radial Timeline is now three product lines working together: the **Radial Timeline plugin**, the **Editorialist plugin**, and the new **Website & Community**. Release 7 is the milestone that connects them — your manuscript, your progress, and your public writing journey, linked end to end and shared only on your terms.

### The New Community

The Radial Timeline Community is live at [community.radialtimeline.com](https://community.radialtimeline.com) — a home for authors to share their writing journey, built around six major sections:

- **Feed** — a live stream of writing activity across the community: session posts, milestones, and project updates.
- **Authors** — public author profiles with writing pulse, progress, and the projects behind them.
- **Projects** — every shared manuscript with stage progress, activity, and book details.
- **Genre Tree** — browse the community's projects through a living taxonomy of genres.
- **Locales** — a world map of where the community is writing.
- **My Share** — your private control room: see exactly what you're sharing and manage it in one place.

Also shipping with the launch: the **free Pride & Prejudice Demo Vault** — a complete, fully tagged classic manuscript so you can explore every Radial Timeline mode with real material from your first minute. Sign up with your email from the plugin's Welcome screen ("Get the sample vault") or at [radialtimeline.com](https://radialtimeline.com), and the download link arrives in your inbox.

### Highlights

#### Plugin → Community connection

The plugin and the Community are dynamically linked, managed from a new **Com** (Community) settings tab. Connect with a simple two-button model, choose what to publish — books, stages, writing activity — and pause or disconnect at any time.

**Privacy first by design.** You share what you want and nothing more. Sharing is opt-in at the source, the Complete Preview shows every field the website will display before anything leaves your machine, and safety controls let you withdraw your share whenever you choose.

#### Author Progress Reports, direct to Community

APR now publishes straight to your Community profile. Send a progress report to the website from the plugin, manage campaign controls and refresh schedules from one place, and keep your public progress current without leaving your vault. Writing sessions can also **optionally post to your Community stats and feed** — a per-save toggle (with memory) decides whether a session becomes a feed post, so nothing is shared by accident.

#### Word (DOCX) export and better PDFs via Pandoc

Manuscript export now includes **Word (DOCX)** — open the Exports Panel from the **Print icon in the Radial Timeline view** and generate a standard manuscript format document (Times New Roman 12 pt, double-spaced, first-line indents, centered chapter headings, page-number running header). No LaTeX engine or font setup required — ready for agents, editors, and submission workflows.

The Pandoc PDF pipeline got a matching polish pass: restored running headers on the Standard and Contemporary Literary layouts, widow/orphan control in all bundled fiction layouts, an opt-in **print binding gutter** for duplex paperbacks (KDP/IngramSpark), and Advanced Pandoc passthrough (Pro) for authors migrating an existing LaTeX setup.

#### New Website with supplemental docs

[radialtimeline.com](https://radialtimeline.com) relaunched alongside the Community, with supplemental documentation for the plugin — highlights of settings, timeline modes, publishing, and workflows — so help is one click away.

#### Onboard an existing manuscript (Beta)

A new guided **onboarding workflow** brings a finished or in-progress manuscript into Radial Timeline. Three import lanes:

- **Scrivener exports** — outline and manuscript tree, with acts, subplots, and metadata mapped into RT.
- **Word (.docx)** — a full manuscript document, split into scenes.
- **One conglomerate file** — a whole book in a single text/Markdown/HTML file (a Project Gutenberg classic, for example), broken into scenes automatically.

Every lane works **with or without AI assistance**: an optional **local LLM** splits unmarked prose into scenes and generates grounded Character/Place summaries — entirely on your machine — or run structure-only mode with no AI at all. A checkpoint-based review flow keeps you in control of every scene before anything is written.

> **Local model requirement:** onboarding is tested and verified with **Qwen3-30B-A3B-2507 (4-bit)**. Onboarding reads and reasons over your entire manuscript, so it demands far more from a model than everyday AI features — smaller or lesser models may fail to follow the workflow or produce unreliable scene splits. A 30B-class model needs a capable machine with ample memory (verified on a Mac Studio with 64 GB unified memory).

#### Timeline Scaffold & Timeline Audit

Two companion panels for building and repairing your story's dates. **Timeline Scaffold** lays down scene dates from scratch: an express one-click path, day-based ripple with WhenSource anchors, and a review-page triage UI for the scenes that need a human decision. **Timeline Audit** keeps them healthy: bulk decisions with provenance, per-scene date history, ripple handoff, and a unified backup system so every change is reversible.

### More Improvements

- **Timeline image & data export** — new commands export the timeline itself as SVG or PNG (with fonts embedded) plus a JSON data export.
- **Session auto-tracking, refined** — redesigned tab timer disc, countdown ring in word + time mode, auto-track tab markers, and a compact popover clock.
- **Local-first AI** — AI features are now off by default for new installs; Local LLM setup is one button with automatic model selection and MLX / LM Studio support; added Claude Fable 5.
- **Redesigned main navigation** — numbered mode buttons (1–4) with the Chronologue sub-nav now live in the timeline title bar, plus a subplot ring key overlay for books with many subplots. All keyboard shortcuts remain unchanged.
- **Character and Place notes** are now first-class RT note types.
- **Your YAML stays yours** — plugin bookkeeping now lives entirely outside scene frontmatter; scene YAML belongs to the author.
- A Discord presence chip in the title bar connects you to the community server.

### Fixes

- Fixed Word export failures from missing fonts and stale Pandoc paths — Auto locate now repairs the toolchain.
- Fixed running headers being wiped on the Standard and Contemporary Literary PDF layouts.
- Fixed exported timeline and APR images missing their fonts (SVG/PNG exports now embed the fonts they use).
- Fixed stage target dates being lost during book data normalization; target dates are now stored per book.
- Fixed Chronologue placement of undated scenes — they now interleave beside their dated anchors.
- Fixed LM Studio structured-JSON requests and a Local LLM server-discovery crash.

### Screenshots

**The new website — radialtimeline.com**

<p align="center"><img src="https://raw.githubusercontent.com/EricRhysTaylor/Radial-Timeline/2f6825e8/wiki/images/website.webp" alt="The new Radial Timeline website" width="720"></p>

**A project on the Community — stage progress, feed, and genre lineage**

<p align="center"><img src="https://raw.githubusercontent.com/EricRhysTaylor/Radial-Timeline/2f6825e8/wiki/images/community-project.webp" alt="A shared project page on the Radial Timeline Community" width="720"></p>

**What you share — the Complete Preview in the Com settings tab**

<p align="center"><img src="https://raw.githubusercontent.com/EricRhysTaylor/Radial-Timeline/e7e62419/wiki/images/settings-share.webp" alt="Community settings share preview showing exactly what publishes and what stays in the vault" width="720"></p>

**Word (DOCX) in the Exports Panel**

<p align="center"><img src="https://raw.githubusercontent.com/EricRhysTaylor/Radial-Timeline/2f6825e8/wiki/images/export-word.webp" alt="Manuscript export output formats: Markdown, PDF, Word" width="720"></p>

**Timeline Scaffold**

<p align="center"><img src="https://raw.githubusercontent.com/EricRhysTaylor/Radial-Timeline/2f6825e8/wiki/images/panel-timeline-scaffold.webp" alt="Timeline Scaffold panel with anchor date and spacing patterns" width="720"></p>

**Review scaffolded dates before applying**

<p align="center"><img src="https://raw.githubusercontent.com/EricRhysTaylor/Radial-Timeline/2f6825e8/wiki/images/panel-timeline-scaffold-2.webp" alt="Review scaffolded dates with authored anchors and time-of-day cues" width="720"></p>

**Timeline Audit — shown here on the Pride & Prejudice Demo Vault**

<p align="center"><img src="https://raw.githubusercontent.com/EricRhysTaylor/Radial-Timeline/2f6825e8/wiki/images/panel-timeline-audit.webp" alt="Timeline Audit panel finding date contradictions in Pride and Prejudice" width="720"></p>

**Local AI — Qwen3-30B-A3B-2507 connected and validated**

<p align="center"><img src="https://raw.githubusercontent.com/EricRhysTaylor/Radial-Timeline/2f6825e8/wiki/images/panel-local.webp" alt="AI settings with local LLM connected and validated via LM Studio" width="720"></p>

**Manuscript onboarding — Prepare**

<p align="center"><img src="https://raw.githubusercontent.com/EricRhysTaylor/Radial-Timeline/e7e62419/wiki/images/panel-onboard-1.webp" alt="Onboarding Prepare step with local model ready and import flow detected" width="720"></p>

**Manuscript onboarding — Confirm scenes**

<p align="center"><img src="https://raw.githubusercontent.com/EricRhysTaylor/Radial-Timeline/e7e62419/wiki/images/panel-onboard-2.webp" alt="Onboarding Confirm scenes step with chapter list and AI auto-split" width="720"></p>

**The new Welcome screen — sample vault, onboarding, and website**

<p align="center"><img src="https://raw.githubusercontent.com/EricRhysTaylor/Radial-Timeline/e7e62419/wiki/images/welcome.webp" alt="Redesigned Welcome screen with Set Book Project, Onboard manuscript, sample vault, and website cards" width="720"></p>

**Redesigned main navigation — same keyboard shortcuts**

<p align="center"><img src="https://raw.githubusercontent.com/EricRhysTaylor/Radial-Timeline/63c6c68f/wiki/images/ui-nav.webp" alt="Redesigned mode navigation with numbered buttons and Chronologue sub-nav" width="600"></p>

**Subplot ring key**

<p align="center"><img src="https://raw.githubusercontent.com/EricRhysTaylor/Radial-Timeline/2f6825e8/wiki/images/subplots-key.webp" alt="Subplot ring key overlay listing subplots outer to inner" width="300"></p>
