# Welcome and Book Manager import discovery — post-feature audit

## Scope and interaction decisions

Direct build against the existing ERT modal/settings controls. Refero research: Clay import validation screens (1a08e7c4-c753-4096-90dc-c6891b84b58a, e777baf9-1c5b-475f-8d18-2b2eb1d91aad) inform explicit checks, repair guidance and blocked Continue; 1Password import review (da334082-7e3b-4aac-b0c6-71c5cc894f09) informs proposed mappings followed by author review. Existing ERT panels and buttons remain the visual target. No new CSS or portals.

## Cleanup summary and behavior

- Welcome onboarding opens source selection directly. Candidate discovery and folder autocomplete remove the Book Manager prerequisite. Create new book opens Book Designer; the existing Welcome demo-vault card remains the demo path.
- Book Manager scans when no configured source folder exists on disk, and offers manual scanning and source selection for established vaults. Discovery reads file inventory and recognizable CSVs only; it performs no settings or manuscript writes.
- Candidates are grouped by export folder and exclude registered source folders, snapshots and raw Scrivener internals. Discovery deliberately avoids classifying every Markdown folder as a manuscript. Manual folder selection remains available.
- A chosen source uses a temporary BookProfile. It is retained by the existing in-memory review session; the destination book is registered only during approved materialization. Changing sources clears previous proposals, survey, splits and metadata mappings and resets AI opt-in.
- Scrivener preflight checks CSV Title and row correspondence, duplicate scene identities, nonempty exported scene prose, and unmatched outline rows with positive Word Count. Errors block Continue; warnings describe missing CSV/Synopsis or uncertain rows without Word Count. Repair copy names Scrivener export actions. Recheck export reruns validation.
- Single-scene and CSV-only export folders now enter the Scrivener lane when an outline exists. Command beta wording removed.

## Findings and limits

No blocking finding in this bounded changed-surface review. No architectural refactor or post-audit stabilization change. No persisted-settings migration or scene YAML change.

Completeness is limited to evidence present in the export. Without Word Count, unmatched outline rows may be folders/placeholders or missing documents and are reported as uncertain. Candidate discovery is a suggestion, not readiness certification. Folder-only imports still support an optional CSV. Existing destination collisions/partial-write behavior is unchanged. Localization of onboarding body copy and a full live Obsidian materialization remain follow-ups.

## Verification

- Production build-only, TypeScript and script typecheck passed; full suite: 4,005 passed, 7 skipped.
- Added 12 regression cases for read-only discovery, missing/wrong CSV, missing scene files, duplicate metadata identity, binder placeholders, and local source selection without settings mutation.
- Read-only check of an existing real Scrivener export: 85 scenes, zero blocking export errors, one warning for 59 unmatched outline rows lacking Word Count. No manuscript notes were written by this check. Temporary local-only test removed.
- Live Obsidian modal appearance, computed token scope, and final materialization were not exercised in this session. Shared ERT controls are reused, with no new CSS variables.
