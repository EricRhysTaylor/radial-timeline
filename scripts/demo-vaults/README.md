# Demo vault releases

This is the maintained content-only packager. It replaces the legacy helper under the Sherlock Holmes ingestion folder. Canonical book preparation, user-operated AI runs, and literary review happen before packaging.

```sh
uv run scripts/demo-vaults/package_sample_vault.py \
  --source '/path/to/canonical/vault' \
  --dist '/path/to/new/output-directory' \
  --config scripts/demo-vaults/pride-and-prejudice.json
uv run --with pyyaml python -m unittest discover -s scripts/demo-vaults -p 'test_*.py'
```

The explicit inclusion list excludes private settings, logs, recovery archives, obsolete exports, and unfinished publishing templates. The portable Inquiry contract is `Radial Timeline/Inquiry/Sessions/sessions.json`; it must travel with the book. Plugin installation is separate.

Checks require full chapter text correspondence with the included source, contiguous chapter numbers, unique IDs, saved Pulse coverage, ordered illustrative dates, consistent latest Gossamer runs, valid Inquiry evidence references, and resolved wiki links. ZIP entries have deterministic metadata; `release-inventory.json` records the exact archive and content hashes. Existing output directories are refused. Literary judgments and factual AI claims still require human/agent editorial review.

The current validator supports the prepared P&P Markdown chapter layout. Odyssey, Holmes, and The Faerie Queene need their own reviewed source layout and explicit contracts before inclusion. Do not infer their readiness from this configuration or manufacture missing analyses.

Before public replacement: extract the exact ZIP into a fresh QA vault; test sample detection, all four timeline modes, and saved Inquiry browsing with AI disabled, including citation navigation and reopening. Back up the current public ZIP, upload the accepted artifact, and verify downloaded bytes through the public delivery URL.
