import { describe, expect, it, vi } from 'vitest';
import { InquiryRunnerService } from './InquiryRunnerService';
import { compileRequestPrompt } from '../../ai/runtime/aiClient';
import { buildDefaultAiSettings } from '../../ai/settings/aiSettings';
import type { AIRunRequest } from '../../ai/types';
import type { InquiryRunSubject } from './types';

const plugin = {
    settings: { aiSettings: buildDefaultAiSettings() },
    getActiveBookTitle: () => 'Book 1'
};

const scenePath = 'Book 1/1 Distress call.md';
const evidenceBlocks = [{
    label: 'Scene 1 · Distress call',
    content: 'The station hears a distress call from the dead colony.',
    meta: { title: '1 Distress call', path: scenePath, sceneId: 'scn_a1b2c3d4', evidenceClass: 'scene' }
}];

const subject: InquiryRunSubject = {
    scope: 'book',
    scopeLabel: 'B1',
    targetSceneIds: [],
    selectionMode: 'discover',
    activeBookId: 'Book 1',
    mode: 'flow',
    questionId: 'setup-core',
    questionText: 'Is the premise set up before it pays off?',
    questionPromptForm: 'standard',
    questionZone: 'setup',
    corpus: {
        entries: [{ path: scenePath, sceneId: 'scn_a1b2c3d4', mtime: 1, class: 'scene', mode: 'full', isTarget: false }],
        fingerprint: 'f',
        corpusOnlyFingerprint: 'c',
        cacheReuseFingerprint: 'r',
        snapshot: [],
        generatedAt: 0,
        resolvedRoots: ['Book 1'],
        allowedClasses: ['scene'],
        synopsisOnly: false,
        classCounts: { scene: 1 }
    },
    rules: { sagaOutlineScope: 'saga-only', bookOutlineScope: 'book-only', crossScopeUsage: 'conflict-only' }
};

type RunnerInternals = InquiryRunnerService & {
    buildEvidenceBlocks: () => Promise<typeof evidenceBlocks>;
    buildPrompt: (input: InquiryRunSubject, blocks: typeof evidenceBlocks) => {
        systemPrompt: string; userPrompt: string; instructionPrompt: string; cacheableUserInput: string;
    };
    appendVolatileTargetScenes: (question: string, targets: string[]) => string;
    getJsonSchema: () => Record<string, unknown>;
    runInquiryRequest: (client: unknown, options: Record<string, unknown>) => Promise<unknown>;
};

function createRunner(): RunnerInternals {
    const runner = new InquiryRunnerService(
        plugin as never,
        { getAbstractFileByPath: () => null } as never,
        {} as never
    ) as RunnerInternals;
    runner.buildEvidenceBlocks = async () => evidenceBlocks;
    return runner;
}

const finding = {
    ref_id: 'scn_a1b2c3d4',
    ref_label: '1 Distress call.md',
    ref_path: scenePath,
    kind: 'payoff',
    lens: 'both',
    headline: 'The distress call is the premise, and it lands on page one.',
    bullets: ['The colony is named before it goes silent.'],
    recommended_action: '',
    subject: '',
    span: '',
    evidence_quote: 'The station hears a distress call from the dead colony.',
    supporting_refs: [],
    role: ''
};

const answer = {
    schema_version: 2,
    summaryFlow: 'The premise arrives at once.',
    summaryDepth: 'The colony is set up before it is lost.',
    verdictFlow: 72,
    verdictDepth: 64,
    findings: [finding]
};

describe('Inquiry runs answered by an AI client the author runs', () => {
    it('hand the client exactly the prompt the OpenAI and Gemini calls send', async () => {
        const runner = createRunner();
        const { request } = await runner.buildClientRun(subject);

        const sent: AIRunRequest[] = [];
        const client = { run: vi.fn(async (sentRequest: AIRunRequest) => { sent.push(sentRequest); return {}; }) };
        const parts = runner.buildPrompt(subject, evidenceBlocks);
        for (const provider of ['openai', 'google'] as const) {
            await runner.runInquiryRequest(client, {
                task: 'AnalyzeCorpus',
                systemPrompt: parts.systemPrompt,
                userPrompt: parts.userPrompt,
                userQuestion: runner.appendVolatileTargetScenes(subject.questionText, subject.targetSceneIds),
                ai: { provider, modelId: 'model', modelLabel: 'Model' },
                jsonSchema: runner.getJsonSchema(),
                temperature: 0.2,
                maxTokens: 4000,
                evidenceBlocks,
                preparedEstimate: {},
                instructionPrompt: parts.instructionPrompt,
                cacheableUserInput: parts.cacheableUserInput
            });
        }

        const prompt = compileRequestPrompt(plugin as never, request).finalPrompt;
        expect(sent).toHaveLength(2);
        for (const sentRequest of sent) {
            expect(prompt).toBe(compileRequestPrompt(plugin as never, sentRequest).finalPrompt);
        }
        expect(prompt).toContain('The station hears a distress call from the dead colony.');
        expect(prompt).not.toContain('(Evidence provided as document attachments.)');
        expect(prompt.trimEnd().endsWith(subject.questionText)).toBe(true);
    });

    it('read an answer as a provider answer is read, credited to the client', async () => {
        const runner = createRunner();
        const run = await runner.buildClientRun(subject);
        const read = runner.readClientAnswer(run, JSON.stringify(answer), { provider: 'agent', model: 'Claude app · Opus 5.5' });

        expect(read.ok).toBe(true);
        if (!read.ok) return;
        expect(read.result.aiProvider).toBe('agent');
        expect(read.result.aiModelResolved).toBe('Claude app · Opus 5.5');
        expect(read.result.aiStatus).toBe('success');
        expect(read.result.verdict).toEqual({ flow: 0.72, depth: 0.64 });
        expect(read.result.findings.map(item => item.refId)).toEqual(['scn_a1b2c3d4']);
        expect(read.result.questionId).toBe('setup-core');
    });

    it('send back an answer that is not JSON or leaves out what the schema requires', async () => {
        const runner = createRunner();
        const run = await runner.buildClientRun(subject);
        const client = { provider: 'agent', model: 'Codex app' };

        const notJson = runner.readClientAnswer(run, 'I could not finish the analysis.', client);
        expect(notJson.ok).toBe(false);
        if (!notJson.ok) expect(notJson.problems[0]).toMatch(/Invalid JSON/);

        const { findings: _dropped, ...noFindings } = answer;
        const missing = runner.readClientAnswer(run, JSON.stringify(noFindings), client);
        expect(missing.ok).toBe(false);
        if (!missing.ok) expect(missing.problems[0]).toContain('findings');
    });

    it('log the run as one pass with a character estimate and no provider numbers', async () => {
        const { trace } = await createRunner().buildClientRun(subject);
        expect(trace.executionPassCount).toBe(1);
        expect(trace.tokenEstimate.estimationMethod).toBe('heuristic_chars');
        expect(trace.tokenEstimate.inputTokens).toBeGreaterThan(0);
        expect(Number.isNaN(trace.tokenEstimate.outputTokens)).toBe(true);
        expect(trace.usage).toBeUndefined();
    });
});
