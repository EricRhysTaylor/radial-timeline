/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 *
 * Scene pulse (triplet) analysis as AI jobs for a client the author runs
 * themselves. A job is built from the same triplet prompt (buildTripletPrompt)
 * and request (buildPulseRunRequest) the API run sends, in manuscript order,
 * and its answer is checked by the same parser (parsePulseAnalysisResponse)
 * and written by the same writer (updateSceneAnalysis).
 *
 * Because the prompt carries the previous and next scene too, a job goes
 * stale when either neighbor changes, not only the scene itself.
 */

import type RadialTimelinePlugin from '../main';
import { fnv1a32Hex } from '../utils/hash';
import { normalizeBooleanValue } from '../utils/sceneHelpers';
import { buildAiJob, ensureAiJobMailbox, writeAiJob, type AiJobScope, type PreparedAiJob } from '../ai/jobs/aiJobStore';
import type { AiJobHandler } from '../ai/jobs/aiJobIngest';
import { resolveSceneJobTarget, unreadableSceneError } from '../ai/jobs/sceneJobTarget';
import { buildPulseRunRequest } from './aiProvider';
import {
    compareScenesByOrder,
    getAllSceneData,
    getPulseUpdateFlag,
    hasBeenProcessedForBeats,
    hasProcessableContent
} from './data';
import { updateSceneAnalysis } from './FileUpdater';
import { buildTripletPrompt, normalizeParsedAnalysisForTriplet, type SceneTriplet } from './Processor';
import { parsePulseAnalysisResponse } from './responseParsing';
import { buildTripletsByIndex } from './TripletBuilder';
import type { SceneData } from './types';

function jobId(scenePath: string): string {
    return `pulse-${fnv1a32Hex(scenePath)}`;
}

/**
 * The scenes a Pulse run sees, in manuscript order, and the ones with content
 * to analyze. Triplet neighbors come from the latter, as in the API run.
 */
async function loadPulseScenes(plugin: RadialTimelinePlugin): Promise<{ all: SceneData[]; withContent: SceneData[] }> {
    const all = (await getAllSceneData(plugin, plugin.app.vault)).sort(compareScenesByOrder);
    return { all, withContent: all.filter(scene => hasProcessableContent(scene.frontmatter)) };
}

function tripletFor(withContent: SceneData[], scene: SceneData): SceneTriplet {
    const [triplet] = buildTripletsByIndex(withContent, [scene], item => item.file.path);
    return triplet;
}

export function buildPulseJob(plugin: RadialTimelinePlugin, triplet: SceneTriplet): PreparedAiJob {
    return buildAiJob(plugin, buildPulseRunRequest(buildTripletPrompt(plugin, triplet)), {
        id: jobId(triplet.current.file.path),
        target: { path: triplet.current.file.path, label: triplet.current.file.basename }
    });
}

export function createPulseJobHandler(plugin: RadialTimelinePlugin): AiJobHandler {
    return {
        feature: 'PulseAnalysis',

        async rebuild(job) {
            if (!resolveSceneJobTarget(plugin, job.target.path)) return null;
            const { all, withContent } = await loadPulseScenes(plugin);
            const scene = all.find(candidate => candidate.file.path === job.target.path);
            if (!scene) throw unreadableSceneError(job.target.path);
            const triplet = tripletFor(withContent, scene);
            return {
                prepared: buildPulseJob(plugin, triplet),
                apply: async (answer, attribution) => {
                    const parsed = parsePulseAnalysisResponse(answer, plugin);
                    if (!parsed) {
                        return { ok: false, problems: [plugin.lastAnalysisError.trim() || 'The answer did not pass the Pulse checks.'] }; // SAFE: lastAnalysisError is set on every parse failure; the literal covers a parser that returns null without a message
                    }
                    const analysis = normalizeParsedAnalysisForTriplet(parsed, triplet);
                    if (!analysis) throw new Error(`Pulse answer for ${scene.file.path} could not be normalized`);
                    const written = await updateSceneAnalysis(plugin.app.vault, scene.file, analysis, plugin, attribution);
                    if (!written) throw new Error(`Pulse results could not be written to ${scene.file.path}`);
                    return { ok: true };
                }
            };
        }
    };
}

function inPulseScope(scene: SceneData, scope: AiJobScope): boolean {
    if (scope === 'flagged') return normalizeBooleanValue(getPulseUpdateFlag(scene.frontmatter));
    if (!hasProcessableContent(scene.frontmatter)) return false;
    return scope === 'all' || !hasBeenProcessedForBeats(scene.frontmatter);
}

/**
 * Write a Pulse job for each scene in scope, in manuscript order: flagged with
 * Pulse Update: Yes, not yet analyzed, or all scenes with content — the API
 * run's "flagged", "unprocessed" and "force all" selections. Returns how many
 * were written.
 */
export async function preparePulseJobs(plugin: RadialTimelinePlugin, scope: AiJobScope): Promise<number> {
    const { all, withContent } = await loadPulseScenes(plugin);
    const targets = all.filter(scene => inPulseScope(scene, scope));
    if (targets.length === 0) return 0;

    await ensureAiJobMailbox(plugin.app);
    for (const scene of targets) {
        await writeAiJob(plugin.app, buildPulseJob(plugin, tripletFor(withContent, scene)));
    }
    return targets.length;
}
