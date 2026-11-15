# Mac repo sync

Cloud sessions and scheduled routines land their work on GitHub. This script
brings it to the Mac: it fast-forwards each Radial Timeline LLC repo to
`origin/main` and, for the two plugins, runs `npm run deploy` so the new build
is in every vault. Then it exits.

It is one shot and never schedules itself. Nothing runs in the background on
the Mac Studio (owner's rule, 2026-07-27). The Daily brief runs it each
morning and puts the report in the Clearing House **Deploys** card (see
`DAILY-BRIEF-STEP.md`). By hand:

    bash scripts/mac-sync/sync-repos.sh                 # sync and print
    bash scripts/mac-sync/sync-repos.sh --dry-run       # show what it would do
    bash scripts/mac-sync/sync-repos.sh --report deploys.json   # also write the card's data

What it will never do:

- touch a repo that has uncommitted changes, is on a branch other than `main`,
  or has local commits GitHub doesn't have (it reports **Not synced** and why);
- merge, rebase, reset, commit or push;
- build uncommitted work into the vaults.

Repos covered (found by their GitHub remote under
`~/Documents/Radial Timeline LLC`, up to four folders deep): radial-timeline,
editorialist, radial-timeline-community, -web, -platform, -email, -engine.
Only repos with an `npm run deploy` script are built; the rest are just
fast-forwarded. Build output goes to `~/Library/Logs/rt-repo-sync-npm.log`.

The report (`--report`) is `{rows, meta}` JSON, one row per repo:
`repo`, `state` (Up to date, Updated, Not synced, Failed), `github` (origin/main
commit), `github_subject`, `vaults` (commit last built into the vaults, or
"no build"), `note`.

## Reload without toggling

Both plugins' builds write a `.hotreload` file into each vault's plugin
folder. With the Hot Reload community plugin (pjeby/hot-reload) installed and
enabled in a vault, Obsidian reloads Radial Timeline or Editorialist by itself
when a new build lands. Without it, toggle the plugin as before.
