import { beforeEach, describe, expect, it } from 'vitest';
import { cacheResolvedModel, clearResolvedModelCache, getModelDisplayName, getResolvedModelId } from './modelResolver';

beforeEach(() => {
    clearResolvedModelCache();
});

describe('getModelDisplayName snapshot formatting', () => {
    // The resolver's snapshot formatter handles dated-variant IDs that
    // match the gpt-N.N(-pro)?-YYYY-MM-DD pattern. These IDs don't need
    // to exist in BUILTIN_MODELS — the formatter is regex-based.
    it('shows canonical snapshot label in normal contexts', () => {
        expect(getModelDisplayName('gpt-5.4-2026-03-05')).toBe('GPT-5.4 (snapshot)');
        expect(getModelDisplayName('gpt-5.4-pro-2026-03-05')).toBe('GPT-5.4 Pro (snapshot)');
    });

    it('includes raw snapshot id in debug contexts', () => {
        expect(getModelDisplayName('gpt-5.4-2026-03-05', { debug: true }))
            .toBe('GPT-5.4 (snapshot gpt-5.4-2026-03-05)');
        expect(getModelDisplayName('gpt-5.4-pro-2026-03-05', { debug: true }))
            .toBe('GPT-5.4 Pro (snapshot gpt-5.4-pro-2026-03-05)');
    });

    it('caches concrete resolutions for latest aliases and normalizes provider prefixes', () => {
        cacheResolvedModel('gemini-pro-latest', 'models/gemini-3.1-pro-preview');

        expect(getResolvedModelId('gemini-pro-latest')).toBe('gemini-3.1-pro-preview');
        expect(getResolvedModelId('models/gemini-pro-latest')).toBe('gemini-3.1-pro-preview');
        expect(getModelDisplayName('gemini-pro-latest')).toBe('Gemini 3.1 Pro Preview (via latest)');
    });
});
