# Privacy and Security

Radial Timeline is a **desktop-only** Obsidian plugin. It is not intended for Obsidian Mobile.

## Core posture

- No telemetry or analytics SDKs are shipped with the plugin.
- Vault data stays local unless you explicitly use a feature that requires an external request.
- API keys are read only from Obsidian `secretStorage`. If secure storage is unavailable, cloud AI cannot run; keys are never saved as plaintext settings.

## AI features

AI ships off by default in new vaults.

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
Inquiry and scene pulse results remain available to read. Providers handle
material already received under their own processing and retention terms.

While AI is off, the plugin contacts no AI provider and no local AI server.
Settings → AI checks no key, detects no server, lists no models and runs no
diagnostics, and model metadata and pricing are not refreshed. Every AI
request passes one gate (`src/ai/runtime/aiNetworkGate.ts`) that refuses it
while the switch is off.

Model metadata and pricing refreshes follow the network settings in the AI
panel, and run only while AI is on.
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
- **Release-note images.** The release notes ship inside the plugin, but
  their screenshots and animations load from GitHub
  (`raw.githubusercontent.com`) whenever the notes are on screen: in Settings,
  where the release notes appear, and in the release notes window after an
  update. Each is a plain image request that carries no vault data; GitHub
  sees what any image request shows, such as the IP address.
- **Story Vault download** — only when the author chooses **Add story to
  this vault**: one GET of that story's ZIP from the public `demo-vault`
  bucket in Radial Timeline's Supabase storage. It carries no vault data or
  identity. The ZIP must match the SHA-256 fingerprint listed for that
  edition in `src/settings/bonusVaults.ts` before anything is written to the
  vault. **Download ZIP** and the edition links open in the browser instead.
- **Community Share** — report publishing and the `community-daily-sync`
  call, sent only after the author connects to Community and selects a
  sharing level above Private. See below.
- **Private scenes** — on a connected vault, with **Share scene body** on
  for a book (Settings → Community, off by default): the `scene-release-sync`
  call. It sends the text of one scene only when the author presses
  **Release** or **Update** in that scene's preview, which shows exactly what
  is sent. Reading the book's released scenes, recording agreement to the
  release terms and taking a scene down use the same call and carry no scene
  text. See below. The Release scenes link from the website,
  `obsidian://radial-timeline-release?book=<book id>&scene=<scene id>`, runs
  only when the author opens it: it reads the connection's book list
  (`community-share-context`) and that book's release status, carries no text,
  and never turns **Share scene body** on.
- **Book from Community** — on a connected vault at a sharing level above
  Private, while sharing is not paused: the `timeline-transfer-sync` call.
  While Settings → Community is open, it asks at most once a minute whether
  the author chose **Add to my vault** for a book on the website, sending the
  connection id and secret and nothing else. Only when the author opens that
  book (its **Book from Community** card, or the website's
  `obsidian://radial-timeline-transfer?id=<transfer id>` link) does the plugin
  download it: the author's own timeline for that book (scene titles,
  positions, acts and act count, subplots, status, stage, synopsis, cast,
  narration, story dates and scene ids) and, only if the author ticked
  **Include released text** on the website, the text of that book's released
  scenes. This is the one read of the author's Community data the plugin
  makes, and the website answers it only while the request is open (24
  hours). Nothing is written to the vault until **Create book**. Then the
  plugin writes one scene note per scene into a new folder, reads the notes
  back, and sends `done` with the new book's Book Manager id and the list of
  scene ids, and no text; if that answer is lost it asks the same call where
  the request stands. Until the book is finished, plugin data keeps a small
  record of it (the folder, the new book's id and which notes are written),
  never the timeline or any text. After that the book's timeline is sent like
  any book with **Keep timeline updated** on.
- **Community mailbox** — on a connected vault only, while a timeline view
  is open: a `community-mailbox` check about once an hour and when Obsidian
  regains focus. It sends the connection id and secret (plus the plugin,
  Obsidian and platform versions every Community call carries) and receives
  counts of unread replies. It sends no vault data and marks nothing as read.
  It runs while sharing is paused, because it reads replies rather than
  sharing anything, and stops when **Show Community mailbox** (Settings →
  Advanced) is off or the vault is disconnected.

Two paths above run without an account or any author choice: the version
check, and the release-note images whenever the notes are shown. Neither
carries author data, and neither is an AI request. Every other path is
optional and author-triggered.

## Community Share

Community Share is shipped. It is opt-in and inert until the author connects
this vault to the website and selects a sharing level: nothing publishes on
install, and Level 1 (Private) publishes nothing. One thing does cross the
wire from the moment a vault is connected, at every level: each Book Manager
book syncs to the website as a **private project shell** (its public label,
or its working title when no label is set, plus logline, stage target dates,
and order). Shells are visible only to the author on My Share and become
public only by an explicit switch on the website; the plugin never changes
that. The list syncs when Obsidian opens, after you change a book's settings,
and every six hours while the vault stays open. Full behavior and the per-level field breakdown live in the
[Settings → Community](https://github.com/EricRhysTaylor/Radial-Timeline/wiki/Settings-Community)
wiki page.

Posture:

- **Opt-in at the source.** Connecting alone publishes nothing; the author
  must also pick a level and press **Begin sharing**. Connecting does store
  the private project shells described above.
- **Never published at any level:** manuscript text, scene/note/vault paths,
  file or folder names, raw writing-session rows, exact session timestamps,
  and API/license keys or plugin secrets.
- **Scene text leaves only when you send a scene.** At **Level 4** you ask
  for a scene on the Community website (choosing its rating and readers
  there); Radial Timeline then lists the request, and the scene's text goes
  up only when you press **Send** in **Send scene to Community**. The dialog
  shows exactly what is sent: the scene's prose, with its properties,
  comments, callouts, link syntax and block ids removed. Readers are the
  people you name, or every signed-in member if you open the scene to
  everyone on the website. Nothing is sent in the background, and a released
  scene changes only when you ask for an update on Community and send it.
  Whether a scene changed since its release is worked out in your vault,
  with nothing sent. Take a scene down on the website to delete its text
  there. No scene text is stored in plugin settings.
- **Where scene text goes on the Community website.** Your scene text goes
  to an AI provider only when you ask for a feedback summary on Community.
  Nothing is filtered before it goes up. A reader can report a scene, and a
  report goes to a person for review, not to AI.
- **Level 2** publishes the public profile and project shells, plus an
  optional Author Progress Report graphic. The APR route is separately
  opt-in per campaign and defaults off.
- **Level 3** adds writing-activity summaries: a daily aggregate feed
  (writing days, rounded minutes and word totals, coarse mode mix) and the
  **Working Clock** rollup described below.
- **Level 4** adds the text of each scene you send when Community asks for
  it, as described above. It sends the same profile and activity as Level 3.
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
