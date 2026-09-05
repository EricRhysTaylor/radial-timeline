/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 */
// DEPRECATED: Legacy provider adapter; prefer aiClient entrypoints.
import { sleep } from '../utils/sleep';
import { requestUrl } from 'obsidian'; // Use requestUrl for consistency
import { warnLegacyAccess } from './legacyAccessGuard';
import { modelSupportsSystemRole } from './providerCapabilities';
import { modelSupportsRequestTemperature, modelSupportsRequestTopP } from '../ai/registry/modelRequestProfiles';
import type { OpenAiPromptCacheRetention, SourceAttributionType, SourceCitation } from '../ai/types';

// Interface for the expected successful OpenAI Chat Completion response
interface OpenAiChatSuccessResponse {
    choices: {
        message: {
            role: string;
            content: unknown;
        };
        finish_reason: string;
    }[];
    usage?: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
    };
}

// Interface for the expected OpenAI error response
interface OpenAiErrorResponse {
    error: {
        message: string;
        type: string;
        param: string | null;
        code: string | null;
    };
}

export interface OpenAiApiResponse {
    success: boolean;
    content: string | null;
    responseData: unknown;
    requestPayload?: unknown;
    citations?: SourceCitation[];
    adapterNotes?: string[];
    error?: string;
}

export type OpenAiResponseFormat =
    | { type: 'json_object' }
    | { type: 'json_schema'; json_schema: Record<string, unknown> };

interface OpenAiResponsesTextPart {
    type?: string;
    text?: string;
    output_text?: string;
    annotations?: unknown[];
    [key: string]: unknown;
}

interface OpenAiResponsesOutputItem {
    type?: string;
    content?: OpenAiResponsesTextPart[];
    text?: string;
    output_text?: string;
    [key: string]: unknown;
}

type OpenAiResponsesTextFormat =
    | { type: 'json_object' }
    | { type: 'json_schema'; name: string; schema: Record<string, unknown>; strict: true };

interface OpenAiAnnotationRecord {
    type?: string;
    file_id?: string;
    filename?: string;
    url?: string;
    title?: string;
    quote?: string;
    start_index?: number;
    end_index?: number;
    [key: string]: unknown;
}

// Models that require the OpenAI background-poll Responses transport.
// Currently empty — gpt-5.4-pro was the only entry and was removed in the
// minimum-viable-catalog trim (2026-05-22). Re-populate when a future
// model needs background-poll handling.
const OPENAI_BACKGROUND_RESPONSE_MODEL_IDS = new Set<string>([]);
const OPENAI_BACKGROUND_POLL_INTERVAL_MS = 2000;
const OPENAI_BACKGROUND_MAX_POLLS = 180;

function normalizeBaseUrl(baseUrl: string | undefined, endpointPath: '/chat/completions' | '/responses'): string {
    if (!baseUrl) return `https://api.openai.com/v1${endpointPath}`;
    const base = baseUrl.replace(/\/$/, '');
    if (base.endsWith(endpointPath)) return base;
    return `${base}${endpointPath}`;
}

function normalizeResponseObjectUrl(responseId: string): string {
    return `https://api.openai.com/v1/responses/${encodeURIComponent(responseId)}`;
}

function shouldUseOpenAiBackgroundMode(modelId: string): boolean {
    return OPENAI_BACKGROUND_RESPONSE_MODEL_IDS.has((modelId || '').trim());
}

function isPendingBackgroundStatus(status: unknown): boolean {
    return status === 'queued' || status === 'in_progress';
}

function buildOpenAiChatMessages(
    modelId: string,
    systemPrompt: string | null,
    userPrompt: string,
    baseUrl?: string
): { role: string; content: string }[] {
    const supportsSystem = !baseUrl && modelSupportsSystemRole('openai', modelId);
    if (systemPrompt && supportsSystem) {
        return [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
        ];
    }

    const fullPrompt = systemPrompt ? `${systemPrompt}\n\n${userPrompt}` : userPrompt;
    return [{ role: 'user', content: fullPrompt }];
}

function buildOpenAiResponsesInput(
    modelId: string,
    systemPrompt: string | null,
    userPrompt: string
): { role: 'system' | 'user'; content: { type: 'input_text'; text: string }[] }[] {
    const supportsSystem = modelSupportsSystemRole('openai', modelId);
    if (systemPrompt && supportsSystem) {
        return [
            { role: 'system', content: [{ type: 'input_text', text: systemPrompt }] },
            { role: 'user', content: [{ type: 'input_text', text: userPrompt }] }
        ];
    }
    const fullPrompt = systemPrompt ? `${systemPrompt}\n\n${userPrompt}` : userPrompt;
    return [{ role: 'user', content: [{ type: 'input_text', text: fullPrompt }] }];
}

function toResponsesTextFormat(responseFormat: OpenAiResponseFormat): OpenAiResponsesTextFormat {
    if (responseFormat.type === 'json_object') {
        return { type: 'json_object' };
    }
    const schemaEnvelope = responseFormat.json_schema && typeof responseFormat.json_schema === 'object'
        ? responseFormat.json_schema
        : {};
    const rawName = schemaEnvelope.name;
    const rawSchema = schemaEnvelope.schema;
    return {
        type: 'json_schema',
        name: typeof rawName === 'string' && rawName.trim() ? rawName.trim() : 'ai_result',
        schema: rawSchema && typeof rawSchema === 'object' ? rawSchema as Record<string, unknown> : {},
        strict: true
    };
}

function firstString(value: unknown): string | null {
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (Array.isArray(value)) {
        for (const item of value) {
            if (typeof item === 'string' && item.trim()) return item.trim();
        }
    }
    return null;
}

function extractTextFromOpenAiPart(part: unknown): string | null {
    if (!part || typeof part !== 'object') return null;
    const record = part as Record<string, unknown>;
    const direct = firstString(record.output_text) ?? firstString(record.text);
    if (direct) return direct;
    const nestedText = record.text;
    if (nestedText && typeof nestedText === 'object') {
        return firstString((nestedText as Record<string, unknown>).value);
    }
    return null;
}

function extractChatMessageContent(content: unknown): string | null {
    const direct = firstString(content);
    if (direct) return direct;
    if (!Array.isArray(content)) return null;
    const chunks = content
        .map(part => extractTextFromOpenAiPart(part))
        .filter((value): value is string => !!value);
    if (!chunks.length) return null;
    return chunks.join('\n\n').trim() || null;
}

function readIndex(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function buildAnnotatedExcerpt(
    text: string | null,
    startIndex: number | undefined,
    endIndex: number | undefined
): string | undefined {
    if (!text) return undefined;
    if (startIndex === undefined || endIndex === undefined) return undefined;
    const safeStart = Math.max(0, Math.min(Math.floor(startIndex), text.length));
    const safeEnd = Math.max(safeStart, Math.min(Math.floor(endIndex), text.length));
    if (safeEnd <= safeStart) return undefined;
    const slice = text.slice(safeStart, safeEnd).trim();
    return slice || undefined;
}

function stringField(record: Record<string, unknown>, key: string): string | undefined {
    const value = record[key];
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function resolveAttributionType(annotationType: string): SourceAttributionType | null {
    if (annotationType === 'file_citation') return 'tool_file';
    if (annotationType === 'url_citation') return 'tool_url';
    if (annotationType.includes('ground')) return 'grounded';
    if (annotationType.includes('citation')) return 'grounded';
    return null;
}

function buildOpenAiAnnotationCitation(
    rawAnnotation: unknown,
    partText: string | null
): SourceCitation | null {
    if (!rawAnnotation || typeof rawAnnotation !== 'object') return null;
    const annotation = rawAnnotation as OpenAiAnnotationRecord;
    const annotationType = typeof annotation.type === 'string'
        ? annotation.type.trim().toLowerCase()
        : '';
    if (!annotationType) return null;
    const attributionType = resolveAttributionType(annotationType);
    if (!attributionType) return null;

    const fileId = stringField(annotation, 'file_id');
    const filename = stringField(annotation, 'filename');
    const url = stringField(annotation, 'url');
    const title = stringField(annotation, 'title');
    const quote = stringField(annotation, 'quote');
    const startCharIndex = readIndex(annotation.start_index);
    const endCharIndex = readIndex(annotation.end_index);
    const excerpt = quote ?? buildAnnotatedExcerpt(partText, startCharIndex, endCharIndex);

    if (attributionType === 'tool_file') {
        return {
            attributionType,
            sourceLabel: filename ?? fileId ?? 'Referenced file',
            sourceId: fileId ?? filename,
            fileId,
            filename,
            citedText: excerpt,
            startCharIndex,
            endCharIndex
        };
    }

    if (attributionType === 'tool_url') {
        return {
            attributionType,
            sourceLabel: title ?? url ?? 'Referenced URL',
            sourceId: url,
            url,
            title,
            citedText: excerpt,
            startCharIndex,
            endCharIndex
        };
    }

    return {
        attributionType: 'grounded',
        sourceLabel: title ?? url ?? filename ?? fileId ?? 'Grounded source',
        sourceId: url ?? fileId ?? filename,
        url,
        fileId,
        filename,
        title,
        citedText: excerpt,
        startCharIndex,
        endCharIndex
    };
}

function dedupeCitations(citations: SourceCitation[]): SourceCitation[] {
    const seen = new Set<string>();
    const deduped: SourceCitation[] = [];
    for (const citation of citations) {
        const key = [
            citation.attributionType ?? 'direct_manuscript',
            'sourceId' in citation ? citation.sourceId ?? '' : '',
            'url' in citation ? citation.url ?? '' : '',
            'fileId' in citation ? citation.fileId ?? '' : '',
            citation.citedText ?? '',
            citation.startCharIndex ?? '',
            citation.endCharIndex ?? ''
        ].join('|');
        if (seen.has(key)) continue;
        seen.add(key);
        deduped.push(citation);
    }
    return deduped;
}

export function extractOpenAiAnnotationCitations(responseData: unknown): SourceCitation[] {
    if (!responseData || typeof responseData !== 'object') return [];
    const data = responseData as Record<string, unknown>;
    const citations: SourceCitation[] = [];

    const collectFromCarrier = (carrier: Record<string, unknown>, defaultText?: string | null) => {
        const annotations = Array.isArray(carrier.annotations) ? carrier.annotations : [];
        if (!annotations.length) return;
        const partText = extractTextFromOpenAiPart(carrier) ?? defaultText ?? null;
        annotations.forEach(rawAnnotation => {
            const normalized = buildOpenAiAnnotationCitation(rawAnnotation, partText);
            if (normalized) citations.push(normalized);
        });
    };

    const outputItems = Array.isArray(data.output) ? data.output as Record<string, unknown>[] : [];
    outputItems.forEach(item => {
        const contentParts = Array.isArray(item.content) ? item.content as Record<string, unknown>[] : [];
        contentParts.forEach(part => collectFromCarrier(part));
    });

    const choices = Array.isArray(data.choices) ? data.choices as Record<string, unknown>[] : [];
    choices.forEach(choice => {
        const message = choice.message && typeof choice.message === 'object'
            ? choice.message as Record<string, unknown>
            : null;
        if (!message) return;

        const messageContent = message.content;
        const messageText = extractChatMessageContent(messageContent);
        if (Array.isArray(messageContent)) {
            messageContent.forEach(part => {
                if (part && typeof part === 'object') {
                    collectFromCarrier(part as Record<string, unknown>);
                }
            });
        } else {
            collectFromCarrier(message, messageText);
        }
    });

    return dedupeCitations(citations);
}

export function extractOpenAiResponsesContent(responseData: unknown): string | null {
    if (!responseData || typeof responseData !== 'object') return null;
    const data = responseData as Record<string, unknown>;
    const chunks: string[] = [];
    const pushChunk = (value: unknown) => {
        const text = firstString(value);
        if (text) chunks.push(text);
    };

    pushChunk(data.output_text);

    const output = Array.isArray(data.output) ? data.output as OpenAiResponsesOutputItem[] : [];
    for (const item of output) {
        pushChunk(item.output_text);
        pushChunk(item.text);
        const contentParts = Array.isArray(item.content) ? item.content : [];
        for (const part of contentParts) {
            pushChunk(part.output_text);
            pushChunk(part.text);
        }
    }

    if (!chunks.length) return null;
    return chunks.join('\n\n').trim() || null;
}

function extractResponsesFinishReason(responseData: unknown): string | null {
    if (!responseData || typeof responseData !== 'object') return null;
    const data = responseData as Record<string, unknown>;
    const status = typeof data.status === 'string' ? data.status : null;
    if (status === 'completed') return 'stop';
    if (status === 'incomplete') {
        const incomplete = data.incomplete_details;
        if (incomplete && typeof incomplete === 'object') {
            const reason = (incomplete as Record<string, unknown>).reason;
            if (typeof reason === 'string') {
                if (reason === 'max_output_tokens') return 'length';
                return reason;
            }
        }
        return 'incomplete';
    }
    return null;
}

function extractResponsesErrorReason(responseData: unknown): string | null {
    if (!responseData || typeof responseData !== 'object') return null;
    const data = responseData as Record<string, unknown>;
    const status = typeof data.status === 'string' ? data.status : null;
    if (status !== 'incomplete') return null;
    const incomplete = data.incomplete_details;
    if (!incomplete || typeof incomplete !== 'object') return 'incomplete';
    const reason = (incomplete as Record<string, unknown>).reason;
    return typeof reason === 'string' ? reason : 'incomplete';
}

function extractResponsesFailureMessage(responseData: unknown): string | null {
    if (!responseData || typeof responseData !== 'object') return null;
    const data = responseData as Record<string, unknown>;
    const error = data.error;
    if (error && typeof error === 'object') {
        const message = (error as Record<string, unknown>).message;
        if (typeof message === 'string' && message.trim()) {
            return message.trim();
        }
    }
    const status = typeof data.status === 'string' ? data.status : null;
    if (status && status !== 'completed' && status !== 'incomplete') {
        return `OpenAI Responses finished with status ${status}.`;
    }
    return null;
}

async function pollOpenAiBackgroundResponse(
    apiKey: string,
    initialResponseData: unknown
): Promise<unknown> {
    let responseData = initialResponseData;
    for (let pollIndex = 0; pollIndex < OPENAI_BACKGROUND_MAX_POLLS; pollIndex += 1) {
        if (!responseData || typeof responseData !== 'object') return responseData;
        const data = responseData as Record<string, unknown>;
        const status = data.status;
        if (!isPendingBackgroundStatus(status)) return responseData;
        const responseId = typeof data.id === 'string' ? data.id.trim() : '';
        if (!responseId) return responseData;
        if (pollIndex > 0) {
            await sleep(OPENAI_BACKGROUND_POLL_INTERVAL_MS);
        }
        const response = await requestUrl({
            url: normalizeResponseObjectUrl(responseId),
            method: 'GET',
            headers: {
                Authorization: `Bearer ${apiKey}`
            },
            throw: false
        });
        responseData = response.json;
        if (response.status >= 400) {
            return responseData;
        }
    }
    return responseData;
}

export function normalizeOpenAiResponsesUsage(usageValue: unknown): {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
} | null {
    if (!usageValue || typeof usageValue !== 'object') return null;
    const usage = usageValue as Record<string, unknown>;
    const prompt = typeof usage.prompt_tokens === 'number'
        ? usage.prompt_tokens
        : (typeof usage.input_tokens === 'number' ? usage.input_tokens : undefined);
    const completion = typeof usage.completion_tokens === 'number'
        ? usage.completion_tokens
        : (typeof usage.output_tokens === 'number' ? usage.output_tokens : undefined);
    const total = typeof usage.total_tokens === 'number'
        ? usage.total_tokens
        : (prompt !== undefined && completion !== undefined ? prompt + completion : undefined);
    if (prompt === undefined && completion === undefined && total === undefined) return null;
    return {
        prompt_tokens: prompt,
        completion_tokens: completion,
        total_tokens: total
    };
}

export function normalizeOpenAiResponsesResponseData(
    responseData: unknown,
    modelId: string,
    content: string | null
): unknown {
    if (!responseData || typeof responseData !== 'object') return responseData;
    const data = responseData as Record<string, unknown>;
    const normalized: Record<string, unknown> = { ...data };
    if (typeof normalized.model !== 'string') {
        normalized.model = modelId;
    }

    const normalizedUsage = normalizeOpenAiResponsesUsage(data.usage);
    if (normalizedUsage) {
        const usageBase = data.usage && typeof data.usage === 'object'
            ? data.usage as Record<string, unknown>
            : {};
        normalized.usage = {
            ...usageBase,
            ...normalizedUsage
        };
    }

    if (content && !Array.isArray(normalized.choices)) {
        normalized.choices = [{
            message: {
                role: 'assistant',
                content
            },
            finish_reason: extractResponsesFinishReason(data) ?? 'stop'
        }];
    }

    return normalized;
}

export async function callOpenAiApi(
    apiKey: string,
    modelId: string,
    systemPrompt: string | null,
    userPrompt: string,
    maxTokens: number | null = 4000,
    baseUrl?: string,
    responseFormat?: OpenAiResponseFormat,
    temperature?: number,
    topP?: number,
    internalAdapterAccess?: boolean
): Promise<OpenAiApiResponse> {
    warnLegacyAccess('openaiApi.callOpenAiApi', internalAdapterAccess);
    const apiUrl = normalizeBaseUrl(baseUrl, '/chat/completions');

    if (!apiKey && !baseUrl) {
        return { success: false, content: null, responseData: { error: { message: 'API key not configured.', type: 'plugin_error' } }, error: 'OpenAI API key not configured.' };
    }
    if (!modelId) {
        return { success: false, content: null, responseData: { error: { message: 'Model ID not configured.', type: 'plugin_error' } }, error: 'OpenAI Model ID not configured.' };
    }

    const messages = buildOpenAiChatMessages(modelId, systemPrompt, userPrompt, baseUrl);

    const requestBody: {
        model: string;
        messages: { role: string; content: string }[];
        max_completion_tokens?: number;
        response_format?: OpenAiResponseFormat;
        temperature?: number;
        top_p?: number;
    } = { model: modelId, messages };

    if (maxTokens !== null) {
        requestBody.max_completion_tokens = maxTokens;
    }
    if (responseFormat) {
        requestBody.response_format = responseFormat;
    }
    if (typeof temperature === 'number' && modelSupportsRequestTemperature('openai', modelId)) {
        requestBody.temperature = temperature;
    }
    if (typeof topP === 'number' && modelSupportsRequestTopP('openai', modelId)) {
        requestBody.top_p = topP;
    }

    let responseData: unknown;

    try {
        const response = await requestUrl({
            url: apiUrl,
            method: 'POST',
            headers: {
                Authorization: `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(requestBody),
            throw: false,
        });
        responseData = response.json;
        if (response.status >= 400) {
            const errorDetails = responseData as OpenAiErrorResponse;
            const msg = errorDetails?.error?.message ?? response.text ?? `OpenAI error (${response.status})`;
            if (responseFormat && /(response_format|json)/i.test(msg)) {
                return {
                    success: false,
                    content: null,
                    responseData,
                    requestPayload: requestBody,
                    adapterNotes: [
                        'Legacy OpenAI chat response_format was rejected by the model or endpoint; RT did not retry without JSON-mode enforcement.'
                    ],
                    error: `Legacy OpenAI chat endpoint rejected response_format: ${msg}`
                };
            }
            return { success: false, content: null, responseData, requestPayload: requestBody, error: msg };
        }
        const success = responseData as OpenAiChatSuccessResponse;
        const content = extractChatMessageContent(success?.choices?.[0]?.message?.content);
        if (content) {
            const citations = extractOpenAiAnnotationCitations(responseData);
            return { success: true, content, responseData, requestPayload: requestBody, ...(citations.length ? { citations } : {}) };
        }
        return { success: false, content: null, responseData, requestPayload: requestBody, error: 'Invalid response structure from OpenAI.' };
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        responseData = { error: { message: msg, type: 'network_or_execution_error' } };
        return { success: false, content: null, responseData, requestPayload: requestBody, error: msg };
    }
}

export async function callOpenAiResponsesApi(
    apiKey: string,
    modelId: string,
    systemPrompt: string | null,
    userPrompt: string,
    maxTokens: number | null = 4000,
    responseFormat?: OpenAiResponseFormat,
    temperature?: number,
    topP?: number,
    promptCacheRetention?: OpenAiPromptCacheRetention,
    promptCacheKey?: string,
    internalAdapterAccess?: boolean
): Promise<OpenAiApiResponse> {
    warnLegacyAccess('openaiApi.callOpenAiResponsesApi', internalAdapterAccess);
    const apiUrl = normalizeBaseUrl(undefined, '/responses');

    if (!apiKey) {
        return {
            success: false,
            content: null,
            responseData: { error: { message: 'API key not configured.', type: 'plugin_error' } },
            error: 'OpenAI API key not configured.'
        };
    }
    if (!modelId) {
        return {
            success: false,
            content: null,
            responseData: { error: { message: 'Model ID not configured.', type: 'plugin_error' } },
            error: 'OpenAI Model ID not configured.'
        };
    }

    const requestBody: {
        model: string;
        input: { role: 'system' | 'user'; content: { type: 'input_text'; text: string }[] }[];
        max_output_tokens?: number;
        text?: { format: OpenAiResponsesTextFormat };
        temperature?: number;
        top_p?: number;
        prompt_cache_retention?: OpenAiPromptCacheRetention;
        prompt_cache_key?: string;
        background?: boolean;
        store?: boolean;
    } = {
        model: modelId,
        input: buildOpenAiResponsesInput(modelId, systemPrompt, userPrompt)
    };
    const adapterNotes: string[] = [];
    const useBackgroundMode = shouldUseOpenAiBackgroundMode(modelId);

    if (maxTokens !== null) {
        requestBody.max_output_tokens = maxTokens;
    }
    if (responseFormat) {
        requestBody.text = { format: toResponsesTextFormat(responseFormat) };
    }
    if (typeof temperature === 'number' && modelSupportsRequestTemperature('openai', modelId)) {
        requestBody.temperature = temperature;
    } else if (typeof temperature === 'number') {
        adapterNotes.push('Stripped temperature for OpenAI Responses request: model does not support sampling controls.');
    }
    if (typeof topP === 'number' && modelSupportsRequestTopP('openai', modelId)) {
        requestBody.top_p = topP;
    } else if (typeof topP === 'number') {
        adapterNotes.push('Stripped top_p for OpenAI Responses request: model does not support sampling controls.');
    }
    if (promptCacheRetention) {
        requestBody.prompt_cache_retention = promptCacheRetention;
    }
    if (promptCacheKey) {
        requestBody.prompt_cache_key = promptCacheKey;
    }
    if (useBackgroundMode) {
        requestBody.background = true;
        requestBody.store = true;
        adapterNotes.push('OpenAI Responses background mode enabled for pro lane.');
    }

    let responseData: unknown;

    try {
        const response = await requestUrl({
            url: apiUrl,
            method: 'POST',
            headers: {
                Authorization: `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestBody),
            throw: false
        });
        responseData = response.json;
        if (response.status >= 400) {
            const errorDetails = responseData as OpenAiErrorResponse;
            const msg = errorDetails?.error?.message ?? response.text ?? `OpenAI error (${response.status})`;
            if (responseFormat && /(response_format|json|text\.format)/i.test(msg)) {
                return {
                    success: false,
                    content: null,
                    responseData,
                    requestPayload: requestBody,
                    adapterNotes: [
                        'OpenAI Responses text.format was rejected by the model or endpoint; RT did not retry without structured-format enforcement.'
                    ],
                    error: `OpenAI Responses rejected structured text.format: ${msg}`
                };
            }
            return { success: false, content: null, responseData, requestPayload: requestBody, adapterNotes, error: msg };
        }
        if (useBackgroundMode) {
            responseData = await pollOpenAiBackgroundResponse(apiKey, responseData);
        }

        const content = extractOpenAiResponsesContent(responseData);
        const citations = extractOpenAiAnnotationCitations(responseData);
        const normalizedResponseData = normalizeOpenAiResponsesResponseData(responseData, modelId, content);
        if (content) {
            return {
                success: true,
                content,
                responseData: normalizedResponseData,
                requestPayload: requestBody,
                adapterNotes,
                ...(citations.length ? { citations } : {})
            };
        }

        const incompleteReason = extractResponsesErrorReason(responseData);
        if (incompleteReason) {
            return {
                success: false,
                content: null,
                responseData: normalizedResponseData,
                requestPayload: requestBody,
                adapterNotes,
                error: `OpenAI Responses returned incomplete output (${incompleteReason}).`
            };
        }
        const failureMessage = extractResponsesFailureMessage(responseData);
        if (failureMessage) {
            return {
                success: false,
                content: null,
                responseData: normalizedResponseData,
                requestPayload: requestBody,
                adapterNotes,
                error: failureMessage
            };
        }

        return {
            success: false,
            content: null,
            responseData: normalizedResponseData,
            requestPayload: requestBody,
            adapterNotes,
            error: 'Invalid response structure from OpenAI Responses API.'
        };
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        responseData = { error: { message: msg, type: 'network_or_execution_error' } };
        return { success: false, content: null, responseData, requestPayload: requestBody, adapterNotes, error: msg };
    }
}

// --- fetch models ---
interface OpenAiModel { id: string; object: string; created: number; owned_by: string; }
interface OpenAiListModelsResponse { object: string; data: OpenAiModel[]; }
export async function fetchOpenAiModels(apiKey: string): Promise<OpenAiModel[]> {
    if (!apiKey) throw new Error('OpenAI API key is required to fetch models.');
    const response = await requestUrl({
        url: 'https://api.openai.com/v1/models',
        method: 'GET',
        headers: { Authorization: `Bearer ${apiKey}` },
        throw: false,
    });
    const data = response.json as OpenAiListModelsResponse;
    if (response.status >= 400 || !Array.isArray(data?.data)) {
        throw new Error(`Error fetching models (${response.status})`);
    }
    return data.data.sort((a, b) => a.id.localeCompare(b.id));
} 
