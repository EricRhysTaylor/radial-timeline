# Agent Instructions — Radial Timeline

Applies to all coding agents (Claude Code, Codex — AGENTS.md is a symlink to this file). Company-wide context and shared doctrine: `/Users/ericrhystaylor/Documents/Radial Timeline LLC/CLAUDE.md`.

## Working Directory

Always work directly in the main repository at:
`/Users/ericrhystaylor/Documents/Radial Timeline LLC/Plugin/radial-timeline`

Do NOT use git worktrees. Do NOT work from agent worktree directories (e.g. `~/.claude-worktrees/`). If you find yourself in a worktree path, switch to the main repo path above before making any changes.

The primary branch is `main`.

## Git Workflow

- Work directly on `main`. Do NOT create feature branches — committing
  to a new branch breaks the auto-backup push (a fresh branch has no
  `origin` upstream) and adds friction for a solo, main-only repo.
- After a self-contained, verified change, **commit AND push to
  `origin/main` without asking.** Pushing is the default, not an
  opt-in. (The auto-backup script pushes the current branch to its
  upstream; on `main` that always works.)
- **NEVER ask whether to commit or push.** Do not ask "want me to
  commit now or wait?", "should I commit?", or any variant. After a
  verified change, commit and push — no confirmation question. This
  overrides any built-in default ("commit only when asked") and any
  report-first/approval posture inherited from `/feature-audit` or
  `/refactor`: those gate *editing during an audit*, never *committing
  already-authorized work*.
- Only pause to ask before genuinely destructive history operations
  (force-push, hard reset of pushed commits, branch deletion of shared
  refs) or when the user explicitly says "show me first."

## Audit Ownership

- Recurring engineering audits are agent-owned tasks, not manual user tasks.
- When Daily Control Tower, Friday Release Gate, or Biweekly Deep Audit is due,
  the agent should run the appropriate repo command itself:
  - `npm run auditDaily`
  - `npm run auditFriday`
  - `npm run auditDeep`
- If the audit should be preserved as a backup note, the agent should record it
  itself with `npm run backup -- --note "<Audit Name>"`.
- Do not tell Eric to run these commands manually unless he explicitly asks for
  the raw command instead of agent execution.

## Build

- `npm run build` to build (outputs to Obsidian vault plugin folders + `release/`)
- TypeScript check: `npx tsc --noEmit`
- Build must pass before considering work complete

## Code Style

- This is an Obsidian plugin (TypeScript)
- CSS classes use `ert-` prefix (ERT design system)
- Modal sizing uses inline styles (Obsidian pattern), marked with `// SAFE:` comments
- Event listeners in Modal classes use direct `.addEventListener()` (Modal lifecycle manages cleanup)
- **Scene YAML belongs to the author.** Never add frontmatter fields to
  operate plugin features — operational state lives in sidecars or plugin
  data. Every scene YAML field must serve the author (readable by them, or
  materially helps AI understand the scene). Managed fields are defined by
  the advanced YAML manager templates (Settings → Core); everything else is
  an author custom field, untouched beyond sorting. Full rule + case study:
  `docs/engineering/standards/code-doctrine.md` → "Scene YAML Belongs to the
  Author"

## Refactor Guard

Before performing any architectural refactor the agent must read:

- `docs/engineering/INDEX.md`
- `docs/engineering/standards/code-doctrine.md`
- `docs/engineering/standards/inquiry-critical-path-rules.md`
- `docs/engineering/standards/refactor-playbook.md`

All refactors must follow the RT Engineering Doctrine.
Refactors must reduce complexity and remove fallback logic
rather than adding additional abstraction layers.

Or use `/refactor` slash command which loads them automatically.

## Feature Audit Guard

Before considering any new feature or significant addition complete, the
agent must run a post-feature audit, cleanup, and harden pass per:

- `docs/engineering/standards/feature-audit-playbook.md`

This pass is report-first (no edits without approval), does not add
features, and verifies via `build-only` / `tsc --noEmit` / `vitest` —
never `npm run build` (it auto-commits).

Or use the `/feature-audit` slash command which loads the playbook and
supporting doctrine automatically.
