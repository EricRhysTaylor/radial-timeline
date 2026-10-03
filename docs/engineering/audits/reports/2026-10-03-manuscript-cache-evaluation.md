# Manuscript cache evaluation: Pulse, Gossamer, Inquiry

Date: 2026-10-03
Scope: provider prompt caching for Pulse (manuscript and subplot order),
Gossamer, and Inquiry single-question and Omnibus runs, on Anthropic, OpenAI
and Gemini. Context: building the Odyssey, Sherlock Holmes and Faerie Queene
demo vaults.
Status: evaluated, then fixed the same day. See Resolution at the end.

## Question

Can we load the whole manuscript once and run every analysis against one
provider cache, on all three providers?

## Verdict

1. **One manuscript cache shared by every feature is technically possible but
   not worth building.**
   - Every provider caches an exact prefix, and every feature puts its own
     instructions, schema and role ahead of the manuscript.
   - Sharing would need one structured-output contract and one thinking/effort
     setting across Pulse, Gossamer and Inquiry, on all three providers.
   - All it saves is one cache write per extra feature per book: about
     $0.90–1.40 per write for the Odyssey on Opus 5.5.
2. **One cache per feature per book is the right design.** Gossamer and Inquiry
   already work that way on Anthropic.
3. **The OpenAI path is probably not caching on the default model (GPT-6.1
   Sol).** This is the most important finding. See defect 1.
4. **Pulse does no caching today, on any provider.**
   - Moving the triplet's scene numbers out of the shared text would let it
     cache about 2K tokens per call, a small saving.
   - "Pulse with whole-book context" is the feature that matches "load the
     whole manuscript". It is a quality decision more than a cost decision; see
     the cost table below.

## Provider rules that decide the design

Read from the official docs on 2026-10-03. Sources are listed at the end.

| | Anthropic | OpenAI (GPT-5.6+, incl. 6.1 Sol / 6 Luna / 6 Astra) | Gemini |
|---|---|---|---|
| Mechanism | `cache_control` breakpoints (max 4); prefix order tools → system → messages | Implicit mode puts the breakpoint at the **end of the latest message**; explicit mode uses `prompt_cache_breakpoint` on a content block | Explicit `cachedContents` (fixed: model, system, tools, contents), plus best-effort implicit caching |
| Minimum tokens | 512 (Opus 5.5, Sonnet 5.5, Fable 5.x) | 1,024 | 4,096 (3.x Flash, 3.1 Pro); 2,048 (2.5). **Not 32,768** |
| TTL | 5m default or 1h; a hit refreshes it | `30m` only (`prompt_cache_options.ttl`) | Explicit: default 1h, no bounds, extended by PATCH |
| Write / read price | 1.25× (5m) or 2× (1h) / 0.1× (Opus 5.5: 0.05×) | 1.25× / 0.1× (6.1 Sol: 0.05×) | input rate / 0.1× + storage per MTok-hour ($4.50 for 3.1 Pro, $0.50 for 3.8 Flash) |
| Breaks the cache | changing `tools` (everything); `tool_choice` (messages); `output_config.format`; thinking or effort changes | model, tools, `text.format` schema, `reasoning.effort` | the cache is tied to one model; instructions that vary must go in `contents` |
| Concurrency | the entry exists only after the first response starts, so warm with one call first | prewarm option (`prewarm: true`) | the cache exists once `create` returns |

## Current state

| Feature | Anthropic | OpenAI | Gemini |
|---|---|---|---|
| Gossamer (4 signals, hand-run) | Works: 1h breakpoint after manuscript; rubric after it | Probably misses on 5.6+ (defect 1); no `prompt_cache_key` | Explicit cache, max 15 min, kept only in memory |
| Inquiry single question | Works: one document block per scene; 1h breakpoint on the last | Probably misses on 5.6+ (defect 1) | Explicit cache if corpus ≥32K estimated tokens |
| Inquiry Omnibus | Sequential; aborts on miss; works | Sequential; abort can never fire (defect 2) | One combined call, so no cache is needed |
| Pulse (manuscript and subplot order) | None: no breakpoint; ~250-token shared prefix | None | None |

Gossamer and Inquiry **cannot share a prefix today**: their system prompts,
instructions, scene headers (`## {basename} ({id})` vs `## Scene {title} (S{n})
({id}) (Full)`), scene ordering and preamble all differ. The two corpus
builders also break the single-source-of-truth rule
(`gossamer/evidence/buildGossamerEvidence.ts` vs
`inquiry/runner/InquiryRunnerService.ts:623-751`). Only `cleanEvidenceBody` is
shared.

## Defects

1. **OpenAI 5.6+ prefix caching likely misses on every Inquiry and Gossamer
   call.**
   - `buildOpenAiResponsesInput` (`api/openaiApi.ts:131-145`) sends the stable
     corpus and the volatile question as one `input_text` block, including the
     literal `<<<CACHE_BREAK>>>`. It sends no `prompt_cache_options`.
   - Under implicit mode the only breakpoint falls after the question, so the
     next question finds no stored prefix. OpenAI's guide describes this exact
     miss and says to split the block and add an explicit breakpoint.
   - Expected effect: every question re-writes the whole corpus at 1.25× and
     never reads it back.
   - **Not yet confirmed live.** The only evidence on record is
     `openai-cache-miss-rootcause.md`, which predates 5.6 (GPT-5.5).
   - Probe: two Omnibus questions on Sol, same corpus; check
     `input_tokens_details.cached_tokens` and `cache_write_tokens` in the raw
     usage on question 2.
   - Two related gaps:
     - The plugin does not parse `cache_write_tokens` (`ai/usage/providerUsage.ts`),
       so writes are unseen and priced at 1.0×.
     - `prompt_cache_retention: '24h'` and the 24h countdown describe the
       pre-5.6 contract. Whether 5.6+ accepts that field is not verified.
2. **The Omnibus miss-abort is blind on OpenAI.** OpenAI never reports a cache
   write that the plugin can read, so `evaluateOmnibusCachePass`
   (`inquiry/runner/omnibusCacheHealth.ts:82-116`) files question 1 as
   `below_minimum`. Question 2 then can never become `miss`. The plan modal's
   promise to abort automatically (`InquiryViewModals.ts:604`) is false for
   OpenAI. Parsing `cache_write_tokens` fixes this.
3. **Omnibus sessions never record a cache window.** `persistOmnibusResult`
   (`InquiryView.ts:~6403`) sets no `cacheWindowExpiresAt`, unlike the
   single-question path (`:5732`). After an Omnibus run the next question shows
   no warm-cache estimate.
4. **Anthropic cache writes are double-counted in the display.**
   `readOmnibusCacheProbe` (`omnibusCacheHealth.ts:57-59`) adds
   `cache_creation_input_tokens`, which is already the total, to its own 5m/1h
   split. This affects the "wrote X tok" display only.
5. **Gemini cache creation is priced at the read rate** in the combined
   Omnibus cost tally (`InquiryView.ts:6067-6074`).
6. **Pulse diagnostics claim caching was requested.** The Anthropic provider
   passes the `'1h'` TTL on every call (`ai/providers/anthropicProvider.ts:139-141`).
   That makes `providerReuseRequested` true even though Pulse sends no
   `cache_control` (`aiClient.ts:151-155`).
7. **Gossamer's countdown can start without proof.** With the delimiter
   present, `reuseState` is set to `eligible` before the call
   (`aiClient.ts:930-943`). That starts a 24h countdown on OpenAI's first run,
   or 1h for an Anthropic prefix too short to cache. This breaks
   `gossamer/cacheWindow.ts`'s own "never speculatively" rule. An in-memory
   repeat also restarts the window and re-reports the old cost as new
   (`GossamerCommands.ts:928-944`).
8. **Gemini cache manager is stale.**
   - It uses a 32,768-token minimum (`api/geminiCacheManager.ts:37`).
   - TTL is clamped to 15 min (`ai/settings/cacheWindows.ts:4-6`).
   - The handle registry lives only in memory, and caches are never deleted.
     Storage keeps billing until the TTL runs out, and a reload orphans the
     handle.
9. **Inquiry prefix order is not fully deterministic.** The manifest and the
   outline/reference blocks follow vault iteration order
   (`InquiryRunnerService.ts:761-801, 882-900`), while the fingerprint sorts.
   The role template is not in `cacheReuseFingerprint` either.
10. **Gossamer scene order depends on the current timeline mode and the
    When-ordering setting** (`manuscript.ts:542-549`). Switching to Chronologue
    between signals changes the bytes and loses the cache.

## Pulse

Each call sends the role template (twice), a stable instruction block, the
three scene bodies, then the ~850-token schema rules.

- **What is shared from call to call:** the first instruction sentence already
  contains the scene numbers and ref IDs (`ai/prompts/sceneAnalysis.ts:262`),
  so consecutive calls share only about 250 tokens.
- **Smaller fix (no product change):**
  - Move the numbers and ref IDs into a trailing per-call block.
  - Put the schema ahead of the scenes.
  - Emit the cache break. Pulse needs a `userQuestion` or a new flag, because
    `composeEnvelope` only emits the break in the question-last branch.
  - That gives a stable ~2K-token prefix, above every current minimum, worth
    roughly 12–25% of input.
  - Use a 5m Anthropic TTL here: the calls are sequential and every hit
    refreshes it.
- **Pulse with whole-book context:**
  - Cache the cleaned manuscript once per book. Each call then names the
    target scene and its neighbours.
  - Manuscript order and subplot order differ only in which neighbours they
    name, so **both share one cache**.
  - This is the feature that matches "load the whole manuscript". It changes
    what Pulse judges against (the whole book, not three scenes), so it is a
    product decision.

### Cost model

Pricing from `ai/cost/providerPricing.ts`. Assumptions:

- 2K tokens of fixed prompt per call and 1K output tokens per scene.
- A 5m Anthropic write and one hour of Gemini storage.
- Faerie Queene: about 75 scenes and 400K tokens (not yet split into scenes).

| Book | Model | Pulse today | Whole book, 1 scene/call | Whole book, 6 scenes/call |
|---|---|---|---|---|
| Odyssey (89 scenes, 172K) | Opus 5.5 | $4.56 | $6.52 | $3.38 |
| | GPT-6.1 Sol | $2.28 | $3.26 | $1.69 |
| | Gemini 3.1 Pro | $2.46 | $5.66 | $2.82 |
| Hound of the Baskervilles (15, 83K) | Opus 5.5 | $1.42 | $1.10 | $0.81 |
| | GPT-6.1 Sol | $0.71 | $0.55 | $0.41 |
| | Gemini 3.1 Pro | $0.74 | $1.04 | $0.79 |
| Faerie Queene (≈75, ≈400K) | Opus 5.5 | $6.90 | $10.19 | $4.74 |
| | GPT-6.1 Sol | $3.45 | $9.82 | $4.36 |
| | Gemini 3.1 Pro | $3.60 | $17.44 | $7.03 |

**Rule of thumb:** whole-book Pulse at one scene per call costs less than
today's triplets when a book has fewer than ~60 scenes (cache read 0.05×: Opus
5.5, GPT-6.1 Sol) or ~30 scenes (0.1×: Sonnet 5.5, Gemini).

**Where whole-book costs more:** above 200K tokens (Gemini) or 272K (OpenAI),
long-context pricing makes it clearly worse. Gemini's storage charge also
counts against it.

**Batching about 6 scenes per call** beats today's cost almost everywhere, but
it changes the Pulse output schema.

## Recommended order

1. **Probe, then fix OpenAI 5.6+ caching** (defects 1 and 2).
   - Send the stable text and the question as separate `input_text` blocks,
     with `prompt_cache_breakpoint` on the stable block and
     `prompt_cache_options: { mode: 'explicit' }`.
   - Stop sending the literal delimiter.
   - Map `cache_write_tokens` to cache-creation usage.
   - Retire the 24h retention UI for 5.6+ models.
   - Covers Inquiry and Gossamer.
2. **Fix what the UI reports** (defects 3–7, 9). Each fix is small and local.
3. **Update the Gemini cache manager** (defect 8):
   - set the minimum per model;
   - allow a TTL longer than 15 min for hand-run Gossamer;
   - delete caches when the run finishes.
4. **Build one canonical manuscript corpus**, used by Gossamer, Inquiry and any
   whole-book Pulse. It must be deterministic: manuscript order, stable IDs,
   cleaned bodies. This removes a duplicate computation path. It is a
   prerequisite for any future prefix sharing, not a promise of it.
5. **Decide on Pulse** (Eric's call): either the ~2K stable-prefix reorder
   alone, or whole-book context, with or without multi-scene batching.
6. **Do not build a cross-feature shared cache.**

## Demo-vault guidance with today's code

- **Anthropic** is the provider where caching works end to end for Gossamer and
  Inquiry.
  - Run the four Gossamer signals back to back, within an hour, without
    switching timeline mode.
  - Omnibus runs sequentially and aborts on a real miss.
- **OpenAI:** do not rely on caching for Omnibus or Gossamer on Sol until the
  probe in defect 1 shows `cached_tokens > 0` on question 2.
- **Gemini:** Omnibus is one combined call. Gossamer signals must fall within
  the 15-min window.
- **Pulse** gets no cache on any provider, but costs are small: about $4.60
  for the Odyssey and $0.70–1.40 per Holmes novel on Opus 5.5.
- **Sherlock Holmes:** each novel is its own book and its own cache. Saga-scope
  Inquiry is one corpus spanning the four novels.

## Sources

- Anthropic prompt caching: https://platform.claude.com/docs/en/build-with-claude/prompt-caching
- Anthropic structured outputs: https://platform.claude.com/docs/en/build-with-claude/structured-outputs
- Anthropic thinking and caching: https://platform.claude.com/docs/en/build-with-claude/thinking#thinking-and-prompt-caching
- OpenAI prompt caching: https://developers.openai.com/api/docs/guides/prompt-caching
- OpenAI pricing: https://developers.openai.com/api/docs/pricing
- Gemini context caching: https://ai.google.dev/gemini-api/docs/generate-content/caching
- Gemini caching API: https://ai.google.dev/api/caching
- Gemini pricing: https://ai.google.dev/gemini-api/docs/pricing
- Prior investigation: `docs/engineering/audits/openai-cache-miss-rootcause.md`

## Resolution (2026-10-03)

### OpenAI probe (gpt-6.1-sol)

Defect 1 confirmed live. Two questions sent against the same ~6K-token
corpus:

| Request shape | Q2 cached tokens | Q2 cache write (1.25×) |
|---|---|---|
| RT before the fix: one user block, literal delimiter, `prompt_cache_retention` | 0 | 6,092 |
| Explicit mode, breakpoint on the stable block, question in its own block | 6,069 | 0 |
| Explicit mode, no breakpoint | 0 | 0 |

The default implicit mode writes a cache on every request and bills it at
1.25× input, so every one-off OpenAI call (Pulse, onboarding) was overpaying
too.

A live re-run through the plugin's own code path (`composeEnvelope` →
`callOpenAiResponsesApi` → usage → cost → Omnibus health) after the fix:

| | Cache write | Cache read | Cost | Omnibus health |
|---|---|---|---|---|
| Question 1 | 5,474 | 0 | $0.0140 | `armed` |
| Question 2 | 0 | 5,474 | $0.0015 | `reused` |

The delimiter is no longer sent to the model.

### Fixed

- **OpenAI** (defects 1 and 2):
  - Every request sends `prompt_cache_options: {mode:'explicit'}`. A cache
    break becomes a breakpointed stable block plus a volatile block.
  - `cache_write_tokens` is parsed as cache-creation usage and priced at a new
    single-lifetime `cacheWritePer1M` rate (1.25× input; also in
    `pricing.json`).
  - Provenance now comes from usage instead of "a key was sent".
  - The pre-5.6 retention settings are removed and migrated away. The window
    is a fixed 30m.
- **Delimiter handling:** one `splitAtCacheBreak` replaces three inline copies.
  Gemini no longer leaks the delimiter to the model when it skips caching.
- **Omnibus** (defects 3–5):
  - Cache windows are recorded for sequential passes.
  - The Anthropic write double-count is gone.
  - Gemini create vs hit is priced by provider status.
  - The combined-call cost band is one call.
  - The combined call skips the provider cache, since nothing reuses its
    prefix.
- **Speculative countdowns** (defect 7, and Inquiry's OpenAI branch): a window
  opens only on a provider-reported write or read. A reused in-memory Gossamer
  result no longer restarts the window or re-reports its cost. The Gossamer
  pill tooltip refreshes per run.
- **Pulse diagnostics** (defect 6): `requestedCacheTtl` reports the TTL on the
  block actually sent, or 'none'.
- **Gemini** (part of defect 8): the minimum is 4,096 tokens (3.x), with 2×
  headroom on the estimate. The warm-cache check now hashes the same trimmed
  prefix the provider caches.
- **Determinism** (defects 9 and 10):
  - Inquiry outline/reference blocks and manifest lines sort by path.
  - The role template is in the reuse fingerprint.
  - Gossamer always assembles narrative order, so switching to Chronologue no
    longer changes the prompt or discards Gossamer AI-job answers.
- **Pulse** (triplet design unchanged by owner decision):
  - Entire-subplot mode analyzes and neighbors only scenes with content,
    matching its own scene count and the other modes.
  - The dead `processBySubplotOrder` and its i18n keys are deleted.

### Still open (not fixed here)

- The Gemini 15m TTL cap is kept deliberately (storage cost).
- `ai/forecast/estimateTokensFromVault.ts` computes its own reuse fingerprint
  (without the role template). It isn't used to match sessions.
- Reordering books in Book Manager changes the saga prefix but not the
  fingerprint.
- Pulse still sends the role template twice and the schema three ways. Left
  as-is by owner decision.
- The fallback gate's `or-chain-3` ratchet (58 > 52) was already failing at
  HEAD before this work, from unrelated files.

### Follow-up fixes (2026-10-03)

- **Gemini caches survive a plugin reload.** Each cache RT creates carries
  `rt-cache-<fingerprint>` as its `displayName`. The first registry miss per
  API key per session lists the key's caches and adopts the live RT ones as
  hits, so nothing is orphaned or duplicated. A failed listing fails the run
  like a failed create.
  - Live check (gemini-3.8-flash): session 1 created
    `cachedContents/i87x…`. After a simulated reload, session 2 got a `hit`
    on the same resource, with the provider's real expiry. The probe cache was
    deleted afterwards.
- **A Gossamer re-score is a new reading.** Every run appends Gossamer<N> to
  the beat notes, so RT's 2-minute in-memory answer cache was handing a
  re-score the previous answer verbatim. That made a duplicate run that
  flattened the history and could prune a real one.
  - Gossamer requests now skip only the in-memory OUTPUT cache. The provider
    manuscript-prefix cache still makes a re-score cheap.
  - The in-memory reuse handling added earlier the same day was unreachable
    after this, so it is deleted.
  - The run confirmation shows a non-blocking note when the selected signal
    was already scored on the same unchanged input this session ("…adds
    another reading; it does not replace the earlier one"), so the author can
    cancel an accidental repeat.
- **Scene summaries (Summary refresh) were evaluated like Pulse.**
  - Each call carries one scene, never the manuscript. The batch runs
    sequentially, two passes per scene: a Summary from the scene text, then a
    Synopsis from the new Summary.
  - The text shared between calls is about 500 tokens, below every cache
    minimum, so prompt caching has nothing to reuse here. Whole-book caching
    would only add cost: a summary needs only its scene.
  - The OpenAI explicit-mode fix already removed the 1.25× write surcharge on
    these calls.
  - Fixed: a quick re-run (the author re-flags a summary they didn't like) got
    the previous text back verbatim from RT's 2-minute in-memory answer cache.
    Both passes now skip it. Pulse had the same bug and gets the same fix. Its
    triplet design is unchanged.
  - Still open, a judgment call per feature: onboarding, the timeline audit and
    runtime estimation also write results back without skipping that cache.
    For onboarding it may be useful, replaying finished scenes when a failed
    stage is retried.
  - Summary refresh now bypasses the author's role template (owner decision),
    as Gossamer does. Both passes run under the neutral feature template, so an
    editor persona no longer colors a factual summary. AI jobs compile the same
    request, so a summary job written before this change and not yet applied
    reads as stale, like any settings change.

