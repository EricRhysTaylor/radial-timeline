# Desk Lamps — live writing sessions with close friends

## Status

**Proposal, 2026-10-03.** Nothing is built. This plan needs Eric's sign-off
on the decisions below, and the product contract needs the amendment in
"Contract amendment" before any code is written. It spans three codebases:
this plugin, the Community website (`radial-timeline-community`), and the
Platform database and edge functions (not in this repo).

## The idea

A writer picks a few close friends on the Community and adds them as **Desk
Lamps**. When one of them starts a writing session in Radial Timeline and
chooses to share it, the other sees their lamp come on: who is at the desk,
in which city, doing what kind of writing, and for how long. It is the
"two friends are writing right now" feeling of a shared writing room,
without anyone having to post anything.

It is deliberately small. Close friends only, both people agree, every
session is shared by choice, and nothing about a lamp outlives the session.

## Words

- **Desk Lamp** — an accepted friend. "Add to Desk Lamps", "my Desk Lamps".
- **Lit** — the friend's session is open and they're at it.
- **On a break** — they pressed Pause.
- **Off** — no session, the session ended, or their computer went quiet.
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

**D2. Small.** At most 12 Desk Lamps per member, counting accepted lamps
and invites you've sent. A Desk Lamp list is close friends, not a second
follower list.

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
and nothing else: no Notice, no sound. Invites do surface: they count in the
existing Mailbox (website chip and plugin pill), with a "Desk Lamp invites"
row in the plugin's Mailbox menu. No email in v1.

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
the vault is connected and has at least one accepted Desk Lamp, whether or
not you are writing. Looking never lights your own lamp.

## Website (`radial-timeline-community`)

**Profile button.** On `app/authors/[handle]/page.tsx`, beside
`FollowButton`, a `DeskLampButton` with four states:

- none: "Add to Desk Lamps"
- invite sent: "Invite sent" (click to withdraw)
- invite received: "Accept Desk Lamp invite"
- accepted: lamp icon + "Desk Lamp" (hover: "Remove")

Hidden for yourself, signed-out viewers, blocked members either way, and AI
or archive authors. Disabled with "You have 12 Desk Lamps" at the cap.
Writes go through `callEdge`, like `BlockedMembersManager`.

**My Share section.** A "Desk Lamps" `Section` on `app/me/page.tsx`, after
"Blocked members", rendered by a new `DeskLampsManager`: accepted lamps
(Remove), invites received (Accept / Decline), invites sent (Withdraw).

**Sharing boundary.** `app/components/SharingBoundary.tsx` gains a short
paragraph after the levels: Desk Lamps is separate from your sharing level,
and what it shows and to whom (copy below).

**Mailbox.** `community-mailbox` adds pending Desk Lamp invites to the
counts the website chip and plugin pill already show.

**Not in v1:** a website view of lit lamps. The plugin is where writing
happens; the website manages the list.

## Server (Platform)

Two tables, neither readable through public REST (unlike
`community_follows`, whose SELECT is public).

**`community_desk_lamps`** — the relationship. Inviter, invitee, status
(pending or accepted), created, accepted, and expiry for pending rows. One
row per unordered pair. RLS lets only the two members read their row;
writes happen only through edge functions.

**`community_desk_lamp_lights`** — the live state. Keyed by vault
connection, with profile, state (lit or break), mode, lit-at (5-minute
floor), last-seen, and audience (profile ids). No direct reads for anyone.
Rows are deleted on "off", disconnect, and account deletion, and swept
when last-seen is older than 5 minutes.

**Edge functions**

- `community-desk-lamp-invite` — create or withdraw an invite (cap, rate
  limit, block and AI checks).
- `community-desk-lamp-respond` — accept or decline.
- `community-desk-lamp-remove` — end an accepted relationship.
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
- While your lamp is off: a read every 60 seconds while a timeline view is
  visible and the window has focus, plus one when the window regains focus.
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
shown only when connected with at least one. First-use line under it:
"Ticked friends see that you're writing, your city, the kind of writing,
and how long, until you save or end the session." The running panel shows
"Lamp lit for Maya and Priya", with a small control to edit or turn it off.

**Title-bar lamp.** A button right of the Mailbox pill: Lucide `lamp-desk`
(confirm it is in Obsidian's bundled set) and the count of friends who are
lit (breaks are listed but not counted). Clicking opens a menu: one row per
lamp that's on, breaks dimmed; a line for your own lamp; and "Manage Desk
Lamps…" opening My Share. A row opens that friend's Community profile.
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
> acceptance, at most 12 per member, never public. While an author has a
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
  This is the one real judgement call in the plan (see Open questions).
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

**My Share section description:** "Close writing friends, up to 12. For
each writing session, you choose which of them see that you're at your
desk. They see your city, the kind of writing, and how long, only while
the session is open. Nothing is kept afterwards."

**Sharing boundary paragraph:** "Desk Lamps is separate from your sharing
level and works even at Private. Only the friends you add, and who accept,
can see your lamp, and only for sessions you choose to share."

**Plugin panel line:** as in "Session panel" above.

## Build order

1. Eric approves the decisions and the contract amendment; amend
   `writing-session-privacy.md`.
2. Platform: both tables, RLS, the four functions, cascades for block,
   account deletion and disconnect, and the Mailbox count.
3. Website: `DeskLampButton`, `DeskLampsManager`, disclosure copy.
4. Plugin, part 1: the title-bar lamp, read only. Useful as soon as
   friends have accepted each other.
5. Plugin, part 2: the session panel, lighting, hooks, tracer test.
6. `/feature-audit` across both sides.

## Open questions for Eric

1. **The "never exact timestamps" line.** A lit lamp reveals, to chosen
   friends and to 5 minutes, when a session started. This plan reads that
   as consistent with the rule (live, rounded, not kept). Agree?
2. **Private level.** Desk Lamps works at the Private sharing level. Agree,
   or should it need a level?
3. **Cap of 12.**
4. **Pause sharing turns your lamp off.**
5. **Website view of lit lamps** — left out of v1. Agree?

## Later, not v1

- "Write alongside": from a lit lamp, open an Arena room together.
- A lit-lamps strip on the Community feed for signed-in members.
- A per-friend "let me know when Maya lights up" opt-in notification.
