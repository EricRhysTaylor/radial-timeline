# R1 Checkpoint — Settings AI Preview / Cost-Breakdown Helpers

Status: **SEAM LANDED.** Single-cluster autonomous extraction. No
per-helper gates.

Scope: pure preview / cost-breakdown field helpers used inside
`renderAiSection` in `src/settings/sections/AiSection.ts` (3903 LOC
god-object). Lifted formatters, capacity-line builders, the
preview-signal sorter, and the cache-pill merger out of inline
closures into a sibling pure module so each leaf is independently
testable and the orchestration reads as DOM assembly. All settings UI
behavior and copy preserved verbatim; cache-pill DOCTRINE ("static
capability statement, not realized benefit") is preserved verbatim and
re-tested in the new module.

## 1. Helpers in `src/settings/sections/aiSettingsPreview.ts`

16 pure exported functions + 3 constants + 3 types:

| Export | Surface |
|---|---|
| `CACHE_ARMED_PILL_TEXT` (const) | DOCTRINE-locked static-capability pill wording |
| `PREVIEW_SIGNAL_PRIORITY` (const) | `['citation','reuse','passBehavior']` |
| `MAX_PREVIEW_SIGNALS` (const) | `4` cap |
| `PreviewPill` (type) | `{ text: string; extraCls?: string }` |
| `PreviewSignalType` (type) | union of three signal kinds |
| `PreviewSignal` (type) | `{ type, pill }` |
| `formatInquiryCount(count)` | locale-formatted int or `'?'` for null |
| `formatCorpusBreakdownToken(tokens)` | `~Nk` shorthand (one-decimal, `.0` stripped) |
| `estimateTokensFromChars(chars)` | 4-char-per-token ceiling heuristic |
| `formatPromptToken(tokens)` | sub-1k locale + `~`, ≥1k → shorthand |
| `buildTokenCapacityLine(label, tokens)` | `${label} (${formatPromptToken(tokens)})` |
| `buildScenesCapacityLine(count, tokens)` | `Scenes (N) — full text (~Nk)` |
| `buildOutlineCapacityLine(count, tokens)` | unavailable / full text / `Outline — none` |
| `buildReferenceCapacityLine(count, tokens)` | unavailable / included / `References — none` |
| `formatApproxTokens(value)` | cost-table `n/a` / `~n` / `~nk` / `~nM` ladder |
| `formatCorpusStructureSummary(s, o)` | pluralized `N scenes + M outlines` |
| `formatCorpusTokenSummary(tokens)` | appends `' tokens'` to corpus shorthand |
| `formatPreviewReasonLabel(status?, reason?)` | quota / spend-cap / title-cased / `'issue detected'` |
| `formatPreviewCacheRemaining(remainingMs)` | `Xm` / `Xh Ym` remaining |
| `formatPreviewCacheObservedLabel(ratio?)` | `Observed cache hit · N% reused` or null |
| `mergePreviewCachePills(pills)` | armed/off + window-expired + observed-hit collapse |
| `resolvePreviewSignals(state)` | ordered, capped pill list from three label slots |

No DOM, no timers, no plugin/state access, no i18n, no Obsidian APIs —
all literals (`'Provider cache supported'`, `'Outline — none'`,
`'References — none'`, `'Observed cache hit · '`, `'Quota exceeded'`,
`'Spend cap reached'`, `'issue detected'`, `'No scenes or outlines'`,
`'n/a'`, etc.) are preserved verbatim from the original inline logic.

## 2. AiSection integration

`AiSection.ts` now imports the 16 helpers + `CACHE_ARMED_PILL_TEXT` +
`PreviewPill` from the new module. Inline definitions removed (the
formatter cluster at ~589, the `formatApproxTokens` + types/constants
block at ~931, `resolvePreviewSignals` at ~1001, the preview-formatter
trio at ~1377, the cache-pill merger at ~1414, and the corpus-summary
helpers at ~1809). Call sites unchanged. No DOM rendering, no setting
mutators, no run lifecycle code was touched.

`formatPreviewRunCompletedAt` (the lone time-formatter) was
**intentionally left inline** in AiSection.ts — its `toLocaleString`
output is locale/timezone-dependent and would introduce flaky tests.
A future seam could lift it once a deterministic locale strategy is
agreed.

`resolvePreviewCitationSignal` and `resolvePreviewReuseSignal`
**stay in AiSection.ts** — both capture `ensureCanonicalAiSettings()`
and call `resolveCitationsEnabled(...)` from the settings layer, so
they are not pure. The cache-pill DOCTRINE assertion (`'Provider cache
supported'` from these closures) still appears literally in
AiSection.ts via the imported `CACHE_ARMED_PILL_TEXT` constant and the
two `{ text: CACHE_ARMED_PILL_TEXT, ... }` literal pill objects.

## 3. Intentionally remains in AiSection

- **All DOM rendering** — every `createDiv`, `createEl`, `setText`,
  `setTooltip`, `addEventListener`, `setIcon` call.
- **Render orchestration** — `renderQuickSetupGrid`, `renderCostEstimateTable`,
  `renderPromoBanners`, `renderResolvedPreview*`, the capacity-section
  builders that assemble these helpers into rendered items.
- **Settings mutators** — `onAiToggleChanged`, `setOllamaModelId`,
  `setLocalServerSelection`, `ensureCanonicalAiSettings`, all
  `plugin.saveSettings()` paths.
- **Closure-impure helpers** — `resolvePreviewCitationSignal`,
  `resolvePreviewReuseSignal`, `getOllamaModelId`, `setLocalLlmConfigurationMode`,
  `buildLocalCapabilityTooltip`, `buildLocalFeatureSummary`, the
  cost-comparison orchestration, the smoke certificate updater.
- **i18n** — all `t()` calls.
- **InquiryView** — untouched (not part of settings).
- **Run lifecycle / cache truth semantics** — untouched. Audit-2
  doctrine preserved.

## 4. Test coverage

`aiSettingsPreview.test.ts` — 52 cases across 17 describes:

- Constants: `CACHE_ARMED_PILL_TEXT` doctrine wording lock;
  `PREVIEW_SIGNAL_PRIORITY` ordering + `MAX_PREVIEW_SIGNALS` cap.
- `formatInquiryCount`: `'?'` for null; locale-formatted int.
- `formatCorpusBreakdownToken`: em-dash for null; 1k/1.5k/125k/99.5k
  thresholds; non-finite → 0.
- `estimateTokensFromChars`: 0/negative; 4-char ceiling.
- `formatPromptToken`: em-dash; sub-1k locale; ≥1k delegates.
- `buildTokenCapacityLine`: label + formatted token composition.
- `buildScenesCapacityLine`: full-text branch; null count → `?`.
- `buildOutlineCapacityLine`: unavailable / full text / `Outline — none`
  for all three branches.
- `buildReferenceCapacityLine`: unavailable / included / `References — none`
  — locks the wording difference (`included` not `full text`) for
  references.
- `formatApproxTokens`: n/a; sub-1k; thousands; millions two-decimal
  vs one-decimal at 10M+.
- `formatCorpusStructureSummary`: `0 scenes` for both-zero (locks the
  preserved branch — `'No scenes or outlines'` fallback is unreachable
  with current ordering; dead-code locked as comment, not behavior change);
  pluralizes; omits scenes when zero + outline > 0; joins both.
- `formatCorpusTokenSummary`: appends ` tokens`.
- `formatPreviewReasonLabel`: quota / spend-cap; underscore → space;
  status fallback; `'issue detected'` for empty.
- `formatPreviewCacheRemaining`: min-1 floor; sub-1h; `Xh Ym` /
  `Xh remaining`.
- `formatPreviewCacheObservedLabel`: null for missing/non-positive;
  ratio formatting; 0% rounding floor; clamp at 100%.
- `mergePreviewCachePills`: pass-through; armed alone; `Cache enabled` /
  `Provider cache enabled` aliasing; armed+observed merge; `Cache off`
  + window-expired muted; window-expired alone uses armed base;
  ordering preserved with surrounding pills.
- `resolvePreviewSignals`: empty input; priority ordering; null drop.

`tsc --noEmit` clean. Full repo: **1934 passed / 2 skipped** (52 new
from this cluster, +0 regressions).

## 5. Source-scrape brittleness — 5 assertions rewritten

`AiSection.test.ts` and `AiSection.cachePreview.test.ts` contain
literal-substring `readFileSync(AiSection.ts).includes(...)` assertions
that pinned moved declarations / template literals. Rewrote 5
assertions to read from the new pure-module file instead — intent
(doctrine + copy lock) preserved, file pointer updated:

- `AiSection.test.ts:51` — gossamer bodies-only copy (`Scenes (...)`,
  `'Outline — none'`, `'References — none'`).
- `AiSection.test.ts:198` — `'Scenes ('` substring.
- `AiSection.test.ts:271` — `if (reason === 'quota_exceeded') return 'Quota exceeded';`
- `AiSection.test.ts:301`–`307` — `CACHE_ARMED_PILL_TEXT` declaration,
  `mergePreviewCachePills` declaration + body lines.
- `AiSection.cachePreview.test.ts:19` — `'Observed cache hit ·'` literal.

The call-site assertions (`text: CACHE_ARMED_PILL_TEXT`,
`mergePreviewCachePills((`, the consumer `'Cache window expired'`
producer line) still match against AiSection.ts directly because
those lines remain in the orchestration.

## 6. Pre-existing oddities — one locked as dead code

`formatCorpusStructureSummary`'s `'No scenes or outlines'` fallback
is unreachable: when `sceneCount === 0 && outlineCount === 0`, the
first branch (`sceneCount > 0 || outlineCount <= 0` → true) pushes
`'0 scenes'`, so `parts.length === 1` and the fallback never fires.
Locked actual preserved behavior (`'0 scenes'`) in the test with a
comment; did **not** change the source to remove the dead fallback —
out of scope for this cluster.

## 7. Recommended next R1 candidate

Settings preview/cost-breakdown helper cluster substantially
exhausted. Further extraction in AiSection.ts would need to lift one
of:
- **Settings-state-aware preview helpers** (`resolvePreviewReuseSignal`,
  capability-mode resolvers) — impure, would need a service-layer
  refactor first.
- **Local LLM capability tooltip / summary** (`buildLocalCapabilityTooltip`,
  `buildLocalFeatureSummary`) — pure but tightly coupled to the local
  LLM assessment type; separate cluster.
- **Cost-comparison row builders** — large, intertwined with pricing
  fetch + DOM render; needs a multi-step plan, not single extraction.

Outside AiSection:
- **Inquiry log trace metrics / timeline / response-detail builders**
  (next file-internal R1 candidate flagged in the log-builder
  checkpoint).
- **Inquiry estimate / token-budget shaping** — cross-cutting,
  recommend only on explicit request.

A new domain module per cluster. Do not extend `aiSettingsPreview.ts`
further with closure-impure or DOM-aware shaping.

## Related

- Prior checkpoints: `r1-cache-status-extraction-checkpoint.md`,
  `r1-brief-dossier-extraction-checkpoint.md`,
  `r1-findings-panel-extraction-checkpoint.md`,
  `r1-corpus-strip-minimap-extraction-checkpoint.md`,
  `r1-log-builder-extraction-checkpoint.md`.
- Doctrine: `docs/engineering/standards/code-doctrine.md`,
  `docs/engineering/standards/refactor-playbook.md`.
