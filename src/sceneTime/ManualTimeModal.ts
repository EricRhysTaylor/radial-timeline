import { Notice, Setting, type Editor, type MarkdownView, type TFile } from 'obsidian';
import { SceneTimeModal } from './SceneTimeModal';
import { ErtModal } from '../ui/ErtModal';
import { parseDuration } from '../utils/date';
import type { SceneTimeService } from './SceneTimeService';

class ManualTimeModal extends ErtModal {
    constructor(private service: SceneTimeService, private file: TFile,
        private source: string, private quote: string) { super(service.plugin.app); }
    onOpen(): void {
        this.applyShell({ width: 'min(600px, 96vw)', containerClasses: ['ert-manuscript-surface'] });
        this.mountHeader({ title: 'Assign scene time', subtitle: 'Give this action an elapsed duration, even when the prose contains no time phrase. A blue [10h] marker appears beside it and contributes to the title-bar total.' });
        this.contentEl.createEl('p', { text: this.quote });
        let duration = '';
        new Setting(this.contentEl).setName('Elapsed time').addText(input => input.setPlaceholder('e.g. 10 hours').onChange(value => { duration = value; }))
            .addButton(button => button.setButtonText('Assign time').setCta().onClick(async () => {
                const ms = parseDuration(duration);
                if (ms === null || !Number.isFinite(ms) || ms <= 0) { new Notice('Enter a duration such as “10 hours”.'); return; }
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
    service.plugin.addCommand({ id: 'assign-scene-time', name: 'Assign scene time to selection',
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
