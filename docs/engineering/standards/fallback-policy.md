# Fallback Policy

Authoritative policy for fallback / silent-default code in this codebase.
Enforced by `scripts/fallback-gate.mjs` and the `npm run fallback-gate`
convenience script. Wired into `npm run gates`.

## Why this exists

Fallback code creates complexity and fakes success. A `try { … } catch { return ''; }`
turns a real failure into a blank string that flows downstream and surfaces
much later as an unrelated bug. A `value || 'Untitled'` chain hides the fact
that `value` was supposed to be defined — and when it isn't, you've lost the
signal that something is wrong.

Across publish/export alone the audit found ~70 fallback sites. The same
pattern lives across the codebase. Without a gate, every commit and every
agent silently adds more.

## The three rules

### 1. Throw at boundaries

External I/O (vault read, network call, system command, JSON parse of
untrusted input) must surface failure as a typed error or thrown exception —
**not** a silent empty/null/undefined return.

Catch-and-return is reserved for two narrow cases:
- A genuinely unreachable error state (and even then, prefer `assertNever` /
  exhaustive-check patterns over a catch).
- An external failure that has a meaningful default (e.g. "if the optional
  config file is missing, use the built-in defaults").

Both cases require a `// SAFE: <reason>` annotation on the catch line.

```ts
// BAD — silent failure, complexity-creating
try {
  const data = await fetchSomething();
  return data;
} catch {
  return '';
}

// GOOD — let it throw, caller decides
const data = await fetchSomething();
return data;

// GOOD — meaningful default with annotation
try {
  return await readOptionalConfig();
} catch { // SAFE: optional config file; missing = use built-in defaults
  return defaultConfig;
}
```

### 2. Use discriminated unions for "maybe absent" data

Prefer a discriminated union over `T | undefined` chained with `??` defaults.

```ts
// BAD — easy to forget the absent case at call sites
function findScene(id: string): Scene | undefined { … }
const title = findScene(id)?.title ?? 'Untitled';

// GOOD — call sites must handle both kinds at the type level
type SceneLookup =
  | { kind: 'ok'; scene: Scene }
  | { kind: 'missing'; reason: string };
function findScene(id: string): SceneLookup { … }
```

`Result<T, E>` style works equally well. The point is forcing the consumer to
acknowledge the absent case rather than papering over it with `??`.

### 3. Every `??` / `||` literal default requires a `// SAFE:` annotation

No exceptions — even legitimate UX defaults like `'Untitled Manuscript'` or
`'Author'` need a one-line justification on the same line. Reviewers reject
diffs without it.

```ts
// BAD
const title = doc.title ?? 'Untitled Manuscript';
const author = frontmatter.author || 'Author';

// GOOD
const title = doc.title ?? 'Untitled Manuscript'; // SAFE: UX default — empty title shows generic label
const author = frontmatter.author || 'Author';   // SAFE: UX default — placeholder for missing author
```

The annotation does two things: it forces the author to articulate why a
default is OK, and it gives reviewers a one-line cue to check the reasoning.

## When the gate fires

The gate scans `src/**/*.ts` (excluding `*.test.ts`) and counts five rule
hits:

| Rule | Severity | What it matches |
|---|---|---|
| `silent-catch` | block | `catch { return ''/null/undefined/; }` |
| `or-chain-3` | block | 3+ `\|\|` operators on one line |
| `nullish-literal` | warn | `?? 'literal'`, `?? 0`, `?? false`, etc. |
| `or-literal` | warn | `\|\| 'literal'`, `\|\| 0`, `\|\| false`, etc. |
| `switch-default-return` | block | `default: return …;` not preceded by `assertNever`/`throw` |

Maintenance mode fails when current counts exceed the baseline in
`scripts/fallback-baseline.json`.

### Canonical fix patterns

**silent-catch** — let the error propagate, or annotate the catch:

```ts
// Before
try { return JSON.parse(raw); } catch { return null; }

// After (option A — propagate)
return JSON.parse(raw);

// After (option B — annotate the meaningful default)
try {
  return JSON.parse(raw);
} catch { // SAFE: malformed user JSON; null = "use defaults" downstream
  return null;
}
```

**or-chain-3** — collapse to a single source of truth or extract a function:

```ts
// Before
const name = manuscript.title || frontmatter.title || file.basename || 'Untitled';

// After
const name = resolveManuscriptTitle(manuscript, frontmatter, file); // SAFE: helper centralizes the precedence rule
```

**nullish-literal / or-literal** — annotate, or rework into a discriminated union:

```ts
// Before
const author = frontmatter.author ?? '';

// After (option A — annotate)
const author = frontmatter.author ?? ''; // SAFE: blank string flows into "no author" rendering branch

// After (option B — discriminated union)
const author = resolveAuthor(frontmatter); // returns { kind: 'present'; name } | { kind: 'absent' }
```

**switch-default-return** — use exhaustive checking:

```ts
// Before
switch (mode) {
  case 'a': return doA();
  case 'b': return doB();
  default: return doFallback();
}

// After
switch (mode) {
  case 'a': return doA();
  case 'b': return doB();
  default: return assertNever(mode);
}
```

## The `// SAFE:` annotation format

```ts
<expression> // SAFE: <reason>
```

- Same line as the offending pattern.
- One-sentence reason explaining why the default is correct.
- "SAFE" is uppercase, followed by colon and space.

Bad reasons that will get rejected in review:
- `// SAFE: legacy` (be specific about why it's still here)
- `// SAFE: TODO` (file an issue, don't paper over it)
- `// SAFE: tests` (annotate test files separately if needed)

Good reasons:
- `// SAFE: UX default — placeholder when frontmatter omits author`
- `// SAFE: optional config; absence = "use built-in defaults"`
- `// SAFE: numeric default for canvas zoom; 1 = identity transform`

## How to refresh the baseline

After intentional cleanup that removes fallbacks:

```bash
node scripts/fallback-gate.mjs --update-baseline
```

This overwrites `scripts/fallback-baseline.json` with the current (lower)
counts, locking in the gain so it can never regress.

To inspect the inventory without failing the gate:

```bash
npm run fallback-gate -- --report
npm run fallback-gate -- --report --quiet  # summary only
```
