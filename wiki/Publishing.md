<div style="text-align: center; margin: 20px 0;">
  <img src="images/settings-publish.png" alt="Settings → Publish tab" style="width: 600px; max-width: 100%; border-radius: 8px;" />
  <div style="font-size: 0.85em; margin-top: 8px; color: #666;">Settings → Publish</div>
</div>

Radial Timeline turns your scene notes into a finished manuscript using **Pandoc** and **LaTeX**. You select a template that defines the look of the page — fonts, headers, chapter openers, part dividers — and the plugin assembles your scenes into that format and hands the result to Pandoc to produce a PDF.

**Pandoc-based PDF export ships with the plugin.** The Core surface exports PDFs with the bundled Core publishing layouts. Turning **Pro mode** on adds extra bundled PDF layouts and deeper publishing customization. All of it is free — Pro mode is a Settings switch, not a purchase. See [Pro](Pro).

This page covers:
- The template catalog (what's bundled and what each one looks like)
- Installing and duplicating templates
- Book Details, Book Pages, and inline LaTeX matter examples
- The `Chapter:` field — how you mark chapter breaks
- Parts and chapters — how you mark them on scenes
- Setting up **Signature** (advanced book-style structure)
- Part epigraphs, scene opener headings
- Export checks and template readiness
- Exporting

> **Prerequisites**: Pandoc installed (all Pandoc-based exports, including Word), plus LaTeX for PDF output. See below for the two-installer setup, and [Exporting a Manuscript](#exporting-a-manuscript) for the export workflow and checks.

---

## Installing Pandoc and LaTeX

Two official installers, no terminal required:

**macOS**
1. **Pandoc** — download the macOS `.pkg` installer from [pandoc.org/installing](https://pandoc.org/installing.html) and run it.
2. **LaTeX** — download **MacTeX** from [mactex.org](https://www.tug.org/mactex/) and run it. (Full MacTeX is large, ~5 GB; the ~100 MB **BasicTeX** package from the same page also works for exporting.)
3. In Obsidian: **Settings → Publish → Auto locate**. It finds both installs and fills the path for you. It also repairs a saved path that no longer exists — if you ever see "Pandoc not found at the configured path", one click here fixes it.

**Windows**
1. **Pandoc** — the Windows installer from [pandoc.org/installing](https://pandoc.org/installing.html).
2. **LaTeX** — [MiKTeX](https://miktex.org/download) (lets LaTeX fetch what it needs on first export).
3. **Settings → Publish → Auto locate**.

Word (DOCX) export needs only step 1 — Pandoc, no LaTeX.

*Alternative for terminal users:* Homebrew on macOS also works — `brew install pandoc` and `brew install --cask mactex-no-gui` — as does the standalone Pandoc binary in `~/.local/bin`. Auto locate probes all of these locations.

---

## Template Catalog

Bundled templates live in **Settings → Publish → PDF Styles**. Each row shows a status pill (**Installed** / **Not installed**), a preview card, and buttons for **Install** and **Duplicate**.

The Core surface includes the standard publishing layouts needed for Pandoc PDF export. Pro mode adds further advanced layouts and deeper publishing controls.

### Novel templates

| Template | Tier | Structure | Best for |
|---|---|---|---|
| **Basic** | Core | Standard double-spaced submission format | Sending to agents / editors |
| **Standard** | Core | Book-style with contemporary serif body, running headers, chapter openers | A finished book look with simple chapters |
| **Professional** | ✦ Pro | Literary book style with refined typography | Polished prose fiction |
| **Signature** | ✦ Pro | Full book structure — **Parts**, Chapters, act epigraphs, ornament scene breaks | Novels with act structure and multiple chapters per act |

The selected novel PDF layout also informs Narrative Mode publishing markers. Layouts that print chapters can show **C** placards on the timeline. Layouts that print Parts can show **P** placards at act boundaries.

<div style="text-align: center; margin: 20px 0;">
  <img src="images/feature-parts-chapters.png" alt="Chapter and part placards around the Narrative Mode perimeter" style="width: 560px; max-width: 100%; border-radius: 8px;" />
  <div style="font-size: 0.85em; margin-top: 8px; color: #666;">Narrative Mode perimeter markers — chapter starts, part boundaries, and combined Part/Chapter breaks</div>
</div>

PDF layouts require their intended fonts rather than substituting fallbacks. Bundled fonts are installed into `Radial Timeline/Pandoc/fonts/` when you install the PDF styles. Basic uses Arial from your operating system — it is not bundled.

| Template | Font |
|---|---|
| **Basic** | Arial (system font) |
| **Standard** | Source Serif 4 |
| **Professional** | Sorts Mill Goudy |
| **Signature** | Latin Modern Roman |

### Other formats

| Template | Tier | Format |
|---|---|---|
| **Screenplay** | ✦ Pro | Industry-standard screenplay |
| **Podcast Script** | ✦ Pro | Audio script with structured cues |

---

## Installing a Template

1. Open **Settings → Publish → PDF Styles**.
2. Find the template you want in the list. If the pill says **Not installed**, click **Install**.
3. The plugin copies the template's `.tex` file into `Radial Timeline/Pandoc/` inside your vault and installs bundled fonts into `Radial Timeline/Pandoc/fonts/`. The pill changes to **Installed**.

Only installed templates can be used for export.

## Core Surface and Pro mode Layouts

Settings → Publish is split around Core-surface and Pro mode publishing work:

*   **Core** includes Pandoc setup, output folders, Book Details, Book Pages, the **Basic** and **Standard** layouts, and Auto configure publishing.
*   **Pro mode** adds the **Professional**, **Signature**, **Screenplay**, and **Podcast Script** layouts and deeper designed publishing controls.

The export panel and **Settings → Publish** use the same template rules. If a Pro mode layout is selected while Pro mode is off, Radial Timeline exports with **Basic** instead of leaving the export blocked.

## Book Details and Matter Pages

**Auto configure publishing** is part of Core. It creates a Book Details note, optional inline LaTeX Book Pages examples, bundled PDF layout files, and required bundled fonts.

Standard Book Pages can render directly from Book Details. You do not need separate note files for title page, copyright, dedication, epigraph, acknowledgments, author note, about the author, or other works pages when the matching Book Details fields are filled in.

Use a standalone LaTeX matter note only when you want a custom page body:

```yaml
---
Class: Frontmatter
BodyMode: latex
---
```

Example body:

```latex
\begin{center}
\vspace*{0.32\textheight}
\begin{minipage}{0.72\textwidth}
\itshape This optional front matter page is rendered as raw LaTeX.

\vspace{0.8em}
\raggedleft\normalfont --- Attribution
\end{minipage}
\vfill
\end{center}
\newpage
```

Inline LaTeX examples keep their own page content and do not require Book Details values.

Auto configure publishing refreshes exact retired starter examples while preserving edited author files. If a matter note no longer matches the old bundled starter content, Radial Timeline treats it as author-owned.

## Duplicating a Template

Every bundled template has a **Duplicate** button next to Install. Duplicating copies the `.tex` into your vault under a new name (e.g., `rt_modern_classic-copy.tex`), gives it a new display name ("Signature Copy"), and leaves the original untouched.

Use Duplicate when you want to tweak a bundled template — change margins, swap a font, add a custom title page — without losing the original. The copy shows the same preview card as the bundled template and accepts edits to its `.tex` file directly in your vault.

## The `Chapter:` Field

The `Chapter:` YAML frontmatter field is how you tell the exporter "this is where a new chapter starts."

Add it to the first scene note that belongs to each chapter:

```yaml
---
Class: Scene
Chapter: The Homecoming
---
```

Key behaviors:

- **Scene notes only.** Publishing reads `Chapter:` from exported scene notes. Beat and Backdrop/context notes are not chapter anchors in the publishing pipeline.
- **First occurrence wins.** If five scenes share `Chapter: The Homecoming`, only the first one starts the chapter — the rest flow inside it.
- **Case-insensitive.** `Chapter`, `chapter`, `CHAPTER` all work.
- **Numbering is automatic.** You provide the title; the exporter supplies the number (`Chapter 1`, `Chapter 2`, …).

You do **not** need `Chapter:` on every scene. Only on the scene where a chapter begins.

You can add or clear chapter markers from the scene right-click menu in Narrative mode, or edit the `Chapter:` field directly in the scene note.

---

## The `Part:` Field

Parts work exactly like chapters: a scene note carries a `Part:` field, and that scene opens the part.

```yaml
---
Class: Scene
Part: true            # numeral only — prints "I"
---
```

```yaml
---
Class: Scene
Part: The Crossing    # numeral and title
---
```

Set `Part: true` when you want the numeral alone, which is what most books do. Give it a string when the part has a name.

Key behaviors:

- **Scene notes only**, same as `Chapter:`.
- **Numbering is automatic and sequential.** The first marked scene is Part I, the second Part II, and so on. You never type a numeral.
- **Case-insensitive.** `Part`, `part`, `PART` all work.
- **An empty `Part:` is not a marker.** Clearing a part deletes the field rather than blanking it.

You do **not** need `Part:` on every scene — only where a part begins. Scenes before the first marker simply belong to no part, which is what you want for a prologue.

**Ordering**: Part → Chapter → Scene. A scene can open both a part and a chapter.

Add or clear part markers from the scene right-click menu in Narrative mode (**Set part…**), or edit the field directly in the scene note.

> Parts are independent of Acts. `Act:` places a scene in its act zone on the timeline; it has nothing to do with publishing. A three-act book can have two parts, or five, or none.

Not every template prints Parts. Only layouts configured to do so — **Signature** among the bundled ones — emit Part divider pages. Others flow straight through and ignore your markers.

---

## Part Epigraphs

A Part page can carry a quote and an attribution. These live in the book's layout options, not in the scene note, because they are typography rather than manuscript text.

**Settings → Publish → (your layout) → Part epigraphs**

Entries pair with markers **by position**: the first entry prints on Part I, the second on Part II, and so on.

Because the pairing is positional, the two sides have to agree. The export checks report both directions:

- **Fewer epigraphs than marked parts** — some parts will print without one.
- **More epigraphs than marked parts** — the surplus will never print, because there is no part to print it on.

Both appear on the PART preview card in the Publish panel and in the export checks before you generate a PDF.

---

## Setting Up Signature

> [!NOTE]
> Signature is a **✦ Pro** layout. Selecting it with Pro mode off exports with Basic instead.

Signature is the most structured bundled template. It produces a book-style manuscript with:

- **Part openers** on their own page (with Roman numerals: I, II, III)
- **Optional act epigraphs** — a quote + attribution printed after each Part page
- **Numbered chapter openers** from your `Chapter:` fields
- **Ornament scene breaks** between scenes inside a chapter (instead of scene numbers/titles)
- **Suppressed scene headings** — scenes flow as continuous prose separated by a centered ornament

Here's the full setup, step by step.

### Step 1 — Install Signature

**Settings → Publish → PDF Styles → Signature → Install**

The template file writes to `Radial Timeline/Pandoc/rt_modern_classic.tex` in your vault.

### Step 2 — Mark your parts

Right-click the scene that opens each part in Narrative mode and choose **Set part…**, or add the field directly:

```yaml
Part: true            # numeral only
Part: The Crossing    # numeral and title
```

Numbering is automatic — the first marked scene is Part I. You do not need to mark anything if your book has no parts; Signature simply prints none.

### Step 3 — Add part epigraphs (optional)

**Settings → Publish → Signature → Part epigraphs**

Entries pair with your markers by position. If the counts disagree in either direction, the Publish panel and the export checks say so before you generate a PDF.

See [Scene Properties](YAML-Frontmatter) for the full frontmatter schema.

### Step 4 — Add `Chapter:` markers

Decide where each chapter should begin. On the first scene of each chapter, add:

```yaml
Chapter: The Gathering Storm
```

You can have many chapters per act. There's no upper limit and no naming requirement — choose titles that fit your book.

### Step 5 — (Optional) Add act epigraphs

**Settings → Publish → PDF Styles → Signature** → click the **+** button at the end of the row to expand special options → **Part epigraphs**.

For each act, fill in:
- **Quote** — the epigraph text
- **Attribution** — source line (e.g., "— Ursula K. Le Guin")

Epigraphs are **per-book** (stored against your active book profile), so different books can have different epigraphs using the same template. Leave them blank and the Part pages print without any quote.

### Step 6 — Assign Signature to the Novel format

Open the export panel (Command Palette → **Manuscript export**). In the template dropdown for Novel, choose **Signature**. The plugin remembers your last selection for next time.

### Step 7 — Export

Command Palette → **Manuscript export** → choose your options → **Export**.

The exporter:
1. Walks the timeline in narrative order.
2. Emits a **Part** divider every time a new act begins (with epigraph if you filled one in).
3. Emits a **Chapter** opener every time a new `Chapter:` value appears.
4. Emits scene prose separated by ornaments inside each chapter.
5. Hands the assembled markdown to Pandoc, which produces a PDF.

Output goes to `Radial Timeline/Export/` by default. You can change the destination in **Settings → Advanced → Configuration → Export folder** — type or pick any folder inside your vault, and the chip beside the field reveals it in Obsidian's file explorer. Because exports are written through the vault, the folder must live inside the vault; to keep exports on an external drive (for example a Google Drive folder), point a sync/symlink at your chosen Export folder, or copy the generated files out after exporting.

### Minimum viable Signature manuscript

The smallest setup that produces a valid Signature PDF:

- Signature **Installed**
- At least one scene (anywhere) with a `Chapter:` value

That is genuinely all. Parts are optional — mark a scene with `Part:` only if your book has them. Epigraphs and extra chapters are further refinements.

---

## Scene Opener Heading Options

Templates that have the **Scene opener heading options** capability let you choose how scene titles appear at the start of each scene. Available modes:

- **Scene number** — just the number (`3` or `Scene 3`)
- **Scene number + title** — `3 — Opening Beat` (default)
- **Title only** — `Opening Beat` (no number)

Find this in **Settings → Publish → PDF Styles → [template] → +** (expand) → **Scene openers**.

**Signature ignores this setting** because it doesn't print scene headings — scenes are separated by ornaments and carry no label. If you want labeled scene openers, use Basic, Standard, or Professional.

---

## Exporting a Manuscript

**Command Palette → Manuscript export**

The export panel lets you:
- Select the output format (Novel, Screenplay, Podcast Script)
- Choose the template for that format
- Select which scenes to include (all, or filtered by act/subplot)
- Choose Markdown, PDF, or Word (DOCX) output
- Review export checks for missing templates, missing fonts, template compatibility, and layout-specific warnings
- Preview the selected layout's page structure before generating a PDF

Files land in `Radial Timeline/Export/` by default, or in whatever vault folder you set under **Settings → Advanced → Configuration → Export folder**.

For the end-to-end export workflow and troubleshooting, start here and use the checks in the export panel to catch missing Pandoc, LaTeX, templates, or fonts before rendering.

---

## What Survives Export — the Content Contract

If you're migrating a manuscript that already carries Pandoc/LaTeX markup, this is the exact contract the exporter honors:

**Preserved verbatim (PDF export):**
- Inline LaTeX commands in scene text — `\newpage`, `\vspace{…}`, custom macros. Scene bodies are never LaTeX-escaped; they reach Pandoc exactly as written and render as real LaTeX.
- Raw LaTeX environments (`\begin{…}…\end{…}`), fenced code blocks, and display math (`$$…$$`) — protected even from the export-cleanup toggles, so a `%%`, `[..](..)`, or task-marker pattern *inside* them is never collaterally stripped.

**Always removed:**
- YAML blocks (`---…---` with `key: value` lines) anywhere in the compiled text — including note frontmatter. Don't put content you need inside YAML fences.
- Editorialist review blocks.

**Removed only when the matching cleanup toggle is on:** `%%comments%%`, `%%ai: queries%%`, HTML comments, links (label kept), callouts, block IDs, and (PDF/Word) task-list markers.

**Document metadata:** `title` and `author` always come from your BookMeta note. A YAML metadata block at the top of your old manuscript is *not* forwarded — use **Settings → Publish → Advanced Pandoc** (Pro mode) instead:
- **Custom Pandoc metadata** — extra `--metadata key: value` pairs for custom/imported templates (`lang`, `subtitle`, or any variable your template reads).
- **Custom LaTeX preamble** — raw LaTeX injected into the PDF preamble after the layout's own setup, so your `\usepackage`/`\newcommand` definitions win. This is the escape hatch for reproducing an existing Pandoc setup exactly.

**Word (DOCX) export** converts the same compiled Markdown via Pandoc using a bundled reference document (standard manuscript format). LaTeX commands are not rendered in DOCX output — they pass through Pandoc's raw-LaTeX handling and are dropped from the Word file, so keep LaTeX-dependent formatting on the PDF path.

---

## Troubleshooting

**Template shows "Not installed" after I clicked Install.** The `.tex` file couldn't be written — check that `Radial Timeline/Pandoc/` exists and is writable.

**Parts don't appear in my Signature export.** Parts emit where a scene carries a `Part:` field. Check that at least one exported scene has one, and that the value is not empty — an empty `Part:` is not a marker. If you are exporting a scene range, check a marked scene falls inside it.

**I set a part but no badge appears on the timeline.** Turn on **Settings → Core → Show part and chapter markers**. The markers are saved either way; that toggle only controls whether the ring displays them.

**Chapter numbering is wrong.** The exporter numbers chapters by the order `Chapter:` values appear in the timeline. If a `Chapter:` value appears out of order, renumbering will reflect that. Check narrative order via [Timeline Modes](Radial-Timeline-View#modes-at-a-glance).

**Duplicated template looks different from the original.** If you're on an older plugin build, duplicates lost their preview card due to a bug. Update to the latest build — duplicates now render with the same preview card as the original and can be edited in place.

**Epigraph fields are greyed out.** Epigraphs are per-book. Make sure you have an **active book** selected before editing them.

**Export checks say a bundled font is missing.** Click **Install fonts** or **Install all** in Settings → Publish. Bundled layouts use exact fonts; Radial Timeline does not silently substitute a different body font.
