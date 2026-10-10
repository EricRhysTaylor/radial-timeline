/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 */

import { Notice, type Vault } from 'obsidian';
import type RadialTimelinePlugin from '../main';
import { getSceneAnalysisJsonSchema, getSceneAnalysisSystemPrompt } from '../ai/prompts/sceneAnalysis';
import type { AIProviderId, AIRunRequest } from '../ai/types';
import type { AiProviderResponse, ParsedSceneAnalysis } from './types';
import { parsePulseAnalysisResponse } from './responseParsing';
import { getAIClient } from '../ai/runtime/aiClient';
import { getCanonicalAiSettings, resolveConfiguredSelection } from '../ai/runtime/runtimeSelection';
import {
    ensurePulseLogsRoot,
    extractTokenUsage,
    formatAiLogContent,
    formatSummaryLogContent,
    formatLogTimestamp,
    resolveAvailableLogPath,
    resolvePulseLogsRoot,
    sanitizeLogPayload,
    type AiLogStatus
} from '../ai/log';
import { ensurePulseContentLogFolder, resolvePulseContentLogFolder } from '../inquiry/utils/logs';
import { normalizePath } from 'obsidian';
import { t } from '../i18n';
import { buildPulseUsageReport } from './usage';
import type { PulseUsageObserver } from './RequestRunner';
import { describeAiRunModel } from '../utils/modelResolver';

type PulseLogPayload = {
    provider: Exclude<AIProviderId, 'none'>;
    modelRequested?: string;
    modelResolved?: string;
    requestPayload?: unknown;
    responseData?: unknown;
    parsed?: ParsedSceneAnalysis | null;
    status: AiLogStatus;
    systemPrompt?: string | null;
    userPrompt?: string | null;
    rawTextResult?: string | null;
    sceneName?: string;
    subplotName?: string | null;
    commandContext: string;
    tripletInfo?: { prev: string; current: string; next: string };
    submittedAt?: Date | null;
    returnedAt?: Date | null;
    retryCount?: number;
    normalizationWarnings?: string[];
    diagnostics?: unknown;
};

const sanitizeSegment = (value: string | null | undefined) => {
    if (!value) return '';
    return value
        .replace(/[<>:"/\\|?*]+/g, '-')
        .replace(/\s+/g, ' ')
        .replace(/-+/g, '-')
        .trim()
        .replace(/^-+|-+$/g, '');
};

const extractEvidenceText = (prompt: string): string => {
    const match = prompt.match(/(^|\n)Scene [^\n]+:\n/);
    if (!match || match.index === undefined) return '';
    const offset = match[1] ? match[1].length : 0;
    return prompt.slice(match.index + offset);
};

async function writePulseLog(
    plugin: RadialTimelinePlugin,
    vault: Vault,
    payload: PulseLogPayload
): Promise<void> {
    const timestampSource = payload.returnedAt ?? payload.submittedAt ?? new Date();
    const readableTimestamp = formatLogTimestamp(timestampSource);
    const sceneLabel = payload.sceneName?.trim() || 'Scene';
    const safeSceneLabel = sanitizeSegment(sceneLabel) || 'Scene';
    const logType = 'Pulse';

    const scopeBits = [`Scene ${sceneLabel}`];
    if (payload.subplotName) scopeBits.push(`Subplot ${payload.subplotName}`);
    if (payload.tripletInfo) {
        scopeBits.push(`Triplet ${payload.tripletInfo.prev}/${payload.tripletInfo.current}/${payload.tripletInfo.next}`);
    }
    if (payload.commandContext) scopeBits.push(`Command ${payload.commandContext}`);
    const scopeTarget = scopeBits.join(' · ');

    // `sanitizeLogPayload` must run before any disk write so logs never persist plaintext credentials.
    const { sanitized: sanitizedPayload, hadRedactions } = sanitizeLogPayload(payload.requestPayload ?? null);
    const tokenUsage = extractTokenUsage(payload.provider, payload.responseData);
    const sanitizedNotes = hadRedactions
        ? ['Redacted sensitive credential values from request payload.']
        : [];
    const durationMs = payload.submittedAt && payload.returnedAt
        ? payload.returnedAt.getTime() - payload.submittedAt.getTime()
        : null;

    const isError = payload.status === 'error';
    const shouldWriteContent = plugin.settings.logApiInteractions;

    // Content log is optional and must stay non-blocking for generation flow.
    let contentLogWritten = false;
    if (shouldWriteContent) {
        try {
            const contentFolder = await ensurePulseContentLogFolder(plugin.app);
            if (contentFolder) {
                const contentTitle = `${logType} Content Log — ${sceneLabel} ${readableTimestamp}`;
                const contentBaseName = `${logType} Content Log — ${safeSceneLabel} ${readableTimestamp}`;
                const evidenceText = payload.userPrompt ? extractEvidenceText(payload.userPrompt) : '';

                const contentLogContent = formatAiLogContent({
                    title: contentTitle,
                    metadata: {
                        feature: 'Pulse',
                        scopeTarget,
                        provider: payload.provider,
                        modelRequested: payload.modelRequested ?? 'unknown',
                        modelResolved: payload.modelResolved ?? 'unknown',
                        submittedAt: payload.submittedAt ?? null,
                        returnedAt: payload.returnedAt ?? null,
                        durationMs,
                        status: payload.status,
                        tokenUsage
                    },
                    request: {
                        systemPrompt: payload.systemPrompt ?? '',
                        userPrompt: payload.userPrompt ?? '',
                        evidenceText,
                        requestPayload: sanitizedPayload
                    },
                    response: {
                        rawResponse: payload.diagnostics
                            ? {
                                responseData: payload.responseData ?? null,
                                diagnostics: payload.diagnostics
                            }
                            : (payload.responseData ?? null),
                        assistantContent: payload.rawTextResult ?? '',
                        parsedOutput: payload.parsed ?? null
                    },
                    notes: {
                        sanitizationSteps: sanitizedNotes,
                        retryAttempts: payload.retryCount,
                        schemaWarnings: payload.normalizationWarnings
                    }
                });

                const contentFolderPath = resolvePulseContentLogFolder();
                const contentFilePath = resolveAvailableLogPath(vault, contentFolderPath, contentBaseName);
                await vault.create(contentFilePath, contentLogContent.trim());
                contentLogWritten = true;
            }
        } catch (e) {
            console.error('[Pulse][log] Failed to write content log:', sanitizeLogPayload(e).sanitized);
            // Non-blocking: continue with summary log.
        }
    }

    // Summary log is always attempted for AI runs.
    try {
        const summaryFolder = await ensurePulseLogsRoot(vault);
        if (!summaryFolder) {
            console.error('[Pulse][log] Log folder path is not a folder.');
            return;
        }
        const summaryFolderPath = normalizePath(resolvePulseLogsRoot());

        const summaryTitle = `${logType} Log — ${sceneLabel} ${readableTimestamp}`;
        const summaryBaseName = `${logType} Log — ${safeSceneLabel} ${readableTimestamp}`;

        const resultSummary = payload.status === 'success' && payload.parsed
            ? `Analysis complete.`
            : undefined;

        const summaryContent = formatSummaryLogContent({
            title: summaryTitle,
            feature: 'Pulse',
            scopeTarget,
            provider: payload.provider,
            modelRequested: payload.modelRequested ?? 'unknown',
            modelResolved: payload.modelResolved ?? 'unknown',
            submittedAt: payload.submittedAt ?? null,
            returnedAt: payload.returnedAt ?? null,
            durationMs,
            status: payload.status,
            tokenUsage,
            resultSummary,
            errorReason: isError ? (payload.rawTextResult || 'Unknown error.') : null,
            suggestedFixes: isError ? ['Retry or check API configuration.'] : undefined,
            contentLogWritten,
            retryAttempts: payload.retryCount
        });

        const summaryFilePath = resolveAvailableLogPath(vault, summaryFolderPath, summaryBaseName);
        await vault.create(summaryFilePath, summaryContent.trim());
    } catch (e) {
        console.error('[Pulse][log] Failed to write summary log:', sanitizeLogPayload(e).sanitized);
        // Non-blocking: logging failures should not break the AI run.
    }
}

/**
 * The Pulse (scene triplet) AI request for one triplet prompt. The API run
 * sends it; AI jobs compile the same request for an outside client.
 */
export function buildPulseRunRequest(userPrompt: string): AIRunRequest {
    return {
        feature: 'PulseAnalysis',
        task: 'ScenePulseTriplet',
        requiredCapabilities: ['jsonStrict', 'reasoningStrong'],
        featureModeInstructions: getSceneAnalysisSystemPrompt(),
        userInput: userPrompt,
        returnType: 'json',
        responseSchema: getSceneAnalysisJsonSchema(),
        // Every run regenerates and overwrites the scene's Pulse: RT's 2-minute
        // in-memory answer cache would hand a re-run the previous analysis
        // verbatim instead of the new one the author asked for.
        bypassInMemoryCache: true,
        overrides: {
            temperature: 0.1,
            maxOutputMode: 'high',
            reasoningDepth: 'deep',
            jsonStrict: true
        }
    };
}

export async function callAiProvider(
    plugin: RadialTimelinePlugin,
    vault: Vault,
    userPrompt: string,
    subplotName: string | null,
    commandContext: string,
    sceneName?: string,
    tripletInfo?: { prev: string; current: string; next: string },
    onUsage?: PulseUsageObserver,
    shouldAbort?: () => boolean
): Promise<AiProviderResponse> {
    const aiSettings = getCanonicalAiSettings(plugin);
    const selection = resolveConfiguredSelection(aiSettings, {
        feature: 'PulseAnalysis'
    });
    const provider = selection?.provider ?? aiSettings.provider;
    const aiClient = getAIClient(plugin);
    let responseDataForLog: unknown;
    let result: string | null = null;
    let submittedAt: Date | null = null;
    let returnedAt: Date | null = null;
    let runResult: Awaited<ReturnType<typeof aiClient.run>> | null = null;
    const systemPrompt = getSceneAnalysisSystemPrompt();
    let modelRequested: string | undefined;
    let modelResolved: string | undefined;
    const providerOverride = provider === 'none' ? undefined : provider;

    try {
        submittedAt = new Date();
        runResult = await aiClient.run({ ...buildPulseRunRequest(userPrompt), providerOverride, shouldAbort });
        returnedAt = new Date();

        responseDataForLog = runResult.responseData;
        result = runResult.content;
        modelRequested = runResult.modelRequested;
        modelResolved = runResult.modelResolved;
        const resolvedProvider = runResult.provider as PulseLogPayload['provider'];

        if (runResult.aiStatus !== 'success' || !runResult.content) {
            await writePulseLog(plugin, vault, {
                provider: resolvedProvider,
                modelRequested,
                modelResolved,
                requestPayload: runResult.requestPayload,
                responseData: responseDataForLog,
                parsed: null,
                status: 'error',
                systemPrompt,
                userPrompt,
                rawTextResult: runResult.content,
                sceneName,
                subplotName,
                commandContext,
                tripletInfo,
                submittedAt,
                returnedAt,
                retryCount: runResult.retryCount,
                diagnostics: runResult.diagnostics,
                normalizationWarnings: runResult.error ? [runResult.error] : undefined
            });
            throw new Error(runResult.error || t('sceneAnalysis.aiProvider.genericError', { provider: resolvedProvider }));
        }

        const parsedForLog = parsePulseAnalysisResponse(runResult.content, plugin);
        const parseFailure = !parsedForLog
            ? (plugin.lastAnalysisError.trim() || 'Pulse analysis response failed validation.')
            : null;
        await writePulseLog(plugin, vault, {
            provider: resolvedProvider,
            modelRequested,
            modelResolved,
            requestPayload: runResult.requestPayload,
            responseData: responseDataForLog,
            parsed: parsedForLog,
            status: parseFailure ? 'error' : 'success',
            systemPrompt,
            userPrompt,
            rawTextResult: runResult.content,
            sceneName,
            subplotName,
            commandContext,
            tripletInfo,
            submittedAt,
            returnedAt,
            retryCount: runResult.retryCount,
            diagnostics: runResult.diagnostics,
            normalizationWarnings: parseFailure ? [parseFailure] : undefined
        });
        if (parseFailure) {
            throw new Error(parseFailure);
        }

        return {
            result: runResult.content,
            parsedAnalysis: parsedForLog,
            attribution: describeAiRunModel(resolvedProvider, runResult.modelResolved || runResult.modelRequested),
            providerUsed: resolvedProvider,
            advancedContext: runResult.advancedContext
        };
    } catch (error) {
        const detailedMessage = error instanceof Error ? error.message : String(error);
        console.error(
            `[API][BeatsCommands][callAiProvider] Error during ${provider} API call:`,
            sanitizeLogPayload(error).sanitized
        );
        new Notice(t('sceneAnalysis.aiProvider.callError', { provider, detail: detailedMessage }), 8000);

        if (!submittedAt) submittedAt = new Date();
        if (!returnedAt) returnedAt = new Date();
        // No provider was configured and nothing ran: there is no provider to
        // attribute the failure to, so no Pulse log entry (the Notice above
        // already told the author). Never label it as some other provider.
        const logProvider: PulseLogPayload['provider'] | null = runResult
            ? (runResult.provider as PulseLogPayload['provider'])
            : (provider === 'none' ? null : provider);

        if (logProvider) {
            await writePulseLog(plugin, vault, {
                provider: logProvider,
                modelRequested,
                modelResolved,
                requestPayload: runResult?.requestPayload,
                responseData: responseDataForLog,
                parsed: null,
                status: 'error',
                systemPrompt,
                userPrompt,
                rawTextResult: result,
                sceneName,
                subplotName,
                commandContext,
                tripletInfo,
                submittedAt,
                returnedAt,
                retryCount: runResult?.retryCount,
                diagnostics: runResult?.diagnostics
            });
        }

        throw error instanceof Error ? error : new Error(String(error));
    } finally {
        // Report once per invocation, including paid responses that failed validation.
        onUsage?.(buildPulseUsageReport(runResult));
    }
}
