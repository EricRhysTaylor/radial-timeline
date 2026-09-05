/*
 * Radial Timeline Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 */

import { App, ButtonComponent, Notice } from 'obsidian';
import { ErtModal, type ErtModalShellOptions } from './ErtModal';
import { scheduleFocusAfterPaint } from '../utils/domFocus';

export interface NamePromptModalOptions {
    title: string;
    subtitle?: string;
    /** Badge text above the title; no badge when absent. */
    badge?: string;
    initialValue: string;
    placeholder?: string;
    actionLabel: string;
    /** Notice shown when the trimmed value is empty. */
    emptyNotice: string;
    /** Return false to keep the modal open; the caller has already told the author why. */
    onSubmit: (value: string) => Promise<boolean | void> | boolean | void;
    /** Shell sizing; defaults to a 420px modal. */
    shell?: ErtModalShellOptions;
}

/**
 * One text field, one primary action, Enter submits, Cancel closes.
 * The single prompt for naming and renaming things.
 */
export class NamePromptModal extends ErtModal {
    private readonly options: NamePromptModalOptions;

    constructor(app: App, options: NamePromptModalOptions) {
        super(app);
        this.options = options;
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();
        this.applyShell(this.options.shell ?? { width: '420px' });
        this.mountHeader({
            title: this.options.title,
            subtitle: this.options.subtitle,
            badge: this.options.badge ? { text: this.options.badge } : undefined
        });

        const inputContainer = contentEl.createDiv({ cls: 'ert-search-input-container' });
        const inputEl = inputContainer.createEl('input', {
            type: 'text',
            value: this.options.initialValue,
            cls: 'ert-input ert-input--full'
        });
        if (this.options.placeholder) inputEl.setAttr('placeholder', this.options.placeholder);
        scheduleFocusAfterPaint(inputEl, { selectText: true });

        const submit = async () => {
            const value = inputEl.value.trim();
            if (!value) {
                new Notice(this.options.emptyNotice);
                return;
            }
            const keepOpen = (await this.options.onSubmit(value)) === false;
            if (!keepOpen) this.close();
        };

        const actions = this.mountActions();
        new ButtonComponent(actions).setButtonText(this.options.actionLabel).setCta().onClick(() => { void submit(); });
        new ButtonComponent(actions).setButtonText('Cancel').onClick(() => this.close());

        inputEl.addEventListener('keydown', (evt: KeyboardEvent) => { // SAFE: direct addEventListener; Modal lifecycle manages cleanup
            if (evt.key === 'Enter') {
                evt.preventDefault();
                void submit();
            }
        });
    }

    onClose(): void {
        this.contentEl.empty();
    }
}
