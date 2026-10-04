# Demo vault releases

This is the maintained content-only packager. It replaces the legacy helper under the Sherlock Holmes ingestion folder. Canonical book preparation, user-operated AI runs, and literary review happen before packaging.

```sh
uv run scripts/demo-vaults/package_sample_vault.py \
  --source '/path/to/canonical/vault' \
  --dist '/path/to/new/output-directory' \
  --config scripts/demo-vaults/pride-and-prejudice.json
uv run --with pyyaml python -m unittest discover -s scripts/demo-vaults -p 'test_*.py'
```

The explicit inclusion list excludes private settings, logs, recovery archives, obsolete exports, and unfinished publishing templates. Public Inquiry sessions omit `logPath`, and their Markdown briefs omit the matching “View full Inquiry Log” link because those working logs are excluded. Findings, quotes, and manuscript prose remain unchanged. `release-inventory.json` records both canonical source hashes and packaged hashes so this small public export adjustment is auditable. The portable Inquiry contract is `Radial Timeline/Inquiry/Sessions/sessions.json`; it must travel with the book. Plugin installation is separate.

Checks require full text correspondence with the included source, contiguous scene numbers, unique IDs, saved Pulse coverage, consistent latest Gossamer runs, complete Inquiry answers with valid references, and resolved wiki links. P&P's illustrative chapter dates must remain ordered. ZIP entries have deterministic metadata; `release-inventory.json` records the exact archive and content hashes. Existing output directories are refused. Literary judgments and factual AI claims still require human/agent editorial review.

The validator supports P&P's Markdown chapter layout and the Odyssey's reviewed Gutenberg HTML layout. `odyssey.json` checks all 24 source books across 89 scenes, the three act assignments, original source hashes, and the twelve reviewed beat positions. Its event dates may move backward in narrative order because the wanderings are told retrospectively. The Odyssey contract requires quoted Inquiry evidence; answers recovered from rejected references without their original quotes cannot be packaged as finished. HTML and the original JPEG cover are allowed only for this explicit layout. The Odyssey inclusion list has 192 public content files and excludes all local settings, logs, and recovery material.

Use `--config scripts/demo-vaults/odyssey.json` for the Odyssey. A supported layout is not a readiness claim: replacement Inquiry results and fresh-profile QA remain required. Holmes and The Faerie Queene still need their own reviewed source layouts and explicit contracts. Do not infer readiness from another book or manufacture missing analyses.

Before public replacement: extract the exact ZIP into a fresh QA vault; test sample detection, all four timeline modes, and saved Inquiry browsing with AI disabled, including citation navigation and reopening. Back up the current public ZIP, upload the accepted artifact, and verify downloaded bytes through the public delivery URL.
