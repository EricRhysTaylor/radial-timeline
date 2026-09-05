import {
    modelSupportsSystemRole,
    providerSupportsBatchApi,
    providerSupportsCitations,
    providerSupportsCorpusReuse,
    type AiProvider
} from '../../api/providerCapabilities';
import type {
    AIProviderId,
    Capability,
    EngineCapabilities,
    EngineCapabilitySignal,
    EngineCapabilityStatus,
    ModelInfo
} from '../types';

type EngineImplementationStatus = {
    /** Direct manuscript citation workflow (Inquiry evidence docs -> citations). */
    directManuscriptCitations: boolean;
    /** Grounded/tool attribution workflow (external-source metadata mapping). */
    groundedToolAttribution: boolean;
    /** Annotation-style source metadata can be rendered truthfully in RT. */
    annotationRendering: boolean;
    corpusReuse: boolean;
    batchAnalysis: boolean;
};

/**
 * Product-level RT implementation status per provider for the normalized
 * recommendation capability layer.
 */
const RT_IMPLEMENTATION_STATUS: Record<Exclude<AIProviderId, 'none'>, EngineImplementationStatus> = {
    anthropic: {
        directManuscriptCitations: true,
        groundedToolAttribution: false,
        annotationRendering: false,
        corpusReuse: true,
        batchAnalysis: false
    },
    openai: {
        directManuscriptCitations: false,
        groundedToolAttribution: false,
        annotationRendering: true,
        corpusReuse: true,
        batchAnalysis: false
    },
    google: {
        directManuscriptCitations: false,
        groundedToolAttribution: true,
        annotationRendering: true,
        corpusReuse: true,
        batchAnalysis: false
    },
    ollama: {
        directManuscriptCitations: false,
        groundedToolAttribution: false,
        annotationRendering: false,
        corpusReuse: false,
        batchAnalysis: false
    }
};

const LONG_CONTEXT_CAPABILITY: Capability = 'longContext';

export interface EngineModelRef {
    provider: AIProviderId;
    modelId?: string;
    modelAlias?: string;
}

export interface EngineCapabilityMatrixRow {
    provider: AIProviderId;
    modelId: string;
    modelAlias: string;
    modelLabel: string;
    contextWindow: number;
    directManuscriptCitations: EngineCapabilityStatus;
    groundedToolAttribution: EngineCapabilityStatus;
    annotationRendering: EngineCapabilityStatus;
    corpusReuse: EngineCapabilityStatus;
    largeContext: EngineCapabilityStatus;
    batchAnalysis: EngineCapabilityStatus;
}

function toStatus(providerSupported: boolean, availableInRt: boolean): EngineCapabilityStatus {
    if (providerSupported && availableInRt) return 'available';
    if (providerSupported && !availableInRt) return 'provider_supported_not_used';
    return 'unavailable';
}

function buildSignal(providerSupported: boolean, availableInRt: boolean): EngineCapabilitySignal {
    return {
        status: toStatus(providerSupported, availableInRt),
        providerSupported,
        availableInRt
    };
}

function resolveImplementationStatus(provider: AIProviderId): EngineImplementationStatus {
    if (provider === 'none') {
        return {
            directManuscriptCitations: false,
            groundedToolAttribution: false,
            annotationRendering: false,
            corpusReuse: false,
            batchAnalysis: false
        };
    }
    return RT_IMPLEMENTATION_STATUS[provider];
}

function providerSupportsGroundedToolAttribution(provider: AiProvider): boolean {
    return provider === 'openai' || provider === 'google';
}

function hasLongContext(model: ModelInfo): boolean {
    return model.capabilities.includes(LONG_CONTEXT_CAPABILITY);
}

function resolveStructuredOutputStrength(model: ModelInfo): EngineCapabilities['structuredOutputStrength'] {
    if (model.capabilities.includes('jsonStrict') && model.capabilities.includes('functionCalling')) {
        return 'strong';
    }
    if (model.capabilities.includes('jsonStrict')) return 'basic';
    return 'limited';
}

function resolveReasoningSupport(model: ModelInfo): EngineCapabilities['reasoningSupport'] {
    if (model.capabilities.includes('reasoningStrong')) return 'strong';
    if (model.capabilities.includes('longContext')) return 'standard';
    return 'limited';
}

function resolveCorpusReuseAvailableInRt(
    model: ModelInfo,
    provider: AiProvider,
    implementationStatus: EngineImplementationStatus
): boolean {
    if (!implementationStatus.corpusReuse) return false;
    if (provider !== 'openai') return true;
    return modelSupportsSystemRole('openai', model.id);
}

export function resolveEngineCapabilities(model: ModelInfo): EngineCapabilities {
    const provider = model.provider === 'none' ? null : model.provider;
    const implementationStatus = resolveImplementationStatus(model.provider);

    const supportsDirectManuscriptCitations = provider
        ? providerSupportsCitations(provider)
        : false;
    const directManuscriptCitationsAvailableInRt = supportsDirectManuscriptCitations
        && implementationStatus.directManuscriptCitations;

    const supportsGroundedToolAttribution = provider
        ? providerSupportsGroundedToolAttribution(provider)
        : false;
    const groundedToolAttributionAvailableInRt = supportsGroundedToolAttribution
        && implementationStatus.groundedToolAttribution;
    const annotationRenderingAvailableInRt = supportsGroundedToolAttribution
        && implementationStatus.annotationRendering;

    const supportsCorpusReuse = provider ? providerSupportsCorpusReuse(provider) : false;
    const corpusReuseAvailableInRt = provider
        ? supportsCorpusReuse && resolveCorpusReuseAvailableInRt(model, provider, implementationStatus)
        : false;

    const supportsBatch = provider ? providerSupportsBatchApi(provider) : false;
    const batchAvailableInRt = supportsBatch && implementationStatus.batchAnalysis;

    const supportsLargeContext = hasLongContext(model) && model.contextWindow > 0;
    const directManuscriptCitationsSignal = buildSignal(
        supportsDirectManuscriptCitations,
        directManuscriptCitationsAvailableInRt
    );
    const groundedToolAttributionSignal = buildSignal(
        supportsGroundedToolAttribution,
        groundedToolAttributionAvailableInRt
    );
    const annotationRenderingSignal = buildSignal(
        supportsGroundedToolAttribution,
        annotationRenderingAvailableInRt
    );

    return {
        provider: model.provider,
        modelId: model.id,
        modelAlias: model.alias,
        modelLabel: model.label,
        directManuscriptCitations: directManuscriptCitationsSignal,
        groundedToolAttribution: groundedToolAttributionSignal,
        annotationRendering: annotationRenderingSignal,
        corpusReuse: buildSignal(supportsCorpusReuse, corpusReuseAvailableInRt),
        largeContext: {
            ...buildSignal(supportsLargeContext, supportsLargeContext),
            contextWindow: model.contextWindow
        },
        batchAnalysis: buildSignal(supportsBatch, batchAvailableInRt),
        structuredOutputStrength: resolveStructuredOutputStrength(model),
        reasoningSupport: resolveReasoningSupport(model),
        constraints: {
            cacheVsCitationsExclusive: model.constraints?.cacheVsCitationsExclusive ?? false,
        },
        isPreview: model.status === 'preview'
    };
}

export function resolveEngineCapabilitiesForRef(
    models: ModelInfo[],
    ref: EngineModelRef
): EngineCapabilities | null {
    const model = models.find(entry => {
        if (entry.provider !== ref.provider) return false;
        if (ref.modelId && entry.id === ref.modelId) return true;
        if (ref.modelAlias && entry.alias === ref.modelAlias) return true;
        return false;
    });
    return model ? resolveEngineCapabilities(model) : null;
}

export interface ModelUiSignals {
    citationLabel: string | null;
    reuseLabel: string | null;
    isPreview: boolean;
}

export function getModelUiSignals(model: ModelInfo): ModelUiSignals {
    const capabilities = resolveEngineCapabilities(model);

    let citationLabel: string | null = null;
    if (capabilities.directManuscriptCitations.availableInRt) {
        citationLabel = 'Citation · Direct manuscript';
    } else if (capabilities.groundedToolAttribution.availableInRt) {
        citationLabel = model.provider === 'google'
            ? 'Citation · Grounded search'
            : 'Citation · Tool annotations';
    } else if (capabilities.annotationRendering.availableInRt) {
        citationLabel = 'Sources · Limited implementation';
    }

    // For models with the citations/cache mutex (e.g. Gemini), always emit both
    // labels so the UI renders a dedicated Cache pill; the resolver uses
    // citationsEnabled to set the active/muted state and wording.
    let reuseLabel: string | null = null;
    if (capabilities.corpusReuse.availableInRt) {
        reuseLabel = 'Reuse · Provider cache';
    } else {
        reuseLabel = 'Reuse · No provider cache';
    }

    return {
        citationLabel,
        reuseLabel,
        isPreview: capabilities.isPreview
    };
}

export function buildEngineCapabilityMatrix(models: ModelInfo[]): EngineCapabilityMatrixRow[] {
    return models.map(model => {
        const resolved = resolveEngineCapabilities(model);
        return {
            provider: resolved.provider,
            modelId: resolved.modelId,
            modelAlias: resolved.modelAlias,
            modelLabel: resolved.modelLabel,
            contextWindow: resolved.largeContext.contextWindow,
            directManuscriptCitations: resolved.directManuscriptCitations.status,
            groundedToolAttribution: resolved.groundedToolAttribution.status,
            annotationRendering: resolved.annotationRendering.status,
            corpusReuse: resolved.corpusReuse.status,
            largeContext: resolved.largeContext.status,
            batchAnalysis: resolved.batchAnalysis.status
        };
    });
}
