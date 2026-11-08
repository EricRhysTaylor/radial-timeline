---
title: v8 Removals
status: open
target-version: 8.1.0
---

# Things to remove after 8.0

Compatibility kept for one release so a vault shared with a device still on 7.x keeps working. Search the codebase for `TODO(8.1)`.

## Vault-wide narration default (`globalPovMode`)

**Context:** 8.0 moves the narration default onto each book (`BookProfile.narrationMode`). `migrateVaultNarrationDefault` in `src/utils/books.ts` copies the 7.x `globalPovMode` onto every book without its own, once, and stamps `narrationDefaultsMigration` (schema version 1) with the books that inherited it.

**Kept through 8.0:** `globalPovMode` stays in `data.json`. A device still on 7.x drops `narrationMode` from the books when it saves; on the next 8.0 load the repair branch gives each recorded book the vault value again. A book the writer has set since is no longer recorded, so "Not set" stays not set.

**At 8.1, remove:**

- `globalPovMode` from `LegacyPersistedSettings`, and add it to `FINISHED_DEPRECATION_KEYS` in `src/main.ts` so it leaves `data.json`.
- The repair branch of `migrateVaultNarrationDefault` and `markNarrationChosen`. Keep the stamp: it is what tells 8.1 the migration ran.

**Why it is safe at 8.1:** every device that saves the vault's settings has then run 8.0 at least once, and 8.0 never writes the books without their narration.

## Legacy scene field `POV`

The scene field `POV` is read as the narration override (`SCENE_NARRATION_KEYS` in `src/utils/frontmatter.ts`) until the writer applies the refactor alert `yaml-pov-to-narration-v8`. It stays readable until the Story Vault editions and most vaults have moved to `Narration`; that is a product decision, not a version rule.
