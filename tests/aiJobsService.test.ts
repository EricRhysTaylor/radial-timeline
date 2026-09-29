import { beforeEach, describe, expect, it, vi } from 'vitest';
import type RadialTimelinePlugin from '../src/main';
import { AI_JOBS_WAITING_PATH, AI_JOB_SCHEMA_VERSION, ensureAiJobMailbox, removeAiJob, writeAiJob } from '../src/ai/jobs/aiJobStore';
import { AiJobsService, parseAiJobRequest } from '../src/services/AiJobsService';
import { createInMemoryApp, type InMemoryApp } from './helpers/inMemoryObsidian';

// Each feature's own preparation is covered by its own tests; here they are
// stand-ins, so the service's ordering and waiting are what is under test.
const prep = vi.hoisted(() => ({
    summary: vi.fn(),
    pulse: vi.fn(),
    gossamer: vi.fn(),
    inquiry: vi.fn()
}));
vi.mock('../src/sceneAnalysis/summaryRefreshJobs', () => ({
    createSummaryRefreshJobHandler: vi.fn(),
    prepareSummaryRefreshJobs: prep.summary
}));
vi.mock('../src/sceneAnalysis/pulseJobs', () => ({ createPulseJobHandler: vi.fn(), preparePulseJobs: prep.pulse }));
vi.mock('../src/gossamer/gossamerJobs', () => ({ createGossamerJobHandler: vi.fn(), prepareGossamerJobs: prep.gossamer }));
vi.mock('../src/inquiry/inquiryJobs', () => ({ createInquiryJobHandler: vi.fn(), prepareInquiryJobs: prep.inquiry }));

const books = [
    { id: 'book-1', title: 'Pride and Prejudice', sourceFolder: 'Classics/Pride and Prejudice' },
    { id: 'book-2', title: 'Frankenstein', sourceFolder: 'Classics/Frankenstein' }
];

async function writeSummaryJob(app: InMemoryApp, scenePath: string): Promise<string> {
    const id = `summary-${scenePath.length}`;
    await writeAiJob(app as never, {
        prompt: 'Summarize the scene.',
        job: {
            schemaVersion: AI_JOB_SCHEMA_VERSION, id, feature: 'SummaryRefresh', task: 'SceneSummary',
            createdAt: new Date().toISOString(), target: { path: scenePath, label: scenePath },
            sourceFingerprint: '0', promptFile: `Pending/${id}.prompt.txt`, answerFile: `Answers/${id}.json`
        }
    });
    return id;
}

function setup() {
    const app = createInMemoryApp({});
    // The metadata cache reports "resolved" when the test says so.
    const resolvedListeners: Array<() => void> = [];
    const metadataCache = {
        ...app.metadataCache,
        on: vi.fn((_name: string, listener: () => void) => { resolvedListeners.push(listener); return listener; }),
        offref: vi.fn()
    };
    const settings = { activeBookId: 'book-1', books, enableAiSceneAnalysis: true };
    const plugin = {
        app: { ...app, vault: app.vault, metadataCache },
        settings,
        getActiveBookTitle: () => 'Pride and Prejudice'
    } as unknown as RadialTimelinePlugin;
    const service = new AiJobsService(plugin);
    const internals = service as unknown as { writeWaitingJobs(): Promise<void>; releaseWaitingJobs(): Promise<void> };
    return {
        app,
        settings,
        service,
        writeWaitingJobs: () => internals.writeWaitingJobs(),
        releaseWaitingJobs: () => internals.releaseWaitingJobs(),
        metadataWaiting: () => resolvedListeners.length > 0,
        resolveMetadata: () => resolvedListeners.splice(0).forEach(listener => listener())
    };
}

describe('Preparing a book\'s AI jobs in one step', () => {
    beforeEach(() => {
        Object.values(prep).forEach(mock => mock.mockReset());
        prep.pulse.mockResolvedValue(40);
        prep.gossamer.mockResolvedValue(4);
        prep.inquiry.mockResolvedValue(27);
    });

    it('reports each feature, and one that cannot be prepared does not stop the rest', async () => {
        const { service } = setup();
        prep.summary.mockResolvedValue(0);
        prep.gossamer.mockRejectedValue(new Error('No story beats found for this book.'));

        const outcomes = await service.prepare({ summary: 'missing', pulse: 'missing', gossamer: ['momentum', 'tension'], inquiry: 'missing' });
        expect(outcomes).toEqual([
            { feature: 'summary', kind: 'written', count: 0 },
            { feature: 'pulse', kind: 'written', count: 40 },
            { feature: 'gossamer', kind: 'blocked', reason: 'No story beats found for this book.' },
            { feature: 'inquiry', kind: 'written', count: 27 }
        ]);
        expect(prep.gossamer).toHaveBeenCalledWith(expect.anything(), ['momentum', 'tension']);
    });

    it('holds Inquiry while the book has Summary jobs pending, and writes it once they are applied', async () => {
        const { app, service, writeWaitingJobs } = setup();
        await ensureAiJobMailbox(app as never);
        let summaryId = '';
        prep.summary.mockImplementation(async () => {
            summaryId = await writeSummaryJob(app, 'Classics/Pride and Prejudice/01 Netherfield.md');
            return 1;
        });

        const outcomes = await service.prepare({ summary: 'missing', inquiry: 'all' });
        expect(outcomes).toContainEqual({ feature: 'inquiry', kind: 'waiting' });
        expect(prep.inquiry).not.toHaveBeenCalled();
        expect(JSON.parse(await app.vault.adapter.read(AI_JOBS_WAITING_PATH)).inquiry).toEqual([
            expect.objectContaining({ bookId: 'book-1', scope: 'all' })
        ]);

        await writeWaitingJobs();
        expect(prep.inquiry).not.toHaveBeenCalled();

        await removeAiJob(app as never, summaryId);
        await writeWaitingJobs();
        expect(prep.inquiry).toHaveBeenCalledWith(expect.anything(), 'all');
        expect(await app.vault.adapter.exists(AI_JOBS_WAITING_PATH)).toBe(false);
    });

    it('does not hold Inquiry for Summary jobs that belong to another book', async () => {
        const { app, service } = setup();
        await ensureAiJobMailbox(app as never);
        await writeSummaryJob(app, 'Classics/Frankenstein/01 Walton.md');

        expect(await service.prepare({ inquiry: 'missing' })).toEqual([{ feature: 'inquiry', kind: 'written', count: 27 }]);
    });

    it('keeps waiting Inquiry jobs until their book is active again', async () => {
        const { app, settings, service, writeWaitingJobs } = setup();
        await ensureAiJobMailbox(app as never);
        const summaryId = await writeSummaryJob(app, 'Classics/Pride and Prejudice/01 Netherfield.md');
        await service.prepare({ inquiry: 'missing' });
        await removeAiJob(app as never, summaryId);

        settings.activeBookId = 'book-2';
        await writeWaitingJobs();
        expect(prep.inquiry).not.toHaveBeenCalled();
        expect(await app.vault.adapter.exists(AI_JOBS_WAITING_PATH)).toBe(true);

        settings.activeBookId = 'book-1';
        await writeWaitingJobs();
        expect(prep.inquiry).toHaveBeenCalledWith(expect.anything(), 'missing');
    });
});

describe('Inquiry jobs waiting on Summaries', () => {
    beforeEach(() => {
        Object.values(prep).forEach(mock => mock.mockReset());
        prep.inquiry.mockResolvedValue(27);
    });

    it('are written only once the metadata cache has re-read the new Summaries', async () => {
        const { app, service, releaseWaitingJobs, metadataWaiting, resolveMetadata } = setup();
        await ensureAiJobMailbox(app as never);
        const summaryId = await writeSummaryJob(app, 'Classics/Pride and Prejudice/01 Netherfield.md');
        await service.prepare({ inquiry: 'missing' });
        await removeAiJob(app as never, summaryId);

        const release = releaseWaitingJobs();
        await vi.waitFor(() => expect(metadataWaiting()).toBe(true));
        expect(prep.inquiry).not.toHaveBeenCalled();
        resolveMetadata();
        await release;
        expect(prep.inquiry).toHaveBeenCalledWith(expect.anything(), 'missing');
    });

    it('refuses a Waiting.json Radial Timeline did not write, instead of guessing at it', async () => {
        const { app, writeWaitingJobs } = setup();
        await ensureAiJobMailbox(app as never);
        await app.vault.adapter.write(AI_JOBS_WAITING_PATH, JSON.stringify({ inquiry: [{ bookId: 'book-1' }] }));

        await writeWaitingJobs();
        expect(prep.inquiry).not.toHaveBeenCalled();
        expect(await app.vault.adapter.exists(AI_JOBS_WAITING_PATH)).toBe(true);
    });
});

describe('The AI job request link', () => {
    it('reads prepare, scope, signals and book', () => {
        expect(parseAiJobRequest({ prepare: 'all', book: 'Frankenstein' })).toEqual({
            plan: {
                summary: 'missing',
                pulse: 'missing',
                gossamer: ['momentum', 'tension', 'activity', 'interiority'],
                inquiry: 'missing'
            },
            book: 'Frankenstein'
        });
        expect(parseAiJobRequest({ prepare: 'pulse,gossamer', scope: 'all', signals: 'tension' })).toEqual({
            plan: { pulse: 'all', gossamer: ['tension'] }
        });
    });

    it('asks Inquiry for the questions still to answer when the scope is "flagged"', () => {
        expect(parseAiJobRequest({ prepare: 'inquiry', scope: 'flagged' })).toEqual({ plan: { inquiry: 'missing' } });
    });

    it('refuses what it cannot read rather than guessing', () => {
        expect(parseAiJobRequest({})).toEqual({ problem: expect.stringContaining('prepare names no feature') });
        expect(parseAiJobRequest({ prepare: 'summary,synopsis' })).toEqual({ problem: expect.stringContaining('synopsis') });
        expect(parseAiJobRequest({ prepare: 'all', scope: 'some' })).toEqual({ problem: expect.stringContaining('some') });
        expect(parseAiJobRequest({ prepare: 'gossamer', signals: 'tension,dread' })).toEqual({ problem: expect.stringContaining('dread') });
    });
});
