# Scene time header feature audit

Scope: `SceneTimeHeader`, `sceneTimeLabel` and its tests, header CSS, CSS bundler registration, and plugin lifecycle/settings integration. Existing unrelated working-tree changes are excluded.

## Result

No release-blocking findings in the feature surface. Read-only post-feature review; no additional refactors, dead-code removal, or naming changes were required. New chrome uses the `ert-` prefix.

- Each open markdown scene receives its own header badge, based on normalized `Class: Scene`, including custom metadata mappings. No active-book restriction is applied.
- Canonical date/duration parsers provide timing. Partial dates retain their precision; unknown durations remain visible without a fabricated end time. Missing values are explicit. Midnight rollover includes the end date.
- The sun/moon indicator is a clock-hour convention (06:00–18:00), explained in its tooltip; it does not claim astronomical sunrise/sunset.
- Workspace/cache events refresh open views without vault scans or polling. Component teardown removes owned badges and registered listeners. Leaving a scene removes its badge on refresh.
- The feature writes no scene content, frontmatter, or persisted operational state.

## Verification

- `npm run build-only`: passed, including TypeScript and production build; artifacts copied to configured local vaults.
- `npx vitest run`: 325 files passed, 3,542 tests passed, two opt-in tests skipped.
- Author vault: reloaded Radial Timeline and observed Scene 61's badge: `☀ 5:00 PM · 31 hours → 12:00 AM (2085-04-23)`.
- Observed persistent header placement after scrolling into the manuscript, and after switching from Live Preview to Reading mode. Restored editing mode.
- Inspected the live element's computed styles: 13px text, 8px horizontal padding/margins, 2px vertical padding, 8px corners; background, border, and text colors resolve correctly. All referenced variables are global Obsidian tokens.

## Remaining limits

Manual header insertion depends on Obsidian's `.view-header` markup. Themes/settings that hide native view headers also hide the badge. Narrow panes allow horizontal scrolling within the badge. Separate popout windows, mobile layouts, and third-party themes were not visually tested. These are follow-up compatibility checks; no new abstraction or fallback was introduced.

Feature behavior and build safety are verified within the checks above. No broader architectural cleanup is proposed.
