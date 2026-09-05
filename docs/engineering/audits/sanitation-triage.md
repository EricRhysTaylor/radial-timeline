# Sanitation Triage

Generated from:
- `docs/audits/sanitation-audit.md`
- `docs/audits/sanitation-audit.json`
- `docs/audits/tsc-unused.txt`
- `docs/audits/eslint.txt`

## Top Tokens

| Token | Count | Triage note |
| --- | ---: | --- |
| `Synopsis` | 855 | Dominant false-positive drift token (current feature naming), keep mostly unchanged unless context is stale. |
| `NOTE` | 304 | High noise: includes many valid strings (`note` fields/classes). Target only stale explanatory comments. |
| `TODO` | 77 | Normalize to `TODO(#...)` or remove if obsolete. |
| `DEPRECATED` | 59 | Validate each deprecation marker still reflects current migration path. |
| `refreshTimelineIfNeeded` | 32 | Settings/refresh terminology drift candidate (Lane B). |
| `mergeTemplates` | 21 | Template migration drift candidate (Lane B/C boundary). |
| `IMPORTANT` | 14 | Keep only if truly footgun/constraint. |
| `TEMP` | 14 | Convert to ticketed TODO or remove. |
| `Ripple Rename` | 9 | Rename/migration leftovers (Lane A). |
| `ChangeType.SETTINGS` | 6 | Settings refresh drift candidate (Lane B). |

## Top 15 Hotspots

| File | Hits | Lane | Proposed action |
| --- | ---: | --- | --- |
| `src/SynopsisManager.ts` | 204 | C | Mostly current-domain `Synopsis` usage; no broad rename. Remove stale `NOTE`/`IMPORTANT` comments only when clearly obsolete. |
| `src/modals/SceneAnalysisProcessingModal.ts` | 126 | B | Remove obvious narration comments; keep only modal lifecycle/footgun comments. |
| `src/settings/sections/BeatPropertiesSection.ts` | 104 | B | Replace drifted template/repair comments with canonical pointers, remove obvious narration. |
| `src/inquiry/InquiryView.ts` | 101 | B | Convert unlabeled TODO markers, remove stale UI narration. Defer invasive edits while file is under active local changes. |
| `src/sceneAnalysis/SynopsisCommands.ts` | 66 | C | Mostly current feature naming; no mass rename. Target only stale migration comments. |
| `src/services/CommandRegistrar.ts` | 30 | B | Remove obvious comment narration; keep command registration constraints only. |
| `src/utils/yamlAudit.ts` | 27 | A | Keep safety/destructive guard comments, delete duplicate narration. |
| `src/utils/beatsTemplates.ts` | 21 | C | Consolidate deprecated wrapper comments toward canonical helper pointer. |
| `src/utils/yamlTemplateNormalize.ts` | 21 | C | Remove stale merge-path comments; keep canonical normalization constraints. |
| `src/i18n/locales/en.ts` | 20 | B | Keep user-facing text keys; only trim stale deprecation labels if not user-visible compat keys. |
| `src/modals/ManuscriptOptionsModal.ts` | 20 | B | No broad text churn; target only comment drift near settings/output description logic. |
| `src/view/modes/ChronologueMode.ts` | 20 | B | Confirm refresh callback naming and pointer comments; low-risk cleanup. |
| `src/main.ts` | 19 | B | Keep refresh strategy comments only if they state constraints; remove duplicative notes. |
| `src/types/settings.ts` | 19 | B | Review deprecation comments, keep compatibility notes with canonical replacement references. |
| `src/view/interactions/SceneInteractionManager.ts` | 19 | B | Mostly domain naming; remove stale narration comments only. |

## Lane Assignment Summary

- Lane A (safety/destructive): file ops, rename paths, YAML/frontmatter safety guards, dangerous operation guidance.
- Lane B (settings/refresh/UI): settings sections, refresh lifecycle terms, modal UI process comments.
- Lane C (AI credentials/export/pipeline): credential accessors, export adapters, template merge wrappers.

## TODO/FIXME/HACK Policy For Cleanup PR

- Delete marker comments that are obsolete.
- Convert valid backlog work to `TODO(#SAN-<n>): ...` when issue creation is out of scope.
- Keep max 5-10 active TODO items; anything else should be deleted or resolved.

Current `SAN` backlog IDs used in this pass:
- `#SAN-1`: Connect Professional licensing settings to live validation endpoint after beta.
- `#SAN-2`: Make Gossamer processing provider check provider-agnostic.

## tsc/eslint Dead-Code Signals (Report-Only Inputs)

High-confidence first pass:
- Remove provably unused locals/params/imports where compile/runtime behavior is unchanged.
- Remove unused exports only after repo-wide reference check.
- If uncertain public API surface: keep symbol and annotate with `/** @internal */`.

Candidates selected for this pass:
- `src/debug/snapshot.ts`: unused `RadialTimelineView` import.
- `src/ai/prompts/gossamer.ts`: unused `extractBeatOrder` import.
- Additional removals only where single-file proof is clear.

## Checklist For This Cleanup PR

- [x] Lane B comment drift cleanup in settings/refresh/UI files.
- [x] Normalize unlabeled `TODO`/`FIXME`/`HACK` markers to `TODO(#SAN-x)` or delete.
- [x] Remove safe unused symbols from `tsc-unused` shortlist.
- [x] Re-run `npm run audit:all`.
- [x] Add “After this PR” delta section to `docs/audits/sanitation-audit.md`.
