/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 */

import { App, ButtonComponent, Modal } from 'obsidian';
import { scheduleClassAfterPaint } from '../utils/domClassEffects';
import { scheduleFocusAfterPaint } from '../utils/domFocus';
import type { TimelineImageFormat } from '../services/export/TimelineExportService';

export interface TimelineImageExportChoice {
    format: TimelineImageFormat;
    scale: number;
}

interface ExportOption {
    title: string;
    description: string;
    choice: TimelineImageExportChoice;
}

const EXPORT_OPTIONS: ExportOption[] = [
    {
        title: 'SVG (vector)',
        description: 'Self-contained vector file — sharp at any size, styles inlined.',
        choice: { format: 'svg', scale: 1 },
    },
    {
        title: 'PNG · 1x',
        description: 'Raster image at the on-screen resolution.',
        choice: { format: 'png', scale: 1 },
    },
    {
        title: 'PNG · 2x',
        description: 'Double-resolution raster for crisp display and social posts.',
        choice: { format: 'png', scale: 2 },
    },
    {
        title: 'PNG · 4x',
        description: 'High-resolution raster for print or large marketing stills.',
        choice: { format: 'png', scale: 4 },
    },
];

export class TimelineImageExportModal extends Modal {
    constructor(app: App, private readonly onChoose: (choice: TimelineImageExportChoice) => Promise<void> | void) {
        super(app);
    }

    onOpen(): void {
        const { contentEl, modalEl, titleEl } = this;
        titleEl?.setText('');

        if (modalEl) {
            modalEl.classList.add('ert-ui', 'ert-scope--modal', 'ert-modal-shell', 'ert-modal-shell--md');
            modalEl.classList.remove('is-ui-settled');
            scheduleClassAfterPaint(modalEl, 'is-ui-settled');
        }

        contentEl.addClass('ert-modal-container', 'ert-stack');
        const header = contentEl.createDiv({ cls: 'ert-modal-header' });
        header.createSpan({ cls: 'ert-modal-badge', text: 'Export' });
        header.createDiv({ cls: 'ert-modal-title', text: 'Export timeline as image' });
        header.createDiv({
            cls: 'ert-modal-subtitle',
            text: 'Exports the currently rendered timeline. Choose a format and resolution.',
        });

        const panel = contentEl.createDiv({ cls: 'ert-panel ert-panel--glass ert-stack' });
        const grid = panel.createDiv({ cls: 'ert-note-creator-grid' });
        for (const option of EXPORT_OPTIONS) {
            const button = grid.ownerDocument.createElement('button');
            button.className = 'ert-modal-choice ert-note-creator-option';
            button.type = 'button';
            const body = button.createDiv({ cls: 'ert-note-creator-option__body' });
            body.createDiv({ cls: 'ert-note-creator-option__title', text: option.title });
            body.createDiv({ cls: 'ert-note-creator-option__desc', text: option.description });
            button.addEventListener('click', () => {
                void this.handleChoice(option.choice);
            });
            grid.appendChild(button);
        }

        const actions = contentEl.createDiv({ cls: 'ert-modal-actions' });
        new ButtonComponent(actions)
            .setButtonText('Cancel')
            .onClick(() => this.close());

        const firstOption = grid.querySelector<HTMLButtonElement>('.ert-note-creator-option');
        if (firstOption) {
            scheduleFocusAfterPaint(firstOption);
        }
    }

    onClose(): void {
        this.contentEl.empty();
    }

    private async handleChoice(choice: TimelineImageExportChoice): Promise<void> {
        this.close();
        await this.onChoose(choice);
    }
}
