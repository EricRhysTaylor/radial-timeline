# CSS Guidelines

Use this document together with `ui-architecture.md`. This page explains current CSS scope boundaries and what the repo actually enforces today.

## Current Scope Contract

### Settings root
Shared settings shell CSS belongs under:
- `.ert-ui`
- `.ert-scope--settings`
- `.ert-settings-root` when the rule is specific to the settings subtree

### Modal root
Shared modal shell CSS belongs under:
- `.ert-ui`
- `.ert-scope--modal`
- `.ert-modal-shell`
- `.ert-modal-container`

Do not mix settings-root selectors and modal-root selectors casually. They are separate scopes with different shell expectations.

## File Ownership
- `src/styles/rt-ui.css`
  Active shared ERT shell, archetypes, tokens, skins, and current settings/modal contracts.
- `src/styles/settings.css`
  Minimal Obsidian wiring and narrow settings glue.
- `src/styles/modal.css`
  Legacy/supporting modal selectors still in use, but not the primary source of modal shell architecture.
- `src/styles/legacy/*.css`
  Legacy islands and extracted migration selectors.

## Current Naming Reality
- **Standard**: new UI classes default to `ert-*`.
- **Default rule**: new app chrome should not introduce new `.rt-*` classes.
- **Legacy / tolerated**: existing `.rt-*` classes still exist in renderer/domain islands and legacy files.
- **Exception rule**: extending a legacy island may still use `rt-*`, but only when that island is explicitly allowlisted.
- **Rule of thumb**: if you find yourself writing `.rt-` for a new selector, stop and check whether you are building chrome or extending a legacy renderer primitive.

See:
- [css-namespace-policy.md](/Users/ericrhystaylor/Documents/RT%20LLC/CodeBase/radial-timeline/docs/engineering/standards/css-namespace-policy.md)
- [css-namespace-allowlist.json](/Users/ericrhystaylor/Documents/RT%20LLC/CodeBase/radial-timeline/scripts/css-namespace-allowlist.json)

## Surface Treatment Doctrine

Glow is not a default surface treatment.

Build hierarchy with borders, contrast, spacing, and typography first.
Only hero surfaces (`.ert-card--hero`, `.ert-section--hero`) may use restrained atmospheric lift — a subtle shadow or faint accent gradient.
All other surfaces — workflow panels, settings rows, modal internals, pills, badges, nested containers — stay flat.

Prohibited on non-hero surfaces:
- `box-shadow` with blur > 0 (rings `0 0 0 Npx` are fine)
- `text-shadow`
- `drop-shadow()` filter
- large warm gradients (`> 10%` accent opacity) on panel backgrounds
- `::before` / `::after` pseudo-element wash overlays that create ambient bloom

Allowed everywhere:
- border (solid, dashed, color-mixed)
- background color (flat, via token)
- `inset 0 1px 0` hairline highlights (≤ 4% opacity)
- `0 0 0 Npx` focus/state rings
- `backdrop-filter: blur()` only on modal shells and locked-content overlays

Hero surfaces may use:
- `--ert-shadow-hero` (currently `0 4px 12px` at ≤ 20% opacity)
- `--ert-hero-grad` (restrained radial + linear, ≤ 14% accent hotspot)
- accent-tinted `--ert-surface-hero` background (≤ 8% accent mix)

When in doubt, leave the surface flat. If a surface needs emphasis, reach for a stronger border or typographic weight before adding a shadow.

## Spacing and Layout
- stacks own spacing
- row/control archetypes own alignment
- margins are exceptions, not the default
- prefer ERT tokens and layout primitives over one-off wrappers

## Timeline Hover Performance (no blur or animation near scene hover)

Verified by hard experience (2026-07, subplot ring key): any blur or
animation on or near the timeline's scene-hover path measurably slows
hover for everyone.

- **No `backdrop-filter`/`filter` on chrome overlaying the timeline SVG.**
  A filter layer re-blurs on every underlying repaint (scene hover repaints
  the whole SVG) and can stay resident even after the element hides via
  `opacity: 0`.
- **No `transition`/`animation` on chrome whose state is coupled to scene
  hover** (e.g. rules keyed off `.scene-hover`). Transitions fire on every
  hover enter/leave. Show/hide instantly; hide with `display: none`, not
  `opacity: 0`.
- **No `:has()` anchored on the timeline container** — it forces wide style
  invalidation on every class toggle inside the SVG. Use sibling combinators
  from `.radial-timeline-svg` instead.

## Token Scope (read before writing CSS for any new surface)

`--ert-gap-*` and `--ert-pad-*` are defined **only** inside `.ert-ui`
(see `src/styles/rt-ui.css` line 1) — not on `:root`. CSS custom
properties only cascade to descendants of the element where they're
declared. **Any UI surface without an `.ert-ui` ancestor cannot read
these tokens.** When a CSS rule references `var(--ert-gap-cozy)` in
such a surface, the variable is undefined, the entire property
declaration is invalid, and the property silently falls back to its
initial value — for `padding` and `gap` that's `0`. The rule looks
correct but produces nothing.

**Body-portaled surfaces that have NO `.ert-ui` ancestor:**
- `.ert-timeline-session-panel` (the writing-session popover; appended
  to `document.body`)
- Any other element created via `document.body.appendChild(...)` or
  any portal that bypasses the settings/modal shells

**For those surfaces, use Obsidian's global tokens:**
- spacing: `--size-4-1` (4px), `--size-4-2` (8px), `--size-4-3` (12px),
  `--size-4-4` (16px); `--size-2-1` through `--size-2-3` for finer
  increments
- radius: `--radius-s`, `--radius-m`, `--radius-l`
- colors: `--background-*`, `--text-*`, `--color-*`, `--background-modifier-*`

`scripts/css-drift-check.mjs` fails the build when `var(--ert-gap-*)`
or `var(--ert-pad-*)` is used inside a rule whose selector is on the
body-portal allowlist (`BODY_PORTAL_SELECTORS`). Add new portal-mounted
chrome to that allowlist when you create it.

**Debugging "my CSS isn't applying" (start here, not last):**
1. Open the element in the inspector. If `padding` / `gap` computes to
   `0`, it's almost certainly a token-scope bug — `var(...)` is undefined.
2. Replace one `var(--ert-...)` reference with a literal (e.g. `12px`)
   in source, build, reload. If the literal renders, the tokens are out
   of scope. Switch to `--size-4-*`.
3. Only after ruling out token scope, suspect specificity / cascade.

## Current Enforcement

### Verified by `npm run verify`
`npm run verify` currently runs:
1. `npm run build`
2. `npm run css-drift -- --maintenance`
3. standards checks
4. tests

### CSS drift checks
`scripts/css-drift-check.mjs` currently checks:

**Fail**
- `!important`
- unscoped global element selectors
- unscoped Obsidian selectors like `.setting-item` or `.modal`
- skin overreach (`.ert-skin--*` changing layout/typography instead of visual treatment)
- `.rt-*` selectors inside `src/styles/rt-ui.css`
- `.rt-*` selectors in any file listed under `rtCleanFiles` in the allowlist
  (`rt-clean-backslide` — backslide guard for files that finished migrating)

**Warn in maintenance/migration modes**
- raw hex colors outside token lines
- legacy `.rt-*` selectors outside `rt-ui.css` (excludes `apr-rt-*` branding and
  `--rt-*` variable references — those are not legacy selectors)
- literal `px` spacing
- raw `rgba()` shadows

The `rt-legacy` WARN count is mostly the permanent renderer-SVG island, not a
backlog. See [css-drift-debt.md](css-drift-debt.md) for the island-vs-stragglers
split and [css-namespace-policy.md](css-namespace-policy.md) for why the island
stays `rt-*`.

This is the live behavior today. It is not a theoretical future gate.

## Additional Locks

### Inquiry lock
`scripts/check-inquiry-ert-lock.mjs` blocks `ert-inquiry-*` tokens in:
- `src/settings/**`
- `src/modals/**`
- `src/styles/rt-ui.css`

### Social lock
`scripts/check-social-ert-lock.mjs` blocks new `rt-*` backslide in specific Social settings render files, with a very small allowlist.

### Timeline chrome lock
`scripts/check-timeline-chrome-ert-lock.mjs` blocks new non-allowlisted `rt-*` class creation in Timeline view chrome.
This is intentionally narrower than the renderer island itself:
- new Timeline legends, panels, badges, overlays, and other chrome should use `ert-timeline-*`
- existing SVG renderer primitives may still remain `rt-*` inside the allowlisted legacy island

## Current vs Target-State Guidance
- **Current / enforced**: scope under `.ert-ui`, avoid `!important`, do not add `.rt-*` to `rt-ui.css`.
- **Current / enforced**: settings and modals use separate ERT scope roots.
- **Target-state guidance**: migrate app-chrome stragglers off `.rt-*`; the
  renderer-SVG island stays `.rt-*` permanently (it is the SVG contract).
- **Tolerated migration reality**: legacy selectors still exist outside `rt-ui.css`,
  predominantly in the blessed renderer island.

## Practical Review Checklist
- Is the selector scoped under the correct ERT root?
- Is this settings CSS or modal CSS?
- Is this shared shell work or a legacy/domain island?
- Could this reuse an existing ERT archetype instead of inventing a wrapper?
- Does this avoid `!important` and preserve theme-native surfaces?
