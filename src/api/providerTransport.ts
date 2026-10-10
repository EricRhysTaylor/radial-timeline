import { request } from 'https'; // SAFE: desktop-only abortable HTTPS sockets and SSE; Obsidian requestUrl exposes neither cancellation nor response streaming
import type { RequestUrlParam } from 'obsidian';
import type { AIRequestControl } from '../ai/types';
import { redactSensitiveValue } from '../ai/credentials/redactSensitive';
import { classifyProviderError } from './providerErrors';

export interface ProviderHttpResponse {
    status: number;
    headers: Record<string, string>;
    text: string;
    json: unknown;
    retryCount: number;
}

/** A transport failure preserves HTTP diagnostics without persisting request headers. */
export class ProviderTransportError extends Error {
    constructor(message: string, readonly status?: number, readonly headers: Record<string, string> = {}) {
        super(redactSensitiveValue(message));
    }
}

function requestTimeout(options: RequestUrlParam, control?: AIRequestControl): number {
    return control ? control.timeoutMs : options.method === 'GET' ? 30_000 : 600_000;
}

/** Assemble a complete streamed Message; partial streams never become successful responses. */
export function decodeAnthropicStream(text: string): unknown {
    let message: Record<string, unknown> | undefined;
    const blocks: Record<string, unknown>[] = [];
    const toolJson = new Map<number, string>();
    let completed = false;
    for (const frame of text.split(/\r?\n\r?\n/)) {
        const data = frame.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
        if (!data) continue;
        const event = JSON.parse(data) as Record<string, unknown>;
        if (event.type === 'error') {
            const error = event.error as { message?: string };
            throw new ProviderTransportError(`Anthropic stream failed: ${error.message}`);
        }
        if (event.type === 'message_start') message = event.message as Record<string, unknown>;
        if (event.type === 'content_block_start') blocks[event.index as number] = event.content_block as Record<string, unknown>;
        if (event.type === 'content_block_delta') {
            const index = event.index as number;
            const block = blocks[index];
            if (!block) throw new ProviderTransportError('Anthropic stream delta has no content block.');
            const delta = event.delta as Record<string, unknown>;
            if (delta.type === 'text_delta') block.text = `${block.text}${delta.text}`;
            if (delta.type === 'thinking_delta') block.thinking = `${block.thinking}${delta.thinking}`;
            if (delta.type === 'signature_delta') block.signature = `${block.signature}${delta.signature}`;
            if (delta.type === 'input_json_delta') toolJson.set(index, `${toolJson.get(index) ?? ''}${delta.partial_json}`); // SAFE: the first tool delta starts an empty JSON buffer
            if (delta.type === 'citations_delta') {
                if (!Array.isArray(block.citations)) block.citations = [];
                (block.citations as unknown[]).push(delta.citation);
            }
        }
        if (event.type === 'message_delta' && message) {
            Object.assign(message, event.delta);
            message.usage = { ...(message.usage as Record<string, unknown>), ...(event.usage as Record<string, unknown>) };
        }
        if (event.type === 'message_stop') completed = true;
    }
    if (!message || !completed) throw new ProviderTransportError('Anthropic response stream ended before message_stop.');
    for (const [index, json] of toolJson) blocks[index].input = JSON.parse(json);
    return { ...message, content: blocks };
}

function sendProviderRequest(options: RequestUrlParam, control?: AIRequestControl): Promise<ProviderHttpResponse> {
    control?.assertActive();
    const url = new URL(options.url);
    if (url.protocol !== 'https:') throw new ProviderTransportError('Cloud provider requests require HTTPS.');
    const body = typeof options.body === 'string' ? Buffer.from(options.body, 'utf8') : options.body ? Buffer.from(options.body) : undefined;
    if (url.hostname === 'api.anthropic.com' && body && body.byteLength > 32 * 1024 * 1024) {
        throw new ProviderTransportError('Anthropic request exceeds the 32 MB request limit.', 413);
    }
    return new Promise((resolve, reject) => {
        let settled = false;
        const timeoutMs = requestTimeout(options, control);
        const finish = (error?: Error, response?: ProviderHttpResponse): void => {
            if (settled) return;
            settled = true;
            window.clearTimeout(deadline);
            window.clearInterval(permissionPoll);
            if (error) reject(error);
            else if (response) resolve(response);
        };
        const req = request(url, { method: options.method, headers: options.headers }, res => {
            const headers: Record<string, string> = {};
            for (const [key, value] of Object.entries(res.headers)) {
                if (value !== undefined) headers[key.toLowerCase()] = Array.isArray(value) ? value.join(', ') : String(value);
            }
            const chunks: Buffer[] = [];
            res.on('data', (chunk: Buffer) => chunks.push(chunk));
            res.on('error', error => finish(new ProviderTransportError(error.message)));
            res.on('aborted', () => finish(new ProviderTransportError('Provider response connection ended before completion.')));
            res.on('end', () => {
                try {
                    control?.assertActive();
                    const text = Buffer.concat(chunks).toString('utf8');
                    const status = res.statusCode;
                    if (status === undefined) throw new ProviderTransportError('Provider returned no HTTP status.');
                    if (status >= 300 && status < 400) throw new ProviderTransportError('Provider redirect refused; credentials and manuscript were not forwarded.', status);
                    let json: unknown;
                    if (headers['content-type']?.includes('text/event-stream')) {
                        json = decodeAnthropicStream(text);
                    } else if (status >= 400) {
                        // Non-JSON gateway failures still preserve status and retry headers.
                        try { json = JSON.parse(text); }
                        catch { json = { error: { message: redactSensitiveValue(text || `HTTP ${status}`) } }; } // SAFE: error response body only; never substitutes a successful result
                    } else {
                        json = JSON.parse(text);
                    }
                    finish(undefined, { status, headers, text, json, retryCount: 0 });
                } catch (error) {
                    finish(error instanceof Error ? error : new Error(String(error)));
                }
            });
        });
        req.on('error', error => finish(new ProviderTransportError(error.message)));
        const stop = (error: Error): void => { req.destroy(error); finish(error); };
        const deadline = window.setTimeout(() => stop(new ProviderTransportError('Provider request timed out; it was not automatically resubmitted.')), timeoutMs);
        const permissionPoll = control ? window.setInterval(() => { // SAFE: request-scoped poll cleared by finish() on completion, error, cancellation, and timeout
            try { control?.assertActive(); }
            catch (error) { stop(error instanceof Error ? error : new Error(String(error))); }
        }, 100) : undefined;
        try {
            // Credential resolution and request construction may have awaited work.
            control?.assertActive();
            if (body) req.write(body);
            req.end();
        } catch (error) {
            stop(error instanceof Error ? error : new Error(String(error)));
        }
    });
}

/** Retry only explicit transient HTTP rejections, never ambiguous network/timeout failures. */
export async function requestProvider(options: RequestUrlParam, control?: AIRequestControl): Promise<ProviderHttpResponse> {
    const maxAttempts = control?.retryPolicy.maxAttempts ?? 1; // SAFE: metadata/key-validation requests make one attempt
    const started = Date.now();
    const deadlineMs = requestTimeout(options, control);
    for (let attempt = 0; ; attempt += 1) {
        control?.assertActive();
        const remaining = deadlineMs - (Date.now() - started);
        if (remaining <= 0) throw new ProviderTransportError('Provider request timed out before retry.');
        const response = await sendProviderRequest(options, control ? { ...control, timeoutMs: remaining } : undefined);
        const classification = classifyProviderError({ status: response.status, responseData: response.json });
        const transient = response.status === 429 || [500, 502, 503, 529].includes(response.status);
        const terminal = classification.aiReason === 'spend_cap' || classification.aiReason === 'quota_exceeded';
        if (!transient || terminal || attempt + 1 >= maxAttempts) return { ...response, retryCount: attempt };
        const retryAfter = response.headers['retry-after'];
        const serverDelay = retryAfter ? (/^\d+(\.\d+)?$/.test(retryAfter) ? Number(retryAfter) * 1000 : Date.parse(retryAfter) - Date.now()) : 0;
        const baseDelayMs = control?.retryPolicy.baseDelayMs ?? 400; // SAFE: only managed generation retries reach this branch
        const delay = Math.max(Number.isFinite(serverDelay) ? serverDelay : 0, baseDelayMs * 2 ** attempt + Math.random() * baseDelayMs);
        if (delay >= deadlineMs - (Date.now() - started)) throw new ProviderTransportError('Provider retry would exceed the request deadline.', response.status, response.headers);
        const until = Date.now() + delay;
        while (Date.now() < until) {
            control?.assertActive();
            await new Promise<void>(resolve => window.setTimeout(resolve, Math.min(100, until - Date.now())));
        }
    }
}
