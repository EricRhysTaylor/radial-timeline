The Community tab connects Radial Timeline to the public Community area on the Radial Timeline website for author-to-author progress sharing: public profiles, project shells, optional Author Progress Report graphics, and optional writing activity, with a clear view of what you chose to share.

Community Share is opt-in. Nothing publishes from your vault until you connect the website, choose a sharing level, and press **Begin sharing**.

## What Community Share Is For

Share project details, progress graphics, and selected writing activity with other writers.

Sharing tools:

*   Public author profile and project shell.
*   Optional Author Progress Report (APR) graphics.
*   Optional writing-activity summaries at the highest sharing level.
*   A book's timeline, shared from the **Timeline** section. You choose which scenes to reveal.
*   Private scenes: the text of a scene, released to readers you name.
*   A live preview of exactly what will be shared.
*   Pause, take offline, delete shared data, and disconnect controls.

## What Never Leaves The Plugin

The plugin does **not** publish:

*   Scene paths.
*   Note paths.
*   File names or folder paths.
*   Vault paths.
*   Raw writing-session rows.
*   Exact public session timestamps.
*   API keys, license keys, or plugin secrets.

Only the categories included in your selected sharing level are published.

Manuscript text is never public and is never part of a sharing level. Community Share sends it in one case: a scene you release to readers you name, sent when you press **Release** or **Update for every reader** for that scene. See [Private Scenes](#private-scenes).

**[Desk Lamps](Desk-Lamps)** is separate from the sharing level and works at every level, Private included. For a session you choose to share, it sends the friends you tick only that your lamp is on, the kind of writing, and how long, in five-minute steps. Nothing is kept after the session ends.

At Level 3, the hourly rollup behind the Community's **Working Clock** (the activity dial on the website) is coarse and undated by design: it reports minutes per local hour-of-day (0–23) and mode, folded across a trailing 28-day window — never a per-session row, never a calendar date, never tied to a specific scene or book.

## Basic Setup

1. Open the website Community page and sign in.
2. Create or update your public author profile and public project shell.
3. Generate a one-time connection code on the website.
4. In Obsidian, open **Settings -> Community Plugins -> Radial Timeline -> Community**.
5. Paste the connection code and click **Connect**.
6. Choose your sharing level under **What you share**.
7. Review the preview, which updates automatically to reflect your selection.
8. Click **Begin sharing**.

Connecting alone does not publish anything. It links this vault to your Community profile and sends each of your Book Manager books to your **private** My Share list as a project shell: the book's public label (or its working title if you have not set one), logline, stage target dates, and order. Shells stay private until you switch a project on from My Share; the plugin never changes that. Choosing **Private** under **What you share** stops this sync.

The connected book follows My Share: choose a different book with **Change book** on My Share, and the next book sync picks it up. The Community Share preview and the connected book in settings both show the book you chose.

## What You Share

Sharing is controlled by a single **What you share** level:

*   **Level 1 — Private** — nothing is published, and your book list stops syncing to My Share. The [Mailbox](Radial-Timeline-View#community-mailbox) and [Desk Lamps](Desk-Lamps) still work.
*   **Level 2 — Profile, books + APR** — your public profile and project shells, plus the option to send a campaign's visual progress report for one selected book. This level does not include writing days, streaks, minutes, inactivity, or session statistics.
*   **Level 3 — Profile, books + writing activity** — includes Level 2 and adds two activity feeds: a daily aggregate feed (writing days, rounded minutes and word totals, and coarse mode mix) and the **Working Clock** rollup — a trailing 28-day summary of your writing minutes bucketed by the local hour of day you started each session and by mode (drafting/revising/planning). This is what your time-of-day writing pattern looks like on the website.

Sensitive fields, such as real scene titles or exact session timestamps, are never included.

## Preview

The preview under your sharing selection always reflects the current level ("Preview ready" with a timestamp). It shows the public report categories that will be sent to the website. Changing the level refreshes the preview.

## Sharing And Safety Controls

*   **Begin sharing / Pause sharing** puts your selected level on the community site and keeps it current automatically. Pausing stops updates; what you already shared stays visible until you revoke it.
*   **Take offline** (the button that revokes your report) removes the current public report from public viewing while keeping your connection.
*   **Delete shared data** removes the shared report payload from the website. Minimal audit metadata may remain.
*   **Disconnect plugin** takes this vault's report offline, stops sharing, and removes its saved connection key. Your account and other Community content stay in place. Reconnecting this vault later requires generating and entering a **new one-time linking key** — the old one cannot be reused.

## New Mac, Reinstall, Or Synced Vault

The connection key is stored in Obsidian's private, per-device secure storage. It **never travels with the vault**: Obsidian Sync, iCloud, git, a vault copy, or a fresh OS install all bring your settings across but not the key. The plugin then still shows itself as connected while the key behind that connection is gone, and pressing **Begin sharing** shows:

> The private connection secret is missing. Reconnect Community Share.

This is expected, not a fault. Fix it in this order:

1. In the Community tab, scroll to **Sharing and safety** and click **Disconnect**. It works even though the key is missing, and it does not touch anything on the website.
2. On the website, open **My Share** (sign in with the email on your author profile, not a different address) and generate a new one-time linking key.
3. Paste the key into **Connection code**, click **Connect**, then **Begin sharing**.

Rotating the connection secret from My Share does not repair this case. Rotation replaces the key on the website side for a plugin that still has one; a vault with no key needs a new linking key. Every device you write from needs its own connection, made the same way.

## Sharing An APR

From Level 2 upward, an [Author Progress Report](Author-Progress-Report) campaign can send its graphic to Community, where it arrives privately on My Share. See [Send a campaign to Community](Author-Progress-Report#send-a-campaign-to-community).

## Share Your Timeline

Turn on **Share timeline** to send a book's timeline to your Community account. It arrives private: nobody can see it until you review it and go live. **Open preview** opens the Complete Preview on the website, where you reveal scenes. Going live is always your click.

Radial Timeline sends scene order, acts, subplots, status and publish stage. Titles, synopses, cast, narration and story dates are stored privately until you reveal a scene. Under **Details readers can see on a revealed scene**, choose which of those a reader sees. **Generic ring names** shows Subplot 1, Subplot 2 instead of your subplot names.

A live timeline updates with your book sync. Pausing Community sharing stops every update. Sharing a timeline needs a sharing level above Private, and the book needs a source folder in Book Manager.

To share from a file instead, run the [Community timeline share export](Commands#community-timeline-share-export) command and upload the file on My Share.

## Private Scenes

Under **Private scenes**, turn on **Share scene body** to release the text of a scene from the active book to readers you name. It is off by default. Only those readers can read a released scene, signed in on the website. The first time you turn it on, Radial Timeline shows the release terms and asks you to agree.

**Release scenes…** lists the book's scenes in manuscript order, each marked **Not released**, **Released**, **Changed since release**, or **Hidden after a reader's report**. Radial Timeline works out whether a scene changed since its release inside your vault.

**Preview and release** shows exactly what readers will see: the scene's prose, with its properties, comments, callouts, link syntax and block IDs removed. Choose a rating, **General** or **Mature**, then press **Release**. Scenes with sex in them can't be shared yet. The text is sent on that press. For a released scene, **Preview and update** shows the current text, and **Update for every reader** replaces it; feedback on the earlier version is kept, marked with its version.

A release shares the text with nobody until you choose its readers: **Choose readers on the website** opens that page. **Take down** deletes the text on the website and readers lose it at once. You keep the feedback you received.

A reader can report a scene. That hides it from every reader and sends its text to the Community's AI provider to be checked against the content rules. It comes back if the check finds no breach. If it stays hidden, the website's Private scenes page says why, and updating the scene there sends it through the check again. If you take a scene down while it is hidden this way, the scenes you release or update afterwards are checked the same way before your readers see them. If the check found that the scene you took down breaks a content rule, and it finds that of a scene you release afterwards, your account is flagged: your author page, timelines and scenes are hidden, and posting and sharing stop, until the flag is reviewed. A hold over a scene's rating doesn't count. To fix a held scene, update its text on the website's Private scenes page.

A scene can be released once the book's timeline is shared, and it needs a scene ID. A scene can be up to 10,000 words. The block shows how many scenes you have released and how many your account allows for the book. Pausing Community sharing stops releases, updates and take-downs. Turning **Share scene body** off leaves released scenes as they are.
