# Stable duration marker follow-up

Requested scope: cue shifts during scrolling and readable numeric durations even without a reliable story clock.

Removed viewport-dependent vertical collision packing. Marker positions now stay tied to their phrase anchors; cues on the same source line use fixed horizontal lanes based on source order in both editor and Reading rendering. Removed geometry-version marker identity, which rebuilt unchanged DOM on layout changes. Source, metadata and decision changes continue to refresh snapshots; scrolling only measures layout.

Marker labels now describe the cue itself: +3h for advances, =8h for checkpoints, negative durations for backward references, explicit clock text for anchors, and ? only when a duration is unavailable. Inferred story clocks remain available in tooltips. Confirmation colors apply to the cue decision rather than inherited uncertainty in an inferred clock. Confirmed header accounting, author decisions and YAML are unchanged.

Regression verifies +3h remains +3h for missing, date-only and clock-bearing When; unquantified cues and direct 3am labels remain distinct. Production build and full gates passed. Final build reloaded in Obsidian and duration label visually inspected at the three-hour cue. Native continuous trackpad-scroll behavior was not exhaustively certified. Fixed horizontal lanes may consume additional right-margin space when many cues share a source line; they avoid assigning a different vertical phrase anchor.

Post-change review found no blocking issues. No architecture refactor, new dependencies or schema change. Unrelated working-tree files preserved.
