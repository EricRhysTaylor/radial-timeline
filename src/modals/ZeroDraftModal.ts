/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 */
import { App, Modal, ButtonComponent } from 'obsidian';
import { t } from '../i18n';
import { ErtModal } from '../ui/ErtModal';
import { scheduleFocusAfterPaint } from '../utils/domFocus';
import { setAccessibleLabel, setTooltip } from '../utils/domTooltip';

/**
 * ZeroDraftModal shows a scene's current "Pending Edits" read-only and takes new ones.
 * Save appends the new text to the field; it never rewrites what is already there.
 * Cancel/Override confirm a discard when new text has been typed.
 */
export class ZeroDraftModal extends ErtModal {
    private readonly bookTitle: string;
    private readonly sceneTitle: string;
    private readonly currentEdits: string;
    private readonly onSave: (addition: string) => Promise<boolean>;
    private readonly onOverride: () => void;

    private textareaEl!: HTMLTextAreaElement;

    constructor(
        app: App,
        options: {
            bookTitle: string;
            sceneTitle: string;
            currentEdits: string;
            onSave: (addition: string) => Promise<boolean>;
            onOverride: () => void;
        }
    ) {
        super(app);
        this.bookTitle = options.bookTitle;
        this.sceneTitle = options.sceneTitle;
        this.currentEdits = options.currentEdits.trim();
        this.onSave = options.onSave;
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

    private newText(): string {
        return (this.textareaEl.value || '').trim();
    }

    /** Resolves true when nothing new was typed, or the author agrees to discard it. */
    private async confirmDiscardIfDirty(): Promise<boolean> {
        if (!this.newText()) return true;
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
        this.mountHeader({
            badge: { text: t('ui.zeroDraftModal.badge', { title: this.bookTitle }) },
            title: this.sceneTitle
        });

        // The scene's existing Pending Edits, read-only, so new edits are written in context.
        const current = this.contentEl.createDiv({ cls: 'ert-zero-draft-current' });
        if (this.currentEdits) {
            current.createDiv({ cls: 'ert-zero-draft-current__label', text: t('ui.zeroDraftModal.currentLabel') });
            current.createDiv({ cls: 'ert-zero-draft-current__text', text: this.currentEdits });
        } else {
            current.createDiv({ cls: 'ert-zero-draft-current__text is-empty', text: t('ui.zeroDraftModal.currentEmpty') });
        }

        this.textareaEl = this.contentEl.createEl('textarea', { cls: 'ert-textarea ert-textarea--prose' });
        this.textareaEl.placeholder = t('ui.zeroDraftModal.newEditsLabel');
        setAccessibleLabel(this.textareaEl, t('ui.zeroDraftModal.newEditsLabel'));
        scheduleFocusAfterPaint(this.textareaEl);

        const actions = this.mountActions();

        // Override opens the note without saving; it sits apart from the rest.
        new ButtonComponent(actions)
            .setButtonText(t('ui.zeroDraftModal.overrideButton'))
            .setDestructive()
            .onClick(async () => {
                if (!(await this.confirmDiscardIfDirty())) return;
                this.onOverride();
                this.close();
            });
        actions.createDiv({ cls: 'ert-modal-actions-spacer' });

        // How the modal works lives on hover, not in the body.
        const help = actions.createEl('button', { cls: 'ert-iconBtn ert-zero-draft-help', text: '?' });
        setAccessibleLabel(help, t('ui.zeroDraftModal.helpLabel'));
        setTooltip(help, t('ui.zeroDraftModal.helpTooltip'), { placement: 'top' });

        new ButtonComponent(actions)
            .setButtonText(t('common.cancel'))
            .onClick(async () => {
                if (!(await this.confirmDiscardIfDirty())) return;
                this.close();
            });

        const saveBtn = new ButtonComponent(actions)
            .setButtonText(t('common.save'))
            .setCta()
            .setDisabled(true)
            .onClick(async () => {
                const addition = this.newText();
                if (!addition) return;
                if (await this.onSave(addition)) this.close();
            });
        this.textareaEl.addEventListener('input', () => { saveBtn.setDisabled(!this.newText()); });
    }
}

export default ZeroDraftModal;
