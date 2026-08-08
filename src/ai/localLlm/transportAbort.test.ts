import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { callOpenAiCompatibleLocalCompletion, LOCAL_LLM_CANCELLED } from './transport';

/**
 * A caller giving up must stop the server too. Without an abort, `requestUrl`
 * keeps the connection open and the model keeps generating an answer nobody
 * will collect — those orphans accumulate across the server's parallel slots
 * until it is wedged.
 */

const originalFetch = globalThis.fetch;

const jsonResponse = (body: unknown, status = 200) => ({
    status,
    body: null,
    text: () => Promise.resolve(JSON.stringify(body))
}) as unknown as Response;

const base = {
    transport: { baseUrl: 'http://localhost:1234/v1', timeoutMs: 5000 },
    modelId: 'm',
    userPrompt: 'hi'
};

beforeEach(() => { vi.useRealTimers(); });
afterEach(() => { globalThis.fetch = originalFetch; });

describe('local completion abort', () => {
    it('passes an abort signal to fetch', async () => {
        let seen: AbortSignal | undefined;
        globalThis.fetch = vi.fn((_url: unknown, init?: RequestInit) => {
            seen = init?.signal ?? undefined;
            return Promise.resolve(jsonResponse({ choices: [{ message: { content: 'ok' } }] }));
        }) as never;

        const result = await callOpenAiCompatibleLocalCompletion(base);

        expect(result.success).toBe(true);
        expect(seen).toBeInstanceOf(AbortSignal);
    });

    it('reports a caller cancel distinctly from a timeout', async () => {
        const controller = new AbortController();
        globalThis.fetch = vi.fn((_url: unknown, init?: RequestInit) => new Promise((_res, rej) => {
            init?.signal?.addEventListener('abort', () => rej(new DOMException('Aborted', 'AbortError')));
        })) as never;

        const pending = callOpenAiCompatibleLocalCompletion({
            ...base,
            transport: { ...base.transport, signal: controller.signal }
        });
        controller.abort();
        const result = await pending;

        expect(result.success).toBe(false);
        expect(result.error).toBe(LOCAL_LLM_CANCELLED);
    });

    it('never retries through the non-abortable path after a cancel', async () => {
        // Retrying via requestUrl is exactly how a cancelled request becomes an
        // orphan again.
        const controller = new AbortController();
        const fetchMock = vi.fn((_url: unknown, init?: RequestInit) => new Promise((_res, rej) => {
            init?.signal?.addEventListener('abort', () => rej(new DOMException('Aborted', 'AbortError')));
        }));
        globalThis.fetch = fetchMock as never;

        const pending = callOpenAiCompatibleLocalCompletion({
            ...base,
            transport: { ...base.transport, signal: controller.signal }
        });
        controller.abort();
        await pending;

        // One attempt only; the requestUrl mock would have thrown its own error.
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('times out without leaving the request running', async () => {
        globalThis.fetch = vi.fn((_url: unknown, init?: RequestInit) => new Promise((_res, rej) => {
            init?.signal?.addEventListener('abort', () => rej(new DOMException('Aborted', 'AbortError')));
        })) as never;

        const result = await callOpenAiCompatibleLocalCompletion({
            ...base,
            transport: { ...base.transport, timeoutMs: 20 }
        });

        expect(result.success).toBe(false);
        expect(result.error).toContain('timed out');
    });

    it('falls back to the CORS-safe path only when the connection never happened', async () => {
        // A TypeError means fetch could not connect at all — requestUrl may
        // still manage it. The mock throws, which is enough to prove the
        // fallback was attempted rather than the abort path taken.
        globalThis.fetch = vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))) as never;

        const result = await callOpenAiCompatibleLocalCompletion(base);

        expect(result.success).toBe(false);
        expect(result.error).toContain('requestUrl should be mocked');
    });
});
