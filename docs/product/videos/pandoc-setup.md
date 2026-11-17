# Video script: Install Pandoc and LaTeX for export

**Key:** `pandoc-setup` (see `docs/engineering/plans/workflow-videos-plan.md`)
**Length:** about 1:20, a how-to: where to look, what to install, and how Radial Timeline finds it.
**Frame:** 16:9.
**Written against:** 8.0.4. Labels in quotes are exact; check them in the app and on the two download pages before recording.

## Why this video

Two authors got stuck here (GitHub issues #29 and #34, both fixed in 7.0.2 and 7.0.3). The author of #34 asked for "clear guidance regarding such an install … for those unfamiliar with the interaction between Pandoc and Obsidian." This video is that guidance. It works on both systems: the steps are the same, and the voice names the Windows installer for LaTeX.

## What the author learns

1. Word and PDF export need two free programs on the computer, Pandoc and LaTeX; Markdown export needs neither.
2. Settings → Publish → Export Check says what's missing.
3. Pandoc comes from pandoc.org; LaTeX is MacTeX on a Mac and MiKTeX on Windows.
4. Auto locate finds both.
5. Install all puts the PDF styles and their fonts in the vault.
6. Export Check then reads Ready, and Export manuscript works.

## Before recording

- **Vault:** a throwaway copy of the Pride & Prejudice Story Vault in the background capture Obsidian, with Pride and Prejudice as the active book. Delete the copy's `Radial Timeline/Pandoc/` folder so the PDF styles read "Not installed".
- **Starting state:** set the copy's Pandoc path (Settings → Publish → Export tools → "Pandoc & LaTeX") to a path that doesn't exist, such as `/usr/local/bin/pandoc`. The plugin then reports Pandoc missing: the "Export Check" card reads "One-time setup: install export tools for PDF." with "Set up tools", and the "Export tools" panel is open. Auto locate replaces the missing path with the real one.
- **On this Mac:** Pandoc came from Homebrew, so Auto locate shows `/opt/homebrew/bin/pandoc`; the pandoc.org installer puts it at `/usr/local/bin/pandoc`. The voice doesn't read the path, so either is fine. LaTeX is MacTeX (TeX Live 2026); Auto locate reports "✓ LaTeX found (xelatex)".
- **The download pages:** record pandoc.org/installing.html and tug.org/mactex in a browser window. Click "Download the latest installer" and "MacTeX Download" to show where they are, then cut. Nothing is downloaded or installed on camera; the installers are the standard macOS and Windows ones.
- **Windows:** no Windows footage. The voice names MiKTeX, and the LaTeX caption shows both.
- **Pace:** 1.5 to 2 seconds per click, typing readable, never sped up. At least 2 seconds of picture and music before the first word.
- **Window:** as for `pdf-export`: 1920×1080, the shared theme, nothing private on screen.

## Shot list

**1. The result (0:00–0:09)**
- Screen: a finished PDF spread (the `pdf-export` opening), then a Word file of the same chapter beside it. Two seconds of picture and music before the voice.
- Caption: One-time setup for Word and PDF export
- Voice: "Word and PDF export need two free programs on your computer: Pandoc and LaTeX. You set them up once."

**2. Where to look (0:09–0:17)**
- Screen: Settings → Radial Timeline → "Publish". The fourth status card, "Export Check", reads "One-time setup: install export tools for PDF." Click "Set up tools": the "Export tools" panel opens on "Pandoc & LaTeX", with "Auto locate".
- Caption: ① Settings → Publish → Export Check
- Voice: "In Settings, open Radial Timeline's Publish tab. Export Check tells you what's missing."

**3. Pandoc (0:17–0:27)**
- Screen: pandoc.org → "Installing" → "Download the latest installer". Cut on the click.
- Caption: ② pandoc.org → Installing → run the installer
- Voice: "First, Pandoc. On pandoc.org, choose Installing, download the installer for your computer, and run it."

**4. LaTeX (0:27–0:39)**
- Screen: tug.org/mactex → "MacTeX Download". Cut on the click.
- Caption: ③ LaTeX · Mac: MacTeX · Windows: MiKTeX
- Voice: "Then LaTeX, which typesets the PDF. On a Mac, install MacTeX from tug.org. On Windows, install MiKTeX."

**5. Auto locate (0:39–0:49)**
- Screen: back in Settings → Publish → "Export tools". Click "Auto locate" ("Locating…"). The row reads "✓ Pandoc found at …" and "✓ LaTeX found (xelatex)", and the path field fills in.
- Caption: ④ Auto locate
- Voice: "Back in Radial Timeline, click Auto locate. It finds both programs and saves the path."

**6. Styles and fonts: dropped (2026-11-17)**
- In 8.0.4 the bundled PDF styles and their fonts install themselves when the plugin loads: every style already reads "Installed", and so does the button beside "Design your own…" and "Import template…". There is no Install all step to show, so the edit leaves the line "Then install the PDF styles and their fonts with Install all." out of the read. The button ("Install all", or "Install fonts" when only fonts are missing) is still there for a vault whose Pandoc folder lost its files.

**7. Ready (0:58–1:10)**
- Screen: the "Export Check" card now reads "Ready to export. Generate your PDF." Click "Export manuscript": the "Export manuscript" dialog shows "Export checks · Ready".
- Caption: Export checks · Ready
- Voice: "Export Check now says you're ready. Open Export manuscript, and make your Word file or PDF."

**8. End card (1:10–1:18)**
- Screen: the Radial Timeline mark; the address stays up to the last frame, at least three seconds, no fade.
- Caption: Full guide: Publishing in the Radial Timeline wiki · Next: Design a PDF style
- Voice: "The full guide is in the wiki, under Publishing."

## Check before recording

- The number in the Install all notice: six bundled layouts in 8.0.4 (four for novels, Screenplay, Podcast Script). Use whatever the app says.
- Checked in the code (8.0.4): while Pandoc is missing the "Export tools" panel is already open, and "Set up tools" scrolls to it (`PublishSection.ts`, `revealSystemConfig`).

## Voice

The whole read, as one take:

> Word and PDF export need two free programs on your computer: Pandoc and LaTeX. You set them up once.
>
> In Settings, open Radial Timeline's Publish tab. Export Check tells you what's missing.
>
> First, Pandoc. On pandoc.org, choose Installing, download the installer for your computer, and run it.
>
> Then LaTeX, which typesets the PDF. On a Mac, install MacTeX from tug.org. On Windows, install MiKTeX.
>
> Back in Radial Timeline, click Auto locate. It finds both programs and saves the path.
>
> Then install the PDF styles and their fonts with Install all.
>
> Export Check now says you're ready. Open Export manuscript, and make your Word file or PDF.
>
> The full guide is in the wiki, under Publishing.

About 110 words, roughly 45 seconds at the Beat Manager read's pace (2.7 words a second); the rest of the 1:18 is steps shown at a followable pace.

## Voice take and first cut (2026-11-17)

- **Take:** `Radial Timeline LLC/Video/Plugin tutorials/pandoc setup/audio/pandoc-setup.aifc` (Eric recorded it in the Vol 14 project's `Audio/`; the copy here is the working source), 1:19.5, 48 kHz 24-bit. Every line matches the script; pauses between lines run about a second, so it is longer than the 45 s estimate.
- **Cut voice:** `audio/pandoc-setup-voice-cut.wav`, 1:12.7: 58.25–64.95 s taken out (the Install all sentence, shot 6). The first word is at 2.31 s, so the film opens on 2 s of picture and music.
- **Edit:** HyperFrames, `planning/record.mjs` (the takes) and `planning/build.py` (scenes, captions, end card, mix, subtitles `Publish/pandoc-setup.en.srt`). Music: "Careful Consideration" (Jon Bjork, Epidemic Sound). 1:14.6 in all.
- **Staging that differs from "Before recording":** the vault also needed Book Details (title, author, rights, publisher) before Export Check could read Ready: without them it reads "Blocked: Add title in Publish → Book details before exporting." The "Scene field POV is now Narration" alert and the APR refresh badge were cleared in the capture copy so they don't show in the wheel's corner.
- **Labels as they are in 8.0.4:** the status cards are "Form 01 Book Details" to "Form 04 Export Check"; Export Check's footer reads "04 Press proof · Set up tools", and "Set up tools" scrolls to "Export tools". Auto locate reports "✓ Pandoc found at … · Replaced missing path … · ✓ LaTeX found (xelatex) · Available engines …" in the row and in a notice. The Export manuscript button is labelled "Export manuscript →".

## Captions

The caption lines above are on-screen text. Build the subtitle file from the voice lines.

## Links

- Add `pandoc-setup` to `WorkflowVideoKey`, its title under `ui.workflowVideos`, and the play button on the "Export tools" heading in Settings → Publish when the video is about to be recorded, not before.
- The end card points to the `pdf-export` video once it exists; until then, to the wiki's Publishing page only.
