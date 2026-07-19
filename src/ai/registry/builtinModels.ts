import type { Capability, ModelInfo } from '../types';

const DEEP_CAPS: Capability[] = ['longContext', 'jsonStrict', 'reasoningStrong', 'highOutputCap'];
const FAST_CAPS: Capability[] = ['jsonStrict', 'streaming'];
const LOCAL_CAPS: Capability[] = ['jsonStrict'];

/*
 * Minimum-viable model catalog (2026-05-22).
 *
 * Policy: one top model per provider, plus a Google fast/deep split where
 * the speed/depth tradeoff is genuinely a quality dimension (not cost).
 * Picker UX infrastructure stays intact so models can be re-added later
 * via the deliberate quarterly promotion process in
 * docs/engineering/standards/model-promotion.md.
 *
 * Adding a model is a replacement, not an accretion. Run
 * `npm run gates` after any change to keep the catalog contract test
 * and the model coverage gate happy.
 */
export const BUILTIN_MODELS: ModelInfo[] = [
    {
        provider: 'anthropic',
        id: 'claude-opus-4-8',
        alias: 'claude-opus-4.8',
        label: 'Claude Opus 4.8',
        line: 'claude-opus',
        tier: 'DEEP',
        capabilities: [...DEEP_CAPS],
        personality: { reasoning: 10, writing: 10, determinism: 9 },
        contextWindow: 1000000,
        maxOutput: 128000,
        releasedAt: '2026-05-28',
        status: 'stable',
        rollout: {
            channel: 'stable',
            status: 'stable',
            lane: 'default'
        },
        // Opus 4.7+ (incl. 4.8) reject request-level temperature/top_p
        // (provider-managed sampling) and use adaptive thinking only — the
        // legacy thinking:{type:'enabled'} shape returns 400. Verified via
        // smoke probe against Opus 4.7 (2026-05-23); 4.8 keeps the contract
        // per the migration guide (no breaking changes from 4.7).
        constraints: {
            supportsTemperature: false,
            supportsTopP: false,
            supportsAdaptiveThinking: true
        }
    },
    {
        // Continuity model: the immediately-prior Opus, kept one generation
        // back so authors mid-project aren't force-migrated off 4.7 when 4.8
        // ships. Auto-selection (latest-stable) still resolves to 4.8 — 4.7
        // is an explicit opt-in in the picker. Same request contract and
        // pricing as 4.8. Retire when a newer Opus promotes 4.8 to N-1.
        provider: 'anthropic',
        id: 'claude-opus-4-7',
        alias: 'claude-opus-4.7',
        label: 'Claude Opus 4.7',
        line: 'claude-opus',
        tier: 'DEEP',
        capabilities: [...DEEP_CAPS],
        personality: { reasoning: 10, writing: 10, determinism: 9 },
        contextWindow: 1000000,
        maxOutput: 128000,
        releasedAt: '2026-04-16',
        status: 'stable',
        rollout: {
            channel: 'stable',
            status: 'stable',
            lane: 'default'
        },
        constraints: {
            supportsTemperature: false,
            supportsTopP: false,
            supportsAdaptiveThinking: true
        }
    },
    {
        // Premium always-on-thinking model on its own line ('claude-fable'),
        // deliberately kept OFF the 'stable' rollout channel: latest-stable
        // auto-selection (Pulse/Gossamer/Inquiry) reads channel === 'stable'
        // only, so it continues to resolve to Opus 4.8. Fable is a 'pro'-channel
        // entry — visible and pinnable in the picker, but never the silent
        // default. This matters because Fable costs 2× Opus ($10/$50 vs $5/$25
        // per MTok); it must be an explicit author choice.
        //
        // Request-shape facts (verified against Anthropic docs, mid-2026):
        //   - Thinking is ALWAYS ON and non-configurable — omit `thinking`
        //     entirely (any thinking:{...} shape → 400). Depth is set via
        //     output_config.effort (thinkingAlwaysOn constraint drives this).
        //   - Forced tool_choice is incompatible with active thinking, so
        //     structured output uses output_config.format (json_schema), not
        //     the forced-tool path used by Opus.
        //   - temperature/top_p rejected (same as Opus 4.7+).
        //   - Prompt-cache minimum prefix is 2048 tokens (Opus: 4096); cache
        //     TTLs 5m/1h unchanged, so existing cache_control plumbing carries.
        provider: 'anthropic',
        id: 'claude-fable-5',
        alias: 'claude-fable-5',
        label: 'Claude Fable 5',
        line: 'claude-fable',
        tier: 'DEEP',
        capabilities: [...DEEP_CAPS],
        personality: { reasoning: 10, writing: 10, determinism: 9 },
        contextWindow: 1_000_000,
        maxOutput: 128_000,
        releasedAt: '2026-07-15',
        status: 'stable',
        rollout: {
            channel: 'pro',
            status: 'stable',
            lane: 'pro'
        },
        constraints: {
            supportsTemperature: false,
            supportsTopP: false,
            supportsAdaptiveThinking: true,
            thinkingAlwaysOn: true
        }
    },
    {
        provider: 'openai',
        id: 'gpt-5.5',
        alias: 'gpt-5.5',
        label: 'GPT-5.5',
        line: 'gpt-5',
        tier: 'BALANCED',
        capabilities: [...DEEP_CAPS, 'toolCalling', 'functionCalling'],
        personality: { reasoning: 10, writing: 9, determinism: 9 },
        contextWindow: 1050000,
        maxOutput: 128000,
        releasedAt: '2026-04-23',
        status: 'stable',
        rollout: {
            channel: 'stable',
            status: 'stable',
            lane: 'default'
        },
        constraints: {
            supportsTemperature: false,
            supportsTopP: false,
            supportsReasoningEffort: true,
            preferredOpenAiEndpoint: 'responses'
        }
    },
    {
        // Economy second on the gpt-5 line: a strong, cheaper alternative to
        // 5.5, same request contract (Responses API, reasoning effort,
        // provider-managed sampling). Auto-selection resolves to 5.5 (newer on
        // the line); 5.4 is an explicit opt-in in the picker.
        provider: 'openai',
        id: 'gpt-5.4',
        alias: 'gpt-5.4',
        label: 'GPT-5.4',
        line: 'gpt-5',
        tier: 'BALANCED',
        capabilities: [...DEEP_CAPS, 'toolCalling', 'functionCalling'],
        personality: { reasoning: 9, writing: 9, determinism: 9 },
        contextWindow: 1050000,
        maxOutput: 128000,
        releasedAt: '2026-03-05',
        status: 'stable',
        rollout: {
            channel: 'stable',
            status: 'stable',
            lane: 'default'
        },
        constraints: {
            supportsTemperature: false,
            supportsTopP: false,
            supportsReasoningEffort: true,
            preferredOpenAiEndpoint: 'responses'
        }
    },
    {
        provider: 'google',
        id: 'gemini-3.1-pro-preview',
        alias: 'gemini-3.1-pro-preview',
        label: 'Gemini 3.1 Pro Preview',
        line: 'gemini-pro',
        tier: 'DEEP',
        capabilities: ['longContext', 'jsonStrict', 'reasoningStrong', 'highOutputCap', 'streaming'],
        personality: { reasoning: 9, writing: 8, determinism: 8 },
        contextWindow: 1048576,
        maxOutput: 65536,
        status: 'preview',
        constraints: { cacheVsCitationsExclusive: true }
    },
    {
        provider: 'google',
        id: 'gemini-3.5-flash',
        alias: 'gemini-3.5-flash',
        label: 'Gemini 3.5 Flash',
        line: 'gemini-flash',
        tier: 'FAST',
        capabilities: ['longContext', 'jsonStrict', 'reasoningStrong', 'highOutputCap', 'streaming'],
        personality: { reasoning: 8, writing: 8, determinism: 8 },
        contextWindow: 1048576,
        maxOutput: 65536,
        releasedAt: '2026-05-01',
        status: 'stable',
        constraints: { cacheVsCitationsExclusive: true }
    },
    {
        provider: 'ollama',
        id: 'llama3',
        alias: 'ollama-llama3',
        label: 'Ollama Llama 3',
        line: 'ollama-llama',
        tier: 'LOCAL',
        capabilities: [...LOCAL_CAPS],
        personality: { reasoning: 6, writing: 6, determinism: 5 },
        contextWindow: 32000,
        maxOutput: 4000,
        status: 'stable'
    },
    {
        provider: 'ollama',
        id: 'local-model',
        alias: 'ollama-local-model',
        label: 'Local Model',
        line: 'ollama-local',
        tier: 'LOCAL',
        capabilities: [...LOCAL_CAPS],
        personality: { reasoning: 5, writing: 5, determinism: 4 },
        contextWindow: 32000,
        maxOutput: 4000,
        status: 'stable'
    },
    {
        provider: 'none',
        id: 'none',
        alias: 'none',
        label: 'None',
        tier: 'FAST',
        capabilities: [...FAST_CAPS],
        personality: { reasoning: 0, writing: 0, determinism: 10 },
        contextWindow: 0,
        maxOutput: 0,
        status: 'legacy'
    }
];

export function findBuiltinByAlias(alias: string): ModelInfo | undefined {
    return BUILTIN_MODELS.find(model => model.alias === alias);
}

export function findBuiltinByProviderModel(provider: ModelInfo['provider'], modelId: string): ModelInfo | undefined {
    return BUILTIN_MODELS.find(model => model.provider === provider && model.id === modelId);
}
