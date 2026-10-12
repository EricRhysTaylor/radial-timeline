import { t } from '../../i18n';

export type InquiryEngineActionButtons = {
    settingsButton: HTMLButtonElement;
    logButton: HTMLButtonElement;
};

export function createInquiryEngineActionButtons(container: HTMLElement): InquiryEngineActionButtons {
    const actionsRow = container.createDiv({ cls: 'ert-inquiry-engine-actions' });

    const settingsButton = actionsRow.createEl('button', {
        cls: 'ert-inquiry-engine-action-button',
        text: t('ui.inquiryEngineDom.openAiSettings'),
        attr: { type: 'button' }
    });

    const logButton = actionsRow.createEl('button', {
        cls: 'ert-inquiry-engine-action-button',
        text: t('ui.inquiryEngineDom.openInquiryLog'),
        attr: { type: 'button' }
    });

    return {
        settingsButton,
        logButton
    };
}
