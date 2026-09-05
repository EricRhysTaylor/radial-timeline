Use this guide whenever you create or update wiki pages.

## Core Rules

- Write for authors, not for developers.
- Start with useful content immediately.
- Keep pages concise, specific, and product-facing.
- Prefer one canonical page per topic. Link to it instead of re-explaining it elsewhere.

## Page Openings

- Do not repeat the page title inside the page body.
- GitHub already renders the page title from the wiki page name.
- Do not start pages with duplicate H1 headings like `# Manuscript export` or bold hero titles that repeat the page name.
- Do not open with filler such as:
  - `This page covers...`
  - `This page is...`
  - `Use it when you want...`
  - `The purpose of this page is...`
- Open with the first useful sentence or the first useful section.

## Tone

- Use direct, plain language.
- Avoid maintenance-speak, wiki-speak, and meta commentary.
- Avoid vague claims like `powerful`, `robust`, `flexible`, or `intuitive` unless the sentence explains something concrete.
- Avoid bloated contrast phrases like `instead of working scene-by-scene in the timeline` unless that contrast is actually necessary.

## Canonical Pages

Use one page as the source of truth for each topic.

- `Narrative Mode` owns:
  - Saga scope
  - chapter and part placards
  - dominant subplot behavior
- `Inquiry` owns:
  - Inquiry mechanics
  - Minimap
  - Corpus Manager
  - Briefing Manager
  - AI Engine Popover
  - prompts and briefings
- `Publishing` owns:
  - publishing structure
  - Book Details / Book Pages behavior
  - template behavior
  - chapter and part export semantics
- `AI Pulse Triplet Analysis` owns:
  - what Pulse is
  - supported providers
  - manuscript vs subplot pulse concepts
- Settings tab pages own:
  - their full tab documentation
  - do not duplicate full tab content in `Settings.md`

Secondary pages should summarize in one line and link to the canonical page.

## Settings Pages

- `Settings.md` is an index, not a full settings manual.
- Each settings tab should have its own destination page.
- Do not maintain a long anchor-based mini-manual inside `Settings.md`.
- Do not duplicate the same tab explanations in multiple pages.
- If a settings topic already has a full page, point to that page from the sidebar and from cross-links.

## Command Pages

- Command pages should describe the command itself:
  - what opens
  - what the user can do there
  - any prerequisites or feature gates
- Do not re-explain the entire feature area if a canonical page already exists.
- Use command pages for command-specific behavior, not for full concept docs.

## Links

- Use human-readable link labels.
- Do not expose slug text, raw anchors, or ugly filenames in visible link text.
- Bad:
  - `Publishing#setting-up-modern-classic`
  - `How-to#manage-subplots-in-bulk`
  - `Radial-Timeline-View`
- Good:
  - `Publishing`
  - `Manage subplots`
  - `Radial Timeline View`
- Sidebar links must look professional:
  - no visible `#anchors`
  - no visible hyphenated slugs
  - no raw `[[wiki-links]]`
- Verify both page links and anchor links before publishing.

## Terminology

- Match the UI and command palette exactly.
- If the command palette says `Book designer`, the docs should not rename it to something else.
- Prefer Obsidian-friendly user language:
  - `command panel` or `panel` for command-launched surfaces
  - `popover` only when the UI actually uses a popover
- Avoid technical UI terms like `modal` in user-facing docs unless there is a strong reason.
- Use current product terminology consistently:
  - `Scene properties`, `Core properties`, `Advanced properties`
  - not `scene set`, `advanced scene set`, or similar stale labels

## Images And Screenshots

- Prefer current screenshots over old ones.
- Replace stale screenshots instead of keeping both.
- Put screenshots where they support the nearby explanation.
- Do not add images as decoration only.
- If a screenshot becomes obsolete, remove or replace it.

## Repetition

- Do not say the same thing in:
  - `Views`
  - `Radial Timeline View`
  - `Timeline Modes`
  - `Narrative Mode`
  unless each page adds distinct value.
- Keep overview pages short.
- Keep index pages short.
- Push operational detail downward into the specific page that owns it.

## Accuracy

- Document only current behavior.
- Remove stale guidance when product behavior changes.
- Do not leave legacy language behind after a feature change.
- If a feature is beta-only or not in release builds, say so clearly.
- If Core vs Pro behavior changes, update all related pages and screenshots together.

## Formatting

- Use short sections and short paragraphs.
- Prefer bullets for options, behaviors, and checklists.
- Avoid walls of text.
- Avoid decorative emphasis unless it adds clarity.
- Keep keyboard shortcut formatting consistent:
  - `Cmd + P`
  - `Ctrl + P`

## Before Publishing

Check these every time:

- no repeated page title inside the page body
- no filler opening lines
- no duplicate explanations across related pages
- no visible slug-style links
- no broken page links
- no broken anchor links
- screenshots are current
- terminology matches the current UI
