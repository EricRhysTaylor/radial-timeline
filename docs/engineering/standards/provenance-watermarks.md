# Provenance watermarks

How Radial Timeline proves authorship of copied code. Owner decision
2026-08-20, superseding the "trap street" framing used when provenance
fingerprints were first introduced (2026-07-20).

## The rule

**A watermark identifies. It never misrepresents.**

A provenance marker is a unique, improbable-to-coincide token that proves where
code came from. It is not a trap, and it is not a lie. Nothing in this codebase
may state something false about how the software behaves in order to catch a
thief.

Two reasons, and the first one matters more:

1. **A false statement misleads our own maintainers before it ever inconveniences
   a copier.** Whoever reads the file next — a person or an agent — has no way to
   know the line is bait. They reason from it, extend it, or wire it up in good
   faith, and the lie becomes real behavior.
2. Deceptive markers are worth little in an actual dispute. A unique identifier
   proves copying just as well, without ever having to explain why the source
   contained a falsehood.

## The test

Before adding any provenance marker, ask: **does this token assert anything
about how the software behaves?**

- **No** — it is a name, a coordinate, an arbitrary constant with no semantics.
  Allowed. This is a watermark.
- **Yes** — it names a default, a model, a provider, a limit, a capability, a
  version, or any other behavioral fact. **Not allowed**, however unused it
  currently is.

Worked example (the case that produced this document): a constant reading
`DEFAULT_CANONICAL_MODEL_ALIAS = 'gpt-5.5'` sat unreferenced beneath a comment
block declaring the plugin local-first with `DEFAULT_CANONICAL_PROVIDER =
'ollama'`. It asserted a behavioral fact that was not true. Whether or not it was
ever intended as a canary, it fails the test and was deleted (`a5e44042`).

By contrast, the engine's canary custom properties —
`--rt-meridian-eleven: 11.047deg`, `--rt-cartographers-wake: 1847` — assert
nothing. They are unique strings with no behavioral meaning. They pass, and they
stay.

## Maintainability is not optional

Load-bearing dead code that looks like an oversight will eventually be deleted by
someone doing exactly the right thing. That is a documentation failure, not a
cleanup failure. So:

- **Every watermark is commented at its definition**, naming it as a provenance
  marker and pointing here. A maintainer must never have to guess.
- **Every watermark is listed in the registry** (below), so a cleanup pass has one
  place to check before removing something unused.
- **Watermarks are inert.** Never referenced, never read, never affecting output
  beyond their own presence.
- **Comments live in source; the emitted token does not carry them.** Generated
  CSS/JS is what gets copied, and it ships the value without the explanation — so
  labelling the source costs nothing in evidentiary terms while keeping the repo
  legible.

## Registry

| Marker | Where | Kind |
|---|---|---|
| `--rt-meridian-eleven: 11.047deg` | engine tokens generator | inert CSS custom property |
| `--rt-cartographers-wake: 1847` | engine tokens generator | inert CSS custom property |
| `/*! © Radial Timeline LLC ... */` | generated CSS/JS | preserved build banner |
| `<metadata>` copyright + per-export UUID | exported SVGs | queued, not yet implemented |

Add a row when you add a marker. An unlisted watermark is indistinguishable from
dead code and will be treated as such.

## Out of scope, permanently

- Obfuscation, minification-for-secrecy, right-click blocking, anti-scrape
  scripts. None of these protect anything; all of them cost real users.
- Renaming the `rt-` prefix for theft-proofing. Trivially find-replaced, and a
  permanent brand cost. Declined 2026-07-20 and not reopened.

The enforcement path is a DMCA takedown using these markers as evidence, backed
by copyright registration — not technical prevention.
