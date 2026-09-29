# Local Agent Handoff Plan (subscription AI clients)

## Status

- **Phase 0** (Gossamer Copy/Paste on the API contract) shipped in `8f0b362`.
- **Phase 1** (Summary and Synopsis as AI jobs, JSON job files) is built,
  behind the beta gate (`areBetaCommandsVisible`): visible in development and
  testing builds, including `npm run deploy`, hidden in public release builds
  until it has been tried end to end in a real vault.
- Open questions 1–4 were settled for Phase 1; see the end. Question 5 belongs
  to Phase 3.

## The problem

Authors who pay for ChatGPT or Claude subscriptions cannot use those plans for
Radial Timeline's AI features. The plugin calls provider APIs, and API usage is
billed separately from a subscription. File-aware AI clients such as OpenAI
Codex, Claude Code and Claude Desktop with folder access can read and write the
vault directly, so they could do much of this work within the author's plan
allowance.

Today an author who tries this hits three walls:

1. **The instructions are in the source code.** The prompts and required
   response shapes live in `src/ai/prompts/`. A client pointed at the vault
   cannot see them, and most authors will never point a client at the repo.
2. **Writing YAML directly skips the plugin's result processing.** Pulse
   formats its lines ("23 Implant mystery ? / Tech anomalies foreshadow…"),
   stamps `Pulse Update`, takes a snapshot first, and can repair small grade
   slips. Gossamer checks every beat, the signal and the score range before it
   writes. An agent writing YAML by hand skips all of that.
3. **Hand-written instructions drift.** A second copy of the instructions
   (an instruction file, a wiki page, a skill) goes stale the first time a
   prompt changes in code.

Point 3 is not hypothetical. Gossamer's Copy AI prompt was a second,
hand-written prompt. It asked for pipe-delimited lines instead of the JSON
schema, it added the author's role template although the API run swaps in a
neutral scoring role, and it built its own beat list. Pasted scores and API
scores were being produced under different instructions. Phase 0 fixed that.

## Principle

**The plugin stays the only author of instructions and the only writer of
plugin-managed fields.** An outside AI receives the plugin's compiled request
and returns the raw response. The plugin then validates and applies that
response with exactly the code the API path uses.

No feature-specific instructions ever live outside `src/ai/prompts/` and the
feature's request builder. The only outside document is one short, generic
instruction file that never mentions Pulse, Gossamer or any response shape.

## What exists now

**One envelope assembly.** Every AI feature builds an `AIRunRequest`
(`src/ai/types.ts`), and `buildRequestEnvelope` in `src/ai/runtime/aiClient.ts`
turns it into the system and user prompt. Phase 0 added
`compileRequestPrompt(plugin, request)`. It compiles any request with no
provider, model or API key, laid out exactly as execution lays it out, minus
the provider-internal cache-break delimiter. Execution and the compile share
`resolveEnvelopeParts`, so they cannot diverge.

**Request builders and apply steps, by feature:**

| Feature | Request built in | Response applied by | Handoff-ready? |
| --- | --- | --- | --- |
| Gossamer | `buildGossamerRunRequest` (`src/GossamerCommands.ts`) | `validateGossamerResponse`, then a write loop inline in `runGossamerAiAnalysis`; paste uses `GossamerScoreService.saveScores` instead | Request and validation: yes. Writer: no (two writers) |
| Pulse (scene triplet) | Inline in `callAiProvider` (`src/sceneAnalysis/aiProvider.ts`), prompt from `buildSceneAnalysisPrompt` | `parsePulseAnalysisResponse` → `applyTripletAnalysisResult` → `updateSceneAnalysis` | Apply: yes. Request: needs extracting |
| Summary / Synopsis | `buildSummaryRunRequest` / `buildSynopsisRunRequest` (`src/sceneAnalysis/summaryRefresh.ts`) | `parseSummaryReply` / `parseSynopsisReply`, then `persistSummaryForScene` (same file) | Yes: Phase 1 |
| Inquiry | `InquiryRunnerService` | Runner post-processing (`verifyFindingRefs`, lens and role normalization, chunk merging) → `Radial Timeline/Inquiry/Sessions/sessions.json` | No. See "Inquiry" below |

The pattern Phase 0 set for Gossamer is the pattern for every feature: **one
exported request builder** used by both the API run and the handoff, and
**one exported apply function** used by the API run, the paste path and the
job path.

## Why the handoff is not inside `AIClient.run()`

`AIClient.run()` is a request-response call. Features await it and act on the
result within seconds. An outside agent answers in minutes or hours, possibly
after Obsidian has been closed and reopened. Awaiting it inside `run()` would
hold modals and progress state open indefinitely.

So the handoff happens at the feature level:

1. The feature's shared builder makes the request.
2. `compileRequestPrompt` turns it into text.
3. The text is written out as a job.
4. Later, the response is read in and handed to the feature's shared apply
   function.

The instructions still come from one place, because steps 1 and 2 are exactly
what the API run does.

## Design: the job mailbox

### Folder

`Radial Timeline/AI Jobs/`, under the canonical system folder
(`src/utils/systemFolder.ts`):

- `Pending/` holds jobs waiting for an answer, one JSON file per job.
- `Answers/` is where the agent writes answers, one JSON file per job,
  named with the job id.
- `AGENTS.md` and `CLAUDE.md` hold the generic instructions. The two files are
  identical: Codex reads the first and Claude Code the second.

There is no `Done/` folder: an applied job and its answer are deleted
(question 4).

### One job per request

A job (`AiJob` in `src/ai/jobs/aiJobStore.ts`, `schemaVersion: 1`) holds:

- **id**: deterministic per task and target, so preparing again replaces the
  pending job instead of duplicating it. Phase 1 uses `summary-<hash of the
  scene path>` and `synopsis-<hash of the scene path>`.
- **feature and task**, the same values as the `AIRunRequest`
- **target**: the note path it writes to, and a label for people to read
- **source fingerprint**: a hash (`fnv1a32Hex` in `src/utils/hash.ts`) of the
  text the prompt was built from. For a Summary job that is the scene body;
  for a Synopsis job, the Summary it was written from. Later: the three scene
  bodies for Pulse, the manuscript export for Gossamer.
- **the compiled prompt**, the `finalPrompt` from `compileRequestPrompt`,
  produced by `buildAiJob`, the only place jobs are made
- **answerFile**: where to write the answer, relative to the AI Jobs folder
- **lastRejection**, when the previous answer was sent back or the job was
  rebuilt
- Later: **signal** for Gossamer, and **attachments** (the manuscript export
  path, as Copy AI prompt does now)

Example: an author flags scenes 20–30 of Book 2 with `Pulse Update: Yes`. The
plugin writes 11 jobs. The job for scene 24 carries the triplet prompt for
scenes 23/24/25 in the correct boundary variant (`buildSceneAnalysisPrompt`
has four), the JSON shape, and a fingerprint of those three scene bodies.

### The generic instruction file

The plugin writes this file from `AI_JOB_INSTRUCTIONS` and rewrites it every
time jobs are prepared. It says, in substance:

- Each file in `Pending/` is a job, and the job's `prompt` is the complete
  instruction, including the exact JSON the answer must match.
- Write only that JSON to the job's `answerFile`.
- If a job has `lastRejection`, read its problems and answer the job's current
  prompt again.
- Do not edit or delete job files, scene notes or anything else. The plugin
  applies the results.
- When every job is answered, look in `Pending/` again: applying an answer can
  create a follow-up job.
- Later, with attachments: if a job lists an attachment, read that file in full.

It never names a feature or a field, so prompt changes in code never make it
stale. A test pins that.

### Ingest

`ingestAiJobAnswers` (`src/ai/jobs/aiJobIngest.ts`) runs when the workspace is
ready, about 1.5 seconds after an answer is written or changed while Obsidian
is open, and on the "Apply AI job answers" command. Passes never overlap. For
each answer, the job's feature picks an `AiJobHandler`:

- **Fingerprint check first.** If the target is gone, the job and answer are
  deleted. If the source changed since the job was written (for example, the
  author edited scene 24), the job is rebuilt from the current text with the
  same id, `lastRejection` says why, and the old answer is discarded rather
  than applied to text it was not written for.
- **Accepted:** the handler applies it with the same parser, snapshot and
  stamp as the API path, then the job and answer are deleted.
- **Not accepted:** the handler's own problem text is recorded on the job as
  `lastRejection`, and the answer is deleted so the agent can write a new one.
  For example: `The answer's "summary" field is missing or empty.`
- **No usable job** (missing, unreadable, or no handler): the answer is left
  in place, since it may be a correct answer with a mistyped name. It is
  reported on the manual command and logged otherwise.
- **A write error** is reported for that answer and leaves its files in
  place; the other answers still run.
- Jobs survive Obsidian being closed. Answers wait in `Answers/` and are
  applied on the next launch.

### Starting a run

1. **Commands.** "Prepare AI jobs" commands for Pulse and Summary, driven by
   the existing author-facing flags `Pulse Update: Yes` and
   `Summary Update: Yes`, plus Gossamer by signal. No new scene YAML: this
   respects "Scene YAML belongs to the author" in
   `docs/engineering/standards/code-doctrine.md`.
2. **Provider choice.** A "Local agent (subscription)" option in AI settings.
   With it selected, the existing Run buttons prepare jobs instead of calling
   an API. Cost forecasts show token size (so authors can judge their plan
   allowance) but no dollar figure.
3. **An `obsidian://` link.** A protocol handler (`registerObsidianProtocolHandler`,
   not used in the plugin today) lets the agent start the work. For example,
   when the author says "run Pulse on the flagged scenes", the agent opens
   `obsidian://radial-timeline?prepare=pulse&scope=flagged`. The handler only
   prepares jobs. It never applies results or edits notes.
4. **Later, optionally: an MCP server inside the plugin** (desktop only), with
   three tools: list jobs, get job, submit response. Submitting returns the
   validator's result immediately. It is only a second transport over the same
   job objects, so it adds no instructions.

## Direct YAML for author-owned fields

POV, Characters, Place, When and author custom fields are plain author data
with no plugin processing. An agent can write them directly. It only needs the
field names and formats, and those should come from the plugin: generate a
field guide from the YAML manager templates (Settings → Core) into
`Radial Timeline/AI Jobs/`, and never hand-write one. Example: the guide says
"Characters: list of links", and the agent fills that in on scene 7.

Pulse, Summary, Synopsis and Gossamer fields always go through jobs, never
through direct writes.

## Inquiry

Out of scope at first. Inquiry answers reach `sessions.json` only after scene
reference verification and repair, lens and role normalization, and, for large
corpora, chunked runs and merging. Anthropic citations are an API feature with
no chat equivalent.

A later phase could hand off single-pass questions whose corpus fits in one
request (for example, Flow and Depth for a Book 1 that fits in one pass) as
jobs, without citations. The runner's post-processing would need to be
callable on a response it did not request itself.

## Phases

**Phase 0: Gossamer Copy/Paste on the API contract. Done (`8f0b362`).**
Copy AI prompt compiles `buildGossamerRunRequest` through
`compileRequestPrompt`. Paste AI response runs `parsePastedGossamerResponse`,
which ends in `validateGossamerResponse`. Tests pin the neutral role, the JSON
schema, the rubric, the attachment reference and the modal's use of the shared
request.

**Phase 1: Summary and Synopsis. Built, behind the beta gate.**
- `src/sceneAnalysis/summaryRefresh.ts` is now the one place for the Summary
  refresh request builders, reply parsers, API send step and scene writer.
  The API run (`SynopsisCommands.ts`) and jobs both use it, and
  `callAiProvider` lost its Summary branches: it is Pulse only.
- Found and fixed on the way: the Synopsis pass sent the *Summary* JSON schema
  while its prompt asked for a `synopsis` field, and the parser hid it by
  accepting either field. The Synopsis request now sends the synopsis schema,
  and each parser accepts only its own field.
- The job mailbox: `src/ai/jobs/aiJobStore.ts` (format, folder, instructions)
  and `src/ai/jobs/aiJobIngest.ts` (ingest and wiring).
- `src/sceneAnalysis/summaryRefreshJobs.ts`: the "Prepare AI jobs: Summary
  refresh (flagged scenes)" command, and the handler that applies answers.
  As in the API run, the Synopsis is written from the new Summary, so when
  "Also update Synopsis" is on, applying a Summary answer creates the Synopsis
  job.
- Tests pin that a job's prompt equals the compiled API request, that the API
  run and jobs call the same builders, parsers and writer, and each ingest
  outcome end to end in an in-memory vault.

To try it: flag a few scenes with `Summary Update: Yes`, run the prepare
command, point Codex or Claude Code at `Radial Timeline/AI Jobs`, and watch the
answers apply. What unit tests cannot confirm, and the reason for the beta
gate: that Obsidian fires vault events for `.json` answers written by another
program. "Apply AI job answers" and the pass at startup work either way.

**Phase 2: Pulse triplets.**
- Extract `buildPulseRunRequest`, including the four boundary variants.
- Apply through the existing `applyTripletAnalysisResult`.
- Fingerprint all three scene bodies.

**Phase 3: Gossamer.**
- Extract the write loop from `runGossamerAiAnalysis` into one
  `applyGossamerResult` used by the API run, Paste and jobs.
- Today Paste saves through `GossamerScoreService.saveScores`. That writer
  matches beats by title rather than path, labels AI-pasted scores
  "Manual entry" / provider `manual`, and does not stamp
  `Gossamer Last Updated`. This is the remaining Gossamer drift.
- Then add Gossamer jobs, one per signal, pointing at the manuscript export.
  Clipboard Copy/Paste stays as the path for chat apps.

**Phase 4: `obsidian://` handler** for preparing jobs from the agent.

**Phase 5 (optional): MCP transport** over the same jobs.

## Guarding against drift

- **One parity test per feature, in the Phase 0 style.** The job prompt must
  equal `compileRequestPrompt(builder(…))`, and a source check must confirm
  that the API path calls the same builder.
- **One apply function per feature**, called by every path. A second writer is
  drift, as Phase 3 shows.
- **The instruction file is generated from a code constant** and never names a
  feature.

## Guardrails

- **The plugin never drives a subscription.** It does not run `claude` or
  `codex`, and it never uses a subscription login. The author runs their own
  client, and the plugin only reads and writes files in the vault. This keeps
  the plugin clear of vendor terms on third-party use of subscription logins,
  and it works the same on every platform.
- **Agents never write managed fields.** The instruction file says so. If an
  agent writes one anyway, the next apply overwrites it, and snapshots record
  what was there before.
- **Privacy.** Jobs contain manuscript text. It is already in the vault;
  `docs/privacy-and-security.md` says that `AI Jobs/` holds prompt copies and
  that applied jobs are deleted.
- **Mobile.** File jobs work anywhere the vault syncs. The protocol handler and
  MCP are desktop only.

## Open questions for Eric

Questions 1–4 were settled for Phase 1. Each is a small change if Eric wants
it otherwise.

1. **Job file format. Decided: JSON** (Eric, 2026-09-29), for jobs and answers.
   No generated README listing pending jobs yet; the folder's own listing
   serves for now.
2. **Failed replies. Decided (the recommendation):** the problems are recorded
   on the job as `lastRejection`; the scene note is never marked.
3. **Attribution. Decided:** the stamp reads "… by local agent"
   (`LOCAL_AGENT_ATTRIBUTION`). No self-reported model name is recorded.
4. **Retention. Decided:** an applied job and its answer are deleted
   immediately. The scene's stamp and the frontmatter snapshot taken before
   every write are the record.
5. **Paste attribution (Phase 3), open.** Should AI-pasted Gossamer scores keep
   provider `manual`, or get their own provider value so the run history shows
   they came from an outside AI?

## Author-facing copy

**Until Phase 1 leaves beta**, the email and wiki should not promise full
plugin functionality through a subscription. The wiki's Commands page documents
the beta commands, marked beta. Suggested wording for the email:

> Some of the same work can fit into your existing monthly subscription. For
> example, ask your AI client to draft scene synopses, which Radial Timeline
> reads directly from each scene's properties. Gossamer's Copy AI prompt and
> Paste AI response let a chat app score your beats with the same instructions
> the built-in run uses. Pulse and Inquiry currently run through a connected
> API provider.

**After Phase 2:**

> Radial Timeline can hand its analyses to your AI client as job files. Your
> subscription does the work, and the plugin checks and applies the results.
