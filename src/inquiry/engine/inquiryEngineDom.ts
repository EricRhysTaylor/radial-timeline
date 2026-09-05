export type InquiryEngineActionButtons = {
    settingsButton: HTMLButtonElement;
    logButton: HTMLButtonElement;
};

export function createInquiryEngineActionButtons(container: HTMLElement): InquiryEngineActionButtons {
    const actionsRow = container.createDiv({ cls: 'ert-inquiry-engine-actions' });

    const settingsButton = actionsRow.createEl('button', {
        cls: 'ert-inquiry-engine-action-button',
        text: 'Open AI settings',
        attr: { type: 'button' }
    });

    const logButton = actionsRow.createEl('button', {
        cls: 'ert-inquiry-engine-action-button',
        text: 'Open Inquiry Log',
        attr: { type: 'button' }
    });

    return {
        settingsButton,
        logButton
    };
}
