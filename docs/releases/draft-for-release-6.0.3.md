## Radial Timeline 6.0.3

This is a focused workflow release.

### Improvements

- Added a Timeline legend for Progress, Narrative, and Chronologue modes.
- Added a right-click scene menu on the Timeline for quick Status, Publish Stage, and Triplet Pulse flag changes.
- Manuscript Export now persists more of the last-used export state, including export type pills, synopsis/word-count toggles, and saved scene ranges.
- Manuscript Export can reveal exported files directly in the system file manager on desktop, with Obsidian file explorer fallback.
- Settings now show clickable folder chips for system-defined save locations such as logs and exports.
- Tightened CSS namespace rules and drift checks for new UI chrome.
- Refreshed model metadata snapshots, aliases, and drift reports.

### Documentation

- Updated Timeline, CSS, and UI architecture docs for the new Timeline legend and namespace rules.

### Bug Fixes

- Fixed Status Grid progress math when one scene is marked `Press`; grid counts, stage completion, milestone state, APR progress, and timeline metrics now share the same scene-progress logic.
- Fixed Runtime Processing modal behavior when no AI runtime estimate is requested; the AI Prompt & Context panel is now shown only for AI runs.
- Fixed Inquiry briefing print/PDF output by rendering a dedicated print host instead of racing modal style restoration.
- Fixed Manuscript Export templates so saved ranges restore after scene loading instead of being reset to the full book.
