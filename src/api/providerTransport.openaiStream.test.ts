import { describe, expect, it } from 'vitest';
import { decodeOpenAiStream } from './providerTransport';
const frame = (content: string, finish_reason: string | null = null) => `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content }, finish_reason }] })}\n\n`;
describe('local OpenAI-compatible streams', () => {
    it('reassembles content, skips keepalive comments and keeps actual usage', () => {
        const raw = ': keepalive\n\n' + frame('{"text":"café ') + frame('海"}', 'stop')
            + 'data: {"choices":[],"usage":{"completion_tokens":10}}\n\ndata: [DONE]\n\n';
        expect(decodeOpenAiStream(raw)).toEqual({ choices: [{ message: { content: '{"text":"café 海"}' }, finish_reason: 'stop' }], usage: { completion_tokens: 10 } });
    });
    it('refuses a partial response even if the collected text looks like JSON', () => {
        expect(() => decodeOpenAiStream(frame('{}', 'stop'))).toThrow('before completion');
    });
    it('refuses a DONE frame without a finish reason', () => {
        expect(() => decodeOpenAiStream(frame('{}') + 'data: [DONE]\n\n')).toThrow('before completion');
    });
    it('reports provider errors and filter termination explicitly', () => {
        expect(() => decodeOpenAiStream('data: {"error":{"message":"unavailable"}}\n\n')).toThrow('unavailable');
        expect(() => decodeOpenAiStream(frame('{}', 'content_filter') + 'data: [DONE]\n\n')).toThrow('content_filter');
    });
    it('preserves a token-limited response for the downstream structured validator', () => {
        expect(decodeOpenAiStream(frame('{} trailing explanation', 'length') + 'data: [DONE]\n\n')).toMatchObject({
            choices: [{ message: { content: '{} trailing explanation' }, finish_reason: 'length' }]
        });
    });
});
