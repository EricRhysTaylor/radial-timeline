import { App, ButtonComponent, Setting, type TextComponent } from 'obsidian';
import { ErtModal } from '../ui/ErtModal';
import type { BookCopyKind } from '../utils/draftBook';

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
        header.createDiv({ cls: 'ert-modal-title', text: 'Create book copy' });
        header.createDiv({ cls: 'ert-modal-subtitle', text: 'Copy this book into a sibling folder. Both copy types stay out of the saga until you include them.' });
        const form = this.contentEl.createDiv({ cls: 'ert-stack' });
        let kind: BookCopyKind = 'submission-snapshot';
        let name = 'Submission snapshot';
        let switchToCopy = false;
        let busy = false;
        let nameInput: TextComponent;
        const preview = form.createDiv({ cls: 'setting-item-description' });
        const updatePreview = () => preview.setText(`Destination: ${this.resolveDestination(name.trim())}`);
        const typeSetting = new Setting(form)
            .setName('Copy type')
            .setDesc('Preserve this version while you continue editing the original.')
            .addDropdown(dropdown => {
                dropdown.addOption('submission-snapshot', 'Submission snapshot')
                    .addOption('working-draft', 'Working draft')
                    .setValue(kind)
                    .onChange(value => {
                        const previousDefault = kind === 'submission-snapshot' ? 'Submission snapshot' : this.workingDraftName;
                        kind = value === 'working-draft' ? 'working-draft' : 'submission-snapshot';
                        if (name === previousDefault) {
                            name = kind === 'submission-snapshot' ? 'Submission snapshot' : this.workingDraftName;
                            nameInput.setValue(name);
                        }
                        typeSetting.setDesc(kind === 'submission-snapshot'
                            ? 'Preserve this version while you continue editing the original.'
                            : 'Start an editable alternative version of this book.');
                        switchSetting.settingEl.toggle(kind === 'working-draft');
                        updatePreview();
                    });
            });
        const nameSetting = new Setting(form).setName('Copy name').setDesc('Use the suggested suffix or enter your own.');
        nameSetting.addText(text => {
            nameInput = text;
            text.setValue(name).onChange(value => { name = value; updatePreview(); });
        });
        const switchSetting = new Setting(form).setName('Switch to working draft').setDesc('Make the copy active after creation.')
            .addToggle(toggle => toggle.setValue(false).onChange(value => { switchToCopy = value; }));
        switchSetting.settingEl.toggle(false);
        form.createDiv({ cls: 'setting-item-description', text: 'Scene IDs and note text, including links, are preserved. The original remains unchanged.' });
        updatePreview();
        const actions = this.mountActions();
        const cancel = new ButtonComponent(actions).setButtonText('Cancel').onClick(() => this.close());
        const create = new ButtonComponent(actions).setButtonText('Create copy').setCta().onClick(async () => {
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
