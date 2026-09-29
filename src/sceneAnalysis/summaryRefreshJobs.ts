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

import { TFile } from 'obsidian';
import type RadialTimelinePlugin from '../main';
import { fnv1a32Hex } from '../utils/hash';
import { getSynopsisGenerationWordLimit } from '../utils/synopsisLimits';
import {
    buildAiJob,
    ensureAiJobMailbox,
    writeAiJob,
    type AiJob,
    type AiJobScope,
    type PreparedAiJob
} from '../ai/jobs/aiJobStore';
import type { AiJobHandler } from '../ai/jobs/aiJobIngest';
import { compareScenesByOrder, getAllSceneData } from './data';
import { classifySynopsis } from './synopsisQuality';
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

export function buildSummaryJob(plugin: RadialTimelinePlugin, scene: SceneData): PreparedAiJob {
    return buildAiJob(plugin, buildSummaryRunRequest(scene, resolveSummaryTargetWords(plugin.settings)), {
        id: jobId('summary', scene.file.path),
        target: { path: scene.file.path, label: scene.file.basename }
    });
}

export function buildSynopsisJob(plugin: RadialTimelinePlugin, scene: SceneData, summaryText: string): PreparedAiJob {
    const request = buildSynopsisRunRequest(scene, summaryText, getSynopsisGenerationWordLimit(plugin.settings));
    return buildAiJob(plugin, request, {
        id: jobId('synopsis', scene.file.path),
        target: { path: scene.file.path, label: scene.file.basename }
    });
}

function assertKnownTask(job: AiJob): typeof SUMMARY_TASK | typeof SYNOPSIS_TASK {
    if (job.task === SUMMARY_TASK || job.task === SYNOPSIS_TASK) return job.task;
    throw new Error(`Unknown Summary refresh job task "${job.task}"`);
}

export function createSummaryRefreshJobHandler(plugin: RadialTimelinePlugin): AiJobHandler {
    return {
        feature: 'SummaryRefresh',

        async rebuild(job) {
            const task = assertKnownTask(job);
            const scene = await loadScene(plugin, job.target.path);
            if (!scene) return null;

            if (task === SUMMARY_TASK) {
                return {
                    prepared: buildSummaryJob(plugin, scene),
                    apply: async (answer, attribution) => {
                        const parsed = parseSummaryReply(answer);
                        if (!parsed.ok) return { ok: false, problems: [parsed.problem] };
                        await persistSummaryForScene(plugin, scene.file.path, { summary: parsed.text }, attribution);
                        if (plugin.settings.alsoUpdateSynopsis) {
                            const updated = await loadScene(plugin, scene.file.path);
                            if (!updated) throw new Error(`Scene ${scene.file.path} could not be read after its Summary was written`);
                            await writeAiJob(plugin.app, buildSynopsisJob(plugin, updated, parsed.text));
                        }
                        return { ok: true };
                    }
                };
            }

            // The Synopsis is written from the scene's Summary; without one there is nothing to write from.
            const summary = currentSummary(scene);
            if (summary === null) return null;
            return {
                prepared: buildSynopsisJob(plugin, scene, summary),
                apply: async (answer, attribution) => {
                    const parsed = parseSynopsisReply(answer, getSynopsisGenerationWordLimit(plugin.settings));
                    if (!parsed.ok) return { ok: false, problems: [parsed.problem] };
                    await persistSummaryForScene(plugin, scene.file.path, { synopsis: parsed.text }, attribution);
                    return { ok: true };
                }
            };
        }
    };
}

function inSummaryScope(plugin: RadialTimelinePlugin, scene: SceneData, scope: AiJobScope): boolean {
    if (scope === 'flagged') return isFlaggedForSummaryRefresh(scene);
    if (scope === 'missing') return classifySynopsis(scene.frontmatter.Summary, plugin.settings.synopsisWeakThreshold ?? 75) === 'missing'; // SAFE: settings saved before the threshold existed; 75 is the shipped default
    return true;
}

/**
 * Write a Summary job for each scene of the active book in scope: flagged with
 * Summary Update: Yes, missing a Summary, or all. Returns how many were written.
 */
export async function prepareSummaryRefreshJobs(plugin: RadialTimelinePlugin, scope: AiJobScope): Promise<number> {
    const bookScope = resolveSummaryRefreshScope(plugin);
    if (bookScope.reason) throw new Error(bookScope.reason);
    const scenes = (await getAllSceneData(plugin, plugin.app.vault, { files: bookScope.files }))
        .filter(scene => inSummaryScope(plugin, scene, scope))
        .sort(compareScenesByOrder);
    if (scenes.length === 0) return 0;

    await ensureAiJobMailbox(plugin.app);
    for (const scene of scenes) {
        await writeAiJob(plugin.app, buildSummaryJob(plugin, scene));
    }
    return scenes.length;
}
