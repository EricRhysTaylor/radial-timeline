import { normalizePath, TFolder } from 'obsidian';
import type RadialTimelinePlugin from '../main';

export class SettingsService {
    constructor(private plugin: RadialTimelinePlugin) { }

    async validateAndRememberPath(path: string): Promise<boolean> {
        if (!path || path.trim() === '') return false;

        const normalizedPath = normalizePath(path.trim());
        const file = this.plugin.app.vault.getAbstractFileByPath(normalizedPath);
        const isValid = file instanceof TFolder && file.path === normalizedPath;

        if (isValid) {
            const { validFolderPaths } = this.plugin.settings;
            if (!validFolderPaths.includes(normalizedPath)) {
                validFolderPaths.unshift(normalizedPath);
                if (validFolderPaths.length > 10) {
                    this.plugin.settings.validFolderPaths = validFolderPaths.slice(0, 10);
                }
                await this.plugin.saveSettings();
            }
            return true;
        }

        return false;
    }
}
