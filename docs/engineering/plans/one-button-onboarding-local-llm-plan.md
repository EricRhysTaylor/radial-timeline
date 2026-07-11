# One-Button Vault Onboarding (Local LLM) Plan

## Status

Planning. No implementation started. This document maps the feature end to
end against the current codebase (v6.2.6) so implementation can proceed in
small verified slices.

## Goal

Book Designer covers the *fresh vault* path (template scaffold). There is no
equivalent for the *existing vault* path: an author with a folder of scene
notes (or imported Scrivener/Ulysses markdown) today has to hand-write
`Class: Scene`, `Act`, `Synopsis`, `Subplot`, `When`, etc. per note, or set
up frontmatter remapping by hand.

One-Button Onboarding closes that gap: point the plugin at the book's source
folder, press **Onboard this manuscript**, and a local LLM reads each note
and proposes the canonical Radial Timeline frontmatter. Nothing leaves the
machine — the feature targets an advanced local model on Apple Silicon
(Mac mini / Studio, 48 GB unified memory and up), which is exactly the
audience that refuses to send manuscript text to a cloud provider.

The prompt that drives the extraction is the **same onboarding prompt
published on the website onboarding page**, stored in the plugin as the
single source of truth and surfaced as a small editable settings area.

## Product Shape

### Entry points (one button, two doors)

1. **Welcome screen card.** `renderWelcomeScreen` (`src/view/WelcomeScreen.ts:462`)
   currently shows three hero cards (Book Project / Sample Vault / Website).
   Add an *Onboard existing manuscript* action on the Book Project card
   (secondary action slot, same pattern as the Book Designer link at
   `WelcomeScreen.ts:501`). The welcome screen only renders when the vault
   has no `Class: Scene` notes (`src/view/TimeLineView.ts:2440-2444`) —
   precisely the moment this feature matters.
2. **Command palette.** Register `onboard-manuscript` in
   `src/services/CommandRegistrar.ts` next to `book-designer`
   (`CommandRegistrar.ts:137-140`).

Both open the same **Onboarding modal**.

### Flow inside the modal

```
Preflight ──▶ Survey (1 call) ──▶ Per-note extraction (N calls) ──▶ Review ──▶ Apply
   │                                                                  │
   └── hard-stops: no local server, weak model, no book folder        └── nothing written before this point
```

1. **Preflight (no AI).**
   - Resolve the active book profile's source folder; inventory markdown
     notes; skip notes that already carry `Class: Scene` (re-runnable by
     construction).
   - Run `getLocalLlmClient(plugin).runDiagnostics()`
     (`src/ai/localLlm/client.ts:111-113`) and
     `inferLocalLlmCapability` (`src/ai/localLlm/capabilityInference.ts:119-152`).
     Require the `structuredJson` diagnostic to pass and capability tier ≥ 2;
     below that, show the model-recommendation panel (see Hardware section)
     instead of a doomed run.
   - Show scope summary: N notes, estimated wall time (notes × measured
     per-call latency from the survey call).
2. **Corpus survey — one structured call.** Send the filename list plus the
   first ~80 words of each note (titles and openings, not full text) and ask
   for book-level structure: probable act boundaries, a candidate subplot
   list, and per-file `isScene` classification (chapters vs. character notes
   vs. research). This gives every subsequent per-note call shared context
   and keeps the subplot vocabulary consistent across the book.
3. **Per-note extraction — sequential loop.** For each candidate scene note,
   one `generateJson` call (`src/ai/localLlm/client.ts:142-206`) with the
   note body plus the survey result, returning the Scene field schema below.
   Sequential (not concurrent) on purpose: local runtimes serve one request
   well, and the Scene Analysis batch pattern is already sequential
   (`src/sceneAnalysis/Processor.ts:233`).
4. **Review — report-first.** A results table: per note, the proposed
   frontmatter and a confidence flag. Accept all / per-note toggle / edit
   subplot names in one place before anything is written. Low-confidence and
   failed notes are listed, never silently retried (the structured-JSON
   pipeline is single-attempt with no repair fallback —
   `src/ai/localLlm/structuredJson.ts:102-151`, confirmed in
   `src/ai/localLlm/diagnostics.ts:21`).
5. **Apply — safe writes only.** Write accepted proposals through
   `app.fileManager.processFrontMatter` exactly as Scene Analysis does
   (`src/sceneAnalysis/FileUpdater.ts:50,111,167`). Never string-build YAML.
   Existing frontmatter keys the user already has are preserved; only
   canonical Scene keys are added or filled. Notes that fail get a review
   marker in the results panel, mirroring the `safeWritePolicy` warning
   route (`src/sceneAnalysis/safeWritePolicy.ts:8-28`).

### Extraction output schema (per note)

Target the canonical Scene template keys (`src/settings/defaults.ts:142-159`).
V1 fills the fields a model can infer from prose; workflow fields stay at
safe defaults.

| Field | Source | Notes |
| --- | --- | --- |
| `Class` | fixed | always `Scene` (only when survey says `isScene`) |
| `Act` | survey + note | clamped to Settings → Core act count |
| `Synopsis` | note | respects existing `Synopsis max words` setting |
| `Subplot` | survey vocabulary | must be one of the survey's subplot list |
| `Character` | note | proper-noun extraction, deduped against survey list |
| `When` | note (best effort) | omit when the model can't ground a date; never fabricate |
| `Duration` | note (best effort) | same rule |
| `Status` | fixed default | `Complete` (text exists) — confirmed in Review step |
| `Publish Stage` | fixed default | `Zero` |

Scene *order* stays filename-driven (leading number + `Act`), per the
documented model in `wiki/Getting-Started.md:12`. V1 proposes filename
renumbering only as an optional Review-step checkbox that reuses the
manuscript ripple-rename machinery; it does not silently rename.

## The Onboarding Prompt (shared with the website)

- **Single source of truth in the repo:** new `src/ai/prompts/onboarding.ts`
  exporting `ONBOARDING_SURVEY_PROMPT` and `ONBOARDING_SCENE_PROMPT`,
  composed through the existing envelope
  (`src/ai/prompts/composeEnvelope.ts:29-62`) with the output schema slot
  carrying the JSON schema.
- **Website parity:** the website onboarding page should render the same
  canonical text. The website could not be fetched from this environment
  (bot-protected), so the sync direction needs Eric's call — recommended:
  plugin repo is canonical, website copies at publish time (same doctrine as
  the sample-vault listing dependency noted in
  `docs/engineering/sample-vaults.md:244`). If the website prompt already
  differs, reconcile it into `onboarding.ts` first.
- **User-editable override:** stored as
  `aiSettings.onboarding.promptOverride: string | null` — `null` means
  "track the built-in default". This is the plugin's first per-feature
  prompt override (today only Role Templates are user-editable,
  `src/ai/settings/aiSettings.ts:44-85`), so keep it deliberately small: one
  textarea + one *Reset to default* button. The override replaces only the
  instruction block of the envelope, never the schema/output-rules block —
  users can retune tone and heuristics without being able to break JSON
  parsing.

## Settings Surface (small, in the AI tab)

Put it in the **AI tab**, not Advanced: the feature is AI-routed and its
prerequisites (Local LLM config + validation cards) already live there.
Advanced → Configuration keeps only what it already has (frontmatter
remapping stays where it is and remains the manual alternative).

New card **Vault onboarding**, appended to the explicit section order at
`src/settings/sections/AiSection.ts:3754-3763`, rendered with the existing
card conventions (`ERT_CLASSES.CARD/PANEL/STACK`, `ert-section-title`,
`aiConfigCreateRow` helper at `AiSection.ts:3556-3570`). Contents — four
rows, nothing more:

1. **Onboarding prompt** — textarea bound to
   `aiSettings.onboarding.promptOverride`, placeholder showing the built-in
   default; *Reset* extra-button.
2. **Model readiness** — read-only status line reusing the capability tier
   from the Local LLM validation card ("Ready — tier 3 (validated)" /
   "Run Validate Local LLM first").
3. **Recommended models** — static help text per the Hardware section, with
   a wiki link.
4. **Start onboarding** — CTA button, enabled only when readiness passes;
   opens the same modal as the command.

## Hardware & Model Guidance (48 GB+ Apple Silicon)

Guidance shipped as settings help-text + a wiki section, and encoded as
capability requirements rather than a hard model allowlist (any
Ollama/LM Studio/OpenAI-compatible server works —
`src/ai/localLlm/backends.ts:26-52`).

- **48 GB (Mac mini M4 Pro / Studio base):** ~34-36 GB usable for
  model + context. Sweet spot: **Qwen3 32B Q4** (~20 GB), **Gemma 3 27B
  QAT** (~17 GB), or **Qwen3 30B-A3B** (MoE, fast per-token) — all leave
  room for the 32k context the extraction call wants. Llama 3.3 70B Q4
  (~40 GB) does not fit comfortably at 48 GB.
- **64-128 GB (Studio):** **Llama 3.3 70B Q4** or **Qwen3 235B-A22B**
  quantized become viable for higher-quality survey passes.
- **Floor:** models below ~14B or without reliable JSON mode fail the
  structured-JSON diagnostic in practice; the tier ≥ 2 preflight gate turns
  that into a clear message instead of a garbage run.
- Registry follow-up: add curated entries (e.g. `qwen3:32b`,
  `gemma3:27b`) to `BUILTIN_MODELS` (`src/ai/registry/builtinModels.ts:162-187`)
  so the model pill list in the Local LLM card labels them with real
  context/output numbers instead of the generic `local-model` fallback.

## Architecture

New module `src/onboarding/`:

```
src/onboarding/
  OnboardingService.ts        // preflight → survey → extract → apply orchestration
  OnboardingModal.ts          // progress + review UI (Modal, AbortController)
  onboardingSchemas.ts        // JSON schemas: survey result, per-scene result
  onboardingSettings.ts       // types + defaults + validate for aiSettings.onboarding
src/ai/prompts/onboarding.ts  // canonical prompts (website-shared text)
```

Reuse, don't rebuild:

| Concern | Existing piece |
| --- | --- |
| LLM call w/ strict JSON | `LocalLlmClient.generateJson` (`src/ai/localLlm/client.ts:142`) |
| Connection/model gating | `runDiagnostics` + `inferLocalLlmCapability` (`diagnostics.ts:35`, `capabilityInference.ts:119`) |
| Batch loop + abort + progress | pattern from `Processor.ts:233-325` + `SceneAnalysisProcessingModal.ts` (`isAborted`, `setProcessingQueue`, `markQueueStatus`, `updateProgress`) |
| Safe YAML write | `processFrontMatter` pattern (`FileUpdater.ts`) + `safeWritePolicy` warning route |
| Prompt assembly | `composeEnvelope` (`src/ai/prompts/composeEnvelope.ts`) |
| Settings card | AiSection section-order array (`AiSection.ts:3744-3763`) |
| Remap interplay | `getSupportedFrontmatterRemapTargets` (`src/utils/frontmatter.ts:16-27`) — when remapping is enabled, Review shows the user's key names |

Doctrine fit: no new abstraction layer, no fallback chains — one pipeline,
hard preflight gates, single-attempt calls with surfaced failures
(per `docs/engineering/standards/code-doctrine.md`).

## Gating & Rollout

1. **Slice 1 (beta):** command + modal behind `areBetaCommandsVisible`
   (`src/settings/featureGate.ts:9-16`) — dev builds only. Prompt constants
   land; settings card hidden.
2. **Slice 2:** settings card in AI tab, welcome-screen action, wiki page
   (`wiki/Getting-Started.md` existing-vault section links to it).
3. **Slice 3 (ship):** decide free vs. Pro via `hasProFeatureAccess`
   (`featureGate.ts:5-7`). Recommendation: **free** — it's an adoption
   funnel, not a power feature; the hardware requirement is gate enough.

Cloud providers are deliberately out of V1 scope: onboarding sends full
note bodies, and the local-only framing is the privacy story. If demand
appears, the router already abstracts providers and the schema/envelope
carry over unchanged.

## Verification Plan

- Unit (vitest): schema validation round-trips; prompt override composes
  into envelope without touching the schema block; remap-aware key display;
  act clamping; skip-already-onboarded inventory logic.
- Contract: extend the `localLlmContract` pattern
  (`src/sceneAnalysis/localLlmContract.test.ts`) with an onboarding fixture —
  canned model outputs (clean, fenced, chatty, truncated) through the
  extraction parser.
- Manual: sample-vault-without-frontmatter fixture (strip a copy of the
  existing sample vault) run end-to-end against Ollama + Qwen3 32B on
  48 GB hardware; verify timeline renders correctly after Apply and that
  re-running is a no-op.
- Gates: `npx tsc --noEmit`, `npx vitest run`, build-only — per
  feature-audit playbook before any slice is called done.

## Open Questions (for Eric)

1. **Website prompt text** — paste the current onboarding-page prompt so
   `onboarding.ts` starts from parity (page is bot-protected from this
   environment; couldn't self-serve).
2. **`When`/`Duration` in V1?** Best-effort inference is genuinely hard for
   local models; shipping V1 as Progress/Narrative-ready (Act, Synopsis,
   Subplot, Character, Status) and leaving Chronologue fields for a second
   pass is the conservative cut.
3. **Filename renumbering** — include the optional rename checkbox in V1
   Review, or defer entirely to the existing manual ripple-rename?
