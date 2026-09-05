# Contributing to Radial Timeline

Thanks for your interest in Radial Timeline. This page explains how to report
problems, suggest features, and — within limits — contribute code.

Radial Timeline is **source-available under a non-commercial license**, not an
open-source project. Please read [`LICENSE`](LICENSE) before contributing. If you
plan to submit code, the [Contributor License Agreement](CLA.md) governs what
happens to the rights in it, and supersedes §5 of the LICENSE for anyone who signs.
The summary below is plain English; those two files are the binding text.

---

## Reporting a bug

Open an issue with the **Bug** label and include:

- Radial Timeline version (Settings → Community plugins, or the plugin's
  Settings tab)
- Obsidian version and installer version (Settings → About)
- Operating system
- Steps to reproduce, and what you expected instead
- Any errors from the developer console (`Ctrl/Cmd+Shift+I` → Console)

A screenshot or short screen recording of the timeline is worth a great deal —
this plugin is visual, and most layout issues are far easier to see than to
describe.

**Please don't include manuscript text you'd rather keep private.** Scene titles
and synopses show up in the timeline and in exports; redact before posting, or
reproduce the problem in a scratch vault.

## Requesting a feature

Open an issue with the **Enhancement** label. Describe the writing problem you're
trying to solve, not only the feature you have in mind — the underlying problem
often has a better solution than the one that first comes to mind, and knowing
the goal lets a smaller change serve it.

## Questions and help

Please use issues for bugs and feature requests rather than usage questions. For
help getting started, see the [wiki](https://github.com/EricRhysTaylor/radial-timeline/wiki).

---

## Pull requests

PRs are welcome. Before writing code:

1. **Open an issue first** for anything beyond a typo or a small fix. Radial
   Timeline has a specific architecture and an opinionated design direction, and
   an early conversation saves you from building something that can't be merged.
2. Expect review to be slow. This is a solo project maintained alongside other
   work.

If you do submit a PR:

- Keep it focused on one change.
- Match the surrounding code — naming, comment density, and idiom.
- `npm run lint` and `npm test` should pass.
- Don't reformat unrelated files or bundle refactors with fixes.

### Sign the CLA

Radial Timeline is owned personally by Eric Rhys Taylor, along with its copyright
registration, registered trademark, and pending patent. Keeping that ownership in
one place is what lets the project be licensed, defended, and — someday, possibly —
transferred as a whole. Code merged without a signed agreement would break that,
permanently and unfixably, since it can only be repaired by tracking down every past
contributor.

So: **before a pull request can be merged, its author signs the
[Contributor License Agreement](CLA.md).** It's one comment on your PR, it takes a
minute, and it covers everything you contribute from then on. Contributing on behalf
of an employer or client? Use [`CLA-ENTITY.md`](CLA-ENTITY.md) instead.

The CLA gives you back a full license to use your own contribution anywhere else,
including commercially. What it doesn't do is give anyone the right to redistribute
Radial Timeline itself — that stays governed by [`LICENSE`](LICENSE), the same for
contributors as for everyone.

### Where your code came from

Two things need saying in the PR itself, because they can't be reconstructed later:

- **Anything you didn't write** — a snippet, a library, an algorithm, an asset —
  name it and name its license. Code under GPL, AGPL, LGPL, SSPL, or another
  copyleft license **can't be accepted**; it's incompatible with this project's
  license, and that's not fixable after a merge.
- **Substantially AI-generated code** — say so. This isn't disapproval; the project
  is built with AI tooling throughout. It's that provenance has to be
  reconstructible, and you're the only one who knows. Review what you submit, and
  don't submit output you have reason to think reproduces someone else's code.

## What isn't permitted

Radial Timeline is not for redistribution. Without written permission, you may
not:

- Redistribute the plugin, modified or unmodified (mirrors, bundles, forks
  published for public use)
- Sell, sublicense, rent, or otherwise commercially exploit the software
- Publish a derivative or substantially similar plugin, product, or service
- Offer it as a hosted, SaaS, or multi-user service
- Use the "Radial Timeline" name, logo, or registered trademark to brand forks,
  distributions, or related products

Reading and modifying the source for your **own private use** is expressly
permitted, as is writing and selling anything you create with the plugin — your
manuscript is entirely yours. See [`LICENSE`](LICENSE) and [`NOTICE`](NOTICE).

For commercial licensing, redistribution rights, or partnerships, contact Eric
Rhys Taylor via the details in [`LICENSE`](LICENSE).

## Security

Please do not open a public issue for a security vulnerability. Report it
privately to the address in [`LICENSE`](LICENSE) so a fix can ship before
details are public.
