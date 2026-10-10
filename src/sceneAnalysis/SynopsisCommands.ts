/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Summary Refresh Command Helper
 * Handles logic for the "Summary refresh" command.
 *
 * Summary = extended AI-generated scene analysis (≈200–300 words, configurable) — primary artifact for Inquiry corpus.
 * Hover blurb = concise scene text (strict word-capped), persisted to the legacy `Synopsis` key when enabled.
 */

import { sleep } from '../utils/sleep';
import { Vault, Notice } from 'obsidian';
import type RadialTimelinePlugin from '../main';
import { SceneAnalysisProcessingModal, type ProcessingMode, type SceneQueueItem } from '../modals/SceneAnalysisProcessingModal';
import { getAllSceneData, compareScenesByOrder, assertSceneSourcesUnchanged } from './data';
import { classifySynopsis } from './synopsisQuality';
import {
    buildSummaryRunRequest,
    buildSynopsisRunRequest,
    isFlaggedForSummaryRefresh,
    parseSummaryReply,
    parseSynopsisReply,
    persistSummaryForScene,
    resolveSummaryRefreshScope,
    resolveSummaryTargetWords,
    sendSummaryRefreshRequest
} from './summaryRefresh';
import type { SceneData } from './types';
import { parseSceneTitle, decodeHtmlEntities } from '../utils/text';
import { getSynopsisGenerationWordLimit } from '../utils/synopsisLimits';
import { t } from '../i18n';

/**
 * Check freshness: is the scene's Due/Completed date newer than the last AI update timestamp?
 */
function isSummaryStale(scene: SceneData, plugin: RadialTimelinePlugin): boolean {
    const timestamps = plugin.settings.aiUpdateTimestamps?.[scene.file.path];
    if (!timestamps?.summaryUpdated) return true; // Never updated → stale

    const lastUpdated = new Date(timestamps.summaryUpdated);
    if (isNaN(lastUpdated.getTime())) return true;

    // Check Due date
    const dueRaw = scene.frontmatter.Due;
    if (dueRaw) {
        const dueDate = dueRaw instanceof Date
            ? dueRaw
            : new Date(typeof dueRaw === 'string' ? dueRaw : typeof dueRaw === 'number' ? String(dueRaw) : '');
        if (!isNaN(dueDate.getTime()) && dueDate > lastUpdated) return true;
    }

    // Check Completed date (Status changing to Complete typically updates Due)
    return false;
}

function isSameCalendarDay(timestamp: string | undefined, now: Date = new Date()): boolean {
    if (!timestamp) return false;
    const parsed = new Date(timestamp);
    if (Number.isNaN(parsed.getTime())) return false;
    return parsed.getFullYear() === now.getFullYear()
        && parsed.getMonth() === now.getMonth()
        && parsed.getDate() === now.getDate();
}

function wasSummaryUpdatedToday(scene: SceneData, plugin: RadialTimelinePlugin, now: Date = new Date()): boolean {
    return isSameCalendarDay(plugin.settings.aiUpdateTimestamps?.[scene.file.path]?.summaryUpdated, now);
}

function wasSynopsisUpdatedToday(scene: SceneData, plugin: RadialTimelinePlugin, now: Date = new Date()): boolean {
    return isSameCalendarDay(plugin.settings.aiUpdateTimestamps?.[scene.file.path]?.synopsisUpdated, now);
}

function normalizeErrorMessage(error: unknown): string {
    if (error instanceof Error) return error.message.trim();
    if (error === null || error === undefined) return 'Unknown error';
    if (typeof error === 'string') return error.trim();
    if (['number', 'boolean', 'bigint', 'symbol'].includes(typeof error)) {
        return String(error).trim();
    }
    try {
        return JSON.stringify(error).trim();
    } catch {
        return 'Unknown error';
    }
}

function explainSummaryRefreshFailure(
    error: unknown,
    options?: {
        sceneBody?: string;
        sceneName?: string;
        passLabel?: 'summary' | 'synopsis';
    }
): string {
    const raw = normalizeErrorMessage(error).replace(/^Error:\s*/i, '');
    const normalized = raw.toLowerCase();
    const passLabel = options?.passLabel ?? 'summary';
    const sceneWords = options?.sceneBody
        ? options.sceneBody.trim().split(/\s+/).filter(Boolean).length
        : 0;

    if (
        normalized.includes('context too long')
        || normalized.includes('context window')
        || normalized.includes('too many tokens')
    ) {
        return sceneWords > 0
            ? t('sceneAnalysis.synopsis.aiErrors.contextTooLongWithSize', { pass: passLabel, words: sceneWords.toLocaleString() })
            : t('sceneAnalysis.synopsis.aiErrors.contextTooLongNoSize', { pass: passLabel });
    }

    return raw || t('sceneAnalysis.synopsis.aiErrors.unknownPassFailure', { pass: passLabel });
}

export async function calculateSynopsisSceneCount(
    plugin: RadialTimelinePlugin,
    vault: Vault,
    mode: ProcessingMode,
    weakThreshold?: number
): Promise<number> {
    try {
        const scope = resolveSummaryRefreshScope(plugin);
        if (scope.files.length === 0) return 0;
        const allScenes = await getAllSceneData(plugin, vault, { files: scope.files });
        const threshold = weakThreshold ?? plugin.settings.synopsisWeakThreshold ?? 75;

        let count = 0;
        for (const scene of allScenes) {
            // Scene selection now targets the Summary field
            const currentSummary = scene.frontmatter.Summary;
            const quality = classifySynopsis(currentSummary, threshold);

            if (mode === 'synopsis-flagged') {
                if (isFlaggedForSummaryRefresh(scene)) count++;
            } else if (mode === 'synopsis-missing-weak') {
                // Enhanced: missing, weak, OR stale (Due date > last AI update)
                if (quality === 'missing' || quality === 'weak' || isSummaryStale(scene, plugin)) count++;
            } else if (mode === 'synopsis-missing') {
                if (quality === 'missing') count++;
            } else if (mode === 'synopsis-all') {
                count++;
            }
        }
        return count;
    } catch (error) {
        console.error('Error calculating synopsis count:', error);
        return 0;
    }
}

export async function processSynopsisByManuscriptOrder(
    plugin: RadialTimelinePlugin,
    vault: Vault
): Promise<void> {
    // Reopen active modal state instead of creating a second run context.
    if (plugin.activeBeatsModal && plugin.activeBeatsModal.isProcessing) {
        plugin.activeBeatsModal.open();
        new Notice(t('sceneAnalysis.synopsis.notices.reopeningSession'));
        return;
    }

    const scope = resolveSummaryRefreshScope(plugin);
    if (scope.reason) {
        new Notice(scope.reason);
        return;
    }
    if (scope.files.length === 0) {
        new Notice(t('sceneAnalysis.synopsis.notices.noScenesScope'));
        return;
    }

    const modal = new SceneAnalysisProcessingModal(
        plugin.app,
        plugin,
        (mode, weakThreshold) => calculateSynopsisSceneCount(plugin, vault, mode, weakThreshold),
        async (mode, weakThreshold, targetWords) => {
            await runSynopsisBatch(plugin, vault, mode, modal, weakThreshold, targetWords);
        },
        'radial-timeline:refresh-scene-synopses-ai',
        undefined,
        undefined,
        'synopsis' // Legacy task identifier for Summary refresh mode.
    );
    modal.open();
}

export async function runSynopsisBatch(
    plugin: RadialTimelinePlugin,
    vault: Vault,
    mode: ProcessingMode,
    modal: SceneAnalysisProcessingModal,
    weakThreshold?: number,
    targetWords?: number
): Promise<void> {
    const scope = resolveSummaryRefreshScope(plugin);
    if (scope.reason) {
        new Notice(scope.reason);
        return;
    }
    if (scope.files.length === 0) {
        new Notice(t('sceneAnalysis.synopsis.notices.noScenesScope'));
        return;
    }

    const allScenes = await getAllSceneData(plugin, vault, { files: scope.files });
    allScenes.sort(compareScenesByOrder);
    new Notice(t('sceneAnalysis.synopsis.notices.scopeMessage', { scope: scope.scopeSummary }));

    // Get settings with fallbacks
    const threshold = weakThreshold ?? plugin.settings.synopsisWeakThreshold ?? 75;
    const target = targetWords ?? resolveSummaryTargetWords(plugin.settings);
    const alsoUpdateSynopsis = plugin.settings.alsoUpdateSynopsis ?? false;
    const synopsisMaxWords = getSynopsisGenerationWordLimit(plugin.settings);
    const isResuming = plugin.settings._isResuming || false;
    const today = new Date();

    if (isResuming) {
        plugin.settings._isResuming = false;
        void plugin.saveSettings();
    }

    // Scene selection targets Summary quality and freshness gates.
    const scenesToProcess = allScenes.filter(scene => {
        const quality = classifySynopsis(scene.frontmatter.Summary, threshold);
        let selected = false;
        if (mode === 'synopsis-flagged') selected = isFlaggedForSummaryRefresh(scene);
        else if (mode === 'synopsis-missing-weak') selected = quality === 'missing' || quality === 'weak' || isSummaryStale(scene, plugin);
        else if (mode === 'synopsis-missing') selected = quality === 'missing';
        else if (mode === 'synopsis-all') selected = true;
        if (!selected) return false;

        if (!isResuming) return true;

        if (alsoUpdateSynopsis) {
            return !wasSummaryUpdatedToday(scene, plugin, today) || !wasSynopsisUpdatedToday(scene, plugin, today);
        }
        return !wasSummaryUpdatedToday(scene, plugin, today);
    });

    if (scenesToProcess.length === 0) {
        new Notice(t('sceneAnalysis.synopsis.notices.noMatchingScenes'));
        return;
    }

    // Initialize Queue
    const queueItems: SceneQueueItem[] = scenesToProcess.map(scene => {
        const rawTitle = typeof scene.frontmatter?.Title === 'string'
            ? scene.frontmatter.Title
            : scene.file.basename.replace(/\.md$/i, '');
        const parsed = parseSceneTitle(rawTitle, scene.sceneNumber ?? undefined);
        return {
            id: scene.file.path,
            label: parsed.number || String(scene.sceneNumber || ''),
            detail: decodeHtmlEntities(parsed.text || rawTitle)
        };
    });

    if (modal.setProcessingQueue) modal.setProcessingQueue(queueItems);

    let processedCount = 0;

    for (const scene of scenesToProcess) {
        if (modal.isAborted()) break;

        const sceneName = scene.file.basename;
        const currentSummary = (scene.frontmatter.Summary as string) || '';
        const alreadySummaryUpdatedToday = wasSummaryUpdatedToday(scene, plugin, today);

        // Show current item info (including old summary for preview)
        if (modal.setSynopsisPreview) {
            modal.setSynopsisPreview(currentSummary, t('sceneAnalysis.processingModal.synopsisPreview.generating'));
        }

        // --- Step 1: Generate Summary (primary artifact) ---
        if (modal.startSceneAnimation) {
            const words = typeof scene.frontmatter.Words === 'number' ? scene.frontmatter.Words : 500;
            modal.startSceneAnimation(words * 0.4, processedCount, scenesToProcess.length, sceneName);
        }

        try {
            let newSummary = currentSummary.trim();
            // The model that produced this scene's new text, for the stamp.
            // Stays null when no AI step produced anything, and then nothing
            // is written: a stamp must never name a model that did not run.
            let attribution: string | null = null;

            if (!isResuming || !alreadySummaryUpdatedToday || !newSummary) {
                const sent = await sendSummaryRefreshRequest(plugin, { ...buildSummaryRunRequest(scene, target), shouldAbort: () => modal.isAborted() });
                modal.setAiAdvancedContext(sent.advancedContext ?? null);
                const parsed = parseSummaryReply(sent.reply);
                if (!parsed.ok) {
                    modal.addError(t('sceneAnalysis.synopsis.aiErrors.replyRejected', { name: sceneName, problem: parsed.problem }));
                    if (modal.markQueueStatus) modal.markQueueStatus(scene.file.path, 'error');
                    continue;
                }
                newSummary = parsed.text;
                attribution = sent.attribution;
            }

            let newSynopsis: string | undefined;

            // Generate the hover blurb from the newly generated Summary, not the full scene text.
            if (alsoUpdateSynopsis) {
                try {
                    const sent = await sendSummaryRefreshRequest(plugin, { ...buildSynopsisRunRequest(scene, newSummary, synopsisMaxWords), shouldAbort: () => modal.isAborted() });
                    modal.setAiAdvancedContext(sent.advancedContext ?? null);
                    const parsed = parseSynopsisReply(sent.reply, synopsisMaxWords);
                    if (!parsed.ok) throw new Error(parsed.problem);
                    newSynopsis = parsed.text;
                    attribution ??= sent.attribution;
                } catch (synErr) {
                    console.warn(`Synopsis generation failed for ${sceneName}:`, synErr);
                    const reason = explainSummaryRefreshFailure(synErr, {
                        sceneBody: newSummary,
                        sceneName,
                        passLabel: 'synopsis'
                    });
                    modal.addWarning(t('sceneAnalysis.synopsis.aiErrors.synopsisFailed', { name: sceneName, reason }));
                }
            }

            if (attribution === null) {
                // Resumed run: the Summary was already refreshed today and the
                // Synopsis pass failed (its warning is above). Nothing new to write.
                if (modal.markQueueStatus) modal.markQueueStatus(scene.file.path, 'error');
                continue;
            }

            try {
                const assertSourcesCurrent = await assertSceneSourcesUnchanged(vault, [scene]);
                await persistSummaryForScene(
                    plugin,
                    scene.file.path,
                    { summary: newSummary, synopsis: newSynopsis },
                    attribution,
                    assertSourcesCurrent
                );
                processedCount++;

                if (modal.setSynopsisPreview) {
                    modal.setSynopsisPreview(currentSummary, newSummary);
                }
                if (modal.updateProgress) {
                    modal.updateProgress(processedCount, scenesToProcess.length, sceneName);
                }
                if (modal.markQueueStatus) {
                    modal.markQueueStatus(scene.file.path, 'success');
                }
            } catch (saveError) {
                const message = saveError instanceof Error ? saveError.message : String(saveError);
                modal.addError(t('sceneAnalysis.synopsis.aiErrors.saveError', { name: sceneName, message }));
                if (modal.markQueueStatus) modal.markQueueStatus(scene.file.path, 'error');
            }
        } catch (err) {
            const reason = explainSummaryRefreshFailure(err, {
                sceneBody: scene.body,
                sceneName,
                passLabel: 'summary'
            });
            modal.addError(t('sceneAnalysis.synopsis.aiErrors.summaryFailed', { name: sceneName, reason }));
            if (modal.markQueueStatus) modal.markQueueStatus(scene.file.path, 'error');
        }

        // Small delay to let UI render
        await sleep(100);
    }

    // Results are written per-scene during processing; nothing left to apply at completion.
}
