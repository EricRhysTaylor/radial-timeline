Before performing any refactor:

1. Read:
   - `docs/engineering/INDEX.md`
   - `docs/engineering/standards/code-doctrine.md`
   - `docs/engineering/standards/inquiry-critical-path-rules.md`
   - `docs/engineering/standards/refactor-playbook.md`
   - `docs/engineering/agent-development-playbook.md`

2. Apply doctrine principles:
   - prefer deletion
   - eliminate fallback logic
   - ensure a single source of truth
   - keep UI numbers consistent

3. Follow the refactor playbook extraction order:
   - types -> pure helpers -> services -> renderers

Apply the RT Engineering Doctrine:

- prefer deletion over accommodation
- remove duplicate computation paths
- eliminate fallback logic where possible
- enforce single source of truth
- maintain deterministic runtime behavior

For every structural change, answer the refactor checklist from `code-doctrine.md`:
1. What duplicate logic was removed?
2. What fallback behavior was deleted?
3. What is now the single source of truth?
4. What UI surfaces became more accurate?
5. What became easier to test?

$ARGUMENTS
