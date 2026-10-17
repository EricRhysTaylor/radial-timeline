import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { describe, expect, it, vi } from 'vitest';
import { fetchOpenAiCompatibleLocalModels, LOCAL_LLM_CANCELLED } from './transport';

async function withServer(
    respond: (req: IncomingMessage, res: ServerResponse) => void,
    check: (baseUrl: string) => Promise<void>
): Promise<void> {
    const server = createServer(respond);
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected a TCP fixture endpoint');
    try {
        await check(`http://127.0.0.1:${address.port}/v1`);
    } finally {
        server.closeAllConnections();
        await new Promise<void>(resolve => server.close(() => resolve()));
    }
}

describe('local model discovery over a real bounded socket', () => {
    it('loads Unicode model metadata without requiring server CORS headers', async () => {
        await withServer((req, res) => {
            expect(req.url).toBe('/v1/models');
            expect(req.method).toBe('GET');
            expect(req.headers.authorization).toBe('Bearer fixture-key');
            res.end(JSON.stringify({ data: [{ id: 'modèle-ไทย', context_length: 32000 }, { id: '' }] }));
        }, async baseUrl => {
            await expect(fetchOpenAiCompatibleLocalModels({ baseUrl, timeoutMs: 1000, apiKey: 'fixture-key' }))
                .resolves.toEqual([{ id: 'modèle-ไทย', contextWindow: 32000, maxOutput: undefined, object: undefined }]);
        });
    });

    it.each(['timeout', 'abort', 'permission'] as const)('disconnects a hung probe on %s without retrying', async trigger => {
        let requests = 0, closed = false, allowed = true;
        const controller = new AbortController();
        await withServer((_req, res) => {
            requests++;
            res.once('close', () => { closed = true; });
            if (trigger === 'abort') controller.abort();
            if (trigger === 'permission') allowed = false;
        }, async baseUrl => {
            await expect(fetchOpenAiCompatibleLocalModels({
                baseUrl, timeoutMs: trigger === 'timeout' ? 100 : 2000, signal: controller.signal,
                requestControl: {
                    assertActive: () => { if (!allowed) throw new Error('AI permission withdrawn'); },
                    timeoutMs: 2000, retryPolicy: { maxAttempts: 3, baseDelayMs: 0 }
                }
            })).rejects.toThrow(trigger === 'timeout' ? 'timed out' : trigger === 'abort' ? 'aborted' : 'permission withdrawn');
            await vi.waitFor(() => expect(closed).toBe(true));
            expect(requests).toBe(1);
        });
    });

    it('rejects an oversized body and closes the connection', async () => {
        let closed = false;
        await withServer((_req, res) => {
            res.once('close', () => { closed = true; });
            res.write('x'.repeat(2_000_001));
        }, async baseUrl => {
            await expect(fetchOpenAiCompatibleLocalModels({ baseUrl, timeoutMs: 1000 })).rejects.toThrow('size limit');
            await vi.waitFor(() => expect(closed).toBe(true));
        });
    });

    it('does not connect when already cancelled', async () => {
        const controller = new AbortController();
        controller.abort();
        await expect(fetchOpenAiCompatibleLocalModels({
            baseUrl: 'http://127.0.0.1:1/v1', timeoutMs: 1000, signal: controller.signal
        })).rejects.toThrow(LOCAL_LLM_CANCELLED);
    });

    it.each([
        [200, '{"unexpected":true}', 'unexpected model list'],
        [200, 'not JSON', 'JSON'],
        [401, '{"error":{"message":"Fixture key rejected"}}', 'Fixture key rejected'],
        [503, '{"error":{"message":"Fixture unavailable"}}', 'Fixture unavailable']
    ])('rejects an invalid %s response without retrying', async (status, body, error) => {
        let requests = 0;
        await withServer((_req, res) => {
            requests++;
            res.writeHead(Number(status));
            res.end(String(body));
        }, async baseUrl => {
            await expect(fetchOpenAiCompatibleLocalModels({ baseUrl, timeoutMs: 1000 })).rejects.toThrow(String(error));
            expect(requests).toBe(1);
        });
    });
});
