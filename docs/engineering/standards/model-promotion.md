# Model Promotion Policy

## Stance

**Adding a model is a replacement, not an accretion.** RT supports the minimum number of cloud models needed to deliver quality across providers. The catalog grows only when a *better* model becomes available and replaces an existing entry. The catalog never grows just because a new model exists.

This policy was adopted on **2026-05-22** after the audit found that every model addition produced a downstream breakage (the Gemini 3.5 Flash failure being the most recent), and that the testing burden grew superlinearly with catalog size while quality did not improve.

## Current catalog shape

One top model per provider line, plus a Google fast/deep split where the speed/depth tradeoff is a genuine quality dimension (not a cost dimension), plus an optional **one-back continuity model** on the Anthropic depth lane (see [Continuity models](#continuity-models-one-back)).

```
Anthropic: Claude Opus 5                (depth, current — auto-selected)
           Claude Opus 4.8              (depth, one-back continuity)
           Claude Fable 5.1             (depth, premium 'pro' channel — explicit choice only)
OpenAI:    GPT-5.6 Sol                   (depth — promoted 2026-09-05, replacing GPT-5.5)
           GPT-5.6 Terra                 (economy second on the gpt-5 line, replacing GPT-5.4)
Google:    Gemini 3.1 Pro Preview        (depth)
           Gemini 3.5 Flash              (speed — different reasoning style, not just faster)
Ollama:    llama3, local-model           (local)
```

The picker UX still routes through provider → model selection — the infrastructure for multi-model catalogs is intact. We just keep the catalog small on purpose.

## Continuity models (one-back)

When a model is promoted, authors with work in progress must not be force-migrated. The promoted-from model is retained for one generation as a **continuity model**:

- The catalog holds at most **two models per line**: the current model and the immediately-prior one (N-1). A third (N-2) is retired in the same promotion.
- **Auto-selection always resolves to the newest** (latest-stable). The continuity model is an explicit opt-in in the picker, never the default.
- The continuity model keeps a full registry + pricing + request-profile entry — it must stay servable, not a hidden stub.

Scope: currently applied to the **Anthropic depth lane only** (Opus). Other providers stay single-entry until there's a concrete reason to retain a prior model; the rule then generalizes per line.

Enforced by the per-line cap in [`modelCatalogContract.test.ts`](../../../src/ai/registry/modelCatalogContract.test.ts): no line may exceed two active (non-deprecated) cloud models, so continuity cannot silently slide back into accretion.

## When to promote a new model

A new model enters the catalog only when **all** of these hold:

1. **A demonstrably better candidate exists.** Better at one of: narrative reasoning, structured output reliability, latency-quality tradeoff, or context window. Run the candidate on real corpora — multiple manuscripts, Inquiry full + segmented modes, Gossamer — and compare against the incumbent. *Subjective comparison is acceptable; rough notes attached to the commit are sufficient.*

2. **It replaces an existing entry in the same lane.** Anthropic depth lane → swap Opus version. Google speed lane → swap Flash version. Don't add a third Anthropic model alongside.

3. **The full curation checklist in [`ai-model-curation.md`](ai-model-curation.md) is met** — registry entry, pricing entry, request profile, capability declarations, all updated in lockstep.

4. **All 11 gates pass**, including the catalog dispatch contract test ([`modelCatalogContract.test.ts`](../../../src/ai/registry/modelCatalogContract.test.ts)) and the model coverage gate ([`check-model-coverage.mjs`](../../../scripts/check-model-coverage.mjs)).

## When NOT to promote

- **"A new model exists"** is not enough. Provider catalogs ship preview/snapshot/dated-variant models constantly. Most never matter for our workload.
- **"A user asked for it"** is not enough. Power users sometimes have preferences for specific Claude Sonnet versions or specific Gemini Flash configurations. Those are individual tastes, not catalog requirements. If the workload-quality difference is real and reproducible, see "When to promote" above.
- **"It's cheaper"** is not enough. Cost is a constraint, not a quality. If a cheaper model meets quality, it can *replace* (not augment) the current entry.
- **"It's a snapshot of the current model"** is not enough. Dated snapshots (e.g., `gpt-5.5-2026-04-23`) are ephemeral provider artifacts. RT consumes the rolling alias, not the snapshot.

## When to demote / retire

A model leaves the catalog when:

- It is pushed past the one-back continuity slot — a newer model promoted the current model to continuity (N-1), making this one N-2; it retires in that same promotion. On lines with no continuity slot, the swap is atomic: old out, new in, same commit.
- The provider deprecates it and a successor is GA.
- Six months pass without it being the best in its lane and a credible replacement exists.

When you retire a model, the cleanup pass covers:

- `src/ai/registry/builtinModels.ts` — remove the entry
- `src/ai/cost/providerPricing.ts` — remove the pricing row
- `src/data/aiModels.ts` — remove the curated picker entry
- `scripts/models/registry.json` — remove from the drift snapshot
- `src/utils/modelResolver.ts` — leave the LATEST_ALIAS_DISPLAY_NAMES entry if historic logs reference the model (for display only)
- Any test files that pin the model id specifically (rewrite using a surviving model or delete)
- `scripts/check-model-coverage.mjs` — review allowlists for retired references

## Process

A model promotion is a single PR with the following shape:

1. **Title**: `model(promote): <new model> replacing <old model>`
2. **Body**: brief notes on why the new model is better — even rough impressions are fine. The goal is "future-you can remember why" not formal benchmarks.
3. **Diff scope**:
   - One model entry deleted from BUILTIN_MODELS
   - One model entry added
   - Corresponding pricing rows swapped
   - Corresponding curated picker entry swapped (if applicable)
   - registry.json drift snapshot updated
   - Any tests that pinned the old model id get updated or removed
4. **Verify**: `npm run gates` passes — all 11 steps green.

## Why this works

The audit's "every time we add a model, something breaks" pattern came from:

- Models accreting instead of replacing → catalog grew to 20 entries
- Per-model curation surface (registry + pricing + profile + picker + tests) didn't shrink in proportion to maintenance attention
- Tests pinned specific dollar amounts and specific model IDs, so every pricing rotation broke 50+ tests
- Provider catalog drift (Google publishing new preview models monthly) tempted reflex additions

This policy removes the temptation. The catalog stays small by default. New models pass through a deliberate promotion gate. The contract test ([modelCatalogContract.test.ts](../../../src/ai/registry/modelCatalogContract.test.ts)) auto-iterates `BUILTIN_MODELS`, so it scales with whatever catalog shape the policy produces.

## See also

- [ai-model-curation.md](ai-model-curation.md) — required curation checklist for any model that *does* enter the catalog
- [code-doctrine.md](code-doctrine.md) — § Prefer Deletion Over Accommodation, § Prefer One Canonical Path
- [inquiry-critical-path-rules.md](inquiry-critical-path-rules.md) — why determinism on the Inquiry path requires a small, well-tested catalog
