# YAML Field Reference

Complete guide to frontmatter fields used in Radial Timeline. This YAML must be placed at the front of each scene or beat note before any other text.

## Quick Reference

### Required Fields

| Field | Type | Description |
|-------|------|-------------|
| `Class` | String | File type: `Scene` or `Beat` |
| `Act` | Number | Story act (1-3 by default; act count configurable in settings) |
| `Status` | String | Workflow: `Todo`, `Working`, or `Complete` |
| `Subplot` | Array | One or more plot threads (default: `Main Plot`) |

### Commonly Used Fields

| Field | Type | Description |
|-------|------|-------------|
| `When` | Date | In-world date (YYYY-MM-DD or ISO format) |
| `Synopsis` | String | Brief description of what happens |
| `Character` | Array | Characters on stage (link to character notes) |
| `Publish Stage` | String | Progress stage: `Zero`, `Author`, `House`, or `Press` |
| `Iteration` | Number | Edit iteration count (leave blank until stage > zero) |
| `Due` | Date | Deadline for this scene (YYYY-MM-DD) |

---

## Scene Examples

### Minimal Scene

The bare minimum required to render a scene on the timeline:

```yaml
---
Class: Scene
Act: 1
Status: Todo
Subplot: Main Plot
---
```

### Standard Scene

Typical scene with common metadata:

```yaml
---
Class: Scene
Act: 1
When: 2000-01-31
Synopsis: The protagonist discovers a mysterious artifact.
Subplot:
  - Main Plot
  - Plot 2
Character:
  - "[[Protagonist A]]"
  - "[[Mentor B]]"
Status: Todo
Publish Stage: Zero
Due: 2026-01-31
Pending Edits:
---
```

### Advanced Scene with AI Beats

Full scene with AI triplet analysis, optional analysis fields, and tracking metadata:

```yaml
---
# Required fields
Class: Scene
Act: 1
When: 2000-01-31
Duration: 0

Synopsis: Explain concisely what happens in this scene.

Subplot:
  - Main Plot
  - Plot 2

Character:
  - "[[protagonist a]]"
  - "[[mentor b]]"

Place:
  - "[[earth]]"

Status: Todo
Publish Stage: Zero
Due: 2026-01-31
Pending Edits:
Iteration:

# Optional analysis fields
Type:     # Optional scene role or classification
Shift:    # Optional value shift or polarity change
Questions:     # What is the reader wondering?
Reader Emotion:     # curious / shocked / uneasy / hopeful / betrayed / triumphant
Internal:     # How do the character change? (e.g., from trusting → suspicious)

# Optional tracking
Total Time: 0.0     # Writing/production time spent (hours in decimal)
Words: 0
Runtime:     # Technical runtime (screenplay time / reading time, e.g., "2:30", "45s")
Support Files:

# AI-Generated Beats (triplets)
previousSceneAnalysis:
  - 12 Inciting clue + / Raises stakes for the protagonist. Secondary suspicion grows
currentSceneAnalysis:
  - 13 A / Excellent pacing in the confrontation [br] Cut repetition in second paragraph
  - Follow-up + / Ally reveals motive
nextSceneAnalysis:
  - 14 Setback ? / Plan fails at the last moment New approach needed
Pulse Update: Yes
Summary Update:
---
```

---

## Beat Examples

### Standard Beat (Save the Cat)

```yaml
---
Class: Beat
Act: 1
When:                         # Optional: Story timeline date (YYYY-MM-DD HH:MM)
Description: The first impression of your story. A snapshot of the protagonist's life before the journey begins. This 'before' picture sets up the world and establishes what will change by the end. Show the protagonist in their everyday life, revealing the flaw or gap that will be addressed.
Beat Model: Save The Cat
Range: 0-10                   # Momentum range for this beat
Gossamer1: 12                 # Latest gossamer score
---
```

> **Note**: Beat notes are ordered structurally by Act and filename prefix (e.g., `1.01 Opening Image.md`). Beats do not use the `When` field — they are not temporal.

### Beat with Historical Gossamer Tracking

```yaml
---
Class: Beat
Act: 1
Purpose: The first impression of your story. A snapshot of the protagonist's life before the journey begins.
Beat Model: Save The Cat
Range: 0-10
Gossamer1: 4     # First run (oldest)
Gossamer2: 8     # Second run
Gossamer3: 12    # Third run
Gossamer4: 15    # Fourth run
Gossamer5: 18    # Fifth run (most recent in this example)
---
```

---

## Field Details

### Class
**Required** | Type: `Scene` or `Beat`

Identifies the file type for the plugin.

---

### Act
**Required** | Type: Number (1-3 by default)

The story act this scene or beat belongs to. Acts 1-3 are the default; the **Act count** setting can raise the number of acts (minimum 3, though very large counts become impractical on the timeline).

---

### When
**Optional** | Type: Date

The in-world date when the scene takes place in your fictional timeline. Not used by Beat notes.

Supported formats (month and day can be single or double digit):
- `2024-03-15` or `2024-3-15` (simple date)
- `2024-03-15T14:30:00` or `2024-3-15T14:30:00` (date with time)
- `2024-03-15 14:30` or `2024-3-15 14:30` (readable date+time)
- `1812-9-17` (historical dates work too)
- `March 15 2024` or `15 March 2024` (month names with day + year)

**Minimum requirement:** Include at least the year. Chronologue mode will gracefully infer the missing pieces so you can keep writing:

```yaml
When: 2045            # Year only → Jan 1, 2045 @ 12:00 PM
When: 2045-07         # Year + month → Jul 1, 2045 @ 12:00 PM
When: July 2045       # Month name + year → Jul 1, 2045 @ 12:00 PM
```

**Invalid examples:**
- `March` ❌ (needs year)
- `15th` ❌ (needs month + year)
- `14:00` ❌ (needs date)
- `Day 1` ❌
- `Two weeks later` ❌

**Usage:**
- **Scenes**: Used by Chronologue Mode and "Sort by When date" to arrange scenes chronologically
- **Sorting**: Enable "Sort by When date" (Settings → Configuration) to arrange scenes chronologically across the full 360° circle

> **Note**: Red “Missing When” alerts only appear once a scene’s `Status` moves to `Working` or `Complete`, so you can outline Todo scenes without warnings. Additionally, hovering over a scene with a missing date will show the dates of the previous and next scenes in narrative order to provide helpful context for placement.

---

### Synopsis
**Optional** | Type: String

Brief description of what happens in the scene. Displayed on hover in the timeline.

---

### Subplot
**Required** | Type: Array

One or more plot threads this scene belongs to. Default: `Main Plot`

Should be reserved for key scenes that advance the overall plot. Avoid overlapping scenes across multiple subplots except where truly appropriate.

Examples:
```yaml
Subplot: Main Plot              # Single subplot
Subplot:                        # Multiple subplots
  - Main Plot
  - Romance Arc
```

> **Important**: Avoid using commas within subplot names. The plugin uses comma-space (`, `) as a delimiter when processing subplot lists. For example, a subplot named "Chae Ban, Romance Arc" would be incorrectly split into two separate subplots.

---

### Character
**Optional** | Type: Array

Characters present in the scene. Use wiki links to character notes.

```yaml
Character:
  - "[[protagonist a]]"
  - "[[mentor b]]"
```

> **Important**: Avoid using commas within character names. The plugin uses comma-space (`, `) as a delimiter when processing character lists.

---

### Place
**Optional** | Type: Array

Location tags. Link to place notes using wiki links.

```yaml
Place:
  - "[[earth]]"
  - "[[space station]]"
```

---

### Status
**Required** | Type: String

Workflow status: `Todo`, `Working`, or `Complete`

Determines scene color coding in Progress Mode with Todo/Working/Complete/Overdue patterns.

---

### Progress Stage
**Optional** | Type: String

Progress stage (YAML key: `Publish Stage`): `Zero`, `Author`, `House`, or `Press`

- **Zero**: Draft stage
- **Author**: Ready for revision
- **House**: Reviewed and edited
- **Press**: Ready for release

Used for color coding in Progress mode.

---

### Iteration
**Optional** | Type: Number

Track how many times you've rewritten the scene. Leave blank until stage > zero, then increment with each edit iteration.

> **Migration note**: This field was previously named `Revision` (and `Iterations`). Both old field names are still recognized for backwards compatibility - you don't need to update existing scene notes. Only new notes will use `Iteration:`.

---

### Due
**Optional** | Type: Date (YYYY-MM-DD)

Deadline for completing this scene. Scenes past their due date are marked as overdue in the timeline.

---

### Pending Edits
**Optional** | Type: String

Concrete revisions to address. Used by Zero Draft Mode to capture editing ideas without opening the scene file.

---

### Duration
**Optional** | Type: String

How much story time passes. Supports flexible formats like "45 seconds", "45s", "2 hours", "3 days".

---

### Runtime
**Optional** | Type: String

Technical runtime for screenplay or reading time. Use formats like "2:30" (minutes:seconds) or "45s" for short durations. Distinct from Duration which measures in-world story time.

---

### Book
**Optional** | Type: String

Book project label for multi-book series.

---

## Optional Analysis Fields

### Type
Optional scene role or classification:
- revelation
- turning point
- confrontation
- decision
- setup
- payoff
- inciting incident
- deepening

---

### Shift
Optional value shift or polarity change: `+`, `-`, or `+/-` (if it flips both ways)

---

### Questions
What is the reader wondering at this point?

---

### Reader Emotion
Expected emotional response: curious, shocked, uneasy, hopeful, betrayed, triumphant, etc.

---

### Internal
How do the characters change? (e.g., from trusting → suspicious)

---

## AI Scene Beats Analysis

### previousSceneAnalysis
**Auto-generated** | Type: Array

AI-generated analysis of the previous scene in the triplet.

```yaml
previousSceneAnalysis:
  - 12 Inciting clue + / Raises stakes for the protagonist
```

---

### currentSceneAnalysis
**Auto-generated** | Type: Array

AI-generated analysis of the current scene, includes a grade (A/B/C).

```yaml
currentSceneAnalysis:
  - 13 A / Excellent pacing [br] Cut repetition in second paragraph
```

Use `[br]` to force line breaks in timeline hover display.

---

### nextSceneAnalysis
**Auto-generated** | Type: Array

AI-generated analysis of the next scene in the triplet.

```yaml
nextSceneAnalysis:
  - 14 Setback ? / Plan fails at the last moment
```

---

### Pulse Update
**Optional** | Type: String

Set to `Yes` to flag a scene for AI pulse (triplet) analysis. Legacy `Review Update`/`Beats Update` values are still recognized.

---

### Summary Update
**Optional** | Type: String

Flag to indicate the summary needs updating or has been updated. Set to `Yes` to flag a scene for AI summary generation. After processing, replaced with a timestamp and model ID. Legacy `Synopsis Update` values are still recognized.

---

### Summary
**Optional** | Type: String

AI-generated extended scene analysis (≈200–300 words, configurable) for inquiry and deep exports. Generated by the "Summary refresh" command (with an optional Synopsis update). Distinct from the short Synopsis field used for hovers and outlines.

---

## Gossamer Fields

### Gossamer1-30
**Optional for Beats** | Type: Number (0-100)

Momentum scores for beat analysis in Gossamer view.

- **Gossamer1** is the oldest score (first trace)
- **Gossamer2-30** store subsequent traces in chronological order
- The **highest numbered field** contains the most recent score (e.g., Gossamer5 is newer than Gossamer3)
- Supports up to 30 historical tracking points
- Each new Gossamer analysis appends a trace to the next sequential number

```yaml
Gossamer1: 4     # First trace (oldest)
Gossamer2: 8     # Second trace
Gossamer3: 12    # Third trace (most recent in this example)
```

After running a fourth analysis with score 15:
```yaml
Gossamer1: 4     # First trace (oldest)
Gossamer2: 8     # Second trace
Gossamer3: 12    # Third trace
Gossamer4: 15    # Fourth trace (now the most recent)
```

---

### GossamerStage1-30
**Optional for Beats** | Type: String (Zero/Author/House/Press)

Tracks the dominant progress stage when each Gossamer trace was created. Automatically saved alongside Gossamer scores.

- Each `GossamerStageN` corresponds to the same trace as `GossamerN`
- Used for stage-based coloring of historical Gossamer traces
- **Zero** (purple): Default starting stage
- **Author** (blue): Unlocks when all scenes complete Author stage
- **House** (orange): Unlocks when all scenes complete House stage
- **Press** (green): Unlocks when all scenes complete Press stage

```yaml
Gossamer1: 4
GossamerStage1: Zero      # First trace was during Zero stage
Gossamer2: 8
GossamerStage2: Zero      # Second trace still during Zero stage
Gossamer3: 12
GossamerStage3: Author    # Third trace after completing Author stage
```

In Gossamer Mode, historical traces display in their stage color with saturation gradients—older traces within the same stage appear more muted, while newer traces appear more vibrant.

---

## Beat Model
**Optional for Beats** | Type: String

The story beat system this beat belongs to:
- Save The Cat
- Hero's Journey
- Custom

---

## Description
**Required for Beats** | Type: String

Explanation of what this story beat represents and its purpose in the narrative structure.

---

## Custom Fields

You can add any additional frontmatter fields for your personal writing process. The Radial Timeline plugin will safely ignore fields it doesn't recognize.

Example custom fields:
- `Total Time`: Writing/production time in hours
- `Words`: Scene word count
- `Support Files`: Attachments, references, research notes
- `POV`: Optional point-of-view keyword. Provide a single word:
  - `first`, `second`, `third`, `omni`, or `objective` — override the global narration mode.
  - `second` / `you` inserts `You²`; `omni` inserts `Omni³`; `objective` inserts `Narrator°`; first/third attach `¹`/`³` to the first listed character.
  - Counts (`two`, `4`, `count`, `all`, etc.) highlight that many leading characters using the current mode (global default if no mode keyword appears). Counts are clamped to the number of names under `Character:`.
  - Any positive integer works (`pov: 5`). Use `pov: count`/`pov: all` to highlight everyone.
  If the field is omitted entirely, the global setting applies (default: first listed character, `¹`).
- `Tone`: Scene mood or atmosphere

---

## Tips

1. **Start minimal**: Begin with just `Class`, `Act`, `Status`, and `Subplot`
2. **Add fields gradually**: Introduce more fields as your workflow develops
3. **Use sets**: Create scene and beat sets with your preferred fields
4. **Link liberally**: Use wiki links for characters, places, and cross-references
5. **AI beats**: Set `Pulse Update: Yes` to include in analysis runs
6. **Manual line breaks**: Use `[br]` in AI beat text to control hover display wrapping

---

## A Note on YAML Comments

YAML supports inline comments using `#`. While the examples in this reference include comments to explain each field, be aware that **Obsidian may strip comments** when you reorder or edit frontmatter fields through its UI.

For this reason, the plugin's built-in sets do not include comments. Use this reference document to understand what each field means rather than relying on inline comments in your scene notes.
