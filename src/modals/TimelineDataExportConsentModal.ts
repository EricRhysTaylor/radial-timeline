/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 */

import { App, ButtonComponent, Modal, ToggleComponent } from 'obsidian';
import { scheduleClassAfterPaint } from '../utils/domClassEffects';
import { scheduleFocusAfterPaint } from '../utils/domFocus';
import { t } from '../i18n';
import { TIMELINE_COMMUNITY_EXPORT_FOLDER } from '../services/export/TimelineExportService';

/**
 * Author's choice from the timeline data export consent dialog.
 * `genericSubplotNames` feeds `TimelineExportRenderConfig`'s equivalent
 * export-time option (see TimelineExportService.exportDataJson).
 */
export interface TimelineDataExportChoice {
    genericSubplotNames: boolean;
}

/**
 * Consent dialog shown before the "Export timeline data (JSON)" command
 * writes a file. Per Amendment 1's consent flow (§1 Export): states what the
 * file contains — structural fields visible immediately once a share is
 * activated, and revealing fields held for later per-scene reveal — and
 * offers the generic-ring-names toggle for authors whose subplot names would
 * themselves be spoilers. Nothing is uploaded or shared by this dialog; it
 * only gates the local file write.
 */
export class TimelineDataExportConsentModal extends Modal {
    private genericSubplotNames = false;

    constructor(app: App, private readonly onChoose: (choice: TimelineDataExportChoice) => Promise<void> | void) {
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
        header.createSpan({ cls: 'ert-modal-badge', text: t('timelineDataExportModal.badge') });
        header.createDiv({ cls: 'ert-modal-title', text: t('timelineDataExportModal.title') });
        header.createDiv({ cls: 'ert-modal-subtitle', text: t('timelineDataExportModal.subtitle') });

        const structural = contentEl.createDiv({ cls: 'ert-glass-card ert-sub-card' });
        structural.createDiv({ cls: 'ert-sub-card-head', text: t('timelineDataExportModal.structuralHeading') });
        structural.createDiv({ cls: 'ert-sub-card-note', text: t('timelineDataExportModal.structuralBody') });

        const revealing = contentEl.createDiv({ cls: 'ert-glass-card ert-sub-card' });
        revealing.createDiv({ cls: 'ert-sub-card-head', text: t('timelineDataExportModal.revealingHeading') });
        revealing.createDiv({ cls: 'ert-sub-card-note', text: t('timelineDataExportModal.revealingBody') });

        const toggleCard = contentEl.createDiv({ cls: 'ert-glass-card ert-sub-card' });
        const toggleRow = toggleCard.createDiv({ cls: 'ert-manuscript-toggle-row' });
        toggleRow.createSpan({ cls: 'ert-manuscript-toggle-label', text: t('timelineDataExportModal.genericNamesToggleLabel') });
        new ToggleComponent(toggleRow)
            .setValue(this.genericSubplotNames)
            .onChange((value) => {
                this.genericSubplotNames = value;
            });
        toggleCard.createDiv({ cls: 'ert-sub-card-note', text: t('timelineDataExportModal.genericNamesToggleDescription') });

        // Name the destination in the dialog that authorizes the write, so the
        // author knows where the file lands before they consent to it.
        contentEl.createDiv({
            cls: 'ert-sub-card-note',
            text: t('timelineDataExportModal.destinationBody', { path: TIMELINE_COMMUNITY_EXPORT_FOLDER }),
        });

        const actions = contentEl.createDiv({ cls: 'ert-modal-actions' });
        new ButtonComponent(actions)
            .setButtonText(t('timelineDataExportModal.cancelButton'))
            .onClick(() => this.close());
        const exportButton = new ButtonComponent(actions)
            .setButtonText(t('timelineDataExportModal.exportButton'))
            .setCta()
            .onClick(() => {
                void this.handleExport();
            });

        scheduleFocusAfterPaint(exportButton.buttonEl);
    }

    onClose(): void {
        this.contentEl.empty();
    }

    private async handleExport(): Promise<void> {
        const choice: TimelineDataExportChoice = { genericSubplotNames: this.genericSubplotNames };
        this.close();
        await this.onChoose(choice);
    }
}
