# Scrivener structure-only onboarding — post-feature audit

Scope: explicit per-run AI opt-in in OnboardingModal, public command and Welcome card, feature-gate comment, and modal regression tests. No architectural refactor or scene-YAML schema change.

## Cleanup and behavior

- Removed the development-vault gate from the onboarding command and Welcome card.
- New imports default to Structure only. The mode is retained in the existing in-memory resume session.
- Structure-only Prepare skips local diagnostics, cloud credential checks, and remote prompt refresh. Extraction continues through the existing deterministic pipeline.
- AI assistance requires explicit selection. If the requested AI is unavailable, Continue is disabled and the author must select Structure only or configure AI.
- AI setup controls appear only after opt-in. The mode dropdown has an accessible name and uses the existing Obsidian control and ERT row styling; no new CSS tokens or portals were introduced.
- Scrivener intake remains export-only. Prepare explains text/Markdown export and optional Outliner CSV. Existing scene boundaries, metadata mapping, source preservation, review checkpoints, and destination behavior are unchanged.

## Findings and deferred concerns

No blocking finding in the changed surface. No stabilization edits or refactors were performed after this report-first review. Removed dead beta gating and normalized AI setup wording.

Limitations: no live full Scrivener materialization or inspector token-scope verification was performed in this session. The active Obsidian window is the authoritative Author vault, which was not used as an import test target. Existing destination-collision and partial-write behavior was not changed. Existing onboarding prose remains English; localization is deferred. These are limits of this bounded verification, not claims of end-to-end acceptance.

## Verification

- Baseline: TypeScript passed; 3,991 tests passed, 7 skipped.
- Final full suite: 3,993 tests passed, 7 skipped.
- Two new modal regression tests exercise actual Prepare logic with UI/service doubles: configured providers are not probed by default, and switching back from AI stops subsequent checks and prompt refreshes.
- Production build-only passed, including TypeScript, script typechecking, asset and CSS checks. Build copied to configured local vault plugin folders and release/build.
- After final copy/comment adjustments, build-only and the modal/onboarding suites passed again (159 tests).

Public release publication is outside this task. Existing Obsidian sessions need a plugin reload to use the copied build.
