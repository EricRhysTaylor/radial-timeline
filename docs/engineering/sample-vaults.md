# Sample vaults — implemented contract

Updated October 2, 2026. This replaces the earlier unimplemented `Sample Vault Config.md` / import-marker proposal. Do not emit that proposed manifest or add another demo-state switch.

## Portable content

A public ZIP contains manuscript notes, author-facing scene/beat metadata, character notes, source text, guides, saved Inquiry briefings, and `Radial Timeline/Inquiry/Sessions/sessions.json`. It excludes `.obsidian`, plugin binaries, private settings, provider credentials, logs, recovery archives, old exports, and unfinished publishing templates. Install the plugin separately.

The Inquiry sessions sidecar carries saved results and the book identity. `InquiryArtifactStore` reads it; `WelcomeScreen` detects the sample, and the explicit **Open the sample vault** action configures the book. Existing user settings are not silently replaced on plugin load. No `Sample Vault Config.md`, hidden import marker, or sample schema migration framework is implemented or required.

Scene IDs and literary prose are preserved. Preparation changes belong in the designated canonical vault; ZIPs are regenerated from that source. Operational state never belongs in scene YAML.

## AI access and versions

On current main, Inquiry view access is independent of AI permission. Saved results remain browsable with AI off and no credentials. New generative actions require explicit AI enablement and a configured provider. See `inquiry-critical-path-rules.md` for the access boundary.

Public plugin **7.3.1** predates that change: its Inquiry view requires the AI toggle, although saved demo results do not require an API key. The October 2 download guide states this distinction. Do not claim the always-visible view fix or Pulse completion cost/cache display has shipped publicly until a plugin release includes those commits.

## Packaging and acceptance

Use [the maintained packager](../../scripts/demo-vaults/README.md). It has required YAML parsing, explicit inclusion lists, full source-chapter comparison, boundary-aware Pulse checks, latest Gossamer-run consistency, Inquiry evidence validation, wiki-link validation, deterministic ZIPs, and SHA-256 inventory output. Existing output directories are refused.

The current checked-in contract is for the prepared P&P chapter layout. Other source layouts require explicit preparation and their own validation before publication. Automated checks do not replace literary review, verify AI opinions, or authorize provider calls.

Test the exact extracted ZIP in a fresh profile: sample detection, book initialization, four timeline modes, all saved Inquiry examples, scene navigation, and reopening. Keep provider calls user-operated. Back up the previous public ZIP and verify actual downloaded bytes after upload, including the website and email redirect paths.

## Published sample

| Sample | Included analysis | Release |
|---|---|---|
| Pride & Prejudice | 61 chapters with Pulse, 15 beats with four reviewed October Gossamer signals, 3 saved Inquiry sessions | October 2, 2026 content refresh; direct free download |

Older Gossamer runs remain explicitly identified as history in the guide. The updated readings are the October 2 Claude Opus 5.5 runs. No blanket claim is made that every historical analysis used that model.

Website entry: `https://www.radialtimeline.com/resources/free`. Counted download: `https://community.radialtimeline.com/go/site-demo-pp`. Release inventory and acceptance evidence are maintained alongside the canonical demo artifacts in Command Center.
