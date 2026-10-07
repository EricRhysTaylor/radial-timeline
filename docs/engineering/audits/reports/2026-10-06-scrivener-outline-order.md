# Scrivener narrative order and metadata matching — bounded audit

The outline CSV is authoritative for narrative order. Filename numbering now applies only when no CSV is supplied. A supplied partial outline blocks import with instructions to re-export Files and Outliner Contents from the same selection. Metadata matches by normalized document title only; positional metadata assignment was deleted.

The existing onboarding mapping table now shows representative source values and explicitly states that mappings apply once to imported notes, without changing the Settings key remapper. No runtime remapping or persisted configuration was added. Existing canonical key proposals, custom fields, ignores and subplot flags are preserved. The Prepare screen identifies its narrative-order source.

Word Count remains an internal optional hint for distinguishing missing prose from binder furniture. Repair instructions prioritize matching manuscript selection and titles; no Word Count requirement was introduced.

Verification: production build-only and TypeScript passed. Focused suite: 173 tests passed, including new conflicting-filename/outline-order and incomplete-outline regression cases. Full gates run before commit/push. No live Obsidian materialization or visual inspector verification was performed. No blocking finding in the changed surface and no post-audit stabilization changes; no architectural refactor or scene-YAML schema change.
