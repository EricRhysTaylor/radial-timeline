/*
 * Catalog-wide model dispatch contract.
 *
 * For every model in BUILTIN_MODELS, drive sanitizeDispatchParams with a
 * fully-equipped request and assert that the sanitizer's behavior aligns
 * with the model's registry-declared capabilities.
 *
 * This is the forcing function that catches the class of bug where a
 * model gets added to the registry but the request plumbing doesn't
 * honor its declared capabilities — the pattern that broke Gemini 3.5
 * Flash (commit f1f32505) and would have broken any reasoning-effort
 * OpenAI model the same way had it shipped.
 *
 * The test iterates BUILTIN_MODELS, so adding a new model
 * automatically extends coverage. The test fails LOUDLY if a new model
 * declares a capability the sanitizer doesn't actually plumb.
 *
 * Scope: dispatch-layer sanitization only. Higher layers (feature
 * selection, model picking, end-to-end provider HTTP) are covered by
 * their own tests.
 */

import { describe, it, expect } from 'vitest';
import { BUILTIN_MODELS } from './builtinModels';
import type { AIProviderId } from '../types';
import {
    sanitizeDispatchParams,
    type AiProvider,
    type ProviderDispatchParams,
} from '../../api/providerCapabilities';
import { getModelRequestProfile } from './modelRequestProfiles';

function fullyEquippedDispatch(modelId: string): ProviderDispatchParams {
    return {
        modelId,
        systemPrompt: 'You are precise.',
        userPrompt: 'Return JSON.',
        maxOutputTokens: 2048,
        temperature: 0.2,
        topP: 0.9,
        jsonSchema: { type: 'object' },
        jsonStrict: true,
        thinkingBudgetTokens: 4096,
        citationsEnabled: true,
        evidenceDocuments: [{ title: 'doc.md', content: 'evidence' }],
    };
}

function isGeminiThinkingFamily(modelId: string): boolean {
    const clean = modelId.replace(/^models\//, '');
    return /\b2\.5\b|\b3\.\d/.test(clean);
}

const cloudModels = BUILTIN_MODELS.filter(m => m.provider !== 'none');

describe('model catalog dispatch contract', () => {
    it('has at least one model per real provider — fixture sanity', () => {
        // Cheap regression guard: if BUILTIN_MODELS lost an entire
        // provider's set of entries the contract becomes vacuous.
        const providers = new Set(cloudModels.map(m => m.provider));
        expect(providers).toContain('anthropic');
        expect(providers).toContain('openai');
        expect(providers).toContain('google');
        expect(providers).toContain('ollama');
    });

    for (const model of cloudModels) {
        const provider = model.provider as Exclude<AIProviderId, 'none'>;
        const profile = getModelRequestProfile(provider, model.id);
        const params = fullyEquippedDispatch(model.id);
        const { params: sanitized } = sanitizeDispatchParams(
            provider as AiProvider,
            params,
            model.constraints
        );

        describe(`${model.provider}/${model.id}`, () => {
            it('preserves maxOutputTokens', () => {
                expect(sanitized.maxOutputTokens).toBe(2048);
            });

            it('preserves jsonSchema at the dispatch layer', () => {
                // The dispatch layer does not gate by supportsJsonSchema —
                // upstream feature code is responsible for not requesting
                // schemas on models that lack support. Pin current behavior
                // so an accidental tighten-up here surfaces immediately.
                expect(sanitized.jsonSchema).toEqual({ type: 'object' });
            });

            it('always strips jsonStrict (no provider consumes it)', () => {
                expect(sanitized.jsonStrict).toBeUndefined();
            });

            it('temperature: kept iff profile + family allow', () => {
                const familyStrips = provider === 'google'
                    && isGeminiThinkingFamily(model.id);
                if (profile.supportsTemperature && !familyStrips) {
                    expect(sanitized.temperature).toBe(0.2);
                } else {
                    expect(sanitized.temperature).toBeUndefined();
                }
            });

            it('topP: kept iff profile + family allow', () => {
                const familyStrips = provider === 'google'
                    && isGeminiThinkingFamily(model.id);
                if (profile.supportsTopP && !familyStrips) {
                    expect(sanitized.topP).toBe(0.9);
                } else {
                    expect(sanitized.topP).toBeUndefined();
                }
            });

            it('thinkingBudgetTokens: kept iff profile.supportsThinkingBudget', () => {
                // Anthropic Sonnet/Opus declare the budget; other providers
                // either don't support extended thinking or use a different
                // mechanism (Gemini default-on, OpenAI reasoning_effort).
                if (profile.supportsThinkingBudget) {
                    expect(sanitized.thinkingBudgetTokens).toBe(4096);
                } else {
                    expect(sanitized.thinkingBudgetTokens).toBeUndefined();
                }
            });

            it('citationsEnabled: respects provider support and cacheVsCitationsExclusive', () => {
                const supportsCitationControl = profile.supportsCitations
                    || provider === 'google';
                const blockedByConstraint = model.constraints?.cacheVsCitationsExclusive === true;
                if (supportsCitationControl && !blockedByConstraint) {
                    expect(sanitized.citationsEnabled).toBe(true);
                } else {
                    expect(sanitized.citationsEnabled).toBeUndefined();
                }
            });

            it('evidenceDocuments: kept iff profile.supportsEvidenceDocuments', () => {
                if (profile.supportsEvidenceDocuments) {
                    expect(sanitized.evidenceDocuments?.length).toBe(1);
                } else {
                    expect(sanitized.evidenceDocuments).toBeUndefined();
                }
            });
        });
    }
});

describe('model catalog dispatch contract: invariants', () => {
    it('every cloud model has a request profile (no undefined provider entries)', () => {
        for (const model of cloudModels) {
            const provider = model.provider as Exclude<AIProviderId, 'none'>;
            const profile = getModelRequestProfile(provider, model.id);
            expect(profile, `${provider}/${model.id} missing profile`).toBeTruthy();
            expect(typeof profile.supportsTemperature).toBe('boolean');
            expect(typeof profile.supportsTopP).toBe('boolean');
            expect(typeof profile.supportsJsonSchema).toBe('boolean');
            expect(typeof profile.supportsPromptCache).toBe('boolean');
            expect(typeof profile.supportsCitations).toBe('boolean');
            expect(typeof profile.supportsEvidenceDocuments).toBe('boolean');
            expect(typeof profile.supportsThinkingBudget).toBe('boolean');
        }
    });

    it('OpenAI GPT-5.5 models route to the Responses API', () => {
        const gpt55 = cloudModels.filter(m =>
            m.provider === 'openai' && m.id.startsWith('gpt-5.5')
        );
        expect(gpt55.length).toBeGreaterThan(0);
        for (const model of gpt55) {
            const profile = getModelRequestProfile('openai', model.id);
            expect(profile.preferredOpenAiEndpoint).toBe('responses');
            expect(profile.supportsTemperature).toBe(false);
            expect(profile.supportsTopP).toBe(false);
            // Reasoning-effort capability is declared for GPT-5.5 — pin so
            // that future plumbing through to dispatch params can be
            // detected by extending this assertion.
            expect(profile.supportsReasoningEffort).toBe(true);
        }
    });

    it('Gemini 2.5+/3.x models strip temperature and topP regardless of caller', () => {
        const geminiThinking = cloudModels.filter(m =>
            m.provider === 'google' && isGeminiThinkingFamily(m.id)
        );
        expect(geminiThinking.length).toBeGreaterThan(0);
        for (const model of geminiThinking) {
            const { params: sanitized } = sanitizeDispatchParams(
                'google',
                fullyEquippedDispatch(model.id),
                model.constraints
            );
            expect(sanitized.temperature, `${model.id} should strip temperature`).toBeUndefined();
            expect(sanitized.topP, `${model.id} should strip topP`).toBeUndefined();
        }
    });

    it('Anthropic Opus/Sonnet support thinkingBudgetTokens at dispatch layer', () => {
        const anthropic = cloudModels.filter(m => m.provider === 'anthropic');
        expect(anthropic.length).toBeGreaterThan(0);
        for (const model of anthropic) {
            const { params: sanitized } = sanitizeDispatchParams(
                'anthropic',
                fullyEquippedDispatch(model.id),
                model.constraints
            );
            expect(sanitized.thinkingBudgetTokens, `${model.id} should keep thinkingBudgetTokens`).toBe(4096);
        }
    });

    it('no model line carries more than the current model plus one continuity model', () => {
        // Continuity policy (docs/engineering/standards/model-promotion.md):
        // a line may hold the current model and at most one prior (N-1)
        // continuity model — never a third. This caps the catalog so the
        // continuity slot cannot silently slide back into the pre-2026-05-22
        // accretion. Local/sentinel lines (ollama/none) are exempt.
        const countByLine = new Map<string, string[]>();
        for (const model of cloudModels) {
            if (model.provider === 'ollama') continue;
            if (model.status === 'deprecated') continue;
            const line = model.line ?? model.id;
            const ids = countByLine.get(line) ?? [];
            ids.push(model.id);
            countByLine.set(line, ids);
        }
        for (const [line, ids] of countByLine) {
            expect(
                ids.length,
                `line "${line}" has ${ids.length} active models (${ids.join(', ')}); max is 2 (current + one continuity)`
            ).toBeLessThanOrEqual(2);
        }
    });
});
