# Chronologue detail lanes

Date: 2026-10-29
Status: proposal. Two mockups on the Pride & Prejudice demo were reviewed with Eric on 2026-10-29: the whole wheel, then close-ups of the outer band. Eric settled where Character and POV come from. Where the findings go (option C below) is recommended and waiting on Eric. Nothing is built, and no public release is implied.

## Purpose

Chronologue already shows when scenes happen. It says little about whether the chronology holds together. The Timeline Date Audit finds contradictions, but its results only appear in its dialog. Nothing checks for a character who is in two places at once.

This plan puts that information on the wheel:

- **Character lanes** follow a few chosen characters through the book, one thin lane each. Each lane has a mark for every scene the character is in, colored by Place.
- **Chronology findings**: Date Audit results and characters in two places at once, shown on the duration arcs Chronologue already draws (option C).

## Character and POV

- **The lanes read the scene's `Character` YAML.** Character lists the people in the scene, so a name there means the character is present. No new field is added.
- **The POV character is first in the list.** Which entries count as POV comes from `resolveScenePov` (`src/utils/pov.ts`), the same rule the rest of the plugin uses: the global POV setting, or the scene's own POV override (for example `two` marks the first two characters). In second-person, omniscient and objective modes no character is POV.
- **A POV scene gets a full-height mark** in that character's lane. A scene the character is in without being POV gets a half-height mark.
- **Demo data.** The Pride & Prejudice demo's Character lists include characters who are only mentioned. Darcy is listed in scene 33 because Fitzwilliam talks about him. Under this rule the demo puts him in the scene, so the demo vault's lists need trimming before it can show the two-places check honestly. The source of truth is the designated demo folder (`Platform/DEMO-VAULT-PIPELINE.md`).

## Duration arcs and the two-places check

**What the duration arcs already do.** Chronologue draws a 6px arc for every scene at radius 758, just outside the All Scenes ring (`renderDurationTickArcs` in `src/renderer/components/ChronologueTimeline.ts`):

- **Length** is the scene's Duration, scaled so the longest scene fills its slot.
- **A red stub** means the Duration is missing or can't be read.
- **Orange** means the scene is still running when the next scene in time starts: its When plus its Duration is later than the next scene's When (`detectSceneOverlaps` in `src/utils/date.ts`). An `ongoing` duration is also orange.

**What the two-places check adds.** Orange answers "do these scenes run at the same time?" That is often intended, for example parallel action with different people. The two-places check answers a narrower question: does an overlap put the same character in two different Places? That can't happen. Every two-places conflict is an overlap, but most overlaps are not conflicts.

So the check is not a new kind of mark. It refines the orange one:

- **One overlap calculation.** The duration arcs and the two-places check both use it. Today's check compares each scene only with the next one in time. It moves into the Date Audit and finds every overlapping pair, so a long scene that runs past two later scenes is caught too.
- **The arc turns red** when an overlap puts a character in the scene at a different Place in the overlapping scene. Its hover card names the character, both scenes, their Places and their times.
- **Same-date scenes are not conflicts.** The check needs times, or a time and a Duration, that make the overlap certain. Fitzwilliam's revelation at Rosings Park and the proposal at Hunsford share 29 April, and with dates alone they stay quiet.

## Date Audit findings

- **A Date Audit contradiction or warning is a small diamond on that scene's duration arc.** The colors are to be settled; they must stay distinct from the red "no Duration" stub.
- **Undated scenes are not repeated.** The red number square already marks undated Working and Complete scenes.
- **Saving results.** The wheel shows the last run's results without running the audit again on every render. Results are saved in plugin data or a sidecar keyed by scene ID, schema-stamped, with the run's timestamp. They are never written to scene frontmatter. A scene edited since the run keeps its diamond until the next run, and the card says when the audit ran.
- **The two-places check is a Date Audit finding** in `src/timelineAudit/`. The Date Audit stays the one owner of chronology findings, and the wheel only displays them.

## Where things sit

- **The center core is not touched.** Everything inside `INNER_RADIUS` (200) stays as it is: the progress ring (193), the session timer ring, the target ticks and the counts grid.
- **The character lanes are carved out of the ring band** (200 to 750 in Chronologue) through the existing `fixedRings` allocation in `src/renderer/utils/Precompute.ts`, the same way the Backdrop and micro-backdrop rings are. The subplot rings share what is left.
- **The All Scenes ring's inner edge belongs to time-reference squares.** They stack outward from 9 units above the inner edge, and their routes run on a track at 68% of the ring's thickness (`referenceRingGeometry` in `src/chronologue/timeReferences/layout.ts`). Scene titles sit 22 units in from the outer edge, and number squares sit at the middle of the ring.

**The options reviewed** (close-up mockup, 2026-10-29):

- **As first written:** a flag lane 6px under the All Scenes ring. No pixels overlap, but flags and reference squares are both small colored marks along the same edge, and the amber flag repeats the orange arc's overlap. Rejected.
- **A. Move the lanes to the inner edge of the band**, beside the center. This frees the All Scenes edge, but the innermost lane sits about 5px outside the session timer ring and can read as another center ring. It doesn't fix the double overlap mark either.
- **B. Move the reference squares to the outer edge** of the All Scenes ring. The squares would land on the titles and number squares. Not workable.
- **C. Recommended: no flag lane.** Findings go on the duration arcs, outside the ring. The band under the All Scenes ring holds only the character lanes, which are continuous strips and read differently from the squares.

**Cost of C.** Four character lanes take about 36px of the 550px band:

| Rings | Width each now | With four lanes |
|---|---|---|
| 7 | 79px | 73px |
| 10 | 55px | 51px |
| 12 | 46px | 43px |

Character lanes are off until the author chooses characters, and they are capped at four. Past about ten rings even four lanes make titles tight, so the cap may need to drop as the ring count rises. Settle this when building.

## Choosing characters and colors

- **Choosing characters.** The author picks up to four from the values of Character. The Timetable already lists every distinct value of a column and keeps a palette of up to eight chosen values (`src/timetable/timetableModel.ts`). Reuse that list rather than building a second picker.
- **Place colors** come from the Timetable's color key when it colors by Place. With no Place key, marks use one neutral color.
- **Hovering a mark** lights the scene, as hovering a scene does.

## What the data needs

- **Place.** No demo scene has one. The two-places check and the Place colors both need it. A "missing Place" flag is not the answer: on a book without Places it would mark every scene and bury everything else.
- **Times and Duration.** No demo scene has a Duration, and When is mostly a date. Without them the two-places check stays quiet, which is correct. The duration arcs already need the same data.

## Shift and visibility

Nothing here adds Shift or Alt behavior. Once turned on, character lanes are always visible in Chronologue. Findings show whenever they exist. Shift keeps its x-ray, elapsed comparison and discontinuity marks. All of this appears only in Chronologue.

## Open questions

- **Option C** needs Eric's pick.
- **Finding colors** on the duration arc: the two-places red, and the Date Audit diamond's colors, against the existing red stub.
- **Where the controls live**: the timeline's key area, the Timetable, or settings.

## Phases

1. Move overlap detection into the Date Audit as all-pairs, and have the duration arcs read it. Nothing changes visibly except overlaps the adjacent-only check missed.
2. Save Date Audit results and show them as diamonds on the duration arcs.
3. Add the two-places check, turning the overlap arc red.
4. Add character lanes, with POV from `resolveScenePov`, and the characters and Place colors taken from the Timetable.
