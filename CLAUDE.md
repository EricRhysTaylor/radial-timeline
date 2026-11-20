# Agent Instructions — Radial Timeline

Applies to all coding agents (Claude Code, Codex — AGENTS.md is a symlink to this file). Company-wide context and shared doctrine: `/Users/ericrhystaylor/Documents/Radial Timeline LLC/CLAUDE.md`.

## Working Directory

Always work directly in the main repository at:
`/Users/ericrhystaylor/Documents/Radial Timeline LLC/Plugin/radial-timeline`

Do NOT use git worktrees. Do NOT work from agent worktree directories (e.g. `~/.claude-worktrees/`). If you find yourself in a worktree path, switch to the main repo path above before making any changes.

The primary branch is `main`.

## Product naming

Use **Radial Timeline** in full in product copy, UI labels, wiki prose, and new code comments. Do not abbreviate the product name to **RT**. The manuscript source button is **Radial Timeline Book**. The shortened logo is a graphic mark, not the product's written name.

Preserve established technical identifiers (such as `ert-*` CSS classes and existing persisted keys), literal filenames, and controls where `RT` means **Runtime**. Do not rename these as part of a copy edit.

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

## Live tests that send email: one test address

Owner's decision, 2026-11-17. Every live test that makes the real services
send email (sign-up, sign-in, magic link, password or backup-code flows,
invitations, newsletter sign-up, Resend or Supabase Auth test sends) uses one
fixed address: `ericrhystaylor+rt-qa@gmail.com`.

- Never make up a new plus-address (`+rt-signup-<date>qa`, `+nltest`,
  `+rttest1`...) and never use Eric's plain address for a test. Each new
  alias lands in his inbox as if a real person had signed up, and leaves
  another test account behind.
- Reuse the existing test account. If a test really needs a brand-new
  account, ask Eric first rather than creating a second one.
- Unit tests, fixtures and docs use `example.com` addresses, never a real
  inbox.
- In the final report, say which live emails the run caused: the flow, the
  number of emails, and that they went to the test address. Note any email
  sequence a test started that will keep sending (for example a newsletter
  welcome series), and stop it when the test ends if you can.
- Exception: a preview Eric asked to see (a newsletter draft, a new email
  template) goes to his own address, as the email repo's docs describe. That
  is a review copy, not a test.

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
- The Mac Studio receives remote merges each morning: the Daily brief runs
  `scripts/mac-sync/sync-repos.sh`, which fast-forwards each company repo's
  clean `main` to `origin/main`, runs `npm run deploy` for the plugins, and
  exits. Its report is the Clearing House "Deploys" card. Nothing runs in the
  background on the Mac (owner's decision, 2026-07-27, reaffirmed 2026-11-15).
  `npm run deploy` fast-forwards `main` and rebuilds the plugin into all vault
  folders; it remains the way to get a change the same day. Builds write a
  `.hotreload` marker so the Hot Reload community plugin reloads the plugin in
  an open vault.
- When a remote agent finishes a change that affects the plugin, its final
  message must say it reaches the vaults with the next morning's Daily brief
  sync, or sooner with `npm run deploy` on the Mac — never imply the local
  plugin already has it.
- **Standing order: land finished cloud work on `origin/main` yourself.**
  When the change is verified and ready for Eric to test, merge it — if the
  session put it on a branch or draft PR, mark the PR ready and merge it
  (repo convention: a merge commit). Never leave finished work waiting as a
  draft; `npm run deploy` only pulls `main`, so unmerged work cannot be
  tested. "Publish" here means landing on `main` for the local vaults; it
  never means a public release (`npm run release`) unless Eric asks for a
  release by name. (Owner's standing order, 2026-09-29.)

## Releases: Eric approves the version and the notes

Owner's decision, 2026-11-20. This applies to every public release an agent runs.

- **Ask before Step 1 of `npm run release`.** Step 1 pushes the new version to `main`, and Obsidian sees it at once.
- **Ask with a dedicated question** (AskUserQuestion, or the session's equivalent), never as a line inside a report. Eric must approve:
  - **the version number**, saying why it is a patch, minor or major release;
  - **the draft release notes**, with a link he can open on his phone. Push `docs/releases/draft-for-release-<v>.md` to `main` first (docs only) and link it on GitHub, where its screenshots render.
- **Run the release only after his yes** to that version and those notes. If either changes afterwards, ask again.
- **"Release" from Eric starts this process; it is not the approval.**
- The version rule and the screenshot rule are in `docs/engineering/standards/release-process.md`, "Release notes".

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

## Strings and translations (English first until features settle)

Owner's decision, 2026-11-07. Full rule: `docs/engineering/standards/i18n.md`.

- Add new strings to `src/i18n/locales/en.ts` only. The other languages show
  the English string until they are translated; `t()` falls back to English.
- When an English string's meaning changes, delete that key from every other
  locale, so the language shows the new English text instead of an outdated
  translation. Delete a removed key from every locale too.
- One translation pass brings the languages back to full coverage before a
  major release (8.0).
- Keep every existing language. Do not remove a locale.
- `npm run release:i18n` reports each language's coverage and fails on a key
  English no longer has. For an `x.0.0` release the preflight adds
  `--full-coverage`, which also fails on any string still shown in English.

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
