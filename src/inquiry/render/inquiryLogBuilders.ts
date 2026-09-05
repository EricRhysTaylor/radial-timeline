import type { InquiryEstimateSnapshot } from '../services/inquiryEstimateSnapshot';
import type { CorpusManifest, CorpusManifestEntry, InquiryRunTrace } from '../runner/types';
import type { InquiryResult } from '../state';
import type { SceneInclusion } from '../../types/settings';
import type { TokenTier } from '../types';
import { extractTokenUsage, formatActualUsageCost, formatAiLogContent, formatDuration, formatUsageCostBreakdownLines, sanitizeLogPayload, type AiLogStatus } from '../../ai/log';
import { describeTokenEstimateMethod } from '../../ai/tokens/inputTokenEstimate';
import { buildManifestTocLines, formatManifestClassLabel } from '../utils/inquiryViewText';
import { buildInquirySourcesViewModel } from '../services/inquirySources';
import { BUILTIN_MODELS } from '../../ai/registry/builtinModels';
import { getModelUiSignals } from '../../ai/caps/engineCapabilities';
import { CACHE_BREAK_DELIMITER } from '../../ai/prompts/composeEnvelope';
import { fnv1a32HexUnpadded } from '../../utils/hash';
import {
    buildLogOverrideLabel,
    buildLogSourceResultDetail,
    buildLogSuggestedFixes,
    buildLogUsageDetailParts,
    buildLogUsageText,
    describeLogCorpusMode,
    formatLogTokenCount,
    resolveLogFailureReason,
    resolveLogModelLabel,
    resolveLogProviderLabel,
    resolveLogStatusDetail,
    resolveLogStatusLabel
} from './inquiryLogFields';

/**
 * Extract the ACTUAL outgoing prompt text from the captured provider
 * request payload (not the scaffold `trace.userPrompt`, which OpenAI
 * never receives — see docs/engineering/audits/openai-cache-miss-rootcause.md).
 *
 * Supports:
 *  - OpenAI Responses shape: { input: [{ role, content: [{ text }] }] }
 *  - Legacy chat shape:      { messages: [{ role, content }] }
 * Returns null when the payload was not captured or is an unknown shape —
 * the caller must then say so explicitly and NOT fall back to the scaffold.
 */
function extractRequestPromptText(
    requestPayload: unknown
): { systemText: string; userText: string } | null {
    const payload = asRecord(requestPayload);
    if (!payload) return null;

    const readContent = (content: unknown): string => {
        if (typeof content === 'string') return content;
        if (Array.isArray(content)) {
            return content
                .map(part => {
                    const rec = asRecord(part);
                    return rec && typeof rec.text === 'string' ? rec.text : '';
                })
                .join('');
        }
        return '';
    };

    const collect = (entries: unknown): { systemText: string; userText: string } | null => {
        if (!Array.isArray(entries)) return null;
        let systemText = '';
        let userText = '';
        for (const entry of entries) {
            const rec = asRecord(entry);
            if (!rec) continue;
            const role = typeof rec.role === 'string' ? rec.role : '';
            const text = readContent(rec.content);
            if (role === 'system' || role === 'developer') systemText += text;
            else if (role === 'user') userText += text;
        }
        if (!systemText && !userText) return null;
        return { systemText, userText };
    };

    return collect(payload.input) ?? collect(payload.messages);
}

/** Stable, non-cryptographic FNV-1a hash for comparing prefixes across runs. */
function prefixFingerprint(text: string): string {
    return fnv1a32HexUnpadded(text);
}

function asRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' ? value as Record<string, unknown> : null;
}

function getNonEmptyString(record: Record<string, unknown> | null, key: string): string | null {
    const value = record?.[key];
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function formatCacheTransportDiagnostic(provider: string, requestPayload: unknown): string {
    const payload = asRecord(requestPayload);
    if (!payload) return '- Cache transport: request payload not captured';

    if (provider === 'openai') {
        const promptCacheKey = getNonEmptyString(payload, 'prompt_cache_key');
        return `- OpenAI prompt_cache_key: ${promptCacheKey ?? 'not present in request payload'}`; // SAFE: log diagnostic must explicitly say when captured payload lacks OpenAI cache key
    }

    if (provider === 'google') {
        const cachedContent = getNonEmptyString(payload, 'cachedContent');
        return `- Gemini cachedContent: ${cachedContent ?? 'not present in request payload'}`; // SAFE: log diagnostic must explicitly say when captured payload lacks Gemini cachedContent
    }

    if (provider === 'anthropic') {
        const dispatchDiagnostics = asRecord(payload.dispatchDiagnostics);
        const requestedCacheTtl = getNonEmptyString(dispatchDiagnostics, 'requestedCacheTtl');
        const cacheBoundaryIndex = dispatchDiagnostics?.cacheBoundaryIndex;
        const hasCacheBoundary = typeof cacheBoundaryIndex === 'number' && Number.isFinite(cacheBoundaryIndex) && cacheBoundaryIndex >= 0;
        if (hasCacheBoundary || (requestedCacheTtl && requestedCacheTtl !== 'none')) {
            return `- Anthropic cache_control: present${requestedCacheTtl ? ` · ttl=${requestedCacheTtl}` : ''}`;
        }
        return '- Anthropic cache_control: not present in request payload';
    }

    return '- Cache transport: not applicable for this provider';
}

type InquiryLogCostEstimateInput = {
    executionInputTokens: number;
    expectedOutputTokens: number;
    expectedPasses: number;
    cacheReuseRatio?: number;
};

export type InquiryLogBuilderDependencies = {
    getQuestionLabel: (result: InquiryResult) => string;
    getBriefModelLabel: (result: InquiryResult) => string | null;
    getFiniteTokenEstimateInput: (trace: InquiryRunTrace, result: InquiryResult) => number | null;
    getTokenTier: (inputTokens: number) => TokenTier;
    buildInquiryLogCostEstimateInput: (trace: InquiryRunTrace, result: InquiryResult) => InquiryLogCostEstimateInput | null;
    formatTokenUsageVisibility: (tokenUsageKnown?: boolean, tokenUsageScope?: InquiryResult['tokenUsageScope']) => string;
    isErrorResult: (result: InquiryResult) => boolean;
    isDegradedResult: (result: InquiryResult) => boolean;
    formatMetricDisplay: (value: number) => string;
    resolveManifestEntryLabel: (entry: CorpusManifestEntry) => string;
    normalizeEvidenceMode: (mode?: SceneInclusion) => 'excluded' | 'summary' | 'full';
    normalizeLegacyResult: (result: InquiryResult) => InquiryResult;
    resolveInquiryBriefZoneLabel: (result: InquiryResult) => string;
    resolveInquiryBriefLensLabel: (result: InquiryResult, zoneLabel: string) => string;
    formatInquiryIdFromResult: (result: InquiryResult) => string | null;
    pluginVersion: string;
    estimateSnapshot: InquiryEstimateSnapshot | null;
    /** Configured Gemini cache TTL (seconds); drives the cache-storage cost line. */
    geminiCacheTtlSeconds: number;
};

export function buildInquiryLogContent(args: {
    result: InquiryResult;
    trace: InquiryRunTrace;
    manifest: CorpusManifest | null;
    deps: InquiryLogBuilderDependencies;
    logTitle?: string;
    contentLogWritten?: boolean;
}): string {
    const { result, trace, manifest, deps } = args;
    const isSimulated = result.aiReason === 'simulated' || result.aiReason === 'stub';
    const questionLabel = deps.getQuestionLabel(result);
    const scopeLabel = result.scope === 'saga' ? 'Saga' : 'Book';
    const target = result.scopeLabel || (result.scope === 'saga' ? 'Σ' : '?');
    const providerRaw = result.aiProvider ? result.aiProvider.trim() : '';
    const providerLabel = resolveLogProviderLabel(providerRaw, isSimulated);
    const modelLabel = resolveLogModelLabel(result, deps.getBriefModelLabel(result), isSimulated);
    const durationMs = typeof result.roundTripMs === 'number' && Number.isFinite(result.roundTripMs)
        ? result.roundTripMs
        : null;
    const tokenEstimateInput = deps.getFiniteTokenEstimateInput(trace, result);
    const tokenTier = typeof tokenEstimateInput === 'number'
        ? deps.getTokenTier(tokenEstimateInput)
        : (result.tokenEstimateTier || null);
    const overrideSummary = result.corpusOverridesActive ? (result.corpusOverrideSummary ?? null) : null;
    const overrideLabel = buildLogOverrideLabel(overrideSummary, result.corpusOverridesActive ?? false);

    let status: AiLogStatus = 'success';
    const degraded = deps.isDegradedResult(result);
    if (isSimulated) {
        status = 'simulated';
    } else if (deps.isErrorResult(result)) {
        status = 'error';
    }
    const statusLabel = resolveLogStatusLabel(status, degraded);
    const statusDetail = resolveLogStatusDetail(result);

    const formatTokenCount = formatLogTokenCount;

    const usage = trace.usage
        ?? (trace.response?.responseData && result.aiProvider
            ? extractTokenUsage(result.aiProvider, trace.response.responseData)
            : null);
    const logCostEstimateInput = !isSimulated
        ? deps.buildInquiryLogCostEstimateInput(trace, result)
        : null;
    const usageKnown = typeof trace.tokenUsageKnown === 'boolean'
        ? trace.tokenUsageKnown
        : !!usage;
    const usageVisibility = deps.formatTokenUsageVisibility(usageKnown, trace.tokenUsageScope ?? result.tokenUsageScope);
    const usageDetailParts = buildLogUsageDetailParts(usage);
    const usageText = buildLogUsageText(usage);
    const cacheReuseLabel = trace.cacheReuseState
        ? trace.cacheReuseState.replace(/_/g, ' ')
        : null;
    const cachePrefixLabel = typeof trace.cachedStableRatio === 'number' && Number.isFinite(trace.cachedStableRatio)
        ? `${Math.round(trace.cachedStableRatio * 100)}%`
        : null;
    const cacheTokensLabel = typeof trace.cachedStableTokens === 'number' && Number.isFinite(trace.cachedStableTokens)
        ? formatTokenCount(trace.cachedStableTokens)
        : null;
    const anthropicDispatchNote = trace.notes?.find(note => note.startsWith('Anthropic dispatch:')) ?? null;
    const sourcesVM = buildInquirySourcesViewModel(result.citations, result.evidenceDocumentMeta, result.findings);
    const providerKey = (result.aiProvider || '').trim().toLowerCase();
    const resolvedModelKey = (result.aiModelResolved || result.aiModelRequested || '').trim().toLowerCase();
    const resolvedModel = BUILTIN_MODELS.find(model => (
        model.provider === providerKey
        && (model.id.toLowerCase() === resolvedModelKey || model.alias.toLowerCase() === resolvedModelKey)
    ));
    const citationSupportLabel = resolvedModel
        ? getModelUiSignals(resolvedModel).citationLabel
        : null;
    const sourceResultDetail = buildLogSourceResultDetail(sourcesVM);

    const describeMode = (className: string): string | null =>
        describeLogCorpusMode(manifest, className, deps.normalizeEvidenceMode);

    const buildCorpusSummary = (): string[] => {
        const summaryLines: string[] = [];
        if (!manifest) {
            summaryLines.push('- Corpus: unavailable');
            return summaryLines;
        }
        const counts = manifest.classCounts || {};
        const sceneCount = counts.scene ?? 0;
        const outlineCount = counts.outline ?? 0;
        const sceneMode = describeMode('scene');
        const outlineMode = describeMode('outline');
        summaryLines.push(`- Scenes: ${sceneCount}${sceneMode ? ` × ${sceneMode}` : ''}`);
        summaryLines.push(`- Outlines: ${outlineCount}${outlineMode ? ` × ${outlineMode}` : ''}`);

        const referenceParts: string[] = [];
        const priorityReferenceClasses = ['character', 'place', 'power'];
        const referenceClasses = [
            ...priorityReferenceClasses,
            ...Object.keys(counts)
                .filter(name => !['scene', 'outline', 'book', ...priorityReferenceClasses].includes(name))
                .sort((a, b) => a.localeCompare(b))
        ];
        referenceClasses.forEach(className => {
            const count = counts[className] ?? 0;
            if (!count) return;
            const label = className === 'character'
                ? 'Characters'
                : className === 'place'
                    ? 'Places'
                    : className === 'power'
                        ? 'Powers'
                        : formatManifestClassLabel(className);
            referenceParts.push(`${label} ${count}`);
        });
        summaryLines.push(`- Reference classes: ${referenceParts.length ? referenceParts.join(', ') : 'none'}`);

        const bookAnchorCount = counts.book ?? 0;
        if (bookAnchorCount > 0) {
            summaryLines.push(`- Saga book anchors: ${bookAnchorCount} (not sent as evidence)`);
        }

        return summaryLines;
    };

    const resolveFailureReason = (): string | null =>
        resolveLogFailureReason(result, trace, deps.isErrorResult);

    const buildSuggestedFixes = (): string[] =>
        buildLogSuggestedFixes(result, trace, deps.isErrorResult, resolveFailureReason);

    const costBreakdownLines = !isSimulated
        ? formatUsageCostBreakdownLines(
            result.aiProvider,
            result.aiModelResolved || result.aiModelRequested,
            usage,
            logCostEstimateInput,
            trace.cacheStatus,
            deps.geminiCacheTtlSeconds
        )
        : [];
    const actualUsageCostLabel = isSimulated
        ? 'not applicable'
        : formatActualUsageCost(result.aiProvider, result.aiModelResolved || result.aiModelRequested, usage, trace.cacheStatus);

    const lines: string[] = [];
    if (isSimulated) {
        lines.push('> Simulated test run. No provider request was sent.', '');
    }

    lines.push('## Run Summary');
    lines.push(`- Scope: ${scopeLabel} · ${target}`);
    lines.push(`- Question: ${questionLabel}`);
    lines.push(`- Provider / Model: ${providerLabel} · ${modelLabel}`);
    lines.push(`- Overrides: ${overrideLabel}`);
    lines.push(`- Status: ${statusLabel}${statusDetail}`);
    lines.push(`- Duration: ${formatDuration(durationMs)}`);
    lines.push(`- Actual usage cost: ${actualUsageCostLabel}`);
    if (!isSimulated && citationSupportLabel) {
        lines.push(`- Citation support: ${citationSupportLabel}`);
    }
    if (!isSimulated) {
        lines.push(`- Source results: ${sourceResultDetail}`);
    }
    if (!isSimulated && cacheReuseLabel) {
        const cacheSummaryParts = [`- Cache: ${cacheReuseLabel}`];
        if (trace.cacheStatus) cacheSummaryParts.push(`status=${trace.cacheStatus}`);
        if (cachePrefixLabel) cacheSummaryParts.push(`prefix=${cachePrefixLabel}`);
        if (cacheTokensLabel) cacheSummaryParts.push(`tokens=${cacheTokensLabel}`);
        if (usage && typeof usage.cacheReadInputTokens === 'number') {
            // On a 'created' run the cached-token count is the cache WRITTEN
            // this run, not read from a prior one — label it accordingly so the
            // log never reports a read that did not happen.
            const verb = trace.cacheStatus === 'created' ? 'write' : 'read';
            cacheSummaryParts.push(`${verb}=${formatTokenCount(usage.cacheReadInputTokens)}`);
        }
        lines.push(cacheSummaryParts.join(' · '));
    }
    lines.push('');

    if (costBreakdownLines.length) {
        lines.push(...costBreakdownLines);
    }

    lines.push('## Corpus Summary');
    lines.push(...buildCorpusSummary());
    lines.push('');

    lines.push('## Tokens');
    lines.push(`- Estimated input: ${formatTokenCount(tokenEstimateInput, true)}`);
    lines.push(`- Actual usage: ${isSimulated ? 'simulated run; not applicable' : usageText}`);
    lines.push(`- Usage visibility: ${isSimulated ? 'simulated' : usageVisibility}`);
    if (!isSimulated && usageDetailParts.length) {
        lines.push(`- Usage detail: ${usageDetailParts.join(', ')}`);
    }
    lines.push(`- Tier: ${tokenTier ?? 'unknown'}`);
    if (deps.estimateSnapshot) {
        lines.push(`- Pre-run estimate: ${formatTokenCount(deps.estimateSnapshot.estimate.estimatedInputTokens, true)} (${describeTokenEstimateMethod(deps.estimateSnapshot.estimate.estimationMethod)})`);
        lines.push(`- Per-pass planning budget: ${formatTokenCount(deps.estimateSnapshot.estimate.effectiveInputCeiling)}`);
        lines.push(`- Expected structured passes: ${deps.estimateSnapshot.estimate.expectedPassCount}`);
    }
    lines.push('');

    lines.push('## Execution');
    lines.push(`- Packaging: ${isSimulated ? 'Simulation only' : 'Automatic'}`);
    lines.push(`- Execution state: ${isSimulated ? 'simulated' : (trace.executionState ?? 'unknown')}`);
    lines.push(`- Execution path: ${isSimulated ? 'simulated' : (trace.executionPath ?? ((typeof trace.executionPassCount === 'number' && trace.executionPassCount > 1) ? 'multi_pass' : 'one_pass'))}`);
    lines.push(`- Failure stage: ${isSimulated ? 'none' : (trace.failureStage ?? (status === 'error' ? 'provider_response_parsing' : 'none'))}`);
    if (!isSimulated && cacheReuseLabel) {
        const cacheParts = [`- Cache reuse: ${cacheReuseLabel}`];
        if (trace.cacheStatus) cacheParts.push(`status=${trace.cacheStatus}`);
        if (cachePrefixLabel) cacheParts.push(`prefix=${cachePrefixLabel}`);
        if (cacheTokensLabel) cacheParts.push(`tokens=${cacheTokensLabel}`);
        lines.push(cacheParts.join(' · '));
    }
    if (!isSimulated && anthropicDispatchNote) {
        lines.push(`- ${anthropicDispatchNote}`);
    }
    if (typeof trace.executionPassCount === 'number' && trace.executionPassCount > 1) {
        lines.push(`- Pass count: ${trace.executionPassCount}`);
    }
    if (!isSimulated && trace.multiPassTriggerReason) {
        lines.push(`- Multi-pass trigger: ${trace.multiPassTriggerReason}`);
    }
    lines.push('');

    if (!isSimulated) {
        // Cache diagnostics are provider-specific. Avoid implying a transport was
        // unsupported when it simply is not used by this provider.
        const requestPayload = trace.requestPayload;
        const rawUsageRecord = trace.response?.responseData
            && typeof trace.response.responseData === 'object'
                ? (trace.response.responseData as { usage?: unknown }).usage
                : undefined;
        const rawUsageJson = rawUsageRecord !== undefined
            ? JSON.stringify(rawUsageRecord)
            : (usage ? 'not captured; normalized token usage available' : 'not captured');
        // DOCTRINE (Audit 4): the cacheable-prefix metric MUST be derived
        // from the real outgoing provider request payload, never from
        // trace.userPrompt (the scaffold variant OpenAI never receives).
        // If the payload was not captured we say so — no scaffold fallback.
        const promptText = extractRequestPromptText(requestPayload);
        lines.push('## Cache Diagnostics');
        lines.push(`- cacheReuseFingerprint: ${result.cacheReuseFingerprint ?? '(unset)'}`); // SAFE: log diagnostic, not analysis input
        lines.push(formatCacheTransportDiagnostic(result.aiProvider ?? '', requestPayload)); // SAFE: provider may be absent on malformed/error legacy logs
        if (promptText) {
            const { systemText, userText } = promptText;
            const breakIdx = userText.indexOf(CACHE_BREAK_DELIMITER);
            // OpenAI caches the serialized input prefix: system message
            // (always first) + user text up to the cache break.
            const userPrefix = breakIdx >= 0 ? userText.slice(0, breakIdx) : userText;
            const cacheablePrefix = systemText + userPrefix;
            const totalPromptChars = systemText.length + userText.length;
            lines.push(`- Cacheable prefix chars (real request, system + user up to ${breakIdx >= 0 ? 'cache break' : 'end'}): ${cacheablePrefix.length}`);
            lines.push(`- Cacheable prefix fingerprint: ${prefixFingerprint(cacheablePrefix)}`); // SAFE: stable hash for cross-run byte-diff; no payload content emitted
            lines.push(`- Outgoing prompt chars (system + user, total): ${totalPromptChars}`);
            lines.push(`- Cache break present in request: ${breakIdx >= 0 ? 'yes' : 'no'}`);
        } else {
            lines.push('- Cacheable prefix: request payload not captured — cannot measure (scaffold prompt is NOT a substitute)');
        }
        lines.push(`- Raw provider usage JSON: ${rawUsageJson}`);
        lines.push('');
    }

    lines.push('## Result');
    if (status === 'success') {
        lines.push(`- Verdict: Flow ${args.deps.formatMetricDisplay(result.verdict.flow)} · Depth ${args.deps.formatMetricDisplay(result.verdict.depth)}`);
    } else if (status === 'simulated') {
        lines.push('- Result: Simulated test run. The corpus was packaged and rendered locally, but no API request was sent.');
    } else {
        lines.push(`- Failure reason: ${resolveFailureReason() ?? 'Unknown failure.'}`);
    }
    lines.push('');

    // Internal audit of deterministically-repaired citations (malformed
    // ref_id → canonical id via label/path). Diagnostic only — these do NOT
    // drive the author-facing untrusted-evidence banner.
    if (result.citationRepairs && result.citationRepairs.length) {
        lines.push('## Citation Diagnostics');
        result.citationRepairs.forEach(repair => {
            lines.push(`- Repaired malformed ref "${repair.rawRef}" → canonical "${repair.canonicalRef}" via label/path.`);
        });
        lines.push('');
    }

    lines.push('## Suggested Fixes');
    buildSuggestedFixes().forEach(fix => {
        lines.push(`- ${fix}`);
    });
    lines.push('');

    lines.push('## Corpus TOC');
    lines.push(...buildManifestTocLines({
        manifestEntries: manifest?.entries,
        normalizeEvidenceMode: deps.normalizeEvidenceMode,
        resolveManifestEntryLabel: deps.resolveManifestEntryLabel
    }));
    lines.push('');

    lines.push(`Content Log: ${args.contentLogWritten ? 'written' : 'skipped'}`);
    lines.push('');

    return lines.join('\n');
}

export function buildInquiryContentLogContent(args: {
    result: InquiryResult;
    trace: InquiryRunTrace;
    manifest: CorpusManifest | null;
    deps: InquiryLogBuilderDependencies;
    logTitle?: string;
    normalizationNotes?: string[];
}): string {
    const { result, trace, manifest, deps } = args;
    const title = args.logTitle ?? 'Inquiry Content Log';
    const zoneLabel = deps.resolveInquiryBriefZoneLabel(result);
    const lensLabel = deps.resolveInquiryBriefLensLabel(result, zoneLabel);
    const scopeLabel = result.scope === 'saga' ? 'Saga' : 'Book';
    const target = result.scopeLabel || (result.scope === 'saga' ? 'Σ' : '?');
    const aiProvider = result.aiProvider || 'unknown';
    const aiModelRequested = result.aiModelRequested || 'unknown';
    const aiModelResolved = result.aiModelResolved || aiModelRequested;
    const aiModelNextRunOnly = typeof result.aiModelNextRunOnly === 'boolean' ? result.aiModelNextRunOnly : null;
    const submittedAt = result.submittedAt ? new Date(result.submittedAt) : null;
    const completedAt = result.completedAt ? new Date(result.completedAt) : null;
    const durationMs = typeof result.roundTripMs === 'number' && Number.isFinite(result.roundTripMs)
        ? result.roundTripMs
        : null;
    const inquiryId = deps.formatInquiryIdFromResult(result);
    const artifactId = result.runId
        ? `artifact-${result.runId}`
        : (inquiryId ? `artifact-${inquiryId}` : `artifact-${Date.now()}`);
    const tokenEstimateInput = deps.getFiniteTokenEstimateInput(trace, result);
    const tokenTier = typeof tokenEstimateInput === 'number'
        ? deps.getTokenTier(tokenEstimateInput)
        : (result.tokenEstimateTier || null);
    const overrideSummary = result.corpusOverridesActive ? result.corpusOverrideSummary : null;
    const overrideLabel = overrideSummary
        ? `on (classes=${overrideSummary.classCount}, items=${overrideSummary.itemCount})`
        : (result.corpusOverridesActive ? 'on' : 'none');

    let status: AiLogStatus = 'success';
    const degraded = deps.isDegradedResult(result);
    const isSimulated = result.aiReason === 'simulated' || result.aiReason === 'stub';
    if (isSimulated) {
        status = 'simulated';
    } else if (deps.isErrorResult(result)) {
        status = 'error';
    }

    const tokenUsage = trace.usage
        ?? (trace.response?.responseData ? extractTokenUsage(aiProvider, trace.response.responseData) : null);
    const logCostEstimateInput = !isSimulated
        ? deps.buildInquiryLogCostEstimateInput(trace, result)
        : null;
    const tokenUsageKnown = typeof trace.tokenUsageKnown === 'boolean'
        ? trace.tokenUsageKnown
        : !!tokenUsage;
    const tokenUsageVisibility = deps.formatTokenUsageVisibility(tokenUsageKnown, trace.tokenUsageScope ?? result.tokenUsageScope);
    const tokenUsageDetailParts = tokenUsage
        ? [
            typeof tokenUsage.rawInputTokens === 'number' ? `raw input=${tokenUsage.rawInputTokens}` : null,
            typeof tokenUsage.cacheReadInputTokens === 'number' ? `cache read=${tokenUsage.cacheReadInputTokens}` : null,
            typeof tokenUsage.cacheCreationInputTokens === 'number' ? `cache write=${tokenUsage.cacheCreationInputTokens}` : null
        ].filter((value): value is string => !!value)
        : [];
    const cacheDetailParts = [
        trace.cacheReuseState ? `reuse=${trace.cacheReuseState}` : null,
        trace.cacheStatus ? `status=${trace.cacheStatus}` : null,
        typeof trace.cachedStableRatio === 'number' && Number.isFinite(trace.cachedStableRatio)
            ? `prefix=${Math.round(trace.cachedStableRatio * 100)}%`
            : null,
        typeof trace.cachedStableTokens === 'number' && Number.isFinite(trace.cachedStableTokens)
            ? `cached stable tokens=${Math.round(trace.cachedStableTokens)}`
            : null
    ].filter((value): value is string => !!value);
    const { sanitized: sanitizedPayload, hadRedactions } = sanitizeLogPayload(trace.requestPayload ?? null);
    const redactionNotes = hadRedactions
        ? ['Redacted sensitive credential values from request payload.']
        : [];
    const sanitizationSteps = [...(trace.sanitizationNotes || []), ...redactionNotes].filter(Boolean);
    const schemaWarnings = [
        ...(trace.notes || []),
        ...(args.normalizationNotes || [])
    ].filter(Boolean);

    const contextLines = [
        '',
        '### Inquiry Context',
        `- Artifact ID: ${artifactId}`,
        `- Run ID: ${result.runId || 'unknown'}`,
        `- Plugin version: ${deps.pluginVersion}`,
        `- Corpus fingerprint: ${result.corpusFingerprint || 'unknown'}`,
        `- Corpus overrides: ${overrideLabel}`,
        `- Scope: ${result.scope || 'unknown'}`,
        `- Scope Label: ${result.scopeLabel || 'unknown'}`,
        `- Mode: ${result.mode || 'unknown'}`,
        `- Question ID: ${result.questionId || 'unknown'}`,
        `- Question zone: ${result.questionZone || 'unknown'}`,
        `- AI provider: ${isSimulated ? 'simulation' : (result.aiProvider || 'unknown')}`,
        `- AI model requested: ${isSimulated ? 'not applicable' : (result.aiModelRequested || 'unknown')}`,
        `- AI model resolved: ${isSimulated ? 'not applicable' : (result.aiModelResolved || 'unknown')}`,
        `- OpenAI transport lane: ${trace.openAiTransportLane || 'n/a'}`,
        `- AI next-run override: ${typeof result.aiModelNextRunOnly === 'boolean' ? String(result.aiModelNextRunOnly) : 'unknown'}`,
        `- Packaging: ${isSimulated ? 'simulated' : 'automatic'}`,
        `- AI status: ${degraded ? 'degraded' : (result.aiStatus || 'unknown')}`,
        `- AI reason: ${result.aiReason || 'none'}`,
        `- Execution state: ${isSimulated ? 'simulated' : (trace.executionState ?? 'unknown')}`,
        `- Execution path: ${isSimulated ? 'simulated' : (trace.executionPath ?? ((typeof trace.executionPassCount === 'number' && trace.executionPassCount > 1) ? 'multi_pass' : 'one_pass'))}`,
        `- Failure stage: ${isSimulated ? 'none' : (trace.failureStage ?? (status === 'error' ? 'provider_response_parsing' : 'none'))}`,
        `- Token usage visibility: ${isSimulated ? 'simulated' : tokenUsageVisibility}`,
        `- Submitted at (raw): ${result.submittedAt || 'unknown'}`,
        `- Returned at (raw): ${result.completedAt || 'unknown'}`,
        `- Round trip ms: ${typeof result.roundTripMs === 'number' ? String(result.roundTripMs) : 'unknown'}`,
        `- Token estimate input: ${typeof result.tokenEstimateInput === 'number' ? String(Math.round(result.tokenEstimateInput)) : 'unknown'}`,
        `- Token estimate tier: ${result.tokenEstimateTier || 'unknown'}`
    ];
    if (tokenUsageDetailParts.length) {
        contextLines.push(`- Token usage detail: ${tokenUsageDetailParts.join(', ')}`);
    }
    if (cacheDetailParts.length) {
        contextLines.push(`- Cache detail: ${cacheDetailParts.join(', ')}`);
    }
    if (typeof trace.executionPassCount === 'number' && trace.executionPassCount > 1) {
        contextLines.push(`- Execution pass count: ${trace.executionPassCount}`);
    }
    if (trace.multiPassTriggerReason) {
        contextLines.push(`- Multi-pass trigger reason: ${trace.multiPassTriggerReason}`);
    }
    if (manifest) {
        const counts = manifest.classCounts || {};
        const countList = Object.keys(counts)
            .map(key => `${key}:${counts[key] ?? 0}`)
            .sort()
            .join(', ');
        if (countList) {
            contextLines.push(`- Corpus counts: ${countList}`);
        }
    }
    contextLines.push('', '### Corpus TOC');
    buildManifestTocLines({
        manifestEntries: manifest?.entries,
        normalizeEvidenceMode: deps.normalizeEvidenceMode,
        resolveManifestEntryLabel: deps.resolveManifestEntryLabel
    }).forEach(line => contextLines.push(line));

    const logContent = formatAiLogContent({
        title,
        metadata: {
            feature: 'Inquiry',
            scopeTarget: `${scopeLabel} · ${target} · ${zoneLabel} · ${lensLabel}`,
            provider: aiProvider,
            modelRequested: aiModelRequested,
            modelResolved: aiModelResolved,
            modelNextRunOnly: aiModelNextRunOnly,
            estimatedInputTokens: tokenEstimateInput,
            tokenTier,
            submittedAt,
            returnedAt: completedAt,
            durationMs,
            status,
            tokenUsage
        },
        request: {
            systemPrompt: trace.systemPrompt,
            userPrompt: trace.userPrompt,
            evidenceText: trace.evidenceText,
            requestPayload: sanitizedPayload
        },
        response: {
            rawResponse: trace.response?.responseData ?? null,
            assistantContent: trace.response?.content ?? '',
            parsedOutput: deps.normalizeLegacyResult(result)
        },
        notes: {
            sanitizationSteps,
            retryAttempts: trace.retryCount,
            schemaWarnings
        }
    }, { jsonSpacing: 0, metadataExtras: contextLines });
    const costBreakdownLines = !isSimulated
        ? formatUsageCostBreakdownLines(
            aiProvider,
            aiModelResolved || aiModelRequested,
            tokenUsage,
            logCostEstimateInput,
            trace.cacheStatus,
            deps.geminiCacheTtlSeconds
        )
        : [];

    return costBreakdownLines.length
        ? `${logContent}\n${costBreakdownLines.join('\n')}\n`
        : `${logContent}\n`;
}
