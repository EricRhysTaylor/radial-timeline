import { describe, expect, it } from 'vitest';
import { validateJsonResponse } from './jsonValidator';

const gossamerSchema = {
    type: 'object',
    required: ['beats', 'overallAssessment'],
    properties: {
        beats: { type: 'array' },
        overallAssessment: { type: 'object' }
    }
};

function gossamerLike() {
    return {
        beats: [{ beatName: 'Opening Image', signal: 'activity', score: 65, justification: 'x' }],
        overallAssessment: { summary: 'x', strengths: [], improvements: [] }
    };
}

describe('validateJsonResponse structured envelope normalization', () => {
    it('unwraps a single-key input envelope before required-key validation', () => {
        const result = validateJsonResponse(
            JSON.stringify({ input: gossamerLike() }),
            gossamerSchema,
            'anthropic'
        );

        expect(result.ok).toBe(true);
        expect(result.parsed).toEqual(gossamerLike());
        expect(result.normalizedRaw).toBe(JSON.stringify(gossamerLike()));
        expect(result.normalizationWarnings).toEqual([
            'Unwrapped structured response envelope key "input" before JSON schema validation'
        ]);
    });

    it('does not unwrap when the inner object is missing a required canonical key', () => {
        const result = validateJsonResponse(
            JSON.stringify({ input: { beats: [] } }),
            gossamerSchema,
            'anthropic'
        );

        expect(result.ok).toBe(false);
        expect(result.normalizedRaw).toBeUndefined();
        expect(result.error?.message).toContain('JSON missing required keys');
    });

    it('does not unwrap multi-key envelopes', () => {
        const result = validateJsonResponse(
            JSON.stringify({ input: gossamerLike(), extra: true }),
            gossamerSchema,
            'anthropic'
        );

        expect(result.ok).toBe(false);
        expect(result.normalizedRaw).toBeUndefined();
        expect(result.error?.message).toContain('JSON missing required keys');
    });

    it('leaves canonical root objects unchanged', () => {
        const result = validateJsonResponse(
            JSON.stringify(gossamerLike()),
            gossamerSchema,
            'openai'
        );

        expect(result.ok).toBe(true);
        expect(result.parsed).toEqual(gossamerLike());
        expect(result.normalizedRaw).toBeUndefined();
        expect(result.normalizationWarnings).toBeUndefined();
    });
});
