This page covers scene properties (core and advanced), beat notes, and backdrop notes. Radial Timeline reads these from **Obsidian properties** at the top of each note. If you prefer to keep things light, you can start with only the minimal properties and fill in the rest later.

## Core Scene Scaffold

```yaml
ID: scn_00000000          # Auto-generated stable scene reference
Class: Scene              # Type: Scene
Act: 1                    # Which act (1-3)
When:                     # Story chronology date (YYYY-MM-DD 12:34pm)
Duration:                 # How long the scene lasts (e.g., "45 seconds", "45s", "45sec", "2 hours", "3days")
Part:                     # Optional part marker — `true` for numeral only, or a title
Chapter:                  # Optional chapter marker for publishing and perimeter placards
Synopsis:                 # Concise present-tense snapshot for hovers/outlines (1-3 sentences)
Summary:                  # Extended scene expansion (events, emotional turns, subtext, outcome)
Pending Edits:            # Notes for next revision (especially for zero draft mode)
Subplot: Main Plot        # Single subplot (or use array format below for multiple)
Character:                # Characters in the scene (use array format below for multiple)
POV:                      # blank, first, you, third, omni, narrator, two, all, count
Words:                    # Optional word count/statistics
Runtime:                  # Optional runtime estimate or override
Publish Stage: Zero       # Progress stage (Zero/Author/House/Press)
Status: Todo              # Scene status (Todo/Working/Complete)
Due:                      # Target completion date (YYYY-MM-DD). When setting Scene to Complete, change this to that day's date for better novel completion estimate
Pulse Update:             # AI-generated scene pulse analysis flag
Summary Update:           # Summary refresh flag
```

Book Designer and Create note generate the core scaffold above. `ID` is inserted automatically for stable scene citations, and the scene properties editor can maintain the current core and advanced field order.

**For multiple subplots or characters, use YAML list format:**
```yaml
Subplot:
  - Main Plot
  - Subplot 1
Character:
  - "Protagonist"
  - "Mentor"
  - "Child One"
Place:
  - "Castle"
  - "Forest"
  - "Planet Nine"
```

Obsidian links are supported in properties. Use the double-bracket wikilink format inside quotes if you want a field to link to a note.

## POV Keywords

*   `pov: first` — first listed character gets a `¹` marker.
*   `pov: second` / `pov: you` — inserts `You²` ahead of the cast.
*   `pov: omni` — shows `Omni³` to signal an omniscient narrator.
*   `pov: objective` — shows `Narrator°` for camera-eye scenes.
*   `pov: two`, `pov: 4`, `pov: count`, `pov: all` — highlight multiple carriers.

You can control how POV is displayed in **Settings → Core → Point of view**.

<a name="advanced-scene-template"></a>
## Advanced Scene Properties

Advanced scene properties add optional fields for deeper workflows (Dramatica, custom analysis, and more). This profile is **customizable**.

```yaml
ID: scn_00000000
Class: Scene
Act: 1
When: 2085-01-01 1:30pm
Duration: 6 hours
Chapter:
Synopsis: What happens in a few lines.
Summary: The longer scene summary.
Pending Edits:
Subplot:
  - Subplot 1
  - Subplot 2
Character:
  - "Character 1"
Place:
  - "Earth"
Publish Stage: Zero
Status: Todo
Due:
Pulse Update: No
Summary Update:
Words:
Runtime:
Iteration:                            # Edit iteration count (deprecated: was "Revision")
Type:                                 # Optional scene role or classification
Shift:                                # Optional value shift or polarity change
Questions:                            # Analysis Block
Reader Emotion:
Internal: How do the characters change?
```

<a name="advanced-yaml-editor"></a>
### Scene Properties Editor

The Scene properties editor lets you tailor the advanced scene properties while keeping required base keys intact. Add, remove, or reorder optional fields to match your workflow.

*   Enable **Settings → Core → Scene properties → Scene properties editor**.
*   Required base keys stay locked and auto-included in order.
*   Optional keys can be drag-reordered, renamed, deleted, or added.
*   RT-managed maintenance only governs the core and current advanced scene-property fields.
*   External or foreign YAML properties are preserved and are not deleted by scene-property maintenance.
*   Reorder keeps foreign keys attached to the RT-managed item directly above them instead of pushing them into a generic end block.
*   Use the restore icon to revert to the shipped defaults.

## Beat Notes (YAML)

```yaml
ID:                           # Auto-inserted unique id
Class: Beat                   # Formerly Plot, Deprecated
Beat Model: Save The Cat
Act: 1
Purpose: Why this beat exists in the structure (1-2 sentences, avoid retelling scene events).
Range: 0-20
Chapter:
Gossamer1: 12                 # First trace (oldest) - Up to 30 saved traces
Gossamer1 Justification:
Gossamer2: 21                 # Second trace (most recent in this example)
Gossamer2 Justification:
```

> **Beat semantics**: Beats are structural, not temporal. They do not use the `When` field — ordering comes from Act assignment and filename prefix (`sceneInteger.minor`, for example `7.01`).

Beat notes have their own **Beat properties editor** in **Settings → Core → Story beats system**. Use it to add custom keys and choose which fields appear in beat hovers. Beat properties are stored per beat system.

## Backdrop Notes (YAML)

```yaml
Class: Backdrop                   # Used for special context events that move the plot. Appears as a dedicated ring in Chronologue mode. See also micro-backdrop rings for lighter-weight context.
When:                             # Start Date time (YYYY-MM-DD HH:MM)
End:                              # End Date time (YYYY-MM-DD HH:MM)
Context: Static world context this backdrop represents (no scene-level unfolding).
```

Backdrop notes can be extended using the **Backdrop properties editor** in Settings.

## YAML Managers in Settings

*   **Scene properties editor**: In **Settings -> Core**, customize advanced scene properties and hover metadata.
*   **Beat properties editor**: Customize beat note fields and beat hover metadata.
*   **Remap frontmatter field keys**: In **Settings -> Advanced -> Configuration**, map your existing keys to Radial Timeline keys without rewriting your files.

See [Scene properties](Settings-Core#scene-properties), [Configuration](Settings-Advanced#configuration), and [Story beats system](Settings-Core#story-beats-system) for configuration details.

## Remap Frontmatter Field Keys

If your vault already uses different property names for scene notes, you can map them to Radial Timeline's system keys in **Settings -> Advanced -> Configuration** with **Remap frontmatter field keys**.

Example: If you use `Timeline: 2024-01-01` instead of `When: 2024-01-01`, create a mapping from `Timeline` to `When`.

## Backwards Compatibility

The plugin automatically recognizes legacy field names, so you don't need to update existing scene notes when field names change:

| Current Name | Legacy Names (still work) |
|--------------|---------------------------|
| `Iteration:` | `Revision:`, `Iterations:` |
| `Purpose:` | `Description:` |
| `Context:` | `Synopsis:` (Backdrop only) |

Beat notes do not use `When:` — they are ordered structurally by Act and filename prefix. Recommended format: fixed-width decimal minors (`1.01`, `1.02`, ...).

Existing notes with old field names will continue to work. Only new notes created from the built-in property profiles will use the current field names.
