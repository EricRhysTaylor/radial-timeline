# Sample vaults — implemented contract

Updated October 4, 2026. The Inquiry sidecar remains the demo-detection and saved-results contract. Multi-book collections additionally carry the explicit book list below; no hidden import marker or demo-state switch is used.

## Portable content

A public ZIP contains manuscript notes, author-facing scene/beat metadata, character notes, source text, guides, saved Inquiry briefings, and `Radial Timeline/Inquiry/Sessions/sessions.json`. It excludes `.obsidian`, plugin binaries, private settings, provider credentials, logs, recovery archives, old exports, and unfinished publishing templates. Install the plugin separately.

The Inquiry sessions sidecar carries saved results and the active book identity. `InquiryArtifactStore` reads it; `WelcomeScreen` detects the sample, and the explicit **Open the sample vault** action configures the book. Existing user settings are not silently replaced on plugin load. Single-book samples need no additional manifest.

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

Inquiry's saved-question lookup matches both question and book scope key; a later answer from another novel cannot replace the selected novel's answer. Saga answers remain separate. This requires the updated plugin; it is not a claim that Sherlock's summaries and AI results have passed acceptance or that its public download is available.

Scene IDs and literary prose are preserved. Preparation changes belong in the designated canonical vault; ZIPs are regenerated from that source. Operational state never belongs in scene YAML.

## AI access and versions

On current main, Inquiry view access is independent of AI permission. Saved results remain browsable with AI off and no credentials. New generative actions require explicit AI enablement and a configured provider. See `inquiry-critical-path-rules.md` for the access boundary.

Public plugin **7.3.1** predates that change: its Inquiry view requires the AI toggle, although saved demo results do not require an API key. The October 2 download guide states this distinction. Do not claim the always-visible view fix or Pulse completion cost/cache display has shipped publicly until a plugin release includes those commits.

## Packaging and acceptance

Use [the maintained packager](../../scripts/demo-vaults/README.md). It has required YAML parsing, explicit inclusion lists, full source-chapter comparison, boundary-aware Pulse checks, latest Gossamer-run consistency, Inquiry evidence validation, wiki-link validation, deterministic ZIPs, and SHA-256 inventory output. Existing output directories are refused.

The checked-in contracts cover P&P's chapter layout, Odyssey's Gutenberg HTML layout, and Sherlock's four-novel HTML layout. Sherlock's candidate includes 56 chapters, 41 beats, four Gossamer signals per book, and twelve accepted per-book Inquiry results. The collection validator checks exact book ownership, full manuscript coverage, supporting quotes, reviewed acts/dates/beat positions, original sources, and the sample manifest. Seven historical sessions remain in the working vault and are excluded by explicit accepted run IDs. Automated checks do not replace literary review, verify AI opinions, or authorize provider calls. Sherlock remains a candidate until fresh-profile QA and public plugin compatibility are confirmed.

Test the exact extracted ZIP in a fresh profile: sample detection, book initialization, four timeline modes, all saved Inquiry examples, scene navigation, and reopening. Keep provider calls user-operated. Back up the previous public ZIP and verify actual downloaded bytes after upload, including the website and email redirect paths.

## Published sample

| Sample | Included analysis | Release |
|---|---|---|
| Pride & Prejudice | 61 chapters with Pulse, 15 beats with four reviewed October Gossamer signals, 3 saved Inquiry sessions | October 2, 2026 content refresh; direct free download |

Older Gossamer runs remain explicitly identified as history in the guide. The updated readings are the October 2 Claude Opus 5.5 runs. No blanket claim is made that every historical analysis used that model.

Website entry: `https://www.radialtimeline.com/resources/free`. Counted download: `https://community.radialtimeline.com/go/site-demo-pp`. Release inventory and acceptance evidence are maintained alongside the canonical demo artifacts in Command Center.
