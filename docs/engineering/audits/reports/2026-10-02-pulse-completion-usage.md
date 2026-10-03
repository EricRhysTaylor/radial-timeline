# Pulse completion cost and cache reporting

Date: 2026-10-02
Scope: manuscript-order and subplot-order Pulse completion screens.

## Result

The shared completion screen now shows the current batch's usage-based cost,
provider-cache outcome counts, and expandable per-scene cost/model/cache details.
All four manuscript modes and both subplot paths forward usage through the same
provider boundary. Summary refresh is unchanged.

The provider observer runs exactly once in `finally`, preserving usage when an
analysis fails validation. Scene-write failures retain the cost of the response
already received. Calls not started after cancellation are not counted. Resume
opens a new batch; the visible scope label states this explicitly.

## Accounting and state review

- `extractTokenUsage`, `buildUsageCostBreakdown`, `formatCacheStatusLine`, and
  `formatExactUsdCost` remain the canonical normalization/pricing/formatting paths.
- Each invocation retains its resolved provider/model and calculated cost. Changing
  models does not reprice previous calls using the new selection.
- Missing input/output usage or pricing remains unavailable. Available response
  costs can be shown as a clearly labeled partial subtotal.
- AIClient returns final-response usage, not a ledger for earlier retry/pass
  responses. Runs reporting retries or multiple passes are explicitly partial.
  Earlier costs are never invented or silently treated as zero.
- RT's in-memory result cache reports zero new provider cost and is distinguished
  from provider cache hits. Missing cache counters are unavailable; only explicit
  zero activity is shown as no reuse. Gemini cache creation respects provenance
  when pricing tokens rather than treating creation as a discounted hit.
- These are token-usage costs, with separate provider fees excluded by the visible
  scope label. They are not presented as a provider invoice.
- New accounting state lives only in the processing modal. No new scene YAML,
  settings schema, migration, request-body display, or credential handling exists.

## Cleanup and architecture

The duplicated inline response definitions in `RequestRunner` were replaced by
its existing canonical `AiProviderResponse` type. The optional observer is a
single data path shared by all modal processing modes; notice-only callers retain
the existing behavior. No broad refactor, speculative fallback, or dead legacy
path was introduced. Naming uses Pulse and provider cache consistently. All new
UI labels are in English i18n (other locales inherit the existing English fallback).

The completion renderer uses existing ERT styling under the modal's `.ert-ui`
root; no new CSS variables or CSS rules were introduced. The section is placed
above the AI prompt details and replaced on re-render. Rendering is linear in
executed calls and performs no vault scans or provider requests.

## Verification

- `npx tsc --noEmit`: passed.
- `CI=true npm run build-only`: passed; assets written to `build/` only.
- `npx vitest run --reporter=dot`: 3,807 passed, 3 skipped; 345 passing test files,
  3 skipped files.
- 29 new mocked tests cover canonical pricing/cache accounting; missing usage,
  missing pricing, creation, hit, explicit zero activity, local result reuse,
  retries/multiple passes, validation errors, runtime errors, scene-write failures,
  cancellation, resume, all four manuscript modes, both subplot paths, and actual
  completion-section rendering without duplicate sections.
- `git diff --check`: passed.
- `CI=true npm run gates`: all 15 default gates passed. Existing report-only
  notices: 3 Obsidian lint problems and 243 producer-less CSS classes.
- The optional deep `fallback-gate` check reports pre-existing debt: 58
  `or-chain-3` hits versus baseline 52; this diff introduces none.
- Pre-existing model JSON modifications were SHA-256 checked unchanged after gates.
- No AI API calls, public release, installed-vault changes, or Obsidian UI operations.

## Remaining limits / follow-up

No release-blocking or high-priority finding remains in the changed surface.
Native Obsidian visual inspection and live CSS computed-property inspection were
not performed because the user is working in Obsidian; the existing ERT root and
styles were checked in source and the rendering behavior was tested with the
Obsidian element surface mocked. The built artifact is not installed or loaded
in the user's running vault. A normal local deployment and plugin reload are
required to see the change. Successful prior API runs do not need repeating.

A full cross-feature ledger of every retry/pass would require an AIClient contract
change beyond this focused UI fix. The current UI discloses that missing coverage.
