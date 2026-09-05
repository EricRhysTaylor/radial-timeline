# CSS Drift Debt — what the rt-legacy number actually means

The `rt-legacy` WARN count reported by `scripts/css-drift-check.mjs --maintenance`
is **not** a backlog of work. Most of it is the renderer-SVG island, which is
**permanently** `rt-*` by design (see
[css-namespace-policy.md](css-namespace-policy.md) → "Renderer SVG island is
permanent"). This doc records the split so the number is interpretable.

## How the number is built

- The check counts `rt-*` **selector openers** (a `{` rule), not unique class
  names — one class styled in three rules counts as three.
- It scans both the `src/styles/*.css` sources **and** the bundled `styles.css`,
  so every source hit is counted roughly twice. The maintenance baseline total
  therefore ≈ `2 × source hits`.
- `apr-rt-*` branding and `--rt-*` variable references are **excluded** (they are
  not legacy selectors). This was fixed 2026-06-12; it dropped the count from
  1430 to 1349 with zero real selectors removed.

## Breakdown (source-only rule-hits, 2026-06-12)

| Bucket | Files | Hits | Status |
|---|---|---:|---|
| **Blessed island** | timeline, scenes, base, indicators, grid, drag, chronologue-* | **544** | Permanent. Not debt. Emitted into rendered SVG. |
| **Migratable stragglers** | briefing.css (90), pulse.css (38) | **~128** | Real migration target. → 0 after Stage 3. |

`base.css` is mixed (renderer primitives + welcome-view chrome + a few generic
utilities). It is treated as island for now; its non-renderer utilities are a
possible future cleanup, not current debt.

## Backslide protection

Files that have finished migrating off `rt-*` are listed under `rtCleanFiles` in
[css-namespace-allowlist.json](../../../scripts/css-namespace-allowlist.json) and
**hard-FAIL** on any `rt-*` selector (`rt-clean-backslide` rule). The global WARN
ratchet alone cannot catch a per-file backslide, so this guard is what actually
freezes migrated surfaces. When a file finishes migrating, add it to that list.

## Target state

When the stragglers reach 0, the residual `rt-legacy` count **is** the blessed
island floor and should be read as "renderer SVG primitives," not "work
remaining." Do not chase it to zero — renaming the renderer primitives changes
the SVG contract for no functional gain.
