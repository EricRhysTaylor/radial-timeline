# Investigation: OpenAI returns `cached_tokens: 0` across identical-fingerprint runs

Status: **RESOLVED — NO DEFECT.** The cache works correctly. Closed by
Audit-4 real-payload byte-diff. No prompt code changed.

## RESOLUTION (Audit 4, real payload evidence)

Two same-corpus runs, different questions, fixed diagnostic:

| | Run 1 (Set3) | Run 2 (Pay2) |
|---|---|---|
| Cacheable prefix fingerprint | `390aa726` | `390aa726` (identical) |
| Cacheable prefix chars | 555,189 | 555,189 (identical) |
| `cached_tokens` | 0 (cold write) | 129,792 (warm hit) |
| Cost | $0.760 | $0.267 |

The outgoing prefix is **byte-identical** across different questions and
OpenAI delivered a ~100% cache hit on the second run. The original
`cached_tokens: 0` was a **cold first run** (a cache must be written
before it can be read), made to look pathological by the old
scaffold-based diagnostic (now fixed). Decision rule outcome: prefix
identical AND provider now hits → nothing to fix, no determinism change,
no prompt-architecture change, no invented UI. The Audit-2 honesty UI
correctly shows payload-proven green only on the real hit (Run 2).

Everything below is retained as the investigation trail.

---

Status (historical): ANALYSIS COMPLETE — primary hypothesis REFUTED.

## Symptom (unchanged)

Two runs, same Book B1 corpus, OpenAI · GPT-5.5, different questions,
both `cacheReuseFingerprint: h1479981785` / same `prompt_cache_key` →
`cached_tokens: 0` on both, including the second (same-corpus) run.

## Request shape — what OpenAI actually receives

Inquiry → `InquiryRunnerService` → `aiClient.run()` → `composeEnvelope`
(`src/ai/runtime/aiClient.ts` ~L517). For OpenAI:

- `resolveProviderUserInput` (`InquiryRunnerService.ts:1282`) returns
  **`cacheableUserInput`** — instruction + schema + manifest + target
  block + `EVIDENCE:` + evidenceText, with the **question OMITTED**.
- `composeEnvelope` is called with `placeUserQuestionLast: true` and
  `cacheBreakDelimiter: '<<<CACHE_BREAK>>>'`.

Resulting OpenAI user message:

```
Project Context:\n(none)
Feature Mode Instructions:\n<systemPrompt + ROLE_TEMPLATE_GUARDRAIL>   STABLE
User Input:\n<instructions + schema + manifest + EVIDENCE (~130k tok)>  STABLE per corpus
Output Schema / Formatting Rules:\n<output rules>                       STABLE
<<<CACHE_BREAK>>>
User Question (highest priority):\n<question>                          VOLATILE (last)
```

The system message (role template) is stable. **The volatile question is
genuinely last; the entire evidence corpus is inside the stable prefix.**

## Run 1 vs Run 2 request-shape diff

Per the new unit test `src/ai/prompts/composeEnvelope.cachePrefix.test.ts`
(passing): with identical upstream inputs, the only byte difference
between two different-question runs is the text **after**
`<<<CACHE_BREAK>>>`. The pre-break prefix (incl. evidence) and the system
prompt are byte-identical. **Message ordering is correct.**

→ The Audit-2 hypothesis ("variable question precedes stable evidence")
is **REFUTED** for the real OpenAI path.

## Key finding: the in-log diagnostic measures the WRONG artifact

`inquiryLogBuilders.ts:431-437`:
`prefixChars = trace.userPrompt.length − trace.evidenceText.length`.

`trace.userPrompt` is the question-first **scaffold** variant from
`buildInquiryPromptParts` (instruction → schema → manifest → TASK →
EVIDENCE). OpenAI never receives that string — it receives the
`composeEnvelope` output (question last). So "Cacheable prefix chars
(user prompt minus evidence): 13766" describes an unused artifact, not
what was sent. Every conclusion drawn from that number ("only 13.7k
cacheable", "evidence is volatile") is an artifact of measuring the wrong
prompt. This diagnostic should capture the actual provider
`requestPayload` (already returned by `openaiProvider`/`openaiApi`).

## Remaining candidate causes (ranked)

1. **Stable-prefix non-determinism upstream of composeEnvelope.** The
   prefix is only reused if byte-identical run-to-run. Risk inputs:
   - `buildCorpusManifestLines(input.corpus.entries)` — order depends on
     `corpus.entries` ordering.
   - `evidenceText` = evidence blocks joined — depends on block order.
   - role template / `getOutputRules` — confirm no timestamp/run-id/model
     label injected.
   composeEnvelope is proven stable; if the real run's prefix diverges it
   is because one of these upstream inputs is not order-stable.
2. **OpenAI cache eligibility / lifecycle.** Automatic prompt caching is
   best-effort, prefix ≥1024 tokens, evicted after inactivity. Confirm
   the request invariants don't reset caching (model id, `text.format`
   json_schema object/key order, `max_output_tokens`, temperature/top_p,
   `prompt_cache_retention` toggling, `prompt_cache_key` usage).

## Verification step (do this next; not done here)

Instrument the **actual** outgoing OpenAI `requestPayload` (already
surfaced by `openaiProvider.generateJson` → `result.requestPayload`).
Capture two same-corpus/different-question runs, byte-diff the user
message up to `<<<CACHE_BREAK>>>`. Expected if cause #1: the prefixes
differ (locate the first divergence offset → the non-deterministic
input). Expected if cause #2: prefixes identical but provider still
reports `cached_tokens: 0` → provider/lifecycle issue, raise with OpenAI
request invariants.

## Proposed prompt architecture (already largely correct)

Target order (confirmed already implemented for OpenAI):
`stable system/role → stable instructions/schema/manifest → stable
evidence → <<<CACHE_BREAK>>> → volatile question → volatile constraints`.

Recommended changes (small, NOT a refactor):
1. Fix the cache diagnostic to measure the real `requestPayload`, not
   `trace.userPrompt`.
2. Guarantee determinism of `corpus.entries` and evidence-block order
   (stable sort on a stable key) so the proven-stable composeEnvelope
   prefix is actually stable in production.
3. Keep the prefix-stability unit test as a regression lock.

## Tests delivered

`src/ai/prompts/composeEnvelope.cachePrefix.test.ts` — proves the
composed stable prefix (incl. evidence) is byte-identical across two
different questions and the question is post-break. Localizes any real
instability to upstream corpus/evidence ordering.

## Audit 4 — real request payload byte-diff (instrumentation delivered)

The misleading diagnostic is FIXED. `inquiryLogBuilders.ts` no longer
derives the cacheable-prefix metric from `trace.userPrompt`. It now
extracts the actual outgoing prompt from the captured provider
`requestPayload` (`extractRequestPromptText`: OpenAI `input[]` /
legacy `messages[]`) and logs:

- `Cacheable prefix chars (real request, system + user up to cache break)`
- `Cacheable prefix fingerprint: <FNV-1a hash>` — stable, content-free
- `Outgoing prompt chars (system + user, total)`
- `Cache break present in request: yes/no`

If the payload was not captured it says so explicitly — **no scaffold
fallback** (decision-rule compliant). Regression locked by
`inquiryLogBuilders.test.ts` → "Audit 4" describe block.

### How to obtain the byte-diff verdict (one user action)

A live two-run capture cannot be executed from the dev environment, but
the fingerprint makes the diff observable directly from the logs:

1. Run Inquiry twice — same corpus, two different questions, OpenAI.
2. Compare `Cacheable prefix fingerprint:` in the two Inquiry logs.

- **Fingerprints EQUAL** → prefix is byte-identical; if the provider
  still reports `cached_tokens: 0`, this is OpenAI provider/invariant
  behavior (best-effort cache, eviction, structured-output handling).
  Per the decision rule: document as provider behavior, **do not invent
  UI states**, do not change prompt architecture.
- **Fingerprints DIFFER** → the stable prefix is non-deterministic.
  Cause #1 confirmed. Fix determinism ONLY at the proven divergence
  (candidate inputs: `buildCorpusManifestLines(corpus.entries)` order,
  evidence-block join order). Re-diff to confirm before any further
  change.

No prompt architecture changed in Audit 4 (byte-diff has not yet proven
a defect; rule honored).

## Related

- Audit-2 honesty patch: cache UI reports only payload-proven reuse.
- Doctrine: `docs/engineering/standards/code-doctrine.md`,
  `docs/engineering/standards/fallback-policy.md`.
