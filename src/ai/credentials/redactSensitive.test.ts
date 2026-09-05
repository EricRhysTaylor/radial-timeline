import { describe, expect, it } from 'vitest';
import { redactSensitiveObject, redactSensitiveValue } from './redactSensitive';

describe('redactSensitive helpers', () => {
    it('redacts common credential signatures in strings', () => {
        const value = 'Authorization: Bearer sk-test-abc123?key=AIzaSyD-EXAMPLE1234567890abcd';
        const redacted = redactSensitiveValue(value);
        expect(redacted.includes('Bearer [REDACTED]')).toBe(true);
        expect(redacted.includes('key=')).toBe(false);
        expect(redacted.includes('sk-test')).toBe(false);
        expect(redacted.includes('AIza')).toBe(false);
    });

    it('redacts sensitive object fields but keeps saved key names', () => {
        const payload = {
            authorization: 'Bearer sk-test-openai-123456',
            apiKey: 'sk-ant-test-123456',
            openaiSecretId: 'openai-main',
            nested: {
                token: 'abc123',
                url: 'https://example.com?key=AIzaSyD-EXAMPLE1234567890abcd'
            }
        };

        const redacted = redactSensitiveObject(payload);
        expect(redacted.authorization).toBe('[REDACTED]');
        expect(redacted.apiKey).toBe('[REDACTED]');
        expect(redacted.openaiSecretId).toBe('openai-main');
        expect(redacted.nested.token).toBe('[REDACTED]');
        expect(redacted.nested.url.includes('key=[REDACTED]')).toBe(true);
    });
});
