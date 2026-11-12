# Video script: The Beat Manager

**Key:** `beat-manager` (see `docs/engineering/plans/workflow-videos-plan.md`)
**Length:** about 2 minutes 15 seconds, in six chapters. Longer than the other workflow videos because it introduces the whole tool. Add the chapters as YouTube chapters; a 60-second Short can be cut from chapters 1 and 6.
**Frame:** 16:9.
**Written against:** 8.0.1. Labels in quotes are exact; check the order of clicks in the app before recording.

## What the video says the Beat Manager is for

Beats are a story's anchor points. The Beat Manager:

1. puts a beat system on the timeline, from Save the Cat and the Hero's Journey to more technical structures, as one note per beat;
2. keeps each beat's place (act and order) and its characteristics (purpose, Gossamer range, your own fields);
3. audits the beat notes as the book changes, and repairs what has drifted;
4. finds duplicates and clears out beats you no longer use;
5. lets you build your own system;
6. switches between systems in the same book, without losing any.

All of this keeps the beats clean, and Gossamer scores the draft against them: clean beats, honest scores.

## Before recording

- **Vault:** a throwaway copy of the Pride & Prejudice Story Vault, because the video creates, repairs and deletes beat notes. The Story Vault ships 15 Save the Cat beats with reviewed Gossamer scores.
- **Starting state:** Save the Cat is the tab marked "Active in timeline". No Hero's Journey tab and no "Austen's Three Proposals" set yet.
- **Check first:**
  - Record on a build with commit 341f917a or later, and publish after the release that carries it. Before it, Repair never shows for a library system such as Hero's Journey (chapter 3), and a new blank system can't be named (chapter 5).
  - Clicking a system's tab swaps the beats on the wheel.
- **Window and recorder:** as for `pdf-export`: 1920×1080, the shared theme, click highlights and auto-zoom, nothing private on screen.

## Shot list

### Opening (0:00–0:15)

**1. Anchor points (0:00–0:07)**
- Screen: the Pride & Prejudice wheel with the Save the Cat beats among the chapters. Hover "Midpoint".
- Caption: Beats: your story's anchor points
- Voice: "Beats are your story's anchor points: the Catalyst, the Midpoint, the Dark Night of the Soul. The Beat Manager puts them on your timeline and keeps them in order as the book changes."

**2. Why it matters (0:07–0:15)**
- Screen: switch to Gossamer mode and hover a score on the momentum line.
- Caption: Gossamer scores your draft against your beats
- Voice: "And they matter. Gossamer scores your draft against these beats, so clean beats mean honest scores."

### Chapter 1: Put a structure on your timeline (0:15–0:40)

**3. The library (0:15–0:27)**
- Screen: Settings → Radial Timeline → Core, at the top: click "Beats" under "Quick links", which jumps to "Story beats system" (Obsidian's settings search doesn't find it). Open "Add system". Its "Select a set" list is a dropdown a screen recording can't show open, so choose each system the voice names in turn and let its card show; no labels over the interface. End on "Hero's Journey", then "Open tab".
- Caption: ① Generate beats · Settings → Core → Beats
- Voice: "Start from the library: classics like Save the Cat and the Hero's Journey, story engines like the Thriller Escalation Ladder, or formats like the Podcast Narrative Arc."

**4. The beats (0:27–0:33)**
- Screen: the "Preview" tab: twelve beats across three acts, from "Ordinary World" to "Return with the Elixir".
- Caption: Every beat, by act, with its purpose
- Voice: "Each system lists its beats by act, and what each one is for."

**5. Onto the timeline (0:33–0:40)**
- Screen: "Design", then under "Beat notes in your vault for Hero's Journey", "Create beat notes" and, in its dialog, "Create 12 notes". Cut to the wheel: the twelve beats now sit among the chapters.
- Caption: One note per beat, placed on the timeline
- Voice: "One click makes a note for every beat, and each one takes its place on the timeline."

### Chapter 2: Each beat's place and characteristics (0:40–0:58)

**6. A beat is a note (0:40–0:48)**
- Screen: hover "Ordeal" on the wheel; its hover card shows its Purpose. Open the note: `Class: Beat`, `Act`, `Purpose`, `Beat Model: Hero's Journey`.
- Caption: ② Place and describe each beat
- Voice: "Every beat is an ordinary note: its act, its purpose, and the system it belongs to."

**7. Act, order and range (0:48–0:58)**
- Screen: the "Design" tab. Run the pointer down the rows: each beat's act, its order, and its range ("Gossamer momentum range (e.g. 10-20)").
- Caption: Act · order · Gossamer range
- Voice: "In Design, each beat carries its act, its place in the order, and the momentum range Gossamer measures against."

### Chapter 3: Audit and repair as the book changes (0:58–1:18)

**8. A beat drifts (0:58–1:08)**
- Screen: in the Ordeal note's properties, change `Act` from 2 to 3, as a revision might. (The Hero's Journey puts the Ordeal in Act 2.) Back in the Beat Manager, the Ordeal's row turns orange with "Placed in Act 3 in the manuscript. Template suggests Act 2.", and the status reads 11 synced, 1 misaligned.
- Caption: ③ Audit as the book changes
- Voice: "As the book changes, beats drift. The Beat Manager checks every beat note against the system and shows you what's out of place."

**9. Repair (1:08–1:18)**
- Screen: "Repair 1 beat note". The row turns green and moves back to Act 2: "All 12 beat notes are synced."
- Caption: Repair beat notes
- Voice: "Repair beat notes puts them back. It fixes the act and the system name, and never renames your files."

### Chapter 4: Duplicates (1:18–1:28)

**10. Find and remove a duplicate (1:18–1:28)**
- Screen: in the file explorer, duplicate the Ordeal note and give the copy a different number prefix. When Settings opens, its row is red, and its icon's tooltip reads "Multiple beat notes match this title. Manually delete duplicate beat notes to resolve." Delete the copy (right-click, "Delete"); reopened, the row is green. The rows redraw when Settings opens, not while it stays open.
- Caption: ④ Duplicates show in red
- Voice: "A duplicate beat would throw off the scoring, so it's flagged in red. Delete the extra note, and the beat is clean again."

### Chapter 5: Build your own (1:28–1:50)

**11. A blank system (1:28–1:40)**
- Screen: "Add system" → "Blank / Custom" → "Create blank system", then "Design". Click the system's name above its rows to open "Edit custom system details" and set "System name" to "Austen's Three Proposals". In Design's bottom row, add beats with "+": "Collins Proposes" in Act 1, "Darcy Proposes" in Act 2, "Darcy Proposes Again" in Act 3.
- Caption: ⑤ Build your own system
- Voice: "Or build your own. Name a system, add beats with plus, and put each one in its act. Here are the three proposals in Pride and Prejudice."

**12. Your own fields (1:40–1:50)**
- Screen: the "Fields" tab: add a field "Stakes" and tick "Show in beat hover synopsis"; the "Beat Hover Metadata Preview" shows it. "Save changes", then in "Design", "Create beat notes" and "Create 3 notes".
- Caption: Your fields · Save changes · Create beat notes
- Voice: "Give your beats the fields you care about, like what's at stake, save the set, and create its notes."

### Chapter 6: Switch systems in the same book (1:50–2:08)

**13. One book, three structures (1:50–2:00)**
- Screen: click the tabs in turn: Save the Cat, Hero's Journey, Austen's Three Proposals. The wheel's beats change each time.
- Caption: ⑥ Switch systems, same book
- Voice: "All three live in the same book. Switch tabs, and the timeline switches structure. Gossamer follows whichever one is active, and nothing is lost."

**14. Clear out a system you're done with (2:00–2:08)**
- Screen: the × on the Hero's Journey tab. The dialog says "This moves beat notes to trash. The set definition remains available in Add system." Type DELETE, choose "Delete beat notes". The notice reads that 12 beat notes moved to the trash and Hero's Journey was removed.
- Caption: Remove a system · its notes go to the trash
- Voice: "Finished with one? Remove it, and its notes go to the trash. You can always add it back from the library."

### End card (2:08–2:15)

**15. Next**
- Screen: the Radial Timeline mark over the wheel.
- Caption: Full guide: Story Beats System in the Radial Timeline wiki · Next: Gossamer Mode
- Voice: "Clean beats, honest scores. Next, see how Gossamer scores them."

## Voice take (2026-11-12)

`Radial Timeline LLC/Video/Plugin tutorials/beat manager/audio/beat-manager.aifc`: 2:47.4, 48 kHz, 24-bit. Measured with ffmpeg's silence detection and a whisper transcript of each line. Shot 7's and shot 11's voice lines above now match what was said.

- **Edit:** trim the 3.0 s before the first word, and cut 0:28.1–0:35.9 (a false start of shot 3 and the spoken "retake"). The voice then runs 2:32.4, or 2:38.2 with the shot 4 pickup, against 2:15 planned.
- **Shot 4 pickup:** the take has no shot 4. `beat-manager-pickup.aifc` beside the take (17.8 s, same format) reads shot 3's last sentence, shot 4 and shot 5's first sentence once; shot 4 is at 0:06.3–0:11.4 in it, and its words match the script. Split the take at 0:50.75, in the room tone after "Podcast Narrative Arc.", and put the pickup's 0:05.80–0:11.65 there. The take's breath before "One click" stays. Raise the pickup clip 1 dB: the two lines it repeats from the take measure 0.9–2.4 LU quieter, while its tone and room tone match.
- **Pauses:** the breaks between chapters hold 1.9–4.9 s, 22.5 s in all. At 1 s each, the voice runs about 2:23 with the pickup.
- **Pace:** 2.7 words a second. Shot 1's 32 words need about 12 s, not the planned 7.
- **Listen for:** "Finished with one?" (2:25.5), which every transcript hears as "Finish with one". The B in "Beats" (0:03.0) and "beats drift" (1:19.6), heard as an M when those lines are transcribed alone.

Positions are in the take file as recorded, before the edit:

| Shot | In the take | Spoken | Planned |
|---|---|---|---|
| 1 | 0:03.0–0:16.9 | 13.8 s | 7 s |
| 2 | 0:17.5–0:24.6 | 7.1 s | 8 s |
| 3 | 0:35.9–0:50.7 | 14.7 s | 12 s |
| 4 | pickup file, 0:06.3–0:11.4 | 5.1 s | 6 s |
| 5 | 0:51.6–0:57.6 | 6.0 s | 7 s |
| 6 | 1:01.2–1:08.0 | 6.8 s | 8 s |
| 7 | 1:08.9–1:17.5 | 8.6 s | 10 s |
| 8 | 1:19.6–1:28.8 | 9.2 s | 10 s |
| 9 | 1:29.6–1:37.5 | 7.8 s | 10 s |
| 10 | 1:41.2–1:49.4 | 8.3 s | 10 s |
| 11 | 1:51.3–2:03.2 | 11.8 s | 12 s |
| 12 | 2:03.5–2:10.7 | 7.1 s | 10 s |
| 13 | 2:13.3–2:24.7 | 11.4 s | 10 s |
| 14 | 2:25.5–2:33.4 | 7.9 s | 8 s |
| 15 | 2:38.3–2:43.2 | 4.9 s | 7 s |

The shot times in the shot list are the plan. Set the YouTube chapters below from the blue markers in the final cut.

## Current cut (cut 2, 2026-11-12)

`Radial Timeline LLC/Video/Plugin tutorials/beat manager/Exports/Beat Manager cut 2.mp4`, 2:28, UHD, made in HyperFrames (`HyperFrames/`). In that folder, `planning/build-voice.py` cuts the voice (pauses between chapters at 1.2 s), `planning/record.mjs` records the screen takes in a copy of the Pride & Prejudice vault, and `planning/build.py` lays out the scenes, captions and subtitles (`Publish/beat-manager.en.srt`). Music: "Observations" (From Now On), low under the voice.

Cut 2 opens shot 3 on Core's quick links and drops the group labels over the set cards (Eric's notes on the first cut).

Chapters in this cut: 0:00 What beats are for · 0:23 Put a structure on your timeline · 0:52 Each beat's place and characteristics · 1:10 Audit and repair · 1:29 Duplicates · 1:38 Build your own · 1:59 Switch systems

## YouTube chapters

0:00 What beats are for · 0:15 Put a structure on your timeline · 0:40 Each beat's place and characteristics · 0:58 Audit and repair · 1:18 Duplicates · 1:28 Build your own · 1:50 Switch systems

## Captions

The caption lines above are on-screen text. Build the subtitle file from the voice lines.

## Links

The play icon sits on the "Story beats system" heading in Settings → Core. The end card points to the existing Gossamer Mode video (Volume 6).
