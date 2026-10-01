/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 *
 * Inquiry questions as AI jobs for an AI client the author runs themselves:
 * one job per enabled question over the Inquiry view's scope, book and target
 * scenes. A job is the provider call's own one-pass request with the evidence
 * inline (the runner's buildClientRun); its answer is read by the runner's own
 * checks and saved as an Omnibus pass saves each question (session, log and
 * brief), so it shows in Inquiry as an API run's briefing does.
 *
 * Inquiry's multi-pass mode is not offered: a client answers the whole corpus
 * in one pass or not at all.
 *
 * The prompt carries the whole corpus, so an edit to any scene in it makes a
 * pending job stale and it is rebuilt before an answer is applied.
 */

import type RadialTimelinePlugin from '../main';
import { fnv1a32Hex } from '../utils/hash';
import { buildAiJob, ensureAiJobMailbox, writeAiJob, type AiJob, type PreparedAiJob } from '../ai/jobs/aiJobStore';
import type { AiJobHandler } from '../ai/jobs/aiJobIngest';
import type { InquiryJobBatch, InquiryJobRun, InquiryQuestion } from './types/inquiryViewTypes';

const JOB_ID_PATTERN = /^inquiry-([0-9a-f]{8})-([0-9a-f]{8})$/;

/** The scope, book and target-scene selection a batch was built for. */
function contextHash(batch: InquiryJobBatch): string {
    return fnv1a32Hex(`${batch.scope}|${batch.scopeKey}|${batch.targetSceneIds.join(',')}`);
}

function questionHash(question: InquiryQuestion): string {
    return fnv1a32Hex(question.id);
}

function buildInquiryJob(plugin: RadialTimelinePlugin, batch: InquiryJobBatch, jobRun: InquiryJobRun): PreparedAiJob {
    const scope = batch.scope === 'saga' ? 'Saga' : `Book ${batch.scopeLabel}`;
    const targets = batch.targetSceneIds.length ? ` · ${batch.targetSceneIds.length} target scenes` : '';
    return buildAiJob(plugin, jobRun.run.request, {
        id: `inquiry-${contextHash(batch)}-${questionHash(jobRun.question)}`,
        target: { path: batch.scopeKey, label: `Inquiry · ${scope}${targets} · ${jobRun.question.label}` }
    });
}

export function createInquiryJobHandler(plugin: RadialTimelinePlugin): AiJobHandler {
    return {
        feature: 'InquiryMode',

        async rebuild(job: AiJob) {
            const match = JOB_ID_PATTERN.exec(job.id);
            if (!match) throw new Error(`"${job.id}" is not an Inquiry job id`);
            const [, jobContext, jobQuestion] = match;

            const view = await plugin.getInquiryService().getViewForAiJobs();
            const batch = await view.buildAiJobBatch({ selectQuestion: question => questionHash(question) === jobQuestion });
            if (contextHash(batch) !== jobContext) {
                // Not an error in the answer, and not a reason to discard it:
                // Inquiry is on another book, scope or target selection now.
                throw new Error(`This job is for ${job.target.label}. Switch Inquiry back to that scope and target selection, then run Check for AI job results.`);
            }
            const [jobRun] = batch.runs;
            if (!jobRun) return null; // the question was removed or turned off
            return {
                prepared: buildInquiryJob(plugin, batch, jobRun),
                apply: (answer, attribution) => view.saveAiJobAnswer(jobRun, answer, attribution, new Date(job.createdAt))
            };
        }
    };
}

/**
 * Write an Inquiry job for each enabled question over the Inquiry view's
 * current scope, book and target scenes: all of them, or only those without a
 * briefing on the corpus as it is now. Opens Inquiry in a background tab when
 * it is closed. Throws what blocks a run. Returns how many were written.
 */
export async function prepareInquiryJobs(plugin: RadialTimelinePlugin, scope: 'missing' | 'all'): Promise<number> {
    const view = await plugin.getInquiryService().getViewForAiJobs();
    const batch = await view.buildAiJobBatch({ unansweredOnly: scope === 'missing' });
    if (batch.runs.length === 0) return 0;
    await ensureAiJobMailbox(plugin.app);
    for (const jobRun of batch.runs) {
        await writeAiJob(plugin.app, buildInquiryJob(plugin, batch, jobRun));
    }
    return batch.runs.length;
}
