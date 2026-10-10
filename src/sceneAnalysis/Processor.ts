/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 */

import type { Vault } from 'obsidian';
import type RadialTimelinePlugin from '../main';
import { buildDefaultAiSettings } from '../ai/settings/aiSettings';
import { getCanonicalAiSettings, resolveConfiguredSelection } from '../ai/runtime/runtimeSelection';
import { validateAiSettings } from '../ai/settings/validateAiSettings';
import type { SceneAnalysisProcessingModal, ProcessingMode, SceneQueueItem } from '../modals/SceneAnalysisProcessingModal';
import { buildTripletsByIndex } from './TripletBuilder';
import { setSceneAnalysisReviewWarning, updateSceneAnalysis } from './FileUpdater';
import { createAiRunner, type Provider } from './RequestRunner';
import {
    getAllSceneData,
    assertSceneSourcesUnchanged,
    sceneSourceRevision,
    compareScenesByOrder,
    getSubplotNamesFromFM,
    hasBeenProcessedForBeats,
    hasProcessableContent,
    getPulseUpdateFlag
} from './data';
import { normalizeBooleanValue } from '../utils/sceneHelpers';
import { buildSceneAnalysisPrompt } from '../ai/prompts/sceneAnalysis';
import { callAiProvider } from './aiProvider';
import type { ParsedSceneAnalysis, SceneData } from './types';
import { parseSceneTitle, decodeHtmlEntities } from '../utils/text';
import { parseRuntimeField } from '../utils/runtimeEstimator';
import { buildPulseTriplet } from '../ai/evidence/pulseTriplet';
import { readSceneId, resolveSceneReferenceId } from '../utils/sceneIds';
import { applySceneAnalysisSafeWrite, LOCAL_LLM_REVIEW_WARNING } from './safeWritePolicy';
import { t } from '../i18n';

function isLocalLlmPulseProvider(plugin: RadialTimelinePlugin): boolean {
    const aiSettings = getCanonicalAiSettings(plugin);
    return resolveConfiguredSelection(aiSettings, { feature: 'PulseAnalysis' })?.provider === 'ollama';
}

export interface TripletMetric {
    value: number;
    source: 'runtime' | 'words' | 'default';
}

export interface SceneTriplet {
    prev: SceneData | null;
    current: SceneData;
    next: SceneData | null;
}

function buildTripletSceneRefs(triplet: SceneTriplet): {
    prevRefId?: string;
    currentRefId: string;
    nextRefId?: string;
} {
    const currentRefId = resolveSceneReferenceId(readSceneId(triplet.current.frontmatter), triplet.current.file.path);
    const prevRefId = triplet.prev
        ? resolveSceneReferenceId(readSceneId(triplet.prev.frontmatter), triplet.prev.file.path)
        : undefined;
    const nextRefId = triplet.next
        ? resolveSceneReferenceId(readSceneId(triplet.next.frontmatter), triplet.next.file.path)
        : undefined;
    return { prevRefId, currentRefId, nextRefId };
}

/** Scene numbers of a triplet as the Pulse prompt and progress UI show them. */
function tripletSceneNumbers(triplet: SceneTriplet): { prevNum: string; currentNum: string; nextNum: string } {
    return {
        prevNum: triplet.prev ? String(triplet.prev.sceneNumber ?? 'N/A') : 'N/A', // SAFE: sceneNumber is null for unnumbered scene files — 'N/A' is a display placeholder
        currentNum: String(triplet.current.sceneNumber ?? 'N/A'), // SAFE: sceneNumber is null for unnumbered scene files — 'N/A' is a display placeholder
        nextNum: triplet.next ? String(triplet.next.sceneNumber ?? 'N/A') : 'N/A' // SAFE: sceneNumber is null for unnumbered scene files — 'N/A' is a display placeholder
    };
}

/**
 * The Pulse prompt for one triplet: the one place it is built, for every API
 * run order (manuscript, subplot, entire subplot) and for AI jobs.
 */
export function buildTripletPrompt(plugin: RadialTimelinePlugin, triplet: SceneTriplet): string {
    const { prevNum, currentNum, nextNum } = tripletSceneNumbers(triplet);
    return buildSceneAnalysisPrompt(
        triplet.prev ? triplet.prev.body : null,
        triplet.current.body,
        triplet.next ? triplet.next.body : null,
        prevNum,
        currentNum,
        nextNum,
        getActiveContextPrompt(plugin),
        buildTripletSceneRefs(triplet)
    );
}

/**
 * Extract a timing metric from a triplet of scenes for progress bar animation.
 * Priority: Runtime (preferred) > Words (fallback) > Default (fast baseline)
 */
export function getTripletMetric(triplet: SceneTriplet): TripletMetric {
    const scenes = [triplet.prev, triplet.current, triplet.next].filter((s): s is SceneData => s !== null);

    // Try runtime first (preferred) - sum of all scene runtimes in seconds
    const runtimes = scenes.map(s => {
        const runtime = s.frontmatter?.Runtime;
        return parseRuntimeField(runtime as string | number | undefined);
    });
    const validRuntimes = runtimes.filter((r): r is number => r !== null && r > 0);
    if (validRuntimes.length === scenes.length) {
        return { value: validRuntimes.reduce((a, b) => a + b, 0), source: 'runtime' };
    }

    // Try word count fallback - convert words to pseudo-runtime (~150 wpm = 0.4s per word)
    const words = scenes.map(s => {
        const w = s.frontmatter?.Words;
        return typeof w === 'number' ? w : (typeof w === 'string' ? parseInt(w, 10) : 0);
    }).filter(w => !isNaN(w) && w > 0);
    if (words.length > 0) {
        return { value: words.reduce((a, b) => a + b, 0) * 0.4, source: 'words' };
    }

    // Default: 5 seconds per scene in triplet (fast baseline, better to finish early)
    return { value: scenes.length * 5, source: 'default' };
}

function buildQueueItem(scene: SceneData): SceneQueueItem {
    const rawTitle = typeof scene.frontmatter?.Title === 'string'
        ? scene.frontmatter.Title
        : scene.file.basename.replace(/\.md$/i, '');
    const parsed = parseSceneTitle(rawTitle, scene.sceneNumber ?? undefined);
    const label = parsed.number || (scene.sceneNumber != null ? String(scene.sceneNumber) : '') || rawTitle;
    const detail = decodeHtmlEntities(parsed.text || rawTitle);
    return {
        id: scene.file.path,
        label,
        detail
    };
}

async function setLocalReviewWarningIfNeeded(
    plugin: RadialTimelinePlugin,
    vault: Vault,
    scene: SceneData,
    error?: unknown
): Promise<void> {
    if (!isLocalLlmPulseProvider(plugin)) return;
    if (error && !isReviewableLocalOutputError(error)) return;
    await setSceneAnalysisReviewWarning(vault, scene.file, plugin, LOCAL_LLM_REVIEW_WARNING);
}

function isReviewableLocalOutputError(error: unknown): boolean {
    const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
    return [
        'json',
        'parse',
        'schema',
        'validation',
        'invalid response',
        'malformed',
        'format',
        'repair'
    ].some(token => message.includes(token));
}

export function normalizeParsedAnalysisForTriplet(
    parsedAnalysis: ParsedSceneAnalysis | null | undefined,
    triplet: SceneTriplet
): ParsedSceneAnalysis | null {
    if (!parsedAnalysis) return null;
    const normalized: ParsedSceneAnalysis = { ...parsedAnalysis };
    if (!triplet.prev) normalized.previousSceneAnalysis = '';
    if (!triplet.next) normalized.nextSceneAnalysis = '';
    return normalized;
}

async function applyTripletAnalysisResult(input: {
    plugin: RadialTimelinePlugin;
    vault: Vault;
    triplet: SceneTriplet;
    parsedAnalysis: ParsedSceneAnalysis | null;
    provider: Provider | null | undefined;
    attribution: string | null;
}): Promise<{ route: 'write' | 'warning' | 'skip'; success: boolean }> {
    const assertSourcesCurrent = await assertSceneSourcesUnchanged(input.vault, [input.triplet.prev, input.triplet.current, input.triplet.next].filter((scene): scene is SceneData => !!scene));
    const result = await applySceneAnalysisSafeWrite({
        provider: input.provider,
        parsedAnalysis: input.parsedAnalysis,
        writeAnalysis: (analysis) =>
            updateSceneAnalysis(input.vault, input.triplet.current.file, analysis, input.plugin, input.attribution, assertSourcesCurrent),
        writeWarning: (warning) =>
            setSceneAnalysisReviewWarning(input.vault, input.triplet.current.file, input.plugin, warning)
    });
    if (result.success) {
        // Later triplets share this scene as a neighbor; our own analysis write
        // is an accepted new revision, not an author edit invalidating the batch.
        input.triplet.current.sourceRevision = sceneSourceRevision(await input.vault.read(input.triplet.current.file));
    }
    return result;
}

function getLocalReviewErrorMessage(scene: SceneData): string {
    return t('sceneAnalysis.pipeline.errors.localLlmReview', { num: scene.sceneNumber ?? 'N/A', path: scene.file.path }); // SAFE: sceneNumber is null for unnumbered scene files — 'N/A' is a display placeholder
}

export async function processWithModal(
    plugin: RadialTimelinePlugin,
    vault: Vault,
    mode: ProcessingMode,
    modal: SceneAnalysisProcessingModal
): Promise<void> {
    const isResuming = plugin.settings._isResuming || false; // SAFE: _isResuming is an optional transient settings flag — absent means a normal (non-resume) run
    if (isResuming) {
        plugin.settings._isResuming = false;
        await plugin.saveSettings();
    }

    const allScenes = await getAllSceneData(plugin, vault);
    allScenes.sort(compareScenesByOrder);
    if (allScenes.length < 1) {
        throw new Error(t('sceneAnalysis.pipeline.notices.noScenesValid'));
    }

    const processableScenes = allScenes.filter(scene => {
        if (mode === 'flagged') {
            const pulseUpdateFlag = getPulseUpdateFlag(scene.frontmatter);
            return normalizeBooleanValue(pulseUpdateFlag);
        }
        if (mode === 'open') {
            return plugin.openScenePaths.has(scene.file.path) && hasProcessableContent(scene.frontmatter);
        }
        return hasProcessableContent(scene.frontmatter);
    });

    const processableContentScenes = allScenes.filter(scene => hasProcessableContent(scene.frontmatter));
    const triplets = buildTripletsByIndex(processableContentScenes, processableScenes, (s) => s.file.path);

    const tasks = triplets.map(triplet => {
        const pulseUpdateFlag = getPulseUpdateFlag(triplet.current.frontmatter);
        const isFlagged = normalizeBooleanValue(pulseUpdateFlag);
        let shouldProcess = false;

        if (mode === 'flagged') {
            shouldProcess = isFlagged;
        } else if (mode === 'open') {
            shouldProcess = plugin.openScenePaths.has(triplet.current.file.path)
                && hasProcessableContent(triplet.current.frontmatter);
        } else if (mode === 'force-all') {
            shouldProcess = isResuming
                ? !hasBeenProcessedForBeats(triplet.current.frontmatter, { todayOnly: true })
                : true;
        } else if (mode === 'unprocessed') {
            shouldProcess = isResuming
                ? !hasBeenProcessedForBeats(triplet.current.frontmatter, { todayOnly: true })
                : !hasBeenProcessedForBeats(triplet.current.frontmatter);
        }

        return { triplet, shouldProcess };
    });

    const queueItems = tasks
        .filter(task => task.shouldProcess)
        .map(task => buildQueueItem(task.triplet.current));
    if (modal && typeof modal.setProcessingQueue === 'function') {
        modal.setProcessingQueue(queueItems);
    }

    const totalToProcess = queueItems.length;
    let processedCount = 0;

    for (const { triplet, shouldProcess } of tasks) {
        if (modal.isAborted()) {
            await plugin.saveSettings();
            throw new Error(t('sceneAnalysis.pipeline.notices.abortedByUser'));
        }

        if (!shouldProcess) continue;

        const { prevNum, currentNum, nextNum } = tripletSceneNumbers(triplet);

        if (modal && typeof modal.setTripletInfo === 'function') {
            modal.setTripletInfo(prevNum, currentNum, nextNum, triplet.current.file.path, triplet.current.file.basename);
        }

        const userPrompt = buildTripletPrompt(plugin, triplet);

        const sceneNameForLog = triplet.current.file.basename;
        const tripletForLog = buildPulseTriplet(prevNum, currentNum, nextNum).scenes;
        const queueId = triplet.current.file.path;
        const markQueueStatus = (status: 'success' | 'error', grade?: 'A' | 'B' | 'C') => {
            if (modal && typeof modal.markQueueStatus === 'function') {
                modal.markQueueStatus(queueId, status, grade);
            }
        };

        const runAi = createAiRunner(plugin, vault, callAiProvider, report => {
            modal.recordPulseUsage(sceneNameForLog, report);
        }, () => modal.isAborted());

        // Calculate triplet metric and start progress bar animation
        const tripletMetric = getTripletMetric(triplet);
        const currentSceneIndex = processedCount;
        if (modal && typeof modal.startSceneAnimation === 'function') {
            modal.startSceneAnimation(tripletMetric.value, currentSceneIndex, totalToProcess, sceneNameForLog);
        }
        const startTime = performance.now();

        try {
            const aiResult = await runAi(userPrompt, null, 'processByManuscriptOrder', sceneNameForLog, {
                prev: tripletForLog.previous,
                current: tripletForLog.current,
                next: tripletForLog.next
            });
            if (modal && typeof modal.setAiAdvancedContext === 'function') {
                modal.setAiAdvancedContext(aiResult.advancedContext ?? null);
            }

            // Record actual processing time for calibration
            const elapsedSeconds = (performance.now() - startTime) / 1000;
            if (modal && typeof modal.recordProcessingTime === 'function') {
                modal.recordProcessingTime(tripletMetric.value, elapsedSeconds);
            }

            if (aiResult.result) {
                const parsedAnalysis = normalizeParsedAnalysisForTriplet(aiResult.parsedAnalysis, triplet);
                const safeWrite = await applyTripletAnalysisResult({
                    plugin,
                    vault,
                    triplet,
                    parsedAnalysis,
                    provider: aiResult.providerUsed,
                    attribution: aiResult.attribution
                });

                if (safeWrite.success) {
                    processedCount++;
                    modal.updateProgress(processedCount, totalToProcess, triplet.current.file.basename);
                    markQueueStatus('success', parsedAnalysis?.sceneGrade);
                    await plugin.saveSettings();
                } else {
                    markQueueStatus('error');
                    if (safeWrite.route === 'warning') {
                        modal.addError(getLocalReviewErrorMessage(triplet.current));
                    } else {
                        modal.addError(t('sceneAnalysis.pipeline.errors.failedUpdate', { num: triplet.current.sceneNumber ?? 'N/A', path: triplet.current.file.path })); // SAFE: sceneNumber is null for unnumbered scene files — 'N/A' is a display placeholder
                    }
                }
            } else {
                markQueueStatus('error');
                modal.addError(t('sceneAnalysis.pipeline.errors.aiProcessingFailed', { num: triplet.current.sceneNumber ?? 'N/A', path: triplet.current.file.path })); // SAFE: sceneNumber is null for unnumbered scene files — 'N/A' is a display placeholder
            }
        } catch (sceneError) {
            await setLocalReviewWarningIfNeeded(plugin, vault, triplet.current, sceneError);
            markQueueStatus('error');
            const detail = sceneError instanceof Error ? sceneError.message : String(sceneError);
            modal.addError(t('sceneAnalysis.pipeline.errors.fatalScene', { num: triplet.current.sceneNumber ?? 'N/A', path: triplet.current.file.path, detail })); // SAFE: sceneNumber is null for unnumbered scene files — 'N/A' is a display placeholder
        } finally {
            modal.noteLogAttempt();
        }
    }

    await plugin.saveSettings();
    plugin.refreshTimelineIfNeeded(null);
}

export async function processSubplotWithModal(
    plugin: RadialTimelinePlugin,
    vault: Vault,
    subplotName: string,
    modal: SceneAnalysisProcessingModal
): Promise<void> {
    const allScenes = await getAllSceneData(plugin, vault);
    if (allScenes.length < 1) {
        throw new Error(t('sceneAnalysis.pipeline.notices.noScenesValid'));
    }

    const filtered = allScenes.filter(scene => getSubplotNamesFromFM(scene.frontmatter).includes(subplotName));
    if (filtered.length === 0) {
        throw new Error(t('sceneAnalysis.pipeline.notices.noScenesForSubplot', { name: subplotName }));
    }

    filtered.sort(compareScenesByOrder);

    const validScenes = filtered.filter(scene => {
        const pulseUpdate = getPulseUpdateFlag(scene.frontmatter);
        return hasProcessableContent(scene.frontmatter) && normalizeBooleanValue(pulseUpdate);
    });

    if (validScenes.length === 0) {
        throw new Error(t('sceneAnalysis.pipeline.notices.noFlaggedSubplotScenes', { name: subplotName }));
    }

    const contextScenes = filtered.filter(scene => hasProcessableContent(scene.frontmatter));
    const triplets = buildTripletsByIndex(contextScenes, validScenes, (s) => s.file.path);
    const isResuming = plugin.settings._isResuming || false; // SAFE: _isResuming is an optional transient settings flag — absent means a normal (non-resume) run
    if (isResuming) {
        plugin.settings._isResuming = false;
        await plugin.saveSettings();
    }

    const subplotTasks = triplets.map(triplet => {
        const alreadyProcessed = hasBeenProcessedForBeats(triplet.current.frontmatter, { todayOnly: true });
        const shouldProcess = isResuming ? !alreadyProcessed : true;
        return { triplet, shouldProcess };
    });
    const queueItems = subplotTasks
        .filter(task => task.shouldProcess)
        .map(task => buildQueueItem(task.triplet.current));
    if (modal && typeof modal.setProcessingQueue === 'function') {
        modal.setProcessingQueue(queueItems);
    }
    const total = queueItems.length;
    let processedCount = 0;

    for (const { triplet, shouldProcess } of subplotTasks) {
        if (modal.isAborted()) {
            await plugin.saveSettings();
            throw new Error(t('sceneAnalysis.pipeline.notices.abortedByUser'));
        }

        if (!shouldProcess) continue;

        const sceneName = triplet.current.file.basename;
        const queueId = triplet.current.file.path;
        const markQueueStatus = (status: 'success' | 'error', grade?: 'A' | 'B' | 'C') => {
            if (modal && typeof modal.markQueueStatus === 'function') {
                modal.markQueueStatus(queueId, status, grade);
            }
        };

        const { prevNum, currentNum, nextNum } = tripletSceneNumbers(triplet);

        if (modal && typeof modal.setTripletInfo === 'function') {
            modal.setTripletInfo(prevNum, currentNum, nextNum, triplet.current.file.path, sceneName);
        }

        const userPrompt = buildTripletPrompt(plugin, triplet);

        const sceneNameForLog = triplet.current.file.basename;
        const tripletForLog = buildPulseTriplet(prevNum, currentNum, nextNum).scenes;
        const runAi = createAiRunner(plugin, vault, callAiProvider, report => {
            modal.recordPulseUsage(sceneNameForLog, report);
        }, () => modal.isAborted());

        // Calculate triplet metric and start progress bar animation
        const tripletMetric = getTripletMetric(triplet);
        const currentSceneIndex = processedCount;
        if (modal && typeof modal.startSceneAnimation === 'function') {
            modal.startSceneAnimation(tripletMetric.value, currentSceneIndex, total, sceneNameForLog);
        }
        const startTime = performance.now();

        try {
            const aiResult = await runAi(userPrompt, subplotName, 'processBySubplotOrder', sceneNameForLog, {
                prev: tripletForLog.previous,
                current: tripletForLog.current,
                next: tripletForLog.next
            });
            if (modal && typeof modal.setAiAdvancedContext === 'function') {
                modal.setAiAdvancedContext(aiResult.advancedContext ?? null);
            }

            // Record actual processing time for calibration
            const elapsedSeconds = (performance.now() - startTime) / 1000;
            if (modal && typeof modal.recordProcessingTime === 'function') {
                modal.recordProcessingTime(tripletMetric.value, elapsedSeconds);
            }

            if (aiResult.result) {
                const parsedAnalysis = normalizeParsedAnalysisForTriplet(aiResult.parsedAnalysis, triplet);
                const safeWrite = await applyTripletAnalysisResult({
                    plugin,
                    vault,
                    triplet,
                    parsedAnalysis,
                    provider: aiResult.providerUsed,
                    attribution: aiResult.attribution
                });

                if (safeWrite.success) {
                    processedCount++;
                    modal.updateProgress(processedCount, total, sceneName);
                    markQueueStatus('success', parsedAnalysis?.sceneGrade);
                } else {
                    markQueueStatus('error');
                    if (safeWrite.route === 'warning') {
                        modal.addError(getLocalReviewErrorMessage(triplet.current));
                    } else {
                        modal.addError(t('sceneAnalysis.pipeline.errors.failedUpdate', { num: triplet.current.sceneNumber ?? 'N/A', path: triplet.current.file.path })); // SAFE: sceneNumber is null for unnumbered scene files — 'N/A' is a display placeholder
                    }
                }
            } else {
                markQueueStatus('error');
                modal.addError(t('sceneAnalysis.pipeline.errors.aiProcessingFailed', { num: triplet.current.sceneNumber ?? 'N/A', path: triplet.current.file.path })); // SAFE: sceneNumber is null for unnumbered scene files — 'N/A' is a display placeholder
            }
        } catch (sceneError) {
            await setLocalReviewWarningIfNeeded(plugin, vault, triplet.current, sceneError);
            markQueueStatus('error');
            const detail = sceneError instanceof Error ? sceneError.message : String(sceneError);
            modal.addError(t('sceneAnalysis.pipeline.errors.fatalScene', { num: triplet.current.sceneNumber ?? 'N/A', path: triplet.current.file.path, detail })); // SAFE: sceneNumber is null for unnumbered scene files — 'N/A' is a display placeholder
        } finally {
            modal.noteLogAttempt();
        }
    }

    await plugin.saveSettings();
    plugin.refreshTimelineIfNeeded(null);
}

export async function processEntireSubplotWithModalInternal(
    plugin: RadialTimelinePlugin,
    vault: Vault,
    subplotName: string,
    modal: SceneAnalysisProcessingModal
): Promise<void> {
    const allScenes = await getAllSceneData(plugin, vault);
    if (allScenes.length < 1) {
        throw new Error(t('sceneAnalysis.pipeline.notices.noScenesValid'));
    }

    const filtered = allScenes.filter(scene => getSubplotNamesFromFM(scene.frontmatter).includes(subplotName));
    if (filtered.length === 0) {
        throw new Error(t('sceneAnalysis.pipeline.notices.noScenesForSubplot', { name: subplotName }));
    }

    filtered.sort(compareScenesByOrder);
    const isResuming = plugin.settings._isResuming || false; // SAFE: _isResuming is an optional transient settings flag — absent means a normal (non-resume) run
    if (isResuming) {
        plugin.settings._isResuming = false;
        await plugin.saveSettings();
    }

    // Only scenes with content take part, as in the manuscript and flagged
    // subplot modes: an empty scene is never a triplet's prev/next, and is
    // never sent for analysis. This is the set the command's scene count and
    // pre-check already promise (SceneAnalysisCommands getSceneCount).
    const contextScenes = filtered.filter(scene => hasProcessableContent(scene.frontmatter));
    const triplets = buildTripletsByIndex(contextScenes, contextScenes, (s) => s.file.path);

    const subplotTasks = triplets.map(triplet => {
        const alreadyProcessed = hasBeenProcessedForBeats(triplet.current.frontmatter, { todayOnly: true });
        const shouldProcess = isResuming ? !alreadyProcessed : true;
        return { triplet, shouldProcess };
    });
    const queueItems = subplotTasks
        .filter(task => task.shouldProcess)
        .map(task => buildQueueItem(task.triplet.current));
    if (modal && typeof modal.setProcessingQueue === 'function') {
        modal.setProcessingQueue(queueItems);
    }
    const total = queueItems.length;
    let processedCount = 0;

    for (const { triplet, shouldProcess } of subplotTasks) {
        if (modal.isAborted()) {
            await plugin.saveSettings();
            throw new Error(t('sceneAnalysis.pipeline.notices.abortedByUser'));
        }

        if (!shouldProcess) continue;

        const sceneName = triplet.current.file.basename;
        const queueId = triplet.current.file.path;
        const markQueueStatus = (status: 'success' | 'error', grade?: 'A' | 'B' | 'C') => {
            if (modal && typeof modal.markQueueStatus === 'function') {
                modal.markQueueStatus(queueId, status, grade);
            }
        };

        const { prevNum, currentNum, nextNum } = tripletSceneNumbers(triplet);

        if (modal && typeof modal.setTripletInfo === 'function') {
            modal.setTripletInfo(prevNum, currentNum, nextNum, triplet.current.file.path, sceneName);
        }

        const userPrompt = buildTripletPrompt(plugin, triplet);

        const sceneNameForLog = triplet.current.file.basename;
        const tripletForLog = buildPulseTriplet(prevNum, currentNum, nextNum).scenes;
        const runAi = createAiRunner(plugin, vault, callAiProvider, report => {
            modal.recordPulseUsage(sceneNameForLog, report);
        }, () => modal.isAborted());

        // Calculate triplet metric and start progress bar animation
        const tripletMetric = getTripletMetric(triplet);
        const currentSceneIndex = processedCount;
        if (modal && typeof modal.startSceneAnimation === 'function') {
            modal.startSceneAnimation(tripletMetric.value, currentSceneIndex, total, sceneNameForLog);
        }
        const startTime = performance.now();

        try {
            const aiResult = await runAi(userPrompt, subplotName, 'processEntireSubplot', sceneNameForLog, {
                prev: tripletForLog.previous,
                current: tripletForLog.current,
                next: tripletForLog.next
            });
            if (modal && typeof modal.setAiAdvancedContext === 'function') {
                modal.setAiAdvancedContext(aiResult.advancedContext ?? null);
            }

            // Record actual processing time for calibration
            const elapsedSeconds = (performance.now() - startTime) / 1000;
            if (modal && typeof modal.recordProcessingTime === 'function') {
                modal.recordProcessingTime(tripletMetric.value, elapsedSeconds);
            }

            if (aiResult.result) {
                const parsedAnalysis = normalizeParsedAnalysisForTriplet(aiResult.parsedAnalysis, triplet);
                const safeWrite = await applyTripletAnalysisResult({
                    plugin,
                    vault,
                    triplet,
                    parsedAnalysis,
                    provider: aiResult.providerUsed,
                    attribution: aiResult.attribution
                });

                if (safeWrite.success) {
                    processedCount++;
                    modal.updateProgress(processedCount, total, sceneName);
                    markQueueStatus('success', parsedAnalysis?.sceneGrade);
                } else {
                    markQueueStatus('error');
                    if (safeWrite.route === 'warning') {
                        modal.addError(getLocalReviewErrorMessage(triplet.current));
                    } else {
                        modal.addError(t('sceneAnalysis.pipeline.errors.failedUpdate', { num: triplet.current.sceneNumber ?? 'N/A', path: triplet.current.file.path })); // SAFE: sceneNumber is null for unnumbered scene files — 'N/A' is a display placeholder
                    }
                }
            } else {
                markQueueStatus('error');
                modal.addError(t('sceneAnalysis.pipeline.errors.aiProcessingFailed', { num: triplet.current.sceneNumber ?? 'N/A', path: triplet.current.file.path })); // SAFE: sceneNumber is null for unnumbered scene files — 'N/A' is a display placeholder
            }
        } catch (sceneError) {
            await setLocalReviewWarningIfNeeded(plugin, vault, triplet.current, sceneError);
            markQueueStatus('error');
            const detail = sceneError instanceof Error ? sceneError.message : String(sceneError);
            modal.addError(t('sceneAnalysis.pipeline.errors.fatalScene', { num: triplet.current.sceneNumber ?? 'N/A', path: triplet.current.file.path, detail })); // SAFE: sceneNumber is null for unnumbered scene files — 'N/A' is a display placeholder
        } finally {
            modal.noteLogAttempt();
        }
    }

    await plugin.saveSettings();
    plugin.refreshTimelineIfNeeded(null);
}

export function getActiveContextPrompt(plugin: RadialTimelinePlugin): string | undefined {
    const aiSettings = validateAiSettings(plugin.settings.aiSettings ?? buildDefaultAiSettings()).value;
    const templates = aiSettings.roleTemplates || []; // SAFE: roleTemplates is optional on the AiSettingsV1 type — an empty list simply yields no active context prompt
    const activeId = aiSettings.roleTemplateId;
    const active = templates.find(t => t.id === activeId);
    return active?.prompt;
}
