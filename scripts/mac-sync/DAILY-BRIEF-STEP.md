# Daily brief step: sync repos and fill the Deploys card

Add this step to `Command Center/Routines/modules/daily-dashboard.md`, before
the step that uploads the dashboard files, and record it in the brief's run
history like its other modules. It must run on the Mac: a cloud run can't
reach the local repos or vaults.

1. Run, from the radial-timeline repo:

       bash scripts/mac-sync/sync-repos.sh --report "<brief output dir>/deploys.json"

   It fast-forwards each clean repo to origin/main, rebuilds Radial Timeline
   and Editorialist into the vaults where main moved, and writes the report.
   A non-zero exit means the repos folder wasn't found: mark the step failed.
2. Upload `deploys.json` to Clearing House
   (https://claude.ai/artifact/9f65NUUnKqQBGHGWgqZwYy) the same way as
   `run-health.json`, and update the `deploys` dataset: `source.url` to the
   new asset, `updated: {at: <now, UTC ISO>, by: "Daily brief"}`.
3. In the brief's summary, list any repo whose state is **Not synced** or
   **Failed**, with its note. Say nothing about repos that are up to date.
