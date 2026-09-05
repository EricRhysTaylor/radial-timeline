# R1 Checkpoint — Brief/Dossier Extraction (chunks B1–B4e landed)

Status: **SEAM LANDED.** Stop point before moving to the next god-object
area. No further brief/dossier extraction planned (remaining members
intentionally stay impure in InquiryView — see §3).

Scope: incremental decomposition of `InquiryView.ts` (R1 of the original
architecture audit) — the pure brief/dossier model-builder seam only.

## 1. Helpers now in `src/inquiry/utils/inquiryBriefModel.ts`

20 pure exported functions (636 LOC module), grouped by chunk:

| Function | Chunk |
|---|---|
| `getBriefModelLabel` | B1 |
| `buildSceneDossierHoverKey` | B1 |
| `getBriefSceneAnchorId` | B2 |
| `buildResultsHeroText` | B2 |
| `buildResultsMetaText` | B2 |
| `resolveInquiryBriefZoneLabel` | B3 |
| `buildSceneDossierModel` | B3 |
| `formatInquiryBriefTitle` | B3 |
| `isFindingHit` | B4a |
| `getFindingRole` | B4a |
| `getResultSummaryForMode` | B4a |
| `getOrderedFindings` | B4a |
| `normalizeInquiryBriefText` | B4a |
| `buildInquiryReferenceLabelMap` | B4b |
| `buildInquirySceneReferenceIndex` | B4b |
| `getInquiryActionText` | B4c |
| `buildInquiryPendingAction` | B4c |
| `buildBriefPendingActions` | B4c |
| `buildInquirySceneNotes` | B4d |
| `buildInquiryBriefModel` | B4e |

All pure: no DOM, no timers, no session writes, no plugin/run-state
access, no vault I/O. Inputs are explicit args or pre-resolved option
bags; corpus/registry resolution is the wrapper's job.

One module-private helper (`formatMetricDisplay`, B4e) — pure, not
exported; kept internal to keep the public surface focused.

## 2. InquiryView wrappers now delegating (20)

| Wrapper | Delegates to |
|---|---|
| `getBriefModelLabel` | `getBriefModelLabel` |
| `buildSceneDossierHoverKey` | `buildSceneDossierHoverKey` |
| `getBriefSceneAnchorId` | `getBriefSceneAnchorId` (injects `hashString`) |
| `buildResultsHeroText` | `buildResultsHeroText` (injects `getResultSummaryForMode`) |
| `buildResultsMetaText` | `buildResultsMetaText` (injects metric + selection-mode resolvers) |
| `resolveInquiryBriefZoneLabel` | `resolveInquiryBriefZoneLabel` (injects `findPromptZoneById`) |
| `buildSceneDossierModel` | `buildSceneDossierModel` (injects `getMinimapItemTitle`) |
| `formatInquiryBriefTitle` | `formatInquiryBriefTitle` (pre-resolves timestamp/zone/lens/prefix) |
| `isFindingHit` | `isFindingHit` |
| `getFindingRole` | `getFindingRole` |
| `getResultSummaryForMode` | `getResultSummaryForMode` |
| `getOrderedFindings` | `getOrderedFindings` |
| `normalizeInquiryBriefText` | `normalizeInquiryBriefText` |
| `buildInquiryReferenceLabelMap` | `buildInquiryReferenceLabelMap` (injects `formatInquiryReferenceDisplay`) |
| `buildInquirySceneReferenceIndex` | `buildInquirySceneReferenceIndex` (injects display + anchor resolvers; corpus fallback chain stays here) |
| `getInquiryActionText` | `getInquiryActionText` |
| `buildInquiryPendingAction` | `buildInquiryPendingAction` (preserves optional default args) |
| `buildBriefPendingActions` | `buildBriefPendingActions` (preserves optional default args) |
| `buildInquirySceneNotes` | `buildInquirySceneNotes` (injects 3 corpus-coupled callbacks; preserves defaults) |
| `buildInquiryBriefModel` | `buildInquiryBriefModel` (pre-resolves 11 options in the wrapper) |

InquiryView size went from 11,984 LOC at the cache-status checkpoint
to **11,648 LOC** here — **−336 lines net** across B1–B4e (a few hundred
lines of god-file substrate moved into a unit-testable pure module).

## 3. What intentionally remains in InquiryView (and why)

The wrappers exist because the impure boundary is — by design — owned
by the view. Each wrapper composes the impure pieces and hands a
data-shaped contract to the pure module.

- **DOM builders** — `buildBriefingPanel`, `buildSceneDossierResources`,
  `buildSceneDossierLayer`, all `*RenderInquiry*` SVG/HTML work.
- **Corpus access** — `getResultItems`, `getMinimapItemFilePath`,
  `getMinimapItemTitle`, `formatInquiryReferenceDisplay`, `this.corpus`
  reads.
- **Questions registry** — `findPromptLabelById`, `findPromptZoneById`,
  `getQuestionTextById`, `resolveInquiryQuestionPrefix`, the prompt
  config tree.
- **Settings/book lookup** — `resolveInquiryBriefScopeIndicator` (reads
  `this.plugin.settings.books` via `getSequencedBooks`).
- **Log-title resolution** — `resolveInquiryLogLinkTitle` /
  `formatInquiryLogTitle`.
- **Cross-cutting orchestration** — `hashString` (wraps the existing
  pure hash module), `Date.now()` injection for `formatInquiryBriefTitle`,
  `isErrorResult` for the brief assembler's error-only `rawResponse`
  path, and the `formatMetricDisplay` private method (a pure-but-still-
  on-the-view helper consumed via `this.` in untouched callers; the
  module mirrors it as its own private helper).
- **Vault I/O** — `saveBrief`, `appendInquiryNotesToFrontmatter`, any
  `vault.read/modify/create`.

Net: the boundary is sharp. Everything pure that the brief/dossier
pipeline produces is now in the module; everything that requires the
view, the corpus, the registry, the vault, or the clock stays in
InquiryView.

## 4. Test coverage added (B1–B4e)

`src/inquiry/utils/inquiryBriefModel.test.ts` — **84 `it` cases** in
951 LOC. Coverage by chunk:

- **B1** (2 helpers): model-label fallback chain, dossier hover-key
  shape/invariants.
- **B2** (3 helpers): anchor-id composition + empty source fallback,
  hero-text `' *'` marker, meta-line uppercasing + lens-driven order.
- **B3** (3 helpers): zone-label registry skip-when-present, dossier
  composition + `getMinimapItemTitle` call-count preservation, title
  saga/prefix/zone+lens branches.
- **B4a** (5 helpers): hit/non-hit kinds, role normalization, per-mode
  summary fallback, ordered-findings sort (role → lens-fit → kind →
  headline), text normalizer pass-through.
- **B4b** (2 helpers): map first-write-wins, all 4 key channels, skip
  empty/falsy, scene-index anchor `undefined` propagation, call-count
  exactness.
- **B4c** (3 helpers): action-text null paths, S-number `refId` fallback,
  pending-action dedup by `${targetLabel}::${text}`, filter-order
  preservation.
- **B4d** (1 helper): scope filter, label fallback skips, all 4
  item-match channels (case-insensitive exact equality on `filePaths`),
  anchor fallback chain, header matched vs unmatched, clustering
  same-label findings, numeric-aware label sort, lens fallback ladder.
- **B4e** (1 helper): question title/text fallbacks, pills ordering,
  summary sanitizer behavior, findings transformation (incl. saga
  context + scene-label via referenceLabels), conditional spreads,
  rawResponse only when `isError`, passthrough identity.

Source-lock describes assert wrapper delegation + that the impure
boundary (defaults / callbacks / pre-resolutions) stays in the view.

## 5. Pre-existing oddities preserved (not fixed in this seam)

Two latent pre-existing behaviors were carried verbatim by the
extraction. They are flagged here for a future feature-audit pass —
**do not "fix" them as part of any further pure-extraction chunk**.

### 5.1 Scene-note bullet filter requires `'• '`
[`buildInquirySceneNotes`](src/inquiry/utils/inquiryBriefModel.ts) runs
`buildSceneDossierBodyLines(finding) → map(normalize) → filter(line =>
line.startsWith('• ')) → strip prefix`. `buildSceneDossierBodyLines`
emits sentences without the `'• '` marker, and `normalizeInquiryBriefText`
(token replacement only) doesn't add it. Net effect: the `bullets`
array on scene-note entries is **always `[]`** in production. Test
case `bullet pipeline quirk` locks this as preserved behavior. Whether
this is a real product bug (filter on the wrong sentinel) or
intentional gating belongs to a separate audit.

### 5.2 Summary fallback is dead code
[`buildInquiryBriefModel`](src/inquiry/utils/inquiryBriefModel.ts) does
`normalizeInquiryBriefText(getResultSummaryForMode(...) || 'No flow
summary available.', …)`. But `getResultSummaryForMode` calls
`sanitizeInquirySummary`, which **already** returns `'Summary
unavailable.'` for empty input. The `|| 'No <mode> summary available.'`
fallback is therefore unreachable in practice. Test case `summaries
fallback` locks the real behavior (`'Summary unavailable.'`) and
comments the dead-code branch.

Both oddities were known going into the chunk and survived by design
(behavior-preserving extraction is the doctrine; behavior changes are
out of scope until a separate audit decides intent).

## 6. Source-scrape brittleness hazard (carries over from the cache-status seam)

Across B1–B4e, **3 pre-existing InquiryView source-scrape tests** broke
purely because the body moved (behavior unchanged): one each at
chunks 2, 3a, 4c, 4d, 4e — fewer than the cache-status seam saw, but the
same tax applies.

**Two source-lock patterns to avoid (both bit us)**:

1. **Substring absence assertions where the same pattern exists in
   unrelated untouched code.** Example: `"const zone = result.questionZone ?? this.findPromptZoneById(result.questionId) ?? 'setup';"` matched two other unrelated methods. The naive
   `src.includes(...).toBe(false)` is unreachable when a sibling method
   uses the same expression. Replace with: a comment explaining why the
   positive presence assertion is the proof, or anchor on
   uniquely-multi-line context.

2. **Substring absence assertions on common boilerplate** —
   `kind === 'none' || kind === 'strength'`,
   `? finding.refId.trim().toUpperCase() : undefined`, etc. — that
   appear in other unrelated methods. Same fix.

**Safer testing pattern (used from B4d onward)**:

- Prefer **positive presence assertions** for delegation: `expect(src.includes('return XxxPure(...)')).toBe(true)` is robust and self-documenting.
- For body-gone assertions, use **uniquely-anchored multi-line context**:
  the first 80–120 chars of a body that no other method could produce.
- Behavior is locked by the pure module's own `it` blocks. Source-locks
  are a delegation-shape check, not a behavior check.

Budget for future R1 chunks: **~1–3 pre-existing source-scrape rewrites
per chunk** is normal and not a regression signal. Treat it as expected
tax.

## 7. Recommended next R1 candidate (do NOT implement yet)

The brief/dossier cluster is exhausted (remaining members are
intentionally impure). InquiryView is still **11,648 LOC**. Per the
original architecture audit (R1), the next pure-leaning seam should be
chosen by a **fresh scope-first pass** on a different cohesive cluster.

Candidate clusters (review at scope-first time, do not assume):

- **Inquiry estimate / token-budget shaping** — math/derivation helpers
  that probably live near the engine-popover surface but are pure-over-
  estimate-inputs.
- **Findings-panel render data model** — the list-side analog to what
  B4 just did for the brief side; may share helpers already in
  `inquiryBriefModel.ts` (sceneRef map, ordered findings, role).
- **Corpus-strip / minimap data model** (excluding the DOM renderer
  itself) — pure mappers between corpus state and minimap inputs.

Resume with a scoping deliverable in the chunk-3 / B4 format
(dependency map → classification → smallest safe chunk → tests → risk
verdict) before any code. Do not extend `inquiryBriefModel.ts` further
— a new domain module per cluster keeps the seams readable.

## Related

- Prior checkpoint: `r1-cache-status-extraction-checkpoint.md`.
- Doctrine: `docs/engineering/standards/code-doctrine.md`,
  `docs/engineering/standards/refactor-playbook.md`.
- Audit-2 honesty patch: cache UI reports only payload-proven reuse
  (unaffected by this seam).
