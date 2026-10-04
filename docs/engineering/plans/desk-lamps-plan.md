# Desk Lamps — live writing sessions with close friends

## Status

**Approved, 2026-10-04. Built 2026-10-03/04.** Eric answered the open
questions on 2026-10-04 (see "Decisions taken"); that round replaced the
12-lamp cap with a 12-row living list (D2, D15). It spans three codebases:
this plugin, the Community website (`radial-timeline-community`), and the
Platform database and edge functions (not in this repo).

- Contract: the amendment is in `Platform/COMMUNITY-SHARE-PRODUCT-CONTRACT.md`
  under Sharing Modes.
- Platform: migration `20261004020402_community_desk_lamps` applied live;
  `community-desk-lamps`, `community-desk-lamp` and the account export
  deployed (its `HANDOFF.md` entry is the record).
- Website: `DeskLampButton` on profiles, `DeskLampsManager` on My Share, the
  sharing-level copy.
- Plugin: `src/communityShare/deskLamps.ts`, `syncDeskLamps`, the session
  panel, the title-bar lamp, Settings → "Show Desk Lamps".

As built, two details differ from the text below. The session "hooks" are
one mechanism, not five calls: `DeskLamps.settingsChanged` (run on every
settings save, as the Mailbox's is) re-projects the lamp and sends only when
the projection changes, so start, manual pause, resume, save and discard
send at once and the idle auto-pause never does. And because a vault at the
Private level has Community `enabled` off, Desk Lamps uses its own
"connected at any level" check (`hasCommunityConnection`) rather than the
one every sharing call uses.

## The idea

A writer picks a few close friends on the Community and adds them as **Desk
Lamps**. When one of them starts a writing session in Radial Timeline and
chooses to share it, the other sees their lamp come on: who is at the desk,
in which city, doing what kind of writing, and for how long. It is the
"two friends are writing right now" feeling of a shared writing room,
without anyone having to post anything.

It is deliberately small. Trusted friends only, both people agree, every
session is shared by choice, and nothing about a lamp outlives the session.

## Words

- **Desk Lamp** — an accepted friend. "Add to Desk Lamps", "my Desk Lamps".
- **Lit** — the friend's session is open and they're at it.
- **On a break** — they pressed Pause.
- **Off** — no session, the session ended, or their computer went quiet.
- **Lamp off bulletin** — a short-lived row saying a friend just turned
  their lamp off, and after how long (D15).
- **Your lamp** — your own state, as your friends see it.

## What people see

Maya and Priya are Eric's Desk Lamps. Eric opens Obsidian at 9:12. The
title bar shows a lamp icon with **2**. The popover reads:

- Maya Chen · Portland · Drafting · 45 min
- Priya Nair · Leeds · Revising · 1 h 10 min
- Theo Brand · Lisbon · Planning · on a break
- Your lamp is off. Start a session to light it.

Eric opens the session panel. Under Desk Lamps, Maya and Priya are already
ticked (Eric's last choice); Theo isn't. Eric presses Begin Session. Maya's
and Priya's lamp icons each gain one, and their popovers show "Eric Rhys
Taylor · Santa Fe · Drafting · just started". Theo sees nothing.

Eric switches to an outline note for twenty minutes. The plugin's timer
idle-pauses (outlines aren't scenes), but Eric's lamp stays lit: friends see
the session, not the keystrokes. Pausing for lunch shows friends "on a
break". Saving the session turns the lamp off, and the server deletes the
row.

## Decisions

**D1. Mutual, by invite.** Adding someone sends an invite; nothing is
visible either way until they accept. Once accepted, it is one relationship
that works both ways, and each person still decides per session whether to
share. Accepting never means being watched without a say.

**D2. Many lamps, twelve rows.** A member may have up to 50 Desk Lamps,
counting accepted lamps and invites they've sent. Someone with 30 writing
friends will usually see four or five lit at once, so the limit that shapes
the experience is the popover, which shows at most 12 rows and keeps them
fresh (D15). The 50 ceiling is a safety rail against invite spam and keeps
the Begin Session list usable; it is not a product feature, and raising it
later is a one-line server change.

**D3. Who can be invited.** Any signed-in member except yourself, a member
blocked in either direction, and AI or archive authors (the archive rule
"no presence controls" applies). Invites are rate-limited (10 a day).
Following is not required.

**D4. Silent on the way out.** Declining, withdrawing, and removing never
notify anyone. A declined invite looks, from the sender's side, exactly
like one still waiting; pending invites expire after 30 days.

**D5. Shared per session, remembered.** The Begin Session panel lists your
Desk Lamps with checkboxes and an All box. The last choice is remembered
for the next session. A new setup starts with nothing ticked. The running
session panel shows "Lamp lit for Maya and Priya" with a way to change the
list or turn the lamp off mid-session.

**D6. Three states, and idle pauses stay private.** Lit, on a break, off.
Only a manual Pause shows as "on a break". The auto-track idle pause (2
minutes without activity in a scene) is never sent, so outline and research
work doesn't read as stopping, and friends don't see every stall.

**D7. Time is "how long the lamp has been on", at 5-minute precision.** The
plugin sends the session's start time floored to 5 minutes. Viewers see
elapsed time floored to 5 minutes ("just started" under 5). On a break, the
time is replaced by "on a break".

**D8. Never sent:** book title or label, stage, scene names or paths, word
counts, goals, notes, the countdown, exact timestamps. Mode (drafting,
revising, editing, planning) is the only description of the work.

**D9. City comes from the profile.** The popover shows the short form of the
friend's broad public place from their Community profile ("Portland"), or
nothing if they haven't set one. The plugin never reads device location.

**D10. A badge, not alerts.** A friend lighting their lamp changes the count
and nothing else: no Notice, no sound. Lamp off bulletins (D15) live only
inside the popover and never touch the count. Invites do surface: on My
Share, and in the plugin's lamp menu ("1 Desk Lamp invite waiting", opening
My Share), from the `invites_received` count the plugin's Desk Lamps call
already returns. No email in v1.

*Amended (Eric, 2026-10-03): invites were buried in My Share.* They are now
a Mailbox item too: "Desk Lamp invites" with a gold count in the website
account menu and the plugin's Mailbox pill, counted in both badges and
opening My Share's Desk Lamps section (`/me#desk-lamps`), which wears an
animated gold ring while an invite waits. One count serves both, from
`community_mailbox_state_rpc` `desk_lamp_invites` (platform migration
`20261004030316`), the same definition `community_my_desk_lamps()` gives.

**D11. The server keeps no history.** One live row per vault connection,
overwritten on each update and deleted when the lamp goes off. A row not
refreshed for 5 minutes counts as off and is swept. There is no table of
past lamp sessions, so there is nothing to leak, subpoena, or analyse later.

**D12. Separate from sharing levels.** Desk Lamps works at every sharing
level, Private included; it needs only a connected vault. Pausing Community
sharing turns your lamp off (your friends' lamps stay visible to you).
Disconnecting the vault, blocking, or deleting the account turns it off and
removes the relationship as described in D13.

**D13. Cascades.** Blocking someone removes your Desk Lamp relationship with
them, both directions, and any invite between you (same as follows and
likes today). Deleting an account deletes its lamps, invites, and live rows.
Disconnecting a vault deletes that connection's live row.

**D14. The lamp menu is always there.** The title-bar lamp shows whenever
the vault is connected and has at least one accepted Desk Lamp or an invite
waiting, whether or not you are writing. Looking never lights your own lamp.

**D15. A living list, freshest on top.** The popover reads like a bulletin
board, not a roster. Every row is sorted by its most recent change, newest
first:

- a lamp that is on (lit or on a break) sorts by its lit-at, so someone who
  just started rises to the top and someone four hours in drifts down;
- a **lamp off bulletin** sorts by the moment the plugin saw the lamp go
  off: "Maya Chen · Portland · lamp off after 2 h 10 min".

At most 12 rows show. When more lamps are on than fit, the longest-running
ones fall below the fold and a footer says so: "5 more at their desks"
(click to show everyone). Bulletins may push long-running lamps below the
fold; that is the point.

Bulletins are made by the plugin, not the server. On each check, a friend
whose lamp was on at the previous check and is gone now becomes a bulletin,
but only when that previous check was under 10 minutes ago, so a bulletin
always means "just now", never "sometime while you were away". A bulletin
lasts 30 minutes, then disappears. Bulletins are held in memory only, never
written to settings, so the server stays history-free (D11) and the plugin
keeps no log either. Reopening Obsidian starts with none.

The badge counts lit lamps only. Breaks show in the list, dimmed, and are
not counted; bulletins are never counted.

Example, with 17 friends on and Maya having just finished:

- Maya Chen · Portland · lamp off after 2 h 10 min
- Jun Park · Seoul · Drafting · just started
- Ada Osei · Accra · Planning · 15 min
- … nine more rows, newest first …
- 5 more at their desks

## Website (`radial-timeline-community`)

**Profile button.** On `app/authors/[handle]/page.tsx`, beside
`FollowButton`, a `DeskLampButton` with four states:

- none: "Add to Desk Lamps"
- invite sent: "Invite sent" (click to withdraw)
- invite received: "Accept Desk Lamp invite"
- accepted: lamp icon + "Desk Lamp" (hover: "Remove")

Hidden for yourself, signed-out viewers, blocked members either way, and AI
or archive authors. Disabled with "You have 50 Desk Lamps" at the cap.
Writes go through `callEdge`, like `BlockedMembersManager`.

**My Share section.** A "Desk Lamps" `Section` on `app/me/page.tsx`, after
"Blocked members", rendered by a new `DeskLampsManager`: accepted lamps
(Remove), invites received (Accept / Decline), invites sent (Withdraw).

**Sharing level copy.** Every place that explains sharing levels says Desk
Lamps is separate from them (Eric, 2026-10-04): the "Sharing level" section
on `app/me/page.tsx`, and a short paragraph after the levels in
`app/components/SharingBoundary.tsx`. Exact copy under "Disclosure copy".

**Reads.** The website reads the list through `community_my_desk_lamps()`
(signed-in members only): each row's relation (`lamp`, `invite_sent`,
`invite_received`) and the other member's handle, name and avatar. Writes go
through `callEdge("community-desk-lamp", { action, profile_id })`.

**Not in v1:** a website view of lit lamps. The plugin is where writing
happens; the website manages the list.

## Server (Platform)

Built 2026-10-04 in `radial-timeline-platform` (PR #21, branch
`claude/desk-lamps`): migration `*_community_desk_lamps`, functions
`community-desk-lamp` and `community-desk-lamps`, and `desk_lamps` in the
account export. Not yet applied or deployed; its `HANDOFF.md` entry has the
deploy order and is the record of what is live.

Two tables, neither readable by any client (unlike `community_follows`,
whose SELECT is public): RLS on, no policies, service role only. Members read
through `community_my_desk_lamps()`, which can show a declined invite as
still sent to its inviter; a row-level policy could not hide that column.

**`community_desk_lamps`** — the relationship. Inviter, invitee, status
(pending, declined or accepted), created, declined, accepted. One row per
unordered pair. Unaccepted rows expire 30 days after they were sent.

**`community_desk_lamp_lights`** — the live state. Keyed by vault
connection, with profile, state (lit or break), mode, lit-at (5-minute
floor), last-seen, and audience (profile ids). Rows are deleted on "off" and
swept when last-seen is older than 5 minutes or the connection is no longer
active; a profile or connection delete cascades.

**Edge functions**

- `community-desk-lamp` (website, JWT) — `{action, profile_id}` with action
  invite, withdraw, accept, decline or remove. Inviting someone who already
  invited you accepts. Cap, rate limit, block, AI, archive and pending
  deletion checks all live in the RPC.
- `community-desk-lamps` — the plugin's one call, authenticated with
  `connection_id` and `current_secret` like `community-mailbox`. The body
  may carry a `light`: absent means read only; `null` means "my lamp is
  off"; an object updates it. The server keeps only audience ids that are
  accepted Desk Lamps and answers with the effective audience, the member's
  accepted Desk Lamps (id and display name, for the checkboxes), the lamps
  currently on that include this member in their audience (name, short
  place, state, mode, lit-at), and the pending invite count.

A member with two connected vaults shows as one lamp: lit beats on a break,
and the earlier lit-at wins.

## Plugin (this repo)

**The exit point.** One pure function in `src/communityShare/deskLamps.ts`
projects the active session to the light payload. It emits exactly four
keys:

- `state`: `lit` or `break`
- `mode`: the session's mode
- `lit_at`: `ActiveWritingSession.startedAt`, floored to 5 minutes, ISO
- `audience`: the ticked Desk Lamp profile ids

Nothing else from `ActiveWritingSession` crosses (it carries `bookTitle`,
`stage`, goals, and the countdown). `state` is `break` only when
`pausedAt` is set and `idleAuto` is not true.

**The call.** `syncDeskLamps(plugin, light)` in `communityShareClient.ts`,
built on `postCommunityFunction` like `fetchCommunityMailbox`. Writes go
through `assertStillSendable` without `allowPaused`, so a paused share
can't light a lamp; reads allow paused.

**Cadence.**

- While your lamp is on: one call every 60 seconds from the plugin's
  existing 1-second tick, whatever view is showing and whether or not the
  window has focus. The same call returns your friends' lamps.
- While your lamp is off and you have at least one Desk Lamp: a read every
  60 seconds while a timeline view is visible and the window has focus, plus
  one when the window regains focus.
- With no Desk Lamps yet: a read on the Mailbox's schedule (first view,
  hourly, window focus), only to notice a first accepted lamp or invite.
- Transitions send at once: start, manual pause, resume, save, discard,
  turning the lamp off, changing the audience. Plugin unload sends a
  best-effort "off"; if it never arrives, the 5-minute rule ends the lamp.

The 5-minute window also covers Electron throttling background timers and
a laptop going to sleep. If the session is still open when the laptop
wakes, the next call relights the lamp with the same lit-at.

**Session hooks.** `WritingSessionService` start, pause, resume, save, and
discard call into `deskLamps.ts`. The idle auto-pause path does not.

**Session panel** (`TimeLineView.ts`, the Begin Session panel). A "Desk
Lamps" section with an All checkbox and one checkbox per accepted lamp,
shown only when connected with at least one. With up to 50 lamps, the
list puts the friends you shared with most recently first, then the rest
by name, and scrolls past 8 rows. First-use line under it:
"Ticked friends see that you're writing, your city, the kind of writing,
and how long, until you save or end the session." The running panel shows
"Lamp lit for Maya and Priya", with a small control to edit or turn it off.

**Title-bar lamp.** A button right of the Mailbox pill: Lucide
`lamp-ceiling` (Eric, 2026-10-04; was `lamp-desk`; both are in Obsidian's
bundled set) and the count of friends who are
lit. Clicking opens the living list from D15: up to 12 rows, freshest
change first, breaks dimmed, lamp off bulletins mixed in by time, and the
"N more at their desks" footer when lamps overflow. Below the list, a line
for your own lamp and "Manage Desk Lamps…" opening My Share. A row opens
that friend's Community profile. The previous check's lamps and the live
bulletins are module state in `deskLamps.ts`, in memory only.
Shown under a "Desk Lamps" toggle next to `showCommunityMailbox`, default
on. A failed check keeps the button, drops the count, and says why in the
tooltip, never a Notice, matching the Mailbox.

**Settings.** Under `communityShare`, a `deskLamps` record:
`{ profileId, audience, activeSessionId }`. It is scoped to the profile it
was made for, like `dailyBackfill`: a different profile ignores it. The
writing-session data shape does not change, so
`WRITING_SESSIONS_SCHEMA_VERSION` stays where it is. No scene YAML is read
or written.

## Contract amendment

Proposed text for `Platform/COMMUNITY-SHARE-PRODUCT-CONTRACT.md`, as a new
audience alongside "Sharing Modes":

> **Desk Lamps (amendment 2026-10).** A third audience, separate from the
> sharing levels and available at every level, Private included. A Desk
> Lamp is a mutual relationship between two members, made by invite and
> acceptance, at most 50 per member, never public. While an author has a
> writing session open and has chosen to share that session with some of
> their Desk Lamps, those members, and only those, see that the author is
> writing or on a break, the author's broad public place from their
> profile, the session's mode, and the time since the session began at
> 5-minute precision. Nothing else about the session, the book, or the
> manuscript is sent. The server holds this as a single live state per
> connection, deleted when the session ends or goes quiet for 5 minutes,
> and keeps no record of past lamps. Pausing sharing, disconnecting,
> blocking, and account deletion end it.

## Privacy doctrine changes

`docs/engineering/standards/writing-session-privacy.md` needs, before any
plugin code:

- A third row in **Audiences**: `desk lamps`, chosen friends, live state
  only, while a shared session is open.
- A new **exit point** section naming the projection function and
  `syncDeskLamps`, with its four keys and its gates.
- The **never emitted** list is untouched. The doc should say plainly why
  Desk Lamps doesn't breach it: it sends a live state, not a session row;
  its start time is floored to 5 minutes, not exact; and it never persists.
  This was the one real judgement call in the plan; Eric agreed on
  2026-10-04.
- Lamp off bulletins add no exit: they are made on the viewer's device from
  data it already received, and are never stored or sent.
- **Tracer coverage**: a test feeding the projection an
  `ActiveWritingSession` with the tracer `bookTitle` (and a stage, goals,
  and countdown) and asserting the payload has exactly the four allowed
  keys and no tracer.

While there, fix two stale lines in `docs/engineering/INDEX.md`: it still
describes a "friends" audience that was removed on 2026-09-04, and it names
`projections.privacy.test.ts`, which is now
`src/services/WritingSessionLog.privacy.test.ts`.

## Disclosure copy

**Invite (what the invitee sees):** "Eric Rhys Taylor invited you to Desk
Lamps. Desk Lamps are close writing friends. When either of you starts a
writing session in Radial Timeline and chooses to share it, the other sees
that your lamp is on: your name, your city from your profile, the kind of
writing, and how long you've been at it. No book, no scenes, no words.
Nobody else sees it: not followers, not the public. You can remove a Desk
Lamp any time, and they aren't told."

**My Share section description:** "Writing friends you trust. For each
writing session, you choose which of them see that you're at your desk.
They see your city, the kind of writing, and how long, only while the
session is open. Nothing is kept afterwards."

**Sharing level copy.** Lands with the feature, never before it: copy must
not name something members can't find yet.

- Website, My Share "Sharing level" section description, today "Set from
  the plugin. My Share controls which books and APR graphics are publicly
  visible." Append: "Desk Lamps is separate from your sharing level; see
  Desk Lamps below."
- Website, `SharingBoundary.tsx`, a paragraph after the three levels:
  "Desk Lamps is separate from your sharing level and works even at
  Private. Only the friends you add, and who accept, can see your lamp, and
  only for sessions you choose to share."
- Plugin, Settings → Community → "What you share"
  (`CommunityShareSection.ts`), today "Pick one sharing level. The complete
  preview always shows exactly what a level includes before anything
  publishes." Append: "Desk Lamps is separate: it shares live sessions only
  with the friends you choose, at any level, Private included."

**Plugin panel line:** as in "Session panel" above.

## Build order

1. Eric pastes the contract amendment into the product contract; amend
   `writing-session-privacy.md` to match.
2. Platform: both tables, RLS, the four functions, cascades for block,
   account deletion and disconnect, and the Mailbox count.
3. Website: `DeskLampButton`, `DeskLampsManager`, disclosure and sharing
   level copy.
4. Plugin, part 1: the title-bar lamp and living list, read only. Useful as
   soon as friends have accepted each other.
5. Plugin, part 2: the session panel, lighting, hooks, tracer test, and the
   "What you share" line.
6. `/feature-audit` across both sides.

## Decisions taken (Eric, 2026-10-04)

1. **Start times:** a lit lamp may show chosen friends when a session
   started, to 5 minutes. Agreed as consistent with "never exact
   timestamps" (live, rounded, not kept).
2. **Private level:** Desk Lamps works at every sharing level, Private
   included, and the sharing-level copy on both sides must say it is
   separate.
3. **Cap:** the visible list is what's capped at 12, not friendships. A
   writer may have many Desk Lamps (50 ceiling, D2); the popover shows 12
   rows and rotates them by freshness, with lamp off bulletins (D15).
4. **Pause sharing** turns your lamp off; you still see friends' lamps.
5. **Website:** no view of lit lamps in v1; the plugin only.

## Later, not v1

- "Write alongside": from a lit lamp, open an Arena room together.
- A lit-lamps strip on the Community feed for signed-in members.
- A per-friend "let me know when Maya lights up" opt-in notification.
