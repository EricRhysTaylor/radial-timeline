# One-Button Manuscript Onboarding (Local LLM) Plan

## Status

Planning. No implementation started. This document maps the feature end to
end against the current codebase (v6.2.6) so implementation can proceed in
small verified slices.

**Revised 2026-07-11** after two design passes with Eric. The scope grew from
"existing vault of notes" to a single feature that also **imports external
manuscripts** (Scrivener, Word) directly, and the canonical onboarding prompt
now lives in **Supabase** (with a bundled plugin fallback). The full canonical
prompt is captured in Appendix A. See the Decision Log at the end for what
changed and why.

## Import flows (locked 2026-07-15)

Three ways an author arrives with a manuscript. **All three normalize to the
same `ManuscriptModel`, then share every downstream stage** (scene split → AI
auto-split → survey → per-scene extraction → review → materialize → entity
enrichment). Only the *ingest adapter* differs.

1. **Single big file** — one file holding the whole book: a plain `.txt`/`.md`,
   an old **PDF**, a Gutenberg-style **HTML** classic, whatever. This is the
   hard, high-value case and the point of a "1-click, local-LLM" onboard:
   **one file in → ~60 scenes out.** Ingest detects the internal book/chapter
   divisions (headings, argument lines), then AI auto-split breaks each division
   into scenes. Format priority: **text first** (txt/md) as the engine, **HTML**
   next (strip tags + trim PG boilerplate → text), **PDF in V2** (bundled parser,
   page-furniture stripping — the messiest).
2. **Scrivener export** — compiled scene/chapter files **plus a metadata
   sidecar** (synopses, labels, custom fields). Ingest reads the files as units
   and maps the sidecar metadata (map→RT key / keep-as-custom / ignore).
3. **Word `.docx`, distinct scene files** — a folder of one-scene-per-file docs
   (or headings within). Ingest = one unit per file (split within if marked).

**Routing is automatic from the book folder contents:** exactly one prose file →
single-file path (detect internal structure); several files → multi-file path
(one unit per file). No new selection UX — the author drops the manuscript in
the book folder and onboards.

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
| Scrivener **export** | Reading order + per-scene **Title + Synopsis**; custom metadata; Label/Status | Act boundaries; Subplot/Character if absent from metadata; normalization | **V1 intake = Scrivener *export* only** (compiled `.md`/`.txt` scene files + a metadata sidecar held for Stage 4) — what the canonical prompt assumes, and it **sidesteps RTF parsing entirely**. Raw `.scriv`/`.scrivx`+RTF parsing is **out of V1** (JS RTF→text is imperfect); revisit later only if authors ask. |
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
Preflight ─▶ Ingest ─▶ [CHECKPOINT 1: Split] ─▶ Survey ─▶ Per-scene extract ─▶ [CHECKPOINT 2: Review+Mapping] ─▶ Materialize ─▶ Report
   │                                                                                       │
   └── hard-stops: no local server, weak model, unsupported source                        └── nothing written before this point
```

The canonical prompt is stage-major with approval gates; the plugin implements
that as **two checkpoints**, not four: **Checkpoint 1 (Split)** confirms scene
boundaries + reading order before any AI runs; **Checkpoint 2 (Review)** shows
all proposed frontmatter with flagged Act/When guesses before anything is
written. Everything between is automatic.

1. **Preflight (no AI).** Detect source kind; run
   `getLocalLlmClient(plugin).runDiagnostics()`
   (`src/ai/localLlm/client.ts:111-113`) + `inferLocalLlmCapability`
   (`src/ai/localLlm/capabilityInference.ts:119-152`); require the
   `structuredJson` diagnostic and capability tier ≥ 2, else show the
   model-recommendation panel instead of a doomed run. Show scope summary
   (chapters/scenes, estimated wall time).
2. **Ingest (no AI).** Run the matching adapter → Manuscript Model. Resolve
   **reading order**: zero-padded numbered filenames (`01`, `02`, …) win; else
   a `TOC.md` in the folder maps names → order; else **stop and ask** (never
   guess order). Load any Scrivener metadata export and hold it for the
   advanced-field pass.
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
   via the Draft-clone plumbing; write each accepted scene as
   `NN Scene Title.md` (zero-padded, narrative order) with prose below the
   frontmatter unchanged — **never rewrite the prose**. Frontmatter via
   `app.fileManager.processFrontMatter` exactly as Scene Analysis does
   (`src/sceneAnalysis/FileUpdater.ts:50,111,167`) — never string-built YAML;
   YAML is always first in the file; no commas inside `Subplot`/`Character`/
   `Place` values. **Create a stub note for every `[[Character]]` and
   `[[Place]]` linked** (skip ones that already exist).
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

Targets the canonical Scene template keys (`src/settings/defaults.ts:142-159`
— align exact field names against that file during Slice 1). Organized by the
canonical prompt's stages (Appendix A). Field names below follow the prompt;
reconcile any naming drift with `defaults.ts` before coding.

**Required (Stage 2):**

| Field | Source | Notes |
| --- | --- | --- |
| `Class` | fixed | `Scene` (only when survey says `isScene`) |
| `Act` | survey + scene | clamped to Settings → Core act count; **flag guesses** for Review |
| `Status` | fixed default | `Complete` (text exists) — confirmed in Review |
| `Subplot` | survey vocabulary | one of the survey list; default `Main Plot`; no commas |

**Core (Stage 3):**

| Field | Source | Notes |
| --- | --- | --- |
| `When` | Scrivener metadata → else LLM | **In V1** — in-world date `YYYY-MM-DD` (bare year OK); carry from Scrivener if present, else best-effort; **flag guesses**, never fabricate |
| `Synopsis` | Scrivener synopsis → else LLM | 1–2 sentences; respects `Synopsis max words` |
| `Character` | scene + Scrivener metadata | `[[wiki links]]`, deduped, no commas; **stub notes created** |
| `Place` | scene + Scrivener metadata | `[[wiki links]]`, no commas; **stub notes created** |

**Structural:**

| Field | Source | Notes |
| --- | --- | --- |
| `Book` | source division | preserves the source's own division (e.g. Odyssey Book 9) *alongside* `Act`, so big structures survive the 3-act default |

**Advanced (Stage 4) — primarily carried from Scrivener, not fabricated:**

| Field | Source | Notes |
| --- | --- | --- |
| `Publish Stage` | default | `Zero` (else `Author`/`House`/`Press`) |
| `Duration` | Scrivener → else LLM | **In V1** — best-effort; carry from Scrivener where present |
| `Words` | computed | word count of the scene prose |
| `Due`, `Pending Edits`, `Type`, `Shift`, `Questions`, `Reader Emotion`, `Internal` | Scrivener metadata | authorial fields — carried from Scrivener where present via the mapping table; **the LLM does not invent these** |

Unrecognized Scrivener custom fields flow through the mapping table
(map / keep-as-custom / ignore). Scene *order* is filename-driven per
`wiki/Getting-Started.md:12`; numbering is assigned on Materialize; an optional
Review rename checkbox is a stretch (see Open Questions).

## The Onboarding Prompt — canonical source & sync

**Maintainability problem (Eric, critical):** the prompt would otherwise live
in three drifting copies — website onboarding page, plugin, GitHub wiki.

**Decision (2026-07-11): Supabase is the single canonical source**, because the
website is already Supabase-wired and the community platform lives there. The
key is a hard seam between two halves of the prompt:

| Half | What it is | Home |
| --- | --- | --- |
| **Instruction block** | ROLE / SOURCE / STRUCTURE / STAGES / RULES (Appendix A) — editorial text that changes over time | **Supabase** (canonical) |
| **Output schema + parse rules** | the JSON contract the plugin's parser depends on | **Pinned in the plugin**, versioned with the release |

The envelope already splits these (`composeEnvelope.ts:29-62`: instruction slot
vs. schema/output-rules slot), so this seam is free.

**Sync topology (one canonical, everything else derives):**

- **Website** renders the instruction block live from Supabase.
- **Plugin** ships a **bundled snapshot** at release
  (`src/ai/prompts/onboarding.ts`) as the offline default, and *optionally*
  refreshes from Supabase when online — adopting a remote prompt **only if its
  `schemaVersion` is one the plugin's parser supports**, else keeping the
  bundle. A server-side prompt edit can therefore never break a shipped
  plugin's JSON parsing.
- **Wiki** links to the canonical (website); **no independent editable copy.**
  Docs stay slim; migrate to the website over time (Eric's direction — avoid
  sprawl, keep operation intuitive).

**Privacy holds:** the manuscript never leaves the machine — only a few KB of
prompt text is optionally fetched, and the bundled fallback makes onboarding
fully offline-capable.

**Supabase storage (proposed):** a versioned row — `onboarding_prompt`
(`community_config` or a dedicated table): `{ prompt_text, schema_version,
updated_at }`, read via the public anon path the website already uses.
**Decided:** provision the row **at Slice 1** (design now, create then, so the
shape is deliberate).

**User-editable override:** `aiSettings.onboarding.promptOverride: string |
null` (`null` = track the effective canonical — remote-or-bundle). One textarea
+ *Reset to default*. The override replaces only the instruction block, never
the schema/output-rules block.

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
| 2026-07-14 | Qwen3-30B-A3B-Instruct-2507 (MLX 4-bit) | mlx_lm.server :8080 (OpenAI-compat) | Mac Studio, 64 GB | 3/3 scenes / accurate synopses + apt subplots / 26 selective entity notes / ~15–20 s total for survey + 3 scenes (~5 s per LLM call) | Odyssey fixture (Books I–III, ~4.1–4.7k words each). Tier 4, all checks passed. Correct null When/Duration on Books 1–2; Book 3 correctly flagged guessed act+when. LM Studio's own server fails plugin JSON validation — use mlx_lm.server. |

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
    scrivenerAdapter.ts       // Scrivener EXPORT: compiled scene files + metadata sidecar
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
parser (`mammoth`-class). This is the one **implementation risk to de-risk in
the adapter slice**, not assumed solved. (No RTF parser needed — Scrivener
intake is export-only in V1.)

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
- **`When`/`Duration` are IN V1** — important to many authors; carry from
  Scrivener where present, LLM best-effort otherwise, flag guesses. ✅
- **Canonical prompt provided** (Appendix A) and **canonical source = Supabase**
  with a bundled plugin fallback + schema pinned in the plugin. ✅
- **Two review checkpoints** (after Split; final Review with flagged Act/When
  guesses) — not four approval gates. ✅
- **Supabase prompt row provisioned at Slice 1** (design now, create then, so the
  row shape is deliberate). ✅
- **Scrivener intake = export only in V1** (compiled `.md`/`.txt` scene files +
  metadata sidecar); raw `.scriv`/RTF parsing is out of V1. ✅

**Still open (Slice-1 implementation details, not blockers):**
1. **Filename renumbering** — optional rename checkbox in V1 Review, or rely on
   order-driven numbering at Materialize?
2. **New-folder naming + source de-list mechanism** — exact working name
   (`<Book> RT`?) and repoint-profile vs. stamp `onboardedAt`. Decide in Slice 1.
3. **docx parser choice + bundle impact** — confirm a parser that bundles
   cleanly under esbuild for the Obsidian runtime before committing.

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
- **2026-07-11 (2nd pass)** — Eric supplied the canonical onboarding prompt
  (Appendix A) and decided the **canonical source is Supabase** (instruction
  block) with a bundled plugin fallback and the JSON schema pinned in the plugin;
  wiki links to canonical, no drift. **`When`/`Duration` moved into V1**
  (carried from Scrivener, flagged when guessed). The prompt added fields the
  plan lacked — `Place` + stub-note creation, a `Book` structural field
  alongside `Act`, and the Stage-4 advanced set — plus reading-order/`TOC.md`
  detection and **Scrivener-*export* intake** (sidesteps RTF parsing) as the V1
  path. Prose is never rewritten; guesses are flagged, never invented.
- **2026-07-11 (confirmed)** — Eric locked the three remaining forks: **two
  review checkpoints** (Split, Review), **Supabase prompt row provisioned at
  Slice 1**, and **Scrivener intake is export-only in V1** (no raw `.scriv`/RTF).
  Slice 1 is unblocked.
- **2026-07-13/14 (post first E2E run)** — the first Odyssey run surfaced
  **entity greed** (96 zero-byte stubs for every proper noun) and drove the
  entity-notes formalization: `Class: Character` and `Class: Place` are now
  first-class note types (`src/utils/entityNotes.ts`) with YAML
  (`Class`/`Book`/`Scene Count`) + body scaffolds distilled from Eric's
  author-vault `Class Template/`. **Body sections ship intentionally blank** —
  no AI-hallucinated descriptions; `Scene Count` is auto-counted from linking
  scenes. Entity folders sit **parallel to the book folder** (`Character/`,
  `Place/` as siblings — Eric's convention), not inside it. The prompt gained
  selectivity rules (principal characters who appear/act/speak; named
  geographic places only; no peoples/nations/rooms) backed by hard caps
  (`MAX_CHARACTERS=12`, `MAX_PLACES=8`). Onboarding never overwrites an
  existing entity note. The Create-RT-note modal's "Story world" family gained
  Character + Place subtypes so the same scaffolds are hand-creatable.
- **2026-07-14 (post clean re-run)** — the clean Odyssey run (see tested-models
  table) landed every scene at `Publish Stage: Zero`, wrong for a finished
  classic. Checkpoint 1 now asks for a **book-wide Publish Stage** (dropdown,
  `STAGE_ORDER`, default Zero) applied to every scene — an in-progress draft
  migrated from another tool is Zero/Author; a published book is Press. The
  choice is echoed at Checkpoint 2 next to the destination folder. `Status`
  stays hardcoded `Complete` (the text exists by definition). Whether to ask
  for further book-level metadata states at onboarding is open — revisit with
  the Slice 4 settings card.
- **2026-07-14 (entity enrichment)** — the clean run's Character/Place notes
  were pure blank scaffolds (only `Book` + `Scene Count`), which read as broken.
  Root cause traced two ways: (1) onboarding did **zero** AI generation for
  entities, and (2) a plumbing gap — Inquiry reads the YAML `Summary` field
  (`frontmatter.ts` `extractSummary`), but entity scaffolds had only a blank
  body `# Summary` *heading*, invisible to Inquiry. Decision (Eric): **generate
  grounded entity Summaries now.** New **second AI phase** (`enrichEntities`)
  after scene extraction: one structured call per linked Character/Place,
  grounded ONLY in that entity's own scenes (explicit "ignore outside knowledge
  of the name" — critical for public-domain works the model already knows).
  Produces a short `role` (fills the character header line) and a `Summary`
  (~`synopsisTargetWords`, default 200) written into a **new YAML `Summary`
  field** now added to both scaffolds. Best-effort and abortable — a failed or
  aborted entity still creates a plain scaffold; existing notes never
  overwritten. **Craft sections (Motivations, arc, Habits) stay blank** — the
  never-hallucinate rule holds; only grounded extraction (Summary + role) is
  auto-filled. Synopsis was rejected for entities: it's Scene-only and there's
  an architectural guard barring it from Inquiry. Cost: one extra local call
  per distinct entity (~26 for the 3-book Odyssey fixture).
- **2026-07-15 (scope back to a reliable core)** — per-entity summarization is
  slow (~26 calls) and the feature was taking on too much at once. Decision
  (Eric): make the **core run just "split into scene notes with YAML across acts
  + Synopsis + basic meta"** — always on, cheap (one call per scene), the thing
  that must be rock-solid first. Everything beyond scenes is now **opt-in at
  Checkpoint 1** via three checkboxes, all **default OFF**: *Create Character
  profiles*, *Create Place profiles*, and *Generate AI summaries for profiles*
  (the slow pass; auto-disabled unless a profile kind is checked). With all off,
  `enrichEntities` is skipped entirely and no entity notes are written — but
  scene YAML still carries `Character`/`Place` wiki links (basic meta stays).
  `enrichEntities` gained a fast path: profiles-on + summaries-off creates plain
  scaffolds with zero AI calls. Sequencing: land the scene core, then re-enable
  the extras once it's proven.
- **2026-07-15 (scene splitting — step 1, deterministic)** — until now one source
  file = one scene, so a chapter-sized file became a single giant scene. Step 1
  adds deterministic in-file splitting (`src/onboarding/sceneSplitting.ts`, pure
  + unit-tested): (a) explicit scene-break markers (`***`, `* * *`, `---`, `⁂`,
  heading rules…) become breaks and are dropped from prose; (b) a Butler-style
  **argument header** — an all-caps, dash-separated first paragraph enumerating a
  book's scenes (the Odyssey's `THE GODS IN COUNCIL—MINERVA'S VISIT…`) — is parsed
  into scene *labels* but **left in the prose** (Eric: keep the ALL-CAPS line; it
  becomes scene 1's opening). Inspecting the fixture settled the design: the Odyssey has
  **zero** literal markers, so marker-splitting can't touch it; the argument line
  gives the scene *count + labels* but not boundaries. Checkpoint 1 ("Confirm
  scenes") is now an adjustable **break editor** — paragraphs with click-to-place
  break dividers, seeded from markers, with the argument beats shown as guidance;
  segments are titled from the labels (`Book 1 — Minerva's visit to Ithaca`). The
  author places breaks by hand in step 1. **Step 2 (deferred): AI boundary
  alignment** — feed the model the prose + the known argument labels and have it
  return each scene's opening phrase (a constrained align-to-known-beats task, not
  open-ended "find the scenes"), then locate the cut deterministically — auto-
  seeding the breaks the author currently places manually. The `Book:` structural
  field (canonical "Cyclops scene → Act 2 + Book 9") also lands with step 2.
- **2026-07-15 (scene splitting — step 2, AI auto-split)** — manual per-break
  clicking was unusable at manuscript scale (Eric: "this should be automatic…
  having to do each one will take forever"). Decision: **both** automatic paths.
  (a) *Markers* already auto-apply deterministically in `planSceneSplit` — a
  marked manuscript arrives pre-split, zero clicks. (b) *Unmarked prose* (the
  Odyssey — zero delimiters, boundaries are semantic) now gets an **AI auto-split**:
  one "✦ Auto-split with AI" action at Confirm scenes runs `proposeSplits`, one
  local call per unmarked file, returning the 1-based paragraph where each scene
  begins. It's a **constrained align-to-beats** task, not open-ended guessing —
  the file's own argument beats are handed to the model as the ordered scene list
  (`buildOnboardingSplitPrompt`), so it places known beats rather than inventing
  boundaries. Results pre-seed `plan.breaks`; the manual editor stays for
  adjustment only. Best-effort + abortable; skips already-onboarded, marked, and
  single-paragraph files (markers/manual edits win). Still pending: the
  manuscript-wide **delimiter picker** (surface detected patterns, pick one, apply
  across all files) — lower value now since markers already auto-apply; and the
  `Book:` structural field.

## Appendix A — Canonical onboarding prompt (instruction block)

Source of truth for this text is **Supabase** (see "The Onboarding Prompt —
canonical source & sync"); this appendix is the version-controlled snapshot the
plugin bundles and the website renders. The plugin appends its pinned JSON
output-schema/parse-rules block to this at runtime — that block is **not**
editable here.

```text
ROLE
You are migrating a finished manuscript into an Obsidian vault for the
Radial Timeline plugin. Work in stages. Report after each stage and wait
for my approval before continuing. Never rewrite or "improve" the prose.

SOURCE
- The vault folder contains one book folder with the manuscript:
  a single PDF, or exported scene/chapter files (.md, .txt, .docx).
- Numbered file names (01, 02, …) define the reading order.
- If names aren't numbered, TOC.md maps the reading order to exact
  file names. If neither exists, stop and ask me for the order.
- If a Scrivener metadata export exists (synopses, notes, custom
  fields), load it now and hold it for Stage 4.

STRUCTURE
- Chapters, not scenes? Treat each chapter as one scene note now;
  split at scene breaks (***, blank space) in a later pass.
- Radial Timeline defaults to 3 acts; Settings can raise the
  act count to match big structures (the Odyssey's 24 books).
  Pick a practical number, and keep the original division in
  its own field: the Cyclops scene gets Act: 2 plus Book: 9.
- From PDF: strip running headers, footers, and page numbers;
  keep italics as *emphasis*; never let a page break split a
  paragraph.

STAGE 1 — SPLIT INTO SCENES
- Create one Markdown note per scene inside the book folder.
- Name notes "NN Scene Title.md" — zero-padded, narrative order.
- Scene prose goes below the frontmatter, unchanged.

STAGE 2 — REQUIRED YAML
Add this frontmatter block to every scene note:
---
Class: Scene
Act: 1
Status: Complete
Subplot:
  - Main Plot
---
Set Act by structural read; if the book runs past 3 acts, raise the act count in Settings to match. Flag uncertain calls.

STAGE 3 — CORE METADATA
- When: the in-world date, YYYY-MM-DD (a bare year is enough)
- Synopsis: 1–2 sentences of what happens in the scene
- Character: wiki links — e.g. "[[Odysseus]]"
- Place: wiki links — e.g. "[[Ithaca]]"
- Create a stub note for every character and place you link.

STAGE 4 — ADVANCED FIELDS
- Publish Stage: Zero | Author | House | Press
- Duration, Words, Due, Pending Edits
- Type, Shift, Questions, Reader Emotion, Internal
- Map Scrivener custom metadata to same-named YAML fields —
  Radial Timeline safely ignores fields it doesn't recognize.

RULES
- YAML frontmatter is always the first thing in the file.
- No commas inside Subplot, Character, or Place names.
- Flag guesses (Act, When) for review — never invent silently.
- Finish each stage across the whole book before starting the next.
```
