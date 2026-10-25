/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 */
import { App, Modal, ButtonComponent } from 'obsidian';
import { t } from '../i18n';
import { ErtModal } from '../ui/ErtModal';
import { scheduleFocusAfterPaint } from '../utils/domFocus';
import { setAccessibleLabel } from '../utils/domTooltip';

/**
 * ZeroDraftModal presents a large textarea for editing the "Pending Edits" field.
 * OK overwrites the field (with delete-confirm if clearing). Cancel/Override confirm discards when dirty.
 */
export class ZeroDraftModal extends ErtModal {
    private readonly titleText: string;
    private readonly originalText: string;
    private readonly onOk: (nextText: string) => Promise<boolean> | boolean;
    private readonly onOverride: () => void;

    private textareaEl!: HTMLTextAreaElement;

    constructor(
        app: App,
        options: {
            titleText: string;
            initialText: string;
            onOk: (nextText: string) => Promise<boolean> | boolean;
            onOverride: () => void;
        }
    ) {
        super(app);
        this.titleText = options.titleText;
        this.originalText = (options.initialText || '').trim();
        this.onOk = options.onOk;
        this.onOverride = options.onOverride;
    }

    private async confirmAction(options: {
        badge?: string;
        title: string;
        subtitle?: string;
        confirmText: string;
        confirmWarning?: boolean;
    }): Promise<boolean> {
        return await new Promise<boolean>((resolve) => {
            const modal = new Modal(this.app);
            const { modalEl, contentEl } = modal;
            modal.titleEl.setText('');
            contentEl.empty();

            if (modalEl) {
                modalEl.classList.add('ert-ui', 'ert-scope--modal', 'ert-modal-shell', 'ert-modal-shell--sm');
            }
            contentEl.addClass('ert-modal-container', 'ert-stack');

            const header = contentEl.createDiv({ cls: 'ert-modal-header' });
            if (options.badge) {
                header.createSpan({ text: options.badge, cls: 'ert-modal-badge' });
            }
            header.createDiv({ text: options.title, cls: 'ert-modal-title' });
            if (options.subtitle) {
                header.createDiv({ text: options.subtitle, cls: 'ert-modal-subtitle' });
            }

            const actionsRow = contentEl.createDiv({ cls: 'ert-modal-actions' });
            const confirmBtn = new ButtonComponent(actionsRow)
                .setButtonText(options.confirmText);
            if (options.confirmWarning) {
                confirmBtn.setDestructive();
            } else {
                confirmBtn.setCta();
            }
            confirmBtn.onClick(() => {
                modal.close();
                resolve(true);
            });

            new ButtonComponent(actionsRow)
                .setButtonText(t('common.cancel'))
                .onClick(() => {
                    modal.close();
                    resolve(false);
                });

            modal.open();
        });
    }

    /** Resolves true when there is nothing to lose, or the author agrees to discard their edits. */
    private async confirmDiscardIfDirty(): Promise<boolean> {
        const current = (this.textareaEl.value || '').trim();
        if (current === this.originalText) return true;
        return await this.confirmAction({
            badge: t('ui.zeroDraftModal.warningBadge'),
            title: t('ui.zeroDraftModal.discardTitle'),
            subtitle: t('ui.zeroDraftModal.discardSubtitle'),
            confirmText: t('ui.zeroDraftModal.discardButton'),
            confirmWarning: true
        });
    }

    onOpen(): void {
        this.contentEl.empty();
        this.applyShell();
        // The scene is the title; the badge and subtitle already say this is Pending Edits.
        const header = this.mountHeader({
            badge: { text: t('ui.zeroDraftModal.badge') },
            title: this.titleText,
            subtitle: t('ui.zeroDraftModal.subtitle')
        });
        header.createDiv({ cls: 'ert-field-note', text: t('ui.zeroDraftModal.infoNote') });

        this.textareaEl = this.contentEl.createEl('textarea', { cls: 'ert-textarea ert-textarea--prose' });
        setAccessibleLabel(this.textareaEl, t('ui.zeroDraftModal.pendingEditsLabel'));
        this.textareaEl.value = this.originalText;
        scheduleFocusAfterPaint(this.textareaEl);

        const actions = this.mountActions();

        // Override opens the note without saving; it sits apart from Cancel/Save.
        new ButtonComponent(actions)
            .setButtonText(t('ui.zeroDraftModal.overrideButton'))
            .setDestructive()
            .onClick(async () => {
                if (!(await this.confirmDiscardIfDirty())) return;
                this.onOverride();
                this.close();
            });
        actions.createDiv({ cls: 'ert-modal-actions-spacer' });

        new ButtonComponent(actions)
            .setButtonText(t('common.cancel'))
            .onClick(async () => {
                if (!(await this.confirmDiscardIfDirty())) return;
                this.close();
            });

        new ButtonComponent(actions)
            .setButtonText(t('common.save'))
            .setCta()
            .onClick(async () => {
                const next = (this.textareaEl.value || '').trim();
                // If we are clearing existing non-empty content, confirm deletion
                if (this.originalText.length > 0 && next.length === 0) {
                    const confirmed = await this.confirmAction({
                        badge: t('ui.zeroDraftModal.warningBadge'),
                        title: t('ui.zeroDraftModal.deleteTitle'),
                        subtitle: t('ui.zeroDraftModal.deleteSubtitle'),
                        confirmText: t('ui.zeroDraftModal.deleteButton'),
                        confirmWarning: true
                    });
                    if (!confirmed) return; // Do not close or write
                }
                const written = await this.onOk(next);
                if (written !== false) {
                    this.close();
                }
            });
    }
}

export default ZeroDraftModal;
