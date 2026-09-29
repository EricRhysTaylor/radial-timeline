/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 *
 * Summary refresh as AI jobs for a client the author runs themselves. Jobs are
 * built from the same requests the API run sends, and answers are read and
 * written by the same parsers and scene writer (summaryRefresh.ts).
 *
 * As in the API run, the Synopsis is written from the new Summary, so the
 * Synopsis job is created when a Summary answer is applied (when "also update
 * Synopsis" is on), not up front.
 */

import { Notice, TFile } from 'obsidian';
import type RadialTimelinePlugin from '../main';
import { t } from '../i18n';
import { fnv1a32Hex } from '../utils/hash';
import { getSynopsisGenerationWordLimit } from '../utils/synopsisLimits';
import { AI_JOBS_DIR, buildAiJob, ensureAiJobMailbox, writeAiJob, type AiJob } from '../ai/jobs/aiJobStore';
import type { AiJobHandler } from '../ai/jobs/aiJobIngest';
import { compareScenesByOrder, getAllSceneData } from './data';
import {
    buildSummaryRunRequest,
    buildSynopsisRunRequest,
    isFlaggedForSummaryRefresh,
    parseSummaryReply,
    parseSynopsisReply,
    persistSummaryForScene,
    resolveSummaryRefreshScope,
    resolveSummaryTargetWords
} from './summaryRefresh';
import type { SceneData } from './types';

const SUMMARY_TASK = 'SceneSummary';
const SYNOPSIS_TASK = 'SceneSynopsis';

function jobId(kind: 'summary' | 'synopsis', scenePath: string): string {
    return `${kind}-${fnv1a32Hex(scenePath)}`;
}

async function loadScene(plugin: RadialTimelinePlugin, path: string): Promise<SceneData | null> {
    const file = plugin.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) return null;
    const [scene] = await getAllSceneData(plugin, plugin.app.vault, { files: [file] });
    return scene ?? null; // SAFE: a file that is no longer a scene note has no job target
}

function currentSummary(scene: SceneData): string | null {
    const value = scene.frontmatter.Summary;
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

export function buildSummaryJob(plugin: RadialTimelinePlugin, scene: SceneData): AiJob {
    return buildAiJob(plugin, buildSummaryRunRequest(scene, resolveSummaryTargetWords(plugin.settings)), {
        id: jobId('summary', scene.file.path),
        target: { path: scene.file.path, label: scene.file.basename },
        sourceFingerprint: fnv1a32Hex(scene.body)
    });
}

export function buildSynopsisJob(plugin: RadialTimelinePlugin, scene: SceneData, summaryText: string): AiJob {
    const request = buildSynopsisRunRequest(scene, summaryText, getSynopsisGenerationWordLimit(plugin.settings));
    return buildAiJob(plugin, request, {
        id: jobId('synopsis', scene.file.path),
        target: { path: scene.file.path, label: scene.file.basename },
        sourceFingerprint: fnv1a32Hex(summaryText)
    });
}

function assertKnownTask(job: AiJob): typeof SUMMARY_TASK | typeof SYNOPSIS_TASK {
    if (job.task === SUMMARY_TASK || job.task === SYNOPSIS_TASK) return job.task;
    throw new Error(`Unknown Summary refresh job task "${job.task}"`);
}

export function createSummaryRefreshJobHandler(plugin: RadialTimelinePlugin): AiJobHandler {
    return {
        feature: 'SummaryRefresh',

        async currentFingerprint(job) {
            const task = assertKnownTask(job);
            const scene = await loadScene(plugin, job.target.path);
            if (!scene) return null;
            if (task === SUMMARY_TASK) return fnv1a32Hex(scene.body);
            const summary = currentSummary(scene);
            return summary === null ? null : fnv1a32Hex(summary);
        },

        async rebuild(job) {
            const task = assertKnownTask(job);
            const scene = await loadScene(plugin, job.target.path);
            if (!scene) throw new Error(`Scene ${job.target.path} is no longer available`);
            if (task === SUMMARY_TASK) return buildSummaryJob(plugin, scene);
            const summary = currentSummary(scene);
            if (summary === null) throw new Error(`Scene ${job.target.path} no longer has a Summary`);
            return buildSynopsisJob(plugin, scene, summary);
        },

        async apply(job, answer, attribution) {
            const task = assertKnownTask(job);
            if (task === SYNOPSIS_TASK) {
                const parsed = parseSynopsisReply(answer, getSynopsisGenerationWordLimit(plugin.settings));
                if (!parsed.ok) return { ok: false, problems: [parsed.problem] };
                await persistSummaryForScene(plugin, job.target.path, { synopsis: parsed.text }, attribution);
                return { ok: true };
            }

            const parsed = parseSummaryReply(answer);
            if (!parsed.ok) return { ok: false, problems: [parsed.problem] };
            await persistSummaryForScene(plugin, job.target.path, { summary: parsed.text }, attribution);
            if (plugin.settings.alsoUpdateSynopsis) {
                const scene = await loadScene(plugin, job.target.path);
                if (!scene) throw new Error(`Scene ${job.target.path} could not be read after its Summary was written`);
                await writeAiJob(plugin.app, buildSynopsisJob(plugin, scene, parsed.text));
            }
            return { ok: true };
        }
    };
}

/** Write a Summary job for every scene in the active book flagged with Summary Update: Yes. */
export async function prepareSummaryRefreshJobs(plugin: RadialTimelinePlugin): Promise<void> {
    const scope = resolveSummaryRefreshScope(plugin);
    if (scope.reason) {
        new Notice(scope.reason);
        return;
    }
    const scenes = (await getAllSceneData(plugin, plugin.app.vault, { files: scope.files }))
        .filter(isFlaggedForSummaryRefresh)
        .sort(compareScenesByOrder);
    if (scenes.length === 0) {
        new Notice(t('aiJobs.notices.noFlaggedScenes', { scope: scope.scopeSummary }));
        return;
    }

    await ensureAiJobMailbox(plugin.app);
    for (const scene of scenes) {
        await writeAiJob(plugin.app, buildSummaryJob(plugin, scene));
    }
    new Notice(t('aiJobs.notices.preparedSummary', { count: scenes.length, folder: AI_JOBS_DIR }), 10000);
}
