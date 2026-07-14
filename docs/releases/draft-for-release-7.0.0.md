## Radial Timeline 7.0.0

Radial Timeline is now three product lines working together: the **Radial Timeline plugin**, the **Editorialist plugin**, and the new **Website & Community**. Release 7 is the milestone that connects them — your manuscript, your progress, and your public writing journey, linked end to end and shared only on your terms.

### The New Community

The Radial Timeline Community is live at [community.radialtimeline.com](https://community.radialtimeline.com) — a home for authors to share their writing journey, built around five major sections:

- **Feed** — a live stream of writing activity across the community: session posts, milestones, and project updates.
- **Authors** — public author profiles with writing pulse, progress, and the projects behind them.
- **Projects** — every shared manuscript with stage progress, activity, and book details.
- **Genre Tree** — browse the community's projects through a living taxonomy of genres.
- **My Share** — your private control room: see exactly what you're sharing and manage it in one place.

Also shipping with the launch: the **free Pride & Prejudice Demo Vault** — a complete, fully tagged classic manuscript so you can explore every Radial Timeline mode with real material from your first minute.

### Highlights

#### Website & Community — share your writing journey

The Community is dynamically linked to the Radial Timeline plugin and managed from a new **Com** (Community) settings tab. Connect your vault, choose what to publish — books, stages, session activity — and review the complete preview of everything the website will show before anything leaves your machine.

**Privacy first by design.** You share what you want and nothing more. Sharing is opt-in at the source, every published field is visible in the Complete Preview, and safety controls let you pause or withdraw your share at any time.

#### Word (DOCX) exports in the Exports Panel

Professional manuscript export now includes **Word (DOCX)** — open the Exports Panel from the **Print icon in the Radial Timeline view** and generate a standard manuscript format document (Times New Roman 12 pt, double-spaced, first-line indents, centered chapter headings, page-number running header). No LaTeX engine or font setup required — perfect for agents, editors, and submission workflows.

#### PDF Design Wizard improvements

The PDF publishing pipeline got a full polish pass: restored running headers on the Standard and Contemporary Literary layouts, widow/orphan control in all bundled fiction layouts, an opt-in **print binding gutter** for duplex paperbacks (KDP/IngramSpark), and Advanced Pandoc passthrough (Pro) for authors migrating an existing Pandoc/LaTeX setup.

#### Session auto-tracking, refined

Writing session tracking is easier to read at a glance: a redesigned tab timer disc, a countdown ring in word + time mode, auto-track tab markers, and a compact popover clock. Sessions can now **optionally publish to your Community stats and feed** — a per-save toggle (with memory) decides whether a session becomes a feed post, so nothing is shared by accident.

### More Improvements

- **Timeline scaffold & audit tools** — a guided workflow for building and repairing scene dates: express one-click scaffolding, day-based ripple with review-page triage, per-scene date history, and bulk audit decisions with provenance.
- **Local LLM setup simplified** — one-button configuration with automatic model selection, MLX server discovery, and a status card that stays quiet when healthy.
- **Your YAML stays yours** — plugin bookkeeping now lives entirely outside scene frontmatter; scene YAML belongs to the author.
- Stage target dates are now stored per book.

### Fixes

- Fixed Word export failures from missing fonts and stale Pandoc paths — Auto locate now repairs the toolchain path.
- Fixed running headers being wiped on the Standard and Contemporary Literary PDF layouts.
- Fixed stage target dates being lost during book data normalization.
- Fixed LM Studio structured-JSON requests and a Local LLM server-discovery crash.

### Screenshots

<!-- TODO: capture, add to wiki/images/, commit, then pin URLs to that commit hash (see 6.2.6 pattern). -->

**Community Feed**

<p align="center"><img src="https://raw.githubusercontent.com/EricRhysTaylor/Radial-Timeline/COMMIT/wiki/images/release-7-0-0-community-feed-rounded.png" alt="Radial Timeline Community feed at community.radialtimeline.com" width="720"></p>

**Com settings tab — Complete Preview**

<p align="center"><img src="https://raw.githubusercontent.com/EricRhysTaylor/Radial-Timeline/COMMIT/wiki/images/release-7-0-0-settings-com-rounded.png" alt="Community settings tab with complete share preview" width="720"></p>

**Word (DOCX) export in the Exports Panel**

<p align="center"><img src="https://raw.githubusercontent.com/EricRhysTaylor/Radial-Timeline/COMMIT/wiki/images/release-7-0-0-word-export-rounded.png" alt="Manuscript export panel with Word output format" width="720"></p>

**Session auto-tracking**

<p align="center"><img src="https://raw.githubusercontent.com/EricRhysTaylor/Radial-Timeline/COMMIT/wiki/images/release-7-0-0-session-tracking-rounded.png" alt="Session timer disc and save popover with community feed toggle" width="360"></p>

**Pride & Prejudice Demo Vault**

<p align="center"><img src="https://raw.githubusercontent.com/EricRhysTaylor/Radial-Timeline/COMMIT/wiki/images/release-7-0-0-demo-vault-rounded.png" alt="Pride and Prejudice demo vault in Radial Timeline" width="720"></p>
