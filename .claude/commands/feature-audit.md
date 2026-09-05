Post-feature audit, cleanup, and harden pass. Run after a new feature or
significant addition is implemented and functioning, before release.

This is NOT a feature-adding pass. Goal: simplify, normalize, and stabilize
without changing intended behavior.

1. Read:
   - `docs/engineering/INDEX.md`
   - `docs/engineering/standards/feature-audit-playbook.md`
   - `docs/engineering/standards/code-doctrine.md`
   - `docs/engineering/standards/fallback-policy.md`
   - `docs/engineering/standards/refactor-playbook.md`

2. Scope the feature surface from git (last release → HEAD + uncommitted),
   read the whole surface, and establish a clean baseline with
   `npx tsc --noEmit` and `npx vitest run`.

3. Default to REPORT-ONLY. Produce the prioritized audit report and get
   approval before editing. Verify only with `build-only` / `tsc --noEmit` /
   `vitest` — never `npm run build` (it auto-commits).

4. Work the 9 audit dimensions and produce the required output sections
   exactly as defined in `feature-audit-playbook.md`.

Apply the RT Engineering Doctrine:

- prefer deletion over accommodation
- remove duplicate computation paths
- never add fallback logic to "stabilize"
- enforce single source of truth
- maintain deterministic runtime behavior
- ERT classes only; no new `rt-*` classes
- schema-stamp persisted data; keep user data portable and local

$ARGUMENTS
