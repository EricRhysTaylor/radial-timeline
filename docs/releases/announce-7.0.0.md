# 7.0.0 — announcement drafts

Derived from `draft-for-release-7.0.0.md`. Structure and rules live in
`Brand/messaging-canon.md` §8.

**Images: unblocked.** 13 in `wiki/images/`, onboarding and share-settings gaps
now closed. Only *APR direct to Community* still has no capture — minor, and no
rung depends on it.

**The copy now names The Odyssey.** The onboarding captures show a single
HTML file imported to 24 chapters, split into scenes, via a local model. That is
a concrete, checkable demo of the hardest import lane, using a text everyone
recognizes — it beats any abstract statement of the capability. Lead with it.

### Hero image per rung

| Rung | Image |
|---|---|
| X / Alert | `panel-onboard-1.webp` — wide, few words, legible at thumbnail size |
| Bluesky / Post | `panel-onboard-2.webp` — shows the actual work product, 24 books with scene counts |
| Facebook (if used) | `community-project.webp` — most beautiful image in the set |
| Forum / Brief | `website.webp`, then inline the rest |

`panel-onboard-2.webp` is tall and dense — good in a feed that expands images,
poor as a small thumbnail. That's why the two onboarding shots split by channel
rather than both going to the same one.

Also unused and easy adds to the release notes: `ui-nav.webp` and
`subplots-key.webp` both have matching prose in *More Improvements*.

**Editorial choice:** every rung leads with **manuscript onboarding**, not the
Community. Onboarding kills the "I already have a draft somewhere else"
objection, which is the thing actually blocking installs. The Community is the
bigger internal milestone and the weaker external hook — and it currently has
one member.

---

## Alert — X (~150 chars)

`@RadialTimeline` is a **brand** account — no "I". Company voice.

```
Radial Timeline 7.0.0 is out. The Odyssey, imported into Obsidian from a single HTML file — 24 chapters, scenes proposed, all on-device. radialtimeline.com
```

Attach: `panel-onboard-1.webp`.

**Reach check: 0 followers, account opened June 2026.** This rung reaches
nobody today. Post it for the record and for anyone who arrives later, but do
not count X as a launch channel this cycle, and do not spend drafting time here
that the Obsidian forum could use.

---

## Post — Bluesky `@radialtimeline` (brand, ~320 chars)

```
Radial Timeline 7.0.0 is out.

The big one: you can bring an existing manuscript in now. Here's The Odyssey, imported from a single HTML file — 24 chapters found, scenes split, all on my own machine. Scrivener exports and Word docs work the same way.

Also: Word export for agents and editors, and a free Pride & Prejudice demo vault.

radialtimeline.com
```

Attach: `panel-onboard-2.webp`.

## Quote-post — Bluesky `@ericrhystaylor` (personal)

Where the reach actually is: 18 followers vs 0. Quote the brand post, don't
repeat it. First person, and give the angle the company account can't.

**Constraint:** this account is becoming the author platform for *Shail +
Trisan*. Per canon §1, RT may appear here as *process*, never as *product* —
so this is the only RT-adjacent post of the cycle, it carries no version
number or feature list, and it is framed as a writer's story about their own
draft. If 7.1.0 wants the same treatment, the answer is no.

```
Two years ago I started building this because I couldn't see the shape of my own draft.

The part I didn't expect: it now takes someone else's finished manuscript and does the same thing. I fed it The Odyssey to see if it would break. It didn't.
```

No link — the quoted post carries it.

---

## Post — Facebook

**SEQUENCING PROBLEM — read before drafting.** The soft-launch post went to this
same audience on 2026-07-20. A 7.0.0 announcement is the same news to the same
friends. Options, in order of preference:

1. **Skip Facebook for 7.0.0.** The soft-launch post already covered it.
2. Post only if 7.0.0 ships well after the soft launch, and lead with something
   the first post didn't say — onboarding, or the demo vault.
3. Merge: if 7.0.0 ships within days, fold it into the soft-launch post instead
   of publishing twice.

---

## Brief — Obsidian forum + Discord (highest-yield channel)

```
Radial Timeline 7.0.0 is out.

The headline for anyone who's been holding off: you can bring an existing
manuscript in now. Three import lanes — Scrivener exports, a Word .docx, or a
whole book in one file — split into scenes with acts and subplots mapped. As a
test I onboarded The Odyssey from a single Project Gutenberg HTML file: 24
chapters found, scenes proposed inside each one, nothing leaving my machine. It
works with or without AI; the optional local LLM runs on-device, and a
checkpoint review flow means you approve every scene before anything is
written. It's marked Beta and I'd genuinely like people to break it.

Also in 7.0.0: Word (DOCX) manuscript export in standard format for agents and
editors, Timeline Scaffold and Audit for building and repairing scene dates,
and a free Pride & Prejudice demo vault so you can explore every mode with real
material from the first minute.

There's a website with supplemental docs now, and a Community you can connect
the plugin to — opt-in at the source, with a preview of every field before
anything leaves your vault.

Full notes: [GitHub release link]
```

Register is deliberately plainer here than on social — this audience is
technical and reads changelogs for sport. "I'd like people to break it" is the
one wry beat; don't add more.

---

## Brief — beehiiv newsletter

Same as the forum version, minus the Beta-testing ask (wrong audience — readers
aren't testers), plus a closing line. Suggested sign-off from canon §6:

```
Write back.
```

---

## Open items

- [ ] Six release screenshots captured and committed (blocking all social rungs)
- [ ] X handle unknown — Alert rung has nowhere to go until it's supplied
- [ ] Decide Facebook: skip, delay, or merge
- [ ] Confirm whether Community is seeded before the forum post drives traffic
