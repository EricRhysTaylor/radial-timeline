import { App, ButtonComponent, setIcon } from 'obsidian';
import { ERT_CLASSES } from '../ui/classes';
import { ErtModal } from '../ui/ErtModal';

export interface ErtConfirmOptions {
    title: string;
    message: string;
    confirmText?: string;
    cancelText?: string;
    badge?: { text: string; icon?: string };
}

class ErtConfirmModal extends ErtModal {
    private resolved = false;

    constructor(
        app: App,
        private readonly options: ErtConfirmOptions,
        private readonly onResolve: (confirmed: boolean) => void
    ) {
        super(app);
    }

    onOpen(): void {
        this.contentEl.empty();
        this.applyShell({ width: 'min(480px, 92vw)' });

        const header = this.contentEl.createDiv({ cls: 'ert-modal-header' });

        if (this.options.badge) {
            const badge = header.createSpan({ cls: ERT_CLASSES.BADGE_PILL });
            if (this.options.badge.icon) {
                const badgeIcon = badge.createSpan({ cls: ERT_CLASSES.BADGE_PILL_ICON });
                setIcon(badgeIcon, this.options.badge.icon);
            }
            badge.createSpan({ cls: ERT_CLASSES.BADGE_PILL_TEXT, text: this.options.badge.text });
        }

        header.createDiv({ cls: 'ert-modal-title', text: this.options.title });
        header.createDiv({ cls: 'ert-modal-subtitle', text: this.options.message });

        const actions = this.mountActions();

        const cancelButton = new ButtonComponent(actions)
            .setButtonText(this.options.cancelText ?? 'Cancel')
            .onClick(() => {
                this.resolved = true;
                this.close();
                this.onResolve(false);
            });
        cancelButton.buttonEl.addClass('ert-btn', 'ert-btn--standard-pro');

        new ButtonComponent(actions)
            .setButtonText(this.options.confirmText ?? 'Continue')
            .setCta()
            .onClick(() => {
                this.resolved = true;
                this.close();
                this.onResolve(true);
            });
    }

    onClose(): void {
        if (!this.resolved) {
            this.resolved = true;
            this.onResolve(false);
        }
        this.contentEl.empty();
    }
}

/**
 * Themed replacement for `window.confirm()` using the ERT modal shell.
 * Resolves true when the user clicks confirm, false on cancel/escape/dismiss.
 */
export function confirmWithErtModal(app: App, options: ErtConfirmOptions): Promise<boolean> {
    return new Promise((resolve) => {
        new ErtConfirmModal(app, options, resolve).open();
    });
}
