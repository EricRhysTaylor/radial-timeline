import { createHash } from 'crypto'; // SAFE: desktop-only fingerprints for the generated local search cache
import type { DataAdapter } from 'obsidian';
import type { AIRequestControl } from '../ai/types';
import { extractKeywords, type ConceptSearchScene } from './ConceptSearchService';

const INDEX_VERSION = 2;
const MAX_CANDIDATES = 12;
const MAX_PASSAGES = 3;
type Scope = 'fields' | 'body';
interface IndexedText { hash: string; passages: string[] }
interface Entry { fields?: IndexedText; body?: IndexedText }
interface DiskIndex { schemaVersion: number; entries: Record<string, Entry> }
export interface SemanticIndexStats { candidates: number; total: number; updatedNotes: number; passages: number; elapsedMs: number }
interface QueryInput {
    /** Original query followed by search terms expanded by the already selected local model. */
    queries: string[];
    scenes: ConceptSearchScene[];
    control: AIRequestControl;
    signal?: AbortSignal;
    onProgress: (done: number, total: number) => void;
}
const fingerprint = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

/** Exact overlapping source excerpts. Building the index uses no model or network requests. */
function passagesFor(text: string): string[] {
    const passages: string[] = [];
    for (let start = 0; start < text.length;) {
        let end = Math.min(text.length, start + 1200);
        if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1])) end -= 1;
        passages.push(text.slice(start, end));
        if (end === text.length) break;
        start = end - 200;
        if (/[\uDC00-\uDFFF]/.test(text[start])) start += 1;
    }
    return passages;
}

/** Vault-local text index; semantic expansion and verification use the one configured LLM. */
export class LocalSemanticIndex {
    private entries = new Map<string, Entry>();
    private loaded = false;
    private dirty = false;
    private mutation = 0;
    private readonly revisions = new Map<string, number>();
    private queue: Promise<void> = Promise.resolve();
    constructor(private readonly adapter: DataAdapter, readonly directory: string) {}

    invalidate(path: string): void {
        this.revisions.set(path, (this.revisions.get(path) ?? 0) + 1);
        if (this.entries.delete(path)) this.dirty = true;
        this.mutation += 1;
    }

    query(input: QueryInput): Promise<{ scenes: ConceptSearchScene[]; stats: SemanticIndexStats }> {
        const revisions = new Map(input.scenes.map(scene => [scene.path, this.revisions.get(scene.path) ?? 0]));
        const pending = this.queue.then(() => this.execute(input, revisions));
        this.queue = pending.then(() => undefined, () => undefined); // SAFE: release the transaction queue; the caller receives the error
        return pending;
    }

    private async load(): Promise<void> {
        if (this.loaded) return;
        const path = `${this.directory}/index.json`;
        if (await this.adapter.exists(path)) {
            let disk: DiskIndex;
            try { disk = JSON.parse(await this.adapter.read(path)) as DiskIndex; }
            catch { throw new Error(`Local search index is unreadable. Remove ${path} to rebuild it.`); }
            // Explicit migration: the removed encoder's v1 vectors have no role in the text index.
            if (disk?.schemaVersion !== 1) {
                if (!disk || disk.schemaVersion !== INDEX_VERSION || !disk.entries || typeof disk.entries !== 'object' || Array.isArray(disk.entries)) {
                    throw new Error(`Local search index has an unsupported format. Remove ${path} to rebuild it.`);
                }
                for (const [key, entry] of Object.entries(disk.entries)) {
                    if (!entry || typeof entry !== 'object' || Object.keys(entry).some(scope => scope !== 'fields' && scope !== 'body')) {
                        throw new Error(`Invalid scene entry in ${path}. Remove the cache to rebuild it.`);
                    }
                    for (const record of [entry.fields, entry.body]) {
                        if (record !== undefined && (!record || !/^[a-f0-9]{64}$/.test(record.hash)
                            || !Array.isArray(record.passages) || !record.passages.length
                            || record.passages.some(text => typeof text !== 'string' || !text.length))) {
                            throw new Error(`Invalid passages in ${path}. Remove the cache to rebuild it.`);
                        }
                    }
                    this.entries.set(key, entry);
                }
            } else this.dirty = true;
        }
        this.loaded = true;
    }

    private async save(input: QueryInput): Promise<void> {
        input.control.assertActive();
        const mutation = this.mutation;
        if (!await this.adapter.exists(this.directory)) await this.adapter.mkdir(this.directory);
        const temp = `${this.directory}/index.tmp.json`, path = `${this.directory}/index.json`;
        await this.adapter.write(temp, JSON.stringify({ schemaVersion: INDEX_VERSION, entries: Object.fromEntries(this.entries) }));
        input.control.assertActive();
        // Obsidian refuses rename over an existing file; write the complete generated cache first.
        if (await this.adapter.exists(path)) await this.adapter.remove(path);
        await this.adapter.rename(temp, path);
        if (this.mutation === mutation) this.dirty = false;
    }

    private async execute(input: QueryInput, revisions: Map<string, number>): Promise<{ scenes: ConceptSearchScene[]; stats: SemanticIndexStats }> {
        const started = Date.now();
        const unchanged = () => {
            input.control.assertActive();
            if (input.signal?.aborted) throw new Error('Search cancelled.');
            if (input.scenes.some(scene => (this.revisions.get(scene.path) ?? 0) !== revisions.get(scene.path))) {
                throw new Error('Scene text changed during indexing. Search again to update the index.');
            }
        };
        unchanged();
        await this.load();
        unchanged();
        for (const path of this.entries.keys()) {
            if (!await this.adapter.exists(path)) { this.entries.delete(path); this.dirty = true; }
        }
        const changed = new Set<string>();
        input.onProgress(0, input.scenes.length);
        for (const [at, scene] of input.scenes.entries()) {
            if (!await this.adapter.exists(scene.path)) throw new Error('A selected scene was removed during indexing. Search again for the current corpus.');
            unchanged();
            const entry = this.entries.get(scene.path) ?? {}; // SAFE: a new note has no cached scopes
            for (const [scope, text] of [['fields', scene.fieldsText], ['body', scene.bodyText]] as const) {
                if (!text?.trim()) continue;
                const hash = fingerprint(text);
                if (entry[scope]?.hash !== hash) {
                    entry[scope] = { hash, passages: passagesFor(text) };
                    changed.add(scene.path); this.dirty = true;
                }
                if (entry[scope].passages.some(passage => !text.includes(passage))) throw new Error('Cached passage is absent from its selected source. Remove the search index to rebuild it.');
            }
            this.entries.set(scene.path, entry);
            input.onProgress(at + 1, input.scenes.length);
        }
        if (this.dirty) await this.save(input);
        unchanged();
        const passages = input.scenes.map(scene => {
            const entry = this.entries.get(scene.path);
            return (['fields', 'body'] as Scope[]).flatMap(scope => {
                const selected = scope === 'fields' ? scene.fieldsText : scene.bodyText;
                return selected?.trim() ? entry![scope]!.passages.map(text => ({ text, scope, lower: text.toLowerCase() })) : [];
            });
        });
        const all = passages.flat();
        const keywords = [...new Set(input.queries.flatMap(extractKeywords))];
        const frequencies = new Map(keywords.map(term => [term, all.filter(passage => passage.lower.includes(term)).length]));
        const original = input.queries[0]?.toLowerCase() ?? '';
        const score = (passage: typeof all[number]) => {
            const exact = original.length > 0 && passage.lower.includes(original);
            return (exact ? 1000 : 0) + keywords.reduce((sum, term) => sum + (passage.lower.includes(term)
                ? Math.log(1 + all.length / (frequencies.get(term)! + 1)) : 0), 0);
        };
        const ranked = passages.map((items, index) => ({ index,
            items: items.map((item, at) => ({ ...item, at, score: score(item) })).sort((a, b) => b.score - a.score || a.at - b.at)
        })).filter(scene => scene.items.some(item => item.score > 0));
        ranked.sort((a, b) => b.items[0].score - a.items[0].score || a.index - b.index);
        const scenes = ranked.slice(0, MAX_CANDIDATES).map(({ index, items }) => {
            const source = input.scenes[index];
            const chosen = items.slice(0, MAX_PASSAGES).sort((a, b) => a.at - b.at);
            return { path: source.path,
                fieldsText: chosen.filter(item => item.scope === 'fields').map(item => item.text).join('\n[passage gap]\n') || undefined,
                bodyText: chosen.filter(item => item.scope === 'body').map(item => item.text).join('\n[passage gap]\n') || undefined,
                indexedPassages: chosen.map(item => ({ text: item.text, source: item.scope === 'fields' ? 'timelineFields' as const : 'body' as const })),
                grounding: source };
        });
        return { scenes, stats: { candidates: scenes.length, total: input.scenes.length, updatedNotes: changed.size,
            passages: all.length, elapsedMs: Date.now() - started } };
    }
}
