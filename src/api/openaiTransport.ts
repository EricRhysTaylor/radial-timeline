export type OpenAiTransportLane = 'chat_completions' | 'responses';

// Models that REQUIRE the OpenAI Responses API endpoint (vs. Chat
// Completions). Currently empty — the gpt-5.4-pro family was removed
// in the 2026-05-22 catalog trim, and gpt-5.5 routes to Responses via
// its registry profile's preferredOpenAiEndpoint, not this set.
const OPENAI_RESPONSES_MODEL_IDS = new Set<string>([]);

export function isResponsesTransportModelId(modelId: string): boolean {
    return OPENAI_RESPONSES_MODEL_IDS.has((modelId || '').trim());
}

export function resolveOpenAiTransportLane(modelId: string): OpenAiTransportLane {
    return isResponsesTransportModelId(modelId) ? 'responses' : 'chat_completions';
}
