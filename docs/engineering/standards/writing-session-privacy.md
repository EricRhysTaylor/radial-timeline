# Writing Session Privacy Architecture

Authoritative statement of how writing-session data and book identity leave
the author's device. Any code path that transmits `WritingSessionRecord`
data or Book Manager data to the community website **must** go through one
of the exit points named here. This document is doctrine: read it before
touching any code that reads, renders, or transmits session records or book
profiles.

The product-level contract this document implements is
`Platform/COMMUNITY-SHARE-PRODUCT-CONTRACT.md` (sharing modes, tiers, field
bundles, and the 2026-07-04 "share surfaces" amendment). Where the two ever
disagree, the contract wins and this document is wrong; fix this document.

Reconciled 2026-09-04. The earlier revision described a `friends` audience
and a device-side per-book toggle for book titles. Neither shipped and
neither exists in the contract; both are gone.

Amended 2026-10-04: the **Desk Lamps** audience (Eric's decisions of
2026-10-03/04; plan `docs/engineering/plans/desk-lamps-plan.md`; contract
amendment "Desk Lamps", 2026-10). It is not the old `friends` audience: it
carries no session rows and no aggregates, only a live state, and only while
a session the author chose to share is open.

---

## Audiences

There are three audiences. They take different shapes. Do not collapse them.

| Audience | Who | Shape | When |
|---|---|---|---|
| `private` | The author, on their own device | Full session row | always |
| `community` | The public website | Aggregates, an undated rollup, and author-composed posts | standing share at Level 3, or an explicit per-save post |
| `desk lamps` | The accepted Desk Lamps the author ticked for this session | A live state: lit or on a break, mode, session start floored to 5 minutes | only while that session is open, at any sharing level |

Community **never** sees per-session rows. Forcing community to aggregates
removes the spoiler surface entirely; it is the privacy lever, not a
presentation choice. Desk Lamps never see a session row either: they see
that a session is open right now, and nothing about it survives the session.

---

## What leaves the device, and when

Everything below is gated on the vault being **connected** to a Community
profile. Nothing leaves before that.

### While connected, until the author chooses Private: project shells

Per the contract's share-surfaces amendment, every book in Book Manager syncs
to the website as a **project shell** with `visibility='private'`, from the
moment the vault connects (a fresh connection reads as Private in settings
but has not been set to it, and does sync shells) and at Levels 2 and 3.
Shells stop when the author **chooses Private** in Settings, pauses sharing,
or disconnects (Eric, 2026-10-03: choosing Private means nothing about the
books leaves). The gate is `hasActiveCommunityConnection` (Community on);
choosing Private turns Community off. Shells already on the website stay
there as they were; the plugin never deletes them (below).

- the book's public label, or its **working title** when no public label is set
- the public description (logline), if set
- Book Manager order
- the four stage target dates (Zero / Author / House / Press), value or null
- the vault-global zero-draft flag, on the active book only

Shells appear only on the owner's My Share list. The website is the only
place a shell becomes public, by an explicit visibility flip per project.
The plugin never changes visibility and never deletes shells.

This is a **server-side** privacy model for book identity: the working title
crosses the wire and is stored privately, rather than being withheld on the
device. The plugin's disclosure copy must say this plainly. It is not a
device-side per-book opt-in, and no code may describe it as one.

Exit point: `communityShareClient.syncCommunityProjects` (from plugin load
and from target-date edits, throttled). Never carries scene data, paths,
notes, or session records.

Two calls work at every level, Private included, because neither sends
anything about the books or the writing record: the title-bar Mailbox, which
only reads (counts of the author's own unread replies and invites), and the
Desk Lamp below, which the author turns on per session. Both use
`hasCommunityConnection` (connected, at any level).

### Level 2 and above: the standing report

The weekly report payload is built by `communitySharePreview.buildCommunitySharePreview`
from the field manifest the selected level enables. For book identity it
uses the **public label only**; when a book has no public label, the title
field is simply absent from the payload. It never substitutes "Untitled".
Activity fields are rounded per the contract (minutes to 5, words to 50).

### Level 3 only: daily aggregates and the hour × mode rollup

`communitySharePreview.buildCommunityDailyEntries` emits one row per day
for the trailing 14 days: date, minutes (rounded to 5), session count, words
(rounded to 50), scenes completed by stage, and mode mix as integer percent.
Words travel as two fields: `words_added` (drafting sessions only) and
`words_logged` (every mode: drafting, revising, editing, planning). Both are
gated together on the `activity.words_added` field policy through the same
check the weekly report uses; with words off, neither is emitted.
It reads the same session store the author sees and the same
`buildDailyWritingStats` aggregator the plugin's own Progress view uses, so
what the website shows and what the author sees cannot drift.

One-time season backfill: while a backfill is due, the daily sync sends the
trailing 84 days instead of 14, under exactly the same gates, so the website
can fill `words_logged` on rows it already holds. Completion is recorded in
plugin settings as `communityShare.dailyBackfill` — `{ version, profileId,
connectionId, wordsIncluded }` — scoped to what was actually delivered. It is
due when there is no record, the record's version is below
`COMMUNITY_DAILY_BACKFILL_VERSION`, the record names a different profile or
connection than the live one (activating another connection gets its own
backfill), or words are now included but the recorded backfill carried none.
The record is written only after the server confirms, and only if the live
connection is still the one the request was sent over — an in-flight response
never stamps a replacement connection. A server that rejects the window
(`too_many_days`, `date_too_old`) gets the normal 14 days in the same sync and
the backfill stays due. The pre-release vault-wide `dailyBackfillVersion`
scalar is dropped on load (it cannot name its recipient), so such a vault
re-sends the backfill once; the server upserts per day, so that is harmless.

`WritingSessionLog.buildCommunityHourModeMix` (via
`communitySharePreview.buildCommunityHourModeMixEntries`) rolls the trailing
28 days of session minutes into buckets keyed by **local start hour** (0–23)
and folded mode (`drafting`, `revising` absorbing `editing`, `planning`).
It carries no calendar date at all. It ships as the optional `hour_mode_mix`
field on the same daily sync under the same tier-4 public gate; it is never
gated separately and never introduces a setting.

Both are sent by `communityShareClient.syncCommunityDailyIfEligible`.

### Level 2 and above, Pro, per campaign: the APR image

`communityShareClient.uploadAprToCommunity` sends the rendered Author
Progress Report SVG for one campaign's book. By construction it contains
geometry, the book title, author name, percent, and branding; no manuscript
text. It lands in a private bucket on My Share and is activated only on the
website. Governed by the contract's amendment, not by this document.

### Level 3, explicit per-save: the session feed post

`WritingSessionLog.projectSessionFeedPost` builds an author-composed post
from one session: a stats headline (minutes, words, mode) and the session
note. It is produced only when the author arms the "post to community feed"
toggle in the save modal; the toggle's state is always visible before
saving, and the remembered default only pre-arms it. It is never a passive
flag applied after the fact. Sent by
`communityShareClient.postSessionToCommunityFeed`.

### Any level, per session: the Desk Lamp

The Desk Lamp is independent of the sharing level: it works at Private too.
It needs a connected vault, an **active** connection (a paused share sends
no lamp; turning a lamp off is always allowed), an open writing session, and
at least one accepted Desk Lamp ticked in the Begin Session panel for that
session. A new setup ticks nobody; the remembered choice only pre-ticks.

One pure projection in `src/communityShare/deskLamps.ts` turns the active
session into the lamp. It emits exactly four keys and nothing else from
`ActiveWritingSession` (which carries `bookTitle`, `stage`, goals and the
countdown):

- `state`: `lit`, or `break` only when the author pressed Pause
  (`pausedAt` set and `idleAuto` not true). The auto-track idle pause is
  never sent.
- `mode`: the session's mode.
- `lit_at`: `startedAt` floored to 5 minutes, ISO UTC.
- `audience`: the ticked Desk Lamp profile ids.

Sent by `communityShareClient.syncDeskLamps` to `community-desk-lamps`, on
start, manual pause, resume, save, discard, audience change, and once a
minute while the lamp is on; `null` turns it off. The plugin-wide
`DeskLamps` re-projects the lamp on every settings save and sends only when
the projection changes, so an idle auto-pause (which projects as `lit`)
never causes a send. Settings → "Show Desk Lamps" off turns a lit lamp off
and stops every Desk Lamps call. The server refuses a lamp
with any other key, keeps one live row per connection, deletes it when the
lamp goes off or after 5 minutes without a refresh, and keeps no history.
Friends see the author's display name and the short label of the broad
public place on their Community profile, both already public; the plugin
never reads device location.

Lamp off bulletins (a friend's lamp that went off since the last check) are
made on the viewer's device from data it already received, held in memory
only, and never stored or sent. They add no exit.

---

## Field sensitivity

### Never emitted to community, under any level

- `scenePaths`, `scenesCompletedPaths`, `scenesActivity[].path` — vault
  file paths reveal folder structure and working titles
- scene titles, derived from paths or scene metadata — spoilers for
  unpublished work
- raw session rows, exact session start/end timestamps
- `note` — except through the session feed post, above
- the local vault name, device names, plugin logs, API or license keys

Adding a field to this list is a one-way door.

The Desk Lamp does not breach it (Eric, 2026-10-04): it is a live state, not
a session row; its start time is floored to 5 minutes, not exact; it goes
only to friends the author ticked; and it is deleted when the session ends.
No end time is ever sent.

### Crosses the wire only as a private shell

- the book working title (when no public label is set), logline, stage
  target dates, order, zero-draft flag — see "On connection" above

### Social currency, once Level 3 is on

- `mode`, `stage`, minutes, words, scene completions by stage, at the
  contract's rounding, at day precision or undated

**No fallbacks.** If a field cannot be safely projected, omit it. Never
substitute "Untitled scene" or "Anonymous". The no-fallback doctrine applies
here as it does everywhere.

**Identity is added server-side.** Client payloads never know the author id.
The website attaches identity from the authenticated connection. The exit
points are pure of identity concerns and one less thing can leak.

---

## Defaults

- Every session record is `private` by default.
- The standing share is per vault connection and off until the author
  chooses a level and presses **Begin sharing**.
- The `note` field never leaves the device passively; its only exit is the
  per-save feed post.
- No Desk Lamp is lit unless the author ticks at least one friend for that
  session.
- Rounding and precision are not user-configurable; they are fixed by the
  contract per level.

---

## The tracer privacy tests

Privacy boundaries are tested like security boundaries, because that is
what they are. Two test files carry the same tracer strings:

```
note:                 'PRIVACY_TRACER_NOTE_DO_NOT_LEAK'
scenePaths:           ['PRIVACY_TRACER_PATH_DO_NOT_LEAK']
scenesCompletedPaths: ['PRIVACY_TRACER_COMPLETED_PATH_DO_NOT_LEAK']
scenesActivity[].path:'PRIVACY_TRACER_ACTIVITY_PATH_DO_NOT_LEAK'
bookTitle:            'PRIVACY_TRACER_TITLE_DO_NOT_LEAK'
```

- `src/services/WritingSessionLog.privacy.test.ts` covers the exits in the
  log module: `projectPrivate` (baseline: all tracers present),
  `projectSessionFeedPost` (note allowed, nothing else), and
  `buildCommunityHourModeMix`.
- `src/communityShare/communitySharePreview.test.ts` covers the wire path:
  `buildCommunityDailyEntries` and `buildCommunitySharePreview`, fed traced
  records, traced scene data, and a book whose working title is a tracer
  with no public label. The report payload must contain no tracer and no
  title field at all.

The project-shell sync is asserted in `communityShareClient.test.ts`: it
**does** carry the working title (that is the contract), and it never
carries paths, notes, or session data.

The Desk Lamp projection has its own tracer test
(`src/communityShare/deskLamps.privacy.test.ts`): an `ActiveWritingSession`
carrying the `bookTitle`, book id, scene path and session id tracers, a
stage, goals, word counts and a countdown must project to exactly `state`,
`mode`, `lit_at` and `audience`, with no tracer, no exact start time, and an
idle auto-pause reading as `lit`; and what `syncDeskLamps` posts must be
that lamp plus `connection_id` and `current_secret`, nothing else.

A future field on `WritingSessionRecord` that quietly passes through to a
community exit fails these tests. **Adding the tracer for a new field is
required as part of adding that field.**

---

## When to update this document

Bump and amend before:

- adding a field to `WritingSessionRecord` or `BookProfile` that any exit
  point could read;
- adding, removing, or re-routing an exit point;
- changing what any exit point emits or how it is gated;
- any amendment to the product contract that touches data scope.

The contract is the promise. This document is how the plugin keeps it.
