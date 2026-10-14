# Full product name in manuscript source selection

The English source button now reads **Radial Timeline Book**. Related source prompts and unavailable-book notices use the full product name in all five shipped languages. The transient translation key is radialTimelineBook; persisted source kinds and book IDs are unchanged. Related code comments and wiki product references were expanded.

The repository agent instructions and wiki style guide now require Radial Timeline in full in UI/product copy, new code comments and wiki prose. Literal Runtime controls labelled RT, established technical identifiers, graphic marks and literal filenames are preserved. Historical reports/screenshots were not rewritten.

Native verification: Obsidian 1.14.4, isolated synthetic Working vault, desktop and 620px-wide window (566 CSS px). Inspected [desktop](2026-10-14-product-name-evidence/desktop.png) and [narrow](2026-10-14-product-name-evidence/narrow.png) captures. All three source buttons fit without clipping, with their shared existing wrapping row retained. No CSS or behavior changes were required. Production build/TypeScript and all 14 repository gates passed. No new implementation-mirroring tests were added for this label-only change.

The seven changed public wiki pages were reviewed as selective text edits, preserving other live content. Local source mirrors match these wording changes. Existing Obsidian windows need the plugin reloaded to see the new label.
