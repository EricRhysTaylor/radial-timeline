import { EventEmitter } from 'node:events';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import type { AIRequestControl } from '../ai/types';

const { requestMock } = vi.hoisted(() => ({ requestMock: vi.fn() }));
vi.mock('https', () => ({ request: requestMock }));
import { requestProvider, decodeAnthropicStream } from './providerTransport';

const options = { url: 'https://api.anthropic.com/v1/messages', method: 'POST', body: 'synthetic fixture' };
const control = (patch: Partial<AIRequestControl> = {}): AIRequestControl => ({
    assertActive: () => undefined, timeoutMs: 10000, retryPolicy: { maxAttempts: 2, baseDelayMs: 0 }, ...patch
});

function mockRequest(status?: number, body: unknown = {}, headers: Record<string, string> = {}) {
    const req = Object.assign(new EventEmitter(), {
        write: vi.fn(),
        destroy: vi.fn((error: Error) => queueMicrotask(() => req.emit('error', error))),
        end: vi.fn(() => {
            if (status === undefined) return;
            queueMicrotask(() => {
                const callback = requestMock.mock.calls.at(-1)?.[2] as (response: unknown) => void;
                const res = Object.assign(new EventEmitter(), { statusCode: status, headers });
                callback(res);
                res.emit('data', Buffer.from(JSON.stringify(body)));
                res.emit('end');
            });
        })
    });
    requestMock.mockReturnValueOnce(req);
    return req;
}

beforeEach(() => { requestMock.mockReset(); });
afterEach(() => vi.useRealTimers());

describe('cloud transport lifecycle', () => {
    it('retains HTTP status and request diagnostics', async () => {
        mockRequest(401, { error: { message: 'Invalid authentication' } }, { 'request-id': 'fixture-request' });
        const result = await requestProvider(options, control());
        expect(result).toMatchObject({ status: 401, retryCount: 0, headers: { 'request-id': 'fixture-request' } });
        expect(requestMock).toHaveBeenCalledTimes(1);
    });

    it('refuses withdrawn permission before connecting or uploading', async () => {
        await expect(requestProvider(options, control({ assertActive: () => { throw new Error('AI request cancelled'); } }))).rejects.toThrow('AI request cancelled');
        expect(requestMock).not.toHaveBeenCalled();
    });

    it('destroys an active request when permission is withdrawn', async () => {
        vi.useFakeTimers();
        let allowed = true;
        const req = mockRequest();
        const result = requestProvider(options, control({ assertActive: () => { if (!allowed) throw new Error('AI request cancelled'); } }));
        const rejected = expect(result).rejects.toThrow('AI request cancelled');
        allowed = false;
        await vi.advanceTimersByTimeAsync(100);
        await rejected;
        expect(req.destroy).toHaveBeenCalledOnce();
        expect(requestMock).toHaveBeenCalledOnce();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('closes a timed-out connection without resubmitting its manuscript', async () => {
        vi.useFakeTimers();
        const req = mockRequest();
        const rejected = expect(requestProvider(options, control({ timeoutMs: 50 }))).rejects.toThrow('timed out');
        await vi.advanceTimersByTimeAsync(50);
        await rejected;
        expect(req.destroy).toHaveBeenCalledOnce();
        expect(requestMock).toHaveBeenCalledOnce();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('honors Retry-After on explicit transient rejections', async () => {
        vi.useFakeTimers();
        mockRequest(429, { error: { message: 'Rate limit' } }, { 'retry-after': '2' });
        mockRequest(200, { answer: 'ok' });
        const result = requestProvider(options, control());
        await vi.advanceTimersByTimeAsync(1999);
        expect(requestMock).toHaveBeenCalledOnce();
        await vi.advanceTimersByTimeAsync(1);
        expect(await result).toMatchObject({ status: 200, retryCount: 1, json: { answer: 'ok' } });
        expect(requestMock).toHaveBeenCalledTimes(2);
    });

    it('does not retry a spend cap or exhausted account quota', async () => {
        mockRequest(429, { error: { message: 'You have reached your specified API usage limits' } });
        const result = await requestProvider(options, control());
        expect(result.status).toBe(429);
        expect(requestMock).toHaveBeenCalledOnce();
    });

    it('does not follow redirects carrying credentials and manuscript data', async () => {
        mockRequest(302, {}, { location: 'https://unintended.example' });
        await expect(requestProvider(options, control())).rejects.toThrow('redirect refused');
        expect(requestMock).toHaveBeenCalledOnce();
    });
});

const frame = (data: unknown) => `data: ${JSON.stringify(data)}\n\n`;
describe('Anthropic streamed response integrity', () => {
    it('assembles text, citations, stop reason, and input/output usage', () => {
        const stream = [
            { type: 'message_start', message: { id: 'm', usage: { input_tokens: 20 } } },
            { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
            { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Answer' } },
            { type: 'content_block_delta', index: 0, delta: { type: 'citations_delta', citation: { type: 'char_location', cited_text: 'Fixture' } } },
            { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 8 } },
            { type: 'message_stop' }
        ].map(frame).join('');
        expect(decodeAnthropicStream(stream)).toMatchObject({
            stop_reason: 'end_turn', usage: { input_tokens: 20, output_tokens: 8 },
            content: [{ type: 'text', text: 'Answer', citations: [{ cited_text: 'Fixture' }] }]
        });
    });

    it('assembles structured tool arguments', () => {
        const stream = [
            { type: 'message_start', message: { id: 'm' } },
            { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', input: {} } },
            { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"answer":' } },
            { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '"ok"}' } },
            { type: 'message_stop' }
        ].map(frame).join('');
        expect(decodeAnthropicStream(stream)).toMatchObject({ content: [{ input: { answer: 'ok' } }] });
    });

    it('rejects a partial stream or server error even after receiving text', () => {
        const partial = frame({ type: 'message_start', message: { id: 'm' } });
        expect(() => decodeAnthropicStream(partial)).toThrow('before message_stop');
        expect(() => decodeAnthropicStream(partial + frame({ type: 'error', error: { message: 'overloaded' } }))).toThrow('overloaded');
    });
});
