import { describe, expect, it, vi } from 'vitest';
import { TFile } from 'obsidian';
import type RadialTimelinePlugin from '../src/main';
import { ingestAiJobAnswers, STALE_JOB_PROBLEM, type AiJobApplyResult, type AiJobHandler } from '../src/ai/jobs/aiJobIngest';
import {
    AI_JOBS_DIR,
    AI_JOBS_PENDING_DIR,
    AI_JOBS_ANSWERS_DIR,
    AI_JOB_INSTRUCTIONS,
    ensureAiJobMailbox,
    parseAiJob,
    writeAiJob,
    type AiJob,
    type PreparedAiJob
} from '../src/ai/jobs/aiJobStore';
import { compileRequestPrompt } from '../src/ai/runtime/aiClient';
import { buildDefaultAiSettings } from '../src/ai/settings/aiSettings';
import { fnv1a32Hex } from '../src/utils/hash';
import { buildSummaryRunRequest } from '../src/sceneAnalysis/summaryRefresh';
import { getAllSceneData } from '../src/sceneAnalysis/data';
import { buildPulseRunRequest } from '../src/sceneAnalysis/aiProvider';
import { buildTripletPrompt } from '../src/sceneAnalysis/Processor';
import {
    createSummaryRefreshJobHandler,
    prepareSummaryRefreshJobs
} from '../src/sceneAnalysis/summaryRefreshJobs';
import { createPulseJobHandler, preparePulseJobs } from '../src/sceneAnalysis/pulseJobs';
import { createInMemoryApp, type InMemoryApp } from './helpers/inMemoryObsidian';
import type { App } from 'obsidian';

const asApp = (app: InMemoryApp) => app as unknown as App;

async function readText(app: InMemoryApp, path: string): Promise<string> {
    return app.vault.adapter.read(path);
}

async function pendingJobs(app: InMemoryApp): Promise<Array<{ job: AiJob; prompt: string }>> {
    const listing = await app.vault.adapter.list(AI_JOBS_PENDING_DIR);
    const jobs: Array<{ job: AiJob; prompt: string }> = [];
    for (const path of listing.files.filter(file => file.endsWith('.json')).sort()) {
        const read = parseAiJob(await readText(app, path));
        if (read.kind !== 'ok') throw new Error(`bad job ${path}`);
        jobs.push({ job: read.job, prompt: await readText(app, `${AI_JOBS_DIR}/${read.job.promptFile}`) });
    }
    return jobs;
}

async function answer(app: InMemoryApp, target: AiJob, body: unknown): Promise<void> {
    await app.vault.adapter.write(`${AI_JOBS_DIR}/${target.answerFile}`, JSON.stringify(body));
}

function fakePrepared(id: string, prompt = 'Answer with {"value": "..."}'): PreparedAiJob {
    return {
        prompt,
        job: {
            schemaVersion: 1,
            id,
            feature: 'Fake',
            task: 'FakeTask',
            createdAt: '2026-09-29T00:00:00.000Z',
            target: { path: 'Notes/a.md', label: 'a' },
            sourceFingerprint: fnv1a32Hex(prompt),
            promptFile: `Pending/${id}.prompt.txt`,
            answerFile: `Answers/${id}.json`
        }
    };
}

const acceptValue = async (answerText: string): Promise<AiJobApplyResult> =>
    (answerText.includes('"value"') ? { ok: true } : { ok: false, problems: ['missing "value"'] });

function fakeHandler(options: {
    prompt?: string | null;
    apply?: (answerText: string, attribution: string, job: AiJob) => Promise<AiJobApplyResult>;
} = {}): AiJobHandler {
    return {
        feature: 'Fake',
        rebuild: async (job) => {
            if (options.prompt === null) return null;
            const apply = options.apply;
            return {
                prepared: fakePrepared(job.id, options.prompt),
                apply: (answerText, attribution) => (apply ? apply(answerText, attribution, job) : acceptValue(answerText))
            };
        }
    };
}

describe('AI job ingest', () => {
    async function mailboxWith(id: string, answerText: string): Promise<InMemoryApp> {
        const app = createInMemoryApp({});
        await ensureAiJobMailbox(asApp(app));
        await writeAiJob(asApp(app), fakePrepared(id));
        await app.vault.adapter.write(`${AI_JOBS_ANSWERS_DIR}/${id}.json`, answerText);
        return app;
    }

    it('writes the prompt as its own plain-text file next to the job', async () => {
        const app = await mailboxWith('job-1', '{"value": "x"}');
        expect(await readText(app, `${AI_JOBS_PENDING_DIR}/job-1.prompt.txt`)).toBe('Answer with {"value": "..."}');
        const [{ job }] = await pendingJobs(app);
        expect(job.promptFile).toBe('Pending/job-1.prompt.txt');
        expect(job).not.toHaveProperty('prompt');
    });

    it('applies an accepted answer and deletes the job, its prompt and the answer', async () => {
        const app = await mailboxWith('job-1', '{"value": "x"}');
        const outcomes = await ingestAiJobAnswers(asApp(app), [fakeHandler()]);
        expect(outcomes).toEqual([{ id: 'job-1', kind: 'applied' }]);
        expect(await app.vault.adapter.exists(`${AI_JOBS_PENDING_DIR}/job-1.json`)).toBe(false);
        expect(await app.vault.adapter.exists(`${AI_JOBS_PENDING_DIR}/job-1.prompt.txt`)).toBe(false);
        expect(await app.vault.adapter.exists(`${AI_JOBS_ANSWERS_DIR}/job-1.json`)).toBe(false);
    });

    it('sends a failing answer back by recording the problems on the job', async () => {
        const app = await mailboxWith('job-1', '{"other": "x"}');
        const outcomes = await ingestAiJobAnswers(asApp(app), [fakeHandler()]);
        expect(outcomes).toEqual([{ id: 'job-1', kind: 'rejected', problems: ['missing "value"'] }]);
        const [pending] = await pendingJobs(app);
        expect(pending.job.lastRejection?.problems).toEqual(['missing "value"']);
        expect(pending.prompt).toBe('Answer with {"value": "..."}');
        expect(await app.vault.adapter.exists(`${AI_JOBS_ANSWERS_DIR}/job-1.json`)).toBe(false);
    });

    it('rebuilds a job whose prompt changed instead of applying the old answer', async () => {
        const app = await mailboxWith('job-1', '{"value": "x"}');
        const apply = vi.fn(acceptValue);
        const outcomes = await ingestAiJobAnswers(asApp(app), [fakeHandler({ prompt: 'rebuilt prompt', apply })]);
        expect(outcomes).toEqual([{ id: 'job-1', kind: 'rebuilt' }]);
        expect(apply).not.toHaveBeenCalled();
        const [pending] = await pendingJobs(app);
        expect(pending.prompt).toBe('rebuilt prompt');
        expect(pending.job.lastRejection?.problems).toEqual([STALE_JOB_PROBLEM]);
    });

    it('drops a job whose target is gone', async () => {
        const app = await mailboxWith('job-1', '{"value": "x"}');
        const outcomes = await ingestAiJobAnswers(asApp(app), [fakeHandler({ prompt: null })]);
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
        await writeAiJob(asApp(app), fakePrepared('job-2'));
        await app.vault.adapter.write(`${AI_JOBS_ANSWERS_DIR}/job-2.json`, '{"value": "x"}');
        const apply = vi.fn(async (_answer: string, _attribution: string, current: AiJob): Promise<AiJobApplyResult> => {
            if (current.id === 'job-1') throw new Error('disk full');
            return { ok: true };
        });
        const outcomes = await ingestAiJobAnswers(asApp(app), [fakeHandler({ apply })]);
        expect(outcomes).toEqual([
            { id: 'job-1', kind: 'failed', detail: 'disk full' },
            { id: 'job-2', kind: 'applied' }
        ]);
        expect(await app.vault.adapter.exists(`${AI_JOBS_ANSWERS_DIR}/job-1.json`)).toBe(true);
    });
});

function pluginFor(app: InMemoryApp, overrides: Record<string, unknown> = {}): RadialTimelinePlugin {
    return {
        app,
        settings: {
            books: [
                { id: 'book-a', title: 'Book A', sourceFolder: 'Books/BookA' },
                { id: 'book-b', title: 'Book B', sourceFolder: 'Books/BookB' }
            ],
            activeBookId: 'book-a',
            sourcePath: 'Books/BookA',
            synopsisTargetWords: 200,
            synopsisMaxWords: 30,
            alsoUpdateSynopsis: false,
            aiUpdateTimestamps: {},
            aiSettings: buildDefaultAiSettings(),
            enableCustomMetadataMapping: false,
            frontmatterMappings: {},
            ...overrides
        },
        saveSettings: vi.fn().mockResolvedValue(undefined),
        getActiveBookTitle: () => 'Book A',
        lastAnalysisError: ''
    } as unknown as RadialTimelinePlugin;
}

describe('Summary refresh as AI jobs', () => {
    const scene = (title: string, flagged: boolean, body = `Body of ${title}.`) =>
        `---\nClass: Scene\nTitle: ${title}\nAct: 1\nWhen: 2026-01-01\n${flagged ? 'Summary Update: Yes\n' : ''}---\n${body}`;

    function setup(options: { alsoUpdateSynopsis?: boolean } = {}) {
        const app = createInMemoryApp({
            'Books/BookA/01 A1.md': scene('A1', true),
            'Books/BookA/02 A2.md': scene('A2', false),
            'Books/BookB/01 B1.md': scene('B1', true)
        });
        const plugin = pluginFor(app, { alsoUpdateSynopsis: options.alsoUpdateSynopsis ?? false });
        return { app, plugin, handler: createSummaryRefreshJobHandler(plugin) };
    }

    it('prepares a job for each flagged scene in the active book, with the API run\'s own prompt', async () => {
        const { app, plugin } = setup();
        expect(await prepareSummaryRefreshJobs(plugin, 'flagged')).toBe(1);

        const jobs = await pendingJobs(app);
        expect(jobs.map(j => j.job.target.path)).toEqual(['Books/BookA/01 A1.md']);
        const file = app.vault.getAbstractFileByPath('Books/BookA/01 A1.md') as TFile;
        const [sceneData] = await getAllSceneData(plugin, app.vault as never, { files: [file] });
        expect(jobs[0].prompt).toBe(compileRequestPrompt(plugin, buildSummaryRunRequest(sceneData, 200)).finalPrompt);
        expect(await readText(app, `${AI_JOBS_DIR}/AGENTS.md`)).toBe(AI_JOB_INSTRUCTIONS);
        expect(await readText(app, `${AI_JOBS_DIR}/CLAUDE.md`)).toBe(AI_JOB_INSTRUCTIONS);
    });

    it('prepares every scene of the active book with the "all" scope', async () => {
        const { app, plugin } = setup();
        expect(await prepareSummaryRefreshJobs(plugin, 'all')).toBe(2);
        expect((await pendingJobs(app)).map(j => j.job.target.path)).toEqual(
            expect.arrayContaining(['Books/BookA/01 A1.md', 'Books/BookA/02 A2.md'])
        );
    });

    it('writes an accepted Summary to the scene, stamped with the client\'s name for itself', async () => {
        const { app, plugin, handler } = setup();
        await prepareSummaryRefreshJobs(plugin, 'flagged');
        const [{ job: summaryJob }] = await pendingJobs(app);
        await answer(app, summaryJob, { summary: 'A1 happens, factually.', answeredBy: 'Claude app · Opus 5.5' });

        expect(await ingestAiJobAnswers(asApp(app), [handler])).toEqual([{ id: summaryJob.id, kind: 'applied' }]);
        const note = await readText(app, 'Books/BookA/01 A1.md');
        expect(note).toContain('Summary: A1 happens, factually.');
        expect(note).toMatch(/Summary Update: .* by Claude app · Opus 5\.5/);
        expect(await pendingJobs(app)).toEqual([]);
    });

    it('stamps "local agent" when the client does not name itself', async () => {
        const { app, plugin, handler } = setup();
        await prepareSummaryRefreshJobs(plugin, 'flagged');
        const [{ job: summaryJob }] = await pendingJobs(app);
        await answer(app, summaryJob, { summary: 'A1 happens, factually.' });

        await ingestAiJobAnswers(asApp(app), [handler]);
        expect(await readText(app, 'Books/BookA/01 A1.md')).toMatch(/Summary Update: .* by local agent/);
    });

    it('queues the Synopsis job from the new Summary when "also update Synopsis" is on', async () => {
        const { app, plugin, handler } = setup({ alsoUpdateSynopsis: true });
        await prepareSummaryRefreshJobs(plugin, 'flagged');
        const [{ job: summaryJob }] = await pendingJobs(app);
        await answer(app, summaryJob, { summary: 'A1 happens, factually.' });
        await ingestAiJobAnswers(asApp(app), [handler]);

        const [synopsis] = await pendingJobs(app);
        expect(synopsis.job.task).toBe('SceneSynopsis');
        expect(synopsis.prompt).toContain('A1 happens, factually.');
        await answer(app, synopsis.job, { synopsis: 'A1 happens.' });
        expect(await ingestAiJobAnswers(asApp(app), [handler])).toEqual([{ id: synopsis.job.id, kind: 'applied' }]);
        expect(await readText(app, 'Books/BookA/01 A1.md')).toContain('Synopsis: A1 happens.');
    });

    it('sends back an answer with the wrong field and leaves the scene untouched', async () => {
        const { app, plugin, handler } = setup();
        await prepareSummaryRefreshJobs(plugin, 'flagged');
        const [{ job: summaryJob }] = await pendingJobs(app);
        const before = await readText(app, 'Books/BookA/01 A1.md');
        await answer(app, summaryJob, { synopsis: 'Wrong field.' });

        const [outcome] = await ingestAiJobAnswers(asApp(app), [handler]);
        expect(outcome.kind).toBe('rejected');
        expect(await readText(app, 'Books/BookA/01 A1.md')).toBe(before);
        const [pending] = await pendingJobs(app);
        expect(pending.job.lastRejection?.problems[0]).toContain('"summary"');
    });

    it('rebuilds the job when the scene was edited after the job was written', async () => {
        const { app, plugin, handler } = setup();
        await prepareSummaryRefreshJobs(plugin, 'flagged');
        const [{ job: summaryJob }] = await pendingJobs(app);
        await app.vault.adapter.write('Books/BookA/01 A1.md', scene('A1', true, 'A rewritten body.'));
        await answer(app, summaryJob, { summary: 'Summary of the old text.' });

        expect(await ingestAiJobAnswers(asApp(app), [handler])).toEqual([{ id: summaryJob.id, kind: 'rebuilt' }]);
        expect(await readText(app, 'Books/BookA/01 A1.md')).not.toContain('Summary of the old text.');
        const [rebuilt] = await pendingJobs(app);
        expect(rebuilt.prompt).toContain('A rewritten body.');
        expect(rebuilt.job.lastRejection?.problems).toEqual([STALE_JOB_PROBLEM]);
    });
});

describe('Scene pulse analysis as AI jobs', () => {
    const scene = (title: string, options: { flagged?: boolean; analyzed?: boolean; body?: string } = {}) => [
        '---',
        'Class: Scene',
        `Title: ${title}`,
        'Status: Working',
        'Act: 1',
        'When: 2026-01-01',
        ...(options.flagged ? ['Pulse Update: Yes'] : []),
        ...(options.analyzed ? ['currentSceneAnalysis:', '  - 1 B / Earlier analysis'] : []),
        '---',
        options.body ?? `Body of ${title}.`
    ].join('\n');

    function setup() {
        const app = createInMemoryApp({
            'Books/BookA/01 Arrival.md': scene('Arrival', { analyzed: true }),
            'Books/BookA/02 Distress call.md': scene('Distress call', { flagged: true }),
            'Books/BookA/03 Launch.md': scene('Launch')
        });
        const plugin = pluginFor(app);
        return { app, plugin, handler: createPulseJobHandler(plugin) };
    }

    const pulseAnswer = {
        previousSceneAnalysis: [{ ref_id: 'Books/BookA/01 Arrival.md', scene: '1', title: 'Setup', grade: '+', comment: 'Sets up the call' }],
        currentSceneAnalysis: [
            { ref_id: 'Books/BookA/02 Distress call.md', scene: '2', title: 'Overall Scene Grade', grade: 'B', comment: 'Tighten the middle' },
            { ref_id: 'Books/BookA/02 Distress call.md', scene: '2', title: 'Rising stakes', grade: '+', comment: 'The call raises stakes' }
        ],
        nextSceneAnalysis: [{ ref_id: 'Books/BookA/03 Launch.md', scene: '3', title: 'Payoff', grade: '+', comment: 'Launch answers the call' }],
        answeredBy: 'Codex app · GPT-6 Sol'
    };

    it('prepares jobs by scope: flagged, not yet analyzed, or all', async () => {
        const { app, plugin } = setup();
        expect(await preparePulseJobs(plugin, 'flagged')).toBe(1);
        expect(await preparePulseJobs(plugin, 'missing')).toBe(2);
        expect(await preparePulseJobs(plugin, 'all')).toBe(3);
        expect((await pendingJobs(app)).length).toBe(3);
    });

    it('carries the API run\'s own triplet prompt, with both neighbors', async () => {
        const { app, plugin } = setup();
        await preparePulseJobs(plugin, 'flagged');
        const [pulse] = await pendingJobs(app);
        const scenes = await getAllSceneData(plugin, app.vault as never);
        const byPath = (path: string) => scenes.find(item => item.file.path === path)!;
        const triplet = {
            prev: byPath('Books/BookA/01 Arrival.md'),
            current: byPath('Books/BookA/02 Distress call.md'),
            next: byPath('Books/BookA/03 Launch.md')
        };
        expect(pulse.prompt).toBe(compileRequestPrompt(plugin, buildPulseRunRequest(buildTripletPrompt(plugin, triplet))).finalPrompt);
        expect(pulse.prompt).toContain('Body of Arrival.');
        expect(pulse.prompt).toContain('Body of Launch.');
    });

    it('writes an accepted answer with the Pulse writer, stamped with the client\'s name', async () => {
        const { app, plugin, handler } = setup();
        await preparePulseJobs(plugin, 'flagged');
        const [pulse] = await pendingJobs(app);
        await answer(app, pulse.job, pulseAnswer);

        expect(await ingestAiJobAnswers(asApp(app), [handler])).toEqual([{ id: pulse.job.id, kind: 'applied' }]);
        const note = await readText(app, 'Books/BookA/02 Distress call.md');
        expect(note).toContain('2 B / Tighten the middle');
        expect(note).toContain('Rising stakes + / The call raises stakes');
        expect(note).toMatch(/Pulse Update: .* by Codex app · GPT-6 Sol/);
    });

    it('rebuilds the job when a neighboring scene changes', async () => {
        const { app, plugin, handler } = setup();
        await preparePulseJobs(plugin, 'flagged');
        const [pulse] = await pendingJobs(app);
        await app.vault.adapter.write('Books/BookA/03 Launch.md', scene('Launch', { body: 'The launch is scrubbed.' }));
        await answer(app, pulse.job, pulseAnswer);

        expect(await ingestAiJobAnswers(asApp(app), [handler])).toEqual([{ id: pulse.job.id, kind: 'rebuilt' }]);
        const [rebuilt] = await pendingJobs(app);
        expect(rebuilt.prompt).toContain('The launch is scrubbed.');
    });

    it('sends back an answer without the overall grade', async () => {
        const { app, plugin, handler } = setup();
        await preparePulseJobs(plugin, 'flagged');
        const [pulse] = await pendingJobs(app);
        await answer(app, pulse.job, { ...pulseAnswer, currentSceneAnalysis: [] });

        const [outcome] = await ingestAiJobAnswers(asApp(app), [handler]);
        expect(outcome.kind).toBe('rejected');
        const [pending] = await pendingJobs(app);
        expect(pending.job.lastRejection?.problems[0]).toContain('currentSceneAnalysis');
    });
});
