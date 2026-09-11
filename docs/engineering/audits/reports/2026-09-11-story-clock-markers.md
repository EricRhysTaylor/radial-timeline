# Story clock markers audit

Requested scope: display the best determinable current story time at cues and prevent overlapping labels.

The transient snapshot derives a clock from an explicit When time, confirmed contributions, proposed advances/checkpoints, and numeric/noon/midnight anchors. Confirmed elapsed accounting is unchanged. Proposed or incomplete sequences retain an estimated flag; derived labels use approximately-sign and amber. Direct clock anchors keep their literal time with status color. Dawn/dusk do not invent a sunrise/sunset hour, and date-only starts do not invent midnight. Backward/excluded cues do not advance the story clock. Cache validity now includes When so changed start times update the ruler.

Editor measurement spaces cue hit targets in source order using their actual heights. Reading sections apply the same minimum spacing between their cue targets. Existing source tooltips and click targets remain intact. Live Obsidian inspection verified separated Three hours/dawn markers, readable clock labels, and Reading-mode clock tooltips. Editing mode restored. No author prose, saved decisions or confirmed totals modified.

Post-change review: no blocking issues. No architectural refactor, new persistence schema, dependency or timer coupling. This is a clock-of-day estimate, not an inferred calendar/day assignment or semantic interpretation of plans and flashbacks. Adjacent Reading sections, popouts and mobile were not exhaustively visually certified. Existing unknown-anchor behavior intentionally declines numeric estimates until a new usable anchor or start-relative checkpoint.

All 15 gates passed including build/TypeScript, lint baseline, CSS checks and full tests. New regressions cover confirmed 5pm + 3h = 8pm, midnight rollover, propagation from a 3am prose anchor without changing elapsed accounting, and no invented clock for date-only When or dawn. Existing report-only notices unchanged.
