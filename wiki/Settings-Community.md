The Community tab connects Radial Timeline to the public Community area on the Radial Timeline website. It is designed for author-to-author progress sharing: public profiles, project shells, optional Author Progress Report graphics, and optional writing activity, with a clear view of what you chose to share.

Community Share is opt-in. Nothing publishes from your vault until you connect the website, choose a sharing level, and press **Begin sharing**.

## What Community Share Is For

Use Community Share when you want to show other writers what you are working on without exposing the private contents of your manuscript.

Launch scope:

*   Public author profile and project shell.
*   Optional Author Progress Report (APR) graphics.
*   Optional writing-activity summaries at the highest sharing level.
*   A live preview of exactly what will be shared.
*   Pause, revoke, delete shared data, and disconnect controls.

Future community features may include follows, timeline views, review circles, and editor/alpha-reader workflows. Those are not part of the launch publish path.

## What Never Leaves The Plugin

Community Share is intentionally narrower than a collaboration or manuscript-review system.

The plugin does **not** publish:

*   Manuscript text.
*   Scene paths.
*   Note paths.
*   File names or folder paths.
*   Vault paths.
*   Raw writing-session rows.
*   Exact public session timestamps.
*   API keys, license keys, or plugin secrets.

Only the categories included in your selected sharing level are published.

## Basic Setup

1. Open the website Community page and sign in.
2. Create or update your public author profile and public project shell.
3. Generate a one-time connection code on the website.
4. In Obsidian, open **Settings -> Community Plugins -> Radial Timeline -> Community**.
5. Paste the connection code and click **Connect**.
6. Choose your sharing level under **What you share**.
7. Review the preview, which updates automatically to reflect your selection.
8. Click **Begin sharing**.

Connecting alone does not publish anything. It only links this local vault/book to the website project you selected.

## What You Share

Sharing is controlled by a single **What you share** level:

*   **Level 1 — Private** — nothing is published.
*   **Level 2 — Profile, books + APR** — your public profile and project shells, plus the option to send a campaign's visual progress report for one selected book. This level does not include writing days, streaks, minutes, inactivity, or session statistics.
*   **Level 3 — Profile, books + writing activity** — includes Level 2 and adds rounded, bucketed activity summaries such as writing days, rounded minutes and word totals, and coarse mode mix.

Sensitive fields, such as real scene titles or exact session timestamps, are never included.

## Preview

The preview under your sharing selection always reflects the current level ("Preview ready" with a timestamp). It shows the public report categories that will be sent to the website. There is no separate generate step — change the level and the preview follows.

## Sharing And Safety Controls

*   **Begin sharing / Pause sharing** puts your selected level on the community site and keeps it current automatically. Pausing stops updates; what you already shared stays visible until you revoke it.
*   **Revoke sharing** removes the current public report from public viewing while keeping your connection.
*   **Delete shared data** removes the shared report payload from the website. Minimal audit metadata may remain.
*   **Disconnect plugin** removes the plugin's Community Share connection for this vault. Local writing data stays local.

## Sharing An APR

The [Author Progress Report](Author-Progress-Report) remains a local visual/social export tool, and Level 2 adds a controlled route to Community:

1. In **Social**, choose a campaign and its target book.
2. Enable **Send to Community** for that campaign.
3. Use **Send now** for a private upload, or let Daily, Weekly, or Monthly campaign updates refresh it while Obsidian is open.
4. Open **My Share** on the website to inspect the exact graphic and activate it. The book must already be public before its APR can be activated.

Selecting Level 2 never uploads an APR by itself. The campaign destination is separately opt-in and defaults off. Uploaded APRs arrive privately; public activation and deactivation happen only on My Share.

APR schedules are client-side. Radial Timeline checks on plugin startup and hourly while the vault is open. If Obsidian is closed when an update becomes due, it catches up the next time the plugin starts; there is no Community server job generating reports in the background.
