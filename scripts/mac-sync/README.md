# Mac repo sync

Cloud sessions and scheduled routines land their work on GitHub. This job
brings it to the Mac: every 15 minutes, and at login, it fast-forwards each
Radial Timeline LLC repo to `origin/main` and, for the two plugins, runs
`npm run deploy` so the new build is in every vault. A macOS notification says
what arrived. Each run does its work and exits; nothing stays running.

Install once, from this repo, in a terminal where `npm` works:

    bash scripts/mac-sync/install.sh

It shows a dry run first, then installs the launchd job and runs the first
sync. Re-running it is safe. Remove it with `bash scripts/mac-sync/uninstall.sh`.

What it will never do:

- touch a repo that has uncommitted changes, is on a branch other than `main`,
  or has local commits GitHub doesn't have (it notifies once instead);
- merge, rebase, reset, commit or push;
- build uncommitted work into the vaults.

Repos covered (found by their GitHub remote under
`~/Documents/Radial Timeline LLC`, up to four folders deep): radial-timeline,
editorialist, radial-timeline-community, -web, -platform, -email, -engine.
Only repos with an `npm run deploy` script are built; the rest are just
fast-forwarded.

Log: `~/Library/Logs/rt-repo-sync.log` (build output in `rt-repo-sync.log.npm`).

## Reload without toggling

Both plugins' builds write a `.hotreload` file into each vault's plugin
folder. With the Hot Reload community plugin (pjeby/hot-reload) installed and
enabled in a vault, Obsidian reloads Radial Timeline or Editorialist by itself
when a new build lands. Without it, toggle the plugin as before.
