# Prompt: Biweekly Obsidian Ecosystem Audit

You are running the **Biweekly Obsidian Ecosystem Audit** for the Radial
Timeline plugin. Your job is to surface places where the plugin lags
current Obsidian plugin best practices, and to recommend *modernization
opportunities* — not automatic rewrites. You do **not** modify product
code.

## Before you begin

Read:

- `docs/engineering/INDEX.md`
- `docs/engineering/standards/ui-architecture.md`
- `docs/engineering/standards/code-doctrine.md`
- `docs/engineering/standards/css-namespace-policy.md`
- `docs/engineering/standards/css-guidelines.md`
- `docs/engineering/audits/README.md`
- `manifest.json` (note `minAppVersion`)
- `package.json` (note the installed `obsidian` types version)

Template:
`docs/engineering/audits/templates/obsidian-ecosystem-report.md`. Save
to `docs/engineering/audits/reports/YYYY-MM-DD-obsidian-ecosystem.md`.

## Web access policy

If your runtime has web access available:

- Consult the latest Obsidian developer documentation at
  https://docs.obsidian.md/ and the official sample plugin at
  https://github.com/obsidianmd/obsidian-sample-plugin.
- Cite the source URL and the date you fetched it for every external
  claim.

If your runtime does **not** have web access:

- Do not fabricate URLs or version numbers.
- Base findings only on `node_modules/obsidian/obsidian.d.ts`,
  `manifest.json`, the project's own CSS variable usage, and the source
  tree.
- Mark every finding that *would* benefit from external verification with
  **"requires verification"** so the human reviewer knows what to check
  manually.

## Scope and checklist

Inspect each area below. For each, cite the relevant files/lines and the
relevant Obsidian API surface used.

1. **Plugin lifecycle** — `onload`/`onunload` symmetry. Every
   `registerEvent`, `registerDomEvent`, `registerInterval`, and command
   bound in `onload` should be torn down (Obsidian's `register*` helpers
   handle this automatically — flag any manual `addEventListener` that
   isn't wrapped).
2. **Workspace lifecycle** — `ItemView` `getViewType`, `getDisplayText`,
   `getIcon`, `onOpen`/`onClose`. Flag any view that mutates external
   state in `onOpen` without cleanup in `onClose`.
3. **Commands** — registered via `addCommand` with stable `id`s, scoped
   correctly (`editorCallback` vs `callback` vs `checkCallback`), and
   discoverable in the command palette.
4. **Settings tab** — `PluginSettingTab` structure, `Setting` builder
   usage, persistence via `loadData`/`saveData`, no leaks of secrets to
   console, debounced writes on busy controls.
5. **Editor / CodeMirror** — any direct CM6 usage. Confirm extensions
   are registered via `registerEditorExtension` and disposed correctly.
   Flag direct DOM mutation of the editor surface.
6. **CSS variables** — use of Obsidian theme variables (`--background-*`,
   `--text-*`, `--interactive-*`, `--font-*`). Hard-coded colors are a
   modernization flag, especially in components that should respect user
   themes.
7. **Mobile compatibility** — `manifest.json` `isDesktopOnly`. If false,
   verify no Node-only APIs (`fs`, `path`, `child_process`) leak into
   product code paths reachable on mobile. Flag heavy synchronous work
   on the main thread that would jank mobile.
8. **File operations** — uses of `vault.read`, `vault.modify`,
   `vault.process`, `vault.adapter.*`. Recommend `vault.process` for
   concurrent-safe edits where applicable.
9. **Metadata cache** — using `metadataCache` rather than re-parsing
   frontmatter; subscribing to `changed`/`resolve` events appropriately.
10. **Performance expectations** — no blocking work in `onload`, no
    full-vault scans on startup, debounced/throttled event handlers,
    lazy view registration.
11. **`app.css` vs `styles.css`** — there is a large `app.css` in the
    repo root and a built `styles.css`. Confirm production CSS pipeline
    is what ships and that `app.css` isn't bundled accidentally.
12. **Manifest hygiene** — `minAppVersion` is current, `id` is stable,
    `description` matches README, `fundingUrl` (if any) is correct.

## Rules

- Cite file paths with line ranges and the Obsidian API touched.
- Distinguish **Confirmed** from **Hypothesis** from **Requires
  verification** (used when web access was unavailable).
- Each finding includes: **risk**, **effort**, **confidence**, **suggested
  next action**, **category** — for this audit, expect mostly
  `modernization` and occasionally `doctrine correction`.
- Recommend the smallest meaningful upgrade. Do not propose adopting
  every new API just because it exists.
- Include a **"Do Nothing / Monitor"** section.

## Product Doctrine Check

Re-evaluate against:

- Author trust
- Non-destructive workflows
- Core vs Pro gating consistency
- Terminology consistency
- Obsidian-native behavior
- Manuscript safety
- Export safety
- AI analysis vs AI prose rewriting

Native-behavior misses (e.g. custom keybindings that fight Obsidian's,
modals that don't respect Esc, settings UI that doesn't match Obsidian
conventions) are auto-promoted to **ORANGE**.

## Output

Fill the template. Number findings as `OE-YYYY-MM-DD-#N`. Under 800
lines.

## OUTPUT FORMAT

Primary output must always be valid Markdown suitable for:
- git versioning
- long-term archival
- code review
- diffing

**HTML rendering for this cadence: DISABLED by default.** Biweekly
Obsidian Ecosystem reports are routine. If this particular run is being
done as part of a milestone / RC-readiness review (the human reviewer
will say so explicitly in the invocation), follow the optional HTML
guidance in the Monthly Refactor Board prompt. Otherwise, Markdown only.
