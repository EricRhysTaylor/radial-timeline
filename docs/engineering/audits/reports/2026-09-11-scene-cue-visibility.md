# Scene cue visibility and context audit

Requested scope: scene name in the optional-check pill; workflow description below the modal title; color the exact matching phrase in paragraph context; first-row Advanced / Configuration / Timeline Display toggle for the vertical ruler only.

Implemented using the existing header, dense setting row, settings persistence and refresh subscriptions. showSceneTimeCueBar defaults to true to preserve the existing display. Editor snapshots are suppressed for the ruler only when disabled; Reading rails hide and restore through their existing subscription. Header snapshots and operational decisions remain available regardless of this setting. No new YAML, persistence schema, dependency, or architectural refactor.

Context highlighting uses the scanner's paragraph-relative offset, including repeated identical phrases, rather than searching for the first textual match. The offset is transient; existing sidecar decision keys are unchanged. Only the matching span gets the same semantic color variable as its cue card/ruler. Text rendering uses safe DOM spans; source prose is untouched.

Post-change review found no blocking issues, dead-code cleanup or further refactor required. New setting follows the surrounding optional-boolean/default pattern. Live Obsidian verification: first row appears in the specified section; off removes editor markers; Reading view remains clear when off; on restores Reading markers without reopening the note; title-bar timing persists throughout. Setting restored to on and editing mode restored. Pill, explanatory subtitle and amber phrase in expanded paragraph visually verified. No author cue decisions changed.

All 15 gates passed, including production build, TypeScript, CSS checks, lint baseline and full tests. Added a regression for exact occurrence offsets in a repeated-phrase paragraph. Existing report-only notices remain unchanged. Popout and mobile visual verification deferred; no release blocker identified.
