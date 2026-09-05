# UI Architecture Standards

## Source of Truth
This document is the canonical source of truth for the live shared UI shell used by Radial Timeline settings and modals.

Read this first before changing:
- settings UI
- modal UI
- shared ERT layout primitives
- shared UI shell CSS in `src/styles/rt-ui.css`

This document describes the codebase as it exists today. It is not a future-state plan.

Status language:
- **Current**: active contract used by live code
- **Legacy**: older patterns still present in runtime code
- **Tolerated**: allowed during migration, but not the default for new shared shell work

## Current UI Architecture Summary
- **Current**: shared shell work is ERT-first.
- **Current**: settings and modals are rooted in `.ert-ui`.
- **Current**: `src/styles/rt-ui.css` owns the shared ERT shell, archetypes, tokens, and skins.
- **Current**: `src/styles/settings.css` is minimal Obsidian/settings wiring only.
- **Current**: `src/styles/modal.css` still exists, but shared modal shell rules now live primarily in `rt-ui.css`.
- **Legacy / tolerated**: `rt-*` classes still exist in domain-specific islands and legacy CSS files.
- **Not current**: old “shared shell defaults to rt-*” guidance.

## Settings Root Contract
Settings UI should be rooted with:
- `ert-ui`
- `ert-settings-root`
- `ert-scope--settings`

Current expectations:
- `.ert-ui` scopes the ERT system.
- `.ert-scope--settings` selects the settings surface contract.
- `.ert-settings-root` identifies the settings subtree used by ERT layout and visibility helpers.

Do not style raw Obsidian settings selectors globally. Shared settings CSS should target the scoped ERT root.

## Modal Root Contract
Modals should be rooted with:
- `ert-ui`
- `ert-scope--modal`
- `ert-modal-shell` on `modalEl`
- `ert-modal-container` on `contentEl`

Current expectations:
- `modalEl` gets shell classes and inline width/height sizing when needed.
- `contentEl` gets `ert-modal-container`, usually with `ert-stack`.
- modal content builds inside the ERT shell rather than inventing one-off wrappers for common layout.

## Shared ERT Primitives
These are the active shared archetypes.

- `ert-panel`
  Shared bordered surface/card shell.
- `ert-stack`
  Vertical rhythm container. Owns spacing between children.
- `ert-row`
  Shared row layout. Use for settings-style rows and paired label/control layouts.
- `ert-control`
  Shared control slot inside rows and headers.
- `ert-header` / `ert-header2`
  Shared heading wrappers applied by `applyErtHeaderLayout()`.
- `ert-previewFrame`
  Shared preview surface for read-only or mock-preview content.

Prefer these primitives over feature-specific wrappers when the layout problem is generic.

## Header Rules
- **Current**: top-level settings headings use `Setting.setHeading()`.
- **Current**: internal card/panel headings use `ert-section-title` and `ert-section-desc`.
- **Current**: `applyErtHeaderLayout()` is the contract for converting a `Setting` heading/row into the ERT header structure.
- **Current**: `ert-header` is the primary heading wrapper.
- **Current**: `ert-header2` is used when a description/body block is part of the same header structure.

Practical rule:
- use `Setting.setHeading()` for section starts
- use `ert-section-title` / `ert-section-desc` inside cards, panels, and nested containers
- do not invent bespoke heading wrappers when `applyErtHeaderLayout()` fits

## Naming Policy
- **Current**: shared shell and shared archetypes use `ert-*`.
- **Current**: `rt-*` is legacy or domain-specific, not the default for new shared shell work.
- **Current**: new shared shell work should not add new `rt-*` patterns.
- **Current target policy**: feature/location-specific `ert-*` names are not the preferred shape for reusable shell work.
- **Tolerated current reality**: some feature/location-specific `ert-*` classes already exist during migration and in local UI modules.
- **Allowed**: domain tokens such as `--ert-inquiry-*` when they are truly domain variables rather than shared shell archetypes.

Practical rule:
- if the class is a reusable shell/archetype, make it generic `ert-*`
- if the code is legacy or domain-specific, existing `rt-*` may remain until deliberately migrated
- do not treat `rt-*` as the pattern for new shared settings/modal shell work

For view-specific exceptions and allowlisted legacy islands, see:
- [css-namespace-policy.md](/Users/ericrhystaylor/Documents/RT%20LLC/CodeBase/radial-timeline/docs/engineering/standards/css-namespace-policy.md)
- [css-namespace-allowlist.json](/Users/ericrhystaylor/Documents/RT%20LLC/CodeBase/radial-timeline/scripts/css-namespace-allowlist.json)

## Spacing Policy
- **Current**: stacks own spacing.
- **Current**: gaps and padding tokens define rhythm.
- **Current**: margins are exceptions, not the default.

Use:
- `ert-stack`
- `ert-row`
- ERT spacing tokens such as `--ert-row-gap`, `--ert-row-pad`, `--ert-group-gap`

Avoid:
- ad hoc margin ladders
- inline spacing
- one-off wrapper divs created only to add space

## Enforcement Summary
Current enforcement comes from code and scripts, not just docs.

- `npm run verify`
  Runs build, CSS drift, standards checks, and tests.
- CSS drift
  `scripts/css-drift-check.mjs` checks `rt-ui.css`, `settings.css`, `modal.css`, and legacy CSS files.
- Inquiry lock
  `scripts/check-inquiry-ert-lock.mjs` blocks `ert-inquiry-*` tokens in settings/modals TS and `rt-ui.css`.
- Social lock
  `scripts/check-social-ert-lock.mjs` blocks new `rt-*` backslide in specific social settings render files.
- Timeline chrome lock
  `scripts/check-timeline-chrome-ert-lock.mjs` blocks new non-allowlisted `rt-*` class creation in Timeline view chrome.
- `!important`
  Banned by the CSS drift check.

## Current Migration Reality
- **Current**: the shared shell is ERT-first.
- **Current**: shared settings/modal work should start from ERT primitives and scopes.
- **Legacy / tolerated**: selective `rt-*` and domain-specific islands still exist in runtime code and legacy CSS.
- **Legacy / tolerated**: older docs and older feature shells may still reference pre-ERT patterns.
- **Do not assume**: every `rt-*` selector is already migrated.

Practical conclusion:
- for new shared shell work, follow ERT
- for legacy `rt-*` islands, do not expand them casually
- when touching migration areas, prefer moving toward ERT instead of creating parallel systems
