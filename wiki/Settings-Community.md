The Community tab connects Radial Timeline to the public Community area on the Radial Timeline website. It is designed for author-to-author progress sharing: public profiles, project shells, and optional progress summaries, with a clear view of what you chose to publish.

Community Share is opt-in. Nothing publishes from your vault until you connect the website, choose a sharing level, and press **Begin sharing**.

## What Community Share Is For

Use Community Share when you want to show other writers what you are working on without exposing the private contents of your manuscript.

Launch scope:

*   Public author profile and project shell.
*   Optional progress summaries.
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

*   **Private** — nothing is published.
*   **Profile + books** — your public profile and project shells.
*   **Profile, books + progress summaries** — adds rounded, bucketed progress summaries (writing days, rounded minutes and word totals, coarse mode mix).

Sensitive fields, such as real scene titles or exact session timestamps, are never included.

## Preview

The preview under your sharing selection always reflects the current level ("Preview ready" with a timestamp). It shows the public report categories that will be sent to the website. There is no separate generate step — change the level and the preview follows.

## Sharing And Safety Controls

*   **Begin sharing / Pause sharing** puts your selected level on the community site and keeps it current automatically. Pausing stops updates; what you already shared stays visible until you revoke it.
*   **Revoke sharing** removes the current public report from public viewing while keeping your connection.
*   **Delete shared data** removes the shared report payload from the website. Minimal audit metadata may remain.
*   **Disconnect plugin** removes the plugin's Community Share connection for this vault. Local writing data stays local.

## Relationship To APR

The [Author Progress Report](Author-Progress-Report) is a local visual/social export tool.

Community Share is different: it is a website-connected publish flow with account connection, sharing levels, an always-current preview, and remote revoke/delete/disconnect controls.

Use APR when you want a designed progress graphic. Use Community Share when you want a public author-to-author presence on the Radial Timeline website.
