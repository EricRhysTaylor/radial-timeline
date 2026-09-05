import { INPUT_TOKEN_GUARD_FACTOR } from '../../ai/caps/computeCaps';
import { resolveEngineCapabilities } from '../../ai/caps/engineCapabilities';
import { selectModel } from '../../ai/router/selectModel';
import type {
    AIProviderId,
    ModelInfo,
} from '../../ai/types';
import type { TokenEstimateMethod } from '../../ai/tokens/inputTokenEstimate';
import type { InquiryScope } from '../state';
import { INQUIRY_REQUIRED_CAPABILITIES, type ResolvedInquiryEngine } from './inquiryModelResolver';

export const INQUIRY_ADVISORY_CONTEXT_VERSION = 2 as const;
const MIN_COMPELLING_SINGLE_PASS_GAIN = 2;

export type InquiryAdvisoryReasonCode =
    | 'single_pass_preferred'
    | 'sources_preferred'
    | 'cost_reuse_preferred'
    | 'precision_analysis_preferred';

export interface InquiryAdvisoryContext {
    version: typeof INQUIRY_ADVISORY_CONTEXT_VERSION;
    createdAt: string;
    scope: InquiryScope;
    scopeLabel: string;
    resolvedEngine: {
        provider: AIProviderId;
        providerLabel: string;
        modelId: string;
        modelAlias: string;
        modelLabel: string;
        contextWindow: number;
    };
    corpus: {
        estimatedInputTokens: number;
        expectedPassCount: number;
        corpusFingerprint: string;
        overrideSummary: {
            active: boolean;
            classCount: number;
            itemCount: number;
            total: number;
        };
    };
    recommendation: {
        provider: AIProviderId;
        providerLabel: string;
        modelId: string;
        modelAlias: string;
        modelLabel: string;
        reasonCode: InquiryAdvisoryReasonCode;
        message: string;
        currentEngineBehavior: string;
        options: Array<{
            provider: AIProviderId;
            providerLabel: string;
            modelId: string;
            modelAlias: string;
            modelLabel: string;
        }>;
    };
}

export interface InquiryAdvisoryOverrideSummary {
    active: boolean;
    classCount: number;
    itemCount: number;
    total: number;
}

export interface ComputeInquiryAdvisoryInput {
    scope: InquiryScope;
    scopeLabel: string;
    resolvedEngine: ResolvedInquiryEngine;
    currentModel: ModelInfo | null;
    models: ModelInfo[];
    estimatedInputTokens: number;
    currentSafeInputBudget?: number;
    estimationMethod?: TokenEstimateMethod;
    estimateUncertaintyTokens?: number;
    corpusFingerprint: string;
    corpusFingerprintReused?: boolean;
    questionText?: string;
    overrideSummary: InquiryAdvisoryOverrideSummary;
    previousContext?: InquiryAdvisoryContext | null;
}

type AdvisoryCandidate = {
    provider: AIProviderId;
    providerLabel: string;
    modelId: string;
    modelAlias: string;
    modelLabel: string;
    contextWindow: number;
    expectedPassCount: number;
    safeInputBudget: number;
    reasoningSupport: 'limited' | 'standard' | 'strong';
    structuredOutputStrength: 'limited' | 'basic' | 'strong';
    directManuscriptCitationsStatus: 'available' | 'provider_supported_not_used' | 'unavailable';
    groundedToolAttributionStatus: 'available' | 'provider_supported_not_used' | 'unavailable';
    corpusReuseStatus: 'available' | 'provider_supported_not_used' | 'unavailable';
};

const PROVIDER_LABELS: Record<AIProviderId, string> = {
    anthropic: 'Anthropic',
    openai: 'OpenAI',
    google: 'Google',
    ollama: 'Ollama',
    none: 'Disabled'
};

export function estimatePassCount(estimatedInputTokens: number, safeInputBudget: number): number {
    if (estimatedInputTokens <= 0) return 1;
    if (!Number.isFinite(safeInputBudget) || safeInputBudget <= 0) return 2;
    if (estimatedInputTokens <= safeInputBudget) return 1;
    return Math.max(2, Math.ceil(estimatedInputTokens / safeInputBudget));
}

function buildCandidate(
    model: ModelInfo,
    estimatedInputTokens: number,
    safeInputBudgetOverride?: number
): AdvisoryCandidate {
    const capabilities = resolveEngineCapabilities(model);
    const contextWindow = Math.max(0, capabilities.largeContext.contextWindow || model.contextWindow || 0);
    const safeInputBudget = Number.isFinite(safeInputBudgetOverride)
        ? Math.max(0, Math.floor(safeInputBudgetOverride as number))
        : Math.max(0, Math.floor(contextWindow * INPUT_TOKEN_GUARD_FACTOR));

    return {
        provider: model.provider,
        providerLabel: PROVIDER_LABELS[model.provider],
        modelId: model.id,
        modelAlias: model.alias,
        modelLabel: model.label,
        contextWindow: model.contextWindow,
        expectedPassCount: estimatePassCount(estimatedInputTokens, safeInputBudget),
        safeInputBudget,
        reasoningSupport: capabilities.reasoningSupport ?? 'limited',
        structuredOutputStrength: capabilities.structuredOutputStrength ?? 'limited',
        directManuscriptCitationsStatus: capabilities.directManuscriptCitations.status,
        groundedToolAttributionStatus: capabilities.groundedToolAttribution.status,
        corpusReuseStatus: capabilities.corpusReuse.status
    };
}

function dedupeCandidates(candidates: AdvisoryCandidate[]): AdvisoryCandidate[] {
    const unique = new Map<string, AdvisoryCandidate>();
    candidates.forEach(candidate => {
        unique.set(`${candidate.provider}:${candidate.modelId}`, candidate);
    });
    return Array.from(unique.values());
}

function rankCandidates(candidates: AdvisoryCandidate[]): AdvisoryCandidate[] {
    return [...candidates].sort((left, right) => {
        if (left.expectedPassCount !== right.expectedPassCount) {
            return left.expectedPassCount - right.expectedPassCount;
        }
        if (left.safeInputBudget !== right.safeInputBudget) {
            return right.safeInputBudget - left.safeInputBudget;
        }
        if (left.contextWindow !== right.contextWindow) {
            return right.contextWindow - left.contextWindow;
        }
        return left.modelLabel.localeCompare(right.modelLabel);
    });
}

function buildIdentity(context: InquiryAdvisoryContext): string {
    return [
        context.scope,
        context.scopeLabel,
        context.resolvedEngine.provider,
        context.resolvedEngine.modelId,
        context.corpus.estimatedInputTokens,
        context.corpus.expectedPassCount,
        context.corpus.corpusFingerprint,
        context.corpus.overrideSummary.total,
        context.recommendation.currentEngineBehavior,
        context.recommendation.reasonCode,
        context.recommendation.provider,
        context.recommendation.modelId,
        context.recommendation.options.map(option => `${option.provider}:${option.modelId}`).join(',')
    ].join('|');
}

function buildCurrentBehaviorLabel(expectedPassCount: number): string {
    if (expectedPassCount <= 1) {
        return 'This run is expected to fit in one pass.';
    }
    return `This run is expected to require ${expectedPassCount} passes.`;
}

function buildProviderCandidates(
    input: ComputeInquiryAdvisoryInput
): AdvisoryCandidate[] {
    const providerCandidates: AdvisoryCandidate[] = [];
    const providers = Array.from(new Set(
        input.models
            .map(model => model.provider)
            .filter((provider): provider is Exclude<AIProviderId, 'none'> => provider !== 'none')
    ));

    providers.forEach(provider => {
        try {
            const selection = selectModel(input.models, {
                provider,
                policy: { type: 'latestStable' },
                requiredCapabilities: INQUIRY_REQUIRED_CAPABILITIES
            });
            providerCandidates.push(buildCandidate(selection.model, input.estimatedInputTokens));
        } catch {
            // Provider has no eligible Inquiry model for current capability floor.
        }
    });

    return providerCandidates;
}

function getReasoningRank(value: AdvisoryCandidate['reasoningSupport']): number {
    if (value === 'strong') return 3;
    if (value === 'standard') return 2;
    return 1;
}

function getStructuredRank(value: AdvisoryCandidate['structuredOutputStrength']): number {
    if (value === 'strong') return 3;
    if (value === 'basic') return 2;
    return 1;
}

function isPrecisionAnalysisQuestion(questionText?: string): boolean {
    const normalized = questionText?.trim().toLowerCase() ?? '';
    if (!normalized) return false;
    if (normalized.length >= 120) return true;
    const precisionSignals = [
        'why',
        'because',
        'compare',
        'tradeoff',
        'implication',
        'causal',
        'motivation',
        'subtext',
        'theme',
        'consistency',
        'contradiction',
        'evidence',
        'counterfactual',
        'arc'
    ];
    return precisionSignals.some(signal => normalized.includes(signal));
}

function rankPrecisionCandidates(
    alternatives: AdvisoryCandidate[],
    currentCandidate: AdvisoryCandidate
): AdvisoryCandidate[] {
    const currentReasoningRank = getReasoningRank(currentCandidate.reasoningSupport);
    const currentStructuredRank = getStructuredRank(currentCandidate.structuredOutputStrength);
    const stronger = alternatives.filter(candidate => {
        const reasoningRank = getReasoningRank(candidate.reasoningSupport);
        const structuredRank = getStructuredRank(candidate.structuredOutputStrength);
        return reasoningRank > currentReasoningRank
            || (reasoningRank === currentReasoningRank && structuredRank > currentStructuredRank);
    });
    if (!stronger.length) return [];
    return [...stronger].sort((left, right) => {
        const reasoningDelta = getReasoningRank(right.reasoningSupport) - getReasoningRank(left.reasoningSupport);
        if (reasoningDelta !== 0) return reasoningDelta;
        const structuredDelta = getStructuredRank(right.structuredOutputStrength) - getStructuredRank(left.structuredOutputStrength);
        if (structuredDelta !== 0) return structuredDelta;
        if (left.expectedPassCount !== right.expectedPassCount) {
            return left.expectedPassCount - right.expectedPassCount;
        }
        if (left.safeInputBudget !== right.safeInputBudget) {
            return right.safeInputBudget - left.safeInputBudget;
        }
        return left.modelLabel.localeCompare(right.modelLabel);
    });
}

function buildRecommendationMessage(
    reasonCode: InquiryAdvisoryReasonCode,
    optionCount: number
): string {
    const plural = optionCount > 1;
    if (reasonCode === 'sources_preferred') {
        return plural ? 'Citation-backed alternatives:' : 'Citation-backed alternative:';
    }
    if (reasonCode === 'single_pass_preferred') {
        return plural ? 'Single-pass options:' : 'Single-pass option:';
    }
    if (reasonCode === 'cost_reuse_preferred') {
        return plural ? 'Context-aware alternatives:' : 'Context-aware alternative:';
    }
    return plural ? 'Reasoning-first alternatives:' : 'Reasoning-first alternative:';
}

function toRecommendationOption(candidate: AdvisoryCandidate): InquiryAdvisoryContext['recommendation']['options'][number] {
    return {
        provider: candidate.provider,
        providerLabel: candidate.providerLabel,
        modelId: candidate.modelId,
        modelAlias: candidate.modelAlias,
        modelLabel: candidate.modelLabel
    };
}

export function computeInquiryAdvisoryContext(input: ComputeInquiryAdvisoryInput): InquiryAdvisoryContext | null {
    const currentModel = input.currentModel;
    if (!currentModel) return null;

    const currentCandidate = buildCandidate(
        currentModel,
        input.estimatedInputTokens,
        input.currentSafeInputBudget
    );
    const alternatives = dedupeCandidates(buildProviderCandidates(input));

    if (!alternatives.length) return null;

    const sortedAlternatives = rankCandidates(alternatives).filter(candidate =>
        candidate.provider !== currentCandidate.provider || candidate.modelId !== currentCandidate.modelId
    );

    if (!sortedAlternatives.length) return null;

    const currentPassCount = Math.max(1, currentCandidate.expectedPassCount);
    const currentBehavior = buildCurrentBehaviorLabel(currentPassCount);

    let reasonCode: InquiryAdvisoryReasonCode | null = null;
    let suggestions: AdvisoryCandidate[] = [];

    // Citation-backed alternative recommendations are paused while inline
    // provider citations are disabled (see resolveCitationsEnabled). No
    // current provider would deliver a different result on this axis, so the
    // suggestion would just confuse the user. Re-enable alongside the
    // citations resolver when the path is restored.

    if (!reasonCode && currentPassCount > MIN_COMPELLING_SINGLE_PASS_GAIN) {
        suggestions = sortedAlternatives.filter(candidate =>
            candidate.expectedPassCount === 1
            && (currentPassCount - candidate.expectedPassCount) >= MIN_COMPELLING_SINGLE_PASS_GAIN
        );
        if (suggestions.length) {
            reasonCode = 'single_pass_preferred';
        }
    }

    if (!reasonCode
        && input.corpusFingerprintReused
        && currentCandidate.corpusReuseStatus !== 'available') {
        suggestions = sortedAlternatives.filter(candidate =>
            candidate.corpusReuseStatus === 'available'
            && candidate.expectedPassCount <= currentPassCount
        );
        if (suggestions.length) {
            reasonCode = 'cost_reuse_preferred';
        }
    }

    if (!reasonCode && isPrecisionAnalysisQuestion(input.questionText)) {
        suggestions = rankPrecisionCandidates(sortedAlternatives, currentCandidate);
        if (suggestions.length) {
            reasonCode = 'precision_analysis_preferred';
        }
    }

    const recommendationOptions = suggestions.map(toRecommendationOption);
    const primarySuggestion = suggestions[0];
    if (!reasonCode || !primarySuggestion || !recommendationOptions.length) return null;

    const advisory: InquiryAdvisoryContext = {
        version: INQUIRY_ADVISORY_CONTEXT_VERSION,
        createdAt: new Date().toISOString(),
        scope: input.scope,
        scopeLabel: input.scopeLabel,
        resolvedEngine: {
            provider: input.resolvedEngine.provider,
            providerLabel: input.resolvedEngine.providerLabel,
            modelId: input.resolvedEngine.modelId,
            modelAlias: input.resolvedEngine.modelAlias,
            modelLabel: input.resolvedEngine.modelLabel,
            contextWindow: input.resolvedEngine.contextWindow,
        },
        corpus: {
            estimatedInputTokens: input.estimatedInputTokens,
            expectedPassCount: currentPassCount,
            corpusFingerprint: input.corpusFingerprint,
            overrideSummary: {
                active: input.overrideSummary.active,
                classCount: input.overrideSummary.classCount,
                itemCount: input.overrideSummary.itemCount,
                total: input.overrideSummary.total,
            },
        },
        recommendation: {
            provider: primarySuggestion.provider,
            providerLabel: primarySuggestion.providerLabel,
            modelId: primarySuggestion.modelId,
            modelAlias: primarySuggestion.modelAlias,
            modelLabel: primarySuggestion.modelLabel,
            reasonCode,
            message: buildRecommendationMessage(reasonCode, recommendationOptions.length),
            currentEngineBehavior: currentBehavior,
            options: recommendationOptions
        },
    };

    if (input.previousContext && buildIdentity(input.previousContext) === buildIdentity(advisory)) {
        advisory.createdAt = input.previousContext.createdAt;
    }

    return advisory;
}
