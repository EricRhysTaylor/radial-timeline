/**
 * Output token limits for AI providers.
 * 
 * Gemini: Fetched from API (outputTokenLimit field)
 * Anthropic/OpenAI: Manual - check docs periodically
 * 
 * These are MAX limits. For scene analysis, we use a portion to leave
 * room for thinking/reasoning tokens in thinking models.
 */

// Known max output token limits per provider (as of Mar 2026)
// These should be updated when providers increase limits
export const PROVIDER_MAX_OUTPUT_TOKENS = {
    // Google Gemini 3 Pro: 65,536 (from API)
    // We use most of it since thinking tokens are separate in newer models
    google: 32000,
    
    // Claude 4.x: 8,192 base, up to 64K with extended thinking
    // Extended thinking models use separate "thinking" budget
    anthropic: 16000,
    
    // GPT-5.4 / GPT-5.4 Pro: API supports up to 128,000 output tokens, but
    // realistic Inquiry responses land at 2–16k. Cap at 32k for headroom on
    // large multi-book sagas without inflating cost previews ~8× against the
    // hard ceiling. Raise here if we observe truncated responses in the wild.
    openai: 32000,
    
    // Local LLMs vary widely, use conservative default
    ollama: 4000,
} as const;

