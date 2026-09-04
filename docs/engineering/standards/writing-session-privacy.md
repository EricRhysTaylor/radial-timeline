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

---

## Audiences

There are two audiences. They take different shapes. Do not collapse them.

| Audience | Who | Shape | When |
|---|---|---|---|
| `private` | The author, on their own device | Full session row | always |
| `community` | The public website | Aggregates, an undated rollup, and author-composed posts | standing share at Level 3, or an explicit per-save post |

Community **never** sees per-session rows. Forcing community to aggregates
removes the spoiler surface entirely; it is the privacy lever, not a
presentation choice.

---

## What leaves the device, and when

Everything below is gated on the vault being **connected** to a Community
profile. Nothing leaves before that.

### On connection, at every level including Private: project shells

Per the contract's share-surfaces amendment, every book in Book Manager syncs
to the website as a **project shell** with `visibility='private'`:

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
It reads the same session store the author sees and the same
`buildDailyWritingStats` aggregator the plugin's own Progress view uses, so
what the website shows and what the author sees cannot drift.

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
