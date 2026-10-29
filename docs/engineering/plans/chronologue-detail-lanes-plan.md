# Chronologue detail lanes

Date: 2026-10-29
Status: proposal. A mockup on the Pride & Prejudice demo was reviewed with Eric on 2026-10-29; nothing is built. No public release is implied.

## Purpose

Chronologue already shows when scenes happen. It says little about whether the chronology holds together. The Timeline Date Audit finds contradictions, but its results only appear in its dialog. Nothing checks for a character who is in two places at once.

Detail lanes are thin bands in the ring area that carry this information on the wheel itself:

- **The flag lane** marks scenes that need attention: Date Audit findings, and characters in two places at once.
- **Character lanes** follow a few chosen characters through the book, one lane each. Each lane has a mark for every scene the character is in, colored by Place.

## Where the lanes sit

- **The center core is not touched.** Everything inside `INNER_RADIUS` (200) stays as it is: the progress ring (193), the session timer ring, the target ticks and the counts grid.
- **The lanes are carved out of the ring band** (200 to 750 in Chronologue) through the existing `fixedRings` allocation in `src/renderer/utils/Precompute.ts`, the same way the Backdrop and micro-backdrop rings are. The subplot rings share what is left.
- **All the lanes sit together at the outer edge of the band**, just inside the All Scenes ring: the flag lane first, then the character lanes. In the mockup the character lanes were at the inner edge. That placement was rejected because, a few pixels outside the session timer ring, they read as more center-core rings.
- **Nothing goes outside 750.** The duration arcs (758), the Shift elapsed arc (766) and the month ticks and labels (764 to 799) already use that space.

**Cost.** Four character lanes and the flag lane take about 50px of the 550px band, about 9% off each ring:

| Rings | Width each now | With lanes |
|---|---|---|
| 7 | 79px | 71px |
| 10 | 55px | 50px |
| 12 | 46px | 42px |

Two rules keep the cost down:

- **The flag lane takes no space when it has nothing to show**, as micro-backdrop rings take none when there are no lanes. A book with no findings loses nothing.
- **Character lanes are off until the author chooses characters**, and are capped at four. Past about ten rings even four lanes make titles tight, so the cap may need to drop as the ring count rises. Settle this when building.

## The flag lane

- **Date Audit findings.** The lane shows the results of the last Date Audit run: contradictions in red, warnings in amber. Scenes the audit calls undated are already marked by the red number square for Working and Complete scenes, so the lane does not repeat them.
- **Characters in two places at once.** A scene is flagged when a character in it is also in a scene at a different Place whose time span overlaps. The spans must truly overlap. Two scenes on the same date are not a conflict: in the demo, Fitzwilliam's revelation in Rosings Park and the proposal at Hunsford share 29 April, and that is an ordinary day. The check runs only when both scenes have a time, or a time and a Duration, that make the overlap certain.
- **Hovering a flag** shows a card naming the finding: the character, both scenes, their Places and times, or the audit's message.

The two-places check is a new Date Audit finding in `src/timelineAudit/`, not a separate calculation for the wheel. The Date Audit stays the one owner of chronology findings, and the lane only displays them.

## Character lanes

- **Choosing characters.** The author picks up to four from the values of Character. The Timetable already lists every distinct value of a column and keeps a palette of up to eight chosen values (`src/timetable/timetableModel.ts`). Reuse that list, and don't build a second picker.
- **Place colors** come from the Timetable's color key when it colors by Place. With no Place key, marks use one neutral color.
- **Hovering a mark** lights the scene, as hovering a scene does.

## What the data needs

The demo showed three gaps. Each limits what the lanes can say until the author's notes fill it:

- **Place.** No demo scene has one. The two-places check and the Place colors both need it. A "missing Place" flag is not a fix: on a book without Places it would mark every scene and bury everything else.
- **Times and Duration.** No demo scene has a Duration, and When is mostly a date. Without times the two-places check stays quiet, which is correct.
- **Who is in the scene.** In the demo, Character lists who is mentioned as well as who is present. Darcy is listed in scene 33 only because Fitzwilliam talks about him, so a check would place him at Rosings Park while he is elsewhere. The check needs Character to mean "on stage", or another field that does. Which one is a decision for Eric. Scene YAML belongs to the author, so any new field has to serve the author first.

## Saving Date Audit results

The flag lane needs the last audit's results when the wheel opens, without running the audit again on every render. Save them in plugin data or a sidecar keyed by scene ID, schema-stamped, with the run's timestamp. Never write them to scene frontmatter. A scene edited since the run keeps its flag until the next run, and its card says when the audit ran.

## Shift and visibility

The lanes add no Shift or Alt behavior. Once turned on, character lanes are always visible in Chronologue, and the flag lane appears whenever it has something to show. Shift keeps its x-ray, elapsed comparison and discontinuity marks. The lanes appear only in Chronologue.

## Open questions

- **Time-reference markers.** Reference squares sit at the inner edge of the All Scenes ring, and their feeds run inward from there (`chronologue-time-references-plan.md`). The flag lane would sit right under them. Settle which goes where before building.
- **Duration overlap arcs.** The arcs at 758 compare adjacent scenes only and ignore characters (`detectSceneOverlaps` in `src/utils/date.ts`). Once the two-places check exists, decide whether the arcs stay, change, or go. Two different overlap answers on one wheel would contradict the single-source rule.
- **Where the controls live**: the timeline's key area, the Timetable, or settings.

## Phases

1. Save Date Audit results and show them in the flag lane.
2. Add the two-places check as a Date Audit finding, gated on Place and overlapping time spans.
3. Add character lanes, with the characters and Place colors taken from the Timetable.
