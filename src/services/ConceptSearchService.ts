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
    /** 1-based scene index — what the author understands, not internal passes. */
    chunk: number;
    chunkCount: number;
}

export interface ConceptSearchOutcome {
    hits: TimelineSearchHit[];
    /** True when the author stopped the sweep; the hits so far are still real. */
    cancelled: boolean;
    /**
     * Scenes the model named whose quotes could not be found in the text it was
     * given. Surfaced to the author rather than swallowed: a high number means
     * the model is inventing, and hiding that would present a thin sweep as a
     * complete one.
     */
    droppedClaims: number;
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

/**
 * Words too common to say anything about which scene to read first. Includes
 * the framing an author naturally writes around a question ("scenes about…").
 */
const STOPWORDS = new Set([
    'a', 'an', 'the', 'of', 'in', 'on', 'at', 'to', 'for', 'and', 'or', 'but',
    'with', 'about', 'that', 'this', 'these', 'those', 'is', 'are', 'was',
    'were', 'be', 'been', 'it', 'its', 'as', 'by', 'from', 'into', 'when',
    'where', 'who', 'what', 'which', 'how', 'why', 'any', 'all', 'some',
    'scene', 'scenes', 'chapter', 'chapters', 'character', 'characters'
]);

/**
 * The content words of a query, used to decide reading order.
 *
 * "a character falls into a crevice" → ["character" is framing, so] falls,
 * crevice. Deliberately no stemming: a literal substring test already catches
 * "falls" inside "falling", and a stemmer would be one more thing to be subtly
 * wrong about in a feature whose whole point is not guessing.
 */
export function extractKeywords(query: string): string[] {
    const words = query.toLowerCase().split(/[^\p{L}\p{N}']+/u);
    const seen: string[] = [];
    for (const word of words) {
        if (word.length < 3 || STOPWORDS.has(word)) continue;
        if (!seen.includes(word)) seen.push(word);
    }
    return seen;
}

/** How many distinct query keywords appear in this text. */
export function keywordScore(text: string, keywords: string[]): number {
    if (keywords.length === 0) return 0;
    const lower = text.toLowerCase();
    return keywords.reduce((count, word) => (lower.includes(word) ? count + 1 : count), 0);
}

/**
 * Read the most promising scenes first.
 *
 * The sweep still covers every scene — this only changes the order. A literal
 * keyword hit is a weak signal, far too weak to *filter* on (the entire point
 * of concept search is finding scenes that never use the author's words), but
 * it is a good guess at where to look first. Front-loading those turns a
 * two-and-a-half-minute wait with nothing on screen into first results within
 * seconds, which is what makes the run reviewable while it is still going.
 */
export function orderByPromise(
    scenes: ConceptSearchScene[],
    keywords: string[]
): ConceptSearchScene[] {
    if (keywords.length === 0) return scenes;
    return scenes
        .map((scene, index) => ({
            scene,
            index,
            score: keywordScore(`${scene.fieldsText ?? ''} ${scene.bodyText ?? ''}`, keywords)
        }))
        // Manuscript order within a score band, so the sweep still reads like a
        // pass through the book rather than a shuffle.
        .sort((a, b) => (b.score - a.score) || (a.index - b.index))
        .map(entry => entry.scene);
}

/**
 * Output ceiling per pass.
 *
 * The expected reply is a short list of scene ids and quotes, so leaving output
 * unbounded only lets a reasoning model spend minutes thinking before it
 * answers — and then hit the transport timeout, failing a pass that had nothing
 * wrong with it. Bounded to the shape of the answer we actually asked for.
 */
const MAX_OUTPUT_TOKENS = PROVIDER_CAPS.ollama.defaultOutputTokens;

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

/** The text a scene contributes. One scene per request, so it needs no id. */
function renderScene(scene: ConceptSearchScene): string {
    const parts: string[] = [];
    if (scene.fieldsText) parts.push(`Details: ${scene.fieldsText}`);
    if (scene.bodyText) parts.push(`Text:\n${scene.bodyText}`);
    return parts.join('\n');
}

/** One request: a single scene, or one window of a scene too long to send whole. */
export interface ConceptSearchPass {
    scene: ConceptSearchScene;
    /** The text this request shows the model. */
    text: string;
    /** 0-based scene index, so progress can be reported in scenes. */
    sceneIndex: number;
}

/**
 * One scene per request.
 *
 * Batching several scenes into one call is what broke this against a real
 * server: a local model's context length is set when the model is loaded and
 * cannot be discovered, so a batch sized against a guessed window was rejected
 * outright, and a batch small enough to fit still took long enough to hit the
 * transport timeout. A single scene is small, fast, and predictable — and a
 * failure is isolated to one scene rather than taking six down with it.
 *
 * It also asks an easier question. "Does this scene bear on the query?" is a
 * judgement a small model makes far more reliably than "which of these six".
 *
 * A scene longer than the budget is split into overlapping windows rather than
 * truncated: every part of every scene is looked at, and the overlap keeps a
 * passage from being lost at a seam. Quotes still verify against the whole
 * scene, so a window is only ever a reading unit.
 */
export function buildPasses(
    scenes: ConceptSearchScene[],
    budgetTokens: number = DEFAULT_CHUNK_INPUT_TOKEN_BUDGET
): ConceptSearchPass[] {
    const passes: ConceptSearchPass[] = [];
    // Characters, not tokens, once we are slicing text.
    const budgetChars = budgetTokens * 4;
    const overlapChars = Math.floor(budgetChars * 0.1);

    scenes.forEach((scene, sceneIndex) => {
        const whole = renderScene(scene);
        if (estimateTokensFromText(whole) <= budgetTokens) {
            passes.push({ scene, text: whole, sceneIndex });
            return;
        }

        const body = scene.bodyText ?? '';
        const head = renderScene({ ...scene, bodyText: undefined });
        const step = Math.max(1, budgetChars - overlapChars);
        for (let start = 0; start < body.length; start += step) {
            const window = body.slice(start, start + budgetChars);
            passes.push({
                scene,
                text: `${head}\nText:\n${window}`,
                sceneIndex
            });
        }
    });

    return passes;
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
        /**
         * Called as each match is confirmed, so the timeline fills in while the
         * sweep continues and the author can start opening scenes.
         */
        onHit: (hit: TimelineSearchHit) => void;
    }): Promise<ConceptSearchOutcome> {
        const { query, scenes, localLlm, cancel, onProgress, onHit } = input;

        const backend = getLocalLlmBackend(localLlm.backend);
        const providerLabel = LOCAL_LLM_BACKEND_LABELS[localLlm.backend];
        const apiKey = await getCredential(this.plugin, 'ollama');
        const transport = { baseUrl: localLlm.baseUrl, timeoutMs: localLlm.timeoutMs, apiKey };

        const ordered = orderByPromise(scenes, extractKeywords(query));
        const passes = buildPasses(ordered, chunkBudgetFor(localLlm));
        const hits: TimelineSearchHit[] = [];
        let droppedClaims = 0;

        for (let index = 0; index < passes.length; index += 1) {
            // Checked between passes. Cancel cannot abort a request already in
            // flight — see SearchService for why that limitation is real. With
            // one scene per pass it lands within a couple of seconds.
            //
            // Cancelling KEEPS what has been found. The author has been watching
            // matches arrive and may already have opened one; throwing them away
            // because they asked the sweep to stop would be indefensible.
            if (cancel.cancelled) return { hits, droppedClaims, cancelled: true };

            const pass = passes[index];
            // Progress counts SCENES, which is what the author is watching;
            // windows of one long scene report that scene's number.
            onProgress({ chunk: pass.sceneIndex + 1, chunkCount: scenes.length });

            const userPrompt = [
                `Question: ${query}`,
                '',
                'Scene:',
                pass.text,
                '',
                'If this scene bears on the question, return one match with scene_id "1".',
                'Return {"matches":[]} if it does not.'
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
                        maxOutputTokens: MAX_OUTPUT_TOKENS,
                        // The real schema, not a permissive placeholder: on
                        // backends that enforce it, this is what keeps the reply
                        // structurally valid instead of merely object-shaped.
                        responseFormat: useResponseFormat
                            ? { type: 'json_object', schema: MATCH_SCHEMA, schemaName: 'scene_matches' }
                            : undefined
                    })
                },
                systemPrompt: SYSTEM_PROMPT,
                userPrompt
            });

            if (!result.ok) {
                // One failed scene means the sweep is incomplete. Publishing the
                // rest would present a partial pass as a complete one.
                throw new Error(
                    `Local model failed on scene ${pass.sceneIndex + 1} of ${scenes.length}: ${result.error}`
                );
            }

            for (const match of parseMatches(result.content)) {
                const verified = verifyMatch(pass.scene, Array.isArray(match.quotes) ? match.quotes : []);
                if (!verified) {
                    droppedClaims += 1;
                    continue;
                }
                const hit: TimelineSearchHit = {
                    path: pass.scene.path,
                    source: verified.source,
                    evidence: verified.bodyQuotes,
                    reason: typeof match.reason === 'string' ? match.reason.trim() : undefined
                };
                hits.push(hit);
                onHit(hit);
            }
        }

        return { hits, droppedClaims, cancelled: false };
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
