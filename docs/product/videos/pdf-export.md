# Video script: Design a PDF style and export your manuscript

**Key:** `pdf-export` (see `docs/engineering/plans/workflow-videos-plan.md`)
**Length:** about 90 seconds of voice; at the pace of the Pandoc setup read (a second between lines, 1.5–2 s a step) the film runs closer to 1:45.
**Frame:** 16:9. A vertical cut works too, since most of the action happens inside two dialogs.
**Written against:** 8.0.1; **checked against 8.0.4 on 2026-11-17** (main, the release build in the Pandoc setup capture vault, and the design wizard opened there). Labels in quotes are exact.

## Before recording

- **Vault:** the capture copy from the Pandoc setup how-to (`Demo Vaults/Video Simulation Vaults/Plugin tutorials/pandoc setup/Working/`), Pride and Prejudice active. It already has Pandoc and LaTeX found, Book Details filled in, and an exported PDF for the opening shot. Give this video its own copy (a new scenario folder) so the two stay apart.
- **Pro:** nothing to do. The plugin turns Pro on in every vault (an open-beta key it sets at load), so the Customize pencil works for any viewer. Nothing on screen or in the voice mentions Pro, matching the wiki (Pro left the wiki on 2026-11-10, and no copy may suggest it costs money).
- **Pandoc and LaTeX:** found. In the "Export manuscript" dialog the checks read "Export checks · Ready".
- **Font:** Source Serif 4. It ships with Radial Timeline (the Standard layout uses it), so no install step appears. EB Garamond and Crimson Text are system-only: the "Font" menu lists them only on a computer that has them installed.
- **Fresh name:** delete any earlier "Trade Paperback" style, or the saved name gets a suffix ("-2").
- **Opening shot:** the finished PDF as a two-page spread at a chapter opening, rendered once beforehand with the new style.
- **Capture:** the background capture Obsidian and the drawn cursor (`Video/tools/capture/`), click rings and eased camera in the HyperFrames edit, as for the Pandoc setup how-to. 1920×1080, the shared theme, nothing private on screen.
- **Visible changes:** where a control already shows the value we want, change something next to it so the preview visibly redraws (shots 4 and 5 say what).

## Shot list

**1. The result (0:00–0:05)**
- Screen: the finished PDF as a two-page spread, a chapter opening facing a body page. Slow push-in. Two seconds of picture and music before the voice.
- Caption: From scenes to a typeset PDF
- Voice: "This is Pride and Prejudice, typeset as a 6×9 paperback, straight from Obsidian."

**2. Start from a built-in layout (0:05–0:13)**
- Screen: Settings → Radial Timeline → "Publish". Scroll to the "PDF style" list (Basic, Standard, Professional, Signature). Hover the pencil on Professional until its tooltip shows ("Customize Professional — opens the wizard pre-filled with this template's settings; saving creates a new editable copy."), then click.
- Caption: Settings → Publish → ✎ Customize
- Voice: "Start from a built-in layout. The pencil opens a copy in the design wizard; the original stays as it was."

**3. Name the style (0:13–0:18)**
- Screen: the wizard opens with the "DESIGN" badge, the title "Customize Professional", and the preview below the name. In "Style name", replace "Professional Copy" with "Trade Paperback".
- Caption: Name your style
- Voice: "Give it a name."

**4. Page (0:18–0:30)**
- Screen: "Category" reads "Page". "Paper size" already shows "6x9 trade" (Professional's own), so the cursor rests on it, then picks "Balanced" margins (Professional starts on "Custom": 0.85 / 0.9 / 1.05 / 0.9) and turns on "Mirrored margins (book binding)". The margin cross relabels to Inner and Outer, and the preview redraws.
- Caption: Page · 6x9 trade · mirrored margins
- Voice: "Choose the trim size and margins. The preview updates as you go."

**5. Body (0:30–0:40)**
- Screen: the next-category arrow (tooltip "Next category — Body"). "Font": "Sorts Mill Goudy" → "Source Serif 4". "Size (pt)" already reads 11; set 11.5 so the change shows.
- Caption: Body · font and size
- Voice: "Pick the body font and size. If a font isn't installed, the wizard tells you in red."

**6. Chapters (0:40–0:48): open question, see below**
- As written: the "Category" menu → "Chapters" (it's six categories on from Page, too many arrow clicks). Of the four cards "Off", "Numbered", "Titled" and "Numbered + titled", Professional starts on "Off"; choose "Numbered". The preview adds a "Chapter 1" chapter page.
- Caption: Chapters · how each chapter opens
- Voice: "Decide how each chapter opens: a number, a title, or both."
- **Problem (2026-11-17):** Pride and Prejudice has no `Chapter:` markers. Each scene is one chapter, and its text starts with "Chapter I.", so "Numbered" changes the preview but nothing in the exported PDF. Two ways out, for Eric to choose:
  1. **Drop the shot** (and its line). The video is shorter and shows only what the PDF shows.
  2. **Stage chapter markers** in this video's capture copy: a `Chapter:` field on each scene, and the "Chapter I." lines taken out of the scene text so the book doesn't print both. Then "Numbered" really shows in the PDF. It's a bigger staging change, and the copy no longer matches the Story Vault authors download.

**7. Save (0:48–0:52)**
- Screen: "Save style". The wizard closes, and "Trade Paperback" now sits in the "PDF style" list in Settings → Publish.
- Caption: Save style
- Voice: "Save it, and it joins your layouts."

**8. Open the export (0:52–1:00)**
- Screen: open the command palette, type "manuscript", choose "Radial timeline: Manuscript export". The "Export manuscript" dialog opens; its badge reads "EXPORT — Pride & Prejudice • 61 scenes selected • 121,601 words" (in capitals on screen).
- Caption: Command palette → Manuscript export
- Voice: "Now export. Open Manuscript export from the command palette."

**9. Choose the output (1:00–1:12)**
- Screen: "Who is it for?" → "Readers" (a clean reading copy, no scene IDs or notes). "Format" → PDF. "Layout" → "Trade Paperback". Turn on "Paperback binding margin" (it adds 0.25" to the inner margin).
- Caption: Readers · PDF · Trade Paperback
- Voice: "Choose who it's for, PDF, and your new style. For a printed copy, add the paperback binding margin."

**10. Proof (1:12–1:20)**
- Screen: "Generate proof". "Document proof" shows page 1; step through with "Next" to the first chapter opening.
- Caption: Generate proof · check the real pages
- Voice: "Generate a proof to check the real pages before you export."

**11. Export (1:20–1:27)**
- Screen: "Generate PDF". The dialog reads "File checks passed · 1 of 1 final files checked." and shows "Open file"; click it, and the PDF opens.
- Caption: Generate PDF → Open file
- Voice: "Then generate the PDF and open it."

**12. End card (1:27–1:32)**
- Screen: the Radial Timeline mark over the final spread; radialtimeline.com stays up to the last frame, at least three seconds, no fade.
- Card: Full guide · Publishing · Radial Timeline Docs
- Voice: "The full guide is in the Radial Timeline wiki, under Publishing."

## Voice

The whole read, as one take (shot 6's line in brackets until Eric decides):

> This is Pride and Prejudice, typeset as a 6×9 paperback, straight from Obsidian.
>
> Start from a built-in layout. The pencil opens a copy in the design wizard; the original stays as it was.
>
> Give it a name.
>
> Choose the trim size and margins. The preview updates as you go.
>
> Pick the body font and size. If a font isn't installed, the wizard tells you in red.
>
> [Decide how each chapter opens: a number, a title, or both.]
>
> Save it, and it joins your layouts.
>
> Now export. Open Manuscript export from the command palette.
>
> Choose who it's for, PDF, and your new style. For a printed copy, add the paperback binding margin.
>
> Generate a proof to check the real pages before you export.
>
> Then generate the PDF and open it.
>
> The full guide is in the Radial Timeline wiki, under Publishing.

## Found while checking (2026-11-17)

- **The wizard's "Category" menu cut "Chapters" to "Chapte".** Fixed on main on 2026-11-17 (the menu is wider); it reaches authors with the release after 8.0.4.
- **"Import template…" is still switched off** in release builds ("BETA release pending" while beta features are off).

## Changed on 2026-11-17: "Design your own…" is out of beta

On main, "Design your own…" in Settings → Publish works in every vault, and reaches authors with the release after 8.0.4. The pencil on a built-in layout (shots 2 and 3 as written) still works the same way. Three things in this script to check against that build before recording:

- **Shot 5, the voice line "If a font isn't installed, the wizard tells you in red."** The "Font" menu now lists only fonts this computer can print with, in groups: "Included with Radial Timeline" (Sorts Mill Goudy, Source Serif 4), "Included with LaTeX" (Latin Modern Roman, TeX Gyre Pagella) and "On this computer" (Arial and any of EB Garamond or Crimson Text that are installed, then "Custom (system font)"). A font that isn't installed is not in the menu, so a viewer won't see the red "Missing" label unless a style already uses such a font. The line needs a new second sentence, for Eric to choose.
- **Shot 5, "Latin Modern"** is listed as "Latin Modern Roman".
- **Shot 5, "Size (pt)"** accepts 10 to 13 in steps of 0.5, so 11.5 as scripted is fine.

To open with "Design your own…" instead of the pencil, replace shots 2 and 3: Settings → Publish → "Design your own…" → "Start from a professional layout" → Professional, then name the style (it starts as "Professional Custom"). Everything after stays the same.

## Captions

The caption lines above are on-screen text. Build the subtitle file from the voice lines, which carry the full sentences.

## Vertical cut

Shots 3–7 and 9–11 happen in dialogs, so crop to the dialog. Keep shot 1 and the end card, and show shot 2 as a two-second zoom on the pencil.
