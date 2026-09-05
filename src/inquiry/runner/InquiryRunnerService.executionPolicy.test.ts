import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AIRunResult } from '../../ai/types';

vi.mock('../../ai/runtime/aiClient', () => ({
    getAIClient: vi.fn(() => ({}))
}));

import { getAIClient } from '../../ai/runtime/aiClient';
import { InquiryRunnerService } from './InquiryRunnerService';
import { buildSceneRefIndex } from '../../ai/references/sceneRefNormalizer';

const TEST_AI = {
    provider: 'openai',
    modelId: 'gpt-5.5',
    modelLabel: 'GPT-5.2'
} as const;

const ANTHROPIC_AI = {
    provider: 'anthropic',
    modelId: 'claude-opus-4-7',
    modelLabel: 'Claude Sonnet 4.6'
} as const;

function createService() {
    return new InquiryRunnerService(
        { settings: {} } as never,
        {} as never,
        {} as never
    ) as unknown as Record<string, unknown>;
}

function buildPrecheck(overrides?: Partial<{
    onePassFit: 'fits' | 'overflows' | 'unknown';
    inputTokens: number;
    safeInputTokens: number;
}>): Record<string, unknown> {
    const onePassFit = overrides?.onePassFit ?? 'overflows';
    const inputTokens = overrides?.inputTokens ?? 220000;
    const safeInputTokens = overrides?.safeInputTokens ?? 140000;
    return {
        ok: true,
        inputTokens,
        safeInputTokens,
        onePassFit,
        exceedsSafeBudget: onePassFit === 'overflows',
        estimationMethod: 'heuristic_chars',
        uncertaintyTokens: 0,
        preparedEstimate: null
    };
}

function buildChunkedSuccessRun(): AIRunResult {
    return {
        content: '{"ok":true}',
        responseData: {},
        provider: 'openai',
        modelRequested: TEST_AI.modelId,
        modelResolved: TEST_AI.modelId,
        aiStatus: 'success',
        warnings: [],
        reason: 'chunked success',
        advancedContext: {
            roleTemplateName: 'Default Role Template',
            provider: 'openai',
            modelAlias: 'gpt-5.2',
            modelLabel: TEST_AI.modelLabel,
            modelSelectionReason: 'test',
            availabilityStatus: 'unknown',
            maxInputTokens: 200000,
            maxOutputTokens: 12000,
            executionPassCount: 3,
            featureModeInstructions: '',
            finalPrompt: ''
        }
    };
}

function buildRunResult(overrides?: Partial<AIRunResult>): AIRunResult {
    return {
        content: '{"ok":true}',
        responseData: {},
        provider: 'openai',
        modelRequested: TEST_AI.modelId,
        modelResolved: TEST_AI.modelId,
        aiStatus: 'success',
        warnings: [],
        reason: 'test run',
        ...overrides
    };
}

describe('InquiryRunnerService execution policy', () => {
    beforeEach(() => {
        vi.mocked(getAIClient).mockReturnValue({} as never);
    });

    it('automatic overflow + chunk failure returns multi_pass_failed', async () => {
        const service = createService();
        const getExecutionPrecheck = vi.fn().mockResolvedValue(buildPrecheck({ onePassFit: 'overflows' }));
        const runChunkedInquiry = vi.fn().mockResolvedValue({
            ok: false,
            failureStage: 'chunk_execution',
            failureReason: 'chunk failed',
            tokenUsageKnown: false
        });
        const runInquiryRequest = vi.fn();
        Object.assign(service, {
            getExecutionPrecheck,
            runChunkedInquiry,
            runInquiryRequest
        });

        const result = await (service.callProvider as (...args: unknown[]) => Promise<Record<string, unknown>>) (
            'system',
            'user',
            TEST_AI,
            { type: 'object' },
            0.2,
            4000,
            'question'
        );

        expect(result.aiStatus).toBe('rejected');
        expect(result.aiReason).toBe('multi_pass_failed');
        expect(result.executionState).toBe('multi_pass_failed');
        expect(result.executionPath).toBe('multi_pass');
        expect(result.failureStage).toBe('chunk_execution');
        expect(result.tokenUsageKnown).toBe(false);
        expect(runChunkedInquiry).toHaveBeenCalledTimes(1);
        expect(runChunkedInquiry).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({
                executionPrecheck: expect.objectContaining({
                    inputTokens: 220000,
                    safeInputTokens: 140000,
                    onePassFit: 'overflows'
                })
            })
        );
        expect(runInquiryRequest).not.toHaveBeenCalled();
    });

    it('returns explicit preflight execution failure when authoritative precheck is unavailable', async () => {
        const service = createService();
        const getExecutionPrecheck = vi.fn().mockResolvedValue({
            ok: false,
            reason: 'prepareRunEstimate unavailable'
        });
        const runChunkedInquiry = vi.fn();
        const runInquiryRequest = vi.fn();
        Object.assign(service, {
            getExecutionPrecheck,
            runChunkedInquiry,
            runInquiryRequest
        });

        const result = await (service.callProvider as (...args: unknown[]) => Promise<Record<string, unknown>>) (
            'system',
            'user',
            TEST_AI,
            { type: 'object' },
            0.2,
            4000,
            'question'
        );

        expect(result.aiStatus).toBe('rejected');
        expect(result.aiReason).toBe('multi_pass_failed');
        expect(result.failureStage).toBe('preflight');
        expect(String(result.error)).toContain('multi-pass/parsing failure');
        expect(runChunkedInquiry).not.toHaveBeenCalled();
        expect(runInquiryRequest).not.toHaveBeenCalled();
    });

    it('propagates forceFreshRun into one-pass provider dispatches', async () => {
        const service = createService();
        const getExecutionPrecheck = vi.fn().mockResolvedValue(buildPrecheck({ onePassFit: 'fits' }));
        const runInquiryRequest = vi.fn().mockResolvedValue(buildRunResult());
        const runChunkedInquiry = vi.fn();
        Object.assign(service, {
            getExecutionPrecheck,
            runInquiryRequest,
            runChunkedInquiry
        });

        await (service.callProvider as (...args: unknown[]) => Promise<Record<string, unknown>>) (
            'system',
            'user',
            TEST_AI,
            { type: 'object' },
            0.2,
            4000,
            'question',
            undefined,
            { forceFreshRun: true }
        );

        expect(runChunkedInquiry).not.toHaveBeenCalled();
        expect(runInquiryRequest).toHaveBeenCalledTimes(1);
        expect(runInquiryRequest).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({
                forceFreshRun: true
            })
        );
    });

    it('records OpenAI transport lane in trace notes for logging', () => {
        const service = createService();
        const trace = { notes: [] as string[] } as Record<string, unknown>;

        (service.applyOpenAiTransportLaneTraceNote as (traceArg: Record<string, unknown>, response: Record<string, unknown>) => void)(
            trace,
            {
                aiProvider: 'openai',
                aiTransportLane: 'responses'
            }
        );

        expect(trace.openAiTransportLane).toBe('responses');
        expect(trace.notes).toContain('OpenAI transport lane: responses.');
    });

    it('preserves scopeLabel, selectionMode, roleValidation, and finding roles in built results', () => {
        const service = createService();
        const sceneRefIndex = buildSceneRefIndex([{
            sceneId: 'scn_b5e1b85f',
            path: 'Books/Book 1/Scene 1.md',
            label: 'Scene 1.md',
            sceneNumber: 1,
            title: 'Scene 1',
            aliases: ['S1', 'Scene 1']
        }]);

        Object.assign(service, {
            buildCanonicalSceneRefIndex: vi.fn(() => sceneRefIndex)
        });

        const result = (service.buildResult as (...args: unknown[]) => Record<string, unknown>)(
            {
                scope: 'book',
                scopeLabel: 'B1',
                targetSceneIds: ['scn_b5e1b85f'],
                selectionMode: 'focused',
                activeBookId: 'Books/Book 1',
                mode: 'flow',
                questionId: 'q-1',
                questionText: 'Question',
                questionPromptForm: 'focused',
                questionZone: 'setup',
                corpus: {
                    entries: [],
                    fingerprint: 'fp-1',
                    generatedAt: 1,
                    resolvedRoots: [],
                    allowedClasses: [],
                    synopsisOnly: false,
                    classCounts: {}
                },
                rules: {
                    sagaOutlineScope: 'saga-only',
                    bookOutlineScope: 'book-only',
                    crossScopeUsage: 'conflict-only'
                },
                ai: TEST_AI
            },
            {
                summary: 'Summary',
                verdict: { flow: 0.7, depth: 0.6 },
                findings: [{
                    ref_id: 'scn_b5e1b85f',
                    kind: 'continuity',
                    headline: 'Targeted issue',
                    role: 'target'
                }]
            },
            {
                aiProvider: 'openai',
                aiModelRequested: TEST_AI.modelId,
                aiModelResolved: TEST_AI.modelId,
                aiStatus: 'success',
                aiReason: 'ok'
            }
        );

        expect(result.scopeLabel).toBe('B1');
        expect(result.selectionMode).toBe('focused');
        expect(result.roleValidation).toBe('ok');
        expect(result.questionText).toBe('Question');
        expect(result.questionPromptForm).toBe('focused');
        expect(result.findings[0].role).toBe('target');
    });

    it('marks focused runs without target-labelled findings as missing-target-roles', () => {
        const service = createService();
        const sceneRefIndex = buildSceneRefIndex([{
            sceneId: 'scn_b5e1b85f',
            path: 'Books/Book 1/Scene 1.md',
            label: 'Scene 1.md',
            sceneNumber: 1,
            title: 'Scene 1',
            aliases: ['S1', 'Scene 1']
        }]);

        Object.assign(service, {
            buildCanonicalSceneRefIndex: vi.fn(() => sceneRefIndex)
        });

        const result = (service.buildResult as (...args: unknown[]) => Record<string, unknown>)(
            {
                scope: 'book',
                scopeLabel: 'B1',
                targetSceneIds: ['scn_b5e1b85f'],
                selectionMode: 'focused',
                activeBookId: 'Books/Book 1',
                mode: 'flow',
                questionId: 'q-1',
                questionText: 'Question',
                questionPromptForm: 'standard',
                questionZone: 'setup',
                corpus: {
                    entries: [],
                    fingerprint: 'fp-1',
                    generatedAt: 1,
                    resolvedRoots: [],
                    allowedClasses: [],
                    synopsisOnly: false,
                    classCounts: {}
                },
                rules: {
                    sagaOutlineScope: 'saga-only',
                    bookOutlineScope: 'book-only',
                    crossScopeUsage: 'conflict-only'
                },
                ai: TEST_AI
            },
            {
                summary: 'Summary',
                verdict: { flow: 0.7, depth: 0.6 },
                findings: [{
                    ref_id: 'scn_b5e1b85f',
                    kind: 'continuity',
                    headline: 'Context-only issue',
                    role: 'context'
                }]
            },
            {
                aiProvider: 'openai',
                aiModelRequested: TEST_AI.modelId,
                aiModelResolved: TEST_AI.modelId,
                aiStatus: 'success',
                aiReason: 'ok'
            }
        );

        expect(result.selectionMode).toBe('focused');
        expect(result.roleValidation).toBe('missing-target-roles');
    });

    it('fails multi-pass execution when any chunk returns invalid structured output', async () => {
        const service = createService();
        const buildEvidenceChunkPrompts = vi.fn().mockReturnValue({
            prompts: ['chunk-1', 'chunk-2'],
            maxChunkTokens: 12000,
            maxChunkChars: 48000,
            evidenceChars: 96000,
            prefixChars: 2000,
            targetPasses: 2
        });
        const runInquiryRequest = vi.fn()
            .mockResolvedValueOnce(buildRunResult({
                aiStatus: 'success',
                content: JSON.stringify({
                    summaryFlow: 'Chunk 1 flow summary',
                    summaryDepth: 'Chunk 1 depth summary',
                    verdict: { flow: 0.61, depth: 0.55 },
                    findings: []
                })
            }))
            .mockResolvedValueOnce(buildRunResult({
                aiStatus: 'rejected',
                aiReason: 'invalid_response',
                content: [
                    '```json',
                    '{',
                    '  "summaryFlow": "Recovered flow summary",',
                    '  "summaryDepth": "Recovered depth summary",',
                    '  "verdict": { "flow": 0.62, "depth": 0.58 },',
                    '  "findings": []',
                    '}',
                    '```'
                ].join('\n')
            }));
        Object.assign(service, {
            buildEvidenceChunkPrompts,
            runInquiryRequest
        });

        const result = await (service.runChunkedInquiry as (...args: unknown[]) => Promise<Record<string, unknown>>) (
            {} as never,
            {
                systemPrompt: 'system',
                userPrompt: 'Question\nEvidence:\n## Scene A\nFull',
                ai: TEST_AI,
                jsonSchema: { type: 'object' },
                temperature: 0.2,
                maxTokens: 4000
            }
        );

        expect(result.ok).toBe(false);
        expect(result.failureStage).toBe('chunk_execution');
        expect(String(result.failureReason)).toContain('Chunk 2/2 failed');
        expect(String(result.failureReason)).toContain('reason=invalid_response');
        expect(runInquiryRequest).toHaveBeenCalledTimes(2);
    });

    it('fails immediately when chunk 1 returns invalid structured output', async () => {
        const service = createService();
        const buildEvidenceChunkPrompts = vi.fn().mockReturnValue({
            prompts: ['chunk-1', 'chunk-2'],
            maxChunkTokens: 12000,
            maxChunkChars: 48000,
            evidenceChars: 96000,
            prefixChars: 2000,
            targetPasses: 2
        });
        const runInquiryRequest = vi.fn().mockResolvedValueOnce(buildRunResult({
            aiStatus: 'rejected',
            aiReason: 'invalid_response',
            content: [
                '```json',
                '{',
                '  "summaryFlow": "Recovered flow summary",',
                '  "summaryDepth": "Recovered depth summary",',
                '  "verdict": { "flow": 0.62, "depth": 0.58 },',
                '  "findings": []',
                '}',
                '```'
            ].join('\n')
        }));
        Object.assign(service, {
            buildEvidenceChunkPrompts,
            runInquiryRequest
        });

        const result = await (service.runChunkedInquiry as (...args: unknown[]) => Promise<Record<string, unknown>>) (
            {} as never,
            {
                systemPrompt: 'system',
                userPrompt: 'Question\nEvidence:\n## Scene A\nFull',
                ai: TEST_AI,
                jsonSchema: { type: 'object' },
                temperature: 0.2,
                maxTokens: 4000
            }
        );

        expect(result.ok).toBe(false);
        expect(result.failureStage).toBe('chunk_execution');
        expect(String(result.failureReason)).toContain('Chunk 1/2 failed');
        expect(String(result.failureReason)).toContain('reason=invalid_response');
        expect(runInquiryRequest).toHaveBeenCalledTimes(1);
    });

    it('aborts when chunk 1 returns scene refs outside the active corpus', async () => {
        const service = createService();
        const buildEvidenceChunkPrompts = vi.fn().mockReturnValue({
            prompts: ['chunk-1', 'chunk-2'],
            maxChunkTokens: 12000,
            maxChunkChars: 48000,
            evidenceChars: 96000,
            prefixChars: 2000,
            targetPasses: 2
        });
        const runInquiryRequest = vi.fn().mockResolvedValueOnce(buildRunResult({
            aiStatus: 'success',
            content: JSON.stringify({
                summaryFlow: 'Chunk 1 flow summary',
                summaryDepth: 'Chunk 1 depth summary',
                verdict: { flow: 0.62, depth: 0.58 },
                findings: [{
                    ref_id: 'scn_00000011',
                    kind: 'continuity',
                    headline: 'Bad ref',
                }]
            })
        }));
        Object.assign(service, {
            buildEvidenceChunkPrompts,
            runInquiryRequest
        });

        const result = await (service.runChunkedInquiry as (...args: unknown[]) => Promise<Record<string, unknown>>) (
            {} as never,
            {
                systemPrompt: 'system',
                userPrompt: 'Question\nEvidence:\n## Scene A\nFull',
                ai: TEST_AI,
                jsonSchema: { type: 'object' },
                temperature: 0.2,
                maxTokens: 4000,
                evidenceBlocks: [{
                    label: 'Scene Diga Detects Pregnancy (S25) (scn_b5e1b85f) (Full)',
                    content: 'Full',
                    meta: {
                        title: 'Diga Detects Pregnancy',
                        path: 'Book 1/29 Diga Detects Pregnancy.md',
                        sceneId: 'scn_b5e1b85f',
                        evidenceClass: 'scene'
                    }
                }]
            }
        );

        expect(result.ok).toBe(false);
        expect(result.failureStage).toBe('chunk_execution');
        expect(String(result.failureReason)).toContain('outside the active corpus');
        expect(runInquiryRequest).toHaveBeenCalledTimes(1);
    });

    it('includes a canonical scene ref ledger in the synthesis prompt', async () => {
        const service = createService();
        const buildEvidenceChunkPrompts = vi.fn().mockReturnValue({
            prompts: ['chunk-1', 'chunk-2'],
            maxChunkTokens: 12000,
            maxChunkChars: 48000,
            evidenceChars: 96000,
            prefixChars: 2000,
            targetPasses: 2
        });
        const runInquiryRequest = vi.fn()
            .mockResolvedValueOnce(buildRunResult({
                aiStatus: 'success',
                content: JSON.stringify({
                    summaryFlow: 'Chunk 1 flow summary',
                    summaryDepth: 'Chunk 1 depth summary',
                    verdict: { flow: 0.61, depth: 0.55 },
                    findings: []
                })
            }))
            .mockResolvedValueOnce(buildRunResult({
                aiStatus: 'success',
                content: JSON.stringify({
                    summaryFlow: 'Chunk 2 flow summary',
                    summaryDepth: 'Chunk 2 depth summary',
                    verdict: { flow: 0.64, depth: 0.57 },
                    findings: []
                })
            }))
            .mockResolvedValueOnce(buildRunResult({
                aiStatus: 'success',
                content: JSON.stringify({
                    summaryFlow: 'Synthesis flow summary',
                    summaryDepth: 'Synthesis depth summary',
                    verdict: { flow: 0.66, depth: 0.61 },
                    findings: []
                })
            }));
        Object.assign(service, {
            buildEvidenceChunkPrompts,
            runInquiryRequest
        });

        const result = await (service.runChunkedInquiry as (...args: unknown[]) => Promise<Record<string, unknown>>) (
            {} as never,
            {
                systemPrompt: 'system',
                userPrompt: 'Question\nEvidence:\n## Scene A\nFull',
                ai: TEST_AI,
                jsonSchema: { type: 'object' },
                temperature: 0.2,
                maxTokens: 4000,
                evidenceBlocks: [{
                    label: 'Scene Diga Detects Pregnancy (S25) (scn_b5e1b85f) (Full)',
                    content: 'Full',
                    meta: {
                        title: 'Diga Detects Pregnancy',
                        path: 'Book 1/29 Diga Detects Pregnancy.md',
                        sceneId: 'scn_b5e1b85f',
                        evidenceClass: 'scene'
                    }
                }]
            }
        );

        expect(result.ok).toBe(true);
        const synthesisPrompt = runInquiryRequest.mock.calls[2]?.[1]?.userPrompt;
        expect(String(synthesisPrompt)).toContain('Allowed scene refs for findings:');
        expect(String(synthesisPrompt)).toContain('scn_b5e1b85f');
        expect(String(synthesisPrompt)).toContain('Diga Detects Pregnancy');
    });

    it('aggregates full multi-pass usage across chunks and synthesis', async () => {
        const service = createService();
        const buildEvidenceChunkPrompts = vi.fn().mockReturnValue({
            prompts: ['chunk-1', 'chunk-2'],
            maxChunkTokens: 12000,
            maxChunkChars: 48000,
            evidenceChars: 96000,
            prefixChars: 2000,
            targetPasses: 2
        });
        const runInquiryRequest = vi.fn()
            .mockResolvedValueOnce(buildRunResult({
                responseData: { usage: { input_tokens: 100, output_tokens: 20 } }
            }))
            .mockResolvedValueOnce(buildRunResult({
                responseData: { usage: { input_tokens: 80, output_tokens: 10 } }
            }))
            .mockResolvedValueOnce(buildRunResult({
                responseData: { usage: { input_tokens: 30, output_tokens: 15 } }
            }));
        Object.assign(service, {
            buildEvidenceChunkPrompts,
            runInquiryRequest
        });

        const result = await (service.runChunkedInquiry as (...args: unknown[]) => Promise<Record<string, unknown>>) (
            {} as never,
            {
                systemPrompt: 'system',
                userPrompt: 'Question\nEvidence:\n## Scene A\nFull',
                ai: TEST_AI,
                jsonSchema: { type: 'object' },
                temperature: 0.2,
                maxTokens: 4000
            }
        );

        expect(result.ok).toBe(true);
        expect(result.tokenUsageKnown).toBe(true);
        expect(result.tokenUsageScope).toBe('full');
        expect(result.usage).toEqual({
            inputTokens: 210,
            outputTokens: 45,
            totalTokens: 255
        });
    });

    it('labels multi-pass usage as synthesis-only when chunk usage is unavailable', async () => {
        const service = createService();
        const buildEvidenceChunkPrompts = vi.fn().mockReturnValue({
            prompts: ['chunk-1', 'chunk-2'],
            maxChunkTokens: 12000,
            maxChunkChars: 48000,
            evidenceChars: 96000,
            prefixChars: 2000,
            targetPasses: 2
        });
        const runInquiryRequest = vi.fn()
            .mockResolvedValueOnce(buildRunResult({ responseData: {} }))
            .mockResolvedValueOnce(buildRunResult({ responseData: {} }))
            .mockResolvedValueOnce(buildRunResult({
                responseData: { usage: { input_tokens: 30, output_tokens: 15 } }
            }));
        Object.assign(service, {
            buildEvidenceChunkPrompts,
            runInquiryRequest
        });

        const result = await (service.runChunkedInquiry as (...args: unknown[]) => Promise<Record<string, unknown>>) (
            {} as never,
            {
                systemPrompt: 'system',
                userPrompt: 'Question\nEvidence:\n## Scene A\nFull',
                ai: TEST_AI,
                jsonSchema: { type: 'object' },
                temperature: 0.2,
                maxTokens: 4000
            }
        );

        expect(result.ok).toBe(true);
        expect(result.tokenUsageKnown).toBe(true);
        expect(result.tokenUsageScope).toBe('synthesis_only');
        expect(result.usage).toEqual({
            inputTokens: 30,
            outputTokens: 15,
            totalTokens: 45
        });
    });

    it('aggregates full Anthropic multi-pass usage using cache-aware input fields', async () => {
        const service = createService();
        const buildEvidenceChunkPrompts = vi.fn().mockReturnValue({
            prompts: ['chunk-1', 'chunk-2'],
            maxChunkTokens: 12000,
            maxChunkChars: 48000,
            evidenceChars: 96000,
            prefixChars: 2000,
            targetPasses: 2
        });
        const runInquiryRequest = vi.fn()
            .mockResolvedValueOnce(buildRunResult({
                responseData: { usage: { input_tokens: 50, cache_creation_input_tokens: 10000, output_tokens: 20 } }
            }))
            .mockResolvedValueOnce(buildRunResult({
                responseData: { usage: { input_tokens: 40, cache_read_input_tokens: 9000, output_tokens: 10 } }
            }))
            .mockResolvedValueOnce(buildRunResult({
                responseData: { usage: { input_tokens: 30, cache_read_input_tokens: 8000, output_tokens: 15 } }
            }));
        Object.assign(service, {
            buildEvidenceChunkPrompts,
            runInquiryRequest
        });

        const result = await (service.runChunkedInquiry as (...args: unknown[]) => Promise<Record<string, unknown>>) (
            {} as never,
            {
                systemPrompt: 'system',
                userPrompt: 'Question\nEvidence:\n## Scene A\nFull',
                ai: ANTHROPIC_AI,
                jsonSchema: { type: 'object' },
                temperature: 0.2,
                maxTokens: 4000
            }
        );

        expect(result.ok).toBe(true);
        expect(result.tokenUsageKnown).toBe(true);
        expect(result.tokenUsageScope).toBe('full');
        expect(result.usage).toEqual({
            inputTokens: 27120,
            outputTokens: 45,
            totalTokens: 27165,
            rawInputTokens: 120,
            cacheReadInputTokens: 17000,
            cacheCreationInputTokens: 10000
        });
        expect(result.usage).not.toEqual({
            inputTokens: 120,
            outputTokens: 45,
            totalTokens: 165
        });
    });

    it('labels Anthropic multi-pass usage as partial and hides incomplete input totals', async () => {
        const service = createService();
        const buildEvidenceChunkPrompts = vi.fn().mockReturnValue({
            prompts: ['chunk-1', 'chunk-2'],
            maxChunkTokens: 12000,
            maxChunkChars: 48000,
            evidenceChars: 96000,
            prefixChars: 2000,
            targetPasses: 2
        });
        const runInquiryRequest = vi.fn()
            .mockResolvedValueOnce(buildRunResult({
                responseData: { usage: { input_tokens: 50, cache_creation_input_tokens: 10000, output_tokens: 20 } }
            }))
            .mockResolvedValueOnce(buildRunResult({
                responseData: { usage: { output_tokens: 10 } }
            }))
            .mockResolvedValueOnce(buildRunResult({
                responseData: { usage: { input_tokens: 30, cache_read_input_tokens: 8000, output_tokens: 15 } }
            }));
        Object.assign(service, {
            buildEvidenceChunkPrompts,
            runInquiryRequest
        });

        const result = await (service.runChunkedInquiry as (...args: unknown[]) => Promise<Record<string, unknown>>) (
            {} as never,
            {
                systemPrompt: 'system',
                userPrompt: 'Question\nEvidence:\n## Scene A\nFull',
                ai: ANTHROPIC_AI,
                jsonSchema: { type: 'object' },
                temperature: 0.2,
                maxTokens: 4000
            }
        );

        expect(result.ok).toBe(true);
        expect(result.tokenUsageKnown).toBe(true);
        expect(result.tokenUsageScope).toBe('partial');
        expect(result.usage).toEqual({
            inputTokens: undefined,
            outputTokens: 45,
            totalTokens: undefined,
            rawInputTokens: undefined,
            cacheReadInputTokens: undefined,
            cacheCreationInputTokens: undefined
        });
    });

    it('estimates exact pass count from the chunk plan instead of the ratio heuristic', () => {
        const service = createService();
        const buildEvidenceChunkPrompts = vi.fn().mockReturnValue({
            prompts: ['chunk-1', 'chunk-2', 'chunk-3'],
            maxChunkTokens: 12000,
            maxChunkChars: 48000,
            evidenceChars: 160000,
            prefixChars: 2400,
            targetPasses: 2
        });
        Object.assign(service, { buildEvidenceChunkPrompts });

        const passCount = (service.estimateExecutionPassCountFromPrompt as (...args: unknown[]) => number)(
            'Question\nEvidence:\n## Scene A\nFull',
            {
                estimatedInputTokens: 194600,
                safeInputTokens: 162000
            }
        );

        expect(passCount).toBe(4);
    });

    it('stops multi-pass orchestration after the current chunk when abort is requested', async () => {
        const service = createService();
        const buildEvidenceChunkPrompts = vi.fn().mockReturnValue({
            prompts: ['chunk-1', 'chunk-2', 'chunk-3'],
            maxChunkTokens: 12000,
            maxChunkChars: 48000,
            evidenceChars: 160000,
            prefixChars: 2400,
            targetPasses: 2
        });
        let abortRequested = false;
        const runInquiryRequest = vi.fn().mockImplementation(async () => {
            abortRequested = true;
            return buildRunResult();
        });
        Object.assign(service, {
            buildEvidenceChunkPrompts,
            runInquiryRequest
        });

        await expect((service.runChunkedInquiry as (...args: unknown[]) => Promise<Record<string, unknown>>) (
            {} as never,
            {
                systemPrompt: 'system',
                userPrompt: 'Question\nEvidence:\n## Scene A\nFull',
                ai: TEST_AI,
                jsonSchema: { type: 'object' },
                temperature: 0.2,
                maxTokens: 4000,
                executionOptions: {
                    shouldAbort: () => abortRequested
                }
            }
        )).rejects.toThrow('Inquiry run aborted.');

        expect(runInquiryRequest).toHaveBeenCalledTimes(1);
    });

    it('quarantines findings whose scene ids are outside the active corpus instead of throwing', () => {
        const service = new InquiryRunnerService(
            { settings: {} } as never,
            { getAbstractFileByPath: () => null } as never,
            {} as never
        ) as unknown as Record<string, unknown>;

        const result = (service.buildResult as (...args: unknown[]) => Record<string, unknown>)(
            {
                scope: 'book',
                scopeLabel: 'Book B1',
                mode: 'depth',
                questionId: 'payoff',
                questionZone: 'payoff',
                corpus: {
                    fingerprint: 'fp-1',
                    entries: [{
                        path: 'Book 1/29 Diga Detects Pregnancy.md',
                        class: 'scene',
                        sceneId: 'scn_b5e1b85f',
                        mtime: 1
                    }]
                }
            },
            {
                summaryFlow: 'Flow',
                summaryDepth: 'Depth',
                verdict: { flow: 0.5, depth: 0.5 },
                findings: [{
                    ref_id: 'scn_00000011',
                    kind: 'continuity',
                    headline: 'Bad ref',
                }]
            },
            {
                aiProvider: 'anthropic',
                aiModelRequested: TEST_AI.modelId,
                aiModelResolved: TEST_AI.modelId,
                aiStatus: 'success',
                aiReason: undefined
            }
        );

        expect(Array.isArray(result.findings)).toBe(true);
        expect((result.findings as unknown[]).length).toBe(0);
        const unverified = result.unverifiedFindings as Array<{ rawRefId?: string; headline: string }> | undefined;
        expect(unverified && unverified.length).toBe(1);
        expect(unverified?.[0].rawRefId).toBe('scn_00000011');
        expect(unverified?.[0].headline).toBe('Bad ref');
        const warnings = result.citationIntegrityWarnings as Array<{ stage: string; message: string }> | undefined;
        expect(warnings && warnings.length).toBeGreaterThan(0);
        expect(warnings?.[0].stage).toBe('unresolved_ref');
        expect(warnings?.[0].message).toContain('scn_00000011');
    });

    it('emits exact chunk and synthesis progress for multi-pass execution', async () => {
        const service = createService();
        const buildEvidenceChunkPrompts = vi.fn().mockReturnValue({
            prompts: ['chunk-1', 'chunk-2'],
            maxChunkTokens: 12000,
            maxChunkChars: 48000,
            evidenceChars: 96000,
            prefixChars: 2000,
            targetPasses: 2
        });
        const runInquiryRequest = vi.fn()
            .mockResolvedValueOnce(buildRunResult())
            .mockResolvedValueOnce(buildRunResult())
            .mockResolvedValueOnce(buildRunResult());
        const onProgress = vi.fn();
        Object.assign(service, {
            buildEvidenceChunkPrompts,
            runInquiryRequest
        });

        const result = await (service.runChunkedInquiry as (...args: unknown[]) => Promise<Record<string, unknown>>) (
            {} as never,
            {
                systemPrompt: 'system',
                userPrompt: 'Question\nEvidence:\n## Scene A\nFull',
                ai: TEST_AI,
                jsonSchema: { type: 'object' },
                temperature: 0.2,
                maxTokens: 4000,
                executionOptions: { onProgress }
            }
        );

        expect(result.ok).toBe(true);
        expect(onProgress).toHaveBeenNthCalledWith(1, {
            phase: 'chunk',
            currentPass: 1,
            totalPasses: 3,
            chunkIndex: 1,
            chunkTotal: 2,
            detail: 'Waiting for pass 1 of 3.'
        });
        expect(onProgress).toHaveBeenNthCalledWith(2, {
            phase: 'chunk',
            currentPass: 2,
            totalPasses: 3,
            chunkIndex: 2,
            chunkTotal: 2,
            detail: 'Waiting for pass 2 of 3.'
        });
        expect(onProgress).toHaveBeenNthCalledWith(3, {
            phase: 'synthesis',
            currentPass: 3,
            totalPasses: 3,
            chunkTotal: 2,
            detail: 'Waiting for pass 3 of 3.'
        });
    });
});
