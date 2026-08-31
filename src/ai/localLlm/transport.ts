import { requestUrl } from 'obsidian';

export interface LocalLlmTransportRequest {
    baseUrl: string;
    timeoutMs: number;
    apiKey?: string;
    /**
     * Cancels the client request.
     *
     * A local server may continue compute until its next write observes the
     * disconnect. Callers must still serialize model jobs rather than treating
     * an HTTP abort as proof that the model is idle.
     */
    signal?: AbortSignal;
}

/** Raised when the caller cancelled, as distinct from a timeout. */
export const LOCAL_LLM_CANCELLED = 'Local LLM request cancelled.';

export interface LocalLlmModelEntry {
    id: string;
    object?: string;
    contextWindow?: number;
    maxOutput?: number;
}

export interface LocalLlmCompletionResponse {
    success: boolean;
    content: string | null;
    responseData: unknown;
    requestPayload: unknown;
    error?: string;
}

type OpenAiCompatibleMessage = {
    role: 'system' | 'user';
    content: string;
};

type OpenAiCompatibleTextPart = {
    type?: string;
    text?: string;
    output_text?: string;
    [key: string]: unknown;
};

type OpenAiCompatibleChoice = {
    message?: {
        content?: unknown;
    };
};

type JsonRecord = Record<string, unknown>;

export type LocalLlmWireResponseFormat =
    | { type: 'json_object' }
    | {
        type: 'json_schema';
        json_schema: { name: string; strict?: boolean; schema: Record<string, unknown> };
    };

/**
 * Bound a promise with a wall-clock deadline. Exported so the settings panel can
 * put an overall ceiling on the multi-step validation chain: each transport call
 * already has its own timeout, but a socket that accepts and never answers (e.g. a
 * server bound IPv4-only behind an IPv6 `localhost`) leaves the chain hanging with
 * no ceiling of its own.
 */
export function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
    return new Promise((resolve, reject) => {
        const timer = window.setTimeout(() => reject(new Error(message)), timeoutMs);
        promise.then(
            value => {
                window.clearTimeout(timer);
                resolve(value);
            },
            error => {
                window.clearTimeout(timer);
                reject(error instanceof Error ? error : new Error(String(error)));
            }
        );
    });
}

function normalizeBaseUrl(baseUrl: string, path: string): string {
    const trimmed = baseUrl.trim().replace(/\/+$/, '');
    if (trimmed.endsWith(path)) return trimmed;
    return `${trimmed}${path}`;
}

function normalizeOllamaApiUrl(baseUrl: string, path: string): string {
    const trimmed = baseUrl.trim().replace(/\/+$/, '');
    const withoutV1 = trimmed.endsWith('/v1') ? trimmed.slice(0, -3) : trimmed;
    return `${withoutV1}${path}`;
}

function asRecord(value: unknown): JsonRecord | null {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value as JsonRecord
        : null;
}

function readFiniteNumber(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
    if (typeof value === 'string') {
        const parsed = Number(value.trim());
        if (Number.isFinite(parsed) && parsed > 0) return parsed;
    }
    return null;
}

function getValueAtPath(record: JsonRecord, path: string[]): unknown {
    let current: unknown = record;
    for (const segment of path) {
        const next = asRecord(current);
        if (!next) return undefined;
        current = next[segment];
    }
    return current;
}

function findNumericValueByKey(
    value: unknown,
    matcher: (key: string) => boolean,
    maxDepth = 4
): number | null {
    if (maxDepth < 0) return null;
    const record = asRecord(value);
    if (!record) return null;
    for (const [key, child] of Object.entries(record)) {
        if (matcher(key)) {
            const direct = readFiniteNumber(child);
            if (direct !== null) return direct;
        }
        const nested = findNumericValueByKey(child, matcher, maxDepth - 1);
        if (nested !== null) return nested;
    }
    return null;
}

function extractContextWindow(record: JsonRecord): number | null {
    const directPaths = [
        ['contextWindow'],
        ['context_window'],
        ['context_length'],
        ['max_context_length'],
        ['maxContextLength'],
        ['num_ctx'],
        ['n_ctx'],
        ['metadata', 'contextWindow'],
        ['metadata', 'context_window'],
        ['metadata', 'context_length'],
        ['metadata', 'max_context_length'],
        ['limits', 'contextWindow'],
        ['limits', 'context_window'],
        ['limits', 'context_length']
    ];
    for (const path of directPaths) {
        const value = readFiniteNumber(getValueAtPath(record, path));
        if (value !== null) return value;
    }
    return findNumericValueByKey(record, key => (
        key === 'contextWindow'
        || key === 'context_window'
        || key === 'context_length'
        || key === 'max_context_length'
        || key === 'maxContextLength'
        || key === 'num_ctx'
        || key === 'n_ctx'
        || key.endsWith('.context_length')
        || key.endsWith('.context_window')
    ));
}

function extractMaxOutput(record: JsonRecord): number | null {
    const directPaths = [
        ['maxOutput'],
        ['max_output'],
        ['max_completion_tokens'],
        ['maxCompletionTokens'],
        ['max_tokens'],
        ['maxTokens'],
        ['num_predict'],
        ['metadata', 'maxOutput'],
        ['metadata', 'max_output'],
        ['metadata', 'max_completion_tokens'],
        ['limits', 'maxOutput'],
        ['limits', 'max_output'],
        ['limits', 'max_tokens']
    ];
    for (const path of directPaths) {
        const value = readFiniteNumber(getValueAtPath(record, path));
        if (value !== null) return value;
    }
    return findNumericValueByKey(record, key => (
        key === 'maxOutput'
        || key === 'max_output'
        || key === 'max_completion_tokens'
        || key === 'maxCompletionTokens'
        || key === 'max_tokens'
        || key === 'maxTokens'
        || key === 'num_predict'
        || key.endsWith('.max_output')
        || key.endsWith('.max_tokens')
    ));
}

function normalizeLocalLlmModelEntry(value: unknown): LocalLlmModelEntry | null {
    const record = asRecord(value);
    if (!record) return null;
    const id = typeof record.id === 'string' && record.id.trim()
        ? record.id.trim()
        : null;
    if (!id) return null;
    return {
        id,
        object: typeof record.object === 'string' ? record.object : undefined,
        contextWindow: extractContextWindow(record) ?? undefined,
        maxOutput: extractMaxOutput(record) ?? undefined
    };
}

function extractString(value: unknown): string | null {
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (!Array.isArray(value)) return null;
    const chunks = value
        .map(part => {
            if (!part || typeof part !== 'object') return null;
            const record = part as OpenAiCompatibleTextPart;
            return typeof record.output_text === 'string' && record.output_text.trim()
                ? record.output_text.trim()
                : (typeof record.text === 'string' && record.text.trim() ? record.text.trim() : null);
        })
        .filter((chunk): chunk is string => !!chunk);
    return chunks.length ? chunks.join('\n\n') : null;
}

function buildHeaders(apiKey?: string): Record<string, string> {
    const headers: Record<string, string> = {
        'Content-Type': 'application/json'
    };
    if (apiKey?.trim()) {
        headers.Authorization = `Bearer ${apiKey.trim()}`;
    }
    return headers;
}

function buildMessages(systemPrompt: string | null | undefined, userPrompt: string): OpenAiCompatibleMessage[] {
    if (systemPrompt && systemPrompt.trim()) {
        return [
            { role: 'system', content: systemPrompt.trim() },
            { role: 'user', content: userPrompt }
        ];
    }
    return [{ role: 'user', content: userPrompt }];
}

type ModelListResponse = { data?: unknown[]; error?: { message?: string } };

/** A model list is a few KB; anything larger is not an LLM `/models` endpoint. */
const MODEL_LIST_MAX_BYTES = 2_000_000;

/** A completion is bounded by max_completion_tokens; this is a sanity ceiling. */
const COMPLETION_MAX_BYTES = 8_000_000;

function normalizeModelList(responseData: ModelListResponse): LocalLlmModelEntry[] {
    if (!Array.isArray(responseData?.data)) {
        throw new Error('Local LLM backend returned an unexpected model list response.');
    }
    return responseData.data
        .map(entry => normalizeLocalLlmModelEntry(entry))
        .filter((entry): entry is LocalLlmModelEntry => !!entry);
}

/** Read a fetch body up to a byte cap, cancelling the stream if it is exceeded. */
async function readBoundedText(response: Response, maxBytes: number): Promise<string> {
    if (!response.body) return response.text();
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        total += value.length;
        if (total > maxBytes) {
            await reader.cancel();
            throw new Error('Local LLM model list response was too large.');
        }
        chunks.push(value);
    }
    const merged = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
        merged.set(chunk, offset);
        offset += chunk.length;
    }
    return new TextDecoder().decode(merged);
}

/**
 * Probe `/models` with an abortable, size-bounded fetch. Unlike Obsidian's
 * requestUrl, this genuinely cancels on timeout and caps the buffered body, so a
 * hung or huge response on a wrong port cannot exhaust the renderer heap (the
 * "Load Servers" crash vector).
 */
async function fetchModelListAbortable(request: LocalLlmTransportRequest): Promise<LocalLlmModelEntry[]> {
    const url = normalizeBaseUrl(request.baseUrl, '/models');
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), request.timeoutMs);
    try {
        const response = await fetch(url, {
            method: 'GET',
            headers: buildHeaders(request.apiKey),
            signal: controller.signal
        });
        const text = await readBoundedText(response, MODEL_LIST_MAX_BYTES);
        let responseData: ModelListResponse;
        try {
            responseData = JSON.parse(text) as ModelListResponse;
        } catch {
            throw new Error('Local LLM backend returned an unexpected model list response.');
        }
        if (response.status >= 400) {
            throw new Error(responseData?.error?.message || `HTTP ${response.status}`); // SAFE: the throw is the failure signal; the bare status line stands in only when the local server sends no message
        }
        return normalizeModelList(responseData);
    } finally {
        window.clearTimeout(timer);
    }
}

/** CORS-safe fallback via requestUrl — only reached on a fast fetch failure, never after a timeout-abort. */
async function fetchModelListViaRequestUrl(request: LocalLlmTransportRequest): Promise<LocalLlmModelEntry[]> {
    const response = await withTimeout(requestUrl({
        url: normalizeBaseUrl(request.baseUrl, '/models'),
        method: 'GET',
        headers: buildHeaders(request.apiKey),
        throw: false
    }), request.timeoutMs, 'Local LLM model list request timed out.');
    const responseData = response.json as ModelListResponse;
    if (response.status >= 400) {
        throw new Error(responseData?.error?.message || `HTTP ${response.status}`); // SAFE: the throw is the failure signal; the bare status line stands in only when the local server sends no message
    }
    return normalizeModelList(responseData);
}

export async function fetchOpenAiCompatibleLocalModels(
    request: LocalLlmTransportRequest
): Promise<LocalLlmModelEntry[]> {
    try {
        return await fetchModelListAbortable(request);
    } catch (error) {
        // A TypeError means fetch could not connect (CORS block or connection
        // refused) — retry via the CORS-safe requestUrl path. Every other error
        // (timeout-abort, oversize body, HTTP status, bad JSON) means the endpoint
        // DID respond or is hung, so we must NOT hand it to the un-cancellable
        // requestUrl buffer — that is precisely the crash we are fixing.
        if (error instanceof TypeError) {
            return await fetchModelListViaRequestUrl(request);
        }
        if (error instanceof DOMException && error.name === 'AbortError') {
            throw new Error('Local LLM model list request timed out.');
        }
        throw error;
    }
}

export async function fetchOllamaModelDetails(
    request: LocalLlmTransportRequest,
    modelId: string
): Promise<Partial<LocalLlmModelEntry>> {
    const response = await withTimeout(requestUrl({
        url: normalizeOllamaApiUrl(request.baseUrl, '/api/show'),
        method: 'POST',
        headers: buildHeaders(request.apiKey),
        body: JSON.stringify({ name: modelId }),
        throw: false
    }), request.timeoutMs, 'Ollama model details request timed out.');
    const responseData = response.json as JsonRecord & { error?: { message?: string } };
    if (response.status >= 400) {
        throw new Error(asRecord(responseData?.error)?.message as string || `HTTP ${response.status}`);
    }
    const modelInfo = asRecord(responseData.model_info) ?? responseData;
    return {
        contextWindow: extractContextWindow(modelInfo) ?? undefined,
        maxOutput: extractMaxOutput(modelInfo) ?? undefined
    };
}

/**
 * Genuinely abortable HTTP completion.
 *
 * Returns null when the connection could not be established at all, so the
 * caller can try the CORS-safe path. Aborts — timeout or caller cancel — are
 * thrown, never retried: retrying through a non-abortable transport is exactly
 * how a cancelled request turns back into an orphan.
 */
async function fetchCompletionAbortable(
    url: string,
    requestPayload: Record<string, unknown>,
    transport: LocalLlmTransportRequest
): Promise<{ status: number; text: string } | null> {
    const controller = new AbortController();
    let timedOut = false;
    const timer = window.setTimeout(() => {
        timedOut = true;
        controller.abort();
    }, transport.timeoutMs);
    const onExternalAbort = () => controller.abort();
    // An AbortSignal is not a DOM element: registerDomEvent cannot bind it, and
    // this is a module-level function with no Component to own the handle.
    // SAFE: removed unconditionally in the finally below, so it cannot leak.
    transport.signal?.addEventListener('abort', onExternalAbort);

    try {
        // This path exists so a cancelled or timed-out completion actually stops
        // (see the doc above). SAFE: requestUrl cannot be aborted.
        const response = await fetch(url, {
            method: 'POST',
            headers: buildHeaders(transport.apiKey),
            body: JSON.stringify(requestPayload),
            signal: controller.signal
        });
        const text = await readBoundedText(response, COMPLETION_MAX_BYTES);
        return { status: response.status, text };
    } catch (error) {
        if (timedOut) throw new Error('Local LLM completion request timed out.');
        if (transport.signal?.aborted) throw new Error(LOCAL_LLM_CANCELLED);
        // A TypeError here means the connection never happened (CORS block or
        // refused), which the requestUrl path may still manage.
        if (error instanceof TypeError) return null;
        throw error;
    } finally {
        window.clearTimeout(timer);
        transport.signal?.removeEventListener('abort', onExternalAbort);
    }
}

export async function callOpenAiCompatibleLocalCompletion(input: {
    transport: LocalLlmTransportRequest;
    modelId: string;
    systemPrompt?: string | null;
    userPrompt: string;
    maxOutputTokens?: number;
    temperature?: number;
    topP?: number;
    responseFormat?: LocalLlmWireResponseFormat;
}): Promise<LocalLlmCompletionResponse> {
    const requestPayload: Record<string, unknown> = {
        model: input.modelId,
        messages: buildMessages(input.systemPrompt, input.userPrompt)
    };
    if (typeof input.maxOutputTokens === 'number') {
        requestPayload.max_completion_tokens = input.maxOutputTokens;
    }
    if (typeof input.temperature === 'number') {
        requestPayload.temperature = input.temperature;
    }
    if (typeof input.topP === 'number') {
        requestPayload.top_p = input.topP;
    }
    if (input.responseFormat) {
        requestPayload.response_format = input.responseFormat;
    }

    const url = normalizeBaseUrl(input.transport.baseUrl, '/chat/completions');

    const interpret = (status: number, responseData: unknown): LocalLlmCompletionResponse => {
        if (status >= 400) {
            const message = (responseData as { error?: { message?: string } })?.error?.message
                || `HTTP ${status}`;
            return { success: false, content: null, responseData, requestPayload, error: message };
        }
        const choices = Array.isArray((responseData as { choices?: OpenAiCompatibleChoice[] })?.choices)
            ? (responseData as { choices: OpenAiCompatibleChoice[] }).choices
            : [];
        const content = extractString(choices[0]?.message?.content);
        if (!content) {
            return {
                success: false,
                content: null,
                responseData,
                requestPayload,
                error: 'Local LLM backend returned no completion content.'
            };
        }
        return { success: true, content, responseData, requestPayload };
    };

    try {
        // Abortable first so the client releases the connection on timeout. The
        // local server may not observe that disconnect until its next write.
        const direct = await fetchCompletionAbortable(url, requestPayload, input.transport);
        if (direct) {
            let responseData: unknown;
            try {
                responseData = JSON.parse(direct.text);
            } catch {
                return {
                    success: false,
                    content: null,
                    responseData: direct.text,
                    requestPayload,
                    error: 'Local LLM backend returned a non-JSON response.'
                };
            }
            return interpret(direct.status, responseData);
        }

        // CORS-safe fallback, reached only when the connection never happened —
        // never after an abort, which is thrown above.
        const response = await withTimeout(requestUrl({
            url,
            method: 'POST',
            headers: buildHeaders(input.transport.apiKey),
            body: JSON.stringify(requestPayload),
            throw: false
        }), input.transport.timeoutMs, 'Local LLM completion request timed out.');
        return interpret(response.status, response.json);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
            success: false,
            content: null,
            responseData: { error: { message } },
            requestPayload,
            error: message
        };
    }
}
