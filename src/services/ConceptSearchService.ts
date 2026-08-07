/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 */

/**
 * Concept search — asking the manuscript a question it answers without using
 * those words.
 *
 * The model proposes; verbatim quotes decide. Every quote it returns is checked
 * against the text that was actually sent, and anything unverifiable is dropped
 * and counted in plain sight. A local model that is confidently wrong is the
 * expected case, not the exceptional one, so nothing reaches the timeline on
 * the model's say-so alone.
 *
 * Runs only against the operator's own local server. There is no cloud path
 * here — not as an option, not as a fallback. Manuscript prose leaves the
 * machine only when the author explicitly chooses a cloud feature, and this is
 * never that choice.
 */

import type RadialTimelinePlugin from '../main';
import { getLocalLlmBackend } from '../ai/localLlm/backends';
import { LOCAL_LLM_BACKEND_LABELS } from '../ai/localLlm/settings';
import { runStructuredJsonPipeline } from '../ai/localLlm/structuredJson';
import { getCredential } from '../ai/credentials/credentials';
import { estimateTokensFromText } from '../ai/tokens/inputTokenEstimate';
import { PROVIDER_CAPS } from '../ai/caps/providerCaps';
import type { LocalLlmSettings } from '../ai/types';
import type { SearchHitSource, TimelineSearchHit } from './searchState';

/** A scene as it will be shown to the model, with the pieces kept separable. */
export interface ConceptSearchScene {
    path: string;
    /** Displayed timeline-field text, when that scope is on. */
    fieldsText?: string;
    /** Scene prose, when body scope is on. */
    bodyText?: string;
}

export interface ConceptSearchProgress {
    /** 1-based. */
    chunk: number;
    chunkCount: number;
}

export interface ConceptSearchOutcome {
    hits: TimelineSearchHit[];
    /**
     * Scenes the model named whose quotes could not be found in the text it was
     * given. Surfaced to the author rather than swallowed: a high number means
     * the model is inventing, and hiding that would present a thin sweep as a
     * complete one.
     */
    droppedClaims: number;
}

/** Thrown when the author cancels; the caller discards the transaction. */
export class ConceptSearchCancelled extends Error {
    constructor() {
        super('Concept search cancelled.');
        this.name = 'ConceptSearchCancelled';
    }
}

export interface CancelToken {
    cancelled: boolean;
}

/**
 * Input-token budget per chunk, when the operator has NOT declared long context.
 *
 * Deliberately small. A local model's real context length is not something the
 * plugin can discover — it is set when the model is loaded, outside Obsidian —
 * and overshooting it does not degrade gracefully: the server rejects the whole
 * request. Most local models are loaded at 4k–8k, so this leaves comfortable
 * room for the prompt scaffold and the reply.
 *
 * `computeCaps` is not used here. It is built around cloud models whose windows
 * are published facts; deriving a precise-looking number from an unknown would
 * only make a guess look authoritative.
 */
const DEFAULT_CHUNK_INPUT_TOKEN_BUDGET = 2_000;

/**
 * Budget when the operator has declared `longContext` in Settings → AI.
 *
 * Their declaration is the only trustworthy signal about the loaded window, so
 * it — not a guess — is what unlocks larger, faster passes.
 */
const LONG_CONTEXT_CHUNK_INPUT_TOKEN_BUDGET = Math.floor(PROVIDER_CAPS.ollama.defaultInputTokens * 0.5);

/** The per-chunk budget this configuration can safely fill. */
export function chunkBudgetFor(localLlm: LocalLlmSettings): number {
    return localLlm.declaredCapabilities?.includes('longContext')
        ? LONG_CONTEXT_CHUNK_INPUT_TOKEN_BUDGET
        : DEFAULT_CHUNK_INPUT_TOKEN_BUDGET;
}

/** Long enough to be evidence, short enough to survive exact matching. */
const MAX_QUOTE_WORDS = 15;

const MATCH_SCHEMA: Record<string, unknown> = {
    type: 'object',
    required: ['matches'],
    properties: {
        matches: {
            type: 'array',
            items: {
                type: 'object',
                required: ['scene_id', 'reason', 'quotes'],
                properties: {
                    scene_id: { type: 'string' },
                    reason: { type: 'string' },
                    quotes: { type: 'array', items: { type: 'string' } }
                }
            }
        }
    }
};

const SYSTEM_PROMPT = [
    'You find scenes in a novel that bear on the reader\'s question.',
    'Return only scenes that genuinely bear on it. Returning nothing is a valid, useful answer.',
    `Every quote MUST be copied verbatim from the scene text you were given — same words, same spelling, same punctuation — and at most ${MAX_QUOTE_WORDS} words.`,
    'A quote you cannot copy exactly is worse than no quote: it will be discarded.',
    'Respond with JSON only.'
].join(' ');

interface ModelMatch {
    scene_id: string;
    reason: string;
    quotes: string[];
}

/** The text a scene contributes, labelled so the model can cite precisely. */
function renderScene(scene: ConceptSearchScene, id: number): string {
    const parts: string[] = [`### SCENE ${id}`];
    if (scene.fieldsText) parts.push(`Details: ${scene.fieldsText}`);
    if (scene.bodyText) parts.push(`Text:\n${scene.bodyText}`);
    return parts.join('\n');
}

/**
 * Group scenes so each chunk fits the budget.
 *
 * A scene larger than the budget on its own still gets its own chunk — refusing
 * to look at a long scene would silently exclude it from the sweep.
 */
export function chunkScenes(
    scenes: ConceptSearchScene[],
    budgetTokens: number = DEFAULT_CHUNK_INPUT_TOKEN_BUDGET
): ConceptSearchScene[][] {
    const chunks: ConceptSearchScene[][] = [];
    let current: ConceptSearchScene[] = [];
    let currentTokens = 0;

    for (const scene of scenes) {
        const tokens = estimateTokensFromText(renderScene(scene, 0));
        if (current.length > 0 && currentTokens + tokens > budgetTokens) {
            chunks.push(current);
            current = [];
            currentTokens = 0;
        }
        current.push(scene);
        currentTokens += tokens;
    }

    if (current.length > 0) chunks.push(current);
    return chunks;
}

/** Case-insensitive, whitespace-tolerant only in the sense of exact substring. */
function containsVerbatim(haystack: string | undefined, quote: string): boolean {
    if (!haystack || !quote) return false;
    return haystack.includes(quote);
}

/**
 * Keep only the quotes that actually appear in what the model was shown, and
 * record which scope each came from.
 */
export function verifyMatch(
    scene: ConceptSearchScene,
    quotes: string[]
): { bodyQuotes: string[]; source: SearchHitSource } | null {
    const bodyQuotes: string[] = [];
    let inFields = false;

    for (const quote of quotes) {
        const trimmed = typeof quote === 'string' ? quote.trim() : '';
        if (!trimmed) continue;
        if (containsVerbatim(scene.bodyText, trimmed)) {
            if (!bodyQuotes.includes(trimmed)) bodyQuotes.push(trimmed);
            continue;
        }
        if (containsVerbatim(scene.fieldsText, trimmed)) inFields = true;
    }

    if (bodyQuotes.length === 0 && !inFields) return null;

    const source: SearchHitSource = bodyQuotes.length > 0
        ? (inFields ? 'both' : 'body')
        : 'timelineFields';
    return { bodyQuotes, source };
}

export class ConceptSearchService {
    private readonly plugin: RadialTimelinePlugin;

    constructor(plugin: RadialTimelinePlugin) {
        this.plugin = plugin;
    }

    async run(input: {
        query: string;
        scenes: ConceptSearchScene[];
        localLlm: LocalLlmSettings;
        cancel: CancelToken;
        onProgress: (progress: ConceptSearchProgress) => void;
    }): Promise<ConceptSearchOutcome> {
        const { query, scenes, localLlm, cancel, onProgress } = input;

        const backend = getLocalLlmBackend(localLlm.backend);
        const providerLabel = LOCAL_LLM_BACKEND_LABELS[localLlm.backend];
        const apiKey = await getCredential(this.plugin, 'ollama');
        const transport = { baseUrl: localLlm.baseUrl, timeoutMs: localLlm.timeoutMs, apiKey };

        const chunks = chunkScenes(scenes, chunkBudgetFor(localLlm));
        const hits: TimelineSearchHit[] = [];
        let droppedClaims = 0;

        for (let index = 0; index < chunks.length; index += 1) {
            // Checked between chunks only. Cancel cannot abort a request already
            // in flight — see SearchService for why that limitation is real.
            if (cancel.cancelled) throw new ConceptSearchCancelled();

            onProgress({ chunk: index + 1, chunkCount: chunks.length });

            const chunk = chunks[index];
            // Numbered per chunk: models mangle file paths, and a local number
            // maps back deterministically.
            const numbered = new Map<string, ConceptSearchScene>();
            const rendered = chunk.map((scene, position) => {
                const id = String(position + 1);
                numbered.set(id, scene);
                return renderScene(scene, position + 1);
            }).join('\n\n');

            const userPrompt = [
                `Question: ${query}`,
                '',
                'Scenes:',
                rendered,
                '',
                'Return {"matches":[{"scene_id":"<number>","reason":"<one line>","quotes":["<verbatim>"]}]}.',
                'Return {"matches":[]} if none bear on the question.'
            ].join('\n');

            const result = await runStructuredJsonPipeline({
                providerLabel,
                schema: MATCH_SCHEMA,
                jsonMode: localLlm.jsonMode,
                maxRetries: localLlm.maxRetries,
                runner: {
                    run: ({ systemPrompt, userPrompt: prompt, useResponseFormat }) => backend.complete({
                        ...transport,
                        modelId: localLlm.defaultModelId,
                        systemPrompt,
                        userPrompt: prompt,
                        responseFormat: useResponseFormat ? { type: 'json_object' } : undefined
                    })
                },
                systemPrompt: SYSTEM_PROMPT,
                userPrompt
            });

            if (!result.ok) {
                // One bad chunk means the sweep is incomplete. Publishing the
                // rest would present a partial pass as a complete one.
                throw new Error(
                    `Local model failed on chunk ${index + 1} of ${chunks.length}: ${result.error}`
                );
            }

            const matches = parseMatches(result.content);
            for (const match of matches) {
                const scene = numbered.get(String(match.scene_id).trim());
                if (!scene) {
                    droppedClaims += 1;
                    continue;
                }
                const verified = verifyMatch(scene, Array.isArray(match.quotes) ? match.quotes : []);
                if (!verified) {
                    droppedClaims += 1;
                    continue;
                }
                hits.push({
                    path: scene.path,
                    source: verified.source,
                    evidence: verified.bodyQuotes,
                    reason: typeof match.reason === 'string' ? match.reason.trim() : undefined
                });
            }
        }

        return { hits, droppedClaims };
    }
}

/** Strict-JSON output has already been validated; this only shapes it. */
export function parseMatches(content: string): ModelMatch[] {
    try {
        const parsed = JSON.parse(content) as { matches?: unknown };
        if (!Array.isArray(parsed.matches)) return [];
        return parsed.matches.filter((entry): entry is ModelMatch =>
            !!entry && typeof entry === 'object' && 'scene_id' in entry
        );
    } catch {
        return [];
    }
}
