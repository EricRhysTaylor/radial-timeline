/*
 * Multi-pass Inquiry on prompts the real builders make.
 *
 * The splitter looked for "Evidence:" while every prompt builder writes
 * "EVIDENCE:", so no real prompt could be split: every run that needed more
 * than one pass failed at preflight ("Evidence could not be split into
 * multiple chunks"), and every pass-count estimate said one pass. The other
 * chunker and multi-pass tests hand-write their prompts, which is how that
 * went unseen; these build them with buildInquiryPromptParts and the runner's
 * own prompt builders.
 */

import { describe, expect, it, vi } from 'vitest';

vi.mock('../../ai/runtime/aiClient', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../ai/runtime/aiClient')>()),
    getAIClient: vi.fn(() => ({}))
}));

import { InquiryRunnerService } from './InquiryRunnerService';
import { buildInquiryPromptParts } from '../promptScaffold';
import type { AIRunResult } from '../../ai/types';

const scenes = Array.from({ length: 6 }, (_, index) => ({
    label: `Scene ${index + 1} (scn_0000000${index}) (Full)`,
    content: `Scene ${index + 1}. ${'The station drifts on and the crew argue about the signal. '.repeat(400)}`,
    meta: { title: `Scene ${index + 1}`, path: `Book 1/${index + 1} Scene.md`, sceneId: `scn_0000000${index}`, evidenceClass: 'scene' }
}));
const evidenceText = scenes.map(block => `## ${block.label}\n${block.content}`).join('\n\n');

const { userPrompt, systemPrompt } = buildInquiryPromptParts({
    task: 'Is the premise set up before it pays off?',
    scope: 'book',
    lens: 'flow',
    selectionMode: 'discover',
    targetSceneIds: [],
    corpusManifestLines: scenes.map(block => `ref_id=${block.meta.sceneId} | ref_label=${block.meta.title}.md | ref_path=${block.meta.path} | class=scene | mode=full`),
    evidenceText
});
const prefix = userPrompt.slice(0, userPrompt.indexOf(evidenceText));

type Runner = {
    buildEvidenceChunkPrompts(prompt: string, options: { maxChunkTokens: number; estimatedInputTokens?: number; safeInputTokens?: number }): { prompts: string[] } | null;
    estimateExecutionPassCountFromPrompt(prompt: string, options?: { estimatedInputTokens?: number; safeInputTokens?: number }): number;
    runChunkedInquiry(client: unknown, options: Record<string, unknown>): Promise<{ ok: boolean; failureReason?: string }>;
    runInquiryRequest: (client: unknown, options: { task: string; userPrompt: string }) => Promise<AIRunResult>;
};

function runner(): Runner {
    return new InquiryRunnerService({ settings: {} } as never, {} as never, {} as never) as unknown as Runner;
}

const pass = (summary: string): AIRunResult => ({
    content: JSON.stringify({ summaryFlow: summary, summaryDepth: summary, verdictFlow: 60, verdictDepth: 55, findings: [] }),
    responseData: {},
    provider: 'openai',
    modelRequested: 'model',
    modelResolved: 'model',
    aiStatus: 'success',
    warnings: [],
    reason: 'test'
});

describe('Multi-pass Inquiry on real prompts', () => {
    it('splits a prompt from the prompt scaffold, keeping everything up to the evidence in each chunk', () => {
        const plan = runner().buildEvidenceChunkPrompts(userPrompt, { maxChunkTokens: 4000 });
        expect(plan).not.toBeNull();
        expect(plan!.prompts.length).toBeGreaterThanOrEqual(2);
        for (const chunk of plan!.prompts) expect(chunk.startsWith(prefix)).toBe(true);
    });

    it('runs every chunk and then the synthesis, which keeps the prompt up to the evidence', async () => {
        const service = runner();
        const requests: Array<{ task: string; userPrompt: string }> = [];
        service.runInquiryRequest = vi.fn(async (_client, options) => {
            requests.push(options);
            return pass(options.task);
        });

        const outcome = await service.runChunkedInquiry({}, {
            systemPrompt,
            userPrompt,
            ai: { provider: 'openai', modelId: 'model', modelLabel: 'Model' },
            jsonSchema: { type: 'object' },
            temperature: 0.2,
            maxTokens: 4000,
            evidenceBlocks: scenes,
            executionPrecheck: { inputTokens: 40000, safeInputTokens: 20000, onePassFit: 'overflows' }
        });

        expect(outcome.failureReason).toBeUndefined();
        expect(outcome.ok).toBe(true);
        const synthesis = requests[requests.length - 1];
        expect(requests.length).toBeGreaterThanOrEqual(3);
        expect(synthesis.task).toBe('SynthesizeChunkAnalyses');
        expect(synthesis.userPrompt.startsWith(prefix)).toBe(true);
        expect(synthesis.userPrompt).toContain('## Pass 1 result');
    });

    it('estimates one pass when the prompt fits the safe budget, and the planned passes when it does not', () => {
        const service = runner();
        expect(service.estimateExecutionPassCountFromPrompt(userPrompt, { estimatedInputTokens: 15000, safeInputTokens: 20000 })).toBe(1);
        expect(service.estimateExecutionPassCountFromPrompt(userPrompt)).toBe(1);
        expect(service.estimateExecutionPassCountFromPrompt(userPrompt, { estimatedInputTokens: 40000, safeInputTokens: 20000 })).toBeGreaterThanOrEqual(3);
    });
});
