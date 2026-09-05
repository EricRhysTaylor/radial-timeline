import { Notice, TFile, App } from 'obsidian';
import type RadialTimelinePlugin from '../main';
import { t } from '../i18n';
import { normalizeFrontmatterKeys } from '../utils/frontmatter';
import { isStoryBeat } from '../utils/sceneHelpers';
import { appendGossamerScore, applyGossamerRunMetadata, collectGossamerManagedSnapshot, createGossamerRunId, detectDominantStage, willAppendGossamerPrune } from '../utils/gossamer';
import { DEFAULT_GOSSAMER_SIGNAL, type GossamerSignalType } from '../types/gossamerSignals';
import { isPathInFolderScope } from '../utils/pathScope';
import { archiveGossamerFrontmatterFields } from '../gossamer/logs';

export class GossamerScoreService {
    constructor(private app: App, private plugin: RadialTimelinePlugin) {}

    async saveScores(
        scores: Map<string, number>,
        signal: GossamerSignalType = DEFAULT_GOSSAMER_SIGNAL,
        justifications?: Map<string, string>,
        source: 'manual-entry' | 'clipboard-paste' = 'manual-entry'
    ): Promise<void> {
        const sourcePath = this.plugin.settings.sourcePath || '';
        const allFiles = this.app.vault.getMarkdownFiles();
        const files = sourcePath
            ? allFiles.filter(f => isPathInFolderScope(f.path, sourcePath))
            : allFiles;

        // Detect dominant stage from current scene data
        let dominantStage = 'Zero';
        try {
            const scenes = await this.plugin.getSceneData();
            dominantStage = detectDominantStage(scenes);
        } catch (e) {
            console.error('[Gossamer] Failed to detect dominant stage, defaulting to Zero:', e);
        }

        let updateCount = 0;
        const targets: Array<{ beatTitle: string; newScore: number; file: TFile }> = [];
        const runId = createGossamerRunId();
        const createdAt = new Date().toISOString();

        for (const [beatTitle, newScore] of scores) {
            let file: TFile | null = null;
            for (const f of files) {
                const cache = this.app.metadataCache.getFileCache(f);
                const rawFm = cache?.frontmatter;
                const fm = rawFm ? normalizeFrontmatterKeys(rawFm) : undefined;
                if (fm && isStoryBeat(fm.Class)) {
                    const filename = f.basename;
                    const titleMatch = filename === beatTitle ||
                        filename === beatTitle.replace(/^\d+\s+/, '') ||
                        filename.toLowerCase() === beatTitle.toLowerCase() ||
                        filename.toLowerCase().replace(/[-\s]/g, '') === beatTitle.toLowerCase().replace(/[-\s]/g, '');
                    if (titleMatch) {
                        file = f;
                        break;
                    }
                }
            }

            if (!file) continue;
            targets.push({ beatTitle, newScore, file });
        }

        const filesToSnapshot = targets
            .map(({ file }) => file)
            .filter((file, index, array) => array.findIndex((candidate) => candidate.path === file.path) === index)
            .filter((file) => {
                const priorFrontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
                if (!priorFrontmatter) return false;
                return willAppendGossamerPrune(priorFrontmatter) || Object.keys(collectGossamerManagedSnapshot(priorFrontmatter)).length > 0;
            });
        const snapshotPath = await archiveGossamerFrontmatterFields(this.app, filesToSnapshot, {
            operation: source === 'clipboard-paste' ? 'gossamer-clipboard-save' : 'gossamer-save',
            selectFields: (frontmatter) => collectGossamerManagedSnapshot(frontmatter),
            meta: {
                scope: 'beat-note',
                signal,
                beatCount: filesToSnapshot.length
            }
        });

        for (const { beatTitle, newScore, file } of targets) {
            try {
                await this.app.fileManager.processFrontMatter(file, (yaml: Record<string, unknown>) => {
                    const fm = yaml;
                    const { nextIndex, updated } = appendGossamerScore(fm);
                    Object.assign(fm, updated);
                    fm[`Gossamer${nextIndex}`] = newScore;
                    const justification = justifications?.get(beatTitle);
                    if (justification && justification.trim().length > 0) {
                        fm[`Gossamer${nextIndex} Justification`] = justification.trim();
                    }
                    applyGossamerRunMetadata(fm, nextIndex, {
                        runId,
                        createdAt,
                        provider: 'manual',
                        model: 'Manual entry',
                        stage: dominantStage,
                        signal
                    });
                    delete fm.GossamerLocation;
                    delete fm.GossamerNote;
                    delete fm.GossamerRuns;
                    delete fm.GossamerLatestRun;
                });
                updateCount++;
            } catch (e) {
                console.error(`[Gossamer] Failed to update beat ${beatTitle}:`, e);
            }
        }

        if (updateCount > 0) {
            const parts = [
                updateCount > 1
                    ? t('gossamer.service.updatedBeatScoresPlural', { count: updateCount, stage: dominantStage })
                    : t('gossamer.service.updatedBeatScoreSingular', { count: updateCount, stage: dominantStage })
            ];
            if (snapshotPath) parts.push(t('gossamer.service.archivedSingleSnapshot'));
            new Notice(parts.join(' '));
        } else {
            new Notice(t('gossamer.service.noBeatsUpdated'));
        }
    }
}
