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
     * Scenes whose reply could not be read at all. Reported like dropped
     * claims: the sweep covered them, but their answer was unusable, and
     * saying so is the difference between "no match here" and "never found out".
     */
    unreadableScenes: number;
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

/**
 * Consecutive unusable replies before the sweep gives up.
 *
 * One bad reply is a bad reply; five in a row is a server that has gone away,
 * and continuing would mean waiting out a timeout for every remaining scene.
 */
const CONSECUTIVE_FAILURE_LIMIT = 5;

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

/**
 * Requests are decomposed, then answered as facts.
 *
 * Asking a model "does this scene match?" is asking for a judgement call, and
 * judgement is exactly what a small local model is worst at: prompted loosely
 * it matched breakfast to "dinner with Entiat"; prompted strictly it rejected
 * the scene actually titled "Dinner with Entiat". Tuning the adjectives just
 * moved the error around.
 *
 * So the request is first broken into the separate facts a scene must satisfy —
 * "dinner with Entiat" becomes *is this a dinner?* and *is Entiat present?* —
 * and the model answers each as a plain question about what the scene shows.
 * The conjunction is then computed in code, not left to the model's discretion.
 * Measured on five real scenes, this went from 3/5 to 5/5, and the wrong
 * answers it does give are legible: breakfast scores [dinner: no, Entiat: yes].
 */
const MAX_ELEMENTS = 4;
const MAX_QUOTES_PER_MATCH = 3;
const MAX_QUOTE_CHARS = 160;

const ELEMENTS_SCHEMA: Record<string, unknown> = {
    type: 'object',
    required: ['elements'],
    additionalProperties: false,
    properties: {
        elements: {
            type: 'array',
            maxItems: MAX_ELEMENTS,
            items: { type: 'string', maxLength: 80 }
        }
    }
};

/**
 * The prompts state the JSON shape explicitly rather than relying on the
 * response_format schema.
 *
 * Both are sent when `jsonMode` is `response_format`, but an operator may set
 * `prompt_only` — and on a machine measured here, skipping the grammar roughly
 * halved per-scene latency for identical answers. A prompt that only works
 * under enforcement would make that setting silently useless.
 */
const ELEMENTS_SYSTEM_PROMPT = [
    "Break the reader's request into the separate things a scene must contain to satisfy it.",
    'Each element is one testable fact, phrased as a short question.',
    `Reply with JSON only, exactly this shape: {"elements":["<question>"]}, at most ${MAX_ELEMENTS} entries.`,
    "Example: 'dinner with Entiat' -> {\"elements\":[\"Does this scene depict a dinner?\",\"Is Entiat present in this scene?\"]}."
].join(' ');

const VERDICT_SYSTEM_PROMPT = [
    'Answer each question about the scene with true or false, in order.',
    'Answer only from what the scene shows.',
    `Then give up to ${MAX_QUOTES_PER_MATCH} short verbatim quotes from the scene supporting any true answers.`,
    'A quote you cannot copy exactly is worse than no quote: it will be discarded.',
    'Reply with JSON only, exactly this shape: {"answers":[true,false],"quotes":["<verbatim>"]}',
    'where answers holds one boolean per question, in order.'
].join(' ');

/** Answer count is pinned to the question count, so a short reply cannot be misread. */
function verdictSchema(elementCount: number): Record<string, unknown> {
    return {
        type: 'object',
        required: ['answers', 'quotes'],
        additionalProperties: false,
        properties: {
            answers: {
                type: 'array',
                minItems: elementCount,
                maxItems: elementCount,
                items: { type: 'boolean' }
            },
            quotes: {
                type: 'array',
                maxItems: MAX_QUOTES_PER_MATCH,
                items: { type: 'string', maxLength: MAX_QUOTE_CHARS }
            }
        }
    };
}

/** A readable account of why a scene did or did not qualify. */
export function describeVerdict(elements: string[], answers: boolean[]): string {
    return elements
        .map((element, index) => `${stripQuestion(element)}: ${answers[index] ? 'yes' : 'no'}`)
        .join(' · ');
}

function stripQuestion(element: string): string {
    return element
        .replace(/^does this scene\s*/i, '')
        .replace(/^is there\s*/i, '')
        .replace(/^is\s*/i, '')
        .replace(/\s*in this scene\??$/i, '')
        .replace(/\?$/, '')
        .trim() || element;
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

interface JsonCallInput {
    backend: ReturnType<typeof getLocalLlmBackend>;
    providerLabel: string;
    transport: { baseUrl: string; timeoutMs: number; apiKey?: string };
    localLlm: LocalLlmSettings;
    schema: Record<string, unknown>;
    schemaName: string;
    systemPrompt: string;
    userPrompt: string;
}

/** One strict-JSON round trip. Returns null when the reply was unusable. */
async function callJson(input: JsonCallInput): Promise<{ ok: true; value: unknown } | { ok: false; error: string }> {
    const result = await runStructuredJsonPipeline({
        providerLabel: input.providerLabel,
        schema: input.schema,
        jsonMode: input.localLlm.jsonMode,
        maxRetries: input.localLlm.maxRetries,
        runner: {
            run: ({ systemPrompt, userPrompt, useResponseFormat }) => input.backend.complete({
                ...input.transport,
                modelId: input.localLlm.defaultModelId,
                systemPrompt,
                userPrompt,
                maxOutputTokens: MAX_OUTPUT_TOKENS,
                // The real schema, not a permissive placeholder: on backends
                // that enforce it, this is what keeps the reply structurally
                // valid instead of merely object-shaped.
                responseFormat: useResponseFormat
                    ? { type: 'json_object', schema: input.schema, schemaName: input.schemaName }
                    : undefined
            })
        },
        systemPrompt: input.systemPrompt,
        userPrompt: input.userPrompt
    });

    if (!result.ok) return { ok: false, error: result.error };
    try {
        return { ok: true, value: JSON.parse(result.content) };
    } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
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

        // Decompose once, up front. Every scene is then judged against the same
        // set of facts, so the sweep is internally consistent.
        const elementsCall = await callJson({
            backend, providerLabel, transport, localLlm,
            schema: ELEMENTS_SCHEMA, schemaName: 'request_elements',
            systemPrompt: ELEMENTS_SYSTEM_PROMPT,
            userPrompt: `Request: ${query}`
        });
        if (!elementsCall.ok) {
            throw new Error(`Local model could not read the request: ${elementsCall.error}`);
        }
        const parsedElements = (elementsCall.value as { elements?: unknown }).elements;
        const elements = Array.isArray(parsedElements)
            ? parsedElements.filter((e): e is string => typeof e === 'string' && e.trim().length > 0)
            : [];
        // A request that resists decomposition is still a request: test it whole
        // rather than silently searching for nothing.
        const questions = elements.length > 0 ? elements : [query];

        const ordered = orderByPromise(scenes, extractKeywords(query));
        const passes = buildPasses(ordered, chunkBudgetFor(localLlm));
        const hits: TimelineSearchHit[] = [];
        let droppedClaims = 0;
        let unreadableScenes = 0;
        let consecutiveFailures = 0;

        for (let index = 0; index < passes.length; index += 1) {
            // Checked between passes. Cancel cannot abort a request already in
            // flight — see SearchService for why that limitation is real. With
            // one scene per pass it lands within a couple of seconds.
            //
            // Cancelling KEEPS what has been found. The author has been watching
            // matches arrive and may already have opened one; throwing them away
            // because they asked the sweep to stop would be indefensible.
            if (cancel.cancelled) return { hits, droppedClaims, cancelled: true, unreadableScenes };

            const pass = passes[index];
            // Progress counts SCENES, which is what the author is watching;
            // windows of one long scene report that scene's number.
            onProgress({ chunk: pass.sceneIndex + 1, chunkCount: scenes.length });

            const numbered = questions.map((q, i) => `${i + 1}. ${q}`).join('\n');
            const verdictCall = await callJson({
                backend, providerLabel, transport, localLlm,
                schema: verdictSchema(questions.length), schemaName: 'scene_verdict',
                systemPrompt: VERDICT_SYSTEM_PROMPT,
                userPrompt: `Scene:\n${pass.text}\n\nQuestions:\n${numbered}`
            });

            if (!verdictCall.ok) {
                // One unusable reply must not cost the author the other ninety
                // scenes — especially now that matches stream in and they may
                // already be reading them. Skip it, count it, keep going.
                unreadableScenes += 1;
                consecutiveFailures += 1;
                console.warn(
                    `[Search] Unusable reply for scene ${pass.sceneIndex + 1}: ${verdictCall.error}`
                );
                // A run of failures is a dead server, not a bad reply. Stopping
                // beats timing out once per remaining scene.
                if (consecutiveFailures >= CONSECUTIVE_FAILURE_LIMIT) {
                    throw new Error(
                        `Local model failed on ${consecutiveFailures} scenes in a row: ${verdictCall.error}`
                    );
                }
                continue;
            }
            consecutiveFailures = 0;

            const reply = verdictCall.value as { answers?: unknown; quotes?: unknown };
            const answers = Array.isArray(reply.answers)
                ? reply.answers.map(Boolean)
                : [];
            if (answers.length !== questions.length) {
                unreadableScenes += 1;
                continue;
            }

            // The conjunction is computed here, not conceded to the model. This
            // is what makes "if it isn't dinner with Entiat, it isn't a match"
            // a rule rather than a request.
            if (!answers.every(Boolean)) continue;

            const quotes = Array.isArray(reply.quotes)
                ? reply.quotes.filter((q): q is string => typeof q === 'string')
                : [];
            const verified = verifyMatch(pass.scene, quotes);
            if (!verified) {
                droppedClaims += 1;
                continue;
            }

            const hit: TimelineSearchHit = {
                path: pass.scene.path,
                source: verified.source,
                evidence: verified.bodyQuotes,
                reason: describeVerdict(questions, answers)
            };
            hits.push(hit);
            onHit(hit);
        }

        return { hits, droppedClaims, cancelled: false, unreadableScenes };
    }
}

