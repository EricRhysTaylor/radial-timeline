# One-Button Manuscript Onboarding (Local LLM) Plan

## Status

Planning. No implementation started. This document maps the feature end to
end against the current codebase (v6.2.6) so implementation can proceed in
small verified slices.

**Revised 2026-07-11** after a design pass with Eric. The scope grew from
"existing vault of notes" to a single feature that also **imports external
manuscripts** (Scrivener, Word) directly. See the Decision Log at the end
for what changed and why.

## Goal

Book Designer covers the *fresh vault* path (template scaffold). There is no
equivalent for the two real onboarding cases an author actually arrives with:

1. **A vault of prose notes** with no Radial Timeline frontmatter — they'd
   have to hand-write `Class: Scene`, `Act`, `Synopsis`, `Subplot`, etc. per
   note.
2. **An external manuscript** that was never in Obsidian at all — a
   **Scrivener project** (with its binder structure and custom metadata) or a
   **Word `.docx`** (with heading/TOC structure and chapter notes).

One feature closes both. The author drops the source into a folder in the
vault, points a new book at it, and presses **Onboard this manuscript**. A
local LLM reads the material and proposes the canonical Radial Timeline
frontmatter; the plugin writes a clean, RT-formatted book **into a new folder,
leaving the source untouched**. Nothing leaves the machine — the feature
targets an advanced local model on Apple Silicon (the reference test rig is a
**Mac Studio, 64 GB unified memory**), which is exactly the audience that
refuses to send manuscript text to a cloud provider.

The prompt that drives the extraction is the **same onboarding prompt
published on the website onboarding page**, stored in the plugin as the
single source of truth and surfaced as a small editable settings area.

## Scope

| Source | V1 | Notes |
| --- | --- | --- |
| Existing vault `.md` notes | ✅ | Prose notes lacking `Class: Scene`; enrich then materialize into the RT book. |
| **Scrivener `.scriv`** | ✅ | Richest structure (binder = scenes; per-doc Title + Synopsis + custom metadata). Best quality/least LLM guessing. |
| **Word `.docx` + TOC** | ✅ | Heading/TOC structure = chapters; comments = chapter notes. |
| PDF | ❌ → **V2** | Noisy text layer, OCR rabbit-hole, most manual cleanup. Deferred for sure. |
| Cloud LLM providers | ❌ | Local-only is the privacy story; the router already abstracts providers if demand appears. |

V1 target from Eric: **Scrivener and Word, clean results, minimal manual
follow-up.**

## Local model transport — MLX changes nothing in the plugin

The plugin is JS in Electron; it cannot embed MLX (Python/Swift). It talks to
a model over **HTTP**, so MLX is just *another OpenAI-compatible server behind
the interface that already exists* (`src/ai/localLlm/backends.ts:26-52`). No
MLX-specific plugin code is needed — the three-backend router already covers
it. Two ways to put MLX behind that interface on the Mac Studio:

- **LM Studio + MLX runtime (recommended)** — GUI model management, Apple
  Silicon MLX runtime, serves the OpenAI API on `:1234`; use the existing
  **LM Studio** backend. Zero new plugin code.
- **`mlx_lm.server`** — `pip install mlx-lm` → `mlx_lm.server --model …`,
  OpenAI API on `:8080`; use the existing **OpenAI-compatible** backend.
  Leaner, CLI-only.

(Ollama also runs well on Apple Silicon but uses llama.cpp + Metal on GGUF,
not MLX proper — fine, just not the MLX speed path.)

## Architecture — source adapters feeding one shared spine

The three source types differ **only in parsing**. Everything after "I have an
ordered list of scenes with whatever metadata the source already carried" is
identical, and it is the pipeline below. So V1 is one spine plus a small
adapter per source:

```
  SOURCE (one adapter each)      STAGE 0: INGEST            SHARED SPINE (format-agnostic)
  ─────────────────────────      (deterministic, no LLM)    ─────────────────────────────
  Existing .md notes      ─┐
  Scrivener .scriv        ─┤──►  Normalize into      ──►    Survey (1 LLM call)
  Word .docx + TOC        ─┤     the Manuscript Model        → per-scene extract (LLM, sequential)
  (PDF — V2)              ─┘     (see contract below)        → Review (report-first) + metadata mapping
                                                             → Materialize into a NEW book folder
                                                             → Final report + manual follow-ups
```

The existing-vault case is just "the `.md` adapter." The LLM, review, write,
and report code is written **once**; adapters never call the model.

### Manuscript Model (the adapter → spine contract)

Every adapter produces the same normalized structure — deterministic, no AI:

```ts
interface ManuscriptModel {
  sourceKind: 'md' | 'scrivener' | 'docx';
  chapters: Array<{
    title: string | null;
    scenes: Array<{
      title: string | null;
      rawText: string;                       // plain prose, RTF/markup stripped
      knownMetadata: Record<string, string>; // e.g. Scrivener label/status/custom fields
      knownSynopsis: string | null;          // Scrivener's synopsis field, if present
      sourceRef: string;                     // origin doc/heading, for the report
    }>;
  }>;
  customFields: string[];                     // distinct non-canonical keys seen (Scrivener)
}
```

### Per-format reality — parse explicit structure first, LLM fills gaps

The critical principle (and RT doctrine — single source of truth): **never let
the LLM re-derive a boundary the format already encodes.**

| Source | Structure parsed deterministically | LLM has to infer | Parser approach / risk |
| --- | --- | --- | --- |
| Scrivener `.scriv` | Binder XML (`.scrivx`) = chapter/scene tree; per-doc **Title + Synopsis**; custom metadata; Label/Status | Act boundaries; Subplot/Character if absent from metadata; normalization | Parse `.scrivx` XML + per-doc RTF bodies. **Risk:** JS RTF→text is imperfect; may ship a pragmatic strip-to-text. |
| Word `.docx` + TOC | Heading 1/2/3 styles + TOC field = chapters; comments (`comments.xml`) = chapter notes | Scene segmentation within a chapter; synopses; classification | `mammoth`-style docx→HTML preserving headings. **Risk:** bundle size + Node deps under esbuild/Obsidian — verify it bundles first. |
| PDF (V2) | Bookmarks/outline if present | Everything, plus header/footer/hyphenation cleanup; OCR if scanned | Deferred. |

Scrivener's synopsis field maps almost 1:1 to `Synopsis`, so Scrivener yields
the highest-fidelity onboarding with the least LLM guessing.

## Non-destructive output — reuse the Draft clone plumbing

The onboarded RT material is written into a **new folder** (working name
"`<Book> RT`"), a sibling of the untouched source. This reuses the existing
Draft-clone machinery rather than inventing folder logic:

- `resolveDraftTarget` / `suggestNextDraftLabel` / `getDraftDisplayTitle`
  (`src/utils/draftBook.ts:57-209`) already compute a new labeled book-folder
  destination and register it. Onboarding **writes the parsed + enriched `.md`
  notes** into that folder (it does not `copyFolderRecursive` the
  `.scriv`/`.docx` binaries — the source is parsed, not copied).
- **The source folder is left totally alone.** After a successful onboard, the
  book profile is **repointed to the new RT folder** and the source is
  **de-listed from Book Manager** so the folder-signal stops offering it as
  onboardable (`BookProfile.sourceFolder`, `src/utils/books.ts:167,203`).
  Mechanism: repoint the profile or stamp an `onboardedAt` marker the signal
  detector checks — decide in Slice 1 (see Open Questions).

This keeps source and RT format cleanly separated — no risk of mixing the
original `.scriv`/`.docx` with the generated Obsidian notes.

## Product Shape

### Entry points (one feature, several doors)

1. **Welcome screen card (primary).** `renderWelcomeScreen`
   (`src/view/WelcomeScreen.ts:462`) shows hero cards; add an *Onboard existing
   manuscript* action on the Book Project card (secondary slot, same pattern as
   the Book Designer link at `WelcomeScreen.ts:501`). The welcome screen renders
   only when the vault has no `Class: Scene` notes
   (`src/view/TimeLineView.ts:2440-2444`) — precisely when this matters.
2. **Command palette (backup).** Register `onboard-manuscript` in
   `src/services/CommandRegistrar.ts` next to `book-designer`
   (`CommandRegistrar.ts:137-140`).
3. **Book Manager button.** A "New book from existing manuscript" action in the
   Book Designer / Book Manager surface (`src/modals/BookDesignerModal.ts`).
4. **Folder-signal progressive disclosure.** Create a new book → point it at a
   folder → the plugin sniffs the folder and only surfaces the *Begin Local LLM
   onboarding* button when signals are present. Don't nag; offer when it'll work.

**Onboarding signals** (the button appears when all hold):
- The folder contains a supported source — a `.scriv` package **or** `.docx`
  **or** ≥ N prose `.md` notes lacking `Class: Scene`; **and**
- Local-LLM diagnostics pass (server reachable + capability tier ≥ 2). If the
  model isn't up, show a *disabled* button with "Configure a local model to
  enable" — fail clearly, never a dead button; **and**
- The folder is not already stamped onboarded.

### Flow inside the modal

```
Preflight ─▶ Ingest ─▶ Survey (1 call) ─▶ Per-scene extract (N calls) ─▶ Review + Mapping ─▶ Materialize ─▶ Report
   │                                                                          │
   └── hard-stops: no local server, weak model, unsupported source            └── nothing written before this point
```

1. **Preflight (no AI).** Detect source kind; run
   `getLocalLlmClient(plugin).runDiagnostics()`
   (`src/ai/localLlm/client.ts:111-113`) + `inferLocalLlmCapability`
   (`src/ai/localLlm/capabilityInference.ts:119-152`); require the
   `structuredJson` diagnostic and capability tier ≥ 2, else show the
   model-recommendation panel instead of a doomed run. Show scope summary
   (chapters/scenes, estimated wall time).
2. **Ingest (no AI).** Run the matching adapter → Manuscript Model.
3. **Corpus survey — one structured call.** Send the scene list + openings (not
   full text) and ask for book-level structure: probable act boundaries, a
   candidate subplot list, per-scene `isScene` classification. Gives every
   per-scene call shared context and a consistent subplot vocabulary.
4. **Per-scene extraction — sequential loop.** For each candidate scene, one
   `generateJson` call (`src/ai/localLlm/client.ts:142-206`) with the scene
   body + survey result, returning the Scene schema below. Sequential on
   purpose (local runtimes serve one request well; mirrors
   `src/sceneAnalysis/Processor.ts:233`).
5. **Review — report-first.** Results table: per scene the proposed
   frontmatter + a confidence flag. Accept all / per-scene toggle / edit
   subplot names in one place. Low-confidence and failed scenes are listed,
   never silently retried (structured-JSON pipeline is single-attempt —
   `src/ai/localLlm/structuredJson.ts:102-151`). **For Scrivener, this step
   also hosts the metadata mapping table (below).**
6. **Materialize — safe writes into the new folder.** Create the RT book folder
   via the Draft-clone plumbing; write each accepted scene as a note through
   `app.fileManager.processFrontMatter` exactly as Scene Analysis does
   (`src/sceneAnalysis/FileUpdater.ts:50,111,167`) — never string-built YAML.
7. **Report.** Final status: notes created, needs-review count, per-scene
   errors, and **manual follow-ups** ("3 scenes couldn't be classified — check
   Act boundaries"; "Scrivener field 'POV' left unmapped"; etc.). Then repoint
   the book profile and de-list the source.

### Scrivener metadata mapping table (Review step)

A **toggle** reveals an automap best-guess table, one row per distinct
Scrivener custom field. Each row has three dispositions:

| Disposition | Behavior |
| --- | --- |
| **Map → RT key** | Repoint the field to a managed key (Subplot, Act, Character, …). Dropdown reuses `getSupportedFrontmatterRemapTargets` (`src/utils/frontmatter.ts:16-27`); the value is written under the canonical key. |
| **Keep as custom field** | Written to frontmatter as-is (unmanaged). Surfaced on the scene hover / metadata display with a **custom-field icon** (reuse the hover panel if it already renders non-canonical keys; otherwise a small addition). |
| **Ignore** | Dropped, not written. |

Automap proposes a best guess (e.g. `POV → Character`, `Storyline → Subplot`);
the author overrides per row before Materialize. Default for unmatched fields:
**Keep as custom** (nothing silently lost).

### Extraction output schema (per scene)

Targets the canonical Scene template keys (`src/settings/defaults.ts:142-159`).
V1 fills what a model can infer; workflow fields stay at safe defaults.

| Field | Source | Notes |
| --- | --- | --- |
| `Class` | fixed | `Scene` (only when survey says `isScene`) |
| `Act` | survey + scene | clamped to Settings → Core act count |
| `Synopsis` | Scrivener synopsis, else scene prose | respects `Synopsis max words` |
| `Subplot` | survey vocabulary | must be one of the survey's subplot list |
| `Character` | scene + Scrivener metadata | proper-noun extraction, deduped against survey list |
| `When` | scene (best effort) | **V1 lean: deferred** to keep follow-up minimal; omit rather than fabricate |
| `Duration` | scene (best effort) | same — deferred lean |
| `Status` | fixed default | `Complete` (text exists) — confirmed in Review |
| `Publish Stage` | fixed default | `Zero` |

Scene *order* stays filename-driven (leading number + `Act`), per
`wiki/Getting-Started.md:12`. Filename numbering is assigned on Materialize from
chapter/scene order; a Review-step rename checkbox is optional (see Open
Questions).

## The Onboarding Prompt (shared with the website)

- **Single source of truth in the repo:** new `src/ai/prompts/onboarding.ts`
  exporting `ONBOARDING_SURVEY_PROMPT` and `ONBOARDING_SCENE_PROMPT`, composed
  through the existing envelope (`src/ai/prompts/composeEnvelope.ts:29-62`) with
  the output-schema slot carrying the JSON schema.
- **Website parity:** the website onboarding page should render the same
  canonical text. The page is bot-protected from the build environment, so the
  sync direction needs Eric's call — recommended: plugin repo is canonical,
  website copies at publish time. **Still open — paste the current page prompt
  to seed the file at parity.**
- **User-editable override:** `aiSettings.onboarding.promptOverride: string |
  null` (`null` = track the built-in default). Keep it small: one textarea +
  *Reset to default*. The override replaces only the instruction block of the
  envelope, never the schema/output-rules block.

## Settings Surface (small, in the AI tab)

New card **Vault onboarding**, appended to the section-order array at
`src/settings/sections/AiSection.ts:3744-3763`, using existing card conventions
(`ERT_CLASSES.CARD/PANEL/STACK`, `ert-section-title`, `aiConfigCreateRow`).
Four rows:

1. **Onboarding prompt** — textarea bound to
   `aiSettings.onboarding.promptOverride`; *Reset* extra-button.
2. **Model readiness** — read-only status reusing the capability tier from the
   Local LLM validation card.
3. **Recommended models + tested rig** — static help text + wiki link (see
   Hardware section, including the living tested-models table).
4. **Start onboarding** — CTA, enabled only when readiness passes; opens the
   same modal.

## Hardware & Model Guidance (Apple Silicon)

Encoded as capability requirements, not a hard model allowlist (any
Ollama/LM Studio/OpenAI-compatible/MLX server works —
`src/ai/localLlm/backends.ts:26-52`).

- **48 GB (Mac mini M4 Pro / Studio base):** ~34-36 GB usable. Sweet spot:
  a **32B-class 4-bit** model (~18-20 GB) leaving room for a 32k context.
- **64 GB (the reference test Studio):** 32B-class 4-bit is the fast default;
  a **70B 4-bit** (~40 GB) is viable for higher-quality survey passes but
  slower per token — start at 32B for throughput, escalate only if extraction
  quality is short.
- **Floor:** models below ~14B or without reliable JSON mode fail the
  structured-JSON diagnostic; the tier ≥ 2 preflight gate turns that into a
  clear message, not a garbage run.
- **Model checkpoints are left model-agnostic on purpose** (model knowledge
  cutoff Jan 2026; check the current MLX community leaderboard). Pin specific
  checkpoints once tested on the Studio — record them in the table below.

### Tested models × hardware (living record — fill as we test)

Eric wants every successfully tested model and its hardware recorded here, so
the recommendation is grounded in real runs, not spec sheets.

| Date | Model (quant) | Runtime | Hardware / RAM | Result (scene-acc / synopsis / class / sec/scene) | Notes |
| --- | --- | --- | --- | --- | --- |
| _tbd_ | _tbd_ | LM Studio (MLX) | Mac Studio, 64 GB | _tbd_ | first golden-fixture run |

## Architecture — module layout

```
src/onboarding/
  OnboardingService.ts        // preflight → ingest → survey → extract → materialize → report
  OnboardingModal.ts          // progress + review UI (Modal, AbortController)
  onboardingSchemas.ts        // JSON schemas: survey result, per-scene result
  onboardingSettings.ts       // types + defaults + validate for aiSettings.onboarding
  metadataMapping.ts          // Scrivener field → RT key / custom / ignore; automap
  adapters/
    manuscriptModel.ts        // the shared normalized type + helpers
    mdAdapter.ts              // existing-vault prose notes
    scrivenerAdapter.ts       // .scrivx XML + RTF bodies + custom metadata
    docxAdapter.ts            // headings/TOC + comments
src/ai/prompts/onboarding.ts  // canonical prompts (website-shared text)
```

Reuse, don't rebuild:

| Concern | Existing piece |
| --- | --- |
| LLM call w/ strict JSON | `LocalLlmClient.generateJson` (`src/ai/localLlm/client.ts:142`) |
| Connection/model gating | `runDiagnostics` + `inferLocalLlmCapability` (`diagnostics.ts:35`, `capabilityInference.ts:119`) |
| Batch loop + abort + progress | `Processor.ts:233-325` + `SceneAnalysisProcessingModal.ts` |
| New book folder + registration | `resolveDraftTarget` / `suggestNextDraftLabel` / `getDraftDisplayTitle` (`src/utils/draftBook.ts:57-209`) |
| Book profile / source folder | `BookProfile`, `getActiveBook`, `deriveBookTitleFromSourcePath` (`src/utils/books.ts`) |
| Safe YAML write | `processFrontMatter` pattern (`FileUpdater.ts`) + `safeWritePolicy` |
| Prompt assembly | `composeEnvelope` (`src/ai/prompts/composeEnvelope.ts`) |
| Field-map targets | `getSupportedFrontmatterRemapTargets` (`src/utils/frontmatter.ts:16-27`) |

New third-party parsing (adapter-local, verify bundling first): a docx→HTML
parser (`mammoth`-class) and a Scrivener RTF strip. Both are **implementation
risks to de-risk in the adapter slice**, not assumed solved.

Doctrine fit: no new abstraction layer beyond the adapters, no fallback chains
— one spine, hard preflight gates, single-attempt calls with surfaced failures
(`docs/engineering/standards/code-doctrine.md`).

## Gating & Rollout

1. **Slice 1 (beta):** command + modal behind `areBetaCommandsVisible`
   (`src/settings/featureGate.ts:9-16`); prompt constants + the `.md` adapter +
   the shared spine + Materialize-to-new-folder + report. Existing-vault path
   end to end.
2. **Slice 2:** Scrivener adapter + metadata mapping table.
3. **Slice 3:** Word `.docx` adapter.
4. **Slice 4:** settings card, welcome-screen action, Book Manager button,
   folder-signal disclosure, wiki page.
5. **Slice 5 (ship):** decide free vs. Pro via `hasProFeatureAccess`
   (`featureGate.ts:5-7`). Recommendation: **free** — adoption funnel, not a
   power feature; the hardware requirement is gate enough.

## Verification Plan

- **Unit (vitest):** schema round-trips; prompt override composes without
  touching the schema block; act clamping; skip-already-onboarded logic;
  automap disposition rules; adapter → Manuscript Model fixtures (a canned
  `.scrivx` tree, a canned docx heading tree).
- **Contract:** extend `localLlmContract` (`src/sceneAnalysis/localLlmContract.test.ts`)
  with an onboarding fixture — canned model outputs (clean/fenced/chatty/
  truncated) through the extraction parser.
- **Golden-fixture full loop (the real test):** take **one manuscript with
  known ground truth in 2-3 formats** — the same book as Scrivener, Word, and
  (later) PDF — and run onboarding through each adapter against the *same*
  expected scene list. Isolates adapter quality with identical ground truth.
  Measure scene-count accuracy, synopsis fidelity, classification accuracy,
  sec/scene, error rate; record the model + hardware in the table above.
- **Gates:** `npx tsc --noEmit`, `npx vitest run`, build-only — per the
  feature-audit playbook before any slice is called done.

## Open Questions

**Resolved 2026-07-11 (Eric):**
- One feature, adapter-based (not two). ✅
- Source stays in the vault folder, untouched; output written to a new
  `<Book> RT` folder via Draft-clone plumbing; source de-listed from Book
  Manager. ✅
- Scrivener metadata → toggle + automap table with map / keep-as-custom /
  ignore per field; custom fields shown on hover with an icon. ✅
- PDF → V2, for sure. ✅
- Record every successfully tested model + hardware in the plan/wiki. ✅

**Still open:**
1. **Website prompt text** — paste the current onboarding-page prompt so
   `onboarding.ts` starts from parity (page is bot-protected from the build
   environment).
2. **`When`/`Duration` in V1?** Lean **defer** (matches "minimal follow-up");
   ship Progress/Narrative-ready fields first, Chronologue fields as a second
   pass.
3. **Filename renumbering** — include the optional rename checkbox in V1
   Review, or rely purely on order-driven numbering at Materialize?
4. **New-folder naming + source de-list mechanism** — exact working name
   (`<Book> RT`?) and whether to repoint the book profile vs. stamp an
   `onboardedAt` marker. Decide in Slice 1.
5. **RTF / docx parser choice + bundle impact** — confirm a parser that
   bundles cleanly under esbuild for the Obsidian runtime before committing.

## Decision Log

- **2026-07-11** — Scope expanded from existing-vault-only to a single feature
  with **source adapters** (existing `.md`, Scrivener, Word) feeding one shared
  enrich/materialize/report spine; PDF deferred to V2. Output is
  **non-destructive**: parsed + enriched notes written into a new RT book
  folder via the Draft-clone plumbing, source left untouched and de-listed from
  Book Manager. Scrivener custom metadata handled by a toggleable automap
  mapping table (map to RT key / keep as custom hover-field / ignore).
  Clarified that **MLX needs no new plugin code** — it's an OpenAI-compatible
  server (LM Studio recommended) behind the existing router. Reference test rig:
  Mac Studio 64 GB; a living tested-models table records real runs.
