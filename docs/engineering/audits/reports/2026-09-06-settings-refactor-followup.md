# Settings refactor follow-up — 2026-09-06

Implemented a tested refactor pass across all three requested priorities following `a2a226f0`: AI discovery/loading, Publish, and Author Progress / Inquiry / Beat controls.

## Changes

### AI discovery and model loading

`LocalLlmDiscovery` now owns the two request guards, pending flags, configuration identity, invalidation, and 60-second UI safety ceilings. Requests for the same configuration share their network work. Results and failures from a superseded configuration are discarded; finishing an older request cannot clear a newer request's pending state. Closing settings invalidates both request types.

Validation now discards reports invalidated by a server/model/configuration change. A requested replacement waits for the current validation chain to settle before starting, avoiding overlapping diagnostic generations. Repeated scheduling for an unchanged active run stays deduplicated. The diagnostic transport, cold-start budget, and thenable-button protection remain intact.

### Publish settings

Extracted imported-layout summary rendering from the settings controller. It takes explicit layout metadata and description, with no plugin or vault access. Tests cover generic, chaptered, literary, manuscript, and book previews and the four-trait display limit.

Extracted layout-option reading and compaction. One normalization path now governs scene-heading modes and epigraph/attribution arrays. Interior part positions remain intact, attributions survive without epigraph text, and default-only overrides are removed. The parent retains active-book lookup and saving.

### Author Progress

Extracted date-range parsing and formatting. Fixed calendar rollover acceptance: invalid dates such as February 30 now fail validation instead of becoming March dates. Leap days, equal endpoints, and the epoch date remain valid; reversed ranges remain rejected. Other Author Progress behavior is unchanged.

### Inquiry settings

Extracted source-preset policy and removed repeated preset branches. Preserved the existing canonical contribution normalization, including full material in both active scene scopes under the Default preset. Light remains summary material; Deep includes reference classes. This pass does not change corpus participation policy.

### Beat controls

Replaced duplicated custom-workspace and loaded-tab act-grid builders with one tested function. Both paths now use the same row parsing, readable-name filtering, act clamping, stable ordering, display prefix stripping, and title keys. No scene files or author YAML were edited.

## Verification

- All 15 gates pass: production build, Obsidian review/lint enforcement, CSS checks, and the full test suite.
- **3,519 tests passed; 2 skipped.** Evidence: `.gate-logs/2026-09-06T19-21-01-319Z`.
- Author vault JavaScript matches the release build. Reload the plugin to load this build.
- Validate-button regression tests include repeated clicks, timestamps, timeout recovery, disposal, and invalidation followed by a serialized replacement. No live-server validation was performed in Obsidian during this pass.
- Baselines remain **4 report-only lint warnings, 67 unused-code diagnostics, and 243 unused-CSS candidates**. Model-list freshness notices remain unchanged.

## Remaining structural work

These are tested control boundaries; the section orchestrators still contain substantial UI code. Current AST function spans (including nested closures) are Beat 3,863, AI 3,030, Publish 2,704, Author Progress 1,863, and Inquiry 1,626 lines.

Future passes should target independent UI state rather than split files to hit a line target: Publish's editable book-metadata preview; Author Progress's style editor; Inquiry's prompt editor; and Beat's custom-workspace editor. The extracted YAML audit renderer also remains large. Revisit the unused-code baseline by verified callers rather than blanket deletion.
