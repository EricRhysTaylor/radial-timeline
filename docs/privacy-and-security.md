# Privacy and Security

Radial Timeline is a **desktop-only** Obsidian plugin. It is not intended for Obsidian Mobile.

## Core posture

- No telemetry or analytics SDKs are shipped with the plugin.
- Vault data stays local unless you explicitly use a feature that requires an external request.
- API keys are read only from Obsidian `secretStorage`. If secure storage is unavailable, cloud AI cannot run; keys are never saved as plaintext settings.

## AI features

Enable **Settings → AI → Enable AI LLM features** and configure a cloud
provider or local AI server to use AI-assisted commands. Existing vaults
retain the setting the author chose.

Running an AI feature sends its selected manuscript material and instructions
to the configured provider or Local LLM server. The author chooses the provider,
model, manuscript scope, and material modes. Note prose is prepared by removing
frontmatter, HTML and Obsidian comments, and imported Editorialist review blocks.
Features may also use selected story fields such as Summary or beat Purpose.
Selected material must be readable in its chosen mode before a run can proceed.

Turning AI off stops queued requests and closes active connections. Saved
Inquiry results remain available to read. Providers handle material already
received under their own processing and retention terms.

Model metadata and pricing refreshes follow the network settings in the AI panel.
**Local LLM** sends analysis requests to the server the author configures.

### Caching and provider policies

Inquiry and Gossamer can reuse matching input through the selected provider's
prompt cache. Anthropic and OpenAI requests include the material for the
provider to identify matching input. Gemini can store material in a temporary
cache that later requests reference. Cache availability, duration, and pricing
vary by provider and model.

Cloud providers process submitted content under their own retention, caching,
and model-training policies. OpenAI requests use `store: false`; its abuse
monitoring and prompt caching follow separate retention policies. See
[OpenAI data controls](https://developers.openai.com/api/docs/guides/your-data).
Gemini's data-use terms depend on the actual project's billing status and region;
unpaid services can use content for product improvement and human review. See
[Gemini terms](https://ai.google.dev/gemini-api/terms).

### Content logs

Enabling **Enable AI content logs** saves full prompts, submitted material, and
responses in the vault for reviewing AI runs, including failed runs. Credentials
are redacted across the log. The author's vault sync and backup settings apply
to these files. Concise diagnostics record request status and errors.

### AI jobs (beta)

AI jobs prepare work for an AI client the author runs, such as Codex or Claude
Code. The plugin writes job files to `Radial Timeline/AI Jobs/` in the vault and
reads the client's answers from that folder. A job contains the material it
covers: one scene (Summary), a scene and its neighbors (Pulse), or the whole
Inquiry corpus or manuscript (Gossamer, Inquiry). The client's processing follows
its terms and the author's subscription. Applied jobs and their answers are
deleted; the author can empty the folder at any time.

The request link `obsidian://radial-timeline-ai-jobs` can prepare these vault
files and switch the active book. The author runs the AI client separately.

## Desktop integration (Pandoc export)

The publishing pipeline shells out to programs already installed on the
user's machine. The exact contract:

- Shell execution happens only to invoke Pandoc (and its LaTeX engine) when
  the user runs a manuscript export, and to probe for those binaries with
  `which`/`where` during setup. Nothing is downloaded or executed otherwise.
- Subprocesses receive a minimal allowlisted environment (PATH, home, temp,
  locale, and TeX cache variables) built by `buildMinimalSubprocessEnv` in
  `src/utils/exportFormats.ts` — never the full `process.env`, so credentials
  present in the host session cannot leak to child processes.
- The only environment variable the plugin reads directly is `PATH`. Install
  locations on Windows are derived from `os.homedir()`, not from identity
  variables like `USERPROFILE` or `LOCALAPPDATA`.
- Files outside the vault are read or written only to save exports where the
  user chooses and to locate the Pandoc executable.

## External services and network access

External requests occur in these areas:

- Optional AI provider requests to supported providers.
- Optional model-registry / provider-snapshot / pricing refreshes for AI metadata.
- A version check against the GitHub Releases API, once at plugin load and
  at most once a day. It carries no vault data or identity; it compares
  version numbers so the timeline can show an update indicator.
- **Community Share** — report publishing and the `community-daily-sync`
  call, sent only after the author connects to Community and selects a
  sharing level above Private. See below.
- **Community mailbox** — on a connected vault only, while a timeline view
  is open: a `community-mailbox` check about once an hour and when Obsidian
  regains focus. It sends the connection id and secret (plus the plugin,
  Obsidian and platform versions every Community call carries) and receives
  counts of unread replies. It sends no vault data and marks nothing as read.
  It runs while sharing is paused, because it reads replies rather than
  sharing anything, and stops when **Show Community mailbox** (Settings →
  Advanced) is off or the vault is disconnected.

One path above runs by default without an account or any author action: the
version check, which carries no author data. Every other path is optional and
author-triggered.

## Community Share

Community Share is shipped. It is opt-in and inert until the author connects
this vault to the website and selects a sharing level: nothing publishes on
install, and Level 1 (Private) publishes nothing. One thing does cross the
wire from the moment a vault is connected, at every level: each Book Manager
book syncs to the website as a **private project shell** (its public label,
or its working title when no label is set, plus logline, stage target dates,
and order). Shells are visible only to the author on My Share and become
public only by an explicit switch on the website; the plugin never changes
that. Full behavior and the per-level field breakdown live in the
[Settings → Community](https://github.com/EricRhysTaylor/Radial-Timeline/wiki/Settings-Community)
wiki page.

Posture:

- **Opt-in at the source.** Connecting alone publishes nothing; the author
  must also pick a level and press **Begin sharing**. Connecting does store
  the private project shells described above.
- **Never published at any level:** manuscript text, scene/note/vault paths,
  file or folder names, raw writing-session rows, exact session timestamps,
  and API/license keys or plugin secrets.
- **Level 2** publishes the public profile and project shells, plus an
  optional Author Progress Report graphic. The APR route is separately
  opt-in per campaign and defaults off.
- **Level 3** adds writing-activity summaries: a daily aggregate feed
  (writing days, rounded minutes and word totals, coarse mode mix) and the
  **Working Clock** rollup described below.
- **Author-controlled teardown.** Pause, take offline, delete shared data,
  and disconnect are all available from the Community tab. Disconnecting
  requires a new one-time linking key to reconnect.

### Working Clock (hourly rollup)

At Level 3 only, the daily sync carries an `hour_mode_mix` field — the data
behind the Community's **Working Clock** (the activity dial on the website).
It is a trailing 28-day rollup of writing minutes bucketed by the local
wall-clock hour each session **started** (0–23) and by mode
(drafting/revising/planning; line-editing time folds into revising).

This means an author's recurring time-of-day writing pattern is published at
Level 3. The rollup is deliberately coarse:

- Aggregate only — never a per-session row.
- Undated — no calendar date, so a given day's activity cannot be recovered.
- No book identity, scene, or note attached.
- Hours with no activity are omitted rather than zero-filled.
- Sent only while the standing share is active at Level 3 and public; paused,
  revoked, or lower-level shares never send it.

The projection is defined once, in `buildCommunityHourModeMix`
(`src/services/WritingSessionLog.ts`), which is the single sanctioned exit
point for session data leaving the device. See
`docs/engineering/standards/writing-session-privacy.md` for the full
audience contract.
