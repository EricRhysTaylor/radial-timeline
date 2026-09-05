# R1 Consolidation — 2026-05-20

**Status: PAUSED.** R1 god-object decomposition is paused after the
six seams listed in §1 (cache-status, brief/dossier, findings-panel,
corpus-strip/minimap, log-fields, settings-preview). Next work
resumes on **product**, not further decomposition. One light UI
smoke pass remains outstanding (§5) and will be run later when
fresh.

Documentation-only checkpoint after six pure-helper extraction
clusters. No code refactor, no new extraction, no build run.

## 1. Modules created/extracted this R1 run

Six new sibling modules, all pure (no DOM, no plugin/state access,
no I/O, no timers, no i18n in five of six; the sixth — `inquiryLogFields.ts`
— intentionally inherits no i18n). Source god-objects retain
orchestration (DOM, lifecycle, persistence, i18n, vault I/O).

| Module | Source god-object drained from |
|---|---|
| `src/inquiry/engine/inquiryCacheStatus.ts` (+ `.test.ts`) | `src/inquiry/InquiryView.ts` |
| `src/inquiry/utils/inquiryBriefModel.ts` (+ `.test.ts`) | `src/inquiry/InquiryView.ts` |
| `src/inquiry/utils/inquiryFindingsPanel.ts` (+ `.test.ts`) | `src/inquiry/InquiryView.ts` |
| `src/inquiry/utils/inquiryCorpusStripMinimap.ts` (+ `.test.ts`) | `src/inquiry/InquiryView.ts` |
| `src/inquiry/render/inquiryLogFields.ts` (+ `.test.ts`) | `src/inquiry/render/inquiryLogBuilders.ts` |
| `src/settings/sections/aiSettingsPreview.ts` (+ `.test.ts`) | `src/settings/sections/AiSection.ts` |

Current god-object size (post-extraction):

- `src/inquiry/InquiryView.ts` — 11,627 LOC
- `src/inquiry/render/inquiryLogBuilders.ts` — 622 LOC
- `src/settings/sections/AiSection.ts` — 3,743 LOC

## 2. Helper counts per module

`export` declarations (functions + constants + types):

| Module | Exports | LOC | Test LOC |
|---|---:|---:|---:|
| `inquiryCacheStatus.ts` | 11 | 235 | 341 |
| `inquiryBriefModel.ts` | 20 | 636 | 951 |
| `inquiryFindingsPanel.ts` | 5 | 105 | 119 |
| `inquiryCorpusStripMinimap.ts` | 5 | 100 | 121 |
| `inquiryLogFields.ts` | 14 | 272 | 304 |
| `aiSettingsPreview.ts` | 22 | 285 | 381 |
| **Total** | **77** | **1,633** | **2,217** |

## 3. Commits landed

Cluster-only commits attributable to this R1 run, in landing order:

| Commit | Cluster |
|---|---|
| `ea019786` | Cache-status seam (chunks 1–3b) |
| `49a3062f` | Brief/dossier seam (B1–B4e) — **mixed with auto-backup**, accepted as-is |
| `3013c910` | Findings-panel data model |
| `7d1427c1` | Corpus-strip / minimap data model |
| `91a9b3d3` | Inquiry log-builder field helpers |
| `e19dec67` | Settings AI preview / cost-breakdown helpers |

Notes:

- The brief/dossier landing was swept into a single backup commit
  along with unrelated docs/scripts — flagged at the time, the user
  chose "accept as-is, move on" rather than rewrite history.
- All other clusters were committed in isolation (only the cluster
  files + the cluster checkpoint note).

Checkpoint notes (one per cluster):

- `docs/engineering/audits/r1-cache-status-extraction-checkpoint.md`
- `docs/engineering/audits/r1-brief-dossier-extraction-checkpoint.md`
- `docs/engineering/audits/r1-findings-panel-extraction-checkpoint.md`
- `docs/engineering/audits/r1-corpus-strip-minimap-extraction-checkpoint.md`
- `docs/engineering/audits/r1-log-builder-extraction-checkpoint.md`
- `docs/engineering/audits/r1-settings-preview-extraction-checkpoint.md`

## 4. Current full-test status

`npx vitest run` (just now, no build):

- **194 test files passed, 2 skipped** (196 total)
- **1,934 tests passed, 2 skipped** (1,936 total)
- Duration: ~4s
- `tsc --noEmit`: clean

The two skips are pre-existing (`anthropicCertification.test.ts` —
live-network gated; `tests/publishing-pdf-assembly.test.ts` —
PDF-toolchain gated). Both predate this R1 run.

## 5. Outstanding manual smoke gates

Per the autonomous-mode operating spec, the final cluster gate
("manual UI/log verification") remains the user's call at each
cluster boundary. Of six clusters, only the cache-status seam (cluster
#1) received a recorded smoke check; the rest were waived to keep
momentum.

| Cluster | Smoke gate status |
|---|---|
| Cache-status | **Performed.** Cache-armed-after-book-switch noted then cleared as "working correctly now." |
| Brief/dossier | **Waived** ("Smoke result: [empty]") |
| Findings-panel | **Waived** (autonomous mode) |
| Corpus-strip / minimap | **Waived** (autonomous mode) |
| Log-builder | **Waived** (autonomous mode) |
| Settings preview | **Waived** (autonomous mode) |

Recommended scope for a single consolidated smoke sweep (if desired)
covers all five waived clusters in one Inquiry session:

1. Open Inquiry View, run one real provider Inquiry. Confirm:
   - Engine popover cache pills (`Provider cache supported`,
     `Observed cache hit · N% reused`) render and the merged
     window-expired text appears when the cache TTL lapses.
   - Findings panel and brief/dossier pane render with correct
     headlines, scene anchors, action language, and reference labels.
   - Corpus-strip header pills + minimap item paths still resolve.
   - Inquiry Log section copy matches prior runs (no log-wording
     regressions).
2. Open Settings → AI → confirm the cost-estimate table, capacity
   sections (`Scenes (...)`, `Outline (...) — full text`,
   `References — none`), and preview-pill stack render identically
   to pre-refactor screenshots.

If any single rendering deviates from prior behavior, that is the
signal to bisect — none of the helper bodies were re-worded, so any
deviation should be call-site-level.

## 6. Remaining unrelated working-tree files

`git status --short` returns **clean.** No unrelated working-tree
changes carry over from this run. (Prior conversations occasionally
swept `scripts/models/*.json` timestamp churn and
`src/view/TimeLineView.ts` edits into auto-backup commits; the
current tree is back to baseline.)

## 7. Highest-value next cluster recommendation

**Inquiry log trace-section builders** in
`src/inquiry/render/inquiryLogBuilders.ts` (622 LOC remaining after
the field-helper extraction).

Rationale:

- Same file we just touched, so the test surface and call-site
  conventions are fresh.
- `buildTraceTimeline`, `buildTraceMetrics`, `buildTraceNotes`,
  `buildTraceResponseDetail` are largely pure already and form a
  cohesive sub-cluster (one new module: `inquiryLogTraceSections.ts`
  or similar).
- Touches no UI render, no run lifecycle, no cache truth — same risk
  profile as the field-helper cluster.
- Estimated size: ~6–10 helpers, ~250 LOC module, ~250 LOC tests.

Second-tier candidates (good but smaller wins):

- **Local-LLM capability summary helpers** in `AiSection.ts`
  (`buildLocalCapabilityTooltip`, `buildLocalFeatureSummary`,
  `formatLocalCapabilitySymbol`, `formatLocalCapabilitySupportLabel`)
  — fully pure, ~4 helpers, but tightly typed against
  `LocalLlmCapabilityAssessment`; smaller cluster.
- **Inquiry log header / sources / settings-context section helpers**
  in the remaining `inquiryLogBuilders.ts` — already substantially
  pure, lower marginal yield than the trace cluster.

## 8. Clusters to defer because they are cross-cutting or stateful

Avoid these in any near-term R1 cycle; each requires service-layer
or lifecycle work first:

- **Inquiry estimate / token-budget shaping** — cross-cutting across
  `InquiryView`, `corpusService`, `aiSettings`, and the cost-estimate
  table. Flagged twice in prior checkpoints; only attempt on explicit
  request and only after a scope-first plan.
- **Settings cost-comparison row builders** in `AiSection.ts` —
  intertwined with pricing fetch, credential lookup, and the cost
  table DOM render loop. Not a pure-extraction target; needs a multi-
  step plan (extract a service, then drain the closure).
- **`resolvePreviewReuseSignal` / `resolvePreviewCitationSignal`** in
  `AiSection.ts` — closure-impure (read `ensureCanonicalAiSettings()`
  + call `resolveCitationsEnabled(...)`). Would require lifting the
  settings reader to a parameter or pulling the resolver into the
  pure module with explicit citation-state input.
- **Run lifecycle / session / cache window state** — Audit-2 doctrine
  zone. Untouched across all six clusters and should stay that way
  until a separate, payload-truth-focused refactor cycle is opened.
- **InquiryView DOM render callbacks** — `renderCorpusCcStrip`,
  `buildMinimapRenderCallbacks`, every `createSvgText` / SVG element
  routine. The DOM boundary stays; further pure extraction here would
  require restructuring the render loops first.
- **Vault / file I/O at the InquiryView surface** —
  `getMinimapItemTitle`, `getMinimapItemWordCount`,
  `getDocumentTitle`, `isTFile`, `getNormalizedFrontmatter`. The
  impure boundary is the vault; no pure shaping left to lift here.
- **Provider client transports** (`anthropicApi`, `openaiApi`,
  `geminiApi`) and the AI runtime cache layer — out of R1 scope.

## Related

- Prior checkpoints (linked above).
- Doctrine: `docs/engineering/standards/code-doctrine.md`,
  `docs/engineering/standards/refactor-playbook.md`,
  `docs/engineering/standards/inquiry-critical-path-rules.md`.
- Audit-2 payload-truth rules: see the cache-status checkpoint and
  the original Audit 1–4 thread in conversation history.
