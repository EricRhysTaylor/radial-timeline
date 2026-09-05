/*
 * Radial Timeline Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 *
 * The Inquiry and Gossamer request forecasts the AI settings capacity panel
 * shows: corpus size, prompt composition, and the provider-counted total
 * when an engine is selected.
 */

import type { App } from 'obsidian';
import type RadialTimelinePlugin from '../../main';
import type { AIProviderId, RTCorpusTokenBreakdown } from '../types';
import type { InquiryCurrentCorpusContext } from '../../inquiry/types';
import type { TokenEstimateMethod } from '../tokens/inputTokenEstimate';
import { estimateTokensFromChars, tokenEstimateFromMethod, type TokenEstimate } from '../estimates';
import { buildInquiryPromptParts, INQUIRY_ROLE_TEMPLATE_GUARDRAIL } from '../../inquiry/promptScaffold';
import { INQUIRY_CANONICAL_ESTIMATE_QUESTION } from '../../inquiry/constants';
import { buildInquiryJsonSchema } from '../../inquiry/jsonSchema';
import { buildOutputRulesText } from '../prompts/outputRules';
import { buildUnifiedBeatAnalysisPromptParts, getUnifiedBeatAnalysisJsonSchema } from '../prompts/unifiedBeatAnalysis';
import { resolveSelectedBeatModelFromSettings } from '../../utils/beatSystemState';
import { extractBeatOrder } from '../../utils/gossamer';
import { getSortedSceneFiles } from '../../utils/manuscript';
import { getActiveFrontmatterMappings } from '../../utils/frontmatter';
import { estimateGossamerTokens } from './estimateTokensFromVault';
import { estimateCorpusFromManifestEntries } from './manifestCorpusEstimate';

export type PromptRequestBreakdown = {
    requestTokens: number | null;
    roleTemplateTokens: number | null;
    instructionTokens: number | null;
    outputContractTokens: number | null;
    transformTokens: number | null;
};

export type FeatureForecast = {
    available: boolean;
    corpusTokens: number;
    /**
     * Provider-count estimate carrying provenance: 'provider_count' when the
     * count succeeded, 'unavailable' when it failed (never a misleading 0).
     */
    providerCount: TokenEstimate;
    sceneCount: number;
    outlineCount: number;
    referenceCount: number;
    breakdown: RTCorpusTokenBreakdown;
    promptBreakdown: PromptRequestBreakdown;
    expectedPassCount?: number;
};

export type VaultForecasts = { inquiry: FeatureForecast; gossamer: FeatureForecast };

export interface InquiryExecutionEstimate {
    estimatedTokens: number;
    method: TokenEstimateMethod;
    expectedPassCount?: number;
    maxOutputTokens?: number;
}

/** First sentence and the rest; the Gossamer instruction's lead is counted as the request. */
export function splitLeadSentence(text: string): { lead: string; remainder: string } {
    const trimmed = text.trim();
    if (!trimmed) return { lead: '', remainder: '' };
    const punctuationIndex = trimmed.search(/[.!?](\s|$)/);
    if (punctuationIndex === -1) return { lead: trimmed, remainder: '' };
    return {
        lead: trimmed.slice(0, punctuationIndex + 1).trim(),
        remainder: trimmed.slice(punctuationIndex + 1).trim()
    };
}

export async function forecastVaultFeatures(params: {
    plugin: RadialTimelinePlugin;
    app: App;
    corpus: InquiryCurrentCorpusContext | null;
    roleTemplatePrompt: string;
    engine?: { provider: AIProviderId; modelId: string };
    /** The canonical Inquiry execution estimate for the engine against the current corpus. */
    estimateInquiryExecution: (provider: AIProviderId, modelId: string) => Promise<InquiryExecutionEstimate | null | undefined>;
}): Promise<VaultForecasts> {
    const { plugin, app, corpus, engine } = params;
    const roleTemplateTokens = estimateTokensFromChars(params.roleTemplatePrompt.length);
    const inquiryPromptParts = buildInquiryPromptParts('');
    const inquiryRequestTokens = estimateTokensFromChars(INQUIRY_CANONICAL_ESTIMATE_QUESTION.length);
    const inquiryInstructionTokens = estimateTokensFromChars(
        inquiryPromptParts.systemPrompt.length
        + inquiryPromptParts.instructionText.length
        + INQUIRY_ROLE_TEMPLATE_GUARDRAIL.length
    );
    const inquiryOutputContractTokens = estimateTokensFromChars(
        inquiryPromptParts.schemaText.length
        + buildOutputRulesText({ returnType: 'json', responseSchema: buildInquiryJsonSchema() }).length
    );
    const inquiryExecutionEstimate = corpus && engine
        ? await params.estimateInquiryExecution(engine.provider, engine.modelId)
        : null;

    const sceneData = await plugin.getSceneData();
    const selectedBeatModel = resolveSelectedBeatModelFromSettings(plugin.settings);
    const beatOrder = extractBeatOrder(sceneData, selectedBeatModel);
    const beats = beatOrder.map((beatName, index) => ({ beatName, beatNumber: index + 1, idealRange: '0-100' }));
    const frontmatterMappings = getActiveFrontmatterMappings(plugin.settings);
    const gossamerEstimate = await estimateGossamerTokens({
        plugin,
        vault: app.vault,
        metadataCache: app.metadataCache,
        frontmatterMappings,
        provider: engine?.provider,
        modelId: engine?.modelId,
        beatSystem: selectedBeatModel || 'Save The Cat',
        beats
    });
    const { files: gossamerSceneFiles } = await getSortedSceneFiles(plugin);
    const gossamerPromptParts = beatOrder.length > 0
        ? buildUnifiedBeatAnalysisPromptParts('', beats, selectedBeatModel || 'Save The Cat')
        : { transformText: '', instructionText: '', prompt: '' };
    const gossamerPromptSplit = splitLeadSentence(gossamerPromptParts.instructionText);
    const gossamerOutputContractTokens = estimateTokensFromChars(
        buildOutputRulesText({ returnType: 'json', responseSchema: getUnifiedBeatAnalysisJsonSchema() }).length
    );
    const gossamerCorpus = await estimateCorpusFromManifestEntries({
        vault: app.vault,
        metadataCache: app.metadataCache,
        frontmatterMappings,
        entries: gossamerSceneFiles.map(file => ({
            path: file.path,
            mtime: file.stat?.mtime ?? Date.now(),
            class: 'scene',
            mode: 'full',
            isTarget: false
        }))
    });

    return {
        inquiry: {
            available: Boolean(corpus),
            corpusTokens: corpus?.corpus.estimatedTokens ?? 0,
            providerCount: tokenEstimateFromMethod(inquiryExecutionEstimate?.method, inquiryExecutionEstimate?.estimatedTokens),
            sceneCount: corpus?.corpus.sceneCount ?? 0,
            outlineCount: corpus?.corpus.outlineCount ?? 0,
            referenceCount: corpus?.corpus.referenceCount ?? 0,
            breakdown: corpus?.corpus.breakdown ?? { scenesTokens: 0, outlineTokens: 0, referenceTokens: 0 },
            promptBreakdown: {
                requestTokens: inquiryRequestTokens,
                roleTemplateTokens,
                instructionTokens: inquiryInstructionTokens,
                outputContractTokens: inquiryOutputContractTokens,
                transformTokens: 0
            },
            expectedPassCount: inquiryExecutionEstimate?.expectedPassCount ?? corpus?.expectedPassCount ?? 1
        },
        gossamer: {
            available: true,
            corpusTokens: gossamerCorpus.estimatedTokens,
            providerCount: tokenEstimateFromMethod(
                gossamerEstimate.providerExecutionEstimate.method,
                gossamerEstimate.providerExecutionEstimate.estimatedTokens
            ),
            sceneCount: gossamerCorpus.sceneCount,
            outlineCount: gossamerCorpus.outlineCount,
            referenceCount: gossamerCorpus.referenceCount,
            breakdown: gossamerCorpus.breakdown,
            promptBreakdown: {
                requestTokens: estimateTokensFromChars(gossamerPromptSplit.lead.length),
                roleTemplateTokens,
                instructionTokens: estimateTokensFromChars(gossamerPromptSplit.remainder.length),
                outputContractTokens: gossamerOutputContractTokens,
                transformTokens: estimateTokensFromChars(gossamerPromptParts.transformText.length)
            }
        }
    };
}
