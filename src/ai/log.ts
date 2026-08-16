/*
 * Unified AI exchange logging
 */
import type RadialTimelinePlugin from '../main';
import { normalizePath, Notice, type Vault, TFile, TFolder } from 'obsidian';
import { redactSensitiveObject, redactSensitiveValue } from './credentials/redactSensitive';
import { getModelDisplayName } from '../utils/modelResolver';
import {
    type CorpusCostEstimate,
    estimateCacheStorageCost,
    estimateCorpusCost,
    estimateUsageCost,
    formatExactUsdCost
} from './cost/estimateCorpusCost';
import { getActivePricingTable } from './cost/providerPricing';
import { type TokenUsage } from './usage/providerUsage';
import { systemFolderPath } from '../utils/systemFolder';

export { extractTokenUsage, type TokenUsage } from './usage/providerUsage';

/** Combined Anthropic-style cache-write tokens (explicit field, else 5m+1h split). */
function resolveCacheWriteTokens(usage: TokenUsage): number {
    return usage.cacheCreationInputTokens
        ?? ((usage.cacheCreation5mInputTokens ?? 0) + (usage.cacheCreation1hInputTokens ?? 0));
}

/**
 * One-line token usage, with cache read/write appended when the provider
 * reported cache activity. `inputTokens` is the billed total (fresh + cache
 * read + cache write) per extractTokenUsage, so the cache figures are a
 * breakdown of it, not extra tokens.
 */
export function formatTokenUsageLine(usage?: TokenUsage | null): string {
    if (!usage || (usage.inputTokens === undefined && usage.outputTokens === undefined && usage.totalTokens === undefined)) {
        return 'not available';
    }
    const parts = [
        `input=${usage.inputTokens ?? 'unavailable'}`,
        `output=${usage.outputTokens ?? 'unavailable'}`,
        `total=${usage.totalTokens ?? 'unavailable'}`
    ];
    const cacheRead = usage.cacheReadInputTokens ?? 0;
    const cacheWrite = resolveCacheWriteTokens(usage);
    if (cacheRead > 0) parts.push(`cache read=${cacheRead}`);
    if (cacheWrite > 0) parts.push(`cache write=${cacheWrite}`);
    return parts.join(', ');
}

/**
 * Provider-cache provenance for a run, derived solely from the usage payload:
 * HIT (prefix reused this run), CREATED (prefix cached for the next run), or
 * none. Lets a reader answer "did the cache work?" without inferring from cost.
 */
export function formatCacheStatusLine(usage?: TokenUsage | null): string {
    if (!usage) return 'unavailable';
    const cacheRead = usage.cacheReadInputTokens ?? 0;
    const cacheWrite = resolveCacheWriteTokens(usage);
    const billedInput = usage.inputTokens ?? 0;
    if (cacheRead > 0) {
        const pct = billedInput > 0 ? Math.round((cacheRead / billedInput) * 100) : 0;
        return `HIT — ${cacheRead.toLocaleString()} input tokens reused (${pct}% of billed input)`;
    }
    if (cacheWrite > 0) {
        return `CREATED — ${cacheWrite.toLocaleString()} input tokens cached for reuse by the next run`;
    }
    return 'none — no provider cache read or write on this run';
}

export type AiLogFeature = 'Inquiry' | 'Pulse' | 'Synopsis' | 'Gossamer';
export type AiLogStatus = 'success' | 'error' | 'simulated';

export type AiLogRequest = {
    systemPrompt?: string | null;
    userPrompt?: string | null;
    evidenceText?: string | null;
    requestPayload?: unknown;
};

export type AiLogResponse = {
    rawResponse?: unknown;
    assistantContent?: string | null;
    parsedOutput?: unknown;
};

export type AiLogNotes = {
    sanitizationSteps?: string[];
    retryAttempts?: number;
    schemaWarnings?: string[];
};

export type AiLogEnvelope = {
    title: string;
    metadata: {
        feature: AiLogFeature;
        scopeTarget?: string | null;
        provider?: string | null;
        modelRequested?: string | null;
        modelResolved?: string | null;
        modelNextRunOnly?: boolean | null;
        estimatedInputTokens?: number | null;
        tokenTier?: string | null;
        submittedAt?: Date | null;
        returnedAt?: Date | null;
        durationMs?: number | null;
        status: AiLogStatus;
        tokenUsage?: TokenUsage | null;
    };
    request: AiLogRequest;
    response: AiLogResponse;
    notes: AiLogNotes;
    derivedSummary?: string | null;
};

export type SummaryLogEnvelope = {
    title: string;
    feature: AiLogFeature;
    scopeTarget?: string | null;
    provider?: string | null;
    modelRequested?: string | null;
    modelResolved?: string | null;
    submittedAt?: Date | null;
    returnedAt?: Date | null;
    durationMs?: number | null;
    status: AiLogStatus;
    tokenUsage?: TokenUsage | null;
    resultSummary?: string | null;
    errorReason?: string | null;
    suggestedFixes?: string[];
    contentLogWritten: boolean;
    retryAttempts?: number;
};

export type UsageCostBreakdown = {
    inputTokens?: number;
    outputTokens?: number;
    rawInputTokens?: number;
    cacheReadInputTokens?: number;
    cacheCreationInputTokens?: number;
    cacheCreation5mInputTokens?: number;
    cacheCreation1hInputTokens?: number;
    rawInputCostUSD?: number;
    cacheReadCostUSD?: number;
    cacheCreationCostUSD?: number;
    inputCostUSD?: number;
    outputCostUSD?: number;
    totalCostUSD?: number;
};

const DEFAULT_LOGS_ROOT = systemFolderPath('Logs');
// Recovery data (snapshots + Gossamer Archive) lives OUTSIDE the Logs tree so
// the author can purge Logs at any time without losing the materials needed to
// reconstruct deleted or overwritten note data.
const DEFAULT_RECOVER_ROOT = systemFolderPath('Recover');
const CONTENT_LOGS_FOLDER_NAME = 'Content';
const INQUIRY_LOGS_FOLDER_NAME = 'Inquiry';
const GOSSAMER_LOGS_FOLDER_NAME = 'Gossamer';
const GOSSAMER_ARCHIVE_FOLDER_NAME = 'Gossamer Archive';
const PULSE_LOGS_FOLDER_NAME = 'Pulse';
const MOVES_LOGS_FOLDER_NAME = 'Moves';
const SNAPSHOTS_LOGS_FOLDER_NAME = 'Snapshots';

function normalizePricingProvider(provider?: string | null): 'anthropic' | 'openai' | 'google' | null {
    const normalized = typeof provider === 'string' ? provider.trim().toLowerCase() : '';
    if (normalized === 'anthropic') return 'anthropic';
    if (normalized === 'openai') return 'openai';
    if (normalized === 'google') return 'google';
    return null;
}

export function buildUsageCostBreakdown(
    provider: string | null | undefined,
    modelId: string | null | undefined,
    usage?: TokenUsage | null,
    cacheProvenance?: 'hit' | 'created'
): UsageCostBreakdown | null {
    if (!usage) return null;
    const pricingProvider = normalizePricingProvider(provider);
    if (!pricingProvider || !modelId) return null;
    if (!getActivePricingTable()[pricingProvider]?.[modelId]) return null;
    return estimateUsageCost(pricingProvider, modelId, usage, cacheProvenance);
}

export interface LogCostEstimateInput {
    executionInputTokens: number;
    expectedOutputTokens: number;
    expectedPasses: number;
    cacheReuseRatio?: number;
}

function formatDeltaPercent(estimated: number, actual: number): string {
    if (!Number.isFinite(estimated) || !Number.isFinite(actual) || actual === 0) return 'unavailable';
    const deltaPct = ((estimated - actual) / actual) * 100;
    return `${deltaPct >= 0 ? '+' : ''}${deltaPct.toFixed(1)}%`;
}

export function formatUsageCostBreakdownLines(
    provider: string | null | undefined,
    modelId: string | null | undefined,
    usage?: TokenUsage | null,
    estimateInput?: LogCostEstimateInput | null,
    cacheProvenance?: 'hit' | 'created',
    /**
     * TTL (seconds) the run requested when priming a provider cache that bills
     * storage by the hour (Gemini). Used to surface the separate cache-storage
     * charge; ignored for providers without a storage rate.
     */
    cacheStorageTtlSeconds?: number
): string[] {
    const breakdown = buildUsageCostBreakdown(provider, modelId, usage, cacheProvenance);
    const pricingProvider = normalizePricingProvider(provider);
    let estimate: CorpusCostEstimate | null = null;
    if (pricingProvider && modelId && estimateInput) {
        try {
            estimate = estimateCorpusCost(
                pricingProvider,
                modelId,
                estimateInput.executionInputTokens,
                estimateInput.expectedOutputTokens,
                estimateInput.expectedPasses,
                {
                    cacheReuseRatio: estimateInput.cacheReuseRatio,
                    // Match the priming-pass TTL the run actually requested
                    // (Anthropic Inquiry runs always use 1h).
                    ...(pricingProvider === 'anthropic' ? { cacheWriteTtl: '1h' as const } : {})
                }
            );
        } catch {
            estimate = null;
        }
    }
    if (!breakdown && !estimate) return [];

    const formatTokenCount = (value?: number): string => {
        if (typeof value !== 'number' || !Number.isFinite(value)) return 'unavailable';
        return `~${Math.round(value).toLocaleString()} tokens`;
    };
    const formatCost = (value?: number): string => {
        if (typeof value !== 'number' || !Number.isFinite(value)) return 'unavailable';
        return formatExactUsdCost(value);
    };
    // On a 'created' run the provider's "cached" token count is the cache
    // that was WRITTEN this run, not read from a prior one (Gemini reports
    // cachedContentTokenCount on the creating call too). Attribute it to the
    // write line so the log can't claim a read that never happened.
    const cacheWriteTokens = typeof breakdown?.cacheCreationInputTokens === 'number'
        ? breakdown.cacheCreationInputTokens
        : (cacheProvenance === 'created' ? breakdown?.cacheReadInputTokens : undefined);
    const cacheReadTokens = cacheProvenance === 'created' ? undefined : breakdown?.cacheReadInputTokens;
    const lines = [
        '## Cost Breakdown',
        `- Billed input total: ${formatTokenCount(breakdown?.inputTokens)}`,
        `- Raw input: ${formatTokenCount(breakdown?.rawInputTokens)}`,
        `- Cache read: ${formatTokenCount(cacheReadTokens)}`,
        `- Cache write: ${formatTokenCount(cacheWriteTokens)}`,
        `- Output: ${formatTokenCount(breakdown?.outputTokens)}`,
        '',
        `- Estimated fresh: ${formatCost(estimate?.freshCostUSD)}`,
        `- Estimated cached: ${formatCost(estimate?.cachedCostUSD)}`,
        `- Actual usage cost: ${formatCost(breakdown?.totalCostUSD)}`
    ];
    // Cache storage is billed separately by the hour for the cache's whole TTL
    // (Gemini), independent of token reads — surface it so the run's true cost
    // isn't understated by what the provider's usage JSON omits.
    const storedCacheTokens = typeof cacheWriteTokens === 'number'
        ? cacheWriteTokens
        : (typeof cacheReadTokens === 'number' ? cacheReadTokens : undefined);
    if (
        pricingProvider
        && modelId
        && typeof storedCacheTokens === 'number'
        && typeof cacheStorageTtlSeconds === 'number'
    ) {
        const storage = estimateCacheStorageCost(pricingProvider, modelId, storedCacheTokens, cacheStorageTtlSeconds);
        if (storage) {
            const windowLabel = storage.ttlSeconds % 60 === 0
                ? `${storage.ttlSeconds / 60}m`
                : `${storage.ttlSeconds}s`;
            lines.push(
                `- Cache storage (billed separately): ${formatCost(storage.costUSD)} · ${formatTokenCount(storedCacheTokens)} held for ${windowLabel} @ $${storage.ratePer1MPerHour.toFixed(2)}/1M/hr`,
                `  Provider charges cache storage by the hour for the full TTL — NOT included in "Actual usage cost" above.`
            );
        }
    }
    if (
        estimate
        && typeof breakdown?.totalCostUSD === 'number'
        && Number.isFinite(breakdown.totalCostUSD)
    ) {
        // A 'created' run paid the fresh (creation) price even though the
        // provider reported cached tokens — compare against the fresh estimate,
        // not the cached one. Only a genuine reuse hit compares against cached.
        const reusedThisRun = cacheProvenance !== 'created'
            && typeof breakdown?.cacheReadInputTokens === 'number'
            && breakdown.cacheReadInputTokens > 0;
        const estimatedEffectiveCost = reusedThisRun
            ? estimate.cachedCostUSD
            : estimate.freshCostUSD;
        if (typeof estimatedEffectiveCost === 'number' && Number.isFinite(estimatedEffectiveCost)) {
            lines.push('');
            lines.push('## Cost Accuracy');
            lines.push(`- Estimated: ${formatCost(estimatedEffectiveCost)}`);
            lines.push(`- Actual usage cost: ${formatCost(breakdown.totalCostUSD)}`);
            lines.push(`- Delta: ${formatDeltaPercent(estimatedEffectiveCost, breakdown.totalCostUSD)}`);
        }
    }
    lines.push('');
    return lines;
}

export function formatActualUsageCost(
    provider: string | null | undefined,
    modelId: string | null | undefined,
    usage?: TokenUsage | null,
    cacheProvenance?: 'hit' | 'created'
): string {
    const breakdown = buildUsageCostBreakdown(provider, modelId, usage, cacheProvenance);
    const cost = breakdown?.totalCostUSD;
    return typeof cost === 'number' && Number.isFinite(cost)
        ? formatExactUsdCost(cost)
        : 'unavailable';
}

export function sanitizeLogPayload(value: unknown): { sanitized: unknown; hadRedactions: boolean } {
    const sanitized = redactSensitiveObject(value);
    let hadRedactions = false;
    try {
        hadRedactions = JSON.stringify(value) !== JSON.stringify(sanitized);
    } catch {
        hadRedactions = true;
    }
    return { sanitized, hadRedactions };
}

export function formatLogTimestamp(date: Date, options?: { includeSeconds?: boolean }): string {
    if (!Number.isFinite(date.getTime())) return 'Unknown date';
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const month = months[date.getMonth()];
    const day = date.getDate();
    const year = date.getFullYear();
    let hours = date.getHours();
    const minutes = date.getMinutes();
    const seconds = date.getSeconds();
    const am = hours < 12;
    hours = hours % 12;
    if (hours === 0) hours = 12;
    const minuteText = String(minutes).padStart(2, '0');
    const includeSeconds = options?.includeSeconds ?? false;
    const secondText = includeSeconds ? `.${String(seconds).padStart(2, '0')}` : '';
    return `${month} ${day} ${year} @ ${hours}.${minuteText}${secondText}${am ? 'am' : 'pm'}`;
}

export function formatLocalAndIso(date?: Date | null): string {
    if (!date || !Number.isFinite(date.getTime())) return 'unknown';
    const local = formatLogTimestamp(date, { includeSeconds: true });
    return `${local} (${date.toISOString()})`;
}

export function formatDuration(ms?: number | null): string {
    if (typeof ms !== 'number' || !Number.isFinite(ms)) return 'unknown';
    if (ms < 1000) return `${Math.round(ms)}ms`;
    const seconds = ms / 1000;
    const rounded = seconds >= 10 ? seconds.toFixed(1) : seconds.toFixed(2);
    return `${rounded.replace(/\.0+$/, '')}s (${Math.round(ms)}ms)`;
}

export function formatAiLogContent(
    envelope: AiLogEnvelope,
    options?: { jsonSpacing?: number; metadataExtras?: string[] }
): string {
    const lines: string[] = [];
    const normalizeText = (value?: string | null) => value && value.trim() ? value : 'N/A';
    const formatList = (items?: string[]) => items && items.length ? items.join('; ') : 'None.';
    const formatRetries = (count?: number) => typeof count === 'number' ? String(count) : 'None.';
    const formatUsage = (usage?: TokenUsage | null) => formatTokenUsageLine(usage);
    const formatNextRunOnly = (value?: boolean | null) => {
        if (value === true) return 'true';
        if (value === false) return 'false';
        return 'unknown';
    };
    const formatTokenEstimate = (value?: number | null) => {
        if (typeof value !== 'number' || !Number.isFinite(value)) return 'unknown';
        return Math.round(value).toString();
    };
    const formatTokenTier = (value?: string | null) => {
        if (!value) return 'unknown';
        return value;
    };
    const jsonSpacing = typeof options?.jsonSpacing === 'number' ? options.jsonSpacing : 2;
    const safeStringify = (value: unknown) => {
        if (value === undefined) return 'undefined';
        const redactedValue = redactSensitiveObject(value);
        try {
            return JSON.stringify(redactedValue, null, jsonSpacing);
        } catch {
            // JSON.stringify only throws for circular objects and BigInt values.
            const fallbackText = typeof redactedValue === 'bigint'
                ? String(redactedValue)
                : '[unserializable object]';
            return JSON.stringify(redactSensitiveValue(fallbackText));
        }
    };
    const resolveExpectedSchema = (payload: unknown): { source: string; schema: unknown } | null => {
        if (!payload || typeof payload !== 'object') return null;
        const data = payload as Record<string, unknown>;
        const responseFormat = data.response_format ?? data.responseFormat;
        if (responseFormat && typeof responseFormat === 'object') {
            const format = responseFormat as Record<string, unknown>;
            if (format.type === 'json_schema' && format.json_schema) {
                return { source: 'response_format.json_schema', schema: format.json_schema };
            }
            return { source: 'response_format', schema: format };
        }
        const generationConfig = data.generationConfig;
        if (generationConfig && typeof generationConfig === 'object') {
            const config = generationConfig as Record<string, unknown>;
            if (config.responseSchema) {
                return { source: 'generationConfig.responseSchema', schema: config.responseSchema };
            }
            if (config.response_schema) {
                return { source: 'generationConfig.response_schema', schema: config.response_schema };
            }
        }
        return null;
    };
    const metadataExtras = options?.metadataExtras ?? [];
    const formatModel = (modelId?: string | null): string => {
        if (!modelId) return 'unknown';
        return getModelDisplayName(modelId, { debug: true });
    };
    const modelRequestedDisplay = formatModel(envelope.metadata.modelRequested);
    const modelResolvedDisplay = formatModel(envelope.metadata.modelResolved);

    lines.push('## Run Metadata');
    lines.push(`- Feature: ${envelope.metadata.feature}`);
    lines.push(`- Scope / Target: ${envelope.metadata.scopeTarget ?? 'unknown'}`);
    lines.push(`- Provider: ${envelope.metadata.provider ?? 'unknown'}`);
    lines.push(`- Model requested / resolved: ${modelRequestedDisplay} / ${modelResolvedDisplay}`);
    if (envelope.metadata.feature === 'Inquiry') {
        lines.push(`- Next-run override: ${formatNextRunOnly(envelope.metadata.modelNextRunOnly)}`);
        lines.push(`- Estimated input tokens: ${formatTokenEstimate(envelope.metadata.estimatedInputTokens)}`);
        lines.push(`- Input token tier: ${formatTokenTier(envelope.metadata.tokenTier)}`);
    }
    lines.push(`- Submitted: ${formatLocalAndIso(envelope.metadata.submittedAt)}`);
    lines.push(`- Returned: ${formatLocalAndIso(envelope.metadata.returnedAt)}`);
    lines.push(`- Duration: ${formatDuration(envelope.metadata.durationMs)}`);
    lines.push(`- Status: ${envelope.metadata.status}`);
    lines.push(`- Token usage: ${formatUsage(envelope.metadata.tokenUsage)}`);
    if (metadataExtras.length) {
        lines.push(...metadataExtras);
    }
    lines.push('');

    lines.push('## Prompts');
    lines.push('### System prompt');
    lines.push('```text');
    lines.push(normalizeText(envelope.request.systemPrompt));
    lines.push('```', '');
    lines.push('### User prompt');
    lines.push('```text');
    lines.push(normalizeText(envelope.request.userPrompt));
    lines.push('```', '');

    lines.push('## Expected response schema');
    const expectedSchema = resolveExpectedSchema(envelope.request.requestPayload);
    if (expectedSchema) {
        lines.push('```json');
        lines.push(safeStringify(expectedSchema.schema));
        lines.push('```', '');
    } else {
        lines.push('None.', '');
    }

    lines.push('## AI Response');
    lines.push('### Raw provider response JSON');
    lines.push('```json');
    lines.push(safeStringify(envelope.response.rawResponse));
    lines.push('```', '');
    lines.push('### Extracted assistant content');
    lines.push('```text');
    lines.push(normalizeText(envelope.response.assistantContent));
    lines.push('```', '');
    lines.push('### Parsed output JSON');
    lines.push('```json');
    lines.push(safeStringify(envelope.response.parsedOutput));
    lines.push('```', '');

    if (envelope.derivedSummary && envelope.derivedSummary.trim()) {
        lines.push('### Derived summary');
        lines.push(envelope.derivedSummary.trim(), '');
    }

    lines.push('## Notes / normalization');
    lines.push(`- Sanitization steps: ${formatList(envelope.notes.sanitizationSteps)}`);
    lines.push(`- Retry attempts: ${formatRetries(envelope.notes.retryAttempts)}`);
    lines.push(`- Schema normalization warnings: ${formatList(envelope.notes.schemaWarnings)}`);
    lines.push('');

    lines.push('## Materials / Evidence sent to AI');
    lines.push('### API request payload JSON');
    lines.push('```json');
    lines.push(safeStringify(envelope.request.requestPayload));
    lines.push('```', '');
    lines.push('### Materials/Evidence text');
    lines.push('```text');
    lines.push(normalizeText(envelope.request.evidenceText));
    lines.push('```');

    return lines.join('\n');
}

export function formatSummaryLogContent(envelope: SummaryLogEnvelope): string {
    const lines: string[] = [];
    const formatModel = (modelId?: string | null): string => {
        if (!modelId) return 'unknown';
        return getModelDisplayName(modelId, { debug: true });
    };
    const modelRequestedDisplay = formatModel(envelope.modelRequested);
    const modelResolvedDisplay = formatModel(envelope.modelResolved);

    const formatUsage = (usage?: TokenUsage | null) => formatTokenUsageLine(usage);

    const formatRetries = (count?: number) => typeof count === 'number' ? String(count) : '0';

    lines.push('## Run Summary');
    lines.push(`- Feature: ${envelope.feature}`);
    lines.push(`- Scope / Target: ${envelope.scopeTarget ?? 'unknown'}`);
    lines.push(`- Provider: ${envelope.provider ?? 'unknown'}`);
    lines.push(`- Model requested / resolved: ${modelRequestedDisplay} / ${modelResolvedDisplay}`);
    lines.push(`- Submitted: ${formatLocalAndIso(envelope.submittedAt)}`);
    lines.push(`- Returned: ${formatLocalAndIso(envelope.returnedAt)}`);
    lines.push(`- Duration: ${formatDuration(envelope.durationMs)}`);
    lines.push(`- Status: ${envelope.status}`);
    lines.push(`- Token usage: ${formatUsage(envelope.tokenUsage)}`);
    lines.push(`- Cache: ${formatCacheStatusLine(envelope.tokenUsage)}`);
    lines.push(`- Actual usage cost: ${formatActualUsageCost(envelope.provider, envelope.modelResolved ?? envelope.modelRequested, envelope.tokenUsage)}`);
    lines.push(`- Retry attempts: ${formatRetries(envelope.retryAttempts)}`);
    lines.push('');

    if (envelope.status === 'error') {
        lines.push('## Failure Reason');
        lines.push(envelope.errorReason ?? 'Unknown failure.');
        lines.push('');
        if (envelope.suggestedFixes && envelope.suggestedFixes.length) {
            lines.push('## Suggested Fixes');
            envelope.suggestedFixes.forEach(fix => {
                lines.push(`- ${fix}`);
            });
            lines.push('');
        }
    } else {
        lines.push('## Result');
        if (envelope.status === 'success') {
            lines.push(`- ${envelope.resultSummary ?? 'Completed successfully.'}`);
        } else if (envelope.status === 'simulated') {
            lines.push('- Simulated run (no provider call).');
        }
        lines.push('');
    }

    lines.push(`Content Log: ${envelope.contentLogWritten ? 'written' : 'skipped'}`);
    lines.push('');

    return lines.join('\n');
}

export function resolveLogsRoot(): string {
    return normalizePath(DEFAULT_LOGS_ROOT);
}

export function resolveContentLogsRoot(): string {
    return normalizePath(`${resolveLogsRoot()}/${CONTENT_LOGS_FOLDER_NAME}`);
}

export function resolveContentLogRoots(): string[] {
    return [
        resolveContentLogsRoot(),
        resolveInquiryContentLogsRoot(),
        resolveGossamerContentLogsRoot(),
        resolvePulseContentLogsRoot()
    ];
}

export async function ensureLogsRoot(vault: Vault): Promise<TFolder | null> {
    const folderPath = resolveLogsRoot();
    const existing = vault.getAbstractFileByPath(folderPath);
    if (existing && !(existing instanceof TFolder)) {
        return null;
    }
    try {
        await vault.createFolder(folderPath);
    } catch {
        // Folder may already exist.
    }
    const folder = vault.getAbstractFileByPath(folderPath);
    return folder instanceof TFolder ? folder : null;
}

export async function ensureContentLogsRoot(vault: Vault): Promise<TFolder | null> {
    const folderPath = resolveContentLogsRoot();
    const existing = vault.getAbstractFileByPath(folderPath);
    if (existing && !(existing instanceof TFolder)) {
        return null;
    }
    try {
        await vault.createFolder(folderPath);
    } catch {
        // Folder may already exist.
    }
    const folder = vault.getAbstractFileByPath(folderPath);
    return folder instanceof TFolder ? folder : null;
}

async function ensureNestedFolder(vault: Vault, folderPath: string): Promise<TFolder | null> {
    const normalized = normalizePath(folderPath);
    const parts = normalized.split('/').filter(Boolean);
    let current = '';
    for (const part of parts) {
        current = current ? `${current}/${part}` : part;
        const existing = vault.getAbstractFileByPath(current);
        if (existing && !(existing instanceof TFolder)) {
            return null;
        }
        if (!existing) {
            try {
                await vault.createFolder(current);
            } catch {
                // Folder may already exist (race) — fall through.
            }
        }
    }
    const folder = vault.getAbstractFileByPath(normalized);
    return folder instanceof TFolder ? folder : null;
}

export function resolveInquiryLogsRoot(): string {
    return normalizePath(`${DEFAULT_LOGS_ROOT}/${INQUIRY_LOGS_FOLDER_NAME}`);
}

export function resolveInquiryContentLogsRoot(): string {
    return normalizePath(`${resolveInquiryLogsRoot()}/${CONTENT_LOGS_FOLDER_NAME}`);
}

export async function ensureInquiryLogsRoot(vault: Vault): Promise<TFolder | null> {
    return ensureNestedFolder(vault, resolveInquiryLogsRoot());
}

export async function ensureInquiryContentLogsRoot(vault: Vault): Promise<TFolder | null> {
    return ensureNestedFolder(vault, resolveInquiryContentLogsRoot());
}

export function resolveGossamerLogsRoot(): string {
    return normalizePath(`${DEFAULT_LOGS_ROOT}/${GOSSAMER_LOGS_FOLDER_NAME}`);
}

export function resolveGossamerContentLogsRoot(): string {
    return normalizePath(`${resolveGossamerLogsRoot()}/${CONTENT_LOGS_FOLDER_NAME}`);
}

export async function ensureGossamerLogsRoot(vault: Vault): Promise<TFolder | null> {
    return ensureNestedFolder(vault, resolveGossamerLogsRoot());
}

export async function ensureGossamerContentLogsRoot(vault: Vault): Promise<TFolder | null> {
    return ensureNestedFolder(vault, resolveGossamerContentLogsRoot());
}

// Recovery data — lives under Recover, never under Logs.
export function resolveGossamerArchiveRoot(): string {
    return normalizePath(`${DEFAULT_RECOVER_ROOT}/${GOSSAMER_ARCHIVE_FOLDER_NAME}`);
}

export async function ensureGossamerArchiveRoot(vault: Vault): Promise<TFolder | null> {
    return ensureNestedFolder(vault, resolveGossamerArchiveRoot());
}

export function resolvePulseLogsRoot(): string {
    return normalizePath(`${DEFAULT_LOGS_ROOT}/${PULSE_LOGS_FOLDER_NAME}`);
}

export function resolvePulseContentLogsRoot(): string {
    return normalizePath(`${resolvePulseLogsRoot()}/${CONTENT_LOGS_FOLDER_NAME}`);
}

export async function ensurePulseLogsRoot(vault: Vault): Promise<TFolder | null> {
    return ensureNestedFolder(vault, resolvePulseLogsRoot());
}

export async function ensurePulseContentLogsRoot(vault: Vault): Promise<TFolder | null> {
    return ensureNestedFolder(vault, resolvePulseContentLogsRoot());
}

export function resolveMovesLogsRoot(): string {
    return normalizePath(`${DEFAULT_LOGS_ROOT}/${MOVES_LOGS_FOLDER_NAME}`);
}

export async function ensureMovesLogsRoot(vault: Vault): Promise<TFolder | null> {
    return ensureNestedFolder(vault, resolveMovesLogsRoot());
}

// Recovery data — lives under Recover, never under Logs.
export function resolveSnapshotsLogsRoot(): string {
    return normalizePath(`${DEFAULT_RECOVER_ROOT}/${SNAPSHOTS_LOGS_FOLDER_NAME}`);
}

export async function ensureSnapshotsLogsRoot(vault: Vault): Promise<TFolder | null> {
    return ensureNestedFolder(vault, resolveSnapshotsLogsRoot());
}

export function resolveAiLogFolder(): string {
    return resolveLogsRoot();
}

export function resolveAvailableLogPath(vault: Vault, folderPath: string, baseName: string): string {
    const sanitizedFolder = normalizePath(folderPath);
    const cleanBase = baseName.replace(/\.md$/i, '');
    let attempt = 0;
    while (attempt < 50) {
        const suffix = attempt === 0 ? '' : `-${attempt}`;
        const filePath = `${sanitizedFolder}/${cleanBase}${suffix}.md`;
        if (!vault.getAbstractFileByPath(filePath)) {
            return filePath;
        }
        attempt += 1;
    }
    return `${sanitizedFolder}/${cleanBase}-${Date.now()}.md`;
}

export function countContentLogFiles(plugin: RadialTimelinePlugin): number {
    const seen = new Set<string>();
    let count = 0;
    const countMarkdownFiles = (file: unknown): void => {
        if (file instanceof TFile) {
            if (!seen.has(file.path) && file.extension.toLowerCase() === 'md') {
                seen.add(file.path);
                count += 1;
            }
            return;
        }
        if (file instanceof TFolder) {
            const children = (file as TFolder & { children?: unknown[] }).children ?? [];
            for (const child of children) {
                countMarkdownFiles(child);
            }
        }
    };

    for (const folderPath of resolveContentLogRoots()) {
        countMarkdownFiles(plugin.app.vault.getAbstractFileByPath(folderPath));
    }
    return count;
}

export async function writeAiLog(
    plugin: RadialTimelinePlugin,
    vault: Vault,
    options: { baseName: string; content: string }
): Promise<void> {
    const folderPath = normalizePath(resolveLogsRoot());
    try {
        const folder = await ensureLogsRoot(vault);
        if (!folder) throw new Error('Log folder path is not a folder.');
        const filePath = resolveAvailableLogPath(vault, folderPath, options.baseName);
        await vault.create(filePath, options.content.trim());
    } catch (e) {
        console.error('[AI][log] Failed to write log:', redactSensitiveObject(e));
        new Notice('Failed to write AI log.');
    }
}
