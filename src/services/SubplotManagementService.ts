/*
 * Subplot Management Service
 * 
 * Handles renaming and deleting subplots across scene files.
 */

import { App, TFile, Notice, getFrontMatterInfo, parseYaml } from 'obsidian';
import { SceneDataService } from './SceneDataService';
import { frontmatterValueToText, normalizeFrontmatterKeys } from '../utils/frontmatter';
import { isPathInFolderScope } from '../utils/pathScope';
import { t, tCount } from '../i18n';
import { getBookMainPlotName } from '../utils/mainPlot';
import { getActiveBook } from '../utils/books';

export interface SubplotStats {
    name: string;
    count: number;
}

export interface SubplotRenameResult {
    renamed: number;
    /** Scene files that could not be updated; their Subplot still has the old name. */
    failed: string[];
}

/**
 * Whether renaming to newName would take another subplot's name. Renaming a
 * subplot onto an existing one merges them for good, so the main plot never
 * may; the comparison ignores case, as names that differ only by case read as
 * the same subplot to an author.
 */
export function isSubplotNameTaken(subplots: SubplotStats[], oldName: string, newName: string): boolean {
    const wanted = newName.trim().toLowerCase();
    return subplots.some(subplot => subplot.name !== oldName && subplot.name.trim().toLowerCase() === wanted);
}

export class SubplotManagementService {
    private app: App;
    private sceneDataService: SceneDataService;

    constructor(app: App, sceneDataService: SceneDataService) {
        this.app = app;
        this.sceneDataService = sceneDataService;
    }

    /**
     * Get all unique subplots and their scene counts.
     * Reads fresh frontmatter from scene files so the modal reflects rename/delete
     * changes immediately instead of waiting on scene data cache refresh.
     */
    async getSubplotStats(): Promise<SubplotStats[]> {
        const mainPlot = this.getMainPlotName();
        const counts = new Map<string, number>();

        counts.set(mainPlot, 0);

        const files = this.getSceneFiles();
        for (const file of files) {
            const subplotNames = await this.getSceneSubplots(file);
            const uniqueSubplots = new Set(subplotNames.length > 0 ? subplotNames : [mainPlot]);

            for (const subplot of uniqueSubplots) {
                counts.set(subplot, (counts.get(subplot) || 0) + 1);
            }
        }

        const result: SubplotStats[] = [];
        for (const [name, count] of counts.entries()) {
            result.push({ name, count });
        }

        return result.sort((a, b) => {
            if (a.name === mainPlot) return -1;
            if (b.name === mainPlot) return 1;
            return a.name.localeCompare(b.name);
        });
    }

    /**
     * Delete a subplot from all scenes.
     * If a scene has only this subplot, it moves to the main plot.
     */
    async deleteSubplot(subplotToDelete: string): Promise<void> {
        const mainPlot = this.getMainPlotName();
        if (subplotToDelete === mainPlot) {
            new Notice(t('ui.subplotManagementService.cannotDeleteMainPlot'));
            return;
        }

        const files = this.getSceneFiles();
        let modifiedCount = 0;

        for (const file of files) {
            let processed = false;
            
            await this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
                // Get current subplots
                // Check both "Subplot" and "subplot" keys (processFrontMatter gives raw object)
                // We'll standardise on writing to "Subplot"
                
                let currentSubplots: string[] = [];
                let subplotKey = "Subplot"; // default key to write to

                // Find existing key if present
                const keys = Object.keys(fm);
                const existingKey = keys.find(k => k.toLowerCase() === "subplot");
                if (existingKey) {
                    subplotKey = existingKey;
                    const val = fm[existingKey];
                    if (Array.isArray(val)) {
                        currentSubplots = val.map(entry => frontmatterValueToText(entry));
                    } else if (val) {
                        currentSubplots = [frontmatterValueToText(val)];
                    }
                }

                // Check if subplotToDelete is present
                if (currentSubplots.includes(subplotToDelete)) {
                    // Filter it out
                    const newSubplots = currentSubplots.filter(s => s !== subplotToDelete);
                    
                    // If empty, the scene moves to the main plot
                    if (newSubplots.length === 0) {
                        newSubplots.push(mainPlot);
                    }

                    // Update frontmatter
                    // If single item, can store as string or array. Let's keep array if it was array, or string if single.
                    // To be safe and consistent, maybe just stick to what it was? 
                    // Actually, if we are removing one from a list, it stays a list (or becomes empty -> main plot).
                    // If it becomes the single main plot name, we can store it as a string if that's preferred,
                    // but array is also valid.
                    // Let's store as array if length > 1, string if length === 1
                    
                    if (newSubplots.length === 1) {
                        fm[subplotKey] = newSubplots[0];
                    } else {
                        fm[subplotKey] = newSubplots;
                    }
                    
                    processed = true;
                }
            });

            if (processed) modifiedCount++;
        }

        new Notice(t('ui.subplotManagementService.removedFromScenes', { name: subplotToDelete, scenes: tCount('scene', modifiedCount) }));
    }

    /** The active book's main plot, the subplot that owns its ring 1. */
    getMainPlotName(): string {
        return getBookMainPlotName(getActiveBook(this.sceneDataService.getSettings()));
    }

    /** Scenes in the active book whose Subplot lists this name: the files a rename edits. */
    countScenesListing(name: string): number {
        return this.getSceneFiles().filter(file => this.listedSubplots(this.app.metadataCache.getFileCache(file)?.frontmatter).includes(name)).length;
    }

    /**
     * Rename a subplot in the active book's scenes, like every subplot rename.
     *
     * Renaming the main plot also renames it on the active book's profile:
     * scenes with no Subplot follow the new name without any file change, and
     * other books keep their own main plot. A scene that cannot be updated is
     * reported, never skipped silently. The caller persists settings.
     */
    async renameSubplot(oldName: string, newName: string): Promise<SubplotRenameResult> {
        const renamingMainPlot = oldName === this.getMainPlotName();
        // The main plot's name lives on the book's profile; with no book there
        // is nowhere to keep it, and renamed scenes would leave ring 1.
        if (oldName === newName || (renamingMainPlot && !getActiveBook(this.sceneDataService.getSettings()))) {
            return { renamed: 0, failed: [] };
        }

        let renamed = 0;
        const failed: string[] = [];
        // What each renamed scene said before, to change it back if the main plot rename cannot finish.
        const originals: { file: TFile; key: string; value: unknown }[] = [];
        for (const file of this.getSceneFiles()) {
            let processed = false;
            try {
                await this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
                    const subplotKey = Object.keys(fm).find(k => k.toLowerCase() === 'subplot');
                    if (!subplotKey) return;
                    const value = fm[subplotKey];
                    originals.push({ file, key: subplotKey, value: Array.isArray(value) ? (value as unknown[]).slice() : value });
                    const currentSubplots = this.listedSubplots({ Subplot: value });
                    if (!currentSubplots.includes(oldName)) {
                        originals.pop();
                        return;
                    }
                    // Renaming onto a name the scene already lists keeps one entry.
                    const newSubplots = Array.from(new Set(currentSubplots.map(s => s === oldName ? newName : s)));
                    // Keep the author's shape: a list stays a list.
                    fm[subplotKey] = Array.isArray(value) || newSubplots.length > 1 ? newSubplots : newSubplots[0];
                    processed = true;
                });
            } catch {
                if (originals[originals.length - 1]?.file === file) originals.pop();
                failed.push(file.basename);
                continue;
            }
            if (processed) renamed++;
        }

        // A main plot half renamed splits ring 1 in two: change the renamed scenes
        // back and keep the old name, so the author can fix the failed files and retry.
        if (renamingMainPlot && failed.length > 0) {
            const notRestored: string[] = [];
            for (const { file, key, value } of originals) {
                try {
                    await this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => { fm[key] = value; });
                } catch {
                    notRestored.push(file.basename);
                }
            }
            new Notice(t('ui.subplotManagementService.renameFailed', { files: failed.join(', '), oldName }), 0);
            new Notice(t('ui.subplotManagementService.mainPlotRenameUndone', { oldName }), 0);
            if (notRestored.length > 0) {
                new Notice(t('ui.subplotManagementService.renameNotUndone', { files: notRestored.join(', '), newName }), 0);
            }
            return { renamed: notRestored.length, failed };
        }

        this.renameSubplotInSettings(oldName, newName, renamingMainPlot);

        new Notice(t('ui.subplotManagementService.renamedInScenes', { oldName, newName, scenes: tCount('scene', renamed) }));
        if (failed.length > 0) {
            new Notice(t('ui.subplotManagementService.renameFailed', { files: failed.join(', '), oldName }), 0);
        }
        return { renamed, failed };
    }

    /**
     * Rename subplot in settings: the active book's main plot name, and
     * Dominant Subplots preferences. Updates the live settings object; the
     * caller saves it.
     */
    private renameSubplotInSettings(oldName: string, newName: string, renamingMainPlot: boolean): void {
        // SceneDataService shares the live settings reference with the plugin.
        const settings = this.sceneDataService.getSettings();
        const book = getActiveBook(settings);
        if (renamingMainPlot && book) book.mainPlotName = newName;
        const dominantSubplots = settings.dominantSubplots;
        if (!dominantSubplots) return;
        for (const [path, subplot] of Object.entries(dominantSubplots)) {
            if (subplot === oldName) dominantSubplots[path] = newName;
        }
    }

    private listedSubplots(frontmatter: Record<string, unknown> | undefined): string[] {
        const value = frontmatter ? normalizeFrontmatterKeys(frontmatter).Subplot : undefined;
        if (Array.isArray(value)) return value.map(entry => frontmatterValueToText(entry));
        return value ? [frontmatterValueToText(value)] : [];
    }

    /** Scene files of the active book (raw TFiles). */
    private getSceneFiles(): TFile[] {
        const settings = this.sceneDataService.getSettings();
        return this.app.vault.getMarkdownFiles().filter((file: TFile) => {
            if (!isPathInFolderScope(file.path, settings.sourcePath || '')) return false;
            const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
            return Boolean(fm && normalizeFrontmatterKeys(fm).Class === 'Scene');
        });
    }

    private async getSceneSubplots(file: TFile): Promise<string[]> {
        const content = await this.app.vault.read(file);
        const fmInfo = getFrontMatterInfo(content) as { exists?: boolean; frontmatter?: string };
        if (!fmInfo?.exists || !fmInfo.frontmatter) {
            return [this.getMainPlotName()];
        }

        try {
            const parsed: unknown = parseYaml(fmInfo.frontmatter);
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
                return [this.getMainPlotName()];
            }

            const normalized = normalizeFrontmatterKeys(parsed as Record<string, unknown>);
            const rawSubplots = normalized.Subplot;

            if (Array.isArray(rawSubplots)) {
                const names = rawSubplots
                    .map(value => frontmatterValueToText(value).trim())
                    .filter(Boolean);
                return names.length > 0 ? names : [this.getMainPlotName()];
            }

            if (rawSubplots === null || rawSubplots === undefined || rawSubplots === '') {
                return [this.getMainPlotName()];
            }

            return [frontmatterValueToText(rawSubplots).trim()].filter(Boolean);
        } catch {
            return [this.getMainPlotName()];
        }
    }
}
