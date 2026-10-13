# Local indexed concept search

Local AI search keeps two explicit modes. The existing full sweep reads every
selected scene with the local generation model. **Use semantic index** retrieves
up to 12 likely scenes and checks up to three selected passages per candidate.
It reports that coverage and can miss other matches. Unchecking the index returns
to the full sweep; an unavailable index never silently starts a slow full sweep.
Literal search does not call either AI service, including when the saved index
preference is checked. Fields/prose selection governs both indexing and retrieval.

## Runtime and cache

The companion CPU service binds only to `127.0.0.1:8081`. It uses the pinned English
[`BAAI/bge-small-en-v1.5`](https://huggingface.co/BAAI/bge-small-en-v1.5) ONNX model with CLS pooling, normalized 384-dimensional
vectors, 440-token passages, and 64-token overlap. It rejects oversized queries
instead of truncating them. It logs neither source text nor queries. Ordinary
startup uses cached model files offline; installation is an explicit command.
The existing generation model and its RAM/context settings are unchanged.

The generated cache lives in each vault at
`.obsidian/plugins/radial-timeline/search-index/index.json` (using the vault's
actual configuration directory). It contains passage text and vectors, stamped
with schema version and encoder identity. It is private local operational state,
not scene YAML or author prose. Removing this generated cache rebuilds it on the
next indexed search. Invalid cache data causes an actionable error rather than
being silently replaced. A new encoder identity explicitly invalidates vectors.

Each scope has a content fingerprint. Modify/rename/delete events invalidate
cached records; each search reconciles the current corpus and refreshes only
changed selected text before retrieval. New notes are added and deleted paths
are removed. An edit during a pending transaction prevents stale results from
committing. There is no automatic AI execution in response to editor activity.

Dense ranking is combined with exact phrase retrieval in the selected scopes.
The same original-query semantic rules check relationships, timing, AND/OR and
exclusions in both AI modes. Indexed replies cite numbered passages; the plugin
turns those IDs into its own exact source excerpts for editor highlights. Invalid
IDs, missing support, incompatible vectors and unavailable services remain
visible failures. A saved result is not a guarantee of exhaustive relevance.

## Setup and restart (Mac)

```sh
npm run search:index:setup
npm run search:index:start
npm run search:index:status
```

Setup requires `uv`, installs the pinned CPU dependencies in
`~/.local/share/radial-timeline-search/venv`, and downloads the pinned model files.
The generation service remains controlled by `npm run server`. The owner's
Desktop `Restart Local AI.command` restores the 56 GiB GPU wired limit, restarts
and warms the generation model, then restarts the index encoder. It asks for the
administrator password only when the wired limit needs restoring after reboot.
The encoder uses CPU memory and does not alter that GPU limit.

## Verification contract

- Compare complete filenames/evidence, not only hit counts, on warm and first-index runs.
- Check labelled concept fixtures with more notes than the shortlist: OR, relationships,
  evidence separated across long scenes, and negative controls.
- Verify fields-only/prose-only/combined/no-scope and literal punctuation independently.
- Verify restart reuse, edits, metadata changes, new/renamed/deleted notes, stale reads,
  cancellation/supersession, permission withdrawal, model identity changes and corrupt cache errors.
- Keep manuscript hashes unchanged; temporary fixtures and author benchmark text stay private.
- Run TypeScript, build-only and the repository gates; native UI acceptance is a separate evidence level.
