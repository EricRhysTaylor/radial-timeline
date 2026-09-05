import { afterEach, describe, expect, it, vi } from 'vitest';

const fetchAnthropicModels = vi.fn();
const fetchOpenAiModels = vi.fn();
const fetchGeminiModels = vi.fn();
vi.mock('../../api/anthropicApi', () => ({ fetchAnthropicModels: (...args: unknown[]) => fetchAnthropicModels(...args) }));
vi.mock('../../api/openaiApi', () => ({ fetchOpenAiModels: (...args: unknown[]) => fetchOpenAiModels(...args) }));
vi.mock('../../api/geminiApi', () => ({ fetchGeminiModels: (...args: unknown[]) => fetchGeminiModels(...args) }));

import { buildProviderValidationDetail, extractStatusCodeFromError, isAuthError, validateProviderKeyQuick } from './keyValidation';

describe('key validation helpers', () => {
    it('reads a status code from wrapped and prefixed forms', () => {
        expect(extractStatusCodeFromError('Request failed (401)')).toBe(401);
        expect(extractStatusCodeFromError('HTTP 429 from provider')).toBe(429);
        expect(extractStatusCodeFromError('status 503')).toBe(503);
        expect(extractStatusCodeFromError('network down')).toBeNull();
    });

    it('treats 400/401/403 and auth wording as a rejected key', () => {
        expect(isAuthError('', 401)).toBe(true);
        expect(isAuthError('invalid api key', null)).toBe(true);
        expect(isAuthError('ECONNRESET', null)).toBe(false);
    });

    it('explains non-auth failures by status', () => {
        expect(buildProviderValidationDetail('x', 429)).toContain('rate limit');
        expect(buildProviderValidationDetail('x', 502)).toContain('HTTP 502');
        expect(buildProviderValidationDetail('x', 418)).toContain('HTTP 418');
        expect(buildProviderValidationDetail('boom', null)).toContain('boom');
    });
});

describe('validateProviderKeyQuick', () => {
    afterEach(() => vi.clearAllMocks());

    it('routes each provider to its model listing and reports ready', async () => {
        fetchAnthropicModels.mockResolvedValue([]);
        fetchGeminiModels.mockResolvedValue([]);
        fetchOpenAiModels.mockResolvedValue([]);
        expect((await validateProviderKeyQuick('anthropic', 'k')).state).toBe('ready');
        expect((await validateProviderKeyQuick('google', 'k')).state).toBe('ready');
        expect((await validateProviderKeyQuick('openai', 'k')).state).toBe('ready');
        expect(fetchAnthropicModels).toHaveBeenCalledWith('k');
        expect(fetchGeminiModels).toHaveBeenCalledWith('k');
        expect(fetchOpenAiModels).toHaveBeenCalledWith('k');
    });

    it('separates a rejected key from a blocked network', async () => {
        fetchOpenAiModels.mockRejectedValueOnce(new Error('Unauthorized (401)'));
        expect(await validateProviderKeyQuick('openai', 'k')).toEqual({ state: 'rejected', detail: '' });
        fetchOpenAiModels.mockRejectedValueOnce(new Error('HTTP 503 upstream'));
        const blocked = await validateProviderKeyQuick('openai', 'k');
        expect(blocked.state).toBe('network_blocked');
        expect(blocked.detail).toContain('HTTP 503');
    });
});
