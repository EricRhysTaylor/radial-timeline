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
import { getMainPlotName } from '../utils/mainPlot';

export interface SubplotStats {
    name: string;
    count: number;
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
        const mainPlot = getMainPlotName();
        const counts = new Map<string, number>();

        counts.set(mainPlot, 0);

        const files = await this.getSceneFiles('active-book');
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
        const mainPlot = getMainPlotName();
        if (subplotToDelete === mainPlot) {
            new Notice(t('ui.subplotManagementService.cannotDeleteMainPlot'));
            return;
        }

        const files = await this.getSceneFiles('active-book');
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

    /**
     * Rename a subplot in all scenes.
     *
     * Renaming the main plot also renames it in settings: scenes with no
     * Subplot follow the new name without any file change. The main plot's
     * name is vault-wide (saga view merges books by subplot name), so its
     * rename rewrites scenes in every book; other renames stay in the active
     * book. The caller persists settings.
     */
    async renameSubplot(oldName: string, newName: string): Promise<void> {
        if (oldName === newName) return;
        const renamingMainPlot = oldName === getMainPlotName();

        const files = await this.getSceneFiles(renamingMainPlot ? 'all-books' : 'active-book');
        let modifiedCount = 0;

        for (const file of files) {
            let processed = false;

            await this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
                let currentSubplots: string[] = [];
                let subplotKey = "Subplot";

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

                if (currentSubplots.includes(oldName)) {
                    // Replace oldName with newName
                    // Handle duplicates if newName already exists in the list?
                    // e.g. ["A", "B"] -> rename "A" to "B" -> ["B", "B"] -> should be ["B"]
                    
                    const newSubplotsSet = new Set(currentSubplots.map(s => s === oldName ? newName : s));
                    const newSubplots = Array.from(newSubplotsSet);

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
        
        this.renameSubplotInSettings(oldName, newName, renamingMainPlot);

        new Notice(t('ui.subplotManagementService.renamedInScenes', { oldName, newName, scenes: tCount('scene', modifiedCount) }));
    }

    /**
     * Rename subplot in settings: the main plot's name, and Dominant Subplots
     * preferences. Updates the live settings object; the caller saves it.
     */
    private renameSubplotInSettings(oldName: string, newName: string, renamingMainPlot: boolean): void {
        // SceneDataService shares the live settings reference with the plugin.
        const settings = this.sceneDataService.getSettings();
        if (renamingMainPlot) settings.mainPlotName = newName;
        const dominantSubplots = settings.dominantSubplots;
        if (!dominantSubplots) return;
        for (const [path, subplot] of Object.entries(dominantSubplots)) {
            if (subplot === oldName) dominantSubplots[path] = newName;
        }
    }

    /**
     * Helper to get all scene files (raw TFiles)
     */
    private async getSceneFiles(scope: 'active-book' | 'all-books'): Promise<TFile[]> {
        // We use the same filtering logic as SceneDataService
        // But simpler: just get all markdown files in the book folders and check Class
        const settings = this.sceneDataService.getSettings();
        const bookFolders = scope === 'all-books' ? (settings.books ?? []).map(book => book.sourceFolder) : [];
        const folders = bookFolders.length > 0 ? bookFolders : [settings.sourcePath || ""];

        const files = this.app.vault.getMarkdownFiles().filter((file: TFile) => {
            return folders.some(folder => isPathInFolderScope(file.path, folder));
        });

        const sceneFiles: TFile[] = [];
        
        for (const file of files) {
            const cache = this.app.metadataCache.getFileCache(file);
            const fm = cache?.frontmatter;
            if (fm && normalizeFrontmatterKeys(fm).Class === "Scene") {
                sceneFiles.push(file);
            }
        }
        
        return sceneFiles;
    }

    private async getSceneSubplots(file: TFile): Promise<string[]> {
        const content = await this.app.vault.read(file);
        const fmInfo = getFrontMatterInfo(content) as { exists?: boolean; frontmatter?: string };
        if (!fmInfo?.exists || !fmInfo.frontmatter) {
            return [getMainPlotName()];
        }

        try {
            const parsed: unknown = parseYaml(fmInfo.frontmatter);
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
                return [getMainPlotName()];
            }

            const normalized = normalizeFrontmatterKeys(parsed as Record<string, unknown>);
            const rawSubplots = normalized.Subplot;

            if (Array.isArray(rawSubplots)) {
                const names = rawSubplots
                    .map(value => frontmatterValueToText(value).trim())
                    .filter(Boolean);
                return names.length > 0 ? names : [getMainPlotName()];
            }

            if (rawSubplots === null || rawSubplots === undefined || rawSubplots === '') {
                return [getMainPlotName()];
            }

            return [frontmatterValueToText(rawSubplots).trim()].filter(Boolean);
        } catch {
            return [getMainPlotName()];
        }
    }
}
