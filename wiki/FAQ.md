## Custom/Alien Calendars

Radial Timeline now includes a Planetary Time system. Plan in Earth time (fastest for pacing), then view a converted “local” calendar as needed.

### Environmental Cycles

Long days, stalled suns, tidal windows, and other cycles shape behavior without requiring a full custom calendar for planning.

### Recommended Workflow

1) Plan in Earth time for pacing, spacing, and overlaps. Authors born on earth and writing for Earthlings should use Earth time systems during development.
2) Write/translate in prose using in-world terms (lunar cues, solar position, cultural markers).  
3) Use the Backdrop ring and micro-backdrop rings (plus Chronologue Alt/Shift sub-modes) to track worldbuilding timing alongside the main timeline as a supplemental cross-reference. 

Radial Timeline keeps structural work in intuitive Earth units while letting you surface alien time for storytelling.

## I Use the Snowflake Method

**Q: I use the Snowflake Method and don't think the Radial Timeline will be useful to me.**

**A:** Radial Timeline is structure-agnostic and works well with the Snowflake Method—particularly once you reach Steps 8–10 (scene spreadsheet, scene narratives, and first draft).

The Snowflake Method is a *planning process* that expands a one-sentence idea into a full manuscript. Radial Timeline is a *visualization and analysis layer* that sits on top of your scenes regardless of how you developed them.

Here's how the two complement each other:

| Snowflake Step | What It Produces | Radial Timeline Feature |
|---|---|---|
| Step 8: Scene spreadsheet | List of discrete scenes | Core radial visualization |
| Step 9: Scene narratives | Scene content | Scene notes with YAML metadata |
| Step 10: First draft | Actual manuscript | Full manuscript support |

### Why Radial Timeline Works for Snowflake Users

1. **No beat system required** — Do not create beats notes or set the story structure to "Custom" and create your own. The timeline visualizes your scenes regardless of methodology or momentum milestones.

2. **Snowflake is character-centric—so is Radial Timeline** — POV color-coding and subplot tracking align perfectly with Snowflake's emphasis on character storylines. Each character's arc can be tracked as a subplot with its own color.

3. **Your scene spreadsheet becomes visual** — Step 8 of Snowflake creates a scene list. Radial Timeline transforms that flat list into a radial visualization where you can see pacing, gaps, and scene distribution at a glance.

4. **Chronologue mode for timeline complexity** — If your story has non-linear time (flashbacks, multiple timelines), Chronologue tracks story-time vs manuscript-order—useful regardless of planning method.

5. **AI analysis works on any scenes** — Scene triplet analysis provides concise pulse feedback on a scene level while Gossamer AI evaluation scores your beat milestones across the active signal.

### Summary

The Snowflake Method gets you from idea to scene list. Radial Timeline takes that scene list and gives you visual tools to analyze structure, track characters, manage subplots, and refine pacing. They work together rather than competing.

## I Use Dramatica

**Q: Can I use Radial Timeline with Dramatica?**

**A:** Yes! While Dramatica is complex and focuses on arguments (Throughlines) rather than linear beats, you can use Radial Timeline to visualize your scenes and track your data.

1.  **Beats System**: Set **Settings > Story beats system** to **"Custom"**. Name your system (e.g., "Dramatica Signposts"), add your beats, and assign them to acts. Use **Create** to generate beat set notes, or manually create notes with `Class: Beat` and `Beat Model: Your System Name`.
2.  **Advanced Metadata**: Use the **Scene properties editor** (in Settings) to add Dramatica-specific keys to your advanced scene properties. See [Scene Properties Editor](YAML-Frontmatter#advanced-yaml-editor). For example, you can add fields like:
    ```yaml
    dramatica:
      MC: Universe
      OS: Mind
      IC: Psychology
      RS: Physics
    ```
    This allows you to keep your Dramatica structure data right inside your scene notes while still getting the visual benefits of the timeline.
