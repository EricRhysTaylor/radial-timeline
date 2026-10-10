import { beforeEach, describe, expect, it, vi } from 'vitest';
import { callOpenAiCompatibleLocalCompletion, LOCAL_LLM_CANCELLED } from './transport';
import { requestProvider } from '../../api/providerTransport';

vi.mock('../../api/providerTransport', () => ({ requestProvider: vi.fn() }));

const base = {
    transport: { baseUrl: 'http://localhost:1234/v1', timeoutMs: 5000 },
    modelId: 'fixture-model', userPrompt: 'Synthetic fixture only'
};
beforeEach(() => {
    vi.mocked(requestProvider).mockReset().mockResolvedValue({
        status: 200, headers: {}, text: '', retryCount: 0,
        json: { choices: [{ message: { content: 'fixture socket response' } }] }
    });
});

describe('local completion cancellation boundary', () => {
    it('does not connect when the caller signal is already aborted', async () => {
        const controller = new AbortController(); controller.abort();
        const result = await callOpenAiCompatibleLocalCompletion({
            ...base, transport: { ...base.transport, signal: controller.signal }
        });
        expect(result.error).toBe(LOCAL_LLM_CANCELLED);
        expect(requestProvider).not.toHaveBeenCalled();
    });

    it('preserves the caller signal on the socket request', async () => {
        const controller = new AbortController();
        const result = await callOpenAiCompatibleLocalCompletion({
            ...base, transport: { ...base.transport, signal: controller.signal }
        });
        expect(result.success).toBe(true);
        expect(vi.mocked(requestProvider).mock.calls[0]?.[2]?.signal).toBe(controller.signal);
    });

    it('does not connect after permission is withdrawn', async () => {
        const result = await callOpenAiCompatibleLocalCompletion({
            ...base, transport: { ...base.transport, requestControl: {
                assertActive: () => { throw new Error('AI request cancelled'); },
                timeoutMs: 5000, retryPolicy: { maxAttempts: 2, baseDelayMs: 0 }
            } }
        });
        expect(result.error).toBe('AI request cancelled');
        expect(requestProvider).not.toHaveBeenCalled();
    });

    it.each(['Fixture completion timed out', 'Fixture response connection lost'])('never resubmits after %s', async message => {
        vi.mocked(requestProvider).mockRejectedValueOnce(new Error(message));
        const result = await callOpenAiCompatibleLocalCompletion(base);
        expect(result.success).toBe(false);
        expect(result.error).toBe(message);
        expect(requestProvider).toHaveBeenCalledOnce();
    });
});
