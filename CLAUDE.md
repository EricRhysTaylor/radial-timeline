# Agent Instructions — Radial Timeline

Applies to all coding agents (Claude Code, Codex — AGENTS.md is a symlink to this file). Company-wide context and shared doctrine: `/Users/ericrhystaylor/Documents/Radial Timeline LLC/CLAUDE.md`.

## Working Directory

Always work directly in the main repository at:
`/Users/ericrhystaylor/Documents/Radial Timeline LLC/Plugin/radial-timeline`

Do NOT use git worktrees. Do NOT work from agent worktree directories (e.g. `~/.claude-worktrees/`). If you find yourself in a worktree path, switch to the main repo path above before making any changes.

The primary branch is `main`.

## GitHub issues are inbound only — never file your own

**Do not open GitHub issues.** Not for bugs you find, not for design
proposals, not for triage notes, not "filed for triage, not a commitment to
scope." The issue tracker is where *other people* report problems and where
we respond to them. It is not our record-keeping system.

This repo is **public and has real users filing real reports** — #14 alone
drew four outside contributors asking for local-LLM support. Agent-authored
tickets bury those people under our own noise, and publish internal
root-cause analysis, file paths, and unshipped design thinking to anyone
reading.

Where findings actually go:

- **A bug you can fix** → fix it. The analysis belongs in the commit or PR
  that carries the fix, attached to the change rather than floating free.
- **A bug you should not fix unilaterally** → report it to Eric in the
  session. He decides whether it becomes work.
- **Design proposals and open questions** → the session, or a doc under
  `docs/engineering/`. Never an issue.

Responding to issues opened by other people is expected and welcome.
Opening them is not. This rule was added after five agent-authored issues
were filed on the public Editorialist repo and had to be closed.

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

## Remote Session Deploys

- Remote (cloud) Claude Code sessions run in an isolated container with a
  COPY of this file tree. Builds and file writes there NEVER reach the Mac
  Studio's disk or the Obsidian vault plugin folders. A remote agent must
  never claim the local plugin is updated — its job ends at pushed/merged
  commits on origin/main.
- To receive a remote merge on the Mac Studio, run `npm run deploy` in the
  repo — it fast-forwards `main` and rebuilds the plugin into all vault
  folders (no commits, nothing left running). Then reload Obsidian (toggle
  the plugin) to load the new build. This is deliberately on-demand: no
  background watcher processes (owner's decision, 2026-07-27).
- When a remote agent finishes a change that affects the plugin, its final
  message must state plainly that `npm run deploy` + an Obsidian reload on
  the Mac is required to see it — never imply the local plugin already has it.

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
