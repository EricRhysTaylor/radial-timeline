import { Notice, Setting, type Editor, type MarkdownView, type TFile } from 'obsidian';
import { SceneTimeModal } from './SceneTimeModal';
import { ErtModal } from '../ui/ErtModal';
import { parseDuration } from '../utils/date';
import type { SceneTimeService } from './SceneTimeService';
import { t } from '../i18n';

class ManualTimeModal extends ErtModal {
    constructor(private service: SceneTimeService, private file: TFile,
        private source: string, private quote: string) { super(service.plugin.app); }
    onOpen(): void {
        this.applyShell({ width: 'min(600px, 96vw)', containerClasses: ['ert-manuscript-surface'] });
        this.mountHeader({ title: t('sceneTime.manual.title'), subtitle: t('sceneTime.manual.subtitle') });
        this.contentEl.createEl('p', { text: this.quote });
        let duration = '';
        new Setting(this.contentEl).setName(t('sceneTime.manual.elapsedName')).addText(input => input.setPlaceholder(t('sceneTime.manual.elapsedPlaceholder')).onChange(value => { duration = value; }))
            .addButton(button => button.setButtonText(t('sceneTime.manual.assignButton')).setCta().onClick(async () => {
                const ms = parseDuration(duration);
                if (ms === null || !Number.isFinite(ms) || ms <= 0) { new Notice(t('sceneTime.manual.invalidDuration')); return; }
                button.setDisabled(true);
                try { await this.service.assignSelection(this.file, this.source, this.quote, ms / 60000); this.close(); }
                catch (error) { new Notice(String(error)); button.setDisabled(false); }
            }));
    }
}

export function registerManualTime(service: SceneTimeService): void {
    const eligible = (editor: Editor, view: MarkdownView): boolean => !!view.file && !!service.metadata(view.file)
        && !!editor.getSelection().trim() && !/[\r\n]/.test(editor.getSelection());
    const open = (editor: Editor, view: MarkdownView): void => {
        if (view.file) new ManualTimeModal(service, view.file, editor.getValue(), editor.getSelection()).open();
    };
    service.plugin.addCommand({ id: 'assign-scene-time', name: t('commands.assignSceneTime'),
        editorCheckCallback: (checking, editor, context) => {
            if (!('getViewData' in context) || !eligible(editor, context)) return false;
            if (!checking) open(editor, context);
            return true;
        } });
}

/** Dots address a source line; existing cues keep their review/edit workflow. */
export function openSceneLineTime(service: SceneTimeService, file: TFile, source: string, line: number): void {
    const snapshot = service.snapshot(file, source);
    if (!snapshot?.proseLines.has(line) || service.plugin.settings.showSceneTimeCueBar === false) return;
    const cue = snapshot.cues.find(item => item.line === line);
    if (cue) new SceneTimeModal(service, file, () => source, cue.key).open();
    else new ManualTimeModal(service, file, source, source.split('\n')[line].trim()).open();
}
