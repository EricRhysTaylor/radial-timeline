import { App, ButtonComponent, Modal, Notice } from 'obsidian';
import { t } from '../i18n';
import { ERT_CLASSES } from '../ui/classes';
import { hasBeatReadableText, normalizeBeatSetNameInput } from '../utils/beatsInputNormalize';
import { scheduleFocusAfterPaint } from '../utils/domFocus';

/** Edit custom system details modal (name + description). */
export class SystemEditModal extends Modal {
    private initialName: string;
    private initialDesc: string;
    private onSubmit: (name: string, description: string) => Promise<boolean>;

    constructor(app: App, initialName: string, initialDesc: string, onSubmit: (name: string, description: string) => Promise<boolean>) {
        super(app);
        this.initialName = initialName;
        this.initialDesc = initialDesc;
        this.onSubmit = onSubmit;
    }

    onOpen() {
        const { contentEl, modalEl } = this;
        contentEl.empty();

        if (modalEl) {
            modalEl.classList.add('ert-ui', 'ert-scope--modal', 'ert-modal-shell');
            modalEl.setCssStyles({ width: '480px', maxWidth: '92vw' }); // SAFE: Modal sizing via inline styles (Obsidian pattern)
        }
        contentEl.addClass('ert-modal-container', 'ert-stack');

        const header = contentEl.createDiv({ cls: 'ert-modal-header' });
        header.createSpan({ cls: 'ert-modal-badge', text: t('settings.beats.systemEditModal.badge') });
        header.createDiv({ cls: 'ert-modal-title', text: t('settings.beats.systemEditModal.title') });
        header.createDiv({ cls: 'ert-modal-subtitle', text: t('settings.beats.systemEditModal.subtitle') });

        const formStack = contentEl.createDiv({ cls: ERT_CLASSES.STACK });

        // Name input
        const nameLabel = formStack.createDiv({ cls: 'ert-field-label', text: t('settings.beats.systemEditModal.nameLabel') });
        nameLabel.setAttribute('id', 'sys-name-label');
        const nameInput = formStack.createEl('input', {
            type: 'text',
            value: this.initialName,
            cls: 'ert-input ert-input--full'
        });
        nameInput.setAttr('placeholder', t('settings.beats.systemEditModal.namePlaceholder'));
        nameInput.setAttr('aria-labelledby', 'sys-name-label');

        // Description textarea
        const descLabel = formStack.createDiv({ cls: 'ert-field-label', text: t('settings.beats.systemEditModal.descLabel') });
        descLabel.setAttribute('id', 'sys-desc-label');
        const descInput = formStack.createEl('textarea', {
            cls: 'ert-input ert-input--full ert-textarea'
        });
        descInput.value = this.initialDesc;
        descInput.setAttr('placeholder', t('settings.beats.systemEditModal.descPlaceholder'));
        descInput.setAttr('rows', '4');
        descInput.setAttr('aria-labelledby', 'sys-desc-label');

        scheduleFocusAfterPaint(nameInput, { selectText: true });

        const buttonRow = contentEl.createDiv({ cls: 'ert-modal-actions' });
        const save = async () => {
            const name = normalizeBeatSetNameInput(nameInput.value, '');
            if (!name || !hasBeatReadableText(name)) {
                new Notice(t('settings.beats.systemEditModal.nameRequiredNotice'));
                return;
            }
            const shouldClose = await this.onSubmit(name, descInput.value.trim());
            if (shouldClose) this.close();
        };

        new ButtonComponent(buttonRow).setButtonText(t('settings.beats.systemEditModal.saveText')).setCta().onClick(() => { void save(); });
        new ButtonComponent(buttonRow).setButtonText(t('settings.beats.systemEditModal.cancelText')).onClick(() => this.close());

        nameInput.addEventListener('keydown', (evt: KeyboardEvent) => { // SAFE: direct addEventListener; Modal lifecycle manages cleanup
            if (evt.key === 'Enter') { evt.preventDefault(); void save(); }
        });
    }

    onClose() { this.contentEl.empty(); }
}
