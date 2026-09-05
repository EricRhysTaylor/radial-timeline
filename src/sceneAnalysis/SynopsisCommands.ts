/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Summary Refresh Command Helper
 * Handles logic for the "Summary refresh" command.
 *
 * Summary = extended AI-generated scene analysis (≈200–300 words, configurable) — primary artifact for Inquiry corpus.
 * Hover blurb = concise scene text (strict word-capped), persisted to the legacy `Synopsis` key when enabled.
 */

import { sleep } from '../utils/sleep';
import { Vault, Notice, TFile } from 'obsidian';
import type RadialTimelinePlugin from '../main';
import { SceneAnalysisProcessingModal, type ProcessingMode, type SceneQueueItem } from '../modals/SceneAnalysisProcessingModal';
import { getAllSceneData, compareScenesByOrder, getSummaryUpdateFlag } from './data';
import { classifySynopsis } from './synopsisQuality';
import { buildSummaryPrompt, buildSynopsisPrompt } from '../ai/prompts/synopsis';
import { createAiRunner } from './RequestRunner';
import { callAiProvider } from './aiProvider';
import type { SceneData } from './types';
import { parseSceneTitle, decodeHtmlEntities } from '../utils/text';
import { normalizeBooleanValue } from '../utils/sceneHelpers';
import { getSynopsisGenerationWordLimit, truncateToWordLimit } from '../utils/synopsisLimits';
import { resolveBookScopedFiles } from '../services/NoteScopeResolver';
import { getCanonicalAiSettings, resolveConfiguredSelection } from '../ai/runtime/runtimeSelection';
import { snapshotFrontmatterFields } from '../utils/logVaultOps';
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

function getCurrentModelId(plugin: RadialTimelinePlugin): string {
    return resolveConfiguredSelection(getCanonicalAiSettings(plugin), {
        feature: 'SummaryRefresh'
    })?.model.id || 'gpt-5.6-sol';
}

function setCaseInsensitiveField(frontmatter: Record<string, unknown>, key: string, value: string): void {
    const lowerKey = key.toLowerCase();
    for (const existingKey of Object.keys(frontmatter)) {
        if (existingKey.toLowerCase() === lowerKey && existingKey !== key) {
            delete frontmatter[existingKey];
        }
    }
    frontmatter[key] = value;
}

function placeSummaryAfterSynopsis(frontmatter: Record<string, unknown>): void {
    const keys = Object.keys(frontmatter);
    const summaryKey = keys.find(key => key.toLowerCase() === 'summary');
    const synopsisKey = keys.find(key => key.toLowerCase() === 'synopsis');
    if (!summaryKey || !synopsisKey) return;

    const summaryIndex = keys.indexOf(summaryKey);
    const synopsisIndex = keys.indexOf(synopsisKey);
    if (summaryIndex === synopsisIndex + 1) return;

    const reorderedKeys = keys.filter(key => key !== summaryKey);
    reorderedKeys.splice(reorderedKeys.indexOf(synopsisKey) + 1, 0, summaryKey);

    const snapshot: Record<string, unknown> = {};
    for (const key of reorderedKeys) {
        snapshot[key] = frontmatter[key];
    }
    for (const key of Object.keys(frontmatter)) {
        delete frontmatter[key];
    }
    Object.assign(frontmatter, snapshot);
}

async function persistSummaryForScene(
    plugin: RadialTimelinePlugin,
    scenePath: string,
    summaryText: string,
    synopsisText?: string
): Promise<{ summary: string; synopsis?: string }> {
    const file = plugin.app.vault.getAbstractFileByPath(scenePath);
    if (!(file instanceof TFile)) {
        throw new Error(t('sceneAnalysis.synopsis.notices.sceneFileNotFound', { path: scenePath }));
    }

    const summary = String(summaryText ?? '').trim();
    const synopsis = synopsisText ? String(synopsisText).trim() : undefined;
    const modelId = getCurrentModelId(plugin);
    const now = new Date();
    const isoNow = now.toISOString();
    const timestamp = now.toLocaleString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
    } as Intl.DateTimeFormatOptions);

    await snapshotFrontmatterFields(plugin.app, [file], {
        operation: 'scene-summary-refresh',
        fields: ['Summary', 'Synopsis', 'Summary Update', 'SummaryUpdate', 'summaryupdate', 'Synopsis Update', 'SynopsisUpdate', 'synopsisupdate'],
        meta: {
            scope: 'scene-note',
            path: file.path
        }
    });

    await plugin.app.fileManager.processFrontMatter(file, (fm) => {
        const frontmatter = fm as Record<string, unknown>;

        // Write canonical keys and clean up case-variant duplicates.
        setCaseInsensitiveField(frontmatter, 'Summary', summary);
        if (synopsis) {
            setCaseInsensitiveField(frontmatter, 'Synopsis', synopsis);
        }

        // Keep Summary adjacent to the legacy Synopsis key for readability in frontmatter.
        placeSummaryAfterSynopsis(frontmatter);

        // Normalize update markers onto Summary Update while preserving legacy-key compatibility.
        const summaryUpdateKeys = ['Summary Update', 'SummaryUpdate', 'summaryupdate'];
        const legacyKeys = ['Synopsis Update', 'SynopsisUpdate', 'synopsisupdate'];

        let updatedFlag = false;
        for (const key of summaryUpdateKeys) {
            if (key in frontmatter) {
                frontmatter[key] = `${timestamp} by ${modelId}`;
                updatedFlag = true;
                break;
            }
        }
        if (!updatedFlag) {
            for (const key of legacyKeys) {
                if (key in frontmatter) {
                    delete frontmatter[key];
                    frontmatter['Summary Update'] = `${timestamp} by ${modelId}`;
                    updatedFlag = true;
                    break;
                }
            }
        }
        if (!updatedFlag) {
            frontmatter['Summary Update'] = `${timestamp} by ${modelId}`;
        }
    });

    // Track internal timestamps per scene so stale checks remain accurate.
    if (!plugin.settings.aiUpdateTimestamps) {
        plugin.settings.aiUpdateTimestamps = {};
    }
    const sceneTimestamps = plugin.settings.aiUpdateTimestamps[scenePath] ?? {};
    sceneTimestamps.summaryUpdated = isoNow;
    if (synopsis) {
        sceneTimestamps.synopsisUpdated = isoNow;
    }
    plugin.settings.aiUpdateTimestamps[scenePath] = sceneTimestamps;
    try {
        await plugin.saveSettings();
    } catch (error) {
        // Frontmatter writes are already committed; keep processing even if settings persistence fails.
        console.warn('Failed to persist summary timestamp settings:', error);
    }

    return { summary, synopsis };
}

function resolveSummaryRefreshScope(plugin: RadialTimelinePlugin): {
    files: TFile[];
    scopeSummary: string;
    reason?: string;
} {
    const scope = resolveBookScopedFiles({
        app: plugin.app,
        settings: plugin.settings,
        noteType: 'Scene'
    });
    return {
        files: scope.files,
        scopeSummary: scope.scopeSummary,
        reason: scope.reason
    };
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
    if (typeof error === 'number' || typeof error === 'boolean' || typeof error === 'bigint' || typeof error === 'symbol') {
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

        const isFlagged = (scene: SceneData) =>
            normalizeBooleanValue(getSummaryUpdateFlag(scene.frontmatter));

        let count = 0;
        for (const scene of allScenes) {
            // Scene selection now targets the Summary field
            const currentSummary = scene.frontmatter.Summary;
            const quality = classifySynopsis(currentSummary, threshold);

            if (mode === 'synopsis-flagged') {
                if (isFlagged(scene)) count++;
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
    const target = targetWords ?? plugin.settings.synopsisTargetWords ?? 200;
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
        const isFlagged = normalizeBooleanValue(getSummaryUpdateFlag(scene.frontmatter));
        let selected = false;
        if (mode === 'synopsis-flagged') selected = isFlagged;
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
        const runAi = createAiRunner(plugin, vault, callAiProvider);
        if (modal.startSceneAnimation) {
            const words = typeof scene.frontmatter.Words === 'number' ? scene.frontmatter.Words : 500;
            modal.startSceneAnimation(words * 0.4, processedCount, scenesToProcess.length, sceneName);
        }

        try {
            let newSummary = currentSummary.trim();

            if (!isResuming || !alreadySummaryUpdatedToday || !newSummary) {
                const summaryPrompt = buildSummaryPrompt(
                    scene.body,
                    String(scene.sceneNumber || 'N/A'),
                    target
                );
                const result = await runAi(summaryPrompt, null, 'synopsis', sceneName, undefined);
                modal.setAiAdvancedContext(result.advancedContext ?? null);

                if (!result.result) {
                    modal.addError(t('sceneAnalysis.synopsis.aiErrors.aiError', { name: sceneName }));
                    if (modal.markQueueStatus) modal.markQueueStatus(scene.file.path, 'error');
                    continue;
                }

                try {
                    const jsonMatch = result.result.match(/\{[\s\S]*\}/);
                    const jsonStr = jsonMatch ? jsonMatch[0] : result.result;
                    const parsed: unknown = JSON.parse(jsonStr);
                    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Expected summary object.');
                    const fields = parsed as Record<string, unknown>;
                    const value = fields.summary || fields.synopsis || '';
                    if (typeof value !== 'string') throw new Error('Expected summary text.');
                    newSummary = value;
                } catch (e) {
                    console.error('Failed to parse summary JSON', e);
                    modal.addError(t('sceneAnalysis.synopsis.aiErrors.jsonParseError', { name: sceneName }));
                    if (modal.markQueueStatus) modal.markQueueStatus(scene.file.path, 'error');
                    continue;
                }

                if (!newSummary) {
                    modal.addError(t('sceneAnalysis.synopsis.aiErrors.emptyResult', { name: sceneName }));
                    if (modal.markQueueStatus) modal.markQueueStatus(scene.file.path, 'error');
                    continue;
                }
            }

            let newSynopsis: string | undefined;

            // Generate the hover blurb from the newly generated Summary, not the full scene text.
            if (alsoUpdateSynopsis) {
                try {
                    const synopsisPrompt = buildSynopsisPrompt(
                        newSummary,
                        String(scene.sceneNumber || 'N/A'),
                        synopsisMaxWords
                    );

                    const synopsisResult = await runAi(synopsisPrompt, null, 'synopsis', `${sceneName} (synopsis)`, undefined);
                    modal.setAiAdvancedContext(synopsisResult.advancedContext ?? null);

                    if (synopsisResult.result) {
                        const synJsonMatch = synopsisResult.result.match(/\{[\s\S]*\}/);
                        const synJsonStr = synJsonMatch ? synJsonMatch[0] : synopsisResult.result;
                        const synParsed: unknown = JSON.parse(synJsonStr);
                        if (!synParsed || typeof synParsed !== 'object' || Array.isArray(synParsed)) throw new Error('Expected synopsis object.');
                        const fields = synParsed as Record<string, unknown>;
                        const parsedSynopsis = fields.synopsis || fields.summary || '';
                        if (typeof parsedSynopsis !== 'string') throw new Error('Expected synopsis text.');
                        if (parsedSynopsis) {
                            newSynopsis = truncateToWordLimit(parsedSynopsis, synopsisMaxWords);
                        }
                    }
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

            try {
                const persisted = await persistSummaryForScene(plugin, scene.file.path, newSummary, newSynopsis);
                processedCount++;

                if (modal.setSynopsisPreview) {
                    modal.setSynopsisPreview(currentSummary, persisted.summary);
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
