# Code Standards

Use this document for general coding rules. For settings UI, modal UI, and shared shell architecture, read `ui-architecture.md` first.

## Current vs Legacy
- **Current**: shared UI shell work is ERT-first.
- **Legacy / tolerated**: `rt-*` still exists in domain-specific and migration areas.
- **Do not treat** older `rt-*` UI guidance as the default for new shared shell work.

## SAFE Comment Markers
When code intentionally violates a checker rule for a valid reason, annotate it:
- `// SAFE: inline style used for [reason]`
- `// SAFE: any type used for [reason]`
- `// SAFE: Modal sizing via inline styles (Obsidian pattern)`

These comments document intent and keep automated checks honest.
`SAFE` markers do NOT apply to `innerHTML`/`outerHTML` — see DOM and Security.

## DOM and Security
- Never use `eval()` or `new Function()`.
- Never assign `innerHTML` or `outerHTML` — no exceptions, no `SAFE` markers.
  The Obsidian plugin scanner treats any `innerHTML` assignment as a hard
  error regardless of comments or content provenance (escalated from
  warning to error in the scanner ruleset, June 2026).
- For trusted serialized SVG, use the helpers in `src/utils/svgDom.ts`
  (`renderSvgFromString` for the main timeline, `mountSvgMarkup` for
  previews/icons) — they go through `DOMParser` + `importNode`.
- Prefer DOM creation APIs and text content assignment.

## Styling
- Shared settings/modal shell work should use ERT classes and ERT scopes.
- New shared shell work should not introduce new `rt-*` patterns.
- Existing `rt-*` domain classes may remain in legacy or domain-specific areas until deliberately migrated.
- Inline styles remain banned except where Obsidian requires them, primarily modal sizing on `modalEl`.

## Naming Policy
- **Current**: reusable shell/archetype classes use `ert-*`.
- **Legacy / tolerated**: `rt-*` remains in domain islands and old UI surfaces.
- **Current rule**: do not add new shared shell patterns under `rt-*`.
- **Current rule**: do not use feature-specific `ert-*` names as if they were shared primitives.

## Modal Implementation
Current modal contract:
- add `ert-ui`, `ert-scope--modal`, and `ert-modal-shell` to `modalEl`
- add `ert-modal-container` to `contentEl`, usually with `ert-stack`
- apply width/height to `modalEl` via inline styles when needed
- do not style `containerEl`

Example:

```ts
if (modalEl) {
  // SAFE: Modal sizing via inline styles (Obsidian pattern)
  modalEl.classList.add('ert-ui', 'ert-scope--modal', 'ert-modal-shell');
  modalEl.style.width = '720px';
  modalEl.style.maxWidth = '92vw';
}

contentEl.addClass('ert-modal-container', 'ert-stack');
```

Deprecated guidance:
- pre-ERT `rt-pulse-modal-shell` / `rt-gossamer-*` modal shell rules are no longer the shared default
- they may still exist in legacy modals, but should not be presented as current architecture

## Obsidian API Usage
- Use `requestUrl()` instead of `fetch()` for network requests.
- Use `app.vault` APIs instead of `vault.adapter.*` or Node `fs` in runtime plugin code.
- Prefer `openOrRevealFile()` or `workspace.openLinkText()` over raw `openFile()` when duplicate tabs are not wanted.

## Timers and Lifecycle
- Prefer `window.setTimeout()` / `window.clearTimeout()`.
- Use Obsidian lifecycle registration patterns first.

## Verification
Before shipping meaningful changes:
- run `npm run verify` for the full build + standards + tests path
- run `npm run css-drift -- --maintenance` when touching shared CSS

For UI and CSS enforcement details, see `css-guidelines.md`.
