# Sample vaults — implemented contract

Updated October 17, 2026. The Inquiry sidecar remains the demo-detection and saved-results contract. Multi-book collections additionally carry the explicit book list below; no hidden import marker or demo-state switch is used. Preparation states are separate from published sample availability.

## Portable content

A public ZIP contains manuscript notes, author-facing scene/beat metadata, character notes (with WebP portraits where a demo has them), source text, guides, saved Inquiry briefings, and `Radial Timeline/Inquiry/Sessions/sessions.json`. It excludes `.obsidian`, plugin binaries, private settings, provider credentials, logs, recovery archives, old exports, and unfinished publishing templates. Install the plugin separately.

The Inquiry sessions sidecar carries saved results and the active book identity. `InquiryArtifactStore` reads it; `WelcomeScreen` detects the sample, and the explicit **Open the sample vault** action configures the book. Existing user settings are not silently replaced on plugin load. Single-book samples need no additional manifest.

Packaged editions also carry `Radial Timeline/Demo/edition.json`, written by the packager: `{ "schemaVersion": 1, "sampleId": "…", "edition": "YYYY-MM-DD" }` (a same-day revision adds `.2`, `.3`…). The plugin only reads it (`src/demoVaults/demoEdition.ts`). On the detected-sample card, the catalog demo is matched by the sample's book folder; when its archive's catalog `edition` is newer than the vault's stamp, one line offers the new edition through the counted download link. A vault without a stamp counts as older, and an archive without a catalog `edition` offers nothing. The new edition downloads as its own vault, so the reader's files stay as they are. This is a comparison with the catalog bundled in the installed plugin; the plugin makes no request to learn about editions. The card appears only until the sample's book is set up. Settings → Demo vaults shows the same line under its heading for a demo opened as its own vault, before or after its book is set up: the vault's Inquiry sidecar names the demo's book folder, and that folder is in the vault.

## In-vault demo library

The welcome hero **Explore a finished book** opens the demo chooser directly. A detected sample retains its open action and a secondary **Browse demo projects** action. Settings → Demo vaults opens the same chooser for nonempty vaults. Manual ZIP downloads remain direct links; the website is optional.

The shared catalog in `src/settings/bonusVaults.ts` owns availability, manuscript folders, counted download URLs, archive roots, exact byte sizes and SHA-256 digests. Only reviewed public editions are importable. P&P, Odyssey and the four-novel Sherlock collection are available. The Faerie Queene remains coming soon, without an archive in the catalog. Publishing a revised ZIP requires updating the pinned catalog digest and size, plus `edition` for a stamped archive.

**Add demo to this vault** validates and unpacks the complete archive before writes. It rejects unsafe paths, unsupported files, oversized archives, duplicate manuscript IDs, missing books and invalid saved evidence. Files are written into a uniquely owned staging folder under `Radial Timeline/Demo Imports/`, then the complete folder is moved to:

```text
Demo Projects/
  Pride & Prejudice/
  The Odyssey/
  Sherlock Holmes/
```

The importer preserves manuscript IDs, analyses, quotes and binary assets while rebasing internal wiki links, saved evidence paths, brief paths and Inquiry book keys. Each imported project carries a versioned `Sample Vault Config.md` listing its rebased book folders. Existing destinations are never overwritten: a valid installed project opens again; an unrelated or incomplete folder shows an explanation. Failed staging writes are removed; a completed project with interrupted setup remains available for **Open demo** to retry. No credentials, plugin binaries or packaged `.obsidian` settings are imported.

Book registration appends missing profiles without replacing existing profiles or choices. Added demo books are excluded from an existing author's saga. The opening action selects the first demo book and waits for Obsidian metadata before opening the timeline. AI permission, provider configuration and existing Inquiry source choices remain unchanged. An unconfigured Inquiry source setup receives the normal scene/outline defaults.

Each project's curated Inquiry artifact stays inside its project. `InquiryArtifactStore` reads those artifacts alongside the author's root store and marks their runtime origin. Root persistence excludes demo sessions, and the author's 30-session cap does not evict curated demo answers. Reloading reads the project files again, so a removed project does not remain as cached demo history. New AI results remain authored sessions in the root store. Imported provider-cache windows are cleared: saved analysis is not evidence of a reusable cache in the recipient's account.

## Multi-book collections

Sherlock's four novels use a reader-visible `Sample Vault Config.md` with this frontmatter:

```yaml
rt_sample_vault: true
schema_version: 1
display_name: Sherlock Holmes
book_folder: 01 A Study in Scarlet
books:
  - title: A Study in Scarlet
    source_folder: 01 A Study in Scarlet
  - title: The Sign of the Four
    source_folder: 02 The Sign of the Four
  - title: The Hound of the Baskervilles
    source_folder: 03 The Hound of the Baskervilles
  - title: The Valley of Fear
    source_folder: 04 The Valley of Fear
```

The list defines collection order and the opening book. The welcome action validates every folder before adding missing Book Manager profiles. Reopening reuses profiles by folder and preserves author titles, IDs, order and Saga choices. Missing folders, unsupported schemas, overlapping folders and malformed lists surface an error instead of registering part of the collection. The collection name takes precedence over the Inquiry sidecar's active-book name.

Inquiry's saved-question lookup matches both question and book scope key; a later answer from another novel cannot replace the selected novel's answer. Saga answers remain separate. This requires the updated plugin. Sherlock's published package contains its twelve accepted per-book answers; historical working sessions are excluded.

Scene IDs and literary prose are preserved. Preparation changes belong in the designated canonical vault; ZIPs are regenerated from that source. Operational state never belongs in scene YAML.

## AI access and versions

On current main, Inquiry view access is independent of AI permission. Saved results remain browsable with AI off and no credentials. New generative actions require explicit AI enablement and a configured provider. See `inquiry-critical-path-rules.md` for the access boundary.

Historical compatibility note: plugin **7.3.1** predates that change; its Inquiry view requires the AI toggle, although saved demo results do not require an API key. Older download guides may describe that workaround. Verify the actual installed version when testing a sample rather than applying that older limitation to every current build.

## Packaging and acceptance

Use [the maintained packager](../../scripts/demo-vaults/README.md). It has required YAML parsing, explicit inclusion lists, full source-chapter comparison, boundary-aware Pulse checks, latest Gossamer-run consistency, Inquiry evidence validation, wiki-link validation, deterministic ZIPs, and SHA-256 inventory output. Existing output directories are refused.

The checked-in contracts cover P&P's chapter layout, Odyssey's Gutenberg HTML layout, and Sherlock's four-novel HTML layout. Sherlock's published edition includes 56 chapters, 41 beats, four Gossamer signals per book, and twelve accepted per-book Inquiry results. The collection validator checks exact book ownership, full manuscript coverage, supporting quotes, reviewed acts/dates/beat positions, original sources, and the sample manifest. Seven historical sessions remain in the working vault and are excluded by explicit accepted run IDs. Automated checks do not replace literary review, verify AI opinions, or authorize provider calls. Any revised package still requires exact-artifact QA and public compatibility verification.

## Literary-form preparation

The Faerie Queene is directly onboarded at the owner’s request, and remains unpublished. Its 75 working canto/fragment scene notes belong to seven registered books; all bodies match the preserved Smith source notes. Six proems remain separate context. All 75 units have agent-written, source-checked synopses and summaries. The seven-book literary pass includes seven continuous synopses, narrative-frame distinctions and 211 selective character/collective plus 97 place profiles. The next provider batch is scoped Pulse, beginning with Book I, not another manuscript import. Source preprocessing remains distinct from working-note creation and creates no scene metadata or fake results. See [verse source preparation](../../scripts/demo-vaults/README.md#verse-source-preparation).

For an explicitly requested direct agent preparation, preserve a baseline, existing IDs and analyses, verify source bodies and references, register book scopes safely, and inspect the result natively. Attribute session-written summaries to the agent; never synthesize plugin/provider provenance. Only the shipped import path supplies importer acceptance evidence. Direct content preparation does not replace importer regression coverage or release-contract checks. New IDs must follow the Pulse/reference grammar (`scn_` plus 8–10 hexadecimal digits).

The full-poem literary check retains source-argument discrepancies rather than rewriting them: Burbon’s episode occurs in V.xi although V.xii’s argument names it, and VI.v’s narrative identifies Serena where the argument says Matilda. Real and counterfeit Florimell, Amias/Amyas and Placidas, the distinct foundlings, Cymoent/Cymodoce and the Blatant Beast’s later escape are explicitly handled. Narrative Frame fields distinguish present action from embedded testimony, chronicles, prophecy, dreams and reflection. The two-stanza VII.viii summary stays proportionately brief. These content checks do not certify saved analyses or a public release.

Preserve deliberate source units at Confirm scenes; optional Auto-split is not required for an already conditioned canto folder. A canto-level scene note may contain multiple dramatic events. Describe that granularity honestly. Keep unsupported chronology blank, identify interlaced quests and narrative frames, and treat allegorical readings as interpretations. The unfinished Mutabilitie material must retain its actual VI–VIII numbering and the two-stanza VIII fragment.

Single-file division detection identifies a child division by its full parent path, so repeated Canto I headings in different books survive contents deduplication. Gutenberg verse-line markup creates line breaks while enclosing stanzas retain paragraph boundaries. Compact regression fixtures cover these shared importer behaviors; actual source acceptance additionally exercises the Markdown adapter, split-confirmation model and deterministic proposals without a provider.

Test the exact extracted ZIP in a fresh profile: sample detection, book initialization, four timeline modes, all saved Inquiry examples, scene navigation, and reopening. Keep provider calls user-operated. Back up the previous public ZIP and verify actual downloaded bytes after upload, including the website and email redirect paths.

## Published sample

| Sample | Included analysis | Release |
|---|---|---|
| Pride & Prejudice | 61 chapters with Pulse and Places, 15 beats with four reviewed October Gossamer signals, 3 saved Inquiry sessions, 29 character portraits | Edition `2026-10-30.3` (stamped); published direct download; catalog pins the live ZIP |
| The Odyssey | 89 scenes with Pulse, 12 beats with four Gossamer signals, 3 saved Inquiry sessions | Edition `2026-10-30` (stamped, unwrapped paragraphs); published direct download |
| Sherlock Holmes | Four novels / 56 chapters with Pulse, 41 beats with four Gossamer signals, 12 saved Inquiry sessions | Edition `2026-10-30` (stamped); published direct download; catalog pins the live ZIP |

Older Gossamer runs remain explicitly identified as history in the guide. The updated readings are the October 2 Claude Opus 5.5 runs. No blanket claim is made that every historical analysis used that model.

Website entry: `https://www.radialtimeline.com/resources/free`. Counted download: `https://community.radialtimeline.com/go/site-demo-pp`. Release inventory and acceptance evidence are maintained alongside the canonical demo artifacts in Command Center.
