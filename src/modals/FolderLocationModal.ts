/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 */
import { App, ButtonComponent, normalizePath } from 'obsidian';
import { ErtModal } from '../ui/ErtModal';
import { ModalFolderSuggest } from '../settings/FolderSuggest';
import { revealFolderInExplorer } from '../settings/pathChip';
import { replayTransientClass } from '../utils/domClassEffects';

export interface FolderLocationOptions {
    title: string;
    description?: string;
    /** Current folder path ('' when unset). */
    value: string;
    /** Default folder shown as placeholder; saving an empty field falls back to it. */
    placeholder: string;
    /** Return an error message to reject the path, or null to accept. */
    validate?: (normalized: string) => string | null;
    /** Receives the normalized path ('' means "reset to default" — caller decides). */
    onSave: (normalized: string) => Promise<void> | void;
}

/**
 * Location picker modal for folder settings. Keeps settings rows clean —
 * the row shows only a path chip; clicking it opens this modal with a
 * large autocomplete input (same vault-folder intelligence as inline
 * fields) plus validation and a reveal-in-explorer action.
 */
export class FolderLocationModal extends ErtModal {
    constructor(app: App, private readonly options: FolderLocationOptions) {
        super(app);
    }

    onOpen(): void {
        this.contentEl.empty();
        this.applyShell({ size: 'md' });
        this.mountHeader({
            title: this.options.title,
            subtitle: this.options.description,
        });

        const body = this.contentEl.createDiv({ cls: 'ert-stack' });
        const input = body.createEl('input', {
            type: 'text',
            cls: 'ert-input ert-input--full',
            attr: { placeholder: this.options.placeholder, spellcheck: 'false' },
        });
        input.value = this.options.value;

        const errorEl = body.createDiv({ cls: 'ert-section-desc ert-section-desc--alert' });

        const clearError = () => {
            errorEl.setText('');
        };
        const showError = (message: string) => {
            errorEl.setText(message);
            replayTransientClass(input, 'ert-input--flash-error', { durationMs: 1700 });
        };

        const save = async () => {
            clearError();
            const trimmed = input.value.trim();
            const normalized = trimmed ? normalizePath(trimmed) : '';
            const error = normalized ? this.options.validate?.(normalized) ?? null : null;
            if (error) {
                showError(error);
                return;
            }
            await this.options.onSave(normalized);
            this.close();
        };

        new ModalFolderSuggest(this.app, input, () => clearError());
        input.addEventListener('input', clearError);
        input.addEventListener('keydown', (evt: KeyboardEvent) => {
            if (evt.key === 'Enter') {
                evt.preventDefault();
                void save();
            }
        });

        const actions = this.mountActions();

        const revealButton = new ButtonComponent(actions)
            .setButtonText('Reveal in file explorer')
            .onClick(() => {
                this.close();
                revealFolderInExplorer(this.app, this.options.value || this.options.placeholder);
            });
        revealButton.buttonEl.addClass('ert-btn', 'ert-btn--standard-pro');

        const cancelButton = new ButtonComponent(actions)
            .setButtonText('Cancel')
            .onClick(() => this.close());
        cancelButton.buttonEl.addClass('ert-btn', 'ert-btn--standard-pro');

        new ButtonComponent(actions)
            .setButtonText('Save')
            .setCta()
            .onClick(() => { void save(); });

        window.setTimeout(() => { input.focus(); input.select(); }, 0);
    }

    onClose(): void {
        this.contentEl.empty();
    }
}
