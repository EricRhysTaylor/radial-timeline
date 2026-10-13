import { createHash } from 'crypto'; // SAFE: desktop-only local index fingerprints; no remote hashing or credentials
import type { DataAdapter } from 'obsidian';
import type { AIRequestControl } from '../ai/types';
import { requestProvider } from '../api/providerTransport';
import type { ConceptSearchScene } from './ConceptSearchService';
import { escapeRegExp } from '../utils/regex';

/** The companion encoder always lives on this computer; manuscripts never go to a cloud embedding API. */
const ENDPOINT = 'http://127.0.0.1:8081/v1';
const INDEX_VERSION = 1;
const MAX_CANDIDATES = 12;
const MAX_PASSAGES = 3;
type Scope = 'fields' | 'body';
export interface IndexedPassage { text: string; vector: number[] }
interface IndexedText { hash: string; passages: IndexedPassage[] }
interface Entry { fields?: IndexedText; body?: IndexedText }
interface Model { schemaVersion: number; identity: string; dimensions: number; language: string }
interface DiskIndex { schemaVersion: number; identity: string; entries: Record<string, Entry> }
export interface SemanticIndexStats { candidates: number; total: number; updatedNotes: number; passages: number; elapsedMs: number }
interface QueryInput {
    queries: string[];
    scenes: ConceptSearchScene[];
    control: AIRequestControl;
    signal?: AbortSignal;
    onProgress: (done: number, total: number) => void;
}
const fingerprint = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');
const dot = (a: number[], b: number[]) => a.reduce((sum, value, index) => sum + value * b[index], 0);
function validPassages(value: unknown, dimensions: number): value is IndexedPassage[] {
    return Array.isArray(value) && value.length > 0 && value.every((passage: unknown) => {
        if (!passage || typeof passage !== 'object') return false;
        const candidate = passage as Record<string, unknown>;
        if (typeof candidate.text !== 'string' || !candidate.text.trim() || !Array.isArray(candidate.vector)) return false;
        const vector: unknown[] = candidate.vector;
        if (vector.length !== dimensions || !vector.every((number): number is number => typeof number === 'number' && Number.isFinite(number))) return false;
        return Math.abs(dot(vector, vector) - 1) < 0.01;
    });
}

/** Persist scoped passage vectors and refresh only changed text before retrieval. */
export class LocalSemanticIndex {
    private entries = new Map<string, Entry>();
    private identity?: string;
    private dirty = false;
    private mutation = 0;
    private readonly revisions = new Map<string, number>();
    private queue: Promise<void> = Promise.resolve();
    constructor(private readonly adapter: DataAdapter, readonly directory: string) {}

    /** File events remove stale vectors synchronously, including changes during an embedding call. */
    invalidate(path: string): void {
        this.revisions.set(path, (this.revisions.get(path) ?? 0) + 1);
        if (this.entries.delete(path)) this.dirty = true;
        this.mutation += 1;
    }

    query(input: QueryInput): Promise<{ scenes: ConceptSearchScene[]; stats: SemanticIndexStats }> {
        const pending = this.queue.then(() => this.execute(input));
        this.queue = pending.then(() => undefined, () => undefined); // SAFE: release the cache transaction queue; the caller still receives the error
        return pending;
    }
    private async request(path: string, input: QueryInput, payload?: unknown): Promise<unknown> {
        input.control.assertActive();
        let response;
        try {
            response = await requestProvider({ url: `${ENDPOINT}/${path}`, method: payload === undefined ? 'GET' : 'POST',
                headers: { 'Content-Type': 'application/json' }, body: payload === undefined ? undefined : JSON.stringify(payload) },
            input.control, { allowHttp: true, signal: input.signal, maxResponseBytes: 32 * 1024 * 1024 });
        } catch (error) {
            input.control.assertActive();
            const message = error instanceof Error ? error.message : String(error);
            throw new Error(`Local semantic-index service is unavailable. Run the desktop Local AI launcher or npm run search:index:start. ${message}`);
        }
        input.control.assertActive();
        if (response.status !== 200) {
            const error = response.json as { error?: unknown } | undefined;
            const message = typeof error?.error === 'string' ? error.error : 'The service supplied no error details.';
            throw new Error(`Local search encoder (HTTP ${response.status}): ${message}`);
        }
        return response.json;
    }
    private async load(model: Model, input: QueryInput): Promise<void> {
        if (this.identity === model.identity) return;
        const path = `${this.directory}/index.json`;
        if (await this.adapter.exists(path)) {
            input.control.assertActive();
            let disk: DiskIndex;
            try { disk = JSON.parse(await this.adapter.read(path)) as DiskIndex; }
            catch { throw new Error(`Local search index is unreadable. Remove ${path} to rebuild it.`); }
            if (!disk || disk.schemaVersion !== INDEX_VERSION || typeof disk.identity !== 'string' || !disk.entries || typeof disk.entries !== 'object' || Array.isArray(disk.entries)) {
                throw new Error(`Local search index has an unsupported format. Remove ${path} to rebuild it.`);
            }
            this.entries.clear();
            if (disk.identity === model.identity) {
                for (const [key, entry] of Object.entries(disk.entries)) {
                    if (!entry || typeof entry !== 'object' || Object.keys(entry).some(scope => scope !== 'fields' && scope !== 'body')) {
                        throw new Error(`Invalid scene entry in ${path}. Remove the cache to rebuild it.`);
                    }
                    for (const record of [entry.fields, entry.body]) {
                        if (record !== undefined && (!record || !/^[a-f0-9]{64}$/.test(record.hash) || !validPassages(record.passages, model.dimensions))) {
                            throw new Error(`Invalid passage vectors in ${path}. Remove the cache to rebuild it.`);
                        }
                    }
                    this.entries.set(key, entry);
                }
            }
        } else this.entries.clear();
        input.control.assertActive();
        this.identity = model.identity;
    }
    private async save(input: QueryInput): Promise<void> {
        input.control.assertActive();
        const mutation = this.mutation;
        if (!await this.adapter.exists(this.directory)) await this.adapter.mkdir(this.directory);
        const disk: DiskIndex = { schemaVersion: INDEX_VERSION, identity: this.identity!, entries: Object.fromEntries(this.entries) };
        const temp = `${this.directory}/index.tmp.json`, path = `${this.directory}/index.json`;
        await this.adapter.write(temp, JSON.stringify(disk));
        input.control.assertActive();
        // Obsidian's adapter refuses to rename onto an existing target. The
        // complete new cache is written first; an interruption in this narrow
        // replacement gap leaves a cache miss, never half-written source data.
        if (await this.adapter.exists(path)) await this.adapter.remove(path);
        await this.adapter.rename(temp, path);
        if (this.mutation === mutation) this.dirty = false;
    }
    private async embed(texts: string[], kind: 'query' | 'document', model: Model, input: QueryInput): Promise<IndexedPassage[][]> {
        const data = await this.request('search-embeddings', input, { texts, kind }) as { schemaVersion: number; identity: string; documents: unknown[] };
        if (!data || data.schemaVersion !== 1 || data.identity !== model.identity || !Array.isArray(data.documents)
            || data.documents.length !== texts.length || !data.documents.every(group => validPassages(group, model.dimensions))) {
            throw new Error('Local search encoder returned invalid or incompatible vectors. No index entries were substituted.');
        }
        for (let index = 0; index < texts.length; index++) {
            const passages = data.documents[index];
            if (kind === 'query' && (passages.length !== 1 || passages[0].text !== texts[index])) throw new Error('Invalid query embedding response.');
            if (kind === 'document' && (!passages.length || passages.some(passage => !texts[index].includes(passage.text)))) {
                throw new Error('Embedding passage is absent from its selected source text.');
            }
        }
        return data.documents;
    }
    private async execute(input: QueryInput): Promise<{ scenes: ConceptSearchScene[]; stats: SemanticIndexStats }> {
        const started = Date.now();
        const revisions = new Map(input.scenes.map(scene => [scene.path, this.revisions.get(scene.path) ?? 0]));
        const unchanged = () => {
            input.control.assertActive();
            if (input.scenes.some(scene => (this.revisions.get(scene.path) ?? 0) !== revisions.get(scene.path))) {
                throw new Error('Scene text changed during indexing. Search again to update the index.');
            }
        };
        const model = await this.request('index-model', input) as Model;
        if (!model || model.schemaVersion !== 1 || typeof model.identity !== 'string' || !model.identity
            || !Number.isInteger(model.dimensions) || model.dimensions < 1 || model.dimensions > 4096 || model.language !== 'en') {
            throw new Error('The local English search encoder has an incompatible model contract.');
        }
        await this.load(model, input);
        unchanged();
        let removed = false;
        for (const path of this.entries.keys()) {
            if (!await this.adapter.exists(path)) { this.entries.delete(path); removed = true; }
        }
        for (const scene of input.scenes) {
            if (!await this.adapter.exists(scene.path)) throw new Error('A selected scene was removed during indexing. Search again for the current corpus.');
        }
        unchanged();
        const changed: Array<{ path: string; scope: Scope; text: string; hash: string }> = [];
        for (const scene of input.scenes) {
            for (const [scope, text] of [['fields', scene.fieldsText], ['body', scene.bodyText]] as const) {
                if (!text?.trim()) continue;
                const hash = fingerprint(text);
                if (this.entries.get(scene.path)?.[scope]?.hash !== hash) changed.push({ path: scene.path, scope, text, hash });
            }
        }
        const remaining = new Map<string, number>();
        for (const item of changed) remaining.set(item.path, (remaining.get(item.path) ?? 0) + 1);
        const updatedNotes = remaining.size;
        let completed = 0;
        input.onProgress(completed, updatedNotes);
        for (let offset = 0; offset < changed.length; offset += 8) {
            unchanged();
            const batch = changed.slice(offset, offset + 8);
            const vectors = await this.embed(batch.map(item => item.text), 'document', model, input);
            unchanged();
            batch.forEach((item, index) => {
                const entry = this.entries.get(item.path) ?? {}; // SAFE: a new note has no cached scopes yet
                entry[item.scope] = { hash: item.hash, passages: vectors[index] };
                this.entries.set(item.path, entry);
                remaining.set(item.path, remaining.get(item.path)! - 1);
                if (remaining.get(item.path) === 0) completed += 1;
            });
            input.onProgress(completed, updatedNotes);
        }
        if (changed.length || removed || this.dirty) await this.save(input);
        unchanged();
        const queryVectors = (await this.embed(input.queries, 'query', model, input)).map(group => group[0].vector);
        unchanged();
        const passages = input.scenes.map(scene => {
            const entry = this.entries.get(scene.path);
            return [ ...(scene.fieldsText?.trim() ? (entry?.fields?.passages ?? []).map(passage => ({ ...passage, scope: 'fields' as const })) : []),
                ...(scene.bodyText?.trim() ? (entry?.body?.passages ?? []).map(passage => ({ ...passage, scope: 'body' as const })) : []) ];
        });
        const ranks = queryVectors.map(vector => input.scenes.map((scene, index) => ({ index,
            score: Math.max(...passages[index].map(passage => dot(passage.vector, vector))) }))
            .sort((a, b) => b.score - a.score || a.index - b.index));
        const fused = input.scenes.map((_, index) => ranks.reduce((sum, rank) => sum + 1 / (40 + rank.findIndex(item => item.index === index)), 0));
        const candidates = new Set<number>();
        const phrase = new RegExp(escapeRegExp(input.queries[0]), 'iu');
        const exact = input.scenes.map((scene, index) => ({ scene, index }))
            .filter(({ scene }) => phrase.test(`${scene.fieldsText ?? ''}\n${scene.bodyText ?? ''}`)).map(({ index }) => index);
        // Exact selected-scope phrases join dense retrieval; lexical search itself is unchanged.
        exact.forEach(index => candidates.add(index));
        const share = Math.max(1, Math.floor(MAX_CANDIDATES / ranks.length));
        for (const rank of ranks) for (const item of rank.slice(0, share)) candidates.add(item.index);
        const order = input.scenes.map((_, index) => index).sort((a, b) => fused[b] - fused[a] || a - b);
        // A bounded shortlist is explicit product behavior, never presented as a complete sweep.
        const selected = [...candidates].sort((a, b) => Number(exact.includes(b)) - Number(exact.includes(a)) || fused[b] - fused[a] || a - b).slice(0, MAX_CANDIDATES);
        for (const index of order) if (selected.length < MAX_CANDIDATES && !selected.includes(index)) selected.push(index);
        const scenes = selected.map(index => {
            const source = input.scenes[index];
            const items = passages[index];
            const picked = new Set<number>();
            items.forEach((item, at) => { if (phrase.test(item.text)) picked.add(at); });
            for (const vector of queryVectors) {
                const sorted = items.map((item, at) => ({ at, score: dot(item.vector, vector) })).sort((a, b) => b.score - a.score || a.at - b.at);
                for (const item of sorted.slice(0, 3)) picked.add(item.at);
            }
            const chosen = [...picked].slice(0, MAX_PASSAGES).sort((a, b) => a - b).map(at => items[at]);
            return { path: source.path,
                fieldsText: chosen.filter(item => item.scope === 'fields').map(item => item.text).join('\n[passage gap]\n') || undefined,
                bodyText: chosen.filter(item => item.scope === 'body').map(item => item.text).join('\n[passage gap]\n') || undefined,
                indexedPassages: chosen.map(item => ({ text: item.text, source: item.scope === 'fields' ? 'timelineFields' as const : 'body' as const })),
                grounding: source };
        });
        return { scenes, stats: { candidates: scenes.length, total: input.scenes.length, updatedNotes,
            passages: passages.reduce((count, group) => count + group.length, 0), elapsedMs: Date.now() - started } };
    }
}
