import { App, FuzzySuggestModal, type TFile } from 'obsidian';
import { t } from '../i18n';

export class CanvasWorkspacePicker extends FuzzySuggestModal<TFile | null> {
    constructor(app: App, private readonly chosen: (file: TFile | null) => void, private readonly candidates?: TFile[]) { super(app); this.setPlaceholder(t('ui.timetable.canvasWorkspaceChoose')); }
    getItems(): Array<TFile | null> { return [...(this.candidates ?? this.app.vault.getFiles().filter(file => file.extension === 'canvas')), null]; }
    getItemText(file: TFile | null): string { return file?.path ?? t('ui.timetable.canvasWorkspaceCreate'); }
    onChooseItem(file: TFile | null): void { this.chosen(file); }
}
