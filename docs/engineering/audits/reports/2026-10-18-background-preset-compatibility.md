# Background preset compatibility cleanup — October 18, 2026

## Change

Custom Social background preset buttons now render directly in the existing
flex row. Track the two buttons for removal when presets change, instead of
creating a wrapper that needs `display: contents` to disappear from layout.
Remove that unused wrapper CSS rule. Labels, swatches, click/context-menu
handlers, save/delete behavior and persisted settings schema are unchanged.

Settings search is explicitly deferred by the owner. Preserve tab navigation,
styling and complete suites, especially Publish / PDF / Design Wizard.

## Acceptance

- All 14 gates pass, including the production build and unit suite.
- Actual before/after preset CSS and representative markup at two widths in
  light/dark themes: all 52 button rectangles match. The 1200 x 560 screenshot
  comparison has zero differing pixels. This is browser fixture evidence.
- Candidate installed and reloaded only in Output QA Vault; all three installed
  artifacts match the build hashes. Author Vault plugin/manuscript untouched.
- Native settings acceptance: create QA Preset / #314159, persist and reopen;
  right-click to rename QA Renamed; apply Kickstarter / #0B3B2D then reapply
  the renamed custom color; create QA Second / #654321; delete the first and
  confirm the second moves into its slot; delete the second and confirm both
  empty slots return. Swatches retain wrapping in the actual styled suite.
- Restored the QA background #0d0d0f and transparent mode. Only remaining
  authorProgress data difference is an explicit empty custom-preset array
  instead of the originally absent optional property.
- Native automation initially returned stale floating-window AX/screenshots.
  The owner reopened QA Settings, after which the acceptance above completed.
  Do not infer a product defect from those earlier stale observations.
- One source compatibility location is removed. Official scanner acceptance
  and the public Caution rating remain unconfirmed. No public release.

Private evidence: Command Center / Agent Runs /
2026-10-18 Obsidian scanner previews / preset-row.
