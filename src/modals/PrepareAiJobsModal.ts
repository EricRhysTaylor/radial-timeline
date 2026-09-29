/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 *
 * "Prepare AI jobs…": which of the book's AI work to hand to an AI client the
 * author runs themselves. The choices become an AiJobPlan; AiJobsService
 * writes the jobs.
 */

import { App, ButtonComponent, Setting } from 'obsidian';
import { t } from '../i18n';
import { ErtModal } from '../ui/ErtModal';
import type { AiJobScope } from '../ai/jobs/aiJobStore';
import { GOSSAMER_SIGNAL_METADATA, GOSSAMER_SIGNAL_TYPES, type GossamerSignalType } from '../types/gossamerSignals';
import type { AiJobPlan, InquiryJobScope } from '../services/AiJobsService';

const OFF = 'off';
const ALL_SIGNALS = 'all';

export class PrepareAiJobsModal extends ErtModal {
    // A new book's first pass: everything not done yet.
    private summary: AiJobScope | typeof OFF = 'missing';
    private pulse: AiJobScope | typeof OFF = 'missing';
    private gossamer: GossamerSignalType | typeof ALL_SIGNALS | typeof OFF = ALL_SIGNALS;
    private inquiry: InquiryJobScope | typeof OFF = 'missing';

    constructor(
        app: App,
        private readonly bookTitle: string,
        private readonly onPrepare: (plan: AiJobPlan) => void
    ) {
        super(app);
    }

    onOpen(): void {
        this.contentEl.empty();
        this.applyShell({ size: 'md' });
        this.mountHeader({
            badge: { text: t('aiJobs.modal.badge') },
            title: t('aiJobs.modal.title'),
            subtitle: t('aiJobs.modal.subtitle', { book: this.bookTitle })
        });

        const panel = this.contentEl.createDiv({ cls: 'ert-panel ert-panel--glass ert-stack' });

        new Setting(panel)
            .setName(t('aiJobs.features.summary'))
            .setDesc(t('aiJobs.modal.summaryDesc'))
            .addDropdown(dropdown => dropdown
                .addOptions({
                    [OFF]: t('aiJobs.modal.off'),
                    flagged: t('aiJobs.modal.summaryFlagged'),
                    missing: t('aiJobs.modal.summaryMissing'),
                    all: t('aiJobs.modal.allScenes')
                })
                .setValue(this.summary)
                .onChange(value => { this.summary = value as AiJobScope | typeof OFF; }));

        new Setting(panel)
            .setName(t('aiJobs.features.pulse'))
            .setDesc(t('aiJobs.modal.pulseDesc'))
            .addDropdown(dropdown => dropdown
                .addOptions({
                    [OFF]: t('aiJobs.modal.off'),
                    flagged: t('aiJobs.modal.pulseFlagged'),
                    missing: t('aiJobs.modal.pulseMissing'),
                    all: t('aiJobs.modal.allScenes')
                })
                .setValue(this.pulse)
                .onChange(value => { this.pulse = value as AiJobScope | typeof OFF; }));

        const signalOptions: Record<string, string> = { [OFF]: t('aiJobs.modal.off'), [ALL_SIGNALS]: t('aiJobs.modal.allSignals') };
        for (const signal of GOSSAMER_SIGNAL_TYPES) signalOptions[signal] = GOSSAMER_SIGNAL_METADATA[signal].label;
        new Setting(panel)
            .setName(t('aiJobs.features.gossamer'))
            .setDesc(t('aiJobs.modal.gossamerDesc'))
            .addDropdown(dropdown => dropdown
                .addOptions(signalOptions)
                .setValue(this.gossamer)
                .onChange(value => { this.gossamer = value as GossamerSignalType | typeof ALL_SIGNALS | typeof OFF; }));

        new Setting(panel)
            .setName(t('aiJobs.features.inquiry'))
            .setDesc(t('aiJobs.modal.inquiryDesc'))
            .addDropdown(dropdown => dropdown
                .addOptions({
                    [OFF]: t('aiJobs.modal.off'),
                    missing: t('aiJobs.modal.inquiryMissing'),
                    all: t('aiJobs.modal.inquiryAll')
                })
                .setValue(this.inquiry)
                .onChange(value => { this.inquiry = value as InquiryJobScope | typeof OFF; }));

        const actions = this.mountActions();
        new ButtonComponent(actions)
            .setButtonText(t('aiJobs.modal.cancel'))
            .onClick(() => this.close());
        new ButtonComponent(actions)
            .setButtonText(t('aiJobs.modal.prepare'))
            .setCta()
            .onClick(() => {
                this.close();
                this.onPrepare(this.buildPlan());
            });
    }

    onClose(): void {
        this.contentEl.empty();
    }

    private buildPlan(): AiJobPlan {
        const plan: AiJobPlan = {};
        if (this.summary !== OFF) plan.summary = this.summary;
        if (this.pulse !== OFF) plan.pulse = this.pulse;
        if (this.gossamer === ALL_SIGNALS) plan.gossamer = [...GOSSAMER_SIGNAL_TYPES];
        else if (this.gossamer !== OFF) plan.gossamer = [this.gossamer];
        if (this.inquiry !== OFF) plan.inquiry = this.inquiry;
        return plan;
    }
}
