# Character lanes and chronology findings

Date: 2026-10-29
Status: phase 1 (Narrative character lanes) built on 2026-10-29, without Place colors; phases 2 to 4 not started. Two mockups on the Pride & Prejudice demo were reviewed with Eric on 2026-10-29: the whole wheel, then close-ups of the outer band. Eric decided:
- where Character and POV come from;
- that character lanes go in Narrative;
- that chronology findings stay in Chronologue, on the duration arcs (option C);
- that the lanes stay out of Progress and Gossamer, which stay simple;
- the finding colors, and that the four characters are chosen automatically, with no picker.

Nothing is built yet, and no public release is implied.

## Purpose

The plan has two parts, and each lives in the mode that suits it:

- **Character lanes, in Narrative.** These are thin lanes that follow up to four chosen characters through the manuscript, one lane each. The reader meets scenes in manuscript order, so that order shows what character analysis needs: how often a character appears, how the POV passes between characters, and how long a character is gone (Jane vanishing for ten scenes).
- **Chronology findings, in Chronologue.** These are Timeline Date Audit results and characters in two places at once. Both are about story time. Today the Date Audit's results appear only in its dialog, and nothing checks for a character in two places.

Chronologue already has a lot going on: Backdrop and micro-backdrop rings, time references, duration and elapsed arcs. So it gets no new lanes, only new colors on marks it already draws.

## Character and POV

- **The lanes read the scene's `Character` YAML.** Character lists the people in the scene, so a name there means the character is present. No new field is added.
- **The first character in the list is the POV character.** Which entries count as POV comes from `resolveScenePov` (`src/utils/pov.ts`), the rule the rest of the plugin uses. That rule takes the global POV setting, or the scene's own POV override; for example, `two` marks the first two characters. In second-person, omniscient and objective modes, no character is POV.
- **Mark height shows POV.** A POV scene gets a full-height mark in that character's lane. A scene the character is in without being POV gets a half-height mark.
- **Demo data.** The Pride & Prejudice demo's Character lists include characters who are only mentioned. For example, Darcy is listed in scene 33 because Fitzwilliam talks about him. Under this rule the demo puts him in the scene, so its lists need trimming before it can show the two-places check honestly. The source of truth is the designated demo folder (`Platform/DEMO-VAULT-PIPELINE.md`).

## Character lanes in Narrative

- **Placement.** The lanes sit just inside the All Scenes ring. They are carved out of the ring band (200 to 766 in Narrative) through the existing `fixedRings` allocation in `src/renderer/utils/Precompute.ts`, the same mechanism Chronologue uses for its Backdrop rings. The subplot rings share what is left.
- **Nothing else competes for the space.** Backdrop rings, micro-backdrop rings and time references are drawn only in Chronologue (`shouldIncludeBackdrop` in `Precompute.ts`; time references were limited to Chronologue in `6f3df2db`). In Narrative, the band under the All Scenes ring is clear.
- **The center core is not touched.** Everything inside `INNER_RADIUS` (200) stays as it is: the progress ring (193), the session timer ring, the target ticks and the counts grid.
- **Beats.** Beats sit in the All Scenes ring, so the lanes show a gap under each beat.
- **The runtime view** pulls the Narrative rings in to 750 and draws its arcs at 758. The lanes stay inside the band, so they should not collide, but check this when building.
- **Data needed.** The lanes need only Character, with the POV character first, so they work on almost any book without Place, times or Duration. The Pride & Prejudice demo can show them as it is.
- **Lane colors and names.** Each lane has its own color (the theme's cyan, orange, green and pink). The names are not drawn on the wheel, where they were unreadable at small sizes; the ring key lists them between All Scenes and the first subplot, each beside its color, and hovering one spotlights that character's scenes (Eric, 2026-10-29).
- **Place colors are not built.** Lanes are colored by character, so coloring marks by Place would need another channel. Revisit only if authors ask.
- **Choosing characters.** There is one lane per character, and a book can name thirty people in Character, so something has to pick which four get lanes. The first name in each scene's list decides whether a mark is POV; it does not decide which lanes exist. The recommendation is no picker: the lanes go to the four characters who hold POV in the most scenes. If fewer than four characters ever hold POV, as in a single first-person narrator, the rest go to the characters who appear in the most scenes. Ties go to the earlier first appearance. The order is deterministic and needs no stored choice. A picker can come later if authors ask for one.
- **Hovering a mark** lights the scene, as hovering a scene does.
- **Off by default.** One setting turns the lanes on. Until then they take no space.

**Cost.** Four lanes take about 36px of Narrative's 566px band:

| Rings | Width each now | With four lanes |
|---|---|---|
| 7 | 81px | 76px |
| 10 | 57px | 53px |
| 12 | 47px | 44px |

Past about ten rings, even four lanes make titles tight, so the cap may need to drop as the ring count rises. Settle this when building.

## Chronology findings in Chronologue

### Duration arcs and the two-places check

**What the duration arcs already do.** Chronologue draws a 6px arc for every scene at radius 758, just outside the All Scenes ring (`renderDurationTickArcs` in `src/renderer/components/ChronologueTimeline.ts`):

- **Length** shows the scene's Duration, scaled so the longest scene fills its slot.
- **A red stub** (`--rt-color-due`) means the Duration is missing or can't be read.
- **Orange** means the scene is still running when the next scene in time starts: its When plus its Duration is later than the next scene's When (`detectSceneOverlaps` in `src/utils/date.ts`). An `ongoing` duration is also orange. The orange is a hardcoded `#ff9900` in `src/styles/chronologue-base.css`, which the no-hex rule forbids.

**What the two-places check adds.** Orange answers "do these scenes run at the same time?" Often they're meant to, as in parallel action with different people. The two-places check answers a narrower question: does an overlap put the same character in two different Places? That can't happen. Every two-places conflict is an overlap, but most overlaps are not conflicts.

So the check doesn't add a new kind of mark. It refines the orange one:

- **There is one overlap calculation**, used by both the duration arcs and the two-places check. Today's check compares each scene only with the next one in time. It moves into the Date Audit and finds every overlapping pair, so a long scene that runs past two later scenes is caught too.
- **The arc turns red** when an overlap puts a character in this scene and also, at a different Place, in the scene it overlaps. Its hover card names the character, both scenes, their Places and their times.
- **Same-date scenes are not conflicts.** The check needs times, or a time and a Duration, that make the overlap certain. Fitzwilliam's revelation at Rosings Park and the proposal at Hunsford share 29 April, and with dates alone they stay quiet.
- **Data needed.** The check needs Place, plus times or Duration. The Pride & Prejudice demo has none of these. A "missing Place" flag is not the answer: on a book without Places it would mark every scene and bury everything else. Without the data, the check stays quiet, which is correct.

### Date Audit findings

- **A Date Audit contradiction or warning is a small diamond on that scene's duration arc.**
- **Undated scenes are not marked again.** The red number square already marks undated Working and Complete scenes.
- **Saving results.** The wheel shows the last run's results without running the audit again on every render. Results are saved in plugin data or a sidecar, keyed by scene ID and schema-stamped, with the run's timestamp. They are never written to scene frontmatter. A scene edited since the run keeps its diamond until the next run, and the hover card says when the audit ran.
- **The two-places check is a Date Audit finding** in `src/timelineAudit/`. The Date Audit stays the one owner of chronology findings, and the wheel only displays them.

### Options reviewed for Chronologue

A close-up mockup on 2026-10-29 compared these placements:

- **As first written: a flag lane 6px under the All Scenes ring.** No pixels overlap, but the flags and the time-reference squares are both small colored marks along the same edge. The amber flag also repeats the overlap the orange arc already shows. Rejected.
- **A: move the lanes to the inner edge of the band**, beside the center. The innermost lane would sit about 5px outside the session timer ring and could read as another center ring. The overlap would still be marked twice. Rejected.
- **B: move the time-reference squares to the outer edge of the All Scenes ring.** They would land on the titles and number squares. Not workable.
- **C: no flag lane, with findings on the duration arcs. Chosen.** Later, Eric moved the character lanes to Narrative, so Chronologue gets no lanes at all.

### Colors

Each color answers one question, and the colors follow the Date Audit's own scale, so a finding looks the same on the wheel and in the Date Audit dialog.

| Mark | Meaning | Color |
|---|---|---|
| Arc, muted | Normal duration | `--text-muted` (unchanged) |
| Short red stub | Duration missing or unreadable | `--rt-color-due` (unchanged) |
| Arc, orange | Runs into the next scene in time; often intended | `--text-warning`, replacing the hardcoded `#ff9900` |
| Arc, red, full length | Same character in two Places at once | `--text-error`, the Date Audit's "impossible" color |
| Diamond | Date Audit warning or contradiction | The Date Audit strip's color for that severity, with a thin `--background-primary` outline so it shows against an orange arc |

- **The two reds are told apart by shape.** The missing-Duration stub is short and sits at the scene's start. The two-places arc runs the scene's full Duration into the scene it collides with. If they still read alike once built, change the stub, because missing data is the lesser problem.
- **One source for severity colors.** The Date Audit's strip mixes its colors inline today (`src/styles/timeline-audit.css`). Lift them into shared variables that the strip and the diamond both use, rather than copying them.

## Shift and visibility

Nothing here adds Shift or Alt behavior. Once chosen, character lanes are always visible in Narrative. Findings show in Chronologue whenever they exist. Shift keeps its x-ray, elapsed comparison and discontinuity marks.

## Phases

1. Add character lanes in Narrative, with POV from `resolveScenePov` and the four characters chosen automatically. **Built 2026-10-29**: `src/renderer/utils/CharacterLanes.ts` (choice and geometry), `src/renderer/components/CharacterLanes.ts` (drawing), space reserved by `outerRingInset` in `computeRingGeometry`, setting under Core → Point of view. Names live in the ring key (`SubplotKeyController.ts`), with per-lane colors.
2. Move overlap detection into the Date Audit as all-pairs, and have the duration arcs read it. Swap `#ff9900` for `--text-warning`. Nothing else changes visibly except overlaps the adjacent-only check missed.
3. Save Date Audit results and show them as diamonds on the duration arcs.
4. Add the two-places check, turning the overlap arc red.
