import { App, ButtonComponent, Modal } from 'obsidian';

/** Shared confirmation lifecycle; closing via Escape or the window always cancels. */
export function confirmAudit(app: App, options: {
    badge: string;
    title: string;
    subtitle: string;
    scope: string;
    action: string;
    renderBody: (body: HTMLElement) => void;
}): Promise<boolean> {
    return new Promise(resolve => {
        const modal = new Modal(app);
        modal.titleEl.setText('');
        modal.contentEl.empty();
        modal.modalEl.classList.add('ert-ui', 'ert-scope--modal', 'ert-modal-shell', 'ert-modal-shell--md');
        modal.contentEl.addClass('ert-modal-container', 'ert-stack');
        const header = modal.contentEl.createDiv({ cls: 'ert-modal-header' });
        header.createSpan({ cls: 'ert-modal-badge', text: options.badge });
        header.createDiv({ cls: 'ert-modal-title', text: options.title });
        header.createDiv({ cls: 'ert-modal-subtitle', text: options.subtitle });
        const body = modal.contentEl.createDiv({ cls: ['ert-panel', 'ert-panel--glass'] });
        body.createDiv({ text: `Scope: ${options.scope}`, cls: 'ert-modal-subtitle' });
        options.renderBody(body);
        const footer = modal.contentEl.createDiv({ cls: 'ert-modal-actions' });
        new ButtonComponent(footer).setButtonText(options.action).setCta().onClick(() => { resolve(true); modal.close(); });
        new ButtonComponent(footer).setButtonText('Cancel').onClick(() => { resolve(false); modal.close(); });
        modal.onClose = () => resolve(false);
        modal.open();
    });
}
