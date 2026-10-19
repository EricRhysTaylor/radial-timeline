# Tooltip ownership audit — 2026-10-19

The audit covers all 678 production TypeScript files outside translation catalogs,
including Timeline, Timetable, Inquiry, settings, modals, publishing previews,
scene-time rulers, session logs, and community controls.

## Findings and corrections

Controls combined native browser `title` attributes with Obsidian hover labels.
SVG time-reference controls also combined `<title>` with the custom tooltip
renderer. Many accessible names were consequently exposed as unnecessary hover
text, and several explicit tooltips repeated the visible label or icon action.

- HTML names now use hidden labels and `aria-labelledby`, independently of hover
  help. Names survive icon replacement; dynamic names reuse the same label.
- All explicit HTML help uses one adapter. It removes browser/custom tooltip
  ownership and suppresses text equal to the visible label. Component helpers
  retain the original component and its fluent API.
- Removed action-name tooltips such as Rename, Add profile, New sketch, and
  Timeline actions. Kept explanations of scope, consequences, warnings, and
  shortcuts. Dynamic font warnings clear through the same adapter.
- SVG descriptions replace native hover titles. Custom setup normalizes old
  tooltip attributes, preserves cursor/offset placement, and supplies accessible
  names. HTML hover help inside an SVG target takes precedence over its parent.
- Inquiry icon buttons now retain the supplied accessible name without creating
  a name-only tooltip. Detached title-bar icon buttons are named after painting
  their icons; detached input/select controls are named after attachment.
- Custom tooltip text, titles, and body copy use Obsidian's paired tooltip colors.
  Light-theme review exposed the old dark-text-on-dark-background combination.

No persistence schema, translation wording, commands, or manuscript files change.

## Verification

`SKIP_BACKUP=1 npm run verify` passes: production build, script typecheck, CSS drift,
standards/compliance, CSS duplicate checks, and 4,765 passing tests (35 skipped).
`npm run lint:obsidian` passes with zero selected-rule violations.

Sixteen new regression cases cover accessible-only names, repeated updates,
void controls, component chaining, redundant text, nested hidden/SVG content,
help replacement/clearing, SVG names/placement, parent-child renderer ownership,
and a production-wide AST guard against bypassing these adapters.

Native review used Obsidian 1.14.4 in the separate Output QA Vault:

- Populated Progress and Narrative timelines, normal main-view width and a
  300-pixel sidebar, in light and dark themes.
- Publishing settings and Create note family choices, including cancellation.
- The Gossamer empty prerequisite state correctly refuses entry when no story
  beats exist. A populated Gossamer analysis was not staged.
- Inspected actual DOM ownership: zero browser/Obsidian or custom/Obsidian
  collisions, zero SVG aria-labels, and no native titles in the inspected plugin UI.
- Exercised native pointerover and custom mouseover handlers through the QA
  DevTools console. Screenshots confirm a single retained shortcut tooltip and
  a single custom SVG explanation. These dispatched events supplement native
  navigation and visual inspection; they are not an exhaustive hover of every
  control or a screen-reader session.

Screenshots and runtime inspection records remain outside this public repository
in the local `2026-10-19 Radial Timeline tooltip QA` Agent Runs folder. QA layout,
theme, and plugin settings are restored after verification. Author manuscript
content was neither changed nor used for fixtures.
