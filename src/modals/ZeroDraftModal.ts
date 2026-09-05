/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 */
import { App, Modal, ButtonComponent } from 'obsidian';

/**
 * ZeroDraftModal presents a large textarea for editing the "Pending Edits" field.
 * OK overwrites the field (with delete-confirm if clearing). Cancel/Override confirm discards when dirty.
 */
export class ZeroDraftModal extends Modal {
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
                .setButtonText('Cancel')
                .onClick(() => {
                    modal.close();
                    resolve(false);
                });

            modal.open();
        });
    }

    onOpen(): void {
        const { contentEl, titleEl, modalEl } = this;
        titleEl.setText('');
        
        if (modalEl) {
            modalEl.classList.add('ert-ui', 'ert-scope--modal', 'ert-modal-shell');
            modalEl.setCssStyles({ width: '680px', maxWidth: '92vw' }); // SAFE: Modal sizing via inline styles (Obsidian pattern)
        }
        contentEl.addClass('ert-modal-container', 'ert-stack');

        // Header
        const header = contentEl.createDiv({ cls: 'ert-modal-header' });
        header.createSpan({ cls: 'ert-modal-badge', text: 'Zero Draft' });
        header.createDiv({ cls: 'ert-modal-title', text: this.titleText });
        header.createDiv({ cls: 'ert-modal-subtitle', text: 'Enter Pending Edits below, or click Override to open the note directly.' });

        // Info note
        const infoEl = contentEl.createDiv({ cls: 'ert-field-note' });
        infoEl.setText('Zero draft mode is enabled. This scene has Progress Stage = Zero and Status = Complete. You can turn this off in Settings → Zero draft mode.');

        // Textarea
        const textareaRow = contentEl.createDiv({ cls: 'ert-row ert-row--stack' });
        textareaRow.createDiv({ cls: 'ert-label', text: 'Pending edits' });
        const textareaControl = textareaRow.createDiv({ cls: 'ert-control' });
        this.textareaEl = textareaControl.createEl('textarea', { cls: 'ert-textarea' });
        this.textareaEl.value = this.originalText;

        // Buttons container
        const buttonRow = contentEl.createDiv({ cls: 'ert-modal-actions' });

        // OK button
        new ButtonComponent(buttonRow)
            .setButtonText('Save')
            .setCta()
            .onClick(async () => {
                const next = (this.textareaEl.value || '').trim();
                // If we are clearing existing non-empty content, confirm deletion
                if (this.originalText.length > 0 && next.length === 0) {
                    const confirmed = await this.confirmAction({
                        badge: 'Warning',
                        title: 'Delete pending edits?',
                        subtitle: 'This will remove all previous text.',
                        confirmText: 'Delete',
                        confirmWarning: true
                    });
                    if (!confirmed) return; // Do not close or write
                }
                // Proceed with write
                const written = await this.onOk(next);
                if (written !== false) {
                    this.close();
                }
            });

        // Override button
        new ButtonComponent(buttonRow)
            .setButtonText('Override')
            .setDestructive()
            .onClick(async () => {
                const current = (this.textareaEl.value || '').trim();
                const isDirty = current !== this.originalText;
                if (isDirty) {
                    const discard = await this.confirmAction({
                        badge: 'Warning',
                        title: 'Discard changes?',
                        subtitle: 'Unsaved edits will be lost.',
                        confirmText: 'Discard',
                        confirmWarning: true
                    });
                    if (!discard) return;
                }
                // Open note without saving
                this.onOverride();
                this.close();
            });

        // Cancel button
        new ButtonComponent(buttonRow)
            .setButtonText('Cancel')
            .onClick(async () => {
                const current = (this.textareaEl.value || '').trim();
                const isDirty = current !== this.originalText;
                if (isDirty) {
                    const discard = await this.confirmAction({
                        badge: 'Warning',
                        title: 'Discard changes?',
                        subtitle: 'Unsaved edits will be lost.',
                        confirmText: 'Discard',
                        confirmWarning: true
                    });
                    if (!discard) return;
                }
                this.close();
            });
    }
}

export default ZeroDraftModal;
