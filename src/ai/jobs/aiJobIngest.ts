/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 *
 * Applies answers an outside AI client wrote to the AI job mailbox, each
 * through its feature's own checks and writer (an AiJobHandler).
 *
 * Per answer, the job is first rebuilt from the vault as it is now. If the
 * rebuilt prompt differs, the job's source changed since it was written: the
 * rebuilt job replaces it and the answer is discarded, never applied to text
 * it was not written for. Otherwise the answer goes to the feature's own
 * checks: rejected answers are sent back by recording the problems on the
 * job; an accepted answer is applied and the job and answer are deleted.
 */

import { Notice, debounce, type App } from 'obsidian';
import type RadialTimelinePlugin from '../../main';
import { t } from '../../i18n';
import {
    AI_JOBS_DIR,
    isAiJobAnswerPath,
    listAiJobAnswerIds,
    readAiJob,
    readAiJobAnswer,
    readAnswerAttribution,
    recordAiJobRejection,
    removeAiJob,
    removeAiJobAnswer,
    writeAiJob,
    type AiJob,
    type PreparedAiJob
} from './aiJobStore';

export type AiJobApplyResult = { ok: true } | { ok: false; problems: string[] };

/** A job rebuilt from the vault as it is now, with the step that applies an answer to it. */
export interface RebuiltAiJob {
    prepared: PreparedAiJob;
    /**
     * Check an answer with the feature's own parser and, when it passes, write
     * it with the feature's own writer. `attribution` is the client's name for
     * itself, for the update stamp.
     */
    apply(answer: string, attribution: string): Promise<AiJobApplyResult>;
}

export interface AiJobHandler {
    /** Matches AiJob.feature. */
    feature: string;
    /** The same job (same id) built from the vault as it is now; null when its target no longer exists. */
    rebuild(job: AiJob): Promise<RebuiltAiJob | null>;
}

export type AiJobIngestOutcome =
    | { id: string; kind: 'applied' }
    | { id: string; kind: 'rejected'; problems: string[] }
    | { id: string; kind: 'rebuilt' }
    | { id: string; kind: 'target-gone' }
    | { id: string; kind: 'unmatched'; reason: string }
    | { id: string; kind: 'failed'; detail: string };

export const STALE_JOB_PROBLEM =
    'What this job is about changed after it was written, so the job was rebuilt from the current text and the earlier answer was discarded. Answer the new prompt.';

async function ingestOne(app: App, id: string, handlers: ReadonlyMap<string, AiJobHandler>): Promise<AiJobIngestOutcome> {
    const read = await readAiJob(app, id);
    if (read.kind === 'missing') return { id, kind: 'unmatched', reason: 'no pending job has this id' };
    if (read.kind === 'invalid') return { id, kind: 'unmatched', reason: read.reason };
    const job = read.job;

    const handler = handlers.get(job.feature);
    if (!handler) return { id, kind: 'unmatched', reason: `no handler for feature "${job.feature}"` };

    const rebuilt = await handler.rebuild(job);
    if (rebuilt === null) {
        await removeAiJob(app, id);
        await removeAiJobAnswer(app, id);
        return { id, kind: 'target-gone' };
    }
    const fresh = rebuilt.prepared.job;
    if (fresh.id !== job.id) {
        throw new Error(`rebuilt job id "${fresh.id}" does not match "${job.id}"`);
    }

    if (fresh.sourceFingerprint !== job.sourceFingerprint) {
        await writeAiJob(app, {
            prompt: rebuilt.prepared.prompt,
            job: { ...fresh, lastRejection: { at: new Date().toISOString(), problems: [STALE_JOB_PROBLEM] } }
        });
        await removeAiJobAnswer(app, id);
        return { id, kind: 'rebuilt' };
    }

    const answer = await readAiJobAnswer(app, id);
    const result = await rebuilt.apply(answer, readAnswerAttribution(answer));
    if (!result.ok) {
        await recordAiJobRejection(app, job, result.problems);
        await removeAiJobAnswer(app, id);
        return { id, kind: 'rejected', problems: result.problems };
    }

    await removeAiJob(app, id);
    await removeAiJobAnswer(app, id);
    return { id, kind: 'applied' };
}

/**
 * Apply every answer waiting in the Answers folder. One answer failing to
 * apply (a write error) is reported as `failed` and leaves its files in place;
 * it does not stop the rest.
 */
export async function ingestAiJobAnswers(app: App, handlers: readonly AiJobHandler[]): Promise<AiJobIngestOutcome[]> {
    const byFeature = new Map(handlers.map(handler => [handler.feature, handler]));
    const outcomes: AiJobIngestOutcome[] = [];
    for (const id of await listAiJobAnswerIds(app)) {
        try {
            outcomes.push(await ingestOne(app, id, byFeature));
        } catch (error) {
            const detail = error instanceof Error ? error.message : String(error);
            console.error(`[AI jobs] Could not apply answer ${id}:`, error);
            outcomes.push({ id, kind: 'failed', detail });
        }
    }
    return outcomes;
}

function reportOutcomes(outcomes: AiJobIngestOutcome[], manual: boolean): void {
    const count = (kind: AiJobIngestOutcome['kind']) => outcomes.filter(outcome => outcome.kind === kind).length;
    const parts: string[] = [];
    if (count('applied') > 0) parts.push(t('aiJobs.notices.appliedCount', { count: count('applied') }));
    if (count('rejected') > 0) parts.push(t('aiJobs.notices.rejectedCount', { count: count('rejected') }));
    if (count('rebuilt') > 0) parts.push(t('aiJobs.notices.rebuiltCount', { count: count('rebuilt') }));
    if (count('target-gone') > 0) parts.push(t('aiJobs.notices.targetGoneCount', { count: count('target-gone') }));
    if (parts.length > 0) {
        new Notice(t('aiJobs.notices.summary', { parts: parts.join(', '), folder: AI_JOBS_DIR }), 8000);
    }

    for (const outcome of outcomes) {
        if (outcome.kind === 'failed') {
            new Notice(t('aiJobs.notices.failed', { id: outcome.id, detail: outcome.detail }), 10000);
        }
    }

    const unmatched = outcomes.filter(
        (outcome): outcome is Extract<AiJobIngestOutcome, { kind: 'unmatched' }> => outcome.kind === 'unmatched'
    );
    if (unmatched.length > 0) {
        // Left in place on purpose: the file may be a correct answer with a
        // mistyped name. Reported on a manual run; logged otherwise so every
        // automatic pass does not repeat the same notice.
        const list = unmatched.map(outcome => `${outcome.id} (${outcome.reason})`).join('; ');
        if (manual) new Notice(t('aiJobs.notices.unmatched', { list }), 10000);
        console.warn(`[AI jobs] Answers with no usable job were left in place: ${list}`);
    }

    if (manual && outcomes.length === 0) {
        new Notice(t('aiJobs.notices.nothingToApply'));
    }
}

/**
 * Wire the mailbox into the plugin: the "Apply AI job answers" command, a pass
 * when the workspace is ready, and a pass shortly after the client writes an
 * answer while Obsidian is open. Passes never overlap. `afterPass` runs at the
 * end of each pass, inside it (it writes the jobs that were waiting on others).
 */
export function registerAiJobs(
    plugin: RadialTimelinePlugin,
    handlers: readonly AiJobHandler[],
    afterPass: () => Promise<void>
): void {
    let running = false;
    let runAgain = false;

    const run = async (manual: boolean): Promise<void> => {
        if (running) {
            runAgain = true;
            return;
        }
        running = true;
        try {
            reportOutcomes(await ingestAiJobAnswers(plugin.app, handlers), manual);
            await afterPass();
        } finally {
            running = false;
            if (runAgain) {
                runAgain = false;
                void run(false);
            }
        }
    };

    // Wait for the client to finish writing before reading the answer.
    const scheduleRun = debounce(() => {
        if (plugin.settings.enableAiSceneAnalysis) void run(false);
    }, 1500, true);

    plugin.addCommand({
        id: 'apply-ai-job-answers',
        name: t('aiJobs.commands.applyAnswers'),
        checkCallback: (checking) => {
            if (!plugin.settings.enableAiSceneAnalysis) return false;
            if (!checking) void run(true);
            return true;
        }
    });

    // Registered after layout-ready: Obsidian fires "create" for every existing
    // file while it indexes the vault at startup.
    plugin.app.workspace.onLayoutReady(() => {
        const onChange = (file: { path: string }) => {
            if (isAiJobAnswerPath(file.path)) scheduleRun();
        };
        plugin.registerEvent(plugin.app.vault.on('create', onChange));
        plugin.registerEvent(plugin.app.vault.on('modify', onChange));
        if (plugin.settings.enableAiSceneAnalysis) void run(false);
    });
}
