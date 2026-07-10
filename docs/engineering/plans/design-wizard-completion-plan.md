# Design Wizard — Completion Plan

**Goal:** un-gate "Design your own…" (`__RT_RELEASE__` flag, PublishSection)
so from-scratch PDF style creation ships in release builds, without taking on
a combinatorial QA burden or a font-download subsystem.

**Origin:** Command Center Decision 2026-07-09 (Professional manuscript
export) + the 6.2.7 export release. This plan encodes the scope-shrink
strategy agreed with Eric on 2026-07-09.

---

## Current state (verified 2026-07-09)

Shipping today, in release builds:
- **Edit/fork path** — pencil button on each layout row in Settings → Publish
  opens `DesignedStyleWizardModal` pre-filled (`initialSpec`); editing a
  bundled layout forks a copy. Pro-gated via `isProActive`.
- **The engine is proven.** `generateDesignedStyleTex()` regenerates all four
  bundled fiction templates (they are *generated artifacts* of
  `BUNDLED_FICTION_SPECS`, not hand-authored `.tex`). The 6.2.7 release
  (widow/orphan penalties, `$header-includes$` hook) shipped through this
  exact generator with real-render verification.
- **Persistence** — `persistLayout()`: spec stored in
  `settings.pandocLayouts[].designedSpec`, compiled `.tex` written to
  `Radial Timeline/Pandoc/designed/<slug>.tex`, `tier:'pro'`,
  `origin:'designed'`.

Gated / unfinished:
1. **"Design your own…" button** is disabled when `__RT_RELEASE__` is true
   (esbuild `define`, set by release builds) with tooltip "BETA release
   pending…". This is the flag this plan exists to flip.
2. **Font install is a Phase-1 stub** — the wizard's font row "Install"
   affordance opens a Notice; the planned Phase-2 download was never built.
3. **No QA harness** covers wizard-reachable spec space; only the four
   bundled spec points are render-verified.

Free wins already banked (6.2.7): designed layouts inherit widow/orphan
control, the `$header-includes$` hook (so the binding-gutter toggle and Pro
custom preamble work with them), and spec-drift overwrite on install.

---

## Strategy: shrink the space, don't conquer it

The wizard stalls whenever it is treated as a free-form designer: 8 category
tabs × dozens of controls = a design space nobody can QA. The fix is
editorial, not technical:

> **Creation is always "fork a curated archetype, then adjust within
> QA'd ranges."** Blank-canvas design is a non-goal, permanently.

The code already agrees — the from-scratch flow opens with the archetype
picker overlay and `cloneArchetypeSpec()` deep-clones a bundled spec. This
plan just finishes that thought: clamp the adjustable ranges, restrict fonts
to what we can guarantee, and prove the clamped space compiles.

---

## Workstreams

### A — Font picker: bundled + detected only (kills Phase 2)

Replace the Phase-1 install stub with a picker whose options are:
1. **Bundled families** (ship in `src/assets/fonts/`, listed in
   `BUNDLED_PANDOC_FONT_FILES`): Source Serif 4, Sorts Mill Goudy, Latin
   Modern. "Install" = the existing `installBundledPandocFonts()` copy —
   already written, already tested.
2. **Detected system fonts** from the curated `FONT_REGISTRY` rows whose
   files resolve on this machine (EB Garamond, Crimson, TeX Gyre Pagella,
   Arial…). Shown with an "installed on this system" badge; no install
   affordance at all.

Rules:
- No download path. Remove/repurpose the Phase-2 comments.
- A spec referencing a font that resolves neither way → wizard blocks Save
  with the same structured font diagnostic the export modal uses
  (`getStructuredFontDiagnostic`) — one policy, both surfaces.
- `FONT_REGISTRY` (fontResolver.ts) stays the single source of truth; adding
  a font remains a one-row change.

### B — Clamp controls to QA'd neighborhoods

For each category tab, define min/max (and step) around the values the four
bundled specs actually use, rather than whatever the widget allows:
- margins 0.75–1.25 in; body size 10–13 pt; line spacing 1.15–2.0;
  chapter/opener spacing fractions 0.08–0.5; letter-spacing 0–20.
- Enum controls (header mode, folio position, opener style, chapter mode)
  are already closed sets — no work.
- Encode the clamps in one exported table (e.g. `WIZARD_CONTROL_RANGES` next
  to the spec types) so the compile matrix (C) and the sliders read the same
  numbers. No hardcoded ranges inside slider construction.

### C — Compile matrix: the un-gating evidence

Extend the `RT_PUBLISH_PDF_ASSEMBLY=1`-gated suite with a wizard matrix:

- For each archetype × each numeric control at {min, max} (one-at-a-time,
  not cross-product) × each enum value not already covered by a bundled
  spec: `generateDesignedStyleTex(spec)` → `pandoc --pdf-engine=xelatex`
  a fixture manuscript → **assert exit 0 and non-empty PDF**.
- Compile-only assertions need pandoc + xelatex, both present on this
  machine (`~/.local/bin/pandoc` 3.10, TeX Live 2026). The deeper
  text-extraction assertions in the existing suite need poppler
  (`pdftotext`/`pdfinfo`) — not required for the matrix.
- One-at-a-time keeps the matrix ~O(archetypes × controls × 2) ≈ low
  hundreds of fast XeLaTeX runs; acceptable as a manual pre-release gate,
  not per-commit CI.
- Any red cell → tighten the clamp in B or fix the fragment emitter. The
  matrix green at the clamped ranges **is** the definition of "safe to
  un-gate."

### D — Un-gate + UX truth-telling

- Flip the `__RT_RELEASE__` guard on "Design your own…" once A–C land.
- First wizard screen copy should say what the feature now is: "Start from
  a professional layout and make it yours" (fork-first framing), not
  blank-canvas language.
- Keep designed styles always-Pro (`templateTiering` already enforces).
- Run `/feature-audit` before flipping the flag (repo rule for significant
  additions).

### E — Fold in the deferred Standard-font decision

6.2.7 deferred replacing the free Standard Manuscript layout's body font
(system Arial — the only bundled layout with no shipped font files). Decide
here, once the A-picker exists: either bundle a metrically-reasonable free
sans/serif and migrate the spec, or keep Arial and mark the layout
"system font" in its card. Don't silently change existing users' output —
whichever way, note it in release notes.

---

## Un-gating checklist

- [ ] A: font picker lists bundled + detected only; install = existing copy
      path; save blocked on unresolvable font via structured diagnostic
- [ ] B: `WIZARD_CONTROL_RANGES` table exported; sliders + matrix share it
- [ ] C: compile matrix green at clamped ranges (archetypes × control
      extremes × uncovered enum values)
- [ ] D: flag flipped; fork-first copy; `/feature-audit` pass complete
- [ ] E: Standard-layout font decision made and release-noted
- [ ] Wiki: Book-Designer page updated to describe fork-first creation
- [ ] Release notes entry (next draft-for-release-*.md)

## Explicitly out of scope — permanently or for later

- Font downloading from the network (permanently — bundled/system only)
- Blank-canvas (non-archetype) creation (permanently — fork-first is the
  product)
- Live WYSIWYG preview beyond the existing pictogram/preview cards (later;
  compile matrix covers correctness, preview is polish)
- Drop caps / `lettrine`, half-title & `\frontmatter` machinery, PDF/X
  (tracked in the 2026-07-09 Decision doc as future print-readiness work)

## Verification commands

```bash
export PATH="$HOME/.local/bin:/Library/TeX/texbin:$PATH"   # pandoc 3.10 + TeX Live 2026
npx tsc --noEmit
npx vitest run
RT_PUBLISH_PDF_ASSEMBLY=1 npx vitest run tests/   # includes the new matrix
npm run build-only                                 # never npm run build (auto-commits)
```

Line references (drift-prone, verified 2026-07-09): scratch-create gate
`PublishSection.ts:~2845`; archetype clone `DesignedStyleWizardModal.ts:~260`;
Phase-1 font stub `DesignedStyleWizardModal.ts:~1326-1340`; persist
`DesignedStyleWizardModal.ts:~2305-2370`; `__RT_RELEASE__` define
`esbuild.config.mjs:~256`.
