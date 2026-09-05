import { describe, expect, it } from 'vitest';
import { classifyProviderError } from './providerErrors';

describe('provider error classification', () => {
    it('classifies OpenAI quota exhaustion separately from generic rate limits', () => {
        const result = classifyProviderError({
            status: 429,
            responseData: {
                error: {
                    message: 'You exceeded your current quota, please check your plan and billing details.',
                    type: 'insufficient_quota',
                    code: 'insufficient_quota'
                }
            }
        });

        expect(result).toEqual({
            aiStatus: 'rejected',
            aiReason: 'quota_exceeded'
        });
    });
});
