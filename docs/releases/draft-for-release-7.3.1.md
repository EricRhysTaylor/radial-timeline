## Radial Timeline 7.3.1

Scene time now measures your prose against the scene's declared Duration, and your Community page counts every word you write, not only drafting.

### Scene time

- **A running total before you confirm anything.** The title bar used to show `Elapsed —` until you confirmed a time cue. It now shows a provisional total, such as `Elapsed ~2h 30m`, built from your confirmed cues plus the suggested durations of the ones you haven't confirmed yet. Once every cue is confirmed, the exact figure replaces it. The Scene time panel shows the same number.
- **The Duration line.** When a scene has a `Duration` in its properties, the cue bar beside your prose draws it as a thin line and measures the prose against it. Prose within 10% of the Duration counts as a match.
  - **Prose falls short:** the line runs the full length and ends in a down arrow, red when time phrases cover part of the Duration and gray when no phrase gives the scene any time. Hover it for the shortfall.
  - **Prose runs past it:** the line turns yellow and stops at the time phrase that passes the Duration. It is dashed while the overage rests on cues you haven't confirmed, and solid once confirmed time alone runs past.
  - The title bar agrees with the line: a yellow **Check timing** while the overage is unconfirmed, a red **Review timing** once it is confirmed. The Scene time panel has a key for the line and arrows.
- Radial Timeline only reads `Duration`; it never writes to your scene properties.

### Community

- **Daily words count every mode.** Your Community page's daily words now include revising, editing, and planning sessions, not only drafting, so a season spent revising no longer reads as zero words.
- **Your season catches up.** The first sync after updating sends your last 12 weeks once, even if you haven't written since. A vault later connected to a different Community profile sends that profile its own 12 weeks.
- The Community Share preview lists the per-day words before anything leaves the vault. Daily words follow the same sharing level as the rest of your progress; nothing new becomes public on its own.

### Model support

- **Claude Opus 5.5** is now the default Anthropic model; Opus 5 remains available.
- **GPT-6 Sol** and **GPT-6 Luna** replace GPT-5.6 Sol and Luna.
- **Gemini 3.8 Flash** replaces Gemini 3.5 Flash on the speed lane.

### Fixes

- **All Scenes number squares no longer repeat.** When no subplot was named "Main Plot", the outer ring's scene numbers were drawn a second time, interleaving duplicates around the ring. Each scene is now numbered once.
