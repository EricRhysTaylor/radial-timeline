## Overview

Beat Audit checks beat note health against the active beat system. Beat Heal (Repair) updates existing beat notes to match the configured beat list. Heal changes frontmatter only — it never renames files.

## 1. What Beat Audit checks today

| Check | Description |
|-------|-------------|
| **Beat identity** | Matching is by **canonical beat name** (normalized title; prefix numbers are stripped for matching). |
| **Act placement** | Each expected beat has an Act. The audit compares the existing note's frontmatter `Act` to the expected Act. Mismatch = **misaligned**. |
| **Manuscript sequence** | Beats are ranked by filename prefix and that order is compared to the template's beat order. A beat whose position diverges is flagged **out of manuscript sequence**. |
| **Duplicates** | Multiple beat notes that normalize to the same canonical name. Flagged as **duplicate**; must be resolved manually (delete or rename one). |
| **Missing** | Expected beats with no matching note in the vault. Flagged as **new** (not yet created). |
| **Missing Beat Model** | Beat notes that match expected names but lack `Beat Model` (or have a different one). Can be repaired via Heal. |

**Synced** = one matching note, canonical name matches, Act matches, and the beat sits in template order within the manuscript sequence.

## 2. What Beat Heal / Repair changes

| Updated | Description |
|---------|-------------|
| **Act** | Frontmatter `Act` is set to the expected Act. |
| **Beat Model** | Frontmatter `Beat Model` is set to the active system name. |
| **Class** | Frontmatter `Class` is set to `Beat` if missing. |

| Never overwritten | User-edited content is preserved. |
|-------------------|-------------------------------|
| Purpose | Not touched. |
| Custom YAML fields | Not touched. |
| Body content | Not touched. |

| Conflicts | Resolution |
|-----------|------------|
| Duplicates | Skipped; must be resolved manually. |
| Target path already exists | Skipped; conflict reported. |
| No matching note | Skipped (nothing to repair). |

Heal updates frontmatter only. It does **not** rename files or change filename prefix numbers.

## 3. How Beat Audit / Heal treats beat prefix numbers

Prefix numbers matter for **relative order**, not exact value. The audit sorts beat notes by filename prefix and compares that sequence against the template's beat order:

- A beat whose prefix places it out of template order (e.g. Midpoint sorting after a beat that should follow it) is flagged **out of manuscript sequence**.
- The exact prefix value is not validated — `5.01 Midpoint` is fine as long as it still sorts into the correct position relative to the other beats.
- Fixing an out-of-sequence beat means renaming the file yourself (or regenerating prefixes during Assemble/Export). **Heal does not rename files**; it only updates frontmatter (`Act`, `Beat Model`, `Class`).
