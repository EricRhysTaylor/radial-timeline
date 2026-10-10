import { describe, expect, it } from 'vitest';
import { describeTokenEstimateMethod, estimateInputTokens } from './inputTokenEstimate';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('local input estimates', () => {
    it('measures the complete local envelope without credentials', () => {
        expect(estimateInputTokens({
            systemPrompt: '1234', userPrompt: '12345678',
            evidenceDocuments: [{ title: '1234', content: '12345678' }], safeInputBudget: 100000
        })).toEqual({ inputTokens: 7, method: 'heuristic_chars', uncertaintyTokens: 4000 });
    });

    it('needs no plugin, provider, model, or API key', () => {
        expect(estimateInputTokens({ userPrompt: 'Manuscript text' }).method).toBe('heuristic_chars');
    });

    it('reserves capacity for Unicode scripts instead of counting four CJK characters as one token', () => {
        expect(estimateInputTokens({ userPrompt: '你好' }).inputTokens).toBe(6);
    });

    it('includes provider schema overhead in the local request estimate', () => {
        const base = estimateInputTokens({ userPrompt: 'Fixture text' });
        const withSchema = estimateInputTokens({ userPrompt: 'Fixture text', jsonSchema: { type: 'object', properties: { answer: { type: 'string' } } } });
        expect(withSchema.inputTokens).toBeGreaterThan(base.inputTokens);
    });

    it('has no runtime provider, credential, or transport dependency', () => {
        const source = readFileSync(resolve('src/ai/tokens/inputTokenEstimate.ts'), 'utf8');
        expect(source).not.toMatch(/from ['"].*(?:api\/|credentials\/|transport|main)['"]/);
    });

    it('labels new estimates as local and preserves historical count labels', () => {
        expect(describeTokenEstimateMethod('heuristic_chars')).toBe('Local estimate (no provider request)');
        expect(describeTokenEstimateMethod('anthropic_count')).toBe('Anthropic provider count');
        expect(describeTokenEstimateMethod('google_count')).toBe('Gemini provider count');
    });
});
