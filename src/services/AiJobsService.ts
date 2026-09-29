/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 *
 * AI jobs for a whole book in one step: Summary refresh, Pulse triplet
 * analysis, Gossamer scoring and Inquiry, written for an AI client the author
 * runs themselves. Prepared from "Prepare AI jobs…", or from a request link
 * the client opens itself (obsidian://radial-timeline-ai-jobs), so the client
 * can prepare a book, answer every job and move on to the next book.
 *
 * Inquiry can read scene Summaries, so while Summary jobs for the book are
 * pending its jobs wait (Waiting.json) and are written after the pass that
 * applies the last of them. Written earlier, every Inquiry job would go stale
 * as the Summaries landed, and the client would answer each question twice.
 */

import { Notice, normalizePath, type ObsidianProtocolData } from 'obsidian';
import type RadialTimelinePlugin from '../main';
import { t } from '../i18n';
import { getActiveBook } from '../utils/books';
import type { BookProfile } from '../types/settings';
import { AI_JOBS_DIR, AI_JOBS_WAITING_PATH, listPendingAiJobs, type AiJobScope } from '../ai/jobs/aiJobStore';
import { registerAiJobs } from '../ai/jobs/aiJobIngest';
import { createSummaryRefreshJobHandler, prepareSummaryRefreshJobs } from '../sceneAnalysis/summaryRefreshJobs';
import { createPulseJobHandler, preparePulseJobs } from '../sceneAnalysis/pulseJobs';
import { createGossamerJobHandler, prepareGossamerJobs } from '../gossamer/gossamerJobs';
import { createInquiryJobHandler, prepareInquiryJobs } from '../inquiry/inquiryJobs';
import { GOSSAMER_SIGNAL_TYPES, type GossamerSignalType } from '../types/gossamerSignals';
import { PrepareAiJobsModal } from '../modals/PrepareAiJobsModal';

export const AI_JOBS_PROTOCOL_ACTION = 'radial-timeline-ai-jobs';

export type InquiryJobScope = 'missing' | 'all';

/** What to prepare for the active book. An absent feature is not prepared. */
export interface AiJobPlan {
    summary?: AiJobScope;
    pulse?: AiJobScope;
    gossamer?: readonly GossamerSignalType[];
    inquiry?: InquiryJobScope;
}

export type AiJobFeatureKey = keyof AiJobPlan;

export type AiJobPrepareOutcome =
    | { feature: AiJobFeatureKey; kind: 'written'; count: number }
    | { feature: AiJobFeatureKey; kind: 'waiting' }
    | { feature: AiJobFeatureKey; kind: 'blocked'; reason: string };

interface WaitingInquiry {
    bookId: string;
    scope: InquiryJobScope;
    /** For the author and the client reading the file. */
    waitingFor: string;
}

const SUMMARY_FEATURE = 'SummaryRefresh';

function vaultIo(plugin: RadialTimelinePlugin) {
    return plugin.app.vault.adapter; // SAFE: machine JSON beside the job mailbox; adapter avoids metadata-cache/index races, as aiJobStore does
}

async function readWaiting(plugin: RadialTimelinePlugin): Promise<WaitingInquiry[]> {
    const path = normalizePath(AI_JOBS_WAITING_PATH);
    if (!(await vaultIo(plugin).exists(path))) return [];
    let parsed: unknown;
    try {
        parsed = JSON.parse(await vaultIo(plugin).read(path));
    } catch (error) {
        throw new Error(`${AI_JOBS_WAITING_PATH} is not valid JSON (${error instanceof Error ? error.message : String(error)}). Delete it and prepare Inquiry again.`);
    }
    const inquiry = parsed && typeof parsed === 'object' ? (parsed as { inquiry?: unknown }).inquiry : undefined;
    if (!Array.isArray(inquiry)) throw new Error(`${AI_JOBS_WAITING_PATH} has no "inquiry" list. Delete it and prepare Inquiry again.`);
    return inquiry as WaitingInquiry[];
}

async function writeWaiting(plugin: RadialTimelinePlugin, inquiry: WaitingInquiry[]): Promise<void> {
    const path = normalizePath(AI_JOBS_WAITING_PATH);
    if (inquiry.length === 0) {
        if (await vaultIo(plugin).exists(path)) await vaultIo(plugin).remove(path);
        return;
    }
    await vaultIo(plugin).write(path, JSON.stringify({ schemaVersion: 1, inquiry }, null, 2));
}

async function hasPendingSummaryJobs(plugin: RadialTimelinePlugin, book: BookProfile): Promise<boolean> {
    const folder = normalizePath(book.sourceFolder.trim());
    return (await listPendingAiJobs(plugin.app)).some(job =>
        job.feature === SUMMARY_FEATURE && (folder === '/' || job.target.path.startsWith(`${folder}/`))
    );
}

/** The request link's parameters as a plan, or the problem that stops them being read. */
export function parseAiJobRequest(params: Record<string, string | undefined>): { plan: AiJobPlan; book?: string } | { problem: string } {
    const requested = (params.prepare ?? '').split(',').map(part => part.trim().toLowerCase()).filter(Boolean); // SAFE: an absent parameter names nothing, and is refused below
    const features: AiJobFeatureKey[] = ['summary', 'pulse', 'gossamer', 'inquiry'];
    const selected = requested.includes('all') ? features : features.filter(feature => requested.includes(feature));
    const unknown = requested.filter(part => part !== 'all' && !features.includes(part as AiJobFeatureKey));
    if (unknown.length) return { problem: `unknown prepare value "${unknown.join(', ')}"` };
    if (selected.length === 0) return { problem: 'prepare names no feature (summary, pulse, gossamer, inquiry or all)' };

    const scope = (params.scope ?? 'missing').trim().toLowerCase(); // SAFE: the request link documents missing as the default scope
    if (scope !== 'flagged' && scope !== 'missing' && scope !== 'all') return { problem: `unknown scope "${scope}"` };

    const signalParts = (params.signals ?? '').split(',').map(part => part.trim().toLowerCase()).filter(Boolean); // SAFE: an absent parameter means every signal (below)
    const unknownSignals = signalParts.filter(part => !GOSSAMER_SIGNAL_TYPES.includes(part as GossamerSignalType));
    if (unknownSignals.length) return { problem: `unknown signals "${unknownSignals.join(', ')}"` };
    const signals = signalParts.length
        ? GOSSAMER_SIGNAL_TYPES.filter(signal => signalParts.includes(signal))
        : [...GOSSAMER_SIGNAL_TYPES];

    const plan: AiJobPlan = {};
    if (selected.includes('summary')) plan.summary = scope;
    if (selected.includes('pulse')) plan.pulse = scope;
    if (selected.includes('gossamer')) plan.gossamer = signals;
    // Inquiry has no flag: "flagged" asks for the questions still to answer.
    if (selected.includes('inquiry')) plan.inquiry = scope === 'all' ? 'all' : 'missing';
    const book = params.book?.trim();
    return book ? { plan, book } : { plan };
}

/** One feature's preparation as an outcome; its error becomes the reason it was blocked. */
async function attemptPrepare(feature: AiJobFeatureKey, write: () => Promise<number | 'waiting'>): Promise<AiJobPrepareOutcome> {
    try {
        const written = await write();
        return written === 'waiting' ? { feature, kind: 'waiting' } : { feature, kind: 'written', count: written };
    } catch (error) {
        return { feature, kind: 'blocked', reason: error instanceof Error ? error.message : String(error) };
    }
}

export class AiJobsService {
    constructor(private readonly plugin: RadialTimelinePlugin) {}

    /** Commands, the request link, and answer handling. Beta: called only when beta commands are visible. */
    register(): void {
        const { plugin } = this;
        registerAiJobs(plugin, [
            createSummaryRefreshJobHandler(plugin),
            createPulseJobHandler(plugin),
            createGossamerJobHandler(plugin),
            createInquiryJobHandler(plugin)
        ], () => this.writeWaitingJobs());

        plugin.addCommand({
            id: 'prepare-ai-jobs',
            name: t('aiJobs.commands.prepare'),
            checkCallback: (checking) => {
                if (!plugin.settings.enableAiSceneAnalysis) return false;
                if (!checking) {
                    new PrepareAiJobsModal(plugin.app, plugin.getActiveBookTitle(), plan => { void this.prepareAndReport(plan); }).open();
                }
                return true;
            }
        });

        plugin.registerObsidianProtocolHandler(AI_JOBS_PROTOCOL_ACTION, (params: ObsidianProtocolData) => {
            void this.handleRequest(params);
        });
    }

    /**
     * Write the jobs a plan asks for, for the active book. One feature that
     * cannot be prepared (no beats for Gossamer, say) does not stop the others.
     */
    async prepare(plan: AiJobPlan): Promise<AiJobPrepareOutcome[]> {
        const { plugin } = this;
        const { summary, pulse, gossamer, inquiry } = plan;
        const outcomes: AiJobPrepareOutcome[] = [];
        if (summary) outcomes.push(await attemptPrepare('summary', () => prepareSummaryRefreshJobs(plugin, summary)));
        if (pulse) outcomes.push(await attemptPrepare('pulse', () => preparePulseJobs(plugin, pulse)));
        if (gossamer?.length) outcomes.push(await attemptPrepare('gossamer', () => prepareGossamerJobs(plugin, gossamer)));
        if (inquiry) {
            outcomes.push(await attemptPrepare('inquiry', async () => (
                await this.waitForSummaries(inquiry) ? 'waiting' : prepareInquiryJobs(plugin, inquiry)
            )));
        }
        return outcomes;
    }

    /** When the active book has Summary jobs pending, record its Inquiry jobs as waiting on them. */
    private async waitForSummaries(scope: InquiryJobScope): Promise<boolean> {
        const { plugin } = this;
        const book = getActiveBook(plugin.settings);
        if (!book || !(await hasPendingSummaryJobs(plugin, book))) return false;
        const waiting = (await readWaiting(plugin)).filter(entry => entry.bookId !== book.id);
        waiting.push({
            bookId: book.id,
            scope,
            waitingFor: `The Summary jobs for "${book.title}" to be answered and applied while it is the active book.`
        });
        await writeWaiting(plugin, waiting);
        return true;
    }

    /** Write the Inquiry jobs whose Summary jobs have all been applied. Runs after every apply pass. */
    private async writeWaitingJobs(): Promise<void> {
        const { plugin } = this;
        let waiting: WaitingInquiry[];
        try {
            waiting = await readWaiting(plugin);
        } catch (error) {
            new Notice(t('aiJobs.notices.waitingUnreadable', { detail: error instanceof Error ? error.message : String(error) }), 10000);
            return;
        }
        if (waiting.length === 0) return;
        const active = getActiveBook(plugin.settings);
        const remaining: WaitingInquiry[] = [];
        for (const entry of waiting) {
            const book = plugin.settings.books.find(candidate => candidate.id === entry.bookId);
            if (!book) continue; // the book was removed; nothing to prepare
            if (active?.id !== book.id || await hasPendingSummaryJobs(plugin, book)) {
                remaining.push(entry);
                continue;
            }
            try {
                const count = await prepareInquiryJobs(plugin, entry.scope);
                new Notice(t('aiJobs.notices.waitingWritten', { count, book: book.title, folder: AI_JOBS_DIR }), 10000);
            } catch (error) {
                // Dropped rather than retried on every pass: the author sees why and can prepare again.
                const reason = error instanceof Error ? error.message : String(error);
                new Notice(t('aiJobs.notices.waitingBlocked', { book: book.title, reason }), 10000);
            }
        }
        await writeWaiting(plugin, remaining);
    }

    private async prepareAndReport(plan: AiJobPlan): Promise<void> {
        const outcomes = await this.prepare(plan);
        if (outcomes.length === 0) {
            new Notice(t('aiJobs.notices.nothingSelected'));
            return;
        }
        const labels: Record<AiJobFeatureKey, string> = {
            summary: t('aiJobs.features.summary'),
            pulse: t('aiJobs.features.pulse'),
            gossamer: t('aiJobs.features.gossamer'),
            inquiry: t('aiJobs.features.inquiry')
        };
        const lines = outcomes.map(outcome => {
            const feature = labels[outcome.feature];
            if (outcome.kind === 'written') return t('aiJobs.notices.featureWritten', { feature, count: outcome.count });
            if (outcome.kind === 'waiting') return t('aiJobs.notices.featureWaiting', { feature });
            return t('aiJobs.notices.featureBlocked', { feature, reason: outcome.reason });
        });
        new Notice(t('aiJobs.notices.prepared', { book: this.plugin.getActiveBookTitle(), lines: lines.join('\n'), folder: AI_JOBS_DIR }), 15000);
    }

    private async handleRequest(params: ObsidianProtocolData): Promise<void> {
        const { plugin } = this;
        if (!plugin.settings.enableAiSceneAnalysis) {
            new Notice(t('aiJobs.notices.requestRejected', { problem: t('aiJobs.notices.aiDisabled') }));
            return;
        }
        const request = parseAiJobRequest(params);
        if ('problem' in request) {
            new Notice(t('aiJobs.notices.requestRejected', { problem: request.problem }), 10000);
            return;
        }
        if (request.book) {
            const wanted = request.book.toLowerCase();
            const book = plugin.settings.books.find(candidate =>
                candidate.id === request.book
                || candidate.title.trim().toLowerCase() === wanted
                || normalizePath(candidate.sourceFolder.trim()).toLowerCase() === normalizePath(wanted)
            );
            if (!book) {
                new Notice(t('aiJobs.notices.requestRejected', { problem: t('aiJobs.notices.unknownBook', { book: request.book }) }), 10000);
                return;
            }
            await plugin.setActiveBookId(book.id);
        }
        await this.prepareAndReport(request.plan);
    }
}
