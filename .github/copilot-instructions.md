# Copilot Repository Instructions

Use these notes so Copilot stays aligned with the Radial Timeline Obsidian plugin.

## Project primer
- TypeScript Obsidian plugin with heavy SVG/D3 rendering; entry point `src/main.ts`.
- Styles live in `src/styles/*.css`; release bundle outputs to `release/`.
- Install deps with `npm install`. Run `npm run dev` for watch, `npm run build` for prod, `npm run standards` for full checks, `npm run scripts` to list tasks.

## Do
- Scope ALL CSS with `rt-` or `radial-timeline-` prefixes; avoid global selectors and Obsidian core/plugin-list selectors. Prefer container-scoped selectors like `.radial-timeline-container .rt-*`.
- For modals: add `rt-pulse-modal-shell` to `modalEl`, `rt-pulse-modal` to `contentEl`; size with inline width/maxWidth/maxHeight using the required comment `// SAFE: Modal sizing via inline styles (Obsidian pattern)`.
- Use `requestUrl` (not `fetch`/`XMLHttpRequest`) for network calls. Use `app.vault` APIs (not Node `fs`) for file access. Use `workspace.openLinkText`/`openOrRevealFile` for opening files.
- Register lifecycle hooks: `registerDomEvent`/`registerEvent`/`registerInterval` in plugin/views; in modals clean up timers/observers in `onClose`.
- Prefer shared helpers and CSS variables; reuse existing `rt-*` classes before adding new ones. Add `SAFE:` markers when intentionally bypassing automated checks.
- Run `npm run standards` before shipping; it enforces API, CSS prefixing, and duplicate-selector checks.

## Do NOT
- No `innerHTML`/`outerHTML` without a `// SAFE:` rationale; avoid runtime `<style>` injection and inline styles (except modal sizing noted above).
- No console logging in shipped plugin code; use `plugin.log()` temporarily and remove before release.
- Do not store persistent view references; query with `getLeavesOfType()`.
- Do not add secrets/keys/tokens anywhere in the repo.

## Security & data
- Never commit API keys; prefer settings/Keychain storage. Sanitize user input and escape SVG text. Respect the non-commercial license.

## Context tips
- Recent issue: Obsidian plugin list style bleed. Keep selectors namespace-safe (`rt-`/`radial-timeline-`) and avoid bare tag/class selectors that could touch core UI.
- Gossamer scoring: `Gossamer1` is oldest; higher numbers are newer and appended sequentially.

