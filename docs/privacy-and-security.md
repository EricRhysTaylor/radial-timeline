# Privacy and Security

Radial Timeline is a **desktop-only** Obsidian plugin. It is not intended for Obsidian Mobile.

## Core posture

- No telemetry or analytics SDKs are shipped with the plugin.
- Vault data stays local unless you explicitly use a feature that requires an external request.
- API keys are stored with Obsidian `secretStorage` when available, with compatibility fallback only where Obsidian does not expose it.

## AI features

- AI is optional and **ships off by default**. New installs make no AI
  connection and transfer no data until the author enables
  **Settings → AI → Enable AI LLM features** and configures either a cloud
  provider API key or a local AI server. Existing
  vaults keep whatever choice they already made; upgrading never flips the
  setting.
- That toggle is the master switch for AI-assisted features. While it is off,
  the Inquiry ribbon icon is hidden, Inquiry refuses to open and shows a
  notice instead, and the Pulse and Summary refresh commands are hidden from
  the command palette.
- When AI is off, normal plugin use does not dispatch manuscript content to AI
  providers.
- Remote model metadata, provider snapshot, and pricing refresh behavior is
  additionally governed by privacy/network settings in the AI panel.
- Choosing **Provider → Local LLM** keeps analysis on a runtime you host
  yourself; no manuscript content reaches a hosted provider on that path.
- **AI jobs** (beta) hand work to an AI client the author runs themselves,
  such as Codex or Claude Code. The plugin makes no network request on this
  path: it writes job files to `Radial Timeline/AI Jobs/` in the vault, and
  reads the answers the client writes back there. A job contains the text it
  covers: one scene (Summary), a scene and its neighbors (Pulse), or the whole
  Inquiry corpus or manuscript (Gossamer, Inquiry). What the client does with
  that text is governed by the client and the author's own subscription.
  Applied jobs and their answers are deleted; the folder can be emptied at any
  time. The plugin never runs an AI client itself or uses a subscription
  login. Jobs can also be prepared through the request link
  `obsidian://radial-timeline-ai-jobs`, which only writes job files in the
  vault (and can switch the active book); it sends nothing anywhere.

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
