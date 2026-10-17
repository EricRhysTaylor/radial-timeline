# Demo vault releases

This is the maintained content-only packager. It replaces the legacy helper under the Sherlock Holmes ingestion folder. Canonical book preparation, user-operated AI runs, and literary review happen before packaging.

```sh
uv run scripts/demo-vaults/package_sample_vault.py \
  --source '/path/to/canonical/vault' \
  --dist '/path/to/new/output-directory' \
  --config scripts/demo-vaults/pride-and-prejudice.json
uv run --with pyyaml==6.0.2 --with beautifulsoup4==4.13.4 python -m unittest discover -s scripts/demo-vaults -p 'test_*.py'
```

The explicit inclusion list excludes private settings, logs, recovery archives, obsolete exports, and unfinished publishing templates. P&P now includes 120 reader-facing files: its four reviewed Gossamer runs are the only retained beat history, and the source hash, three required Inquiry questions and reviewed beat positions are pinned in its contract. Removed preparation files and original model outputs are preserved outside the canonical vault. Public Inquiry sessions omit `logPath`, and their Markdown briefs omit the matching “View full Inquiry Log” link because those working logs are excluded. Findings, quotes, and manuscript prose remain unchanged. `release-inventory.json` records both canonical source hashes and packaged hashes so this small public export adjustment is auditable. The portable Inquiry contract is `Radial Timeline/Inquiry/Sessions/sessions.json`; it must travel with the book. Plugin installation is separate.

Checks require full text correspondence with the included source, contiguous scene numbers, unique IDs, saved Pulse coverage, consistent latest Gossamer runs, complete Inquiry answers with valid references, and resolved wiki links. P&P's illustrative chapter dates must remain ordered. ZIP entries have deterministic metadata; `release-inventory.json` records the exact archive and content hashes. Existing output directories are refused. Literary judgments and factual AI claims still require human/agent editorial review.

The validator supports P&P's Markdown chapter layout and the Odyssey's reviewed Gutenberg HTML layout. `odyssey.json` checks all 24 source books across 89 scenes, the three act assignments, original source hashes, and the twelve reviewed beat positions. Its event dates may move backward in narrative order because the wanderings are told retrospectively. The Odyssey contract requires quoted Inquiry evidence; answers recovered from rejected references without their original quotes cannot be packaged as finished. HTML and the original JPEG cover are allowed only for this explicit layout. The Odyssey inclusion list has 191 public content files and excludes all local settings, logs, and recovery material.

Use `--config scripts/demo-vaults/odyssey.json` for the Odyssey. A supported layout is not a readiness claim: quoted Inquiry results must validate, and fresh-profile QA remains required. The Faerie Queene still needs its own reviewed source layout and explicit contract. Do not infer readiness from another book or manufacture missing analyses.

`sherlock-holmes.json` covers the four complete novels: 56 chapters, 41 reviewed beat placements, four accepted Gossamer runs per book, and three accepted Inquiry answers per book. Its 191-file inclusion list preserves the original Gutenberg HTML and referenced illustrations. Source comparison removes chapter headings and illustration captions and requires every narrative non-whitespace character to match, including case and punctuation. Acts and defensible dates are pinned; unsupported calendar years remain blank. Global IDs, each session's full selected-book corpus, primary and supporting quotes, and the four-book sample manifest are checked. Public export retains only the twelve explicitly reviewed run IDs and sets the collection identity; original AI results and working history are preserved. Use `--config scripts/demo-vaults/sherlock-holmes.json`. Fresh-profile QA and a public plugin with multi-book sample support are required before promotion.

Before public replacement: extract the exact ZIP into a fresh QA vault; test sample detection, all four timeline modes, and saved Inquiry browsing with AI disabled, including citation navigation and reopening. Back up the current public ZIP, upload the accepted artifact, and verify downloaded bytes through the public delivery URL.

## Verse source preparation

`prepare_faerie_queene_source.py` conditions Smith's Gutenberg #70717 and #72698 into source notes for manuscript preparation. The shipped Import manuscript workflow is the product path; explicitly requested direct agent preparation can instead create and register working notes separately. The conditioner does not ingest scenes, generate metadata, invoke providers or change plugin settings. Supply the original HTML files and a new output directory:

```sh
uv run scripts/demo-vaults/prepare_faerie_queene_source.py \
  --volume-one '/path/to/pg70717-images.html' \
  --volume-two '/path/to/pg72698-images.html' \
  --output '/path/to/new/Prepared Source'
RT_VERSE_SOURCE_QA='/path/to/new/Prepared Source' \
  npx vitest run tests/preparedVerseSource.test.ts
```

The conditioner validates all six complete books and the surviving Mutabilitie VI–VIII: 75 narrative units and six separately held proems, 3,848 nine-line stanzas and 296 argument lines. Source references and unique stanza ordinals accompany the printed Roman labels. It preserves the verified II.x ordinal 74 / printed `lxiv` discrepancy explicitly. The alternative 1590 ending of Book III stays in the original HTML, outside the continuing narrative; so do editorial apparatus and supporting documents. Generated source notes contain no `Class: Scene` or invented analyses. Unexpected stanza sequences/line counts and existing output directories stop preparation.

The opt-in acceptance test feeds all 75 canto files through the real Markdown adapter, split-confirmation model and structure-only proposal builder. It checks hashes, source references, verse bodies and separation of proems without a provider. It does not claim native modal acceptance or an AI result. Regression tests cover missing lines/stanzas, reference retention, inline note calls and the unfinished fragment.

**Current working-vault checkpoint, October 17:** the owner requested direct agent onboarding. All 75 canto units are working scene notes in seven books, and all seven literary passes are complete: canto summaries/synopses, continuous book accounts, narrative frames and selective entity profiles. The next user-operated provider batch is Book I Pulse. Do not import the manuscript again. Every canto body and identity is preserved. The source arguments, textual variants and unfinished VIII fragment retain their declared scope. Agent-written summaries carry agent attribution, not invented API logs.

For a separate **product onboarding rehearsal**, select the individual source folder, choose the intended import mode, and keep all canto boundaries at Confirm scenes with Continue rather than optional Auto-split. Source preprocessing and direct content preparation do not certify that product path. All provider calls remain user-operated.

No Faerie Queene release contract is provided yet. Source conditioning is distinct from accepted metadata, accepted analyses, exact-package acceptance and publication. Add an explicit verse-aware scene/source contract after the working manuscript and literary metadata are accepted, then perform the normal fresh-vault release checks.
