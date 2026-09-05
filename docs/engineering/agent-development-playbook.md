# Agent Development Playbook

## Purpose
Radial Timeline is designed for agent-assisted development. This repository provides doctrine, standards, and commands that guide safe, consistent, and test-validated changes across Claude, Cursor, Codex, GPT, and future agents.

## Required Reading Order
Agents must read these files before structural work:

1. `docs/engineering/INDEX.md`
2. `docs/engineering/standards/code-doctrine.md`
3. `docs/engineering/standards/fallback-policy.md`
4. `docs/engineering/standards/inquiry-critical-path-rules.md`
5. `docs/engineering/standards/refactor-playbook.md`

For UI/CSS work, also:
- `docs/engineering/standards/ui-architecture.md`
- `docs/engineering/standards/css-guidelines.md`

## Standard Workflow
1. Understand system architecture.
2. Produce a plan.
3. Perform minimal change.
4. Run gates (`npm run gates`).
5. Summarize what changed.

## Recurring Audit Ownership

Recurring control-tower audits are executed by the agent, not delegated back to
Eric as manual shell work.

- Daily control tower: agent runs `npm run auditDaily`.
- Friday release gate: agent runs `npm run auditFriday`.
- Biweekly deep audit: agent runs `npm run auditDeep`.
- If the audit needs a matching backup record, the agent also runs
  `npm run backup -- --note "<Audit Name>"`.

For reminder-style automations, the correct behavior is: detect whether the
audit is missing, then run it or instruct a future agent thread to run it. Do
not phrase the result as "Eric should run ...".

## Refactor Workflow
When refactoring:

1. Identify duplicate logic.
2. Identify fallback logic — delete, don't move.
3. Remove obsolete code.
4. Extract pure functions.
5. Extract services.
6. Run gates.

## Doctrine — Hard Fail Over Silent Recovery

Hard fail is preferred to silent recovery in this codebase. The discipline is explicit:

- A function that returns a "best-effort" value when its upstream contract is broken **hides the broken contract**.
- A loud thrown error surfaces real bugs and architectural flaws while they're still cheap to fix.
- A silent fallback masks them, accumulates them, and ships them to authors as inexplicable wrong answers months later.

When you find yourself wanting to write `try { X } catch { return ''; }`, the correct move is almost always:

1. Stop. Ask why the upstream contract is unreliable.
2. Fix the contract — make the input source guarantee what callers need.
3. Let the operation throw at its boundary if the contract is genuinely violated.

Catch-and-recover is reserved for two narrow cases (annotated with `// SAFE: <reason>`):
- A genuinely unreachable branch (and even then, prefer `assertNever`).
- An external optional input with a meaningful default (e.g., "if the optional config file is missing, use built-in defaults").

This rule is enforced at boundaries by `scripts/fallback-gate.mjs` and is wired into `npm run gates`. See `standards/fallback-policy.md` for the full policy and exempt cases.

## Verification — `npm run gates`

The single command that verifies an agent change is **`npm run gates`**. It runs the full stack:

1. `check-model-updates`, `check-api-features`, `validate-pricing`
2. `check-css-duplicates`
3. `build-only` (lock checks → `tsc --noEmit` → `code-quality-check` → `check-css-duplicates` → esbuild production)
4. `code-quality-check.mjs --all`
5. `css-drift -- --maintenance`
6. `compliance-check.mjs --maintenance`
7. `audit:spec-coverage`
8. `npm test` (vitest)

If any step fails, declare the work incomplete until it passes.

For faster iteration during a change, the smaller commands in order:

```bash
npx tsc --noEmit                    # type-check only
npx vitest run <relevant-tests>     # narrow test slice
npm run build-only                  # type-check + lock checks + bundle
npm run gates                       # full pipeline before declaring done
```

## Baselines — When to Update

Several gates are baseline-driven (compliance, css-drift, model-drift, css-coverage). Baselines exist so agents don't fix unrelated debt as a side effect of their work.

**Do NOT update a baseline when:**
- The new offender is *your* change. Fix it instead.
- You don't understand why the count went up.

**Do update a baseline when:**
- The regression is from intentional upstream work (e.g., new locale partials, new in-flight feature flags).
- The configured external strings legitimately add to the count (e.g., `node:fs` externals listed in `esbuild.config.mjs` count as `node-core-require` references).
- The drift is caused by an `interface T?` field added in advance of the values block — flip the optional `?:` to keep en.ts compiling and document with a `// Temporary ?: until ... lands` comment.

How to update:

```bash
npm run check-compliance -- --update-baseline
npm run css-drift -- --maintenance --update-baseline
node scripts/check-model-updates.mjs --update-baseline   # rare
```

Always commit baseline updates separately and explain the change in the commit body. A baseline update without justification is the same anti-pattern as a silent fallback.

## In-flight Feature Patterns

When a linter or upstream landing leaves the repo in an intermediate state (interface added before values block, new test file with bare-name `node:` imports, deferred locale section):

- **Don't revert** — the system reminder says these are intentional.
- **Don't populate** content you don't have authority over.
- **Do** make the type system valid with the smallest possible change:
  - Mark new required interface sections as `?:` with a `// Temporary ?:` comment.
  - Update the relevant baseline if scan counts increase.
  - Leave the in-flight content for whoever owns it to fill in.

## Commit Expectations
Agent output summaries must include:

- files changed
- lines removed vs added
- fallback logic removed (per Doctrine §2)
- tests updated or added
- baseline updates and their justification, if any

## Optional Claude Hooks
Projects using Claude Code may add hooks to enforce checks automatically. The recommended pre-commit hook is simply `npm run gates` — it covers everything below as a single deterministic pipeline.
