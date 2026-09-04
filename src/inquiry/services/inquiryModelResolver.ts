/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 */

/**
 * Shared resolver: single source of truth for Inquiry's AI engine.
 *
 * Inquiry does not choose models. Inquiry reports the resolved engine
 * produced by canonical AI Strategy policy. Every surface (badge,
 * popover, run submission, logs, fingerprint) reads from one
 * ResolvedInquiryEngine DTO produced here.
 */

import type RadialTimelinePlugin from '../../main';
import type {
    AIProviderId,
    AiSettingsV1,
    Capability,
    ModelInfo,
    ModelPolicy
} from '../../ai/types';
import { selectModel } from '../../ai/router/selectModel';
import { buildDefaultAiSettings } from '../../ai/settings/aiSettings';
import { validateAiSettings } from '../../ai/settings/validateAiSettings';
import { getLocalLlmSettings } from '../../ai/localLlm/settings';
import { resolveAccessTier } from '../../ai/runtime/runtimeSelection';

// ── Types ──────────────────────────────────────────────────────────

/** Explains which settings layer produced the resolved engine. */
export type PolicySource = 'featureOverride' | 'globalPolicy' | 'disabled';

/** One DTO consumed by every Inquiry surface. */
export interface ResolvedInquiryEngine {
    provider: AIProviderId;
    modelId: string;
    modelAlias: string;
    modelLabel: string;
    providerLabel: string;
    hasCredential: boolean;
    contextWindow: number;
    maxOutput: number;
    selectionReason: string;
    policySource: PolicySource;
    /**
     * When true, the provider/model combination cannot satisfy Inquiry's
     * capability floor.  All numeric fields (contextWindow, maxOutput) are 0
     * and must NOT be displayed as real values.  The UI should show a
     * blocked / unavailable state instead.
     */
    blocked?: boolean;
    /** Human-readable explanation of why the engine is blocked. */
    blockReason?: string;
    /**
     * Set when the author's pinned model cannot meet Inquiry's capability
     * floor and a different model is running instead.
     *
     * This is NOT cosmetic. `selectModel` substitutes silently and the
     * substitute is, by definition, a more capable — and therefore more
     * expensive — model. An author who pins Haiku 4.5 to control cost and is
     * quietly upgraded to Opus 5 finds out from their invoice. Every Inquiry
     * surface that displays the engine MUST display this too.
     */
    substitution?: {
        /** The alias the author actually pinned. */
        requestedAlias: string;
        /** Label of the model Inquiry will really use. */
        runningLabel: string;
        /** Author-facing sentence naming the swap and why it happened. */
        notice: string;
    };
}

// ── Constants ──────────────────────────────────────────────────────

/** Capability floor for Inquiry — must match what aiClient enforces at runtime. */
export const INQUIRY_REQUIRED_CAPABILITIES: Capability[] = [
    'longContext', 'jsonStrict', 'reasoningStrong', 'highOutputCap'
];

const PROVIDER_LABELS: Record<AIProviderId, string> = {
    anthropic: 'Anthropic',
    openai: 'OpenAI',
    google: 'Google',
    ollama: 'Ollama',
    none: 'Disabled'
};

const CANONICAL_PROVIDERS: AIProviderId[] = ['anthropic', 'openai', 'google', 'ollama', 'none'];

// ── Helpers ────────────────────────────────────────────────────────

function hasValidProvider(provider: unknown): provider is AIProviderId {
    return typeof provider === 'string' && CANONICAL_PROVIDERS.includes(provider as AIProviderId);
}

function getValidatedAiSettings(plugin: RadialTimelinePlugin): AiSettingsV1 {
    const validated = validateAiSettings(plugin.settings.aiSettings ?? buildDefaultAiSettings());
    plugin.settings.aiSettings = validated.value;
    return validated.value;
}

// ── Main resolver ──────────────────────────────────────────────────

/**
 * Resolve the Inquiry engine from canonical AI Strategy settings.
 *
 * Resolution order:
 *   1. Feature-level override  (`featureProfiles.InquiryMode`)
 *   2. Global AI Strategy      (`aiSettings.provider` + `aiSettings.modelPolicy`)
 *   3. Disabled                (canonical provider remains `'none'`)
 *
 * @returns A deterministic DTO — same settings always produce the same result.
 */
export function resolveInquiryEngine(
    plugin: RadialTimelinePlugin,
    models: ModelInfo[]
): ResolvedInquiryEngine {
    const rawProvider = plugin.settings.aiSettings?.provider;
    if (rawProvider !== undefined && !hasValidProvider(rawProvider)) {
        return {
            provider: 'none',
            modelId: '',
            modelAlias: '',
            modelLabel: 'Invalid AI provider',
            providerLabel: PROVIDER_LABELS.none,
            hasCredential: false,
            contextWindow: 0,
            maxOutput: 0,
            selectionReason: 'Canonical AI Strategy contains an invalid provider id.',
            policySource: 'disabled',
            blocked: true,
            blockReason: 'AI settings contain an invalid provider. Re-select a provider in AI settings before using Inquiry.'
        };
    }

    const aiSettings = getValidatedAiSettings(plugin);
    const featureProfile = aiSettings.featureProfiles?.['InquiryMode'];

    // ── Provider resolution ────────────────────────────────────────
    let provider: AIProviderId;
    let policySource: PolicySource;

    if (featureProfile?.provider && featureProfile.provider !== 'none') {
        // Feature-level override takes precedence.
        provider = featureProfile.provider;
        policySource = 'featureOverride';
    } else if (aiSettings.provider !== 'none') {
        // Global AI Strategy provider.
        provider = aiSettings.provider;
        policySource = featureProfile?.modelPolicy ? 'featureOverride' : 'globalPolicy';
    } else {
        provider = 'none';
        policySource = 'disabled';
    }

    if (provider === 'none') {
        return {
            provider,
            modelId: '',
            modelAlias: '',
            modelLabel: 'AI disabled',
            providerLabel: PROVIDER_LABELS.none,
            hasCredential: false,
            contextWindow: 0,
            maxOutput: 0,
            selectionReason: 'Canonical AI Strategy is disabled.',
            policySource,
            blocked: true,
            blockReason: 'Enable an AI provider in AI settings to use Inquiry.'
        };
    }

    // ── Policy resolution ──────────────────────────────────────────
    const policy: ModelPolicy = featureProfile?.modelPolicy
        ?? aiSettings.modelPolicy;

    // ── Model selection ────────────────────────────────────────────
    const accessTier = resolveAccessTier(aiSettings, provider);
    const providerLabel = PROVIDER_LABELS[provider] ?? String(provider);
    // For key-based providers "has credential" must mean a REAL secret is stored,
    // not merely that a secret-ID alias exists — the alias (e.g. `rt.openai.api-key`)
    // is a default and is always present, so it can't stand in for the key. Actual
    // presence is resolved async (via hasSecret) into plugin.credentialPresence;
    // undefined → treat as absent so a keyless vault is honestly keyless.
    const hasCredential = provider === 'ollama'
        ? !!getLocalLlmSettings(aiSettings).baseUrl?.trim() && getLocalLlmSettings(aiSettings).enabled
        : (plugin.credentialPresence?.[provider] ?? false);

    if (!hasCredential) {
        return {
            provider,
            modelId: '',
            modelAlias: '',
            modelLabel: 'Provider not configured',
            providerLabel,
            hasCredential: false,
            contextWindow: 0,
            maxOutput: 0,
            selectionReason: `${providerLabel} is not configured for Inquiry.`,
            policySource,
            blocked: true,
            blockReason: provider === 'ollama'
                ? 'Configure and enable Local LLM in AI settings before using Inquiry.'
                : `Add a saved ${providerLabel} key in AI settings before using Inquiry.`
        };
    }

    try {
        const selection = selectModel(models, {
            provider,
            policy,
            requiredCapabilities: INQUIRY_REQUIRED_CAPABILITIES,
            accessTier
        });

        // A pinned alias that survives the capability filter is returned as-is;
        // one that does not is swapped for a stronger model. Distinguish the
        // two by asking whether the pinned alias exists in the catalog at all
        // — a typo or a retired model is a different story from "this model
        // is real but cannot do Inquiry", and only the latter is worth
        // explaining in those terms.
        const pinnedAlias = policy.type === 'pinned' ? policy.pinnedAlias : undefined;
        const substituted = Boolean(pinnedAlias) && selection.model.alias !== pinnedAlias;
        const pinnedModel = substituted
            ? models.find(model => model.alias === pinnedAlias)
            : undefined;
        const substitution = substituted && pinnedAlias
            ? {
                requestedAlias: pinnedAlias,
                runningLabel: selection.model.label,
                notice: pinnedModel
                    ? `${pinnedModel.label} cannot run Inquiry — it does not meet the capability floor (long context, strict JSON, strong reasoning, high output cap). Inquiry is using ${selection.model.label} instead, which costs more per run.`
                    : `Pinned model "${pinnedAlias}" is unavailable. Inquiry is using ${selection.model.label} instead, which may cost more per run.`
            }
            : undefined;

        return {
            provider: selection.provider,
            modelId: selection.model.id,
            modelAlias: selection.model.alias,
            modelLabel: selection.model.label,
            providerLabel: PROVIDER_LABELS[selection.provider] ?? String(selection.provider),
            hasCredential: true,
            contextWindow: selection.model.contextWindow,
            maxOutput: selection.model.maxOutput,
            selectionReason: selection.reason,
            policySource,
            ...(substitution ? { substitution } : {})
        };
    } catch {
        // Provider cannot satisfy Inquiry's capability floor (e.g. ollama/local).
        // Return a blocked DTO with honest zeros — no fabricated numbers.
        return {
            provider,
            modelId: '',
            modelAlias: '',
            modelLabel: 'No eligible model',
            providerLabel,
            hasCredential: true,
            contextWindow: 0,
            maxOutput: 0,
            selectionReason: `No model satisfies Inquiry capability floor for ${providerLabel}.`,
            policySource,
            blocked: true,
            blockReason: `${providerLabel} has no model meeting Inquiry requirements.`
        };
    }
}
