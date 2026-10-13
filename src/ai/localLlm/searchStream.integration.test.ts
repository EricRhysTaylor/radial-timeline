import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import { afterEach, describe, expect, it } from 'vitest';
import { callOpenAiCompatibleLocalCompletion, LOCAL_LLM_CANCELLED } from './transport';
let server: Server | undefined;
afterEach(async () => {
    if (!server) return;
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve()));
    server = undefined;
});
async function url() {
    server!.listen(0, '127.0.0.1'); await once(server!, 'listening');
    const address = server!.address();
    if (!address || typeof address === 'string') throw new Error('missing server address');
    return `http://127.0.0.1:${address.port}/v1`;
}
const frame = (content: string, finish_reason: string | null = null) => `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content }, finish_reason }] })}\n\n`;
describe('abortable local search streaming', () => {
    it('sends a framed streaming POST and returns reassembled JSON', async () => {
        let payload: Record<string, unknown> = {}, declared = 0, received = 0;
        server = createServer((req, res) => {
            const chunks: Buffer[] = [];
            req.on('data', chunk => chunks.push(chunk));
            req.on('end', () => {
                const body = Buffer.concat(chunks); received = body.length; declared = Number(req.headers['content-length']);
                payload = JSON.parse(body.toString('utf8'));
                res.writeHead(200, { 'Content-Type': 'text/event-stream' });
                res.write(': prefill\n\n'); res.write(frame('{"answer":"café '));
                res.end(frame('海"}', 'stop') + 'data: [DONE]\n\n');
            });
        });
        const result = await callOpenAiCompatibleLocalCompletion({ transport: { baseUrl: await url(), timeoutMs: 5000 }, modelId: 'fixture',
            userPrompt: '海', stream: true, maxOutputTokens: 512 });
        expect(payload.stream).toBe(true); expect(declared).toBe(received);
        expect(result.success).toBe(true); expect(result.content).toBe('{"answer":"café 海"}');
    });
    it('closes the server connection when cancelled mid-generation, without another POST', async () => {
        let writes = 0, requests = 0;
        let started!: () => void, disconnected!: () => void;
        const begun = new Promise<void>(resolve => { started = resolve; });
        const closed = new Promise<void>(resolve => { disconnected = resolve; });
        server = createServer((req, res) => {
            requests += 1; req.resume();
            req.on('end', () => {
                res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.write(frame('{'));
                started();
                const timer = setInterval(() => { writes += 1; res.write(': generating\n\n'); }, 5);
                res.on('close', () => { clearInterval(timer); disconnected(); });
            });
        });
        const cancel = new AbortController();
        const pending = callOpenAiCompatibleLocalCompletion({ transport: { baseUrl: await url(), timeoutMs: 5000, signal: cancel.signal },
            modelId: 'fixture', userPrompt: 'fixture', stream: true });
        await begun; cancel.abort(); const result = await pending; await closed;
        expect(result.success).toBe(false); expect(result.error).toBe(LOCAL_LLM_CANCELLED); expect(requests).toBe(1);
        const count = writes; await new Promise(resolve => setTimeout(resolve, 20)); expect(writes).toBe(count);
    });
});

it('finishes at DONE even when the server leaves HTTP open', async () => {
    let disconnected!: () => void;
    const closed = new Promise<void>(resolve => { disconnected = resolve; });
    server = createServer((req, res) => {
        req.resume(); req.on('end', () => {
            res.writeHead(200, { 'Content-Type': 'text/event-stream', Connection: 'keep-alive' });
            res.write(frame('{"answer":true}', 'stop') + 'data: [DONE]\n\n');
            res.on('close', disconnected);
            // Deliberately no res.end(): the SSE terminal frame completes the reply.
        });
    });
    const result = await callOpenAiCompatibleLocalCompletion({ transport: { baseUrl: await url(), timeoutMs: 1000 },
        modelId: 'fixture', userPrompt: 'fixture', stream: true });
    expect(result.success).toBe(true); expect(result.content).toBe('{"answer":true}'); await closed;
});

it('stops at a complete schema-valid object before trailing generation', async () => {
    let disconnected!: () => void;
    const closed = new Promise<void>(resolve => { disconnected = resolve; });
    server = createServer((req, res) => {
        req.resume(); req.on('end', () => {
            res.writeHead(200, { 'Content-Type': 'text/event-stream' });
            res.write(frame('{"answer":"café 海"}'));
            res.on('close', disconnected);
            // More commentary and DONE would follow later; neither is part of the contracted JSON task.
        });
    });
    const result = await callOpenAiCompatibleLocalCompletion({ transport: { baseUrl: await url(), timeoutMs: 1000 },
        modelId: 'fixture', userPrompt: 'fixture', stream: true,
        expectedJsonSchema: { type: 'object', required: ['answer'], additionalProperties: false, properties: { answer: { type: 'string' } } } });
    expect(result.success).toBe(true); expect(result.content).toBe('{"answer":"café 海"}');
    expect(result.responseData).toMatchObject({ clientCompletedJson: true }); await closed;
});

it('does not accept a complete object that fails the requested schema', async () => {
    server = createServer((req, res) => {
        req.resume(); req.on('end', () => {
            res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.end(frame('{"wrong":true}'));
        });
    });
    const result = await callOpenAiCompatibleLocalCompletion({ transport: { baseUrl: await url(), timeoutMs: 1000 },
        modelId: 'fixture', userPrompt: 'fixture', stream: true,
        expectedJsonSchema: { type: 'object', required: ['answer'], properties: { answer: { type: 'boolean' } } } });
    expect(result.success).toBe(false); expect(result.error).toContain('before completion');
});
