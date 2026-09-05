import type { Capability, ModelInfo } from '../types';

const DEEP_CAPS: Capability[] = ['longContext', 'jsonStrict', 'reasoningStrong', 'highOutputCap'];
const FAST_CAPS: Capability[] = ['jsonStrict', 'streaming'];
const LOCAL_CAPS: Capability[] = ['jsonStrict'];

/*
 * Minimum-viable model catalog (2026-05-22).
 *
 * Policy: one top model per provider, plus a split where the speed/depth
 * tradeoff is genuinely a quality dimension (not cost).
 *
 * Amended 2026-08-21 — task fit is a quality dimension, and it varies BY
 * FEATURE. Onboarding makes bounded per-scene asks that a FAST-tier model
 * answers well; Inquiry reasons across a whole manuscript and needs DEEP.
 * A catalog holding only depth models therefore fails authors twice: it
 * prices a one-off whole-book job like a research task, and it offers no
 * correct answer for the cheap-and-bounded case. Anthropic accordingly
 * carries a BALANCED and a FAST entry alongside its depth models.
 *
 * This is NOT licence to add models for cheapness alone. A new entry must
 * answer a task-fit question the catalog cannot already answer, and it must
 * be paired with tier-driven suitability guidance in the UI — a model
 * offered without saying what it is unfit for is a trap, not a choice.
 *
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
        // Current Anthropic depth model. Same pricing and feature set as
        // Opus 4.8 ($5/$25 per MTok, 1M context, 128K output) with two
        // request-contract deltas, both encoded in constraints:
        //   - Thinking is ON BY DEFAULT when the `thinking` field is omitted
        //     (opposite of 4.8, where omission meant no thinking). RT's
        //     non-thinking paths therefore send an explicit
        //     thinking:{type:'disabled'} — see thinkingDefaultsOn and the
        //     adapter note in anthropicApi.ts. Disabled is accepted only at
        //     effort `high` or below (400 at xhigh/max); RT never emits
        //     effort above 'high'.
        //   - temperature/top_p remain rejected (same as 4.7/4.8); adaptive
        //     thinking is the only on-mode (thinking:{type:'enabled'} → 400).
        // Cache: 5m/1h TTLs and write/read multipliers unchanged from 4.8;
        // minimum cacheable prefix drops to 512 tokens (4.8: 1024), so
        // existing cache_control plumbing carries over and shorter prefixes
        // now cache. Opus 5 draws from its own rate-limit bucket, separate
        // from the combined Opus 4.x pool.
        // PENDING VERIFICATION: contract transcribed from Anthropic's
        // migration guide (2026-07); run
        //   npm run smoke-model -- --provider anthropic --model claude-opus-5
        // before first release with this catalog (needs ANTHROPIC_API_KEY).
        provider: 'anthropic',
        id: 'claude-opus-5',
        alias: 'claude-opus-5',
        label: 'Claude Opus 5',
        line: 'claude-opus',
        tier: 'DEEP',
        capabilities: [...DEEP_CAPS],
        personality: { reasoning: 10, writing: 10, determinism: 9 },
        contextWindow: 1000000,
        maxOutput: 128000,
        releasedAt: '2026-07-24',
        status: 'stable',
        rollout: {
            channel: 'stable',
            status: 'stable',
            lane: 'default'
        },
        constraints: {
            supportsTemperature: false,
            supportsTopP: false,
            supportsAdaptiveThinking: true,
            thinkingDefaultsOn: true
        }
    },
    {
        // Continuity model: the immediately-prior Opus, kept one generation
        // back so authors mid-project aren't force-migrated off 4.8 when
        // Opus 5 ships. Auto-selection (latest-stable) resolves to Opus 5 —
        // 4.8 is an explicit opt-in in the picker. Same pricing as Opus 5.
        // Retire when a newer Opus promotes Opus 5 to N-1.
        // Opus 4.7+ (incl. 4.8) reject request-level temperature/top_p
        // (provider-managed sampling) and use adaptive thinking only — the
        // legacy thinking:{type:'enabled'} shape returns 400. Verified via
        // smoke probe against Opus 4.7 (2026-05-23); 4.8 keeps the contract
        // per the migration guide (no breaking changes from 4.7).
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
        // All four facts verified via live smoke probe against claude-fable-5
        // on 2026-07-19 (basic effort request, output_config.format structured
        // output, 1h cache-prefix reuse, and the temperature/thinking.disabled
        // 400s). See anthropicApi.ts for the per-path probe notes.
        // Claude Fable 5.1 (2026-08-28) replaced Claude Fable 5 on this lane on
        // 2026-09-05: same tier, price, context, output cap, tokenizer, and
        // always-on thinking. Deltas that matter to RT: forced tool_choice
        // ('any' / 'tool') is now a hard 400 (the thinkingAlwaysOn path already
        // routes structured output through output_config.format, so nothing
        // changes here); cache reads fall to $0.25/MTok; thinking blocks are
        // bound to the producing model and conversation (RT never replays them).
        provider: 'anthropic',
        id: 'claude-fable-5-1',
        alias: 'claude-fable-5-1',
        label: 'Claude Fable 5.1',
        line: 'claude-fable',
        tier: 'DEEP',
        capabilities: [...DEEP_CAPS],
        personality: { reasoning: 10, writing: 10, determinism: 9 },
        contextWindow: 1_000_000,
        maxOutput: 128_000,
        releasedAt: '2026-08-28',
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
        // Mid-tier Anthropic model. 1M context and the same request contract
        // as Opus 5 (adaptive thinking is the only on-mode; temperature and
        // top_p are rejected), at $2/$10 per MTok against Opus's $5/$25 — the
        // launch intro price, made permanent by Anthropic in 2026-09.
        // BALANCED: strong enough for Inquiry, and the default recommendation
        // for whole-manuscript onboarding.
        provider: 'anthropic',
        id: 'claude-sonnet-5',
        alias: 'claude-sonnet-5',
        label: 'Claude Sonnet 5',
        line: 'claude-sonnet',
        tier: 'BALANCED',
        capabilities: [...DEEP_CAPS, 'streaming'],
        personality: { reasoning: 9, writing: 9, determinism: 9 },
        contextWindow: 1_000_000,
        maxOutput: 128_000,
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
        // Economy tier — the cheapest route through a bounded whole-manuscript
        // job such as onboarding ($1/$5 per MTok). Deliberately NOT given
        // `reasoningStrong`: its 200K context and lighter reasoning make it
        // unfit for Inquiry's whole-manuscript analysis, and the UI must say
        // so wherever it can be picked. FAST tier is the signal that carries
        // that warning.
        // Context window, max output and pricing are per Anthropic's published
        // model overview (200K / 64K / $1 / $5). Not yet exercised by a live
        // onboarding run, so runtime behaviour under this plugin's strict-JSON
        // path is unproven — the numbers themselves are not in doubt.
        provider: 'anthropic',
        id: 'claude-haiku-4-5',
        alias: 'claude-haiku-4-5',
        label: 'Claude Haiku 4.5',
        line: 'claude-haiku',
        tier: 'FAST',
        capabilities: [...FAST_CAPS],
        personality: { reasoning: 6, writing: 7, determinism: 8 },
        contextWindow: 200_000,
        maxOutput: 64_000,
        releasedAt: '2025-10-01',
        status: 'stable',
        rollout: {
            channel: 'stable',
            status: 'stable',
            lane: 'default'
        },
        constraints: {
            supportsTemperature: true,
            supportsTopP: true,
            supportsAdaptiveThinking: false,
            supportsReasoningEffort: false
        }
    },
    {
        // GPT-5.6 Sol: flagship of the gpt-5.6 family (Luna < Terra < Sol);
        // Luna below is the economy entry, Terra is not curated.
        // GA 2026-07-09, replacing GPT-5.5 on the line. Same request contract
        // per developers.openai.com/api/docs/models/gpt-5.6-sol: Responses
        // API, reasoning effort (none…max), provider-managed sampling,
        // structured outputs, prompt caching, 1.05M context / 128K output.
        provider: 'openai',
        id: 'gpt-5.6-sol',
        alias: 'gpt-5.6-sol',
        label: 'GPT-5.6 Sol',
        line: 'gpt-5',
        tier: 'BALANCED',
        capabilities: [...DEEP_CAPS, 'toolCalling', 'functionCalling'],
        personality: { reasoning: 10, writing: 9, determinism: 9 },
        contextWindow: 1050000,
        maxOutput: 128000,
        releasedAt: '2026-07-09',
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
        // GPT-6 Astra: OpenAI's premium model, public release 2026-09-05
        // (developers.openai.com/api/docs/models/gpt-6-astra). Same request
        // contract as the 5.6 family (Responses API, reasoning effort low…max,
        // provider-managed sampling, structured outputs, prompt caching) at
        // 2.5× Sol's price, so it sits on the 'pro' channel: visible and
        // pinnable, auto-selected only under the latestPro policy, never the
        // silent default. Cyber-sensitive capabilities are gated by OpenAI's
        // trusted-access program; that does not affect RT's workload.
        provider: 'openai',
        id: 'gpt-6-astra',
        alias: 'gpt-6-astra',
        label: 'GPT-6 Astra',
        line: 'gpt-6',
        tier: 'DEEP',
        capabilities: [...DEEP_CAPS, 'toolCalling', 'functionCalling'],
        personality: { reasoning: 10, writing: 10, determinism: 9 },
        contextWindow: 1050000,
        maxOutput: 128000,
        releasedAt: '2026-09-05',
        status: 'stable',
        rollout: {
            channel: 'pro',
            status: 'stable',
            lane: 'pro'
        },
        constraints: {
            supportsTemperature: false,
            supportsTopP: false,
            supportsReasoningEffort: true,
            preferredOpenAiEndpoint: 'responses'
        }
    },
    {
        // Economy model on the gpt-5 line: GPT-5.6 Luna, the cost tier of the
        // same family (developers.openai.com/api/docs/models/gpt-5.6-luna:
        // $0.20/$1.20, 1.05M context, 128K output, reasoning effort, structured
        // outputs, prompt caching — the same request contract as Sol). FAST
        // tier is the signal that it is the economy choice, as Haiku 4.5 and
        // Gemini 3.5 Flash are for their providers. Auto-selection resolves to
        // Sol (newest on the line); Luna is an explicit pick. Dated one day
        // before Sol so the two never tie on the newest-on-line sort.
        provider: 'openai',
        id: 'gpt-5.6-luna',
        alias: 'gpt-5.6-luna',
        label: 'GPT-5.6 Luna',
        line: 'gpt-5',
        tier: 'FAST',
        capabilities: [...DEEP_CAPS, 'toolCalling', 'functionCalling'],
        personality: { reasoning: 7, writing: 7, determinism: 8 },
        contextWindow: 1050000,
        maxOutput: 128000,
        releasedAt: '2026-07-08',
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
