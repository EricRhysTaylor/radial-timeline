import { App, ButtonComponent, Setting, type TextComponent } from 'obsidian';
import { ErtModal } from '../ui/ErtModal';
import type { BookCopyKind } from '../utils/draftBook';
import { t } from '../i18n';

export interface BookCopyRequest {
    name: string;
    kind: BookCopyKind;
    switchToCopy: boolean;
}

export class CreateBookCopyModal extends ErtModal {
    constructor(
        app: App,
        private readonly workingDraftName: string,
        private readonly resolveDestination: (name: string) => string,
        private readonly onSubmit: (request: BookCopyRequest) => Promise<boolean>
    ) { super(app); }

    onOpen(): void {
        this.contentEl.empty();
        this.applyShell({ width: 'min(520px, 92vw)' });
        const header = this.contentEl.createDiv({ cls: 'ert-modal-header' });
        header.createDiv({ cls: 'ert-modal-title', text: t('ui.createBookCopyModal.title') });
        header.createDiv({ cls: 'ert-modal-subtitle', text: t('ui.createBookCopyModal.subtitle') });
        const form = this.contentEl.createDiv({ cls: 'ert-stack' });
        let kind: BookCopyKind = 'submission-snapshot';
        let name = 'Submission snapshot';
        let switchToCopy = false;
        let busy = false;
        let nameInput: TextComponent;
        const preview = form.createDiv({ cls: 'setting-item-description' });
        const updatePreview = () => preview.setText(t('ui.createBookCopyModal.destination', { path: this.resolveDestination(name.trim()) }));
        const typeSetting = new Setting(form)
            .setName(t('ui.createBookCopyModal.copyTypeName'))
            .setDesc(t('ui.createBookCopyModal.snapshotDesc'))
            .addDropdown(dropdown => {
                dropdown.addOption('submission-snapshot', t('ui.createBookCopyModal.snapshotOption'))
                    .addOption('working-draft', t('ui.createBookCopyModal.workingDraftOption'))
                    .setValue(kind)
                    .onChange(value => {
                        const previousDefault = kind === 'submission-snapshot' ? 'Submission snapshot' : this.workingDraftName;
                        kind = value === 'working-draft' ? 'working-draft' : 'submission-snapshot';
                        if (name === previousDefault) {
                            name = kind === 'submission-snapshot' ? 'Submission snapshot' : this.workingDraftName;
                            nameInput.setValue(name);
                        }
                        typeSetting.setDesc(kind === 'submission-snapshot'
                            ? t('ui.createBookCopyModal.snapshotDesc')
                            : t('ui.createBookCopyModal.workingDraftDesc'));
                        switchSetting.settingEl.toggle(kind === 'working-draft');
                        updatePreview();
                    });
            });
        const nameSetting = new Setting(form).setName(t('ui.createBookCopyModal.copyNameName')).setDesc(t('ui.createBookCopyModal.copyNameDesc'));
        nameSetting.addText(text => {
            nameInput = text;
            text.setValue(name).onChange(value => { name = value; updatePreview(); });
        });
        const switchSetting = new Setting(form).setName(t('ui.createBookCopyModal.switchName')).setDesc(t('ui.createBookCopyModal.switchDesc'))
            .addToggle(toggle => toggle.setValue(false).onChange(value => { switchToCopy = value; }));
        switchSetting.settingEl.toggle(false);
        form.createDiv({ cls: 'setting-item-description', text: t('ui.createBookCopyModal.preservedNote') });
        updatePreview();
        const actions = this.mountActions();
        const cancel = new ButtonComponent(actions).setButtonText(t('common.cancel')).onClick(() => this.close());
        const create = new ButtonComponent(actions).setButtonText(t('ui.createBookCopyModal.createButton')).setCta().onClick(async () => {
            if (busy) return;
            busy = true;
            create.setDisabled(true);
            cancel.setDisabled(true);
            try {
                if (await this.onSubmit({ name: name.trim(), kind, switchToCopy: kind === 'working-draft' && switchToCopy })) this.close();
            } finally {
                busy = false;
                create.setDisabled(false);
                cancel.setDisabled(false);
            }
        });
    }
}
