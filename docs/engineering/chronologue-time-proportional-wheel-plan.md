# Time-proportional Chronologue: exploration plan

Status: exploration only. The existing scene-proportional Chronologue remains the baseline. The first implementation is an isolated, tested scale model; it is not yet connected to the timeline.

## Question

Can an optional view show elapsed story time through angular distance while keeping scenes, subplot membership and the author's date precision legible? A scene-proportional wheel gives every scene room; a time-proportional wheel reveals gaps, clusters and chronology at the expense of that room.

## Prototypes to compare

Direction selected for the first visual prototype: change only the All Scenes outer ring, initially keeping subplot rings independently arranged. Compare compressed and strict linear time as explicit choices. A later optional alignment could draw subplot scenes at their matching outer-ring angles, like Narrative's Sequence, while retaining the independent arrangement for readability. Chronologue's existing Shift interaction must remain available.

1. **Linear time:** map the earliest and latest known times to the ends of the circle; equal elapsed time has equal angle. Show scene markers at their times, with overlapping scenes stacked or grouped rather than given invented offsets.
2. **Compressed gaps:** apply a clearly signposted piecewise scale to very large gaps. Mark each compression and show its real duration on hover. This is not a linear time axis; compare its readability with the linear version.
3. **Time outside, scenes inside:** retain scene-sized arcs and add a separate proportional time track with connections. This preserves interaction targets but adds visual complexity. Evaluate it before assuming the whole wheel must change.

## Decisions before implementation

The experimental `compressedTimeScale.ts` models known dates as points or uncertainty ranges, preserves simultaneous events, and shortens only empty gaps above a supplied threshold. It exposes each gap's actual duration and angle for honest break markers. Thresholds and angular margins are test inputs, not product defaults; undated notes remain outside this model. Empty and zero-span domains are rejected until a deliberate display is designed.

- Define the relationship between scene start, scene duration and the scene-shaped wedge. A point, an interval and an unknown duration must look different.
- Treat date-only, month-only and year-only `When` values as ranges of possible time, not exact instants. Decide how to show uncertain ranges and overlapping dates, including BCE/CE and custom planetary calendars.
- Decide how undated scenes and floating sketches appear without suggesting they occurred at an invented time.
- Establish a minimum accessible hit area for dense events without changing their factual time positions. Explore clustering, zoom and an adjacent event list.
- Preserve a continuous zero-to-end seam, handle single-date or zero-span books and provide a truthful scale with readable labels.
- Identify how scene selection, hover, time references, discontinuities, subplot rings, colors, filtering, keyboard use, exports and the Timetable connect to the new geometry. Dragging must never silently modify a date because a marker was visually displaced.
- Keep the choice explicit and explain the difference between equal-scene and proportional-time views. Do not silently alter existing layouts or saved views.

## Acceptance research

Build a disposable comparison using a one-day thriller, a year-long novel, a multigenerational story with a large gap, a BCE/CE history, an alien calendar and a manuscript with many simultaneous or undated scenes. Compare at normal and narrow pane sizes. Inspect geometry, labels, hit targets and actual elapsed-time accuracy; test scale changes, mode switching, reload and Timetable links in an isolated vault. Show the options to the author before choosing a direction.
