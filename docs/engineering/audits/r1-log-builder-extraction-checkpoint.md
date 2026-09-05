# R1 Checkpoint — Inquiry Log Builder Field Helpers

Status: **SEAM LANDED.** Single-cluster autonomous extraction. No
per-helper gates.

Scope: pure field-level helpers used by `buildInquiryLogContent` in
`src/inquiry/render/inquiryLogBuilders.ts`. Lifted formatters, label
resolvers, detail builders, and the error/suggestion ladder out of
inline closures into a sibling module so each leaf is independently
testable and the builder reads as orchestration. Log wording is
preserved verbatim (Audit-2 payload-truth applies to cache
diagnostics — this cluster touches none of that).

## 1. Helpers in `src/inquiry/render/inquiryLogFields.ts`

13 pure exported functions + 1 exported constant:

| Function | Surface |
|---|---|
| `PROVIDER_LABELS` (const) | provider key → human display map |
| `formatLogTokenCount(value, approximate?)` | token counts → `'<int>'` / `'<n>k'` / `'~<n>k'` / `'unknown'` |
| `formatLogUsageMetric(value)` | as above but `'unavailable'` for missing |
| `resolveLogProviderLabel(providerRaw, isSimulated)` | run-summary provider label |
| `resolveLogModelLabel(result, briefModelLabel, isSimulated)` | run-summary model label |
| `resolveLogStatusLabel(status, degraded)` | `'Degraded' / 'Success' / 'Failed' / 'Simulated'` |
| `resolveLogStatusDetail(result)` | `' (aiReason)'` / `' (aiStatus)'` / `''` suffix |
| `buildLogOverrideLabel(overrideSummary, corpusOverridesActive)` | overrides line value |
| `buildLogSourceResultDetail(sourcesVM)` | source-counts detail line |
| `buildLogUsageDetailParts(usage)` | raw input / cache read / cache write fragments |
| `buildLogUsageText(usage)` | `input=..., output=..., total=...` |
| `describeLogCorpusMode(manifest, className, normalize)` | `'Summary' / 'Full Scene' / 'Mixed' / null` |
| `resolveLogFailureReason(result, trace, isErrorResult)` | error-result reason fallthrough |
| `buildLogSuggestedFixes(result, trace, isErrorResult, resolveReason)` | `## Suggested Fixes` ladder |

No DOM, no timers, no plugin/state access, no vault I/O, no i18n —
all literals (`'Simulation'`, `'No provider call'`, `'Degraded'`,
`'Mixed'`, `'Reduce corpus scope and rerun.'`, etc.) are preserved
verbatim from the original inline logic.

## 2. Builder integration

`inquiryLogBuilders.ts` now imports the 13 helpers and delegates
each previously-inline closure to them. Two helpers (`resolveFailureReason`,
`buildSuggestedFixes`) keep their original local-closure names as thin
wrappers around the pure helpers so call sites further down the
builder remain readable. One TS coercion was needed at the seam:
`result.corpusOverrideSummary` is `{...} | undefined`, the pure helper
takes `{...} | null` — wrapper applies `?? null`.

## 3. Intentionally remains in InquiryLogBuilders

- **The `buildInquiryLogContent` orchestration** itself —
  section assembly, blank-line spacing, Markdown structure.
- **Section helpers that already lived in the file** (`buildSourcesSection`,
  `buildSettingsContextSection`, `buildHeader`, etc.) — already pure
  enough; no leaf-level shaping inside them was duplicative of the
  new module.
- **Tracing helpers** (`buildTraceTimeline`, `buildTraceMetrics`,
  `buildTraceNotes`, `buildTraceResponseDetail`) — out of scope for
  this cluster; their shape is cohesive and would be a separate seam.
- **Cache-status payload-truth code** — not touched. Audit-2
  doctrine intact.
- **Run lifecycle / session / cache window state** — untouched.

## 4. Test coverage

`inquiryLogFields.test.ts` — 45 cases across 14 describes:

- `formatLogTokenCount`: sub-1000 integer; `1k` / `99.5k` (`.toFixed(1)`,
  trailing `.0` stripped) / `130k` (`.toFixed(0)` at ≥100k) thresholds;
  approximate prefix; `null` / `undefined` / `NaN` / `Infinity` → `'unknown'`.
- `formatLogUsageMetric`: same as above but `'unavailable'` for missing.
- `resolveLogProviderLabel`: simulated wins; empty → `'Unknown'`;
  known providers map; unknown providers pass through verbatim.
- `resolveLogModelLabel`: simulated → `'No provider call'`; brief →
  resolved → requested → `'unknown'` fallthrough.
- `resolveLogStatusLabel`: degraded wins; success/error/simulated mapping.
- `resolveLogStatusDetail`: aiReason wins; aiStatus suffix only when
  non-empty and not success/degraded; empty otherwise.
- `buildLogOverrideLabel`: summary present → `'On (classes: N, items: M)'`;
  active without summary → `'On'`; else `'None'`.
- `buildLogSourceResultDetail`: empty → `'none surfaced'`; ordering by
  descending count then label ascending; class labels lowercased;
  singular `item` / plural `items`.
- `buildLogUsageDetailParts`: only finite-number fields included; null
  usage → `[]`.
- `buildLogUsageText`: null → `'not available'`; canonical format with
  individual `'unavailable'` per missing metric.
- `describeLogCorpusMode`: null manifest; all-summary; all-full;
  mixed; only-excluded → `null`.
- `resolveLogFailureReason`: non-error → null; trace.response.error
  wins; notes[0] next; result.summary next; truncated default;
  `aiReason` → `AI request failed (REASON).`; final `'Unknown failure.'`.
- `buildLogSuggestedFixes`: non-error → `['None.']`; packaging
  failure ladder; invalid structured output; truncated; rate_limit;
  auth; timeout/unavailable/unsupported_param; unrecognized →
  generic fallback.

`tsc --noEmit` clean. `src/inquiry` + `src/ai`: **974 passed /
1 skipped** (45 new from this cluster).

## 5. Source-scrape brittleness — none triggered

No InquiryView or inquiryLogBuilders source-scrape tests broke this
cluster. Builder file is internally pinned by behavioral tests (full
log fixture comparisons elsewhere), not literal substring lookups, so
the closure → helper-call swap was invisible to existing tests.

## 6. Pre-existing oddities — none new

This seam introduced no new latent oddities and inherited none from
the inline closures it replaced.

## 7. Recommended next R1 candidate

Inquiry log field-helper cluster exhausted. Further pure extraction
in `inquiryLogBuilders.ts` would need to lift one of:
- **Trace metrics / timeline / response detail builders** — cohesive
  but currently a single-purpose section. A separate cluster.
- **Settings/sources/header section builders** — already substantially
  pure; gains would be modest.

Candidates outside this file:
- **Settings preview / cost-breakdown helpers** in `AiSection.ts` —
  flagged in prior checkpoints, still open.
- **Inquiry estimate / token-budget shaping** — cross-cutting,
  recommend only on explicit request.

A new domain module per cluster. Do not extend
`inquiryLogFields.ts` further with non-field-level shaping.

## Related

- Prior checkpoints: `r1-cache-status-extraction-checkpoint.md`,
  `r1-brief-dossier-extraction-checkpoint.md`,
  `r1-findings-panel-extraction-checkpoint.md`,
  `r1-corpus-strip-minimap-extraction-checkpoint.md`.
- Doctrine: `docs/engineering/standards/code-doctrine.md`,
  `docs/engineering/standards/refactor-playbook.md`.
