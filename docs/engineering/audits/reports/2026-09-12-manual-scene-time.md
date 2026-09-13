# Manual scene time: post-feature audit

Scope: ManualTimeModal.ts, manualTime.ts, SceneTimeService.ts and tests,
SceneTimeModal.ts, model.ts, scene-time-ruler.css, and main.ts registration.

## Result

The implementation adds an editor command and context-menu action for single-source-line
prose selections in Scene notes. Author-entered durations count immediately in the existing
elapsed model and appear as blue bracketed labels. The existing modal edits/removes them.
The ruler visibility preference still applies; header totals remain available when hidden.

## Ownership and persistence

The existing schemaVersion 1 sidecar remains the only store. Its decision-map keys now
also support the explicitly versioned `manual-selection-v1:` namespace, containing a JSON
selected quote. Legacy keys and decisions are preserved without rewriting manuscript YAML.
Exact unique prose matching survives surrounding paragraph edits; deleted, duplicated or
overlapping selections remain stored and appear as unmatched assignments without counting.
Scene identity remains the note path, with existing in-app rename migration, not SceneID.
Overlapping automatic cues are rejected rather than counted twice.

## Verification and remaining checks

Twelve service tests pass, including selection/reload/surrounding edits/removal, bracketed
label and semantic color state, ambiguous/deleted anchors, metadata and overlap rejection,
stale source, and existing exclusion persistence. Full repository gates cover TypeScript,
production build, the complete test suite, CSS and Obsidian checks. Existing lint warnings
remain; this is not a new remote Community scan certification.

Live command/modal/ruler visual verification and CSS variable inspection remain outstanding:
Obsidian reported a concurrent user change during the attempted UI check. The new chrome
uses the existing ErtModal shell and global Obsidian color/spacing tokens. No manuscript
content or real scene decisions were changed during testing.

## Audit findings

No release-blocking defect identified in the reviewed implementation or automated checks.
Known limitations: selections must be unique and within one source line; editing the selected
words requires reassignment. Older automatic cue decisions still use full-paragraph identity;
this addition does not repair that separate limitation. Unmatched assignments are surfaced
when the modal opens; there is no separate header alert for them.

No architectural refactors or unrelated cleanup were performed. No dead code was removed.
Naming follows the existing scene-time model with `manual` as a distinct cue state.
Follow-up: live visual verification after plugin reload; stable identity for automatic cues
remains separate work. The existing accounting, optional workflow and metadata ownership
boundaries are preserved by the shared resolver and sidecar service.

## Follow-up: direct dotted-rail entry

Removed the editor context-menu item. Clicking a prose line's dotted gutter opens its
assignment modal; lines with existing cues open their review entry instead. Reading mode
maps the click to a rendered source-line range. The keyboard command remains available.
The ruler toggle and Scene-only checks are applied at entry. This changes only interaction,
not persistence or elapsed accounting. Full 15-gate verification passed again. Live visual
verification remains pending because repeated UI actions were interrupted by concurrent
Obsidian user changes; plugin reload is still required to load the new handlers.
