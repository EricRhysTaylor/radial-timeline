# AI Model Curation Standard

Adding a provider model is an API integration, not a registry-only update.

**Read [`model-promotion.md`](model-promotion.md) first.** That document defines *when* a model is allowed to enter the catalog at all. This document defines *how* to add it once promotion has been approved. Adding a model that doesn't pass the promotion policy is not allowed even if the curation checklist below is met.

## The discipline

Every provider has quirks. They publish their own API references that name exactly which parameters each model accepts, deprecates, or constrains. **Reading those docs is step one, every time.** The Anthropic Opus 4.7 / Gemini 3.5 Flash failures both came from skipping this step and transcribing assumptions from older models instead.

## New Model Checklist

When promotion is approved for `<provider>/<model>`:

### 1. Read the provider's official API reference for this specific model

- **Anthropic** — https://docs.anthropic.com/en/docs/about-claude/models
- **OpenAI** — https://platform.openai.com/docs/models
- **Google** — https://ai.google.dev/gemini-api/docs/models

Note specifically:
- Which sampling parameters are accepted (`temperature`, `top_p`) — these change between model generations, especially for thinking-capable models
- Which thinking / reasoning controls exist (`thinking_budget`, `reasoning_effort`, `thinkingConfig`)
- Citation / structured-output / cache APIs and any model-specific constraints. **Structured-output mode is now constraint-dependent**, not one-size-fits-all: models with a forced-tool-compatible request use `record_structured_response` + `tool_choice` (Opus 4.8/4.7), but always-on-thinking models (`constraints.thinkingAlwaysOn`, e.g. Claude Fable 5) cannot use a forced `tool_choice` and must use `output_config.format` (json_schema) instead — the JSON then arrives in a text block. Note which one the model requires and set the constraint flags accordingly (`supportsAdaptiveThinking`, `thinkingAlwaysOn`)
- Context window, output budget, and any long-context tier thresholds
- Pricing (input, output, cache-read, cache-write where applicable)

If the docs disagree with what an older sibling model accepted, **the docs win**. Do not transcribe from the previous model entry's profile.

### 2. Update all four sources in lockstep

The promotion is atomic — these all change in the same PR:

- `src/ai/registry/builtinModels.ts` — add the new model, remove the entry it replaces
- `src/ai/registry/modelRequestProfiles.ts` — declare exactly the parameters from step 1; add a per-model override if it deviates from the provider default
- `src/ai/cost/providerPricing.ts` — pricing rows, cache-read/write, long-context thresholds
- `scripts/models/registry.json` — drift-snapshot reference (the picker reads `BUILTIN_MODELS` directly via `getPickerModelsForProvider`; there is no separate `src/data/aiModels.ts`)

### 3. Run one real call with the full RT parameter set

```
npm run smoke-model -- --provider <anthropic|openai|google> --model <model-id>
```

Required env vars: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, or `GEMINI_API_KEY`.

The smoke sends a tiny Inquiry-shaped request including every parameter we use in production (temperature, top_p, thinking budget where applicable, JSON schema, system prompt, user prompt). One HTTP call. The provider's response is ground truth.

### 4. If the smoke fails, read the error and fix the profile

A 4xx response names the offending parameter. Update `modelRequestProfiles.ts` to mark that parameter unsupported for this model. Re-run the smoke. Repeat until it passes.

Do not skip this step. Do not assume the older sibling model's profile is correct. Do not invent fallback paths in the sanitizer to paper over a wrong profile.

### 5. Run `npm run gates` — all 11 must pass

The catalog dispatch contract test auto-iterates `BUILTIN_MODELS` so the new model is exercised through the sanitizer immediately. The model coverage gate enforces cross-file consistency.

## No Silent Compatibility

Do not rely on provider rejection to discover unsupported parameters in production. The sanitizer must strip unsupported fields before dispatch, and adapter-level guards must prevent direct legacy calls from bypassing the sanitizer.

Do not silently fall back to a heuristic when a provider call fails. Per [`code-doctrine.md`](code-doctrine.md) §2 and [`inquiry-critical-path-rules.md`](inquiry-critical-path-rules.md) §8: throw, surface the error, show "unavailable" — never substitute a fabricated number labeled as authoritative.

Do not clear release-watch alerts for a new model until smoke passes, all 11 gates pass, and the model has been exercised on a real corpus.

## See also

- [`model-promotion.md`](model-promotion.md) — when a model is allowed to enter the catalog
- [`code-doctrine.md`](code-doctrine.md) — § Prefer One Canonical Path, § Fail Clearly Instead of Falling Back
- [`inquiry-critical-path-rules.md`](inquiry-critical-path-rules.md) — capabilities, fallback, and silent-substitution rules on the AI critical path
