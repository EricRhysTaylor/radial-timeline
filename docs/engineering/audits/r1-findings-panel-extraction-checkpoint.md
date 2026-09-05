# R1 Checkpoint — Findings-Panel Render Data Model

Status: **SEAM LANDED.** Single-cluster autonomous-mode extraction, no
per-chunk gates.

Scope: pure render-data shaping for `updateFindingsPanel` — predicates
+ per-row data shape. All DOM (`createSvgText`, classList toggling) and
all i18n `t()` calls stay in InquiryView.

## 1. Helpers in `src/inquiry/utils/inquiryFindingsPanel.ts`

5 pure exported functions:

| Function | Role |
|---|---|
| `getResultSelectionMode(result)` | predicate — pure |
| `getResultRoleValidation(result)` | predicate — pure |
| `computeRoleValidation(selectionMode, findings, persisted?)` | derivation — pure |
| `buildFindingRowData(finding, mode)` | shapes `{role, roleLabel, headline, lensLabel, bullets}` for one hit row |
| `buildUnverifiedFindingRowData(item)` | shapes `{headline, citedAsDescriptor, bullets}` for one unverified row |

No DOM, no timers, no plugin/state access, no vault I/O, no i18n. Row
shapers preserve the panel's top-2 bullet limit and the `'[Target]'` /
`'[Context]'` bracket-label convention.

## 2. InquiryView wrappers

| Wrapper | Delegates to |
|---|---|
| `getResultSelectionMode` | `getResultSelectionMode` |
| `getResultRoleValidation` | `getResultRoleValidation` |
| `computeRoleValidation` | `computeRoleValidation` |

The two row-data shapers are consumed **directly inline** in the
`updateFindingsPanel` render loops (hit + unverified) — they didn't
previously have private wrappers, so the loops now read:
`const row = buildFindingRowDataPure(finding, result.mode); …` and the
SVG construction continues in InquiryView.

## 3. Intentionally remains in InquiryView

- All DOM: `createSvgText`, the cursor-Y math, the SVG element refs
  (`findingsTitleEl`, `summaryEl`, `verdictEl`, `findingsListEl`),
  classList toggles (`is-role-validation-warning`,
  `is-citation-integrity-warning`,
  `is-citation-evidence-compromised`).
- All i18n via `t()`: section titles, lens/cited-as/empty/validation
  copy, headline prefixes.
- `state.scope`, `state.targetSceneIds`, `state.activeSessionId`,
  `state.activeResult`, `state.mode` reads.
- `sessionStore.peekSession` for `getPersistedResultTargetSceneIds`.
- Verdict-line composition (selection text, validation note, scope
  note, integrity note) — i18n-heavy, low leverage to extract; kept.
- Title composition — same.

## 4. Test coverage

`inquiryFindingsPanel.test.ts` — 14 `it` cases:
- `getResultSelectionMode`: explicit `focused` vs everything-else.
- `getResultRoleValidation`: explicit `missing-target-roles` vs
  everything-else.
- `computeRoleValidation`: non-focused always `ok`; persisted trusted
  when present; focused-no-persisted derives from findings.
- `buildFindingRowData`: role/roleLabel mapping (incl. missing →
  `[Context]`); headline normalization fallback; lens ladder (`both` /
  explicit / mode || `flow`); bullets filtered + sliced to 2.
- `buildUnverifiedFindingRowData`: cited-as fallback chain
  (`rawRefId` → `rawRefLabel` → `rawRefPath` → `'(missing ref)'`);
  bullets filtered + sliced.
- Source-lock: wrappers delegate; row shapers consumed in the panel
  render loops; original inline forms gone from those loops.

`tsc --noEmit` clean. `src/inquiry`+`src/ai`: **912 passed / 1 skipped**.

## 5. Source-scrape brittleness — 1 pre-existing test updated

`InquiryView.test.ts` had pinned the `computeRoleValidation` one-liner
in the InquiryView source. Rewritten to assert it in the pure module —
the only brittleness rewrite this cluster. Carries forward the safer
pattern documented in the brief/dossier checkpoint.

## 6. Pre-existing oddities — none new

This seam introduced no new latent oddities and inherited none from
the methods it touched. The brief/dossier oddities (bullet-filter
quirk, summary fallback dead-code) remain untouched and out of scope.

## 7. Recommended next R1 candidate

Findings-panel cluster exhausted. InquiryView remains DOM-coupled for
panel rendering (verdict-line, title, section headers); further pure
extraction there has diminishing returns without restructuring the
SVG loop architecture itself — out of scope for current R1 work.

Candidates for the next scope-first pass:
- **Corpus-strip / minimap data model** (excluding the DOM renderer
  itself) — pure mappers between corpus state and minimap inputs.
- **Inquiry estimate / token-budget shaping** — flagged as
  cross-cutting; defer unless explicitly needed.

A new domain module per cluster. Do not extend
`inquiryFindingsPanel.ts` further.

## Related

- Prior checkpoints: `r1-cache-status-extraction-checkpoint.md`,
  `r1-brief-dossier-extraction-checkpoint.md`.
- Doctrine: `docs/engineering/standards/code-doctrine.md`,
  `docs/engineering/standards/refactor-playbook.md`.
