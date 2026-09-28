# Local Agent Handoff Plan (subscription AI clients)

## Status

Proposal, 2026-09-28. Phase 0 shipped in commit `8f0b362`. Nothing else has
started. The open questions at the end need Eric's decisions before Phase 1.

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
| Summary / Synopsis | Inline in `callAiProvider` with `commandContext: 'synopsis'`, prompts from `buildSummaryPrompt` / `buildSynopsisPrompt` | `persistSummaryForScene` (`src/sceneAnalysis/SynopsisCommands.ts`) | Apply: yes. Request: needs extracting |
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

- `Pending/` holds jobs waiting for an answer.
- `Responses/` is where the agent writes answers.
- `Done/` holds applied jobs and responses until they are purged.
- `AGENTS.md` and `CLAUDE.md` hold the generic instructions. The two files are
  identical: Codex reads the first and Claude Code the second.

### One job per request

A job holds:

- **id**, for example `pulse-scn_a1b2c3d4-20260928T1405`
- **feature and task**, the same values as the `AIRunRequest`
- **targets**: the scene or beat note paths and stable ids (`scn_…`) it will
  write to
- **signal**, for Gossamer
- **source fingerprint**: a hash (`fnv1a32HexUnpadded` in `src/utils/hash.ts`)
  of the evidence text the prompt was built from. For Pulse that is the three
  scene bodies; for Gossamer, the manuscript export.
- **attachments**: for Gossamer, the manuscript export path, exactly as Copy AI
  prompt does now
- **the compiled prompt**, the `finalPrompt` from `compileRequestPrompt`
- **the response path** to write to

Example: an author flags scenes 20–30 of Book 2 with `Pulse Update: Yes`. The
plugin writes 11 jobs. The job for scene 24 carries the triplet prompt for
scenes 23/24/25 in the correct boundary variant (`buildSceneAnalysisPrompt`
has four), the JSON shape, and a fingerprint of those three scene bodies.

### The generic instruction file

The plugin writes this file from a constant in code and rewrites it when the
plugin updates. It says, in substance:

- Each file in `Pending/` is a job, and the job carries its own instructions
  and required response shape.
- Follow the job's prompt exactly.
- Write only the response, as JSON, to `Responses/`, named with the job id.
- If a job lists an attachment, read that file in full.
- Never edit scene notes, beat notes, or anything else under
  `Radial Timeline/` yourself. The plugin applies the results.

It never names a feature or a field, so prompt changes in code never make it
stale.

### Ingest

- On load, and on vault create or modify events in `Responses/`, the plugin
  reads each response and routes it by the job's feature to that feature's
  shared apply function.
- Before applying, it recomputes the fingerprint. If the source changed since
  the job was written (for example, the author edited scene 24), it rejects
  the response as stale instead of writing outdated analysis.
- **On success:** it applies with the same snapshot, stamp and log as the API
  path, then moves the job and response to `Done/`.
- **On failure:** it writes the validator's own messages beside the job and
  leaves the job pending, so the agent can fix and resubmit. For example:
  "The first currentSceneAnalysis item must use grade A, B, or C."
- Jobs survive Obsidian being closed. Responses wait in `Responses/` and are
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

**Phase 1: Summary and Synopsis.**
- Extract `buildSummaryRunRequest` and `buildSynopsisRunRequest` from
  `callAiProvider`, used by both the API path and jobs.
- Build the job mailbox: folder, job writer, generic instruction file, ingest
  router, fingerprints, rejections.
- Add a "Prepare AI jobs: Summary" command for flagged scenes.

These are the smallest jobs (one scene each), so they prove the mailbox cheaply.

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
- **Privacy.** Jobs contain manuscript text. It is already in the vault, but
  `docs/privacy-and-security.md` should say that `AI Jobs/` holds prompt
  copies, and `Done/` needs a purge policy.
- **Mobile.** File jobs work anywhere the vault syncs. The protocol handler and
  MCP are desktop only.

## Open questions for Eric

1. **Job file format.** Markdown (readable by the author in Obsidian, but
   indexed and searchable) or JSON (hidden from the note index; the Inquiry
   sidecar precedent)? Recommendation: JSON jobs and responses, plus a
   generated `AI Jobs/README.md` listing pending jobs for the author.
2. **Failed replies.** When a local LLM's Pulse reply fails to parse, the
   plugin writes a `Pulse Review Warning` into the scene note
   (`src/sceneAnalysis/safeWritePolicy.ts`). Should a failed agent reply also
   mark the scene, or only leave a rejection beside the job? Recommendation:
   rejection beside the job only. The agent can retry, and scene YAML stays
   clean.
3. **Attribution.** Stamps currently read "… by <model id>". For agent results,
   use "by local agent", optionally with a self-reported model name kept in
   the log only?
4. **Retention.** How long do applied jobs stay in `Done/`: until the next
   run, N days, or immediate deletion with only the AI log kept?
5. **Paste attribution (Phase 3).** Should AI-pasted Gossamer scores keep
   provider `manual`, or get their own provider value so the run history shows
   they came from an outside AI?

## Author-facing copy

**Until Phase 1 ships**, the email and wiki should not promise full plugin
functionality through a subscription. Suggested wording:

> Some of the same work can fit into your existing monthly subscription. For
> example, ask your AI client to draft scene synopses, which Radial Timeline
> reads directly from each scene's properties. Gossamer's Copy AI prompt and
> Paste AI response let a chat app score your beats with the same instructions
> the built-in run uses. Pulse and Inquiry currently run through a connected
> API provider.

**After Phase 2:**

> Radial Timeline can hand its analyses to your AI client as job files. Your
> subscription does the work, and the plugin checks and applies the results.
