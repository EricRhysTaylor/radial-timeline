# Privacy and Security

Radial Timeline is a **desktop-only** Obsidian plugin. It is not intended for Obsidian Mobile.

## Core posture

- No telemetry or analytics SDKs are shipped with the plugin.
- Vault data stays local unless you explicitly use a feature that requires an external request.
- API keys are stored with Obsidian `secretStorage` when available, with compatibility fallback only where Obsidian does not expose it.

## AI features

- AI is optional and **ships off by default**. New installs are AI-free until
  the author enables **Settings → AI → Enable AI LLM features**. Existing
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
- Optional version/update checks.
- **Discord presence chip** — the chip in the Radial Timeline View title bar
  polls a public `discord-presence` endpoint roughly every 60 seconds. This
  happens **by default, for every user**: it is not gated on connecting to
  Community, and it requires no account or sign-in. The request carries no
  vault data and no author identity — it is a GET that asks only whether the
  Discord community is currently staffed, and the response is a boolean plus
  an invite URL. A failed request leaves the chip muted; it never escalates
  to a Notice.
- **Community Share** — report publishing and the `community-daily-sync`
  call, sent only after the author connects to Community and selects a
  sharing level above Private. See below.

With the single exception of the Discord presence chip, every path above is
optional and author-triggered.

## Community Share

Community Share is shipped. It is opt-in and inert until the author connects
this vault to the website and selects a sharing level: nothing publishes on
install, and Level 1 (Private) publishes nothing at all. Full behavior and
the per-level field breakdown live in the
[Settings → Community](https://github.com/EricRhysTaylor/Radial-Timeline/wiki/Settings-Community)
wiki page.

Posture:

- **Opt-in at the source.** Connecting alone publishes nothing; the author
  must also pick a level and press **Begin sharing**.
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
