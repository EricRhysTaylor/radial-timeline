import { beforeEach, describe, expect, it, vi } from 'vitest';
import type RadialTimelinePlugin from '../../main';
import type { AIRequestControl, GenerateJsonRequest } from '../types';
import { buildDefaultAiSettings } from '../settings/aiSettings';
import { LocalLlmClient } from './client';

const { credential, send } = vi.hoisted(() => ({ credential: vi.fn(), send: vi.fn() }));
vi.mock('../credentials/credentials', () => ({ getCredential: credential }));
vi.mock('../../api/providerTransport', () => ({ requestProvider: send }));
const response = () => ({ status: 200, headers: {}, text: '', retryCount: 0,
    json: { choices: [{ message: { content: '{"answer":"ok"}' } }] }
});

function fixture() {
    let allowed = true;
    const control: AIRequestControl = {
        assertActive: () => { if (!allowed) throw new Error('AI request cancelled'); },
        timeoutMs: 5000, retryPolicy: { maxAttempts: 1, baseDelayMs: 0 }
    };
    const plugin = { settings: { aiSettings: buildDefaultAiSettings() } } as unknown as RadialTimelinePlugin; // SAFE: real client reads canonical AI settings; network and credentials are fixture doubles
    const request: GenerateJsonRequest = {
        modelId: 'fixture-model', userPrompt: 'Synthetic cancellation fixture', requestControl: control,
        jsonSchema: { type: 'object', properties: { answer: { type: 'string' } }, required: ['answer'] }
    };
    return { client: new LocalLlmClient(plugin), request, cancel: () => { allowed = false; } };
}
beforeEach(() => {
    credential.mockReset().mockResolvedValue('');
    send.mockReset().mockResolvedValue(response());
});

describe('Local LLM follows the run cancellation boundary', () => {
    it.each(['text', 'json'] as const)('does not send %s after cancellation during credential resolution', async mode => {
        const { client, request, cancel } = fixture();
        credential.mockImplementationOnce(async () => { cancel(); return ''; });
        const pending = mode === 'text' ? client.generateText(request) : client.generateJson(request);
        await expect(pending).rejects.toThrow('AI request cancelled');
        expect(send).not.toHaveBeenCalled();
    });
    it.each(['text', 'json'] as const)('does not accept %s returned after cancellation', async mode => {
        const { client, request, cancel } = fixture();
        send.mockImplementationOnce(async () => { cancel(); return response(); });
        const pending = mode === 'text' ? client.generateText(request) : client.generateJson(request);
        await expect(pending).rejects.toThrow('AI request cancelled');
        expect(send).toHaveBeenCalledOnce();
    });
});
