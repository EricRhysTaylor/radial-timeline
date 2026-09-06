## Custom/Alien Calendars

Use [Planetary Time](Chronologue-Mode#planetary-time) to convert Earth dates into your story’s calendar. Configure day length, year length, labels, and an epoch offset in Settings → Core.

1. Enter `When` dates in Earth time for chronology and elapsed-time calculations.
2. Use the Planetary Time display and calculator to translate dates for your prose.
3. Add Backdrop notes or micro-backdrop rings for seasons, tidal windows, eras, and other world events.

## I Use the Snowflake Method

Radial Timeline visualizes the scene list and draft you develop with the Snowflake Method.

| Snowflake output | Use in Radial Timeline |
|---|---|
| Scene spreadsheet | Create scene notes and view their order and distribution |
| Scene narratives | Keep prose and properties together in each note |
| First draft | Track revision progress, subplots, and chronology |

Track character arcs as colored subplots and use POV indicators in scene hovers. Add a custom beat system when you want structural milestones, then use Gossamer to compare beat scores. Pulse evaluates scene flow in manuscript or subplot order.

## I Use Dramatica

**Q: Can I use Radial Timeline with Dramatica?**

**A:** Yes. Use a custom beat system for signposts and scene properties for Throughline data.

1.  **Beats System**: Set **Settings → Core → Story beats system** to **"Custom"**. Name your system (e.g., "Dramatica Signposts"), add your beats, and assign them to acts. Use **Create** to generate beat set notes, or manually create notes with `Class: Beat` and `Beat Model: Your System Name`.
2.  **Advanced Metadata**: Use the **Scene properties editor** (in Settings) to add Dramatica-specific keys to your advanced scene properties. See [Scene Properties Editor](YAML-Frontmatter#advanced-yaml-editor). For example, you can add fields like:
    ```yaml
    dramatica:
      MC: Universe
      OS: Mind
      IC: Psychology
      RS: Physics
    ```
    Your Dramatica data stays with the scene it describes.
