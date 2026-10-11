# Publish export: consistent scene selection

This implements the contents/format and keyboard-range portions of Phase 2 in the [Publish audit](2026-10-10-publish-export-professionalization.md). It builds on the [Phase 1 reliability changes](2026-10-10-publish-export-phase1.md). Ordinary-folder/single-file selection and the document proof workspace remain subsequent work.

Follow-up: [native and visual QA](2026-10-11-publish-export-visual-qa.md) now records the tested UI/output flows and the three additional UI corrections. The pending-native statements below describe the initial implementation checkpoint.

## Result

Choosing PDF now preserves the manuscript's scene range, order and subplot/open-scene selection. The existing scope and ordering controls remain visible in all manuscript formats. PDF submission and the command runner respect those choices instead of substituting the whole book in narrative order. The default full-book narrative export still works through the same pipeline.

Both range handles are focusable sliders. Arrow keys move one scene; Home and End move to the available edge without crossing the other endpoint. Accessible values include the selected scene title and reflect the current endpoint limits. A theme-accent focus outline makes keyboard focus visible. No new modal elements, layout system or ERT tokens were added.

Open-scenes scope already submits explicit selected paths. The modal now omits numerical range endpoints for that scope, so the runner does not apply the range a second time after filtering. Previously, choosing the second open scene could leave an empty export.

PDF presets now report real order/subplot changes. Older `full-book` profile policy values remain readable and compare against the current selection policy; no schema migration, source-note rewrite or template geometry change is required. Named presets retain their existing reusable setup semantics; last-used snapshots retain their existing saved-range behavior.

## Post-feature audit and hardening

Reviewed the changed modal mode/state/submission paths, runner selection/assembly boundary, preset projection, range events and scoped focus styling. Removed the format-dependent full-book flag, range-reset/reload branch, hidden scope flags and selection-policy helper. No additional source-provider abstraction, renderer or fallback was introduced.

The keyboard listener belongs to each modal-owned handle; global pointer listeners retain their existing modal cleanup. The focus rule is scoped to `.ert-ui.ert-scope--modal` and uses the global Obsidian `--interactive-accent` token. The existing range elements are within the modal root. Native computed-style, focus and screen-reader acceptance remain unverified.

No additional release-blocking source issue was identified in this bounded change. Existing deferred concerns remain: stale asynchronous scene-load responses, immutable source selection during a book switch, excerpt chapter/part context, and explicit front/back matter rules for split outputs. These require their own implementation/acceptance work. Existing matter inclusion and equal-scene splitting behavior were preserved.

## Verification

- The actual modal synchronization preserves range/order/subplot across PDF, Word and Markdown switches without reloading the selection.
- The actual command runner sends the selected excerpt to PDF and Word rendering and includes the same prose in Markdown, with private comments removed and no word-count/frontmatter writes when that option is off.
- PDF selected-path filtering, empty subplot filtering and reverse narrative order are covered. The modal-to-runner open-scenes test verifies the range is not applied twice.
- Keyboard endpoint tests cover one-scene movement, manuscript bounds, crossing prevention, Home/End and allowing Tab to pass through.
- An opt-in installed-tool test renders a runner-selected excerpt into a real PDF and reads it with Poppler: selected prose present, omitted prose and private comments absent. It uses an isolated test template and temporary output; this is not visual acceptance of a bundled style or a native modal export.
- Older profile policy values remain compatible, while PDF order and subplot changes are recognized.

All 15 final repository gates passed: production build, TypeScript checks, lint/compliance/CSS ratchets and the complete unit suite (4,190 passed, 10 skipped). The focused installed-tool run passed all 19 tests, including the real excerpt PDF. Receipts: `/tmp/rt-publish-selection-final-gates.json`, `/tmp/rt-publish-selection-final-gates.log`, `/tmp/rt-publish-selection-live.log`. Existing lint and unused-CSS notices remain unchanged.

## Acceptance boundary

This is a verified repository/renderer change, not full Phase 2 completion or a public release. Native Obsidian reload and interaction testing were not performed on October 11: the console and session lock indicators disagreed, so the computer-use connection was left unused. No settings were changed to work around that discrepancy.

The next product work remains reviewed plain-folder/single-file selection, author-visible source/order review, explicit matter/split policy, and the real document proof workflow. Windows/Linux and a long manuscript still need acceptance coverage. Source notes remain author-owned.
