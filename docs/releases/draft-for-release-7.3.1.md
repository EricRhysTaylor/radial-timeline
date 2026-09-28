## Radial Timeline 7.3.1

Scene time now measures your prose against the scene's declared Duration, and your Community page counts every word you write.

### Scene time

- **A running total from the first cue.** The title bar shows a provisional total as soon as your time cues suggest one, such as `Elapsed ~2h 30m`, combining confirmed cues with the suggested durations of pending ones. Once every cue is confirmed, the exact figure takes its place. The Scene time panel shows the same number.
- **The Duration line.** When a scene has a `Duration` in its properties, the cue bar beside your prose draws it as a thin line and measures the prose against it. Prose within 10% of the Duration counts as a match.
  - **Prose falls short:** the line runs the full length and ends in a down arrow — red when time phrases cover part of the Duration, gray while the scene waits for its first timed phrase. Hover it to see the shortfall.
  - **Prose runs past it:** the line turns yellow and stops at the time phrase that passes the Duration. It is dashed while the overage rests on pending cues and solid once confirmed time alone passes the Duration.
  - The title bar matches the line: a yellow **Check timing** while the overage is pending, a red **Review timing** once it is confirmed. The Scene time panel has a key for the line and arrows.
- Radial Timeline reads `Duration` straight from your scene properties, so your notes stay exactly as you wrote them.

### Community

- **Daily words count every mode.** Your Community page's daily words now include revising, editing, and planning sessions alongside drafting, so a season of revision shows its full word count.
- **Your season catches up.** The first sync after updating sends your last 12 weeks once. A vault later connected to a different Community profile sends that profile its own 12 weeks.
- The Community Share preview lists the per-day words before they leave the vault, and daily words follow the sharing level you've already chosen.

### Model support

- **Claude Opus 5.5** is now the default Anthropic model, with Opus 5 still available.
- **GPT-6 Sol** and **GPT-6 Luna** replace GPT-5.6 Sol and Luna.
- **Gemini 3.8 Flash** replaces Gemini 3.5 Flash on the speed lane.

### Fixes

- **All Scenes number squares.** When your outermost subplot has its own name, the outer ring now numbers each scene once, in order.
