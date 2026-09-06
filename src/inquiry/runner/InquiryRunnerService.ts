import { TFile } from 'obsidian';
import type { MetadataCache, Vault } from 'obsidian';
import type RadialTimelinePlugin from '../../main';
import { t } from '../../i18n';
import { extractSummary, normalizeFrontmatterKeys } from '../../utils/frontmatter';
import { INQUIRY_MAX_OUTPUT_TOKENS, INQUIRY_SCHEMA_VERSION } from '../constants';
import { PROVIDER_MAX_OUTPUT_TOKENS } from '../../constants/tokenLimits';
import type { CitationIntegrityWarning, CitationRepairDiagnostic, EvidenceDocumentMeta, InquiryAiStatus, InquiryCitation, InquiryFinding, InquiryResult, InquiryRoleValidation, InquiryTokenUsageScope, UnverifiedCitation } from '../state';
import { computeCitationIntegritySummary } from '../state';
import type {
    CorpusManifestEntry,
    InquiryExecutionPath,
    InquiryExecutionState,
    InquiryFailureStage,
    InquiryOmnibusInput,
    InquiryOmnibusQuestion,
    InquiryRunExecutionOptions,
    InquiryRunTrace,
    InquiryRunner,
    InquiryRunnerInput
} from './types';
import { getAIClient } from '../../ai/runtime/aiClient';
import type { AIRunPreparedEstimate, AIRunResult, AIProviderId } from '../../ai/types';
import { extractTokenUsage } from '../../ai/usage/providerUsage';
import { readSceneId } from '../../utils/sceneIds';
import { buildSceneRefIndex, isStableSceneId, normalizeSceneRef } from '../../ai/references/sceneRefNormalizer';
import { cleanEvidenceBody } from '../utils/evidenceCleaning';
import { estimateTokensFromChars, type TokenEstimateMethod } from '../../ai/tokens/inputTokenEstimate';
import { logCountingForensics } from '../../ai/diagnostics/countingForensics';
import { buildInquiryJsonSchema, buildInquiryOmnibusJsonSchema } from '../jsonSchema';
import { buildInquiryPromptParts, INQUIRY_ROLE_TEMPLATE_GUARDRAIL } from '../promptScaffold';
import { BUILTIN_MODELS } from '../../ai/registry/builtinModels';
import { buildInquiryBookAnchorId } from '../services/canonicalInquiryCorpus';
import { fnv1a32Hex, fnv1a32HexUnpadded } from '../../utils/hash';

export { cleanEvidenceBody } from '../utils/evidenceCleaning';

const BOOK_FOLDER_REGEX = /^Book\s+(\d+)/i;

function isSinglePassPlanningBudgetError(message: string): boolean {
    const normalized = message.toLowerCase();
    return normalized.includes('single-pass planning budget')
        || normalized.includes('safe limit for a single pass');
}

type EvidenceBlock = {
    label: string;
    content: string;
    meta?: EvidenceDocumentMeta;
};

type OnePassFitState = 'fits' | 'overflows' | 'unknown';

type ExecutionPlanDecision = {
    path: 'one_pass' | 'multi_pass';
    reason: string;
};

/**
 * Pure decision function: determines one-pass vs multi-pass execution
 * based solely on the precheck result. No side effects.
 */
function decideExecutionPlan(precheck: {
    onePassFit: OnePassFitState;
    inputTokens: number;
    safeInputTokens: number;
}): ExecutionPlanDecision {
    if (precheck.onePassFit === 'fits') {
        return { path: 'one_pass', reason: '' };
    }
    const reason = precheck.onePassFit === 'overflows'
        ? t('inquiry.runner.singlePassFitFailedWithBudget', { inputTokens: Math.round(precheck.inputTokens).toLocaleString(), safeInputTokens: Math.round(precheck.safeInputTokens).toLocaleString() })
        : t('inquiry.runner.singlePassFitFailedUnknown');
    return { path: 'multi_pass', reason };
}

type SceneSnapshot = {
    path: string;
    label: string;
    title: string;
    sceneId: string;
    summary: string;  // Extended Summary field (frontmatter["Summary"])
    sceneNumber?: number;
};

type RawInquiryFinding = {
    ref_id?: string;
    ref_label?: string;
    ref_path?: string;
    kind?: string;
    lens?: string;
    headline?: string;
    bullets?: string[];
    recommended_action?: string;
    subject?: string;
    span?: string;
    evidence_quote?: string;
    supporting_refs?: RawInquirySupportingRef[];
    role?: string;
};

type RawInquirySupportingRef = {
    ref_id?: string;
    ref_label?: string;
    ref_path?: string;
    quote?: string;
};

type RawInquiryResponse = {
    schema_version?: number;
    summary?: string;
    summaryFlow?: string;
    summaryDepth?: string;
    verdictFlow?: number;
    verdictDepth?: number;
    // Legacy nested shape, retained only for backward-compatible reads.
    // Opus 4.8 corrupts this nested object by leaking tool-call XML
    // (<parameter name="flow">...) into it, so the wire schema is now flat.
    verdict?: {
        flow?: number;
        depth?: number;
    };
    findings?: RawInquiryFinding[];
};

type RawOmnibusQuestionResult = RawInquiryResponse & {
    question_id?: string;
    question_zone?: string;
    questionId?: string;
    questionZone?: string;
};

type RawOmnibusResponse = {
    schema_version?: number;
    results?: RawOmnibusQuestionResult[];
};

type ProviderResult = {
    success: boolean;
    content: string | null;
    responseData: unknown;
    requestPayload?: unknown;
    provider: Exclude<AIProviderId, 'none'>;
    modelId?: string;
    aiProvider?: Exclude<AIProviderId, 'none'>;
    aiModelRequested?: string;
    aiModelResolved?: string;
    aiStatus?: InquiryAiStatus;
    aiReason?: string;
    error?: string;
    sanitizationNotes?: string[];
    retryCount?: number;
    executionPassCount?: number;
    multiPassTriggerReason?: string;
    executionState?: InquiryExecutionState;
    executionPath?: InquiryExecutionPath;
    failureStage?: InquiryFailureStage;
    cacheReuseState?: 'idle' | 'eligible' | 'warm';
    cacheStatus?: 'hit' | 'created';
    cacheExpiresAt?: number;
    cachedStableRatio?: number;
    cachedStableTokens?: number;
    tokenUsageKnown?: boolean;
    tokenUsageScope?: InquiryTokenUsageScope;
    usage?: InquiryRunTrace['usage'];
    aiTransportLane?: 'chat_completions' | 'responses';
    citations?: InquiryCitation[];
};

type MultiPassExecutionResult =
    | {
        ok: true;
        run: AIRunResult;
        tokenUsageKnown: boolean;
        tokenUsageScope?: InquiryTokenUsageScope;
        usage?: InquiryRunTrace['usage'];
    }
    | {
        ok: false;
        failureStage: 'preflight' | 'chunk_execution' | 'synthesis';
        failureReason: string;
        tokenUsageKnown: boolean;
        tokenUsageScope?: InquiryTokenUsageScope;
        usage?: InquiryRunTrace['usage'];
    };

type ChunkPromptPlan = {
    prompts: string[];
    maxChunkTokens: number;
    maxChunkChars: number;
    evidenceChars: number;
    prefixChars: number;
    targetPasses: number | null;
};

type SceneRefLedger = {
    allowedSceneIds: Set<string>;
    synthesisBlock: string;
};

type BookRefEntry = {
    bookId: string;
    path: string;
    label?: string;
    title?: string;
    aliases?: string[];
};

type BookRefIndex = {
    byBookId: Map<string, BookRefEntry>;
    byPath: Map<string, BookRefEntry>;
    byLabel: Map<string, BookRefEntry>;
    byNormalizedKey: Map<string, BookRefEntry[]>;
};

type RefVerificationOptions = {
    primaryRefType?: 'scene' | 'book';
    supportingSceneRefIndex?: ReturnType<typeof buildSceneRefIndex>;
    supportingBookRefIndex?: BookRefIndex;
};

type UsageAccumulator = {
    totalPasses: number;
    passesWithAnyUsage: number;
    passesWithInput: number;
    passesWithOutput: number;
    passesWithTotal: number;
    passesWithCacheAwareUsage: number;
    synthesisHasUsage: boolean;
    chunkHasUsage: boolean;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    rawInputTokens: number;
    cacheReadInputTokens: number;
    cacheCreationInputTokens: number;
};

export class InquiryRunnerService implements InquiryRunner {
    private tokenEstimateCache = new Map<string, InquiryRunTrace['tokenEstimate']>();

    constructor(
        private plugin: RadialTimelinePlugin,
        private vault: Vault,
        private metadataCache: MetadataCache,
        private frontmatterMappings?: Record<string, string>
    ) {}

    async run(input: InquiryRunnerInput): Promise<InquiryResult> {
        const { result } = await this.runWithTrace(input);
        return result;
    }

    async runWithTrace(
        input: InquiryRunnerInput,
        options?: InquiryRunExecutionOptions
    ): Promise<{ result: InquiryResult; trace: InquiryRunTrace }> {
        const { trace, evidenceBlocks, instructionPrompt, cacheableUserInput } = await this.buildInitialTrace(input);
        const evidenceDocMeta = evidenceBlocks.map(b => b.meta).filter((m): m is EvidenceDocumentMeta => !!m);
        const { systemPrompt, userPrompt } = trace;

        const jsonSchema = this.getJsonSchema();
        const temperature = 0.2;
        const maxTokens = this.getOutputTokenRequestLimit(
            input.ai.provider,
            input.ai.modelId,
            trace.tokenEstimate.inputTokens
        );
        let response: ProviderResult | null = null;

        try {
            response = await this.callProvider(
                systemPrompt,
                userPrompt,
                input.ai,
                jsonSchema,
                temperature,
                maxTokens,
                this.appendVolatileTargetScenes(input.questionText, input.targetSceneIds),
                evidenceBlocks,
                options,
                instructionPrompt,
                cacheableUserInput,
                input.corpus.cacheReuseFingerprint
            );
            if (response.sanitizationNotes?.length) {
                trace.sanitizationNotes.push(...response.sanitizationNotes);
            }
            if (response.requestPayload) {
                trace.requestPayload = response.requestPayload;
            }
            if (typeof response.retryCount === 'number') {
                trace.retryCount = response.retryCount;
            }
            if (typeof response.executionPassCount === 'number') {
                trace.executionPassCount = response.executionPassCount;
            }
            if (response.multiPassTriggerReason) {
                trace.multiPassTriggerReason = response.multiPassTriggerReason;
            }
            trace.response = {
                content: response.content,
                responseData: response.responseData,
                aiStatus: response.aiStatus,
                aiReason: response.aiReason,
                error: response.error
            };
            this.applyResponseExecutionReporting(trace, response);
            this.applyOpenAiTransportLaneTraceNote(trace, response);
            const finalPassCount = typeof response.executionPassCount === 'number' && response.executionPassCount > 0
                ? response.executionPassCount
                : 1;

            if (!response.success || !response.content || response.aiStatus !== 'success') {
                const status = response.aiStatus || 'unknown';
                const reason = response.aiReason ? ` (${response.aiReason})` : '';
                trace.notes.push(`Provider status: ${status}${reason}.`);
                if (response.error) {
                    trace.notes.push(`Provider error: ${response.error}`);
                }
                return {
                    result: this.buildStubResult(input, this.getAiMetaFromResponse(response), response.error),
                    trace
                };
            }

            options?.onProgress?.({
                phase: 'finalizing',
                currentPass: finalPassCount,
                totalPasses: finalPassCount,
                detail: t('inquiry.runner.finalizing')
            });

            try {
                const parsed = this.parseResponse(response.content);
                return { result: this.buildResult(input, parsed, this.getAiMetaFromResponse(response), response.citations, evidenceDocMeta, trace.usage), trace };
            } catch (parseError) {
                const message = parseError instanceof Error ? parseError.message : String(parseError);
                trace.notes.push(`Parse error: ${message}`);
                trace.executionState = 'dispatched_to_provider';
                trace.failureStage = 'provider_response_parsing';
                trace.tokenUsageKnown = trace.tokenUsageKnown ?? !!trace.usage;
                const usage = trace.usage ?? this.extractUsage(response.aiProvider ?? response.provider, response.responseData);
                if (usage) trace.usage = usage;
                const fallbackMeta = this.withParseFailureMeta(this.getAiMetaFromResponse(response), response.aiStatus ?? 'rejected');
                return {
                    result: this.buildStubResult(input, fallbackMeta, parseError),
                    trace
                };
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (response) {
                trace.notes.push(`Runner error after response: ${message}`);
                const fallbackMeta = this.withParseFailureMeta(this.getAiMetaFromResponse(response), response.aiStatus ?? 'rejected');
                return { result: this.buildStubResult(input, fallbackMeta, error), trace };
            }
            trace.notes.push(`Runner error: ${message}`);
            return { result: this.buildStubResult(input, this.buildFallbackAiMeta(input), error), trace };
        }
    }

    async runOmnibusWithTrace(
        input: InquiryOmnibusInput
    ): Promise<{ results: InquiryResult[]; trace: InquiryRunTrace; rawResponse?: RawOmnibusResponse | null }> {
        const { trace, evidenceBlocks, instructionPrompt, cacheableUserInput } = await this.buildOmnibusTrace(input);
        const evidenceDocMeta = evidenceBlocks.map(b => b.meta).filter((m): m is EvidenceDocumentMeta => !!m);
        const { systemPrompt, userPrompt } = trace;

        const jsonSchema = this.getOmnibusJsonSchema();
        const temperature = 0.2;
        const maxTokens = this.getOutputTokenRequestLimit(
            input.ai.provider,
            input.ai.modelId,
            trace.tokenEstimate.inputTokens
        );
        let response: ProviderResult | null = null;

        try {
            response = await this.callProvider(
                systemPrompt,
                userPrompt,
                input.ai,
                jsonSchema,
                temperature,
                maxTokens,
                this.appendVolatileTargetScenes(
                    input.questions.map(question => question.questionText).join('\n'),
                    input.targetSceneIds
                ),
                evidenceBlocks,
                undefined,
                instructionPrompt,
                cacheableUserInput,
                input.corpus.cacheReuseFingerprint
            );
            if (response.sanitizationNotes?.length) {
                trace.sanitizationNotes.push(...response.sanitizationNotes);
            }
            if (response.requestPayload) {
                trace.requestPayload = response.requestPayload;
            }
            if (typeof response.retryCount === 'number') {
                trace.retryCount = response.retryCount;
            }
            if (typeof response.executionPassCount === 'number') {
                trace.executionPassCount = response.executionPassCount;
            }
            if (response.multiPassTriggerReason) {
                trace.multiPassTriggerReason = response.multiPassTriggerReason;
            }
            trace.response = {
                content: response.content,
                responseData: response.responseData,
                aiStatus: response.aiStatus,
                aiReason: response.aiReason,
                error: response.error
            };
            this.applyResponseExecutionReporting(trace, response);
            this.applyOpenAiTransportLaneTraceNote(trace, response);

            if (!response.success || !response.content || response.aiStatus !== 'success') {
                const status = response.aiStatus || 'unknown';
                const reason = response.aiReason ? ` (${response.aiReason})` : '';
                trace.notes.push(`Provider status: ${status}${reason}.`);
                if (response.error) {
                    trace.notes.push(`Provider error: ${response.error}`);
                }
                const aiMeta = this.getAiMetaFromResponse(response);
                return {
                    results: this.buildOmnibusStubResults(input, aiMeta, response.error),
                    trace,
                    rawResponse: null
                };
            }

            try {
                const parsed = this.parseOmnibusResponse(response.content);
                const aiMeta = this.getAiMetaFromResponse(response);
                return {
                    results: this.buildOmnibusResults(input, parsed, aiMeta, trace, response.citations, evidenceDocMeta),
                    trace,
                    rawResponse: parsed
                };
            } catch (parseError) {
                const message = parseError instanceof Error ? parseError.message : String(parseError);
                trace.notes.push(`Parse error: ${message}`);
                trace.executionState = 'dispatched_to_provider';
                trace.failureStage = 'provider_response_parsing';
                trace.tokenUsageKnown = trace.tokenUsageKnown ?? !!trace.usage;
                const usage = trace.usage ?? this.extractUsage(response.aiProvider ?? response.provider, response.responseData);
                if (usage) trace.usage = usage;
                const fallbackMeta = this.withParseFailureMeta(this.getAiMetaFromResponse(response), response.aiStatus ?? 'rejected');
                return {
                    results: this.buildOmnibusStubResults(input, fallbackMeta, parseError),
                    trace,
                    rawResponse: null
                };
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (response) {
                trace.notes.push(`Runner error after response: ${message}`);
                const fallbackMeta = this.withParseFailureMeta(this.getAiMetaFromResponse(response), response.aiStatus ?? 'rejected');
                return {
                    results: this.buildOmnibusStubResults(input, fallbackMeta, error),
                    trace,
                    rawResponse: null
                };
            }
            trace.notes.push(`Runner error: ${message}`);
            return {
                results: this.buildOmnibusStubResults(input, this.buildFallbackAiMeta(input), error),
                trace,
                rawResponse: null
            };
        }
    }

    async buildTrace(input: InquiryRunnerInput): Promise<InquiryRunTrace> {
        const { trace } = await this.buildInitialTrace(input);
        return trace;
    }

    async buildPreparedEstimateArtifacts(input: InquiryRunnerInput): Promise<{
        preparedEstimate: AIRunPreparedEstimate | null;
        evidenceDocuments: Array<{ title: string; content: string; evidenceClass?: string }>;
    }> {
        const evidenceBlocks = await this.buildEvidenceBlocks(input);
        const { systemPrompt, userPrompt, instructionPrompt, cacheableUserInput } = this.buildPrompt(input, evidenceBlocks);
        const preparedEstimate = await this.prepareInquiryRunEstimate(getAIClient(this.plugin), {
            task: 'InquiryTraceEstimate',
            systemPrompt,
            userPrompt,
            userQuestion: this.appendVolatileTargetScenes(input.questionText, input.targetSceneIds),
            ai: input.ai,
            jsonSchema: this.getJsonSchema(),
            temperature: 0.2,
            maxTokens: this.getOutputTokenCap(input.ai.provider),
            evidenceBlocks,
            instructionPrompt,
            cacheableUserInput,
            providerReuseKey: input.corpus.cacheReuseFingerprint
        });
        return {
            preparedEstimate,
            evidenceDocuments: evidenceBlocks.map(block => ({
                title: block.label,
                content: block.content,
                evidenceClass: block.meta?.evidenceClass
            }))
        };
    }

    estimateExecutionPassCountFromPrompt(
        userPrompt: string,
        options?: {
            estimatedInputTokens?: number;
            safeInputTokens?: number;
        }
    ): number {
        const chunkPlan = this.buildEvidenceChunkPrompts(userPrompt, {
            maxChunkTokens: 12000,
            estimatedInputTokens: options?.estimatedInputTokens,
            safeInputTokens: options?.safeInputTokens
        });
        const chunkCount = chunkPlan ? chunkPlan.prompts.length : 0;
        if (chunkCount <= 1) return 1;
        return chunkCount + 1;
    }

    private async buildEvidenceBlocks(input: InquiryRunnerInput): Promise<EvidenceBlock[]> {
        const blocks: EvidenceBlock[] = [];
        const allEntries = input.corpus.entries;
        const sceneEntries = allEntries
            .filter(entry => entry.class === 'scene')
            .filter(entry => this.isModeActive(entry.mode));
        const outlineEntries = allEntries
            .filter(entry => entry.class === 'outline')
            .filter(entry => this.isModeActive(entry.mode));
        const referenceEntries = allEntries
            .filter(entry => entry.class !== 'scene' && entry.class !== 'outline' && entry.class !== 'book')
            .filter(entry => this.isModeActive(entry.mode));

        if (input.scope === 'saga') {
            const sagaOutlines = await this.collectOutlines(outlineEntries.filter(entry => entry.scope === 'saga'), 'Saga outline');
            blocks.push(...sagaOutlines);
        }

        const bookOutlines = await this.collectOutlines(outlineEntries.filter(entry => entry.scope !== 'saga'), 'Book outline');
        blocks.push(...bookOutlines);

        const scenes = await this.buildSceneSnapshots(sceneEntries);

        const sceneModeByPath = new Map(
            sceneEntries.map(entry => [entry.path, this.normalizeEntryMode(entry.mode)])
        );
        let readSuccessCount = 0;
        let readFailCount = 0;
        for (const scene of scenes) {
            const mode = sceneModeByPath.get(scene.path) ?? 'excluded';
            const sceneLabel = scene.title ? `${scene.title} (${scene.label})` : scene.label;
            const sceneMeta: EvidenceDocumentMeta = { title: scene.title || scene.label, path: scene.path, sceneId: scene.sceneId, evidenceClass: 'scene' };
            if (mode === 'summary') {
                if (!scene.summary) continue;
                blocks.push({ label: `Scene ${sceneLabel} (${scene.sceneId}) (Summary)`, content: scene.summary, meta: sceneMeta });
                continue;
            }
            if (mode === 'full') {
                const content = await this.readFileContent(scene.path);
                if (!content) {
                    readFailCount++;
                    if (readFailCount <= 3) {
                        console.warn(`[Inquiry] readFileContent returned empty for scene "${scene.path}"`);
                    }
                    continue;
                }
                readSuccessCount++;
                blocks.push({ label: `Scene ${sceneLabel} (${scene.sceneId}) (Full)`, content, meta: sceneMeta });
            }
        }
        if (readFailCount > 0) {
            console.warn(`[Inquiry] buildEvidenceBlocks: ${readFailCount} scene reads failed, ${readSuccessCount} succeeded`);
        }

        const references = await this.collectReferenceDocs(referenceEntries);
        blocks.push(...references);
        const dedupedBlocks: EvidenceBlock[] = [];
        const seenBlockKeys = new Set<string>();
        blocks.forEach(block => {
            const key = `${block.label}\u0000${block.content}`;
            if (seenBlockKeys.has(key)) return;
            seenBlockKeys.add(key);
            dedupedBlocks.push(block);
        });

        if (!dedupedBlocks.length) {
            dedupedBlocks.push({ label: 'Evidence', content: t('inquiry.runner.noEvidenceForScope') });
        }

        // Hard guard: Inquiry corpus must never include Synopsis-sourced content.
        // Catches accidental reintroduction of Synopsis semantics in future changes.
        if (typeof process !== 'undefined' && process.env?.NODE_ENV !== 'production') {
            for (const block of dedupedBlocks) {
                if (/\bsynopsis\b/i.test(block.label)) {
                    console.warn(
                        `[Inquiry guard] Evidence block label "${block.label}" contains "synopsis". ` +
                        `Inquiry corpus must use Summary only. This may indicate a regression.`
                    );
                }
            }
        }

        return dedupedBlocks;
    }

    private async buildSceneSnapshots(entries: CorpusManifestEntry[]): Promise<SceneSnapshot[]> {
        const scenes: SceneSnapshot[] = [];
        const seenPaths = new Set<string>();

        entries.forEach(entry => {
            const normalizedPath = entry.path.trim();
            if (!normalizedPath || seenPaths.has(normalizedPath)) return;
            seenPaths.add(normalizedPath);
            const file = this.vault.getAbstractFileByPath(entry.path);
            if (!file || !('path' in file)) return;
            if (!this.isTFile(file)) return;
            const frontmatter = this.getFrontmatter(file);
            const summary = extractSummary(frontmatter);
            const sceneNumber = this.extractSceneNumber(frontmatter) ?? this.extractSceneNumberFromText(file.basename);
            const title = this.getSceneTitle(file, frontmatter);
            let sceneId = this.resolveCanonicalSceneId(entry.sceneId ?? readSceneId(frontmatter) ?? undefined);
            if (!sceneId) {
                sceneId = this.buildPathFallbackSceneId(normalizedPath);
                console.warn(`[Inquiry] Scene "${file.path}" is missing canonical YAML id (scn_<hash>); using fallback id "${sceneId}".`);
            }
            scenes.push({
                path: file.path,
                label: '',
                title,
                sceneId,
                summary,
                sceneNumber
            });
        });

        scenes.sort((a, b) => {
            const numA = a.sceneNumber ?? Number.POSITIVE_INFINITY;
            const numB = b.sceneNumber ?? Number.POSITIVE_INFINITY;
            if (numA !== numB) return numA - numB;
            return a.path.localeCompare(b.path);
        });

        scenes.forEach((scene, index) => {
            const labelNumber = scene.sceneNumber ?? index + 1;
            scene.label = `S${this.clampLabelNumber(labelNumber)}`;
        });

        return scenes;
    }

    private getSceneTitle(file: TFile, frontmatter: Record<string, unknown>): string {
        const rawTitle = frontmatter['Title'] ?? frontmatter['title'];
        if (typeof rawTitle === 'string' && rawTitle.trim()) {
            return rawTitle.trim();
        }
        return file.basename;
    }

    private async collectOutlines(entries: CorpusManifestEntry[], fallbackLabel: string): Promise<EvidenceBlock[]> {
        const blocks: EvidenceBlock[] = [];
        for (const entry of entries) {
            const mode = this.normalizeEntryMode(entry.mode);
            if (mode === 'excluded') continue;
            const baseLabel = entry.scope === 'book'
                ? this.buildBookOutlineLabel(entry.path, fallbackLabel)
                : fallbackLabel;
            const meta: EvidenceDocumentMeta = { title: baseLabel, path: entry.path, evidenceClass: 'outline' };
            if (mode === 'summary') {
                const summary = this.getSummaryForPath(entry.path);
                if (!summary) continue;
                blocks.push({ label: `${baseLabel} (Summary)`, content: summary, meta });
                continue;
            }
            const content = await this.readFileContent(entry.path);
            if (!content) continue;
            blocks.push({ label: `${baseLabel} (Full)`, content, meta });
        }
        return blocks;
    }

    private async collectReferenceDocs(entries: CorpusManifestEntry[]): Promise<EvidenceBlock[]> {
        const blocks: EvidenceBlock[] = [];
        for (const entry of entries) {
            const mode = this.normalizeEntryMode(entry.mode);
            if (mode === 'excluded') continue;
            const baseLabel = this.buildReferenceLabel(entry);
            const meta: EvidenceDocumentMeta = { title: baseLabel, path: entry.path, evidenceClass: this.formatClassLabel(entry.class) };
            if (mode === 'summary') {
                const summary = this.getSummaryForPath(entry.path);
                if (!summary) continue;
                blocks.push({ label: `${baseLabel} (Summary)`, content: summary, meta });
                continue;
            }
            const content = await this.readFileContent(entry.path);
            if (!content) continue;
            blocks.push({ label: `${baseLabel} (Full)`, content, meta });
        }
        return blocks;
    }

    private buildReferenceLabel(entry: CorpusManifestEntry): string {
        const classLabel = this.formatClassLabel(entry.class);
        const file = this.vault.getAbstractFileByPath(entry.path);
        if (file && this.isTFile(file)) {
            const title = this.getReferenceTitle(file);
            if (title) {
                return `${classLabel}: ${title}`;
            }
        }
        return classLabel;
    }

    private formatClassLabel(value: string): string {
        if (!value) return 'Reference';
        return value
            .replace(/[_-]+/g, ' ')
            .trim()
            .split(/\s+/)
            .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
            .join(' ');
    }

    private buildBookOutlineLabel(path: string, fallback: string): string {
        const match = BOOK_FOLDER_REGEX.exec(path.split('/').find(segment => BOOK_FOLDER_REGEX.test(segment)) || '');
        if (match) {
            return `Book ${match[1]} outline`;
        }
        const filename = path.split('/').pop() || '';
        return filename ? `${fallback} (${filename})` : fallback;
    }

    private async readFileContent(path: string): Promise<string | null> {
        const file = this.vault.getAbstractFileByPath(path);
        if (!file) {
            console.warn(`[Inquiry] readFileContent: vault.getAbstractFileByPath("${path}") returned null`);
            return null;
        }
        if (!this.isTFile(file)) {
            console.warn(`[Inquiry] readFileContent: "${path}" is not a TFile (type: ${file.constructor?.name ?? typeof file})`);
            return null;
        }
        try {
            const raw = await this.vault.read(file);
            const cleaned = cleanEvidenceBody(raw);
            if (!cleaned) {
                console.warn(`[Inquiry] readFileContent: "${path}" has ${raw.length} raw chars but cleanEvidenceBody returned empty`);
            }
            return cleaned;
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            console.warn(`[Inquiry] readFileContent: vault.read("${path}") threw: ${message}`);
            return null;
        }
    }

    private getSummaryForPath(path: string): string | null {
        const file = this.vault.getAbstractFileByPath(path);
        if (!file || !this.isTFile(file)) return null;
        const frontmatter = this.getFrontmatter(file);
        const summary = extractSummary(frontmatter);
        return summary ? summary : null;
    }

    private normalizeEntryMode(mode?: CorpusManifestEntry['mode']): 'excluded' | 'summary' | 'full' {
        if (mode === 'full') return 'full';
        if (mode === 'summary') return 'summary';
        return 'excluded';
    }

    private isModeActive(mode?: CorpusManifestEntry['mode']): boolean {
        return this.normalizeEntryMode(mode) !== 'excluded';
    }

    private buildManifestSubjectLabel(entry: CorpusManifestEntry): string {
        if (entry.sceneId) return entry.sceneId;
        const filename = entry.path.split('/').pop() || entry.path;
        return filename.replace(/\.[^.]+$/i, '');
    }

    private buildCorpusManifestLines(entries: CorpusManifestEntry[]): string[] {
        let bookAnchorIndex = 0;
        return entries.map(entry => {
            const mode = this.normalizeEntryMode(entry.mode);
            const subject = this.buildManifestSubjectLabel(entry);
            if (entry.class === 'book') {
                bookAnchorIndex += 1;
            }
            const filename = entry.class === 'book'
                ? this.buildBookLabelForEntry(entry, bookAnchorIndex || 1)
                : (entry.path.split('/').pop() || entry.path);
            const refIdPart = entry.sceneId ? `ref_id=${subject}` : `ref_id=${subject}`;
            // Manifest must be corpus-only (no per-scene isTarget): target
            // selection is question-dependent and lives in the volatile
            // question (see buildVolatileTargetScenes), so it must never enter
            // the cacheable prefix or the provider prompt-cache prefix changes
            // per question and reuse across questions on the same corpus dies.
            return `${refIdPart} | ref_label=${filename} | ref_path=${entry.path} | class=${entry.class} | mode=${mode}`;
        });
    }

    /**
     * Volatile target-scene block. Target selection is question-dependent, so
     * it is folded into the volatile question (placed AFTER the cache break),
     * never into the cacheable prefix or the corpus manifest. Empty when there
     * are no target scenes. Preserves the target signal the manifest used to
     * carry via `isTarget=`, relocated to where it cannot perturb cache reuse.
     */
    private buildVolatileTargetScenes(targetSceneIds: string[]): string {
        if (!targetSceneIds.length) return '';
        return ['', 'TARGET SCENES:', ...targetSceneIds.map(sceneId => `- ${sceneId}`)].join('\n');
    }

    private appendVolatileTargetScenes(question: string, targetSceneIds: string[]): string {
        const block = this.buildVolatileTargetScenes(targetSceneIds);
        return block ? `${question}${block}` : question;
    }

    private buildPrompt(
        input: InquiryRunnerInput,
        evidence: EvidenceBlock[]
    ): { systemPrompt: string; userPrompt: string; evidenceText: string; instructionPrompt: string; cacheableUserInput: string } {
        const evidenceText = evidence.map(block => {
            return `## ${block.label}\n${block.content}`;
        }).join('\n\n');
        const scaffoldInput = {
            task: input.questionText,
            scope: input.scope,
            lens: input.mode,
            selectionMode: input.selectionMode,
            targetSceneIds: input.targetSceneIds,
            corpusManifestLines: this.buildCorpusManifestLines(input.corpus.entries),
            evidenceText
        };
        const { systemPrompt, userPrompt, instructionText, schemaText, manifestText } = buildInquiryPromptParts(scaffoldInput);
        const manifestBlock = manifestText ? ['', manifestText] : [];

        // Stable instruction prompt for attachment-mode caching.
        // Deliberately omits TASK *and* the target-scene block so the volatile
        // question can be placed after the cache break and any provider can
        // reuse the evidence prefix across different Inquiry questions (and
        // different target selections) on the same corpus.
        const instructionPrompt = [
            instructionText,
            '',
            schemaText,
            ...manifestBlock,
            '',
            'EVIDENCE:',
            '(Evidence provided as document attachments.)'
        ].join('\n');

        const cacheableUserInput = [
            instructionText,
            '',
            schemaText,
            ...manifestBlock,
            '',
            'EVIDENCE:',
            evidenceText
        ].join('\n');

        return { systemPrompt, userPrompt, evidenceText, instructionPrompt, cacheableUserInput };
    }

    private buildOmnibusPrompt(
        input: InquiryOmnibusInput,
        evidence: EvidenceBlock[]
    ): { systemPrompt: string; userPrompt: string; evidenceText: string; instructionPrompt: string; cacheableUserInput: string } {
        const systemPrompt = [
            'You are an editorial analysis engine.',
            'Scores are corpus-level diagnostics, not answer quality.',
            'Return JSON only. No prose outside JSON.'
        ].join('\n');

        const schema = [
            '{',
            `  "schema_version": ${INQUIRY_SCHEMA_VERSION},`,
            '  "results": [',
            '    {',
            '      "question_id": "setup-core",',
            '      "summaryFlow": "1-2 sentence flow summary (pacing, momentum, compression, timing, pressure phrasing).",',
            '      "summaryDepth": "1-2 sentence depth summary (coherence, subtext, logic, alignment, implication phrasing).",',
            '      "verdictFlow": <computed integer 0-100>,',
            '      "verdictDepth": <computed integer 0-100>,',
            '      "findings": [',
            '        {',
            '          "ref_id": "scn_a1b2c3d4",',
            '          "ref_label": "3 Turning Point.md",',
            '          "ref_path": "Book 1 Example Novel/3 Turning Point.md",',
            '          "kind": "thread|arc|payoff|structure|loose_end|continuity|escalation|conflict|unclear|strength",',
            '          "lens": "flow|depth|both|",',
            '          "headline": "short line",',
            '          "bullets": ["specific", "supporting points"],',
            '          "recommended_action": "concrete author edit/check, phrased as an imperative; empty string if the finding needs no separate action",',
            '          "subject": "thread, arc, or big-picture subject (empty string if not needed)",',
            '          "span": "book span such as B1-B3 or B2 (empty string if not needed)",',
            '          "evidence_quote": "verbatim sentence or phrase from the cited or supporting evidence (empty string if no quotable prose)",',
            '          "supporting_refs": [{ "ref_id": "scn_a1b2c3d4", "ref_label": "3 Turning Point.md", "ref_path": "Book 1 Example Novel/3 Turning Point.md", "quote": "short verbatim support quote" }],',
            '          "role": "target|context|"',
            '        }',
            '      ]',
            '    }',
            '  ]',
            '}'
        ].join('\n');

        const evidenceText = evidence.map(block => {
            return `## ${block.label}\n${block.content}`;
        }).join('\n\n');

        const questionLines = input.questions.map((question, index) => {
            const zoneLabel = question.zone === 'setup' ? 'Setup' : question.zone === 'pressure' ? 'Pressure' : 'Payoff';
            return `${index + 1}) [${question.id}] ${zoneLabel}: ${question.questionText}`;
        });
        const { instructionText, manifestText } = buildInquiryPromptParts({
            task: questionLines.join('\n'),
            scope: input.scope,
            lens: input.mode,
            selectionMode: input.selectionMode,
            targetSceneIds: input.targetSceneIds,
            corpusManifestLines: this.buildCorpusManifestLines(input.corpus.entries),
            evidenceText
        });

        const targetSceneBlock = input.selectionMode === 'focused' && input.targetSceneIds.length
            ? [
                '',
                'TARGET SCENES:',
                ...input.targetSceneIds.map(sceneId => `- ${sceneId}`)
            ]
            : [];
        const manifestBlock = manifestText ? ['', manifestText] : [];

        const promptParts = [
            instructionText,
            '',
            'Answer every listed question using the same evidence and return one result per question.',
            'Return JSON only with summaryFlow, summaryDepth, verdictFlow, verdictDepth, and findings for every question.',
            'Return JSON only using the exact schema below.',
            '',
            schema,
            ...manifestBlock,
            '',
            'TASK:',
            questionLines.join('\n'),
            ...targetSceneBlock
        ];

        const userPrompt = [
            ...promptParts,
            '',
            'EVIDENCE:',
            evidenceText
        ].join('\n');

        // Stable instruction prompt for attachment-mode caching.
        // Deliberately omits TASK *and* the target-scene block so the volatile
        // question list can be placed after the cache break and any provider
        // can reuse the evidence prefix across different target selections.
        const instructionPrompt = [
            instructionText,
            '',
            schema,
            ...manifestBlock,
            '',
            'EVIDENCE:',
            '(Evidence provided as document attachments.)'
        ].join('\n');

        const cacheableUserInput = [
            instructionText,
            '',
            schema,
            ...manifestBlock,
            '',
            'EVIDENCE:',
            evidenceText
        ].join('\n');

        return { systemPrompt, userPrompt, evidenceText, instructionPrompt, cacheableUserInput };
    }

    private getJsonSchema(): Record<string, unknown> {
        return buildInquiryJsonSchema();
    }

    private getOmnibusJsonSchema(): Record<string, unknown> {
        return buildInquiryOmnibusJsonSchema();
    }

    private async callProvider(
        systemPrompt: string,
        userPrompt: string,
        ai: InquiryRunnerInput['ai'],
        jsonSchema: Record<string, unknown>,
        temperature: number,
        maxTokens: number,
        userQuestion?: string,
        evidenceBlocks?: EvidenceBlock[],
        executionOptions?: InquiryRunExecutionOptions,
        instructionPrompt?: string,
        cacheableUserInput?: string,
        providerReuseKey?: string
    ): Promise<ProviderResult> {
        const aiClient = getAIClient(this.plugin);
        const executionPrecheck = await this.getExecutionPrecheck({
            aiClient,
            systemPrompt,
            userPrompt,
            ai,
            userQuestion,
            jsonSchema,
            temperature,
            maxTokens,
            evidenceBlocks,
            instructionPrompt,
            cacheableUserInput,
            providerReuseKey
        });
        if (!executionPrecheck.ok) {
            const reason = t('inquiry.runner.executionPrecheckFailed', { reason: executionPrecheck.reason }).trim();
            return this.buildMultiPassFailedResult(
                ai,
                reason,
                'preflight',
                false
            );
        }
        const precheck = executionPrecheck;
        const executionPlan = decideExecutionPlan(precheck);

        if (executionPlan.path === 'multi_pass') {
            const triggerReason = executionPlan.reason;
            const multiPass = await this.runChunkedInquiry(aiClient, {
                systemPrompt,
                userPrompt,
                userQuestion,
                ai,
                jsonSchema,
                temperature,
                maxTokens,
                evidenceBlocks,
                executionOptions,
                executionPrecheck: {
                    inputTokens: precheck.inputTokens,
                    safeInputTokens: precheck.safeInputTokens,
                    onePassFit: precheck.onePassFit
                }
            });
            if (multiPass.ok) {
                return this.toProviderResult(this.withExecutionContext(multiPass.run, {
                    executionPassCount: multiPass.run.advancedContext?.executionPassCount,
                    multiPassTriggerReason: triggerReason
                }), {
                    usage: multiPass.usage,
                    tokenUsageScope: multiPass.tokenUsageScope
                });
            }
            const reason = precheck.onePassFit === 'overflows'
                ? `Automatic mode routed to multi-pass because estimated input ${Math.round(precheck.inputTokens).toLocaleString()} exceeded safe input budget ${Math.round(precheck.safeInputTokens).toLocaleString()}, but chunking/synthesis did not complete.`
                : 'Automatic mode preferred multi-pass because one-pass fit was unknown, but chunking/synthesis did not complete.';
            const reasonWithStage = `${reason} ${multiPass.failureReason}`.trim();
            return this.buildMultiPassFailedResult(
                ai,
                reasonWithStage,
                multiPass.failureStage,
                multiPass.tokenUsageKnown,
                multiPass.usage,
                multiPass.tokenUsageScope
            );
        }

        executionOptions?.onProgress?.({
            phase: 'one_pass',
            currentPass: 1,
            totalPasses: 1,
            detail: t('inquiry.runner.waiting')
        });
        this.throwIfAborted(executionOptions?.shouldAbort);
        let run = await this.runInquiryRequest(aiClient, {
            task: 'AnalyzeCorpus',
            systemPrompt,
            userPrompt,
            userQuestion,
            ai,
            jsonSchema,
            temperature,
            maxTokens,
            evidenceBlocks,
            preparedEstimate: precheck.preparedEstimate,
            instructionPrompt,
            cacheableUserInput,
            providerReuseKey,
            forceFreshRun: executionOptions?.forceFreshRun,
            // Request the full output ceiling on the first pass (the precheck
            // estimate above was prepared the same way). Avoids a wasted
            // truncated call followed by a ceiling retry.
            forceMaxOutputCeiling: true
        });
        run = this.withExecutionContext(run, {
            executionPassCount: 1
        });

        // Inquiry specialization: if the response STILL truncates even at the
        // full output ceiling, the findings genuinely exceed one response —
        // package and synthesize across chunks.
        if (run.aiReason === 'truncated') {
            {
                const multiPass = await this.runChunkedInquiry(aiClient, {
                    systemPrompt,
                    userPrompt,
                    userQuestion,
                    ai,
                    jsonSchema,
                    temperature,
                    maxTokens,
                    evidenceBlocks,
                    executionOptions,
                    executionPrecheck: {
                        inputTokens: precheck.inputTokens,
                        safeInputTokens: precheck.safeInputTokens,
                        onePassFit: precheck.onePassFit
                    }
                });
                if (multiPass.ok) {
                    run = multiPass.run;
                } else {
                    return this.buildMultiPassFailedResult(
                        ai,
                        `Single-pass response was truncated, and fallback multi-pass analysis did not complete. ${multiPass.failureReason}`.trim(),
                        multiPass.failureStage,
                        multiPass.tokenUsageKnown,
                        multiPass.usage,
                        multiPass.tokenUsageScope
                    );
                }
            }
        }

        return this.toProviderResult(run);
    }

    private async runInquiryRequest(
        aiClient: ReturnType<typeof getAIClient>,
        options: {
            task: string;
            systemPrompt: string;
            userPrompt: string;
            userQuestion?: string;
            ai: InquiryRunnerInput['ai'];
            jsonSchema: Record<string, unknown>;
            temperature: number;
            maxTokens: number;
            evidenceBlocks?: EvidenceBlock[];
            preparedEstimate?: AIRunPreparedEstimate | null;
            instructionPrompt?: string;
            cacheableUserInput?: string;
            providerReuseKey?: string;
            forceFreshRun?: boolean;
            forceMaxOutputCeiling?: boolean;
        }
    ): Promise<AIRunResult> {
        const preparedEstimate = options.preparedEstimate
            ?? await this.prepareInquiryRunEstimate(aiClient, {
                task: options.task,
                systemPrompt: options.systemPrompt,
                userPrompt: options.userPrompt,
                userQuestion: options.userQuestion,
                ai: options.ai,
                jsonSchema: options.jsonSchema,
                temperature: options.temperature,
                maxTokens: options.maxTokens,
                evidenceBlocks: options.evidenceBlocks,
                instructionPrompt: options.instructionPrompt,
                cacheableUserInput: options.cacheableUserInput,
                providerReuseKey: options.providerReuseKey,
                forceMaxOutputCeiling: options.forceMaxOutputCeiling
            });
        const effectiveUserInput = this.resolveProviderUserInput(
            options.ai.provider,
            options.userPrompt,
            options.instructionPrompt,
            options.cacheableUserInput,
            options.evidenceBlocks
        );
        return aiClient.run({
            feature: 'InquiryMode',
            task: options.task,
            requiredCapabilities: ['longContext', 'jsonStrict', 'reasoningStrong', 'highOutputCap'],
            featureModeInstructions: [
                options.systemPrompt,
                INQUIRY_ROLE_TEMPLATE_GUARDRAIL
            ].filter(Boolean).join('\n'),
            userInput: effectiveUserInput,
            userQuestion: options.userQuestion,
            promptText: options.userPrompt,
            systemPrompt: undefined,
            returnType: 'json',
            responseSchema: options.jsonSchema,
            providerOverride: options.ai.provider,
            overrides: {
                temperature: options.temperature,
                maxOutputMode: this.resolveMaxOutputMode(options.maxTokens),
                reasoningDepth: 'deep',
                jsonStrict: true,
                forceMaxOutputCeiling: options.forceMaxOutputCeiling
            },
            bypassInMemoryCache: options.forceFreshRun === true,
            // Force-rerun bypasses only the in-memory OUTPUT cache so the answer
            // is regenerated. The provider input-prefix cache (Anthropic) is
            // kept — its output is never reused, so a rerun stays cheap and the
            // cache window/countdown survives. (Was tied to forceFreshRun, which
            // needlessly paid full input cost and disarmed the cache on rerun.)
            bypassProviderReuse: false,
            preparedEstimate: preparedEstimate ?? undefined,
            providerReuseKey: options.providerReuseKey,
            evidenceDocuments: options.evidenceBlocks?.length
                ? options.evidenceBlocks.map(block => ({
                    title: block.label,
                    content: block.content
                }))
                : undefined
        });
    }

    private async prepareInquiryRunEstimate(
        aiClient: ReturnType<typeof getAIClient>,
        options: {
            task: string;
            systemPrompt: string;
            userPrompt: string;
            userQuestion?: string;
            ai: InquiryRunnerInput['ai'];
            jsonSchema: Record<string, unknown>;
            temperature: number;
            maxTokens: number;
            evidenceBlocks?: EvidenceBlock[];
            instructionPrompt?: string;
            cacheableUserInput?: string;
            providerReuseKey?: string;
            forceMaxOutputCeiling?: boolean;
        }
    ): Promise<AIRunPreparedEstimate | null> {
        const effectiveUserInput = this.resolveProviderUserInput(
            options.ai.provider,
            options.userPrompt,
            options.instructionPrompt,
            options.cacheableUserInput,
            options.evidenceBlocks
        );
        const prepared = await aiClient.prepareRunEstimate({
            feature: 'InquiryMode',
            task: options.task,
            requiredCapabilities: ['longContext', 'jsonStrict', 'reasoningStrong', 'highOutputCap'],
            featureModeInstructions: [
                options.systemPrompt,
                INQUIRY_ROLE_TEMPLATE_GUARDRAIL
            ].filter(Boolean).join('\n'),
            userInput: effectiveUserInput,
            userQuestion: options.userQuestion,
            promptText: options.userPrompt,
            systemPrompt: undefined,
            returnType: 'json',
            responseSchema: options.jsonSchema,
            policyOverride: this.resolvePolicyOverrideForAi(options.ai),
            providerOverride: options.ai.provider,
            overrides: {
                temperature: options.temperature,
                maxOutputMode: this.resolveMaxOutputMode(options.maxTokens),
                reasoningDepth: 'deep',
                jsonStrict: true,
                forceMaxOutputCeiling: options.forceMaxOutputCeiling
            },
            providerReuseKey: options.providerReuseKey,
            evidenceDocuments: options.evidenceBlocks?.length
                ? options.evidenceBlocks.map(block => ({
                    title: block.label,
                    content: block.content
                }))
                : undefined
        });
        if (!prepared.ok) return null;
        return prepared.estimate;
    }

    private shouldUseInstructionPrompt(
        provider: InquiryRunnerInput['ai']['provider'],
        instructionPrompt: string | undefined,
        evidenceBlocks: EvidenceBlock[] | undefined
    ): instructionPrompt is string {
        return provider === 'anthropic'
            && !!instructionPrompt
            && !!evidenceBlocks?.length;
    }

    private resolveProviderUserInput(
        provider: InquiryRunnerInput['ai']['provider'],
        userPrompt: string,
        instructionPrompt: string | undefined,
        cacheableUserInput: string | undefined,
        evidenceBlocks: EvidenceBlock[] | undefined
    ): string {
        if (this.shouldUseInstructionPrompt(provider, instructionPrompt, evidenceBlocks)) {
            return instructionPrompt;
        }
        if ((provider === 'openai' || provider === 'google') && cacheableUserInput) {
            return cacheableUserInput;
        }
        return userPrompt;
    }

    private resolvePolicyOverrideForAi(
        ai: InquiryRunnerInput['ai']
    ): { type: 'pinned'; pinnedAlias: string } | undefined {
        if (ai.provider === 'ollama') return undefined;
        const model = BUILTIN_MODELS.find(entry => entry.provider === ai.provider && entry.id === ai.modelId);
        if (!model?.alias) return undefined;
        return { type: 'pinned', pinnedAlias: model.alias };
    }

    private resolveMaxOutputMode(maxTokens: number): 'auto' | 'high' | 'max' {
        if (maxTokens >= 12000) return 'max';
        if (maxTokens >= 4000) return 'high';
        return 'auto';
    }

    private hashText(input: string): string {
        return fnv1a32HexUnpadded(input);
    }

    private async getExecutionPrecheck(options: {
        aiClient: ReturnType<typeof getAIClient>;
        systemPrompt: string;
        userPrompt: string;
        ai: InquiryRunnerInput['ai'];
        userQuestion?: string;
        jsonSchema: Record<string, unknown>;
        temperature: number;
        maxTokens: number;
        evidenceBlocks?: EvidenceBlock[];
        instructionPrompt?: string;
        cacheableUserInput?: string;
        providerReuseKey?: string;
    }): Promise<
        | {
            ok: true;
            inputTokens: number;
            safeInputTokens: number;
            onePassFit: OnePassFitState;
            exceedsSafeBudget: boolean;
            estimationMethod: TokenEstimateMethod;
            uncertaintyTokens: number;
            preparedEstimate: AIRunPreparedEstimate | null;
        }
        | {
            ok: false;
            reason: string;
        }
    > {
        try {
            const preparedEstimate = await this.prepareInquiryRunEstimate(options.aiClient, {
                task: 'InquiryExecutionPrecheck',
                systemPrompt: options.systemPrompt,
                userPrompt: options.userPrompt,
                userQuestion: options.userQuestion,
                ai: options.ai,
                jsonSchema: options.jsonSchema,
                temperature: options.temperature,
                maxTokens: options.maxTokens,
                evidenceBlocks: options.evidenceBlocks,
                instructionPrompt: options.instructionPrompt,
                cacheableUserInput: options.cacheableUserInput,
                providerReuseKey: options.providerReuseKey,
                // Inquiry requests the full output ceiling up front. The
                // tier-clamped cap saves nothing (billing is per token
                // generated) and only truncates large structured findings;
                // the prepared estimate drives the first pass's output cap.
                forceMaxOutputCeiling: true
            });
            if (!preparedEstimate) {
                throw new Error('prepareRunEstimate unavailable');
            }
            const exceedsSafeBudget = preparedEstimate.tokenEstimateInput > preparedEstimate.effectiveInputCeiling;
            return {
                ok: true,
                inputTokens: preparedEstimate.tokenEstimateInput,
                safeInputTokens: preparedEstimate.effectiveInputCeiling,
                onePassFit: exceedsSafeBudget ? 'overflows' : 'fits',
                exceedsSafeBudget,
                estimationMethod: preparedEstimate.tokenEstimateMethod,
                uncertaintyTokens: preparedEstimate.tokenEstimateUncertainty,
                preparedEstimate
            };
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return {
                ok: false,
                reason: message
            };
        }
    }

    private buildMultiPassFailedResult(
        ai: InquiryRunnerInput['ai'],
        reason: string,
        failureStage: InquiryFailureStage,
        tokenUsageKnown: boolean,
        usage?: InquiryRunTrace['usage'],
        tokenUsageScope?: InquiryTokenUsageScope
    ): ProviderResult {
        const stageLabel = failureStage === 'chunk_execution'
            ? 'chunk execution'
            : failureStage === 'synthesis'
                ? 'synthesis'
                : 'preflight estimation';
        return {
            success: false,
            content: null,
            responseData: null,
            provider: ai.provider,
            modelId: ai.modelId,
            aiProvider: ai.provider,
            aiModelRequested: ai.modelId,
            aiModelResolved: ai.modelId,
            aiStatus: 'rejected',
            aiReason: 'multi_pass_failed',
            error: `The run failed during multi-pass ${stageLabel}. RT did not receive valid structured output for a required pass. This is a multi-pass/parsing failure in the current Inquiry path. Open Inquiry Log for details.`,
            executionPassCount: 1,
            multiPassTriggerReason: reason,
            executionState: 'multi_pass_failed',
            executionPath: 'multi_pass',
            failureStage,
            tokenUsageKnown,
            tokenUsageScope,
            usage
        };
    }

    private withExecutionContext(
        run: AIRunResult,
        context: {
            executionPassCount?: number;
            multiPassTriggerReason?: string;
        }
    ): AIRunResult {
        if (!run.advancedContext) return run;
        return {
            ...run,
            advancedContext: {
                ...run.advancedContext,
                executionPassCount: context.executionPassCount ?? run.advancedContext.executionPassCount,
                multiPassTriggerReason: context.multiPassTriggerReason ?? run.advancedContext.multiPassTriggerReason
            }
        };
    }

    private toProviderResult(
        run: AIRunResult,
        options?: {
            usage?: InquiryRunTrace['usage'];
            tokenUsageScope?: InquiryTokenUsageScope;
        }
    ): ProviderResult {
        const executionPath: InquiryExecutionPath = (run.advancedContext?.executionPassCount ?? 1) > 1
            ? 'multi_pass'
            : 'one_pass';
        const usage = options?.usage ?? this.extractUsage(run.provider, run.responseData);
        const usageKnown = !!usage;
        const preflightBlocked = run.aiStatus === 'rejected'
            && run.aiReason === 'truncated'
            && typeof run.reason === 'string'
            && run.reason.toLowerCase().includes('token guard rejected request before execution');
        const executionState: InquiryExecutionState = preflightBlocked
            ? 'blocked_before_send'
            : 'dispatched_to_provider';
        const failureStage: InquiryFailureStage | undefined = run.aiStatus === 'success'
            ? undefined
            : (preflightBlocked ? 'preflight' : 'provider_response_parsing');
        return {
            success: run.aiStatus === 'success' && !!run.content,
            content: run.content,
            responseData: run.responseData,
            requestPayload: run.requestPayload,
            provider: run.provider === 'none' ? 'openai' : run.provider,
            modelId: run.modelResolved || run.modelRequested,
            aiProvider: run.provider === 'none' ? 'openai' : run.provider,
            aiModelRequested: run.modelRequested,
            aiModelResolved: run.modelResolved || run.modelRequested,
            aiStatus: run.aiStatus,
            aiReason: run.aiReason,
            error: run.error,
            sanitizationNotes: run.sanitizationNotes,
            retryCount: run.retryCount,
            executionPassCount: run.advancedContext?.executionPassCount,
            multiPassTriggerReason: run.advancedContext?.multiPassTriggerReason,
            executionState,
            executionPath,
            failureStage,
            cacheReuseState: run.advancedContext?.reuseState,
            cacheStatus: run.advancedContext?.cacheStatus,
            cacheExpiresAt: run.advancedContext?.cacheExpiresAt,
            cachedStableRatio: run.advancedContext?.cachedStableRatio,
            cachedStableTokens: run.advancedContext?.cachedStableTokens,
            tokenUsageKnown: usageKnown,
            tokenUsageScope: options?.tokenUsageScope,
            usage,
            aiTransportLane: run.aiTransportLane ?? run.advancedContext?.openAiTransportLane,
            citations: run.citations?.map(c => ({ ...c }))
        };
    }

    private async runChunkedInquiry(
        aiClient: ReturnType<typeof getAIClient>,
        options: {
            systemPrompt: string;
            userPrompt: string;
            userQuestion?: string;
            ai: InquiryRunnerInput['ai'];
            jsonSchema: Record<string, unknown>;
            temperature: number;
            maxTokens: number;
            evidenceBlocks?: EvidenceBlock[];
            executionOptions?: InquiryRunExecutionOptions;
            executionPrecheck?: {
                inputTokens: number;
                safeInputTokens: number;
                onePassFit: OnePassFitState;
            };
        }
    ): Promise<MultiPassExecutionResult> {
        const chunkPlan = this.buildEvidenceChunkPrompts(options.userPrompt, {
            maxChunkTokens: 12000,
            estimatedInputTokens: options.executionPrecheck?.inputTokens,
            safeInputTokens: options.executionPrecheck?.safeInputTokens
        });
        if (!chunkPlan || chunkPlan.prompts.length <= 1) {
            console.warn('[Inquiry] Chunked execution aborted: evidence could not be split into multiple chunks.');
            return {
                ok: false,
                failureStage: 'preflight',
                failureReason: 'Evidence could not be split into multiple chunks.',
                tokenUsageKnown: false
            };
        }

        const chunkOutputs: string[] = [];
        const totalPasses = chunkPlan.prompts.length + 1;
        const usageAccumulator = this.createUsageAccumulator(totalPasses);
        const sceneRefLedger = this.buildSceneRefLedger(options.evidenceBlocks);
        for (let i = 0; i < chunkPlan.prompts.length; i += 1) {
            this.throwIfAborted(options.executionOptions?.shouldAbort);
            options.executionOptions?.onProgress?.({
                phase: 'chunk',
                currentPass: i + 1,
                totalPasses,
                chunkIndex: i + 1,
                chunkTotal: chunkPlan.prompts.length,
                detail: `Waiting for pass ${i + 1} of ${totalPasses}.`
            });
            const chunkRun = await this.runInquiryRequest(aiClient, {
                task: `AnalyzeCorpusChunk${i + 1}`,
                systemPrompt: options.systemPrompt,
                userPrompt: chunkPlan.prompts[i],
                userQuestion: options.userQuestion,
                ai: options.ai,
                jsonSchema: options.jsonSchema,
                temperature: options.temperature,
                maxTokens: options.maxTokens,
                forceFreshRun: options.executionOptions?.forceFreshRun
            });
            this.recordUsage(usageAccumulator, this.extractUsage(options.ai.provider, chunkRun.responseData), 'chunk');
            this.throwIfAborted(options.executionOptions?.shouldAbort);
            if (chunkRun.aiStatus !== 'success' || !chunkRun.content) {
                const failureReason = `[Inquiry] Chunk ${i + 1}/${chunkPlan.prompts.length} failed:`
                    + ` status=${chunkRun.aiStatus}, reason=${chunkRun.aiReason ?? 'none'}`
                    + `, error=${chunkRun.error ?? 'none'}`
                    + `, prompt_chars=${chunkPlan.prompts[i].length}`
                    + `, response_chars=${chunkRun.content?.length ?? 0}`;
                console.warn(failureReason);
                if (this.isChunkDebugEnabled() && i === 0) {
                    console.warn('[Inquiry] Chunk 1 prompt (full):');
                    console.warn(chunkPlan.prompts[i]);
                    console.warn('[Inquiry] Chunk 1 raw response (full):');
                    console.warn(chunkRun.content || '<empty>');
                }
                const usageSummary = this.finalizeUsageAccumulator(usageAccumulator);
                return {
                    ok: false,
                    failureStage: 'chunk_execution',
                    failureReason,
                    tokenUsageKnown: usageSummary.tokenUsageKnown,
                    tokenUsageScope: usageSummary.tokenUsageScope,
                    usage: usageSummary.usage
                };
            }
            if (i === 0) {
                const chunkOneHealth = this.assessChunkRefHealth(chunkRun.content, sceneRefLedger.allowedSceneIds);
                if (!chunkOneHealth.ok) {
                    const usageSummary = this.finalizeUsageAccumulator(usageAccumulator);
                    return {
                        ok: false,
                        failureStage: 'chunk_execution',
                        failureReason: `[Inquiry] Chunk 1 health check failed: ${chunkOneHealth.reason}`,
                        tokenUsageKnown: usageSummary.tokenUsageKnown,
                        tokenUsageScope: usageSummary.tokenUsageScope,
                        usage: usageSummary.usage
                    };
                }
            }
            chunkOutputs.push(chunkRun.content);
        }

        const marker = '\nEvidence:\n';
        const splitAt = options.userPrompt.indexOf(marker);
        if (splitAt < 0) {
            const usageSummary = this.finalizeUsageAccumulator(usageAccumulator);
            return {
                ok: false,
                failureStage: 'preflight',
                failureReason: 'Evidence marker missing before synthesis stage.',
                tokenUsageKnown: usageSummary.tokenUsageKnown,
                tokenUsageScope: usageSummary.tokenUsageScope,
                usage: usageSummary.usage
            };
        }
        const prefix = options.userPrompt.slice(0, splitAt + marker.length);
        const synthesisEvidence = [
            sceneRefLedger.synthesisBlock,
            chunkOutputs
                .map((output, index) => `## Pass ${index + 1} result\n${output}`)
                .join('\n\n')
        ]
            .filter(Boolean)
            .join('\n\n');

        this.throwIfAborted(options.executionOptions?.shouldAbort);
        options.executionOptions?.onProgress?.({
            phase: 'synthesis',
            currentPass: totalPasses,
            totalPasses,
            chunkTotal: chunkPlan.prompts.length,
            detail: `Waiting for pass ${totalPasses} of ${totalPasses}.`
        });
        let synthesisRun = await this.runInquiryRequest(aiClient, {
            task: 'SynthesizeChunkAnalyses',
            systemPrompt: options.systemPrompt,
            userPrompt: `${prefix}${synthesisEvidence}`,
            userQuestion: options.userQuestion,
            ai: options.ai,
            jsonSchema: options.jsonSchema,
            temperature: options.temperature,
            maxTokens: options.maxTokens,
            forceFreshRun: options.executionOptions?.forceFreshRun
        });
        this.recordUsage(usageAccumulator, this.extractUsage(options.ai.provider, synthesisRun.responseData), 'synthesis');
        this.throwIfAborted(options.executionOptions?.shouldAbort);

        if (synthesisRun.aiStatus !== 'success' || !synthesisRun.content) {
            const failureReason = `[Inquiry] Synthesis pass failed after ${chunkOutputs.length} successful chunks:`
                + ` status=${synthesisRun.aiStatus}, reason=${synthesisRun.aiReason ?? 'none'}`
                + `, error=${synthesisRun.error ?? 'none'}`;
            console.warn(failureReason);
            const usageSummary = this.finalizeUsageAccumulator(usageAccumulator);
            return {
                ok: false,
                failureStage: 'synthesis',
                failureReason,
                tokenUsageKnown: usageSummary.tokenUsageKnown,
                tokenUsageScope: usageSummary.tokenUsageScope,
                usage: usageSummary.usage
            };
        }

        const passCount = totalPasses;
        const usageSummary = this.finalizeUsageAccumulator(usageAccumulator);
        return {
            ok: true,
            tokenUsageKnown: usageSummary.tokenUsageKnown,
            tokenUsageScope: usageSummary.tokenUsageScope,
            usage: usageSummary.usage,
            run: this.withExecutionContext({
                ...synthesisRun,
                warnings: [...(synthesisRun.warnings || []), `Inquiry chunked execution used ${chunkPlan.prompts.length} chunks before synthesis.`]
            }, {
                    executionPassCount: passCount,
                multiPassTriggerReason: 'Single-pass request exceeded the planning budget, so structured multi-pass analysis and synthesis were used.'
            })
        };
    }

    private throwIfAborted(shouldAbort?: () => boolean): void {
        if (shouldAbort?.()) {
            throw new Error(t('inquiry.runner.runAborted'));
        }
    }

    private buildEvidenceChunkPrompts(
        userPrompt: string,
        options: {
            maxChunkTokens: number;
            estimatedInputTokens?: number;
            safeInputTokens?: number;
        }
    ): ChunkPromptPlan | null {
        const marker = '\nEvidence:\n';
        const splitAt = userPrompt.indexOf(marker);
        if (splitAt < 0) return null;
        const prefix = userPrompt.slice(0, splitAt + marker.length);
        const evidence = userPrompt.slice(splitAt + marker.length).trim();
        if (!evidence) return null;

        const maxChunkTokens = this.resolveChunkTokenBudget({
            defaultChunkTokens: options.maxChunkTokens,
            estimatedInputTokens: options.estimatedInputTokens,
            safeInputTokens: options.safeInputTokens,
            prefixChars: prefix.length,
            evidenceChars: evidence.length
        });
        const maxChars = Math.max(1200, maxChunkTokens * 4);

        // Cascade through splitting strategies until we get multiple sections,
        // then fall back to character-bounded hard-chop. The chunker must
        // produce >= 2 chunks when the multi-pass fallback calls it — even
        // if the evidence has no `## `-heading structure or paragraph breaks
        // for it to lean on.
        let sections: string[] = [evidence];
        for (const splitter of [/\n\n(?=##\s)/g, /\n{2,}/g]) {
            if (sections.length > 1) break;
            const candidate = evidence.split(splitter).filter(Boolean);
            if (candidate.length > 1) sections = candidate;
        }
        if (sections.length <= 1) {
            // Last resort: hard-chop by character count so multi-pass can
            // proceed when the evidence is one giant unbroken blob. The
            // resulting chunks are uglier than heading/paragraph splits but
            // ship the run instead of failing preflight.
            const sliceSize = Math.max(1200, Math.floor(maxChars * 0.9));
            sections = [];
            for (let i = 0; i < evidence.length; i += sliceSize) {
                sections.push(evidence.slice(i, i + sliceSize));
            }
        }
        if (!sections.length) return null;

        const chunks: string[] = [];
        let current = '';

        const pushChunk = (text: string): void => {
            const trimmed = text.trim();
            if (trimmed.length > 0) chunks.push(trimmed);
        };

        const pushSection = (section: string): void => {
            const candidate = current ? `${current}\n\n${section}` : section;
            if (candidate.length <= maxChars) {
                current = candidate;
                return;
            }
            if (current) {
                pushChunk(current);
                current = '';
            }
            if (section.length <= maxChars) {
                current = section;
                return;
            }
            const paragraphs = section.split(/\n{2,}/g).filter(Boolean);
            let subCurrent = '';
            paragraphs.forEach(paragraph => {
                const subCandidate = subCurrent ? `${subCurrent}\n\n${paragraph}` : paragraph;
                if (subCandidate.length <= maxChars) {
                    subCurrent = subCandidate;
                } else {
                    pushChunk(subCurrent || paragraph.slice(0, maxChars));
                    subCurrent = paragraph.length > maxChars ? paragraph.slice(0, maxChars) : paragraph;
                }
            });
            if (subCurrent) pushChunk(subCurrent);
        };

        sections.forEach(pushSection);
        if (current) pushChunk(current);

        const safeInputTokens = Number.isFinite(options.safeInputTokens)
            ? Math.max(0, Math.floor(options.safeInputTokens as number))
            : 0;
        const estimatedInputTokens = Number.isFinite(options.estimatedInputTokens)
            ? Math.max(0, Math.floor(options.estimatedInputTokens as number))
            : 0;
        const targetPasses = safeInputTokens > 0 && estimatedInputTokens > 0
            ? Math.max(2, Math.ceil(estimatedInputTokens / safeInputTokens))
            : null;

        return {
            prompts: chunks.map(chunk => `${prefix}${chunk}`),
            maxChunkTokens,
            maxChunkChars: maxChars,
            evidenceChars: evidence.length,
            prefixChars: prefix.length,
            targetPasses
        };
    }

    private resolveChunkTokenBudget(params: {
        defaultChunkTokens: number;
        estimatedInputTokens?: number;
        safeInputTokens?: number;
        prefixChars: number;
        evidenceChars: number;
    }): number {
        const defaultChunkTokens = Math.max(1200, Math.floor(params.defaultChunkTokens));
        const safeInputTokens = Number.isFinite(params.safeInputTokens)
            ? Math.max(0, Math.floor(params.safeInputTokens as number))
            : 0;
        if (safeInputTokens <= 0) return defaultChunkTokens;

        const evidenceTokens = Math.max(1, estimateTokensFromChars(params.evidenceChars));
        const prefixTokens = Math.max(1, estimateTokensFromChars(params.prefixChars));
        const headroomTokens = Math.max(1500, Math.floor(safeInputTokens * 0.15));
        const safeEvidenceBudget = Math.max(1200, safeInputTokens - prefixTokens - headroomTokens);
        let targetChunkTokens = Math.max(defaultChunkTokens, safeEvidenceBudget);

        const estimatedInputTokens = Number.isFinite(params.estimatedInputTokens)
            ? Math.max(0, Math.floor(params.estimatedInputTokens as number))
            : 0;
        if (estimatedInputTokens > 0) {
            const targetPasses = Math.max(2, Math.ceil(estimatedInputTokens / safeInputTokens));
            const targetPerPassEvidence = Math.max(1200, Math.ceil(evidenceTokens / targetPasses));
            targetChunkTokens = Math.min(targetChunkTokens, targetPerPassEvidence);
        }

        return Math.max(1200, Math.min(120000, targetChunkTokens));
    }

    private isChunkDebugEnabled(): boolean {
        const fromEnv = typeof process !== 'undefined' && process.env?.RT_INQUIRY_CHUNK_DEBUG === '1';
        const fromGlobal = (window as { __RT_INQUIRY_CHUNK_DEBUG__?: unknown }).__RT_INQUIRY_CHUNK_DEBUG__ === true;
        return fromEnv || fromGlobal;
    }

    private createUsageAccumulator(totalPasses: number): UsageAccumulator {
        return {
            totalPasses,
            passesWithAnyUsage: 0,
            passesWithInput: 0,
            passesWithOutput: 0,
            passesWithTotal: 0,
            passesWithCacheAwareUsage: 0,
            synthesisHasUsage: false,
            chunkHasUsage: false,
            inputTokens: 0,
            outputTokens: 0,
            totalTokens: 0,
            rawInputTokens: 0,
            cacheReadInputTokens: 0,
            cacheCreationInputTokens: 0
        };
    }

    private recordUsage(
        accumulator: UsageAccumulator,
        usage: InquiryRunTrace['usage'] | undefined,
        phase: 'chunk' | 'synthesis'
    ): void {
        if (!usage) return;
        accumulator.passesWithAnyUsage += 1;
        if (typeof usage.inputTokens === 'number') {
            accumulator.passesWithInput += 1;
            accumulator.inputTokens += usage.inputTokens;
        }
        if (typeof usage.outputTokens === 'number') {
            accumulator.passesWithOutput += 1;
            accumulator.outputTokens += usage.outputTokens;
        }
        if (typeof usage.totalTokens === 'number') {
            accumulator.passesWithTotal += 1;
            accumulator.totalTokens += usage.totalTokens;
        }
        const hasCacheAwareUsage = typeof usage.rawInputTokens === 'number'
            || typeof usage.cacheReadInputTokens === 'number'
            || typeof usage.cacheCreationInputTokens === 'number';
        if (hasCacheAwareUsage) {
            accumulator.passesWithCacheAwareUsage += 1;
            accumulator.rawInputTokens += usage.rawInputTokens ?? 0;
            accumulator.cacheReadInputTokens += usage.cacheReadInputTokens ?? 0;
            accumulator.cacheCreationInputTokens += usage.cacheCreationInputTokens ?? 0;
        }
        if (phase === 'synthesis') {
            accumulator.synthesisHasUsage = true;
        } else {
            accumulator.chunkHasUsage = true;
        }
    }

    private finalizeUsageAccumulator(accumulator: UsageAccumulator): {
        tokenUsageKnown: boolean;
        tokenUsageScope?: InquiryTokenUsageScope;
        usage?: InquiryRunTrace['usage'];
    } {
        if (accumulator.passesWithAnyUsage <= 0) {
            return { tokenUsageKnown: false };
        }

        const synthesisOnly = accumulator.passesWithAnyUsage === 1
            && accumulator.synthesisHasUsage
            && !accumulator.chunkHasUsage;
        const fullInputKnown = accumulator.passesWithInput === accumulator.totalPasses;
        const fullOutputKnown = accumulator.passesWithOutput === accumulator.totalPasses;
        const fullTotalKnown = accumulator.passesWithTotal === accumulator.totalPasses
            || (fullInputKnown && fullOutputKnown);
        const fullCacheAwareKnown = accumulator.passesWithCacheAwareUsage === accumulator.totalPasses;
        const usageScope: InquiryTokenUsageScope = synthesisOnly
            ? 'synthesis_only'
            : (accumulator.passesWithAnyUsage === accumulator.totalPasses && fullTotalKnown
                ? 'full'
                : 'partial');
        const usage = synthesisOnly
            ? {
                inputTokens: accumulator.passesWithInput > 0 ? accumulator.inputTokens : undefined,
                outputTokens: accumulator.passesWithOutput > 0 ? accumulator.outputTokens : undefined,
                totalTokens: accumulator.passesWithTotal > 0
                    ? accumulator.totalTokens
                    : (accumulator.passesWithInput > 0 && accumulator.passesWithOutput > 0
                        ? accumulator.inputTokens + accumulator.outputTokens
                        : undefined),
                rawInputTokens: accumulator.passesWithCacheAwareUsage > 0
                    ? accumulator.rawInputTokens
                    : undefined,
                cacheReadInputTokens: accumulator.passesWithCacheAwareUsage > 0
                    ? accumulator.cacheReadInputTokens
                    : undefined,
                cacheCreationInputTokens: accumulator.passesWithCacheAwareUsage > 0
                    ? accumulator.cacheCreationInputTokens
                    : undefined
            }
            : {
                inputTokens: fullInputKnown ? accumulator.inputTokens : undefined,
                outputTokens: fullOutputKnown ? accumulator.outputTokens : undefined,
                totalTokens: fullTotalKnown
                    ? (accumulator.passesWithTotal === accumulator.totalPasses
                        ? accumulator.totalTokens
                        : accumulator.inputTokens + accumulator.outputTokens)
                    : undefined,
                rawInputTokens: fullCacheAwareKnown ? accumulator.rawInputTokens : undefined,
                cacheReadInputTokens: fullCacheAwareKnown ? accumulator.cacheReadInputTokens : undefined,
                cacheCreationInputTokens: fullCacheAwareKnown ? accumulator.cacheCreationInputTokens : undefined
            };
        return {
            tokenUsageKnown: true,
            tokenUsageScope: usageScope,
            usage
        };
    }

    private parseResponse(content: string): RawInquiryResponse {
        return this.parseJsonFromContent<RawInquiryResponse>(content);
    }

    private parseOmnibusResponse(content: string): RawOmnibusResponse {
        return this.parseJsonFromContent<RawOmnibusResponse>(content);
    }

    private parseJsonFromContent<T>(content: string): T {
        const jsonText = this.extractJson(content);
        if (!jsonText) {
            throw new Error(t('inquiry.runner.jsonNotFound'));
        }
        return JSON.parse(jsonText) as T;
    }

    private extractJson(content: string): string | null {
        const trimmed = content.trim();
        if (!trimmed) return null;
        const blockMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (blockMatch) {
            return blockMatch[1].trim();
        }
        const firstBrace = trimmed.indexOf('{');
        const lastBrace = trimmed.lastIndexOf('}');
        if (firstBrace >= 0 && lastBrace > firstBrace) {
            return trimmed.slice(firstBrace, lastBrace + 1);
        }
        return null;
    }

    private buildSceneRefLedger(evidenceBlocks?: EvidenceBlock[]): SceneRefLedger {
        const allowedSceneIds = new Set<string>();
        const ledgerLines: string[] = [];
        (evidenceBlocks || []).forEach(block => {
            const meta = block.meta;
            if (!meta || meta.evidenceClass !== 'scene' || !isStableSceneId(meta.sceneId)) return;
            const sceneId = String(meta.sceneId).trim().toLowerCase();
            if (allowedSceneIds.has(sceneId)) return;
            allowedSceneIds.add(sceneId);
            const title = (meta.title || '').replace(/\s+/g, ' ').trim() || sceneId;
            const path = (meta.path || '').trim();
            ledgerLines.push(path ? `- ${sceneId} | ${title} | ${path}` : `- ${sceneId} | ${title}`);
        });
        const synthesisBlock = ledgerLines.length
            ? [
                'Allowed scene refs for findings:',
                'Reuse only these exact ref_id values in the final result.',
                ...ledgerLines
            ].join('\n')
            : '';
        return { allowedSceneIds, synthesisBlock };
    }

    private assessChunkRefHealth(
        content: string,
        allowedSceneIds: Set<string>
    ): { ok: true } | { ok: false; reason: string } {
        let parsed: RawInquiryResponse;
        try {
            parsed = this.parseResponse(content);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return { ok: false, reason: `pass 1 could not be parsed (${message}).` };
        }

        const findings = Array.isArray(parsed.findings) ? parsed.findings : [];
        const invalidRefs = findings
            .map(finding => String(finding.ref_id || '').trim().toLowerCase())
            .filter(refId => !!refId && isStableSceneId(refId) && !allowedSceneIds.has(refId));

        if (invalidRefs.length) {
            return { ok: false, reason: `pass 1 returned scene refs outside the active corpus: ${invalidRefs.join(', ')}.` };
        }

        const stableRefs = findings
            .map(finding => String(finding.ref_id || '').trim().toLowerCase())
            .filter(refId => !!refId && isStableSceneId(refId));
        const bindableStableRefs = stableRefs.filter(refId => allowedSceneIds.has(refId));

        if (stableRefs.length > 0 && bindableStableRefs.length === 0) {
            return { ok: false, reason: 'pass 1 returned findings, but none referenced a valid scene in the active corpus.' };
        }

        return { ok: true };
    }

    private buildResult(
        input: InquiryRunnerInput,
        parsed: RawInquiryResponse,
        aiMeta: Pick<InquiryResult, 'aiProvider' | 'aiModelRequested' | 'aiModelResolved' | 'aiStatus' | 'aiReason'>,
        citations?: InquiryCitation[],
        evidenceDocumentMeta?: EvidenceDocumentMeta[],
        tokenUsage?: InquiryRunTrace['usage']
    ): InquiryResult {
        // Flat verdictFlow/verdictDepth is the reliable shape; fall back to
        // the legacy nested verdict object for older responses. The nested
        // shape was dropped because Opus 4.8 leaks tool-call XML into it
        // (verdict became a string, flow/depth → undefined → score 0).
        const flow = this.normalizeScore(parsed.verdictFlow ?? parsed.verdict?.flow);
        const depth = this.normalizeScore(parsed.verdictDepth ?? parsed.verdict?.depth);

        const findings = Array.isArray(parsed.findings) ? parsed.findings : [];
        const sceneRefIndex = this.buildCanonicalSceneRefIndex(input);
        const bookRefIndex = input.scope === 'saga' ? this.buildCanonicalBookRefIndex(input) : undefined;
        const partition = input.scope === 'saga' && bookRefIndex
            ? this.verifyFindingRefs(findings, bookRefIndex, {
                primaryRefType: 'book',
                supportingSceneRefIndex: sceneRefIndex,
                supportingBookRefIndex: bookRefIndex
            })
            : this.verifyFindingRefs(findings, sceneRefIndex, {
                primaryRefType: 'scene',
                supportingSceneRefIndex: sceneRefIndex
            });
        const roleValidation = this.computeRoleValidation(input.selectionMode, partition.verified);

        const summaryFlow = parsed.summaryFlow
            ? String(parsed.summaryFlow)
            : (parsed.summary ? String(parsed.summary) : t('inquiry.runner.noSummaryProvided'));
        const summaryDepth = parsed.summaryDepth
            ? String(parsed.summaryDepth)
            : (parsed.summary ? String(parsed.summary) : summaryFlow);
        const summary = parsed.summary
            ? String(parsed.summary)
            : (summaryFlow || summaryDepth || t('inquiry.runner.noSummaryProvided'));

        const result: InquiryResult = {
            runId: `run-${Date.now()}`,
            scope: input.scope,
            scopeLabel: input.scopeLabel,
            mode: input.mode,
            selectionMode: input.selectionMode,
            roleValidation,
            questionId: input.questionId,
            questionText: input.questionText,
            questionPromptForm: input.questionPromptForm,
            questionZone: input.questionZone,
            summary,
            summaryFlow,
            summaryDepth,
            verdict: {
                flow,
                depth
            },
            findings: partition.verified,
            corpusFingerprint: input.corpus.fingerprint,
            cacheReuseFingerprint: input.corpus.cacheReuseFingerprint,
            ...aiMeta,
            ...(tokenUsage ? { tokenUsage } : {}),
            ...(partition.unverified.length ? { unverifiedFindings: partition.unverified } : {}),
            ...(partition.warnings.length ? { citationIntegrityWarnings: partition.warnings } : {}),
            ...(partition.repairs.length ? { citationRepairs: partition.repairs } : {}),
            ...(citations?.length ? { citations } : {}),
            ...(evidenceDocumentMeta?.length ? { evidenceDocumentMeta } : {})
        };

        if (partition.warnings.length > 0 || partition.unverified.length > 0) {
            const summaryCounts = computeCitationIntegritySummary(result);
            console.warn(
                `[Inquiry] Citation integrity: verified=${summaryCounts.verifiedCount} rescued=${summaryCounts.rescuedCount} unverified=${summaryCounts.unverifiedCount} mismatch=${summaryCounts.mismatchCount}${summaryCounts.evidenceCompromised ? ' (EVIDENCE COMPROMISED)' : ''}`
            );
        }

        return result;
    }

    private buildOmnibusResults(
        input: InquiryOmnibusInput,
        parsed: RawOmnibusResponse,
        aiMeta: Pick<InquiryResult, 'aiProvider' | 'aiModelRequested' | 'aiModelResolved' | 'aiStatus' | 'aiReason'>,
        trace: InquiryRunTrace,
        citations?: InquiryCitation[],
        evidenceDocumentMeta?: EvidenceDocumentMeta[]
    ): InquiryResult[] {
        const results = Array.isArray(parsed.results) ? parsed.results : [];
        const resultsById = new Map<string, RawOmnibusQuestionResult>();
        const resultsByIndex = new Map<number, RawOmnibusQuestionResult>();

        results.forEach((entry, index) => {
            const id = typeof entry.question_id === 'string'
                ? entry.question_id
                : (typeof entry.questionId === 'string' ? entry.questionId : '');
            if (id) {
                resultsById.set(id, entry);
                return;
            }
            resultsByIndex.set(index, entry);
        });

        const built: InquiryResult[] = [];
        input.questions.forEach((question, index) => {
            const raw = resultsById.get(question.id) ?? resultsByIndex.get(index);
            const questionInput = this.buildOmnibusQuestionInput(input, question);
            if (!raw) {
                trace.notes.push(`Omnibus response missing question: ${question.id}.`);
                built.push(this.buildOmnibusMissingResult(questionInput, aiMeta));
                return;
            }
            built.push(this.buildResult(questionInput, raw, aiMeta, citations, evidenceDocumentMeta, trace.usage));
        });

        return built;
    }

    private buildOmnibusStubResults(
        input: InquiryOmnibusInput,
        aiMeta: Pick<InquiryResult, 'aiProvider' | 'aiModelRequested' | 'aiModelResolved' | 'aiStatus' | 'aiReason'>,
        error?: unknown
    ): InquiryResult[] {
        return input.questions.map(question => {
            const questionInput = this.buildOmnibusQuestionInput(input, question);
            return this.buildStubResult(questionInput, aiMeta, error);
        });
    }

    private buildOmnibusMissingResult(
        input: InquiryRunnerInput,
        aiMeta: Pick<InquiryResult, 'aiProvider' | 'aiModelRequested' | 'aiModelResolved' | 'aiStatus' | 'aiReason'>
    ): InquiryResult {
        const fallbackMeta = {
            ...aiMeta,
            aiStatus: 'rejected' as InquiryAiStatus,
            aiReason: 'invalid_response'
        };
        return this.buildStubResult(input, fallbackMeta, new Error('Omnibus response missing this question.'));
    }

    private buildOmnibusQuestionInput(
        input: InquiryOmnibusInput,
        question: InquiryOmnibusQuestion
    ): InquiryRunnerInput {
        return {
            scope: input.scope,
            scopeLabel: input.scopeLabel,
            targetSceneIds: input.targetSceneIds,
            selectionMode: input.selectionMode,
            activeBookId: input.activeBookId,
            mode: input.mode,
            questionId: question.id,
            questionText: question.questionText,
            questionPromptForm: question.questionPromptForm,
            questionZone: question.zone,
            corpus: input.corpus,
            rules: input.rules,
            ai: input.ai,
            citationsEnabled: input.citationsEnabled
        };
    }

    /**
     * Splits raw AI findings into verified (in-corpus) and unverified (fabricated
     * or unresolvable) sets. Never throws. Preserves raw ref values on rescued
     * findings so the UI can distinguish "AI cited it this way, we matched it
     * to that" from a clean citation.
     *
     * Rescue policy: we only accept the resolution produced by
     * sceneRefNormalizer, which itself requires a single unambiguous match
     * (exact id / path / label, or scene-number disambiguated by slug, or a
     * normalized-key lookup that returns exactly one entry). Ambiguous matches
     * are treated as unverified.
     */
    private verifyFindingRefs(
        rawFindings: RawInquiryFinding[],
        primaryRefIndex: ReturnType<typeof buildSceneRefIndex> | BookRefIndex,
        options: RefVerificationOptions = {}
    ): {
        verified: InquiryFinding[];
        unverified: UnverifiedCitation[];
        warnings: CitationIntegrityWarning[];
        repairs: CitationRepairDiagnostic[];
    } {
        const verified: InquiryFinding[] = [];
        const unverified: UnverifiedCitation[] = [];
        const warnings: CitationIntegrityWarning[] = [];
        const repairs: CitationRepairDiagnostic[] = [];
        const primaryRefType = options.primaryRefType ?? 'scene';

        rawFindings.forEach(raw => {
            const rawHeadline = typeof raw.headline === 'string' ? raw.headline.trim() : '';
            const bullets = Array.isArray(raw.bullets)
                ? raw.bullets.map(value => String(value).trim()).filter(Boolean)
                : [];
            const recommendedAction = typeof raw.recommended_action === 'string'
                ? raw.recommended_action.trim()
                : '';
            const evidenceQuote = typeof raw.evidence_quote === 'string'
                ? raw.evidence_quote.trim()
                : '';

            if (!rawHeadline && !bullets.length && !recommendedAction && !evidenceQuote) {
                return;
            }

            const rawRefId = raw.ref_id ? String(raw.ref_id) : undefined;
            const rawRefLabel = raw.ref_label ? String(raw.ref_label) : undefined;
            const rawRefPath = raw.ref_path ? String(raw.ref_path) : undefined;

            const normalized = primaryRefType === 'book'
                ? this.normalizeBookRef({
                    ref_id: rawRefId,
                    ref_label: rawRefLabel,
                    ref_path: rawRefPath
                }, primaryRefIndex as BookRefIndex)
                : normalizeSceneRef({
                    ref_id: rawRefId,
                    ref_label: rawRefLabel,
                    ref_path: rawRefPath
                }, primaryRefIndex as ReturnType<typeof buildSceneRefIndex>);

            const kind = this.normalizeFindingKind(raw.kind);
            const lens = this.normalizeFindingLens(raw.lens);
            const role = this.normalizeFindingRole(raw.role);
            const headline = rawHeadline || 'Finding';
            const subject = typeof raw.subject === 'string' ? raw.subject.trim() : '';
            const span = typeof raw.span === 'string' ? raw.span.trim() : '';

            if (normalized.unresolved) {
                const offendingRef = rawRefId || rawRefLabel || rawRefPath || '(missing ref)';
                const warningMessage = normalized.warning
                    || `AI citation "${offendingRef}" could not be matched to a scene in the active corpus.`;
                if (normalized.warning) {
                    console.warn(`[Inquiry] ${normalized.warning}`);
                }
                unverified.push({
                    rawRefId,
                    rawRefLabel,
                    rawRefPath,
                    kind,
                    headline,
                    bullets,
                    lens,
                    role,
                    warning: warningMessage
                });
                warnings.push({
                    stage: 'unresolved_ref',
                    message: `AI citation "${offendingRef}" could not be matched to the active corpus.`
                });
                return;
            }

            const rescued = normalized.normalizedFromLegacy;
            if (normalized.warning) {
                console.warn(`[Inquiry] ${normalized.warning}`);
            }

            const finding: InquiryFinding = {
                refId: normalized.ref.ref_id,
                kind,
                headline,
                bullets,
                ...(recommendedAction ? { recommendedAction } : {}),
                ...(subject ? { subject } : {}),
                ...(span ? { span } : {}),
                related: [],
                ...this.normalizeSupportingRefs(raw.supporting_refs, options, warnings),
                evidenceType: 'mixed',
                lens,
                role,
                ...(evidenceQuote ? { evidenceQuote } : {})
            };
            if (rescued && (rawRefId || rawRefLabel || rawRefPath)) {
                finding.rawRef = {
                    ...(rawRefId ? { refId: rawRefId } : {}),
                    ...(rawRefLabel ? { refLabel: rawRefLabel } : {}),
                    ...(rawRefPath ? { refPath: rawRefPath } : {})
                };
                // Deterministic repair (unique label/path match) — NOT a trust
                // failure. Record as an internal diagnostic so the malformed
                // original is auditable, but do NOT push an author-facing
                // citation-integrity warning (which would falsely flag the
                // finding as untrusted). The finding stays fully usable.
                const rawRefForDiag = rawRefId || rawRefLabel || rawRefPath || '(missing ref)';
                repairs.push({ rawRef: rawRefForDiag, canonicalRef: normalized.ref.ref_id });
                console.warn(`[Inquiry] AI citation "${rawRefForDiag}" could not be matched directly; repaired to ${normalized.ref.ref_id} via label/path.`);
            }

            const mismatch = primaryRefType === 'book'
                ? this.detectBookRefMismatch(
                    { rawRefId, rawRefLabel, rawRefPath },
                    normalized.ref.ref_id,
                    primaryRefIndex as BookRefIndex
                )
                : this.detectRefMismatch(
                    { rawRefId, rawRefLabel, rawRefPath },
                    normalized.ref.ref_id,
                    primaryRefIndex as ReturnType<typeof buildSceneRefIndex>
                );
            if (mismatch) {
                warnings.push(mismatch);
                finding.rawRef = {
                    ...(finding.rawRef || {}),
                    ...(rawRefId ? { refId: rawRefId } : {}),
                    ...(rawRefLabel ? { refLabel: rawRefLabel } : {}),
                    ...(rawRefPath ? { refPath: rawRefPath } : {})
                };
            }

            verified.push(finding);
        });

        return { verified, unverified, warnings, repairs };
    }

    private normalizeSupportingRefs(
        rawRefs: RawInquirySupportingRef[] | undefined,
        options: RefVerificationOptions,
        warnings: CitationIntegrityWarning[]
    ): Pick<InquiryFinding, 'supportingRefs'> {
        if (!Array.isArray(rawRefs) || rawRefs.length === 0) return {};
        const supportingRefs: NonNullable<InquiryFinding['supportingRefs']> = [];
        rawRefs.forEach(raw => {
            const rawRefId = raw.ref_id ? String(raw.ref_id) : undefined;
            const rawRefLabel = raw.ref_label ? String(raw.ref_label) : undefined;
            const rawRefPath = raw.ref_path ? String(raw.ref_path) : undefined;
            const quote = typeof raw.quote === 'string' ? raw.quote.trim() : '';

            const sceneResolved = options.supportingSceneRefIndex
                ? normalizeSceneRef({
                    ref_id: rawRefId,
                    ref_label: rawRefLabel,
                    ref_path: rawRefPath
                }, options.supportingSceneRefIndex)
                : null;
            if (sceneResolved && !sceneResolved.unresolved) {
                supportingRefs.push({
                    refId: sceneResolved.ref.ref_id,
                    ...(sceneResolved.ref.ref_label ? { refLabel: sceneResolved.ref.ref_label } : {}),
                    ...(sceneResolved.ref.ref_path ? { refPath: sceneResolved.ref.ref_path } : {}),
                    ...(quote ? { quote } : {})
                });
                return;
            }

            const bookResolved = options.supportingBookRefIndex
                ? this.normalizeBookRef({
                    ref_id: rawRefId,
                    ref_label: rawRefLabel,
                    ref_path: rawRefPath
                }, options.supportingBookRefIndex)
                : null;
            if (bookResolved && !bookResolved.unresolved) {
                supportingRefs.push({
                    refId: bookResolved.ref.ref_id,
                    ...(bookResolved.ref.ref_label ? { refLabel: bookResolved.ref.ref_label } : {}),
                    ...(bookResolved.ref.ref_path ? { refPath: bookResolved.ref.ref_path } : {}),
                    ...(quote ? { quote } : {})
                });
                return;
            }

            const offendingRef = rawRefId || rawRefLabel || rawRefPath || '(missing supporting ref)';
            warnings.push({
                stage: 'unresolved_ref',
                message: `AI supporting citation "${offendingRef}" could not be matched to the active corpus. Keeping the primary finding bound.`
            });
        });
        return supportingRefs.length ? { supportingRefs } : {};
    }

    /**
     * Detects when ref_id resolves to scene A but ref_label or ref_path
     * resolves to a different scene B. The ref_id is trusted (deterministic
     * id), but the mismatch is recorded so the author can see the model's
     * label/path was inconsistent with its id.
     */
    private detectRefMismatch(
        raw: { rawRefId?: string; rawRefLabel?: string; rawRefPath?: string },
        resolvedRefId: string,
        sceneRefIndex: ReturnType<typeof buildSceneRefIndex>
    ): CitationIntegrityWarning | null {
        if (!raw.rawRefLabel && !raw.rawRefPath) return null;
        const nonIdResolved = normalizeSceneRef({
            ref_label: raw.rawRefLabel,
            ref_path: raw.rawRefPath
        }, sceneRefIndex);
        if (nonIdResolved.unresolved) return null;
        if (!nonIdResolved.ref.ref_id) return null;
        if (nonIdResolved.ref.ref_id === resolvedRefId) return null;
        const labelDesc = raw.rawRefLabel ? `ref_label="${raw.rawRefLabel}"` : '';
        const pathDesc = raw.rawRefPath ? `ref_path="${raw.rawRefPath}"` : '';
        const descriptor = [labelDesc, pathDesc].filter(Boolean).join(' / ');
        return {
            stage: 'ref_label_mismatch',
            message: `AI returned a valid scene id with mismatched label/path metadata: ref_id ${resolvedRefId}, but ${descriptor} points to ${nonIdResolved.ref.ref_id}. Trusting ref_id.`
        };
    }

    private detectBookRefMismatch(
        raw: { rawRefId?: string; rawRefLabel?: string; rawRefPath?: string },
        resolvedRefId: string,
        bookRefIndex: BookRefIndex
    ): CitationIntegrityWarning | null {
        if (!raw.rawRefLabel && !raw.rawRefPath) return null;
        const nonIdResolved = this.normalizeBookRef({
            ref_label: raw.rawRefLabel,
            ref_path: raw.rawRefPath
        }, bookRefIndex);
        if (nonIdResolved.unresolved) return null;
        if (!nonIdResolved.ref.ref_id) return null;
        if (nonIdResolved.ref.ref_id === resolvedRefId) return null;
        const labelDesc = raw.rawRefLabel ? `ref_label="${raw.rawRefLabel}"` : '';
        const pathDesc = raw.rawRefPath ? `ref_path="${raw.rawRefPath}"` : '';
        const descriptor = [labelDesc, pathDesc].filter(Boolean).join(' / ');
        return {
            stage: 'ref_label_mismatch',
            message: `AI returned a valid book id with mismatched label/path metadata: ref_id ${resolvedRefId}, but ${descriptor} points to ${nonIdResolved.ref.ref_id}. Trusting ref_id.`
        };
    }

    private buildCanonicalSceneRefIndex(input: InquiryRunnerInput): ReturnType<typeof buildSceneRefIndex> {
        type SceneRefIndexEntry = Parameters<typeof buildSceneRefIndex>[0][number];
        const entries: SceneRefIndexEntry[] = [];

        input.corpus.entries
            .filter(entry => entry.class === 'scene')
            .forEach(entry => {
                const sceneId = this.resolveCanonicalSceneId(entry.sceneId);
                if (!sceneId) return;
                const file = this.vault.getAbstractFileByPath(entry.path);
                const filename = entry.path.split('/').pop() || entry.path;
                const stem = filename.replace(/\.[^.]+$/i, '');
                let title = stem;
                let sceneNumber: number | undefined;
                const aliases = new Set<string>([filename, stem]);

                if (file && this.isTFile(file)) {
                    const frontmatter = this.getFrontmatter(file);
                    title = this.getSceneTitle(file, frontmatter) || stem;
                    sceneNumber = this.extractSceneNumber(frontmatter) ?? this.extractSceneNumberFromText(file.basename);
                    aliases.add(file.basename);
                    aliases.add(file.path);
                } else {
                    sceneNumber = this.extractSceneNumberFromText(stem);
                }

                if (title) aliases.add(title);
                if (sceneNumber !== undefined) {
                    aliases.add(String(sceneNumber));
                    aliases.add(`S${sceneNumber}`);
                    aliases.add(`Scene ${sceneNumber}`);
                }

                entries.push({
                    sceneId,
                    path: entry.path,
                    label: filename,
                    sceneNumber,
                    title,
                    aliases: Array.from(aliases)
                });
            });

        return buildSceneRefIndex(entries);
    }

    private buildCanonicalBookRefIndex(input: InquiryRunnerInput): BookRefIndex {
        const entries: BookRefEntry[] = [];
        const seen = new Set<string>();
        input.corpus.entries
            .filter(entry => entry.class === 'book')
            .forEach(entry => {
                const path = entry.path.trim();
                if (!path || seen.has(path)) return;
                seen.add(path);
                const bookId = this.resolveCanonicalBookId(entry.sceneId) ?? buildInquiryBookAnchorId(path);
                const label = this.buildBookLabelForEntry(entry, entries.length + 1);
                entries.push({
                    bookId,
                    path,
                    label,
                    title: label,
                    aliases: [path, label, `Book ${entries.length + 1}`]
                });
            });
        return this.buildBookRefIndex(entries);
    }

    private buildBookLabelForEntry(entry: CorpusManifestEntry, fallbackIndex: number): string {
        const number = this.extractBookNumberFromPath(entry.path) ?? fallbackIndex;
        return `B${this.clampLabelNumber(number)}`;
    }

    private extractBookNumberFromPath(path: string): number | undefined {
        const parts = path.split('/').filter(Boolean);
        for (const part of parts) {
            const match = BOOK_FOLDER_REGEX.exec(part);
            if (!match) continue;
            const parsed = Number(match[1]);
            if (Number.isFinite(parsed)) return Math.max(1, Math.floor(parsed));
        }
        return undefined;
    }

    private buildBookRefIndex(entries: BookRefEntry[]): BookRefIndex {
        const byBookId = new Map<string, BookRefEntry>();
        const byPath = new Map<string, BookRefEntry>();
        const byLabel = new Map<string, BookRefEntry>();
        const byNormalizedKey = new Map<string, BookRefEntry[]>();
        entries.forEach(entry => {
            const bookId = this.resolveCanonicalBookId(entry.bookId);
            const path = this.normalizeRefText(entry.path);
            if (!bookId || !path) return;
            const canonical: BookRefEntry = {
                bookId,
                path,
                label: this.normalizeRefText(entry.label),
                title: this.normalizeRefText(entry.title),
                aliases: (entry.aliases || []).map(alias => this.normalizeRefText(alias)).filter((alias): alias is string => !!alias)
            };
            byBookId.set(bookId.toLowerCase(), canonical);
            byPath.set(path.toLowerCase(), canonical);
            if (canonical.label) {
                byLabel.set(canonical.label.toLowerCase(), canonical);
            }
            this.addBookNormalizedKey(byNormalizedKey, canonical, canonical.bookId);
            this.addBookNormalizedKey(byNormalizedKey, canonical, canonical.path);
            this.addBookNormalizedKey(byNormalizedKey, canonical, canonical.label);
            this.addBookNormalizedKey(byNormalizedKey, canonical, canonical.title);
            (canonical.aliases || []).forEach(alias => this.addBookNormalizedKey(byNormalizedKey, canonical, alias));
        });
        return { byBookId, byPath, byLabel, byNormalizedKey };
    }

    private normalizeBookRef(
        input: { ref_id?: string; ref_label?: string; ref_path?: string },
        index: BookRefIndex
    ): {
        ref: { ref_id: string; ref_label?: string; ref_path?: string };
        normalizedFromLegacy: boolean;
        unresolved: boolean;
        warning?: string;
    } {
        const rawRefId = this.normalizeRefText(input.ref_id);
        const rawRefPath = this.normalizeRefText(input.ref_path);
        const rawRefLabel = this.normalizeRefText(input.ref_label);
        if (rawRefId && index.byBookId.has(rawRefId.toLowerCase())) {
            return {
                ref: { ref_id: rawRefId.toLowerCase(), ref_label: rawRefLabel, ref_path: rawRefPath },
                normalizedFromLegacy: false,
                unresolved: false
            };
        }
        const candidates = [rawRefId, rawRefPath, rawRefLabel].filter((value): value is string => !!value);
        for (const candidate of candidates) {
            const resolved = this.resolveBookCandidate(candidate, index);
            if (resolved) {
                return {
                    ref: {
                        ref_id: resolved.bookId,
                        ref_label: rawRefLabel ?? resolved.label,
                        ref_path: rawRefPath ?? resolved.path
                    },
                    normalizedFromLegacy: true,
                    unresolved: false,
                    warning: `Normalized book reference "${candidate}" to ${resolved.bookId}.`
                };
            }
        }
        return {
            ref: { ref_id: '', ref_label: rawRefLabel, ref_path: rawRefPath },
            normalizedFromLegacy: true,
            unresolved: true,
            warning: rawRefId
                ? `Could not resolve "${rawRefId}" to a canonical book id; leaving finding unbound.`
                : 'Missing book reference id; leaving finding unbound.'
        };
    }

    private resolveBookCandidate(candidate: string, index: BookRefIndex): BookRefEntry | undefined {
        const exact = candidate.toLowerCase();
        const byBookId = index.byBookId.get(exact);
        if (byBookId) return byBookId;
        const byPath = index.byPath.get(exact);
        if (byPath) return byPath;
        const byLabel = index.byLabel.get(exact);
        if (byLabel) return byLabel;
        const normalized = this.normalizeBookLookupKey(candidate);
        if (!normalized) return undefined;
        const matches = index.byNormalizedKey.get(normalized);
        return matches?.length === 1 ? matches[0] : undefined;
    }

    private addBookNormalizedKey(map: Map<string, BookRefEntry[]>, entry: BookRefEntry, raw: string | undefined): void {
        const key = this.normalizeBookLookupKey(raw);
        if (!key) return;
        const existing = map.get(key) || [];
        if (!existing.some(candidate => candidate.bookId === entry.bookId)) {
            existing.push(entry);
        }
        map.set(key, existing);
    }

    private normalizeBookLookupKey(raw: string | undefined): string | undefined {
        const text = this.normalizeRefText(raw);
        if (!text) return undefined;
        return text.toLowerCase().replace(/\.[a-z0-9]+$/i, '').replace(/[^a-z0-9]+/g, '');
    }

    private normalizeRefText(value: string | undefined): string | undefined {
        if (typeof value !== 'string') return undefined;
        const trimmed = value.trim();
        return trimmed.length > 0 ? trimmed : undefined;
    }

    private resolveCanonicalBookId(value: string | undefined): string | undefined {
        const normalized = this.normalizeRefText(value);
        if (!normalized) return undefined;
        if (!/^book_[a-z0-9][a-z0-9_-]{1,80}$/i.test(normalized)) return undefined;
        return normalized.toLowerCase();
    }

    private resolveFindingFallbackRefId(input: InquiryRunnerInput): string {
        const primaryTargetSceneId = input.targetSceneIds.find(sceneId => isStableSceneId(sceneId));
        if (primaryTargetSceneId) {
            return primaryTargetSceneId.trim().toLowerCase();
        }
        const firstSceneId = input.corpus.entries.find(entry => entry.class === 'scene' && isStableSceneId(entry.sceneId))?.sceneId;
        if (firstSceneId) return firstSceneId.toLowerCase();
        if (isStableSceneId(input.scopeLabel)) return input.scopeLabel.trim().toLowerCase();
        return input.scopeLabel;
    }


    private resolveCanonicalSceneId(value: string | undefined): string | undefined {
        if (!isStableSceneId(value)) return undefined;
        return String(value).trim().toLowerCase();
    }

    /** Deterministic fallback scn_ ID derived from file path (FNV-1a). */
    private buildPathFallbackSceneId(path: string): string {
        return `scn_${fnv1a32Hex(path)}`;
    }

    private buildStubResult(
        input: InquiryRunnerInput,
        aiMeta: Pick<InquiryResult, 'aiProvider' | 'aiModelRequested' | 'aiModelResolved' | 'aiStatus' | 'aiReason'>,
        error?: unknown
    ): InquiryResult {
        let message: string;
        if (error instanceof Error) {
            message = error.message;
        } else if (!error) {
            message = '';
        } else if (typeof error === 'string') {
            message = error;
        } else if (typeof error === 'number' || typeof error === 'boolean' || typeof error === 'bigint' || typeof error === 'symbol') {
            message = String(error);
        } else {
            try {
                message = JSON.stringify(error);
            } catch {
                message = '[unserializable error]';
            }
        }
        const summary = this.buildStubSummary(aiMeta.aiStatus, aiMeta.aiReason, message);
        const bullets = message ? [t('inquiry.findings.stubBulletNote', { message })] : [t('inquiry.findings.stubBulletPlaceholder')];
        const fallbackRefId = this.resolveFindingFallbackRefId(input);

        const isFailure = aiMeta.aiStatus !== undefined && aiMeta.aiStatus !== 'success' && aiMeta.aiStatus !== 'degraded';
        const findings: InquiryFinding[] = [{
            refId: fallbackRefId,
            kind: isFailure ? 'error' : 'unclear',
            headline: t('inquiry.findings.stubInquiryHeadline'),
            bullets,
            related: [],
            evidenceType: 'mixed',
            lens: 'both'
        }];
        return {
            runId: `run-${Date.now()}`,
            scope: input.scope,
            scopeLabel: input.scopeLabel,
            mode: input.mode,
            selectionMode: input.selectionMode,
            roleValidation: this.computeRoleValidation(input.selectionMode, findings),
            questionId: input.questionId,
            questionText: input.questionText,
            questionPromptForm: input.questionPromptForm,
            questionZone: input.questionZone,
            summary,
            summaryFlow: summary,
            summaryDepth: summary,
            verdict: {
                flow: isFailure ? 0 : 0.6,
                depth: isFailure ? 0 : 0.55
            },
            findings,
            corpusFingerprint: input.corpus.fingerprint,
            cacheReuseFingerprint: input.corpus.cacheReuseFingerprint,
            ...aiMeta,
            ...(message ? { aiErrorDetail: message } : {})
        };
    }

    private getAiMetaFromResponse(response: ProviderResult): Pick<InquiryResult, 'aiProvider' | 'aiModelRequested' | 'aiModelResolved' | 'aiStatus' | 'aiReason'> {
        const aiStatus = response.aiStatus === 'success' && response.aiReason === 'recovered_invalid_response'
            ? 'degraded'
            : response.aiStatus;
        return {
            aiProvider: response.aiProvider,
            aiModelRequested: response.aiModelRequested,
            aiModelResolved: response.aiModelResolved,
            aiStatus,
            aiReason: response.aiReason
        };
    }

    private buildFallbackAiMeta(
        input: Pick<InquiryRunnerInput, 'ai'>
    ): Pick<InquiryResult, 'aiProvider' | 'aiModelRequested' | 'aiModelResolved' | 'aiStatus' | 'aiReason'> {
        return {
            aiProvider: input.ai.provider,
            aiModelRequested: input.ai.modelId,
            aiModelResolved: input.ai.modelId,
            aiStatus: 'unavailable',
            aiReason: 'exception'
        };
    }

    private withParseFailureMeta(
        meta: Pick<InquiryResult, 'aiProvider' | 'aiModelRequested' | 'aiModelResolved' | 'aiStatus' | 'aiReason'>,
        aiStatus: InquiryAiStatus
    ): Pick<InquiryResult, 'aiProvider' | 'aiModelRequested' | 'aiModelResolved' | 'aiStatus' | 'aiReason'> {
        if (aiStatus === 'success') {
            return { ...meta, aiStatus: 'rejected', aiReason: 'invalid_response' };
        }
        return meta;
    }

    private buildStubSummary(aiStatus?: InquiryAiStatus, aiReason?: string, message?: string): string {
        if (aiStatus === 'degraded') {
            return t('inquiry.runner.aiResponseRecovered');
        }
        if (aiStatus === 'rejected' && aiReason === 'unsupported_param') {
            return t('inquiry.runner.aiUnsupportedParameter');
        }
        if (aiStatus === 'rejected') {
            return t('inquiry.runner.aiRequestRejected');
        }
        if (aiStatus === 'auth') {
            return t('inquiry.runner.aiAuthError');
        }
        if (aiStatus === 'timeout') {
            return t('inquiry.runner.aiTimedOut');
        }
        if (aiStatus === 'rate_limit') {
            return t('inquiry.runner.aiRateLimited');
        }
        if (aiStatus === 'unavailable') {
            return t('inquiry.runner.stubResultUnavailable');
        }
        return message ? t('inquiry.runner.stubResultUnavailable') : t('inquiry.runner.stubResultPreview');
    }

    private normalizeScore(value: unknown): number {
        if (typeof value === 'number' && Number.isFinite(value)) {
            if (value > 1 && value <= 100) return value / 100;
            return Math.min(Math.max(value, 0), 1);
        }
        if (typeof value === 'string') {
            const parsed = Number(value);
            if (!Number.isFinite(parsed)) return 0;
            if (parsed > 1 && parsed <= 100) return parsed / 100;
            return Math.min(Math.max(parsed, 0), 1);
        }
        return 0;
    }

    private normalizeFindingKind(value?: string): InquiryFinding['kind'] {
        const normalized = value ? value.toLowerCase().trim() : '';
        const allowed: InquiryFinding['kind'][] = [
            'none',
            'loose_end',
            'continuity',
            'escalation',
            'conflict',
            'unclear',
            'error',
            'strength',
            'thread',
            'arc',
            'payoff',
            'structure'
        ];
        if (allowed.includes(normalized as InquiryFinding['kind'])) {
            return normalized as InquiryFinding['kind'];
        }
        return 'unclear';
    }

    private normalizeFindingLens(value?: string): InquiryFinding['lens'] | undefined {
        const normalized = value ? value.toLowerCase().trim() : '';
        if (normalized === 'flow' || normalized === 'depth' || normalized === 'both') {
            return normalized;
        }
        return undefined;
    }

    private normalizeFindingRole(value?: string): InquiryFinding['role'] | undefined {
        const normalized = value ? value.toLowerCase().trim() : '';
        if (normalized === 'target' || normalized === 'context') {
            return normalized;
        }
        return undefined;
    }

    private computeRoleValidation(
        selectionMode: InquiryRunnerInput['selectionMode'],
        findings: InquiryFinding[]
    ): InquiryRoleValidation {
        if (selectionMode !== 'focused') return 'ok';
        return findings.some(finding => finding.role === 'target') ? 'ok' : 'missing-target-roles';
    }

    private getFrontmatter(file: TFile): Record<string, unknown> {
        const cache = this.metadataCache.getFileCache(file);
        const frontmatter = cache?.frontmatter;
        if (!frontmatter) return {};
        return normalizeFrontmatterKeys(frontmatter, this.frontmatterMappings);
    }

    /**
     * Extract extended Summary from frontmatter for Inquiry context.
     * Reads exclusively from frontmatter["Summary"]. Synopsis is never used.
     */

    private extractSceneNumber(frontmatter: Record<string, unknown>): number | undefined {
        const value = frontmatter['Scene Number'];
        if (value === undefined || value === null) return undefined;
        const parsed = Number(typeof value === 'string' ? value.trim() : value);
        if (!Number.isFinite(parsed)) return undefined;
        return Math.max(1, Math.floor(parsed));
    }

    private extractSceneNumberFromText(value: string | undefined): number | undefined {
        if (!value) return undefined;
        const text = value.trim();
        if (!text) return undefined;

        const match = text.match(/^(\d{1,4})(?:\D|$)/)
            || text.match(/\bscene[\s._-]*(\d{1,4})\b/i)
            || text.match(/\bs(\d{1,4})\b/i);
        if (!match) return undefined;

        const parsed = Number(match[1]);
        if (!Number.isFinite(parsed)) return undefined;
        return Math.max(1, Math.floor(parsed));
    }

    private getReferenceTitle(file: TFile): string {
        const frontmatter = this.getFrontmatter(file);
        const rawTitle = frontmatter['Title'] ?? frontmatter['title'];
        if (typeof rawTitle === 'string' && rawTitle.trim()) {
            return rawTitle.trim();
        }
        return file.basename;
    }

    private clampLabelNumber(value: number): number {
        if (!Number.isFinite(value)) return 1;
        return Math.min(Math.max(Math.floor(value), 1), 999);
    }

    private isTFile(file: { path: string } | TFile): file is TFile {
        return file instanceof TFile;
    }

    private async buildInitialTrace(
        input: InquiryRunnerInput
    ): Promise<{ trace: InquiryRunTrace; evidenceBlocks: EvidenceBlock[]; instructionPrompt: string; cacheableUserInput: string }> {
        const notes: string[] = [];
        const sanitizationNotes: string[] = [];
        let evidenceBlocks: EvidenceBlock[] = [];

        try {
            evidenceBlocks = await this.buildEvidenceBlocks(input);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            notes.push(`Evidence build error: ${message}`);
            evidenceBlocks = [{ label: 'Evidence', content: t('inquiry.runner.unableToBuildEvidence') }];
        }

        const { systemPrompt, userPrompt, evidenceText, instructionPrompt, cacheableUserInput } = this.buildPrompt(input, evidenceBlocks);
        const outputTokenCap = this.getOutputTokenCap(input.ai.provider);
        const tokenEstimate = await this.buildTokenEstimate(
            systemPrompt,
            userPrompt,
            outputTokenCap,
            input.ai,
            evidenceBlocks,
            this.getJsonSchema(),
            this.appendVolatileTargetScenes(input.questionText, input.targetSceneIds),
            instructionPrompt,
            cacheableUserInput,
            input.corpus.cacheReuseFingerprint,
            notes
        );
        const trace: InquiryRunTrace = {
            systemPrompt,
            userPrompt,
            evidenceText,
            tokenEstimate,
            outputTokenCap,
            response: null,
            sanitizationNotes,
            notes
        };

        return { trace, evidenceBlocks, instructionPrompt, cacheableUserInput };
    }

    private async buildOmnibusTrace(
        input: InquiryOmnibusInput
    ): Promise<{ trace: InquiryRunTrace; evidenceBlocks: EvidenceBlock[]; instructionPrompt: string; cacheableUserInput: string }> {
        const notes: string[] = [];
        const sanitizationNotes: string[] = [];
        let evidenceBlocks: EvidenceBlock[] = [];

        try {
            evidenceBlocks = await this.buildEvidenceBlocks({
                scope: input.scope,
                scopeLabel: input.scopeLabel,
                targetSceneIds: input.targetSceneIds,
                selectionMode: input.selectionMode,
                activeBookId: input.activeBookId,
                mode: input.mode,
                questionId: 'omnibus',
                questionText: '',
                questionPromptForm: 'standard',
                questionZone: 'setup',
                corpus: input.corpus,
                rules: input.rules,
                ai: input.ai,
                citationsEnabled: input.citationsEnabled
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            notes.push(`Evidence build error: ${message}`);
            evidenceBlocks = [{ label: 'Evidence', content: t('inquiry.runner.unableToBuildEvidence') }];
        }

        notes.push(`Omnibus run: ${input.questions.length} questions.`);
        const { systemPrompt, userPrompt, evidenceText, instructionPrompt, cacheableUserInput } = this.buildOmnibusPrompt(input, evidenceBlocks);
        const outputTokenCap = this.getOutputTokenCap(input.ai.provider);
        const tokenEstimate = await this.buildTokenEstimate(
            systemPrompt,
            userPrompt,
            outputTokenCap,
            input.ai,
            evidenceBlocks,
            this.getOmnibusJsonSchema(),
            this.appendVolatileTargetScenes(
                input.questions.map(question => question.questionText).join('\n'),
                input.targetSceneIds
            ),
            instructionPrompt,
            cacheableUserInput,
            input.corpus.cacheReuseFingerprint,
            notes
        );
        const trace: InquiryRunTrace = {
            systemPrompt,
            userPrompt,
            evidenceText,
            tokenEstimate,
            outputTokenCap,
            response: null,
            sanitizationNotes,
            notes
        };

        return { trace, evidenceBlocks, instructionPrompt, cacheableUserInput };
    }

    private async buildTokenEstimate(
        systemPrompt: string,
        userPrompt: string,
        outputTokens: number,
        ai: InquiryRunnerInput['ai'],
        evidenceBlocks: EvidenceBlock[],
        jsonSchema: Record<string, unknown>,
        userQuestion?: string,
        instructionPrompt?: string,
        cacheableUserInput?: string,
        providerReuseKey?: string,
        /**
         * Optional `notes` sink — when provided, any structured warnings
         * from the upstream `prepareRunEstimate` call (e.g. the actual
         * provider error message when countTokens fails) are pushed into
         * this list so they flow into the trace's notes channel and
         * surface in the Inquiry Log.
         */
        notesSink?: string[]
    ): Promise<InquiryRunTrace['tokenEstimate']> {
        const evidenceChars = evidenceBlocks.reduce((sum, block) => (
            sum + block.label.length + block.content.length + 6
        ), 0);
        const inputChars = (systemPrompt?.length ?? 0) + (userPrompt?.length ?? 0) + evidenceChars;
        const cacheKey = this.hashText(`${ai.provider}|${ai.modelId}|${inputChars}|${outputTokens}|${systemPrompt}|${userPrompt}|${userQuestion ?? ''}`);
        const cached = this.tokenEstimateCache.get(cacheKey);
        if (cached) return cached;

        const aiClient = getAIClient(this.plugin);
        const prepared = await this.prepareInquiryRunEstimate(aiClient, {
            task: 'InquiryTraceEstimate',
            systemPrompt,
            userPrompt,
            userQuestion,
            ai,
            jsonSchema,
            temperature: 0.2,
            maxTokens: outputTokens,
            evidenceBlocks,
            instructionPrompt,
            cacheableUserInput,
            providerReuseKey
        });
        if (!prepared) {
            throw new Error(t('inquiry.runner.tokenEstimateUnavailable'));
        }
        // Forward any structured warnings (e.g. provider countTokens
        // error) into the trace's notes channel. This is the canonical
        // diagnostic surface — it appears in the Inquiry Log and feeds
        // the unavailable-pill tooltip — and replaces the prior
        // (rule-violating) `console.warn` path.
        if (notesSink && Array.isArray(prepared.warnings)) {
            for (const w of prepared.warnings) {
                if (typeof w === 'string' && w && !notesSink.includes(w)) {
                    notesSink.push(w);
                }
            }
        }
        const tokenEstimate: InquiryRunTrace['tokenEstimate'] = {
            inputTokens: prepared.tokenEstimateInput,
            outputTokens,
            totalTokens: prepared.tokenEstimateInput + outputTokens,
            inputChars,
            estimationMethod: prepared.tokenEstimateMethod,
            uncertaintyTokens: prepared.tokenEstimateUncertainty,
            effectiveInputCeiling: prepared.effectiveInputCeiling,
            expectedPassCount: prepared.expectedPassCount
        };
        const filesIncluded = Array.from(new Set(
            evidenceBlocks
                .map(block => block.meta?.path || block.label)
                .filter(Boolean)
        )).sort((a, b) => a.localeCompare(b));
        let sceneCount = 0;
        let outlineCount = 0;
        let referenceCount = 0;
        evidenceBlocks.forEach(block => {
            if (block.meta?.evidenceClass === 'scene') {
                sceneCount += 1;
                return;
            }
            if (block.meta?.evidenceClass === 'outline') {
                outlineCount += 1;
                return;
            }
            referenceCount += 1;
        });
        logCountingForensics({
            path: 'inquiry',
            phase: 'run_trace',
            filesIncluded,
            sceneCount,
            outlineCount,
            referenceCount,
            totalEvidenceChars: evidenceChars,
            promptEnvelopeCharsAdded: (prepared.systemPrompt?.length ?? 0) + (prepared.userPrompt?.length ?? 0),
            tokenMethodUsed: tokenEstimate.estimationMethod,
            finalTokenEstimate: tokenEstimate.inputTokens
        });
        this.tokenEstimateCache.set(cacheKey, tokenEstimate);
        return tokenEstimate;
    }

    private getOutputTokenCap(provider: Exclude<AIProviderId, 'none'>): number {
        const providerCap = PROVIDER_MAX_OUTPUT_TOKENS[provider] ?? INQUIRY_MAX_OUTPUT_TOKENS;
        return Math.max(512, providerCap);
    }

    private getOutputTokenRequestLimit(
        provider: Exclude<AIProviderId, 'none'>,
        modelId: string,
        inputTokens: number
    ): number {
        const learned = this.plugin.getOutputProfileStore().getRequestMaxTokens(provider, modelId, inputTokens);
        return Math.max(512, learned);
    }

    private applyResponseExecutionReporting(trace: InquiryRunTrace, response: ProviderResult): void {
        const usage = response.usage ?? this.extractUsage(response.aiProvider ?? response.provider, response.responseData);
        if (usage) {
            trace.usage = usage;
        }
        trace.tokenUsageKnown = response.tokenUsageKnown ?? !!usage;
        trace.tokenUsageScope = response.tokenUsageScope;

        const executionState = response.executionState ?? this.inferExecutionState(response);
        trace.executionState = executionState;
        trace.executionPath = response.executionPath
            ?? ((typeof response.executionPassCount === 'number' && response.executionPassCount > 1)
                ? 'multi_pass'
                : 'one_pass');
        trace.cacheReuseState = response.cacheReuseState;
        trace.cacheStatus = response.cacheStatus;
        trace.cacheExpiresAt = response.cacheExpiresAt;
        trace.cachedStableRatio = response.cachedStableRatio;
        trace.cachedStableTokens = response.cachedStableTokens;

        if (response.failureStage) {
            trace.failureStage = response.failureStage;
            return;
        }
        if (response.aiStatus === 'success' && response.success) {
            trace.failureStage = undefined;
            this.recordOutputProfileSample(trace, response);
            return;
        }
        trace.failureStage = executionState === 'blocked_before_send'
            ? 'preflight'
            : 'provider_response_parsing';
    }

    private recordOutputProfileSample(trace: InquiryRunTrace, response: ProviderResult): void {
        const usage = trace.usage;
        if (!usage || typeof usage.outputTokens !== 'number' || usage.outputTokens <= 0) return;
        const inputTokens = typeof usage.inputTokens === 'number' && usage.inputTokens > 0
            ? usage.inputTokens
            : trace.tokenEstimate?.inputTokens;
        if (typeof inputTokens !== 'number' || !Number.isFinite(inputTokens) || inputTokens <= 0) return;
        const provider = response.aiProvider ?? response.provider;
        const modelId = response.aiModelResolved ?? response.aiModelRequested ?? response.modelId;
        if (!provider || !modelId) return;
        void this.plugin.getOutputProfileStore().record({
            provider,
            modelId,
            inputTokens,
            outputTokens: usage.outputTokens,
            timestamp: Date.now()
        });
    }

    private applyOpenAiTransportLaneTraceNote(trace: InquiryRunTrace, response: ProviderResult): void {
        if (response.aiProvider !== 'openai' || !response.aiTransportLane) return;
        trace.openAiTransportLane = response.aiTransportLane;
        const note = `OpenAI transport lane: ${response.aiTransportLane}.`;
        if (!trace.notes.includes(note)) {
            trace.notes.push(note);
        }
    }

    private inferExecutionState(response: ProviderResult): InquiryExecutionState {
        if (response.aiReason === 'multi_pass_failed') return 'multi_pass_failed';
        if (response.aiStatus === 'rejected'
            && typeof response.error === 'string'
            && isSinglePassPlanningBudgetError(response.error)) {
            return 'blocked_before_send';
        }
        return 'dispatched_to_provider';
    }

    private extractUsage(provider: string | undefined, responseData: unknown): InquiryRunTrace['usage'] | undefined {
        return extractTokenUsage(provider, responseData) ?? undefined;
    }
}
