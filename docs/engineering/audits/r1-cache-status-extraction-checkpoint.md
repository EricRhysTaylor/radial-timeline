# R1 Checkpoint — Cache-Status Extraction (chunks 1–3b landed)

Status: **SEAM LANDED.** Stop point before moving to the next god-object
area. No further cache-status extraction planned (remaining members
intentionally stay impure in InquiryView — see §3).

Scope: incremental decomposition of `InquiryView.ts` (R1 of the original
architecture audit) — the pure cache-status seam only.

## 1. Helpers now in `src/inquiry/engine/inquiryCacheStatus.ts`

11 pure exported functions (235 LOC module):

| Function | Chunk |
|---|---|
| `scoreReuseAdvancedContext` | 1 |
| `getAnthropicAcceptedCacheTtl` | 1 |
| `getDispatchEngineKey` | 1 |
| `resolveActualUsageCostForResult` | 2 |
| `buildEngineRecentRunSnapshot` | 2 |
| `buildEngineCacheWindowSnapshotFromSession` | 2 |
| `pickEffectiveReuseAdvancedContext` | 3a |
| `mapSessionToPersistedReuseContext` | 3b |
| `matchLiveReuseAdvancedContext` | 3b |
| `resolveActiveCacheWindowExpiry` | 3b |
| `formatContextCountdownLabel` | 3b |

All pure: no DOM, timers, session writes, plugin/run-state access.
`now`/inputs are explicit args.

## 2. InquiryView methods now thin wrappers

| Wrapper (InquiryView) | Delegates to |
|---|---|
| `getAnthropicAcceptedCacheTtl` | `getAnthropicAcceptedCacheTtl` |
| `getDispatchEngineKey` | `getDispatchEngineKey` |
| `getActualUsageCostForResult` | `resolveActualUsageCostForResult` |
| `buildEngineRecentRunSnapshot` | `buildEngineRecentRunSnapshot` (keeps null/error guard + `areInquiryProviderCitationsEnabled`) |
| `buildEngineCacheWindowSnapshot` | `buildEngineCacheWindowSnapshotFromSession` (keeps engine guard + sessionStore lookup, injects `Date.now()`) |
| `getEffectiveReuseAdvancedContext` | `pickEffectiveReuseAdvancedContext` (resolves persisted/live first) |
| `getPersistedReuseAdvancedContext` | `mapSessionToPersistedReuseContext` (keeps engine + sessionStore lookup, injects `Date.now()`) |
| `getLiveReuseAdvancedContext` | `matchLiveReuseAdvancedContext` (keeps `getLastAiAdvancedContext` + engine resolution + none/ollama guard) |
| `getActiveCacheWindowExpiry` | `resolveActiveCacheWindowExpiry` (keeps lookup, injects `Date.now()`) |
| `buildContextCountdownLabel` | `formatContextCountdownLabel` (keeps lookup, injects `Date.now()`) |

`scoreReuseAdvancedContext` has **no** InquiryView wrapper — consumed only
inside the pure `pickEffectiveReuseAdvancedContext` (its old wrapper was
removed in 3a as dead code that extraction created).

## 3. What intentionally remains in InquiryView (and why)

- `getResolvedEngine()` — engine/settings resolution + `_resolvedEngine`
  memoization (impure, instance state).
- `getLatestCacheSessionForResolvedEngine()` — session-store lookup
  orchestrator; no worthwhile pure core.
- `getCurrentCacheReuseFingerprint()` — depends on lazy
  `_currentCorpusContext` memoization (instance-state mutation).
- All `sessionStore.getLatestActiveCacheSessionForEngine` calls,
  `getLastAiAdvancedContext(this.plugin,…)`, `this.state.scope`,
  `Date.now()` injection — the impure boundary, kept by design.
- **Excluded by rule, untouched:** `clearContextWindow` (session
  mutation + `setSession` + DOM `updateRunningHud`),
  `reconcileEngineTimerInterval` (timers + run-state), `updateMinimap*`
  (DOM), `getObservedCacheMetrics`, `resolveCacheWindowExpiry`,
  `appendAnthropicDispatchTraceNote` (run-path-shared), run lifecycle,
  cache UI truth semantics (Audit 2 doctrine).

Net InquiryView size ≈ 11,891 LOC (≈ −90 across chunks). The win is a
fully unit-testable pure seam, not raw line reduction.

## 4. Test coverage added (chunks 1–3b)

`src/inquiry/engine/inquiryCacheStatus.test.ts` — **32 `it` cases**
(341 LOC): per-helper characterization (provider/model mismatch,
reuseState derivation incl. `> now` boundary, ratio clamp / token floor,
expiry boundary, countdown `remaining`/`Cache expired`, cost catch path,
picker tie→persisted) + source-lock asserting every InquiryView wrapper
delegates and the impure boundary (guards/lookups/`Date.now()`) stays.
tsc clean; full `src/inquiry` + `src/ai` vitest green (804 passed,
1 skipped) at landing.

## 5. Refactor hazard — brittle source-scrape tests

Pre-existing `InquiryView.test.ts` / `InquiryView.cacheSupport.test.ts`
assert on **literal source substrings** of InquiryView method bodies.
Every chunk broke 1–3 of them purely because the body moved (behavior
unchanged), each requiring a test rewrite to re-point at the pure module.

This is a standing tax on **all** future InquiryView decomposition, not
just cache-status. Recommendation (future, not now): migrate these from
source-substring scrapes to behavioral assertions against the extracted
pure modules. Until then, budget ~1–3 test rewrites per extraction chunk
and treat a source-scrape failure as "expected, verify intent preserved"
rather than a regression signal.

## 6. Recommended next R1 candidate (do NOT implement yet)

The cache-status cluster is exhausted (remaining members are
intentionally impure). The next seam should be chosen by a **fresh
scope-first pass** on a different cohesive, pure-leaning cluster in
InquiryView — candidate: the **brief/dossier text-model builders**
(sanitize/normalize/headline/body-line shaping already partly mirrored in
`utils/inquiryViewText.ts`), which look pure and high-volume. Do not
extend `inquiryCacheStatus.ts` for it — a new domain module.

Next action when resumed: a scoping deliverable (map + classify +
risk verdict) for that cluster, mirroring the chunk-3 scoping format. No
implementation until scoping is reviewed.
