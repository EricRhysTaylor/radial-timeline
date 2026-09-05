import { describe, expect, it } from 'vitest';
import { isResponsesTransportModelId, resolveOpenAiTransportLane } from './openaiTransport';

describe('openai transport lane resolver', () => {
    // The OPENAI_RESPONSES_MODEL_IDS set is currently empty — the
    // gpt-5.4-pro family was removed in the 2026-05-22 catalog trim.
    // GPT-5.5 routes to Responses via its registry profile's
    // preferredOpenAiEndpoint, not this set. These tests pin the
    // current contract so a future re-population doesn't accidentally
    // ship gpt-5.5 (or any model already routed via profile) through
    // this code path too.
    it('returns false / chat_completions when no model is in the dedicated Responses set', () => {
        expect(isResponsesTransportModelId('gpt-5.5')).toBe(false);
        expect(isResponsesTransportModelId('claude-opus-4-7')).toBe(false);
        expect(resolveOpenAiTransportLane('gpt-5.5')).toBe('chat_completions');
    });

    it('returns false for empty / unknown model IDs', () => {
        expect(isResponsesTransportModelId('')).toBe(false);
        expect(isResponsesTransportModelId('made-up-model')).toBe(false);
        expect(resolveOpenAiTransportLane('')).toBe('chat_completions');
    });
});
