# RT Engineering Doctrine

> **Engineering Rule**
> These rules are mandatory for both human and AI-generated code.
> All refactors and architectural changes must comply with this doctrine.
> If new code violates these rules, the correct action is to refactor the code rather than add new fallback layers.

This document defines the coding philosophy for the Radial Timeline codebase.

The goal is **predictable, testable, lean software**.

The system prioritizes **correctness, determinism, and maintainability** over convenience or defensive overengineering.

---

## Core Principles

### 1. Prefer One Canonical Path

If multiple implementations perform the same function:

- merge them
- or delete one

There must be **one source of truth** for every core behavior.

Examples:

- token counting
- model selection
- corpus composition
- execution routing

---

### 2. Fail Clearly Instead of Falling Back

If the system cannot produce a correct result:

**throw an error or show a clear blocked state.**

Do not silently fall back to heuristics or alternate code paths.

**Hard fail is preferred to silent recovery.** A loud failure surfaces real bugs and architectural flaws while they're still cheap to fix. A silent fallback masks them, accumulates them, and ships them to authors as inexplicable wrong answers months later.

Fallback logic introduces:

- incorrect results that look correct
- hidden bugs that survive the next refactor
- testing complexity (you have to test the fallback path AND the unreachable error path)
- false confidence in code that hasn't been exercised
- a permanent excuse not to fix the underlying problem

Bad:

```
try providerEstimate
fallback heuristicEstimate
fallback previousEstimate
```

Correct:

```
try providerEstimate
if fail -> surface error
```

**The discipline:** when a function looks like it might need a fallback, ask why the upstream contract is unreliable. Fix the contract. A codebase whose callers trust their inputs is dramatically simpler than one whose every function defends against its callers.

This rule is enforced at boundaries by `scripts/fallback-gate.mjs` and is one of the four explicit author-trust principles (see `fallback-policy.md`).

---

### 3. Do Not Lie to the Author

Author-facing UI must never show numbers that are:

- fabricated
- clamped
- silently substituted
- partially derived

If the system cannot compute the value truthfully, display:

```
Estimate unavailable
```

or

```
Estimating...
```

---

### 4. Prefer Deletion Over Accommodation

When code grows complex due to historical compatibility:

delete obsolete behavior instead of layering new logic on top.

The correct refactor question is:

> "What code can be removed?"

not

> "What new code can fix this?"

---

### 5. No Defensive Branch Explosion

Avoid speculative code such as:

```
if maybeMissing
if maybeFallback
if maybeAlternate
if maybeLegacy
```

Branches must exist only for **known real cases**.

---

### 6. Pure Functions First

Prefer functions with explicit inputs and outputs:

```
result = compute(input)
```

Avoid hidden dependencies such as:

```
this.settings
this.plugin
this.state
```

Pure functions are easier to:

- test
- reason about
- reuse

---

### 7. UI Must Reflect System Truth

UI surfaces must display:

- the same estimate
- the same corpus
- the same model
- the same limits

Multiple UI numbers must **never diverge**.

---

## Refactor Standard

Every structural refactor must answer:

1. What duplicate logic was removed?
2. What fallback behavior was deleted?
3. What is now the single source of truth?
4. What UI surfaces became more accurate?
5. What became easier to test?

---

## What We Optimize For

The RT codebase optimizes for:

- deterministic behavior
- small surface area
- clarity of data flow
- fast debugging
- minimal cognitive overhead

---

## What We Avoid

We intentionally avoid:

- speculative flexibility
- defensive fallbacks
- duplicated computation paths
- UI numbers that disagree
- hidden coupling between modules

---

## Philosophy

Correct software is simpler than defensive software.

### Scene YAML Belongs to the Author — Never Add Fields to Operate Features

Every field in a scene's frontmatter must serve the author directly: something they read or edit themselves, or that materially helps AI features understand the scene. **Plugin machinery never writes operational state into scene YAML** — no provenance stamps, confidence scores, tracking flags, or feature toggles. That state lives in sidecar files (e.g. `Radial Timeline/Snapshots/Timeline/`), plugin data, or in-session models.

The managed-field boundary is the advanced YAML manager (Settings → Core): its base and advanced templates define the canonical, plugin-managed fields. Anything outside those templates is an **author custom field** and must not be touched beyond sorting — and sorting keeps each custom property attached to the canonical managed property directly above it.

Case study (2026-07): the beta timeline tools wrote `WhenSource`, `WhenConfidence`, `DurationSource`, and `NeedsReview` into scene frontmatter to power ripple anchoring and review flags. None served the author. The fields were removed before release; ripple provenance moved to the When change log sidecar, which is also more correct — a hand-edited date automatically invalidates its stamp, which a YAML field could never detect.

Litmus test for any new frontmatter write: *would an author scanning their own file want this line there?* If the honest answer is "it's for the plugin," it goes in a sidecar.

### Canonical YAML Keys Go Through Helpers, Never String Literals

Note types that have undergone field renames (Beat: `Description → Purpose`; Backdrop: `Synopsis → Context`) must be read through the canonical helpers in [`src/utils/frontmatter.ts`](../../../src/utils/frontmatter.ts) — `readBeatPurpose`, `readBackdropContext`. The legacy-key fallback ladder lives once in those helpers; never inline it.

```
// Allowed
const fm = asBeatFrontmatter(cache?.frontmatter);
const purpose = readBeatPurpose(fm);

// Not allowed — three drift surfaces in one read
const purpose = fm?.Purpose ?? fm?.Description ?? fm?.description;

// Forbidden — Beats never had a Synopsis field; this is the 2026-04-21 regression
const purpose = fm?.Synopsis;
```

Why this is a separate rule and not just "use helpers": Obsidian's `metadataCache.getFileCache().frontmatter` is typed `any`, so the typo-class bug (`fm.Synopsis` on a beat note) typechecks identically to the correct read. The 2026-04-21 multi-signal Gossamer refactor lost a month of beat-Purpose data this way — every Gossamer run shipped bare beat labels to the AI because nothing in the type system or test suite knew which YAML keys are valid on which note type.

Enforcement layers:

1. **Helpers** in `frontmatter.ts` are the single source of truth for the canonical/legacy key lists (`BEAT_PURPOSE_KEYS`, `BACKDROP_CONTEXT_KEYS`).
2. **Typed views** (`BeatFrontmatter`, `BackdropFrontmatter`) plus narrowing functions (`asBeatFrontmatter`, `asBackdropFrontmatter`) make `fm.Synopsis` a compile-time error on beat-typed fm.
3. **Source-grep tests** (`GossamerCommands.test.ts → Gossamer canonical YAML key discipline`) fail at CI if a call site re-inlines the fallback ladder or references a wrong-note-type key.
4. **Contract tests** (`unifiedBeatAnalysis.test.ts → renders the beat description after an em-dash when provided`) prove the prompt actually carries the field, so silent data-loss can't ship.

When you migrate another field, add it to the registry in `frontmatter.ts`, write a helper, add the source-grep test for the consuming module, and add the doctrine entry here.

### SVG Elements Never Take `aria-label` or `setTooltip`

Obsidian augments `HTMLElement.prototype` with helpers — including `isShown()` — via its bundled `enhance.js`. `SVGElement` does **not** inherit these. Obsidian's global tooltip handler shows a tooltip for any element carrying `aria-label` (and for `setTooltip` targets), and on its hover-delay `setTimeout` it calls `target.isShown()`. On an SVG element that throws **`e.isShown is not a function`** — the recurring crash on the Inquiry question markers (the SVG `<g role="button">` "buttons").

```
// Forbidden — SVG <g>/<rect>/<circle>/… : triggers Obsidian's tooltip -> isShown() crash
svgGroup.setAttribute('aria-label', 'Run question');
setTooltip(svgGroup, 'Run question');

// Allowed — SVG-native accessible name + native hover tooltip, no Obsidian code path
setSvgAccessibleName(svgGroup, 'Run question');   // src/utils/tooltip.ts (<title> child)

// Allowed — RT's own SVG-safe styled tooltip system
svgGroup.setAttribute('data-rt-tip', 'Run question');
```

`aria-label` on **HTML** elements (buttons, inputs, divs) is fine and expected — the rule is SVG-specific. `src/utils/tooltip.ts` already documents that Obsidian's tooltip API is unreliable on SVG; this is the same boundary, stated as a hard rule. Enforced for the glyph by the source-grep guard in [`InquiryGlyph.aria.test.ts`](../../../src/inquiry/components/InquiryGlyph.aria.test.ts).

### Source-Grep Regression Guards

A source-grep regression guard is a unit test that reads the source of another module as a string and asserts that specific patterns are present or absent. They complement — never replace — unit tests of behavior. They catch a class of regressions that behavior tests reliably miss: wiring removed, an order swapped, a forbidden literal re-introduced by a future contributor who didn't read the original rationale.

**Use them for:**

- **Cross-file architectural invariants** — "Gossamer must read beat purpose via `readBeatPurpose`, never via raw `fm.Purpose`."
- **Privacy and security gates** — "AIClient must never hard-code `allowRemoteRegistry: true`."
- **Wiring-order positional checks** — "the model-availability gate must sit between `setLastRunAdvanced` and `this.execute(...)`." Behavior tests would pass either way; positional tests fail loudly if the gate is moved.
- **Forbidden-call bans** — "the AI parse path must not call `coerceGossamerSignal(b.signal ...)` (that was the wrong-signal-eraser)."
- **Banned string/field access** — "no `fm.Synopsis` literal in executable code on beat-handling sites."

**Do not use them as a substitute for normal unit tests.** A behavior test that exercises the validator and asserts what it returns is always preferable when the behavior is testable. Source-grep tests are for the *meta-rule* — the contract that the right behavior test is wired up to the right call site — not for the behavior itself.

**Standard recipe.** Strip comments before grepping so docstring mentions of the forbidden pattern (which are often the most useful place to explain *why* it's forbidden) don't trip the test:

```typescript
const rawSource = readFileSync(resolve(process.cwd(), 'src/path/to/module.ts'), 'utf8');
const code = rawSource
    .replace(/\/\*[\s\S]*?\*\//g, '')            // block comments
    .replace(/(^|[^:])\/\/.*$/gm, '$1');         // line comments (preserves `http://` etc.)

it('reads X via helper, never via literal', () => {
    expect(code).toContain('readBeatPurpose');
    expect(code).not.toMatch(/\bfm\??\.Synopsis\b/);
});
```

When a source-grep test fires, the fix is almost always to use the canonical helper / re-wire the gate / re-add the guard — *not* to silence the test. Treat it as a structural assertion, not a stylistic preference.

### Logging Is Allowed, Behavioral Fallbacks Are Not

Diagnostic logging is encouraged.

However logging must never introduce alternate execution paths.

Allowed:

```
log.error("provider estimate failed")
```

Not allowed:

```
try providerEstimate
catch -> fallback heuristicEstimate
```
