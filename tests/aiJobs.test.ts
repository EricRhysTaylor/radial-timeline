import { describe, expect, it, vi } from 'vitest';
import { TFile } from 'obsidian';
import type RadialTimelinePlugin from '../src/main';
import { ingestAiJobAnswers, STALE_JOB_PROBLEM, type AiJobHandler } from '../src/ai/jobs/aiJobIngest';
import {
    AI_JOBS_DIR,
    AI_JOBS_PENDING_DIR,
    AI_JOBS_ANSWERS_DIR,
    AI_JOB_INSTRUCTIONS,
    ensureAiJobMailbox,
    parseAiJob,
    writeAiJob,
    type AiJob
} from '../src/ai/jobs/aiJobStore';
import { compileRequestPrompt } from '../src/ai/runtime/aiClient';
import { buildDefaultAiSettings } from '../src/ai/settings/aiSettings';
import { buildSummaryRunRequest } from '../src/sceneAnalysis/summaryRefresh';
import { getAllSceneData } from '../src/sceneAnalysis/data';
import {
    createSummaryRefreshJobHandler,
    prepareSummaryRefreshJobs
} from '../src/sceneAnalysis/summaryRefreshJobs';
import { createInMemoryApp, type InMemoryApp } from './helpers/inMemoryObsidian';
import type { App } from 'obsidian';

const asApp = (app: InMemoryApp) => app as unknown as App;

async function readText(app: InMemoryApp, path: string): Promise<string> {
    return app.vault.adapter.read(path);
}

function job(id: string, fingerprint = 'fp-1'): AiJob {
    return {
        schemaVersion: 1,
        id,
        feature: 'Fake',
        task: 'FakeTask',
        createdAt: '2026-09-29T00:00:00.000Z',
        target: { path: 'Notes/a.md', label: 'a' },
        sourceFingerprint: fingerprint,
        answerFile: `Answers/${id}.json`,
        prompt: 'Answer with {"value": "..."}'
    };
}

function fakeHandler(overrides: Partial<AiJobHandler> = {}): AiJobHandler {
    return {
        feature: 'Fake',
        currentFingerprint: async () => 'fp-1',
        rebuild: async (stale) => ({ ...stale, sourceFingerprint: 'fp-2', prompt: 'rebuilt prompt' }),
        apply: async (_job, answer) => (answer.includes('"value"') ? { ok: true } : { ok: false, problems: ['missing "value"'] }),
        ...overrides
    };
}

describe('AI job ingest', () => {
    async function mailboxWith(id: string, answer: string): Promise<InMemoryApp> {
        const app = createInMemoryApp({});
        await ensureAiJobMailbox(asApp(app));
        await writeAiJob(asApp(app), job(id));
        await app.vault.adapter.write(`${AI_JOBS_ANSWERS_DIR}/${id}.json`, answer);
        return app;
    }

    it('applies an accepted answer and deletes the job and the answer', async () => {
        const app = await mailboxWith('job-1', '{"value": "x"}');
        const outcomes = await ingestAiJobAnswers(asApp(app), [fakeHandler()]);
        expect(outcomes).toEqual([{ id: 'job-1', kind: 'applied' }]);
        expect(await app.vault.adapter.exists(`${AI_JOBS_PENDING_DIR}/job-1.json`)).toBe(false);
        expect(await app.vault.adapter.exists(`${AI_JOBS_ANSWERS_DIR}/job-1.json`)).toBe(false);
    });

    it('sends a failing answer back by recording the problems on the job', async () => {
        const app = await mailboxWith('job-1', '{"other": "x"}');
        const outcomes = await ingestAiJobAnswers(asApp(app), [fakeHandler()]);
        expect(outcomes).toEqual([{ id: 'job-1', kind: 'rejected', problems: ['missing "value"'] }]);
        const pending = parseAiJob(await readText(app, `${AI_JOBS_PENDING_DIR}/job-1.json`));
        expect(pending.kind === 'ok' && pending.job.lastRejection?.problems).toEqual(['missing "value"']);
        expect(await app.vault.adapter.exists(`${AI_JOBS_ANSWERS_DIR}/job-1.json`)).toBe(false);
    });

    it('rebuilds a job whose source changed instead of applying the old answer', async () => {
        const app = await mailboxWith('job-1', '{"value": "x"}');
        const apply = vi.fn();
        const outcomes = await ingestAiJobAnswers(asApp(app), [fakeHandler({ currentFingerprint: async () => 'fp-2', apply })]);
        expect(outcomes).toEqual([{ id: 'job-1', kind: 'rebuilt' }]);
        expect(apply).not.toHaveBeenCalled();
        const pending = parseAiJob(await readText(app, `${AI_JOBS_PENDING_DIR}/job-1.json`));
        expect(pending.kind === 'ok' && pending.job.prompt).toBe('rebuilt prompt');
        expect(pending.kind === 'ok' && pending.job.lastRejection?.problems).toEqual([STALE_JOB_PROBLEM]);
    });

    it('drops a job whose target is gone', async () => {
        const app = await mailboxWith('job-1', '{"value": "x"}');
        const outcomes = await ingestAiJobAnswers(asApp(app), [fakeHandler({ currentFingerprint: async () => null })]);
        expect(outcomes).toEqual([{ id: 'job-1', kind: 'target-gone' }]);
        expect(await app.vault.adapter.exists(`${AI_JOBS_PENDING_DIR}/job-1.json`)).toBe(false);
    });

    it('leaves an answer with no matching job in place', async () => {
        const app = await mailboxWith('job-1', '{"value": "x"}');
        await app.vault.adapter.write(`${AI_JOBS_ANSWERS_DIR}/job-typo.json`, '{"value": "y"}');
        const outcomes = await ingestAiJobAnswers(asApp(app), [fakeHandler()]);
        expect(outcomes).toContainEqual({ id: 'job-typo', kind: 'unmatched', reason: 'no pending job has this id' });
        expect(await app.vault.adapter.exists(`${AI_JOBS_ANSWERS_DIR}/job-typo.json`)).toBe(true);
    });

    it('reports a write failure without touching the files or stopping other answers', async () => {
        const app = await mailboxWith('job-1', '{"value": "x"}');
        await writeAiJob(asApp(app), job('job-2'));
        await app.vault.adapter.write(`${AI_JOBS_ANSWERS_DIR}/job-2.json`, '{"value": "x"}');
        const apply = vi.fn(async (current: AiJob) => {
            if (current.id === 'job-1') throw new Error('disk full');
            return { ok: true as const };
        });
        const outcomes = await ingestAiJobAnswers(asApp(app), [fakeHandler({ apply })]);
        expect(outcomes).toEqual([
            { id: 'job-1', kind: 'failed', detail: 'disk full' },
            { id: 'job-2', kind: 'applied' }
        ]);
        expect(await app.vault.adapter.exists(`${AI_JOBS_ANSWERS_DIR}/job-1.json`)).toBe(true);
    });
});

describe('Summary refresh as AI jobs', () => {
    const scene = (title: string, flagged: boolean, body = `Body of ${title}.`) =>
        `---\nClass: Scene\nTitle: ${title}\nAct: 1\nWhen: 2026-01-01\n${flagged ? 'Summary Update: Yes\n' : ''}---\n${body}`;

    function setup(options: { alsoUpdateSynopsis?: boolean } = {}) {
        const app = createInMemoryApp({
            'Books/BookA/01 A1.md': scene('A1', true),
            'Books/BookA/02 A2.md': scene('A2', false),
            'Books/BookB/01 B1.md': scene('B1', true)
        });
        const plugin = {
            app,
            settings: {
                books: [
                    { id: 'book-a', title: 'Book A', sourceFolder: 'Books/BookA' },
                    { id: 'book-b', title: 'Book B', sourceFolder: 'Books/BookB' }
                ],
                activeBookId: 'book-a',
                sourcePath: '',
                synopsisTargetWords: 200,
                synopsisMaxWords: 30,
                alsoUpdateSynopsis: options.alsoUpdateSynopsis ?? false,
                aiUpdateTimestamps: {},
                aiSettings: buildDefaultAiSettings(),
                enableCustomMetadataMapping: false,
                frontmatterMappings: {}
            },
            saveSettings: vi.fn().mockResolvedValue(undefined),
            getActiveBookTitle: () => 'Book A'
        } as unknown as RadialTimelinePlugin;
        return { app, plugin, handler: createSummaryRefreshJobHandler(plugin) };
    }

    async function pendingJobs(app: InMemoryApp): Promise<AiJob[]> {
        const listing = await app.vault.adapter.list(AI_JOBS_PENDING_DIR);
        const jobs: AiJob[] = [];
        for (const path of listing.files) {
            const read = parseAiJob(await readText(app, path));
            if (read.kind !== 'ok') throw new Error(`bad job ${path}`);
            jobs.push(read.job);
        }
        return jobs;
    }

    async function answer(app: InMemoryApp, target: AiJob, body: unknown): Promise<void> {
        await app.vault.adapter.write(`${AI_JOBS_DIR}/${target.answerFile}`, JSON.stringify(body));
    }

    it('prepares a job for each flagged scene in the active book, with the API run\'s own prompt', async () => {
        const { app, plugin } = setup();
        await prepareSummaryRefreshJobs(plugin);

        const jobs = await pendingJobs(app);
        expect(jobs.map(j => j.target.path)).toEqual(['Books/BookA/01 A1.md']);
        const file = app.vault.getAbstractFileByPath('Books/BookA/01 A1.md') as TFile;
        const [sceneData] = await getAllSceneData(plugin, app.vault as never, { files: [file] });
        expect(jobs[0].prompt).toBe(compileRequestPrompt(plugin, buildSummaryRunRequest(sceneData, 200)).finalPrompt);
        expect(await readText(app, `${AI_JOBS_DIR}/AGENTS.md`)).toBe(AI_JOB_INSTRUCTIONS);
        expect(await readText(app, `${AI_JOBS_DIR}/CLAUDE.md`)).toBe(AI_JOB_INSTRUCTIONS);
    });

    it('writes an accepted Summary to the scene, stamped with the client\'s name for itself', async () => {
        const { app, plugin, handler } = setup();
        await prepareSummaryRefreshJobs(plugin);
        const [summaryJob] = await pendingJobs(app);
        await answer(app, summaryJob, { summary: 'A1 happens, factually.', answeredBy: 'Claude app · Opus 5.5' });

        expect(await ingestAiJobAnswers(asApp(app), [handler])).toEqual([{ id: summaryJob.id, kind: 'applied' }]);
        const note = await readText(app, 'Books/BookA/01 A1.md');
        expect(note).toContain('Summary: A1 happens, factually.');
        expect(note).toMatch(/Summary Update: .* by Claude app · Opus 5\.5/);
        expect(await pendingJobs(app)).toEqual([]);
    });

    it('stamps "local agent" when the client does not name itself', async () => {
        const { app, plugin, handler } = setup();
        await prepareSummaryRefreshJobs(plugin);
        const [summaryJob] = await pendingJobs(app);
        await answer(app, summaryJob, { summary: 'A1 happens, factually.' });

        await ingestAiJobAnswers(asApp(app), [handler]);
        expect(await readText(app, 'Books/BookA/01 A1.md')).toMatch(/Summary Update: .* by local agent/);
    });

    it('queues the Synopsis job from the new Summary when "also update Synopsis" is on', async () => {
        const { app, plugin, handler } = setup({ alsoUpdateSynopsis: true });
        await prepareSummaryRefreshJobs(plugin);
        const [summaryJob] = await pendingJobs(app);
        await answer(app, summaryJob, { summary: 'A1 happens, factually.' });
        await ingestAiJobAnswers(asApp(app), [handler]);

        const [synopsisJob] = await pendingJobs(app);
        expect(synopsisJob.task).toBe('SceneSynopsis');
        expect(synopsisJob.prompt).toContain('A1 happens, factually.');
        await answer(app, synopsisJob, { synopsis: 'A1 happens.' });
        expect(await ingestAiJobAnswers(asApp(app), [handler])).toEqual([{ id: synopsisJob.id, kind: 'applied' }]);
        expect(await readText(app, 'Books/BookA/01 A1.md')).toContain('Synopsis: A1 happens.');
    });

    it('sends back an answer with the wrong field and leaves the scene untouched', async () => {
        const { app, plugin, handler } = setup();
        await prepareSummaryRefreshJobs(plugin);
        const [summaryJob] = await pendingJobs(app);
        const before = await readText(app, 'Books/BookA/01 A1.md');
        await answer(app, summaryJob, { synopsis: 'Wrong field.' });

        const [outcome] = await ingestAiJobAnswers(asApp(app), [handler]);
        expect(outcome.kind).toBe('rejected');
        expect(await readText(app, 'Books/BookA/01 A1.md')).toBe(before);
        const [pending] = await pendingJobs(app);
        expect(pending.lastRejection?.problems[0]).toContain('"summary"');
    });

    it('rebuilds the job when the scene was edited after the job was written', async () => {
        const { app, plugin, handler } = setup();
        await prepareSummaryRefreshJobs(plugin);
        const [summaryJob] = await pendingJobs(app);
        await app.vault.adapter.write('Books/BookA/01 A1.md', scene('A1', true, 'A rewritten body.'));
        await answer(app, summaryJob, { summary: 'Summary of the old text.' });

        expect(await ingestAiJobAnswers(asApp(app), [handler])).toEqual([{ id: summaryJob.id, kind: 'rebuilt' }]);
        expect(await readText(app, 'Books/BookA/01 A1.md')).not.toContain('Summary of the old text.');
        const [rebuilt] = await pendingJobs(app);
        expect(rebuilt.prompt).toContain('A rewritten body.');
        expect(rebuilt.lastRejection?.problems).toEqual([STALE_JOB_PROBLEM]);
    });
});
