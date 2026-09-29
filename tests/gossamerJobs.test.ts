import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { App } from 'obsidian';
import type RadialTimelinePlugin from '../src/main';
import type { TimelineItem } from '../src/types';
import { ingestAiJobAnswers, STALE_JOB_PROBLEM } from '../src/ai/jobs/aiJobIngest';
import { AI_JOBS_DIR, AI_JOBS_PENDING_DIR, parseAiJob, type AiJob } from '../src/ai/jobs/aiJobStore';
import { compileRequestPrompt } from '../src/ai/runtime/aiClient';
import { buildDefaultAiSettings } from '../src/ai/settings/aiSettings';
import { buildGossamerRunRequest } from '../src/GossamerCommands';
import { createGossamerJobHandler, prepareGossamerJobs } from '../src/gossamer/gossamerJobs';
import { createInMemoryApp, type InMemoryApp } from './helpers/inMemoryObsidian';

// The book, beat and manuscript loaders read a lot of plugin state; they are
// stubbed. The request builder, the validator and the score writer are real.
const loaders = vi.hoisted(() => ({
    manuscript: 'Scene 1: The station hears a distress call.',
    activeFolder: 'Books/BookA',
    plotBeats: [
        { title: '1.01 Opening Image', path: 'Books/BookA/Beats/1.01 Opening Image.md', itemType: 'Beat' },
        { title: '2.01 Catalyst', path: 'Books/BookA/Beats/2.01 Catalyst.md', itemType: 'Beat' }
    ],
    beats: [
        { beatName: 'Opening Image', beatNumber: 1, idealRange: '0-20', placement: '1.01', description: 'Status quo' },
        { beatName: 'Catalyst', beatNumber: 2, idealRange: '20-40', placement: '2.01', description: 'The call' }
    ]
}));
const beats = loaders.beats;

vi.mock('../src/utils/beatSystemState', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../src/utils/beatSystemState')>()),
    resolveSelectedBeatModelFromSettings: () => 'Save The Cat'
}));
vi.mock('../src/utils/manuscript', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../src/utils/manuscript')>()),
    getSortedSceneFiles: async () => ({ files: [{ path: 'Books/BookA/01 A.md' }], sortOrder: 'narrative' })
}));
vi.mock('../src/utils/exportContext', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../src/utils/exportContext')>()),
    getActiveBookExportContext: () => ({ sourceFolder: loaders.activeFolder, title: 'Book A', fileStem: 'Book-A' })
}));
vi.mock('../src/GossamerCommands', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../src/GossamerCommands')>()),
    loadGossamerBeats: async () => ({ plotBeats: loaders.plotBeats as TimelineItem[], beats: loaders.beats }),
    resolveGossamerEvidence: async () => ({
        label: 'Scene bodies',
        evidenceDocument: { text: loaders.manuscript, totalScenes: 1, includedScenes: 1, totalWords: 7 }
    })
}));

const beatNote = (title: string) => `---\nClass: Beat\nBeat Model: Save The Cat\nTitle: ${title}\n---\n`;

function setup() {
    const app = createInMemoryApp({
        'Books/BookA/Beats/1.01 Opening Image.md': beatNote('Opening Image'),
        'Books/BookA/Beats/2.01 Catalyst.md': beatNote('Catalyst')
    });
    const plugin = {
        app,
        settings: { aiSettings: buildDefaultAiSettings() },
        getActiveBookTitle: () => 'Book A',
        getSceneData: async () => [],
        gossamerLatestOnly: true,
        gossamerVisibleRunIds: [],
        saveGossamerRunFilterState: vi.fn(),
        getTimelineViews: () => []
    } as unknown as RadialTimelinePlugin;
    return { app, plugin, handler: createGossamerJobHandler(plugin) };
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

const tensionAnswer = {
    beats: [
        { beatName: 'Opening Image', signal: 'tension', score: 22, justification: 'Quiet unease on the station.' },
        { beatName: 'Catalyst', signal: 'tension', score: 61, justification: 'The distress call lands.' }
    ],
    overallAssessment: { summary: 'Tension climbs.', strengths: ['a'], improvements: ['b'] },
    answeredBy: 'Claude app · Opus 5.5'
};

async function answerTension(app: InMemoryApp, body: unknown = tensionAnswer): Promise<AiJob> {
    const tension = (await pendingJobs(app)).find(entry => entry.job.id.startsWith('gossamer-tension-'))!;
    await app.vault.adapter.write(`${AI_JOBS_DIR}/${tension.job.answerFile}`, JSON.stringify(body));
    return tension.job;
}

describe('Gossamer scoring as AI jobs', () => {
    beforeEach(() => {
        loaders.manuscript = 'Scene 1: The station hears a distress call.';
        loaders.activeFolder = 'Books/BookA';
    });

    it('prepares one job per signal, each the API run\'s own request over the full manuscript', async () => {
        const { app, plugin } = setup();
        expect(await prepareGossamerJobs(plugin, ['momentum', 'tension'])).toBe(2);
        const jobs = await pendingJobs(app);
        expect(jobs).toHaveLength(2);
        const tension = jobs.find(entry => entry.job.id.startsWith('gossamer-tension-'))!;
        const expected = buildGossamerRunRequest(plugin, { beats, beatSystem: 'Save The Cat', signal: 'tension', manuscriptText: loaders.manuscript });
        expect(tension.prompt).toBe(compileRequestPrompt(plugin, expected).finalPrompt);
        expect(tension.prompt).toContain('Gossamer Neutral Scoring');
        expect(tension.prompt).toContain('The station hears a distress call.');
    });

    it('writes accepted scores with the API run\'s writer, attributed to the client', async () => {
        const { app, plugin, handler } = setup();
        await prepareGossamerJobs(plugin, ['tension']);
        const job = await answerTension(app);

        expect(await ingestAiJobAnswers(app as unknown as App, [handler])).toEqual([{ id: job.id, kind: 'applied' }]);
        const catalyst = await app.vault.adapter.read('Books/BookA/Beats/2.01 Catalyst.md');
        expect(catalyst).toContain('Gossamer1: 61');
        expect(catalyst).toContain('Gossamer1 Justification: The distress call lands.');
        expect(catalyst).toContain('GossamerProvider1: agent');
        expect(catalyst).toContain('GossamerModel1: Claude app · Opus 5.5');
        expect(catalyst).toMatch(/Gossamer Last Updated: .* by Claude app · Opus 5\.5/);
    });

    it('sends back scores for the wrong signal, as the API run would reject them', async () => {
        const { app, plugin, handler } = setup();
        await prepareGossamerJobs(plugin, ['tension']);
        await answerTension(app, { ...tensionAnswer, beats: tensionAnswer.beats.map(beat => ({ ...beat, signal: 'momentum' })) });

        const [outcome] = await ingestAiJobAnswers(app as unknown as App, [handler]);
        expect(outcome.kind).toBe('rejected');
        expect(await app.vault.adapter.read('Books/BookA/Beats/2.01 Catalyst.md')).not.toContain('Gossamer1');
    });

    it('rebuilds the job when the manuscript changed after it was written', async () => {
        const { app, plugin, handler } = setup();
        await prepareGossamerJobs(plugin, ['tension']);
        const job = await answerTension(app);
        loaders.manuscript = 'Scene 1: The station hears nothing at all.';

        expect(await ingestAiJobAnswers(app as unknown as App, [handler])).toEqual([{ id: job.id, kind: 'rebuilt' }]);
        const [rebuilt] = await pendingJobs(app);
        expect(rebuilt.prompt).toContain('The station hears nothing at all.');
        expect(rebuilt.job.lastRejection?.problems).toEqual([STALE_JOB_PROBLEM]);
    });

    it('leaves a job for another book in place instead of scoring the active one', async () => {
        const { app, plugin, handler } = setup();
        await prepareGossamerJobs(plugin, ['tension']);
        const job = await answerTension(app);
        loaders.activeFolder = 'Books/BookB';

        const [outcome] = await ingestAiJobAnswers(app as unknown as App, [handler]);
        expect(outcome.kind).toBe('failed');
        expect(await app.vault.adapter.exists(`${AI_JOBS_DIR}/${job.answerFile}`)).toBe(true);
    });
});
