# Indexed concept search with one local server

The only AI dependency is the server address and model already selected in
Settings → AI. Search never starts, stops, installs or reconfigures a server or
loads another model. The owner's Desktop launcher controls only their existing
local LLM server. There is no companion encoder, second endpoint or model download.

## Index and retrieval

**Use search index** builds a plugin-managed text index in each vault's
`.obsidian/plugins/radial-timeline/search-index/index.json` (using its actual
configuration directory). It contains exact source excerpts and per-scope content
fingerprints. Building and refreshing this index requires no AI or network calls.
Schema version 2 replaces the removed experimental vector-cache format.

On an explicitly requested indexed concept search, the selected LLM expands the
query into search terms. The plugin ranks local passages by term overlap weighted
by rarity, and prioritizes exact original-query occurrences. The same selected
LLM verifies the original request against up to three passages from each of up
to 12 candidate scenes. It cites numbered passages; the plugin supplies the exact
source excerpts for highlights. This is approximate retrieval, not exhaustive
semantic coverage. The UI discloses the number of scenes reviewed. Turning the
index off runs the existing full sweep. Failures never silently switch modes.

Fields/body selection governs indexing, retrieval and evidence. New and changed
scenes refresh before retrieval; deleted records are removed and rename/modify/
delete events invalidate stale entries. Changes during a transaction prevent
stale results from committing. No AI runs merely because a scene is edited.
Literal search bypasses both the index and LLM.

## Availability and verification

Only the configured LLM server is checked, via metadata, on opening the panel and
every five seconds while open, with a two-second timeout. A muted × and reason
identify unavailable AI options. Selected options remain switchable off; probes
never change preferences or run queries. Closing the panel stops checking.

Verify literal scopes and punctuation; concept OR/AND, relationships, exclusions,
and long scenes; index persistence, edits, creates, renames, deletes, cancellation,
corrupt caches and permission withdrawal. Benchmark the new retrieval separately
from the removed encoder implementation. Retain exact manuscript hashes, labelled
fixtures, TypeScript/build/gate results, and native evidence.
