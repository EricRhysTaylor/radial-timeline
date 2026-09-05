## Radial Timeline 6.0.2

This is a focused maintenance and safety release following 6.0.1.

### Improvements

- Completed the ERT CSS migration across shared modal and settings surfaces.
- Reduced CSS drift debt from 261 warning hits to 9 and refreshed the maintenance baseline.
- Migrated Book Designer, Manuscript Export, Gossamer, Runtime, AI Pulse / Scene Analysis, Timeline Audit, Timeline Repair, and template dialogs toward ERT tokens and `ert-*` classes.
- Expanded localization coverage for Timeline and Inquiry UI strings, including English and Japanese keys for modes, grid labels, Inquiry runner states, tooltips, corpus controls, and interaction messages.
- Improved Inquiry status, timing, cache, and advisory reporting so large runs are easier to understand before and after execution.
- Added clearer Inquiry handling for corpus overrides, target scenes, empty-scene states, modal labels, mobile copy, and help text.
- Added release-gated builds so beta-only commands stay out of public release assets.
- Improved Book Designer chrome with cleaner ERT cards, input sizing, status styling, and a direct wiki link in the modal badge.
- Added folder path chips in settings so important configured folders can be revealed quickly in Obsidian’s file explorer.
- Refreshed AI/model metadata snapshots, aliases, drift reports, and provider feature metadata.

### Documentation

- Reorganized the wiki table of contents and workflow pages.
- Added or refreshed wiki pages for Inquiry, Local LLM, Summary Refresh, Search Timeline, Timeline Order, Timeline Audit, Gossamer workflows, Create Note, Manage Subplots, Manuscript Export, Runtime Estimator, and Planetary Time.
- Added updated screenshots for the major modal and workflow docs.
- Marked Inquiry Omnibus, Timeline Audit, and Timeline Order as beta/testing workflows in the wiki.
- Refined YAML and onboarding docs to match the current Book Designer, fresh-vault, and frontmatter behavior.

### Bug Fixes

- Fixed public release builds so beta/development commands are gated out of packaged assets.
- Fixed release-note creation so `npm run release` can use a local `docs/releases/draft-for-release-<version>.md` draft when present.
- Fixed Advanced YAML Auditor behavior so it no longer offers to remove frontmatter keys that are not owned by Radial Timeline.
- Fixed Inquiry citations behavior by muting provider citation requests for now; evidence quotes remain available without the added cost and flaky provider behavior.
- Fixed Anthropic Inquiry cost estimates to use the actual 1-hour cache-write pricing instead of undercounting with the 5-minute rate.
- Fixed Anthropic cache metrics so cache-creation and cache-hit runs both populate the cached-prefix usage overlay correctly.
- Fixed malformed JSON retry handling so retries preserve the original evidence corpus and provider reuse context.
- Fixed lingering modal CSS drift in Gossamer, AI Pulse, Runtime, Book Designer, and manuscript-related modal surfaces.
- Fixed Inquiry empty-scene targeting and interaction copy edge cases.
- Fixed stale docs references and screenshots left over from pre-ERT modal names.
