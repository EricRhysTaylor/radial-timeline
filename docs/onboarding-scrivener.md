# Import a Scrivener manuscript without AI

1. In Scrivener, use **File → Export → Files** to export manuscript documents as text or Markdown. Preserve the binder hierarchy; numbering exported files helps preserve reading order. A raw `.scriv` project cannot be imported.
2. Optionally export **Outliner Contents as CSV**, including Title, Synopsis, and the metadata columns you want to carry. Keep the CSV with the export tree or in its parent folder.
3. Copy the export into your Obsidian vault. Open **Onboard manuscript** from Welcome and choose a detected candidate or select its folder directly; no Book Manager setup is required.
4. Inspect the export checks. Missing scene files or ambiguous outline matches block import and show re-export instructions; a missing CSV is a warning because scene-only import is supported. Keep **Structure only — no AI**, the default. No model or API key is required.
5. Confirm scene boundaries and reading order. Map Scrivener fields to Radial Timeline fields, keep them as custom fields, or ignore them. For one column per subplot, use **Mark scenes with this subplot (column name)**.
6. Review the proposed notes before applying. Onboarding creates a separate `<Book> RT` folder and registers the imported book; the original export remains untouched.

Structure-only carries exported synopses, mapped metadata, and scene titles. Mapped character/place lists can supply optional profile scaffolds. ACT folders determine acts when present; otherwise acts are allocated by position. Missing synopses and inferred story details remain for you to fill. AI scene splitting and generated summaries require explicitly choosing AI assistance.

Dismissed runs can resume while Obsidian remains open. Restarting Obsidian clears that in-memory review session.

Book Manager scans automatically only when there is no usable configured book folder. Established vaults can use **Scan for exports** or **Choose manuscript**. Discovery is local and read-only. Potential candidates are suggestions, not a guarantee of completeness. A CSV with Word Count enables the check for outline documents with prose but no exported scene file; without that column, unmatched rows are reported as uncertain.
