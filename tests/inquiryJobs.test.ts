import { describe, expect, it, vi } from 'vitest';
import type { App } from 'obsidian';
import type RadialTimelinePlugin from '../src/main';
import { ingestAiJobAnswers, STALE_JOB_PROBLEM } from '../src/ai/jobs/aiJobIngest';
import { AI_JOBS_DIR, AI_JOBS_PENDING_DIR, parseAiJob, type AiJob } from '../src/ai/jobs/aiJobStore';
import { compileRequestPrompt } from '../src/ai/runtime/aiClient';
import { buildDefaultAiSettings } from '../src/ai/settings/aiSettings';
import { createInquiryJobHandler, prepareInquiryJobs } from '../src/inquiry/inquiryJobs';
import { InquiryRunnerService } from '../src/inquiry/runner/InquiryRunnerService';
import type { InquiryClientRun, InquiryRunSubject } from '../src/inquiry/runner/types';
import type { InquiryJobBatch, InquiryQuestion } from '../src/inquiry/types/inquiryViewTypes';
import { createInMemoryApp, type InMemoryApp } from './helpers/inMemoryObsidian';

const question = (id: string, label: string): InquiryQuestion => ({
    id, label, standardPrompt: `${label}?`, zone: 'setup', icon: 'help-circle'
});

/**
 * Stands in for the Inquiry view: the scope, book, questions and scene text it
 * would run over, with the runner's real client run and answer reading.
 */
function createFakeView(pluginRef: { current?: RadialTimelinePlugin }) {
    const state = {
        scopeKey: 'Book 1',
        sceneText: 'The station hears a distress call from the dead colony.',
        questions: [question('setup-core', 'Core setup'), question('setup-load-bearing', 'Load-bearing scenes')],
        answered: new Set<string>()
    };
    const runner = () => {
        const service = new InquiryRunnerService(pluginRef.current as never, { getAbstractFileByPath: () => null } as never, {} as never);
        Object.assign(service, {
            buildEvidenceBlocks: async () => [{
                label: 'Scene 1',
                content: state.sceneText,
                meta: { title: '1 Distress call', path: 'Book 1/1 Distress call.md', sceneId: 'scn_a1b2c3d4', evidenceClass: 'scene' }
            }]
        });
        return service;
    };
    const saved: Array<{ questionId: string; attribution: string; submittedAt: Date }> = [];
    const view = {
        async buildAiJobBatch(options: { selectQuestion?: (q: InquiryQuestion) => boolean; unansweredOnly?: boolean } = {}): Promise<InquiryJobBatch> {
            const selected = state.questions
                .filter(options.selectQuestion ?? (() => true))
                .filter(q => !(options.unansweredOnly && state.answered.has(q.id)));
            const runs = [];
            for (const q of selected) {
                const subject: InquiryRunSubject = {
                    scope: 'book', scopeLabel: 'B1', targetSceneIds: [], selectionMode: 'discover', activeBookId: state.scopeKey,
                    mode: 'flow', questionId: q.id, questionText: q.standardPrompt, questionPromptForm: 'standard', questionZone: q.zone,
                    corpus: {
                        entries: [{ path: 'Book 1/1 Distress call.md', sceneId: 'scn_a1b2c3d4', mtime: 1, class: 'scene', mode: 'full', isTarget: false }],
                        fingerprint: 'f', corpusOnlyFingerprint: 'c', cacheReuseFingerprint: 'r', snapshot: [], generatedAt: 0,
                        resolvedRoots: [], allowedClasses: ['scene'], synopsisOnly: false, classCounts: { scene: 1 }
                    },
                    rules: { sagaOutlineScope: 'saga-only', bookOutlineScope: 'book-only', crossScopeUsage: 'conflict-only' }
                };
                const run: InquiryClientRun = await runner().buildClientRun(subject);
                runs.push({ question: q, manifest: subject.corpus, run });
            }
            return { scope: 'book', scopeKey: state.scopeKey, scopeLabel: 'B1', targetSceneIds: [], runs };
        },
        saveAiJobAnswer: vi.fn(async (jobRun: { question: InquiryQuestion; run: InquiryClientRun }, answer: string, attribution: string, submittedAt: Date) => {
            const read = runner().readClientAnswer(jobRun.run, answer, { provider: 'agent', model: attribution });
            if (!read.ok) return read;
            saved.push({ questionId: jobRun.question.id, attribution, submittedAt });
            return { ok: true as const };
        })
    };
    return { state, view, saved };
}

function setup() {
    const app = createInMemoryApp({});
    const pluginRef: { current?: RadialTimelinePlugin } = {};
    const fake = createFakeView(pluginRef);
    const plugin = {
        app,
        settings: { aiSettings: buildDefaultAiSettings() },
        getActiveBookTitle: () => 'Book 1',
        getInquiryService: () => ({ getViewForAiJobs: async () => fake.view })
    } as unknown as RadialTimelinePlugin;
    pluginRef.current = plugin;
    return { app, plugin, ...fake, handler: createInquiryJobHandler(plugin) };
}

async function pendingJobs(app: InMemoryApp): Promise<Array<{ job: AiJob; prompt: string }>> {
    const listing = await app.vault.adapter.list(AI_JOBS_PENDING_DIR);
    const jobs: Array<{ job: AiJob; prompt: string }> = [];
    for (const path of listing.files.filter(file => file.endsWith('.json')).sort()) {
        const read = parseAiJob(await app.vault.adapter.read(path));
        if (read.kind !== 'ok') throw new Error(`bad job ${path}`);
        jobs.push({ job: read.job, prompt: await app.vault.adapter.read(`${AI_JOBS_DIR}/${read.job.promptFile}`) });
    }
    return jobs;
}

const answer = {
    schema_version: 2,
    summaryFlow: 'The premise arrives at once.',
    summaryDepth: 'The colony is set up before it is lost.',
    verdictFlow: 72,
    verdictDepth: 64,
    findings: [{
        ref_id: 'scn_a1b2c3d4', ref_label: '1 Distress call.md', ref_path: 'Book 1/1 Distress call.md',
        kind: 'payoff', lens: 'both', headline: 'The premise lands on page one.', bullets: ['The colony is named first.'],
        recommended_action: '', subject: '', span: '', evidence_quote: '', supporting_refs: [], role: ''
    }],
    answeredBy: 'Codex app · GPT-6.1 Sol'
};

async function answerJob(app: InMemoryApp, label: string, body: unknown = answer): Promise<AiJob> {
    const entry = (await pendingJobs(app)).find(item => item.job.target.label.endsWith(label))!;
    await app.vault.adapter.write(`${AI_JOBS_DIR}/${entry.job.answerFile}`, JSON.stringify(body));
    return entry.job;
}

describe('Inquiry questions as AI jobs', () => {
    it('prepares one job per enabled question, each the client run\'s own request', async () => {
        const { app, plugin, view } = setup();
        expect(await prepareInquiryJobs(plugin, 'all')).toBe(2);

        const jobs = await pendingJobs(app);
        expect(jobs.map(entry => entry.job.target.label).sort()).toEqual([
            'Inquiry · Book B1 · Core setup',
            'Inquiry · Book B1 · Load-bearing scenes'
        ]);
        const core = jobs.find(entry => entry.job.target.label.endsWith('Core setup'))!;
        const [coreRun] = (await view.buildAiJobBatch({ selectQuestion: q => q.id === 'setup-core' })).runs;
        expect(core.prompt).toBe(compileRequestPrompt(plugin, coreRun.run.request).finalPrompt);
        expect(core.job.feature).toBe('InquiryMode');
        expect(core.job.id).toMatch(/^inquiry-[0-9a-f]{8}-[0-9a-f]{8}$/);
    });

    it('prepares only questions without a current briefing when asked for missing ones', async () => {
        const { app, plugin, state } = setup();
        state.answered.add('setup-core');
        expect(await prepareInquiryJobs(plugin, 'missing')).toBe(1);
        expect((await pendingJobs(app)).map(entry => entry.job.target.label)).toEqual(['Inquiry · Book B1 · Load-bearing scenes']);
    });

    it('saves an accepted answer through the view, credited to the client', async () => {
        const { app, plugin, handler, saved } = setup();
        await prepareInquiryJobs(plugin, 'all');
        const job = await answerJob(app, 'Core setup');

        expect(await ingestAiJobAnswers(app as unknown as App, [handler])).toEqual([{ id: job.id, kind: 'applied' }]);
        expect(saved).toEqual([{ questionId: 'setup-core', attribution: 'Codex app · GPT-6.1 Sol', submittedAt: new Date(job.createdAt) }]);
        expect((await pendingJobs(app)).map(entry => entry.job.id)).not.toContain(job.id);
    });

    it('sends back an answer the runner cannot read', async () => {
        const { app, plugin, handler, saved } = setup();
        await prepareInquiryJobs(plugin, 'all');
        const { findings: _dropped, ...noFindings } = answer;
        await answerJob(app, 'Core setup', noFindings);

        const [outcome] = await ingestAiJobAnswers(app as unknown as App, [handler]);
        expect(outcome.kind).toBe('rejected');
        expect(saved).toHaveLength(0);
    });

    it('rebuilds the job when a scene in the corpus changed after it was written', async () => {
        const { app, plugin, handler, state } = setup();
        await prepareInquiryJobs(plugin, 'all');
        const job = await answerJob(app, 'Core setup');
        state.sceneText = 'The station hears nothing at all.';

        expect(await ingestAiJobAnswers(app as unknown as App, [handler])).toEqual([{ id: job.id, kind: 'rebuilt' }]);
        const rebuilt = (await pendingJobs(app)).find(entry => entry.job.id === job.id)!;
        expect(rebuilt.prompt).toContain('The station hears nothing at all.');
        expect(rebuilt.job.lastRejection?.problems).toEqual([STALE_JOB_PROBLEM]);
    });

    it('leaves a job for another book in place instead of saving it to the current one', async () => {
        const { app, plugin, handler, state, saved } = setup();
        await prepareInquiryJobs(plugin, 'all');
        const job = await answerJob(app, 'Core setup');
        state.scopeKey = 'Book 2';

        const [outcome] = await ingestAiJobAnswers(app as unknown as App, [handler]);
        expect(outcome.kind).toBe('failed');
        expect(saved).toHaveLength(0);
        expect(await app.vault.adapter.exists(`${AI_JOBS_DIR}/${job.answerFile}`)).toBe(true);
    });

    it('drops the job when its question was removed or turned off', async () => {
        const { app, plugin, handler, state } = setup();
        await prepareInquiryJobs(plugin, 'all');
        const job = await answerJob(app, 'Load-bearing scenes');
        state.questions = state.questions.filter(q => q.id !== 'setup-load-bearing');

        expect(await ingestAiJobAnswers(app as unknown as App, [handler])).toEqual([{ id: job.id, kind: 'target-gone' }]);
    });
});
