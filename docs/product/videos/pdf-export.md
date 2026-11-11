# Video script: Design a PDF style and export your manuscript

**Key:** `pdf-export` (see `docs/engineering/plans/workflow-videos-plan.md`)
**Length:** about 90 seconds
**Frame:** 16:9. A vertical cut works too, since most of the action happens inside two dialogs.
**Written against:** 8.0.1. Labels in quotes are exact; check them in the app before recording.

## Before recording

- **Vault:** the Pride & Prejudice Story Vault, with Pride and Prejudice as the active book.
- **Pro:** active in that vault. The Customize pencil is a Pro feature; without Pro it says "Customizing PDF styles isn't available in this vault."
- **Pandoc and LaTeX:** installed. In the Manuscript export dialog, the checks should read "Export checks · Ready".
- **Font:** use Source Serif 4. It ships with Radial Timeline, so no install step appears on screen. EB Garamond and Crimson Text need installing first.
- **Fresh name:** delete any earlier "Trade Paperback" style, or the wizard adds a suffix to the name.
- **Opening shot:** render the finished PDF once beforehand. Open it as a two-page spread at a chapter opening.
- **Window:** 1920×1080 (or 2560×1440 scaled), the same theme as every other video, and nothing private in the file explorer or vault name.
- **Recorder:** turn on click highlights and auto-zoom.
- **Visible changes:** if a control already shows the value you're setting, change it anyway so the preview visibly redraws.

## Shot list

**1. The result (0:00–0:05)**
- Screen: the finished PDF as a two-page spread, a chapter opening facing a body page. Slow push-in.
- Caption: From scenes to a typeset PDF
- Voice: "This is Pride and Prejudice, typeset as a 6×9 paperback, straight from Obsidian."

**2. Start from a built-in layout (0:05–0:13)**
- Screen: Settings → Radial Timeline → Publish. Scroll to the layout list. Hover the pencil on Professional until its tooltip shows ("Customize Professional — opens the wizard pre-filled…"), then click.
- Caption: Settings → Publish → ✎ Customize (Pro)
- Voice: "Start from a built-in layout. The pencil opens a copy in the design wizard; the original stays as it was."

**3. Name the style (0:13–0:18)**
- Screen: the wizard opens with the "DESIGN" badge, the title "Customize Professional", and the preview on the left. In "Style name", replace "Professional Copy" with "Trade Paperback".
- Caption: Name your style
- Voice: "Give it a name."

**4. Page (0:18–0:30)**
- Screen: category "Page". "Paper size" → "6x9 trade". Turn on "Mirrored margins (book binding)". Let the preview redraw.
- Caption: Page · 6x9 trade · mirrored margins
- Voice: "Choose the trim size and margins. The preview updates as you go."

**5. Body (0:30–0:40)**
- Screen: the next-category arrow to "Body", so viewers see the categories in order. "Font" → "Source Serif 4". "Size (pt)" → 11.
- Caption: Body · font and size
- Voice: "Pick the body font and size. If a font isn't installed, the wizard tells you in red."

**6. Chapters (0:40–0:48)**
- Screen: the next-category arrow to "Chapters". "Chapter style" → "Numbered". The preview shows the chapter opening.
- Caption: Chapters · how each chapter opens
- Voice: "Decide how each chapter opens: a number, a title, or both."

**7. Save (0:48–0:52)**
- Screen: "Save style". Back in Settings → Publish, "Trade Paperback" now sits in the layout list.
- Caption: Save style
- Voice: "Save it, and it joins your layouts."

**8. Open the export (0:52–1:00)**
- Screen: open the command palette, type "manuscript", choose "Radial timeline: Manuscript export". The "Export manuscript" dialog opens with the badge "EXPORT — Pride and Prejudice".
- Caption: Command palette → Manuscript export
- Voice: "Now export. Open Manuscript export from the command palette."

**9. Choose the output (1:00–1:12)**
- Screen: "Who is it for?" → "Readers". "Format" → PDF. "Layout" → "Trade Paperback". Turn on "Paperback binding margin".
- Caption: Readers · PDF · Trade Paperback
- Voice: "Choose who it's for, PDF, and your new style. For a printed copy, add the paperback binding margin."

**10. Proof (1:12–1:20)**
- Screen: "Generate proof". "Document proof" shows page 1; step through to the first chapter opening.
- Caption: Generate proof · check the real pages
- Voice: "Generate a proof to check the real pages before you export."

**11. Export (1:20–1:27)**
- Screen: "Generate PDF". When the delivery review appears, "Open file". The PDF opens.
- Caption: Generate PDF → Open file
- Voice: "Then generate the PDF and open it."

**12. End card (1:27–1:32)**
- Screen: the Radial Timeline mark over the final spread.
- Caption: Full guide: Publishing in the Radial Timeline wiki
- Voice: "The full guide is in the Radial Timeline wiki, under Publishing."

## When "Design your own…" ships

Replace beats 2 and 3: Settings → Publish → "Design your own…" → "Start from an archetype" → Professional, then name the style. Everything after stays the same.

## Captions

The caption lines above are on-screen text. Build the subtitle file from the voice lines, which carry the full sentences.

## Vertical cut

Beats 3–7 and 9–11 happen in dialogs, so crop to the dialog. Keep beat 1 and the end card, and show beat 2 as a two-second zoom on the pencil.
