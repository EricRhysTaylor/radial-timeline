import { describe, expect, it } from 'vitest';
import { BUILTIN_MODELS } from '../registry/builtinModels';
import {
    buildEngineCapabilityMatrix,
    getModelUiSignals,
    resolveEngineCapabilities,
    resolveEngineCapabilitiesForRef
} from './engineCapabilities';
import type { ModelInfo } from '../types';

function byAlias(alias: string): ModelInfo {
    const model = BUILTIN_MODELS.find(entry => entry.alias === alias);
    expect(model).toBeDefined();
    return model!;
}

describe('resolveEngineCapabilities', () => {
    it('marks Anthropic Inquiry-relevant capabilities as available and batch as not yet used', () => {
        const model = byAlias('claude-opus-4.8');
        const resolved = resolveEngineCapabilities(model);

        expect(resolved.directManuscriptCitations.status).toBe('available');
        expect(resolved.groundedToolAttribution.status).toBe('unavailable');
        expect(resolved.corpusReuse.status).toBe('available');
        expect(resolved.largeContext.status).toBe('available');
        expect(resolved.largeContext.contextWindow).toBe(1000000);
        expect(resolved.batchAnalysis.status).toBe('provider_supported_not_used');
    });

    it('marks OpenAI corpus reuse available while citation acquisition stays separate from annotation rendering', () => {
        const model = byAlias('gpt-5.5');
        const resolved = resolveEngineCapabilities(model);

        expect(resolved.directManuscriptCitations.status).toBe('unavailable');
        expect(resolved.groundedToolAttribution.status).toBe('provider_supported_not_used');
        expect(resolved.annotationRendering.status).toBe('available');
        expect(resolved.corpusReuse.status).toBe('available');
        expect(resolved.largeContext.status).toBe('available');
        expect(resolved.batchAnalysis.status).toBe('provider_supported_not_used');
    });

    it('downgrades OpenAI corpus reuse when a model cannot use the system role path', () => {
        const base = byAlias('gpt-5.5');
        const o1LikeModel: ModelInfo = {
            ...base,
            id: 'o1-mini',
            alias: 'o1-mini',
            label: 'o1-mini'
        };

        const resolved = resolveEngineCapabilities(o1LikeModel);
        expect(resolved.corpusReuse.status).toBe('provider_supported_not_used');
    });

    it('marks Gemini grounded attribution, reuse, and context available while direct manuscript citations remain unavailable', () => {
        const model = byAlias('gemini-3.1-pro-preview');
        const resolved = resolveEngineCapabilities(model);

        expect(resolved.directManuscriptCitations.status).toBe('unavailable');
        expect(resolved.groundedToolAttribution.status).toBe('available');
        expect(resolved.annotationRendering.status).toBe('available');
        expect(resolved.corpusReuse.status).toBe('available');
        expect(resolved.largeContext.status).toBe('available');
        expect(resolved.largeContext.contextWindow).toBe(1048576);
        expect(resolved.batchAnalysis.status).toBe('unavailable');
    });

    it('marks local models unavailable for Inquiry-critical capabilities', () => {
        const model = byAlias('ollama-llama3');
        const resolved = resolveEngineCapabilities(model);

        expect(resolved.directManuscriptCitations.status).toBe('unavailable');
        expect(resolved.groundedToolAttribution.status).toBe('unavailable');
        expect(resolved.annotationRendering.status).toBe('unavailable');
        expect(resolved.corpusReuse.status).toBe('unavailable');
        expect(resolved.largeContext.status).toBe('unavailable');
        expect(resolved.batchAnalysis.status).toBe('unavailable');
    });

    it('resolves by model reference and builds a per-model matrix row shape', () => {
        const model = byAlias('claude-opus-4.8');
        const byRef = resolveEngineCapabilitiesForRef(BUILTIN_MODELS, {
            provider: model.provider,
            modelId: model.id
        });
        expect(byRef?.modelAlias).toBe('claude-opus-4.8');

        const matrix = buildEngineCapabilityMatrix([model]);
        expect(matrix).toEqual([
            {
                provider: 'anthropic',
                modelId: 'claude-opus-4-8',
                modelAlias: 'claude-opus-4.8',
                modelLabel: 'Claude Opus 4.8',
                contextWindow: 1000000,
                directManuscriptCitations: 'available',
                groundedToolAttribution: 'unavailable',
                annotationRendering: 'unavailable',
                corpusReuse: 'available',
                largeContext: 'available',
                batchAnalysis: 'provider_supported_not_used'
            }
        ]);
    });
});

describe('getModelUiSignals', () => {
    it('returns citation and reuse labels for Anthropic model with exclusive constraint', () => {
        const model = byAlias('claude-opus-4.8');
        const signals = getModelUiSignals(model);

        // Sonnet 4.6 has cacheVsCitationsExclusive constraint
        if (model.constraints?.cacheVsCitationsExclusive) {
            expect(signals.citationLabel).toBe('Citation or Cache (exclusive)');
            expect(signals.reuseLabel).toBeNull();
        } else {
            expect(signals.citationLabel).toContain('Citation');
            expect(signals.reuseLabel).toContain('Reuse');
        }
    });

    it('returns reuse label for OpenAI model', () => {
        const model = byAlias('gpt-5.5');
        const signals = getModelUiSignals(model);

        expect(signals.citationLabel).toBe('Sources · Limited implementation');
        expect(signals.reuseLabel).toContain('Reuse');
    });

    it('returns isPreview true for preview models', () => {
        const preview = BUILTIN_MODELS.find(m => m.status === 'preview');
        if (preview) {
            expect(getModelUiSignals(preview).isPreview).toBe(true);
        }
    });

    it('returns isPreview false for stable models', () => {
        const stable = byAlias('claude-opus-4.8');
        expect(getModelUiSignals(stable).isPreview).toBe(false);
    });

    it('returns citation label for Google model', () => {
        const google = BUILTIN_MODELS.find(m => m.provider === 'google' && m.status !== 'deprecated');
        if (google) {
            const signals = getModelUiSignals(google);
            expect(signals.citationLabel).not.toBeNull();
        }
    });
});
