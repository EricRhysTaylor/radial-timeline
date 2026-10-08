# Welcome, Scrivener onboarding, and subplot ring drag

Date: 2026-10-06
Status: implementation plan; remaining product changes are not implemented by this document.

## Intended experience

A writer can start a new book, import an existing manuscript, or explore a demo from Welcome. Scrivener imports preserve narrative order and author metadata without requiring AI or prior Book Manager setup. Onboarding proposes an initial act/subplot plan. Authors organize memberships afterward by dragging scenes between rings in the main timeline.

Normal drag moves one subplot membership. Shift-drag adds a membership. This is a move, not an exchange with another scene.

## Verified current baseline

Already landed on main through a2a6977d:

- Welcome opens import source selection without requiring a registered source book. Book Manager offers candidate discovery, automatically when no configured source folder exists on disk and manually otherwise.
- Candidates are suggestions, not certification. Authors confirm the folder and review before materialization registers the destination book.
- Structure-only is the default; AI is explicit per-run opt-in.
- A supplied Scrivener outline determines narrative order, ahead of filename numbering. Partial title coverage blocks import. Metadata matches by normalized document title; positional assignment was removed.
- The onboarding mapping table proposes canonical RT keys, supports keep/custom/ignore/subplot-flag choices, and shows sample values. Mappings apply once to imported notes and do not modify the Settings key remapper.
- Without structural acts, positional allocation uses the configured act count, three by default. This is currently automatic rather than a clearly selected author-facing suggestion.
- The timeline drag controller already changes subplots, acts, and numbering. Its current subplot handling can replace unrelated memberships; it does not implement the agreed move/add contract.
- Subplot Manager currently renames/removes existing subplots. The planned scene-assignment board is superseded by main-timeline ring interaction.

Existing test/gate success does not establish live Obsidian acceptance of the remaining work.

## Phase 1 — Author-facing onboarding defaults

Keep the existing new-book, import, and demo entry paths. Make the import sequence read clearly as Source → Structure and metadata → Preview → Create book. Reuse the existing checkpoints and Book Designer/demo routes rather than creating a second import pipeline.

### Acts

1. Preserve author-supplied acts from the export. Verify mapped CSV Act values as well as ACT folder structure: current proposal construction overwrites Act with structural/positional resolution, so mapped acts must not be silently lost.
2. If folder and mapped acts conflict, show the conflict and let the author choose the source; do not silently prefer an invented act.
3. If no act information exists, preselect “Divide into three acts by narrative position.” Show the proposed boundaries and allow changing act count/boundaries or placing all imported scenes in Act 1 initially. Respect the plugin's minimum configured act count.
4. Describe allocation as an editable starting structure, not inferred story meaning. Do not resplit prose merely to create equal act groups.

### Subplots

1. Prefill names from the confirmed mapped metadata, retaining all author-supplied memberships.
2. Let the author rename proposed names and add planned subplot names, including empty ones.
3. Unassigned scenes initially belong to Main Plot. Do not assign scenes to a newly named thread without an author decision.
4. Never use the AI onboarding one-subplot/singleton policy to prune authored metadata or manual memberships. Audit the existing vocabulary enforcement and singleton collapse before reusing that path.
5. Store planned names in book-scoped plugin data, including a schema version for the new persisted shape. Do not create dummy scene notes or operational scene YAML fields.
6. Distinguish an empty planned subplot from a populated subplot whose last scene was moved out. Keep both available until the author explicitly removes the name.

### Metadata and order review

- Show the selected CSV and document-to-file matches, with narrative sequence visible in preview.
- Keep the one-time mapping table and sample values. Flag multiple source fields mapping to one target rather than silently losing a value; let the author resolve the conflict or keep one as custom.
- Prioritize Title identity, narrative order, Act, Subplot, Synopsis, Character, Place, and author custom fields. Word Count is an optional internal completeness hint, not a required product statistic.
- For incomplete exports, name the unmatched documents and instruct the author to re-export Files and Outliner Contents from the same manuscript selection with Title and intended metadata columns visible.
- Preview output values before writing; source exports remain unchanged. Keep recheck/change-source controls.
- After creation, open the timeline and offer a short contextual hint for arranging subplot memberships. Do not require a separate command modal.

## Phase 2 — Planned rings on the main timeline

Use one canonical book-scoped source of subplot names, combining actual memberships with explicitly planned names. Inspect the current renderer, color/order ownership, and legacy masterSubplotOrder handling before adding data; do not establish a parallel ring registry.

- Empty planned subplots render as named rings with empty drop targets in Narrative mode.
- Preserve saved ring order/color behavior and book isolation. Switching books must not expose another book's planned rings.
- Name/add/rename/remove actions use the timeline's existing subplot controls. The existing manager can remain for management; scene assignment lives in the timeline.
- Renaming updates both planned names and real memberships consistently. Removing a populated subplot retains existing explicit confirmation behavior and moves orphaned scenes to Main Plot.
- Do not delete scene notes when removing a planned subplot.

## Phase 3 — Ring drag membership contract

**Built 2026-10-07** (src/services/SubplotMembership.ts, OuterRingDragController, SceneContextMenu). Decisions where the plan was silent: a drag from the outer ring (All Scenes, no membership) onto a subplot ring adds; a subplot-ring copy dropped on the outer ring is not a target. The existing confirmation dialog shows the membership change without rename impact and closes on Begin; the result Notice carries Undo, which restores the Subplot field exactly. Menu actions pick the subplot with a fuzzy picker. Phases 1–2 (onboarding defaults, planned empty rings) are not built.

The grabbed ring identifies the source membership. Do not infer it from the scene's first/dominant subplot. This matters when a scene appears on three or more rings.

For memberships A, B, C, dragging the A copy:

| Gesture | Destination | Result |
| --- | --- | --- |
| Drag | D | B, C, D |
| Shift-drag | D | A, B, C, D |
| Drag | C | B, C |
| Shift-drag | C | A, B, C; no change |
| Either | A | No change |

Rules:

- Normal drag removes only the grabbed source membership and adds the destination once. Preserve every other membership.
- Shift-drag adds the destination once and preserves all source memberships.
- Main Plot follows the same rules when it is an explicit membership. A scene with no remaining membership returns to Main Plot.
- Membership changes update only the author-facing Subplot field. They do not renumber filenames, reorder narrative sequence, change Act/When, or move another scene.
- Apply to Scene items only; beats are not reassigned to subplot rings.
- Same-ring drags retain the existing narrative-reorder interaction. Cross-ring drags are membership edits, even if the pointer crosses an act boundary. Outer-ring ordering representations must not be mistaken for explicit Main Plot membership.
- Escape/cancel and invalid targets make no changes. Releasing Shift changes the preview/result to move; read the modifier at drop and show matching feedback.
- An already-included destination is an add no-op. A normal move to an already-included destination removes only the source membership.

### Feedback and accessibility

Highlight the destination ring and preview “Move A → D” or “Add D,” including the resulting memberships when useful. Reuse existing confirmation/undo behavior; show only the actual membership change, without irrelevant renumbering impact.

Provide equivalent scene-menu actions for Move/Add/Remove subplot membership. Removing the last membership restores Main Plot. Keep drag and keyboard/menu actions on the same membership mutation path.

## Implementation boundaries

Likely surfaces:

- src/modals/OnboardingModal.ts and src/onboarding/OnboardingService.ts
- src/onboarding/adapters/scrivenerAdapter.ts and src/onboarding/extraction.ts
- src/view/WelcomeScreen.ts and src/settings/sections/GeneralSection.ts
- src/types/settings.ts and existing book settings normalization/persistence
- src/view/interactions/OuterRingDragController.ts and dragGeometry.ts
- Existing subplot label/ring renderer, scene update/history plumbing, and SubplotManagementService.ts

Before architectural changes, read engineering INDEX, code doctrine, inquiry critical-path rules, refactor playbook, and UI architecture standards. Reuse ERT controls and existing writer-owned YAML mutation paths. No worktrees or feature branches; no GitHub issues.

## Acceptance and verification

1. Export with filename numbering contrary to CSV order imports in CSV narrative order with metadata attached to the correct document.
2. Missing/mismatched titles block import; optional statistics do not become prerequisites. Mapping conflicts are visible and author-resolved.
3. Supplied acts survive; absent acts show a selected thirds suggestion with author-editable boundaries.
4. Planned empty subplots survive modal dismissal, app restart, and book switching without dummy notes.
5. All move/add cases above pass, including three-plus memberships, destination already present, Main Plot, empty rings, modifier changes, cancelled drags, and beats.
6. Cross-ring membership edits leave filename, narrative number, Act, When, and source text unchanged. Undo restores exactly the previous memberships.
7. Rendering shows one scene membership per included ring without duplicates; unrelated memberships remain visible after a move.
8. Verify actual installed-vault import and timeline interactions on a disposable test vault, including keyboard/menu parity and computed ERT token scope. Do not use the authoritative Author vault as the test target.
9. Run focused tests, TypeScript, production build-only, required gates, and a report-first post-feature audit. Commit and push verified work to main, then reload the test-vault plugin and verify the installed build. Public release publication requires a separate release request.

Recommended delivery order: onboarding defaults and book-scoped planned names → empty ring rendering → membership drag/menu behavior → installed-vault acceptance. Each slice should be independently reviewable.
