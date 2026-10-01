/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 *
 * Gossamer beat scoring as AI jobs for a client the author runs themselves:
 * one job per signal, for the active book. A job is the API run's own request
 * (buildGossamerRunRequest over the full manuscript, the same beat list and
 * order), its answer is checked by the same validator the API run and Paste
 * AI response use, and the scores are written by the API run's own writer
 * (writeGossamerScores).
 *
 * The prompt carries the whole manuscript, so any scene edit makes a pending
 * job stale and it is rebuilt before an answer is applied.
 */

import type RadialTimelinePlugin from '../main';
import { t } from '../i18n';
import { fnv1a32Hex } from '../utils/hash';
import { getActiveBookExportContext } from '../utils/exportContext';
import { resolveSelectedBeatModelFromSettings } from '../utils/beatSystemState';
import { getSortedSceneFiles } from '../utils/manuscript';
import { AI_JOB_PROVIDER } from '../utils/modelResolver';
import { GOSSAMER_SIGNAL_METADATA, GOSSAMER_SIGNAL_TYPES, type GossamerSignalType } from '../types/gossamerSignals';
import type { TimelineItem } from '../types';
import type { UnifiedBeatInfo } from '../ai/prompts/unifiedBeatAnalysis';
import { buildAiJob, ensureAiJobMailbox, writeAiJob, type AiJob, type PreparedAiJob } from '../ai/jobs/aiJobStore';
import type { AiJobHandler } from '../ai/jobs/aiJobIngest';
import {
    buildGossamerRunRequest,
    loadGossamerBeats,
    parsePastedGossamerResponse,
    resolveGossamerEvidence,
    writeGossamerScores
} from '../GossamerCommands';

interface GossamerSource {
    bookFolder: string;
    bookTitle: string;
    beatSystem: string;
    plotBeats: TimelineItem[];
    beats: UnifiedBeatInfo[];
    manuscriptText: string;
}

function jobId(signal: GossamerSignalType, bookFolder: string): string {
    return `gossamer-${signal}-${fnv1a32Hex(bookFolder)}`;
}

function signalOf(job: AiJob): GossamerSignalType {
    const signal = GOSSAMER_SIGNAL_TYPES.find(candidate => job.id.startsWith(`gossamer-${candidate}-`));
    if (!signal) throw new Error(`Gossamer job "${job.id}" names no known signal`);
    return signal;
}

/** The active book's beats and manuscript, exactly as the API run assembles them. Throws what blocks a run. */
async function loadGossamerSource(plugin: RadialTimelinePlugin): Promise<GossamerSource> {
    const beatSystem = resolveSelectedBeatModelFromSettings(plugin.settings);
    if (!beatSystem) throw new Error(t('gossamer.notices.noActiveBeatSystemRun'));
    const { plotBeats, beats } = await loadGossamerBeats(plugin, beatSystem);
    if (beats.length === 0) throw new Error(t('gossamer.notices.noStoryBeats'));
    const { files } = await getSortedSceneFiles(plugin);
    if (files.length === 0) throw new Error(t('gossamer.notices.noScenesInBook'));
    const { evidenceDocument } = await resolveGossamerEvidence({ plugin, sceneFiles: files });
    if (!evidenceDocument.text.trim() || evidenceDocument.includedScenes === 0) {
        throw new Error(t('gossamer.notices.noSceneBodyContent'));
    }
    const book = getActiveBookExportContext(plugin);
    return {
        bookFolder: book.sourceFolder,
        bookTitle: book.title,
        beatSystem,
        plotBeats,
        beats,
        manuscriptText: evidenceDocument.text
    };
}

function buildGossamerJob(plugin: RadialTimelinePlugin, source: GossamerSource, signal: GossamerSignalType): PreparedAiJob {
    const request = buildGossamerRunRequest(plugin, {
        beats: source.beats,
        beatSystem: source.beatSystem,
        signal,
        manuscriptText: source.manuscriptText
    });
    return buildAiJob(plugin, request, {
        id: jobId(signal, source.bookFolder),
        target: { path: source.bookFolder, label: `${source.bookTitle} · Gossamer ${GOSSAMER_SIGNAL_METADATA[signal].label}` }
    });
}

export function createGossamerJobHandler(plugin: RadialTimelinePlugin): AiJobHandler {
    return {
        feature: 'Gossamer',

        async rebuild(job) {
            const signal = signalOf(job);
            const activeFolder = getActiveBookExportContext(plugin).sourceFolder;
            if (activeFolder !== job.target.path) {
                // Not an error in the answer, and not a reason to discard it:
                // the scores belong to another book. Left in place until that
                // book is active again.
                throw new Error(`This Gossamer job is for the book in "${job.target.path}". Make that the active book, then run Check for AI job results.`);
            }
            const source = await loadGossamerSource(plugin);
            return {
                prepared: buildGossamerJob(plugin, source, signal),
                apply: async (answer, attribution) => {
                    const validation = parsePastedGossamerResponse(answer, source.beats, signal);
                    if (!validation.ok) return { ok: false, problems: validation.failures.map(failure => failure.detail) };
                    await writeGossamerScores(plugin, {
                        plotBeats: source.plotBeats,
                        scores: validation.beats,
                        signal,
                        provider: AI_JOB_PROVIDER,
                        model: attribution,
                        attribution
                    });
                    return { ok: true };
                }
            };
        }
    };
}

/** Write one Gossamer job per signal for the active book. Throws what blocks a run. Returns how many were written. */
export async function prepareGossamerJobs(plugin: RadialTimelinePlugin, signals: readonly GossamerSignalType[]): Promise<number> {
    if (signals.length === 0) return 0;
    const source = await loadGossamerSource(plugin);
    await ensureAiJobMailbox(plugin.app);
    for (const signal of signals) {
        await writeAiJob(plugin.app, buildGossamerJob(plugin, source, signal));
    }
    return signals.length;
}
