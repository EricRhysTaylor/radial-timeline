import { App, Notice, TFile } from 'obsidian';
import type RadialTimelinePlugin from '../../main';
import { resolveBookTitle } from '../../renderer/apr/aprHelpers';
import { AuthorProgressRenderService } from './AuthorProgressRenderService';
import { writeManagedOutput } from '../../utils/logVaultOps';
import { systemFolderPath } from '../../utils/systemFolder';
import { t } from '../../i18n';

export class AuthorProgressPublishService {
    constructor(
        private plugin: RadialTimelinePlugin,
        private app: App,
        private renderService: AuthorProgressRenderService
    ) {}

    public async generateReport(mode?: 'static' | 'dynamic'): Promise<string | null> {
        const report = await this.renderService.buildDefaultReport();
        if (!report) return null;
        const { settings, svgString, width, height, exportPath, exportFormat } = report;

        if (mode === 'dynamic') {
            if (settings.publishTarget === 'note') {
                return this.createNoteWithSocial(svgString, settings, exportFormat, width, height);
            }
            await this.renderService.saveAprOutput(exportPath, exportFormat, svgString, width, height);
            settings.lastPublishedDate = new Date().toISOString();
            await this.plugin.saveSettings();
            return exportPath;
        }

        const snapshotPath = this.renderService.buildSnapshotPath(exportPath);
        await this.renderService.saveAprOutput(snapshotPath, exportFormat, svgString, width, height);
        return snapshotPath;
    }

    private async createNoteWithSocial(
        svgString: string,
        settings: NonNullable<Awaited<ReturnType<AuthorProgressRenderService['buildDefaultReport']>>>['settings'],
        format: NonNullable<Awaited<ReturnType<AuthorProgressRenderService['buildDefaultReport']>>>['exportFormat'],
        width: number,
        height: number
    ): Promise<string | null> {
        const exportPath = this.renderService.getDefaultExportPath(settings);
        await this.renderService.saveAprOutput(exportPath, format, svgString, width, height);

        const exportFolder = exportPath.substring(0, exportPath.lastIndexOf('/')) || systemFolderPath('Social');
        const exportFileName = exportPath.substring(exportPath.lastIndexOf('/') + 1);
        const stem = exportFileName.includes('.') ? exportFileName.replace(/\.[^.]+$/, '') : exportFileName;
        const noteFileName = `${stem}.md`;
        const notePath = `${exportFolder}/${noteFileName}`;

        let noteContent: string;
        if (settings.noteBehavior === 'custom' && settings.customNoteTemplatePath) {
            try {
                const templateFile = this.app.vault.getAbstractFileByPath(settings.customNoteTemplatePath);
                if (templateFile instanceof TFile) {
                    const templateContent = await this.app.vault.read(templateFile);
                    noteContent = templateContent
                        .replace(/{{SVG_PATH}}/g, exportPath)
                        .replace(/{{SOCIAL_PATH}}/g, exportPath)
                        .replace(/{{AUTHOR_COMMENT}}/g, '');
                } else {
                    noteContent = this.createPresetNoteContent(exportPath);
                }
            } catch (error) {
                console.warn('Failed to load custom template, using preset:', error);
                noteContent = this.createPresetNoteContent(exportPath);
            }
        } else {
            noteContent = this.createPresetNoteContent(exportPath);
        }

        const writeResult = await writeManagedOutput(this.app, notePath, noteContent, {
            operation: 'author-progress-note',
            managedMarker: '<!-- Radial Timeline Managed Output: author-progress-note -->',
            unmanagedOverwritePrompt: (file) => t('ui.authorProgressPublishService.overwritePrompt', { path: file.path })
        });
        if (writeResult.skipped) {
            new Notice(t('ui.authorProgressPublishService.publishCancelled'));
            return null;
        }
        if (writeResult.snapshotPath) {
            new Notice(t('ui.authorProgressPublishService.archivedBeforeOverwrite', { path: writeResult.snapshotPath }));
        }

        settings.lastPublishedDate = new Date().toISOString();
        await this.plugin.saveSettings();
        return notePath;
    }

    private createPresetNoteContent(svgPath: string): string {
        const authorProgress = this.plugin.settings.authorProgress;
        const settings = authorProgress?.defaults;
        const bookTitle = resolveBookTitle(null, this.plugin.settings.books, this.plugin.getActiveBookTitle());
        const authorName = settings?.authorName || '';

        let content = `# ${bookTitle}${authorName ? ` by ${authorName}` : ''}\n\n`;
        content += `![Social](${svgPath})\n\n`;
        content += `<!-- Add your author comment here -->\n`;
        return content;
    }
}
