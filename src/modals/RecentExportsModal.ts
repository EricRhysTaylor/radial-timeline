import { ButtonComponent, Modal, Notice } from 'obsidian';
import type RadialTimelinePlugin from '../main';
import { t } from '../i18n';
import { readRecentExportDeliveries } from '../publishing/exportHistory';
import { isDeliveryReviewed, recheckDelivery } from '../publishing/exportDelivery';
import { openExportedFile } from '../publishing/openExportedFile';
import { ExportDeliveryReviewModal } from './ExportDeliveryReviewModal';

export class RecentExportsModal extends Modal {
    private closed = false;
    constructor(private plugin: RadialTimelinePlugin, private destination: string, private onFileOpened: () => void) { super(plugin.app); }
    async onOpen(): Promise<void> {
        this.modalEl.addClass('ert-ui', 'ert-scope--modal', 'ert-modal-shell');
        this.modalEl.setCssStyles({ width: '800px', maxWidth: '92vw', maxHeight: '92vh' }); // SAFE: Obsidian modal sizing.
        this.contentEl.addClass('ert-modal-container', 'ert-stack');
        const header = this.contentEl.createDiv({ cls: 'ert-modal-header' });
        header.createDiv({ cls: 'ert-modal-title', text: t('ui.exportDeliveryReviewModal.recentExports') });
        const loading = this.contentEl.createDiv({ cls: 'ert-section-desc', text: t('ui.exportDeliveryReviewModal.checkingFiles'), attr: { role: 'status' } });
        try {
            const history = await readRecentExportDeliveries(this.plugin, this.destination);
            const receipts = await Promise.all(history.receipts.map(receipt => recheckDelivery(this.app, receipt)));
            if (this.closed) return;
            loading.remove();
            if (!receipts.length) this.contentEl.createDiv({ cls: 'ert-section-desc', text: t('ui.exportDeliveryReviewModal.noRecentExports') });
            for (const [index, receipt] of receipts.entries()) {
                const card = this.contentEl.createDiv({ cls: 'ert-panel ert-stack' });
                card.createEl('h4', { cls: 'ert-section-title ert-delivery-file-path', text: receipt.sourceTitle });
                const format = receipt.format === 'docx' ? t('manuscriptModal.formatDocx') : receipt.format === 'markdown' ? t('manuscriptModal.formatMarkdown') : receipt.format.toUpperCase();
                card.createDiv({ cls: 'ert-section-desc', text: `${new Date(receipt.createdAt).toLocaleString()} · ${format}` });
                if (receipt.reviewedAt && isDeliveryReviewed(receipt)) card.createDiv({ cls: 'ert-section-desc', text: t('ui.exportDeliveryReviewModal.reviewRecorded') });
                for (const file of receipt.files.filter(file => file.primary)) {
                    const row = card.createDiv({ cls: 'ert-inline ert-export-history-file' });
                    const link = row.createEl('a', { cls: 'ert-delivery-file-path', text: file.path, attr: { href: '#' } });
                    const open = async () => {
                        try {
                            await openExportedFile(this.app, file.path, receipt.format);
                            this.close(); this.onFileOpened();
                        } catch (error) { new Notice(error instanceof Error ? error.message : t('ui.exportDeliveryReviewModal.fileNotOpened')); }
                    };
                    link.addEventListener('click', event => { event.preventDefault(); if (!file.error && file.available) void open(); });
                    link.setAttribute('aria-disabled', String(!!file.error || !file.available));
                    const button = new ButtonComponent(row).setButtonText(t('ui.exportDeliveryReviewModal.openFile')).setDisabled(!!file.error || !file.available).onClick(() => { void open(); });
                    if (index === 0) button.setCta();
                }
                for (const problem of receipt.problems) card.createDiv({ cls: 'ert-section-desc ert-section-desc--alert', text: problem });
                const actions = card.createDiv({ cls: 'ert-inline' });
                new ButtonComponent(actions).setButtonText(t('ui.exportDeliveryReviewModal.details')).onClick(() => {
                    this.close(); new ExportDeliveryReviewModal(this.app, receipt, this.onFileOpened).open();
                });
            }
            if (history.problems.length) {
                const issues = this.contentEl.createEl('details');
                issues.createEl('summary', { text: t('ui.exportDeliveryReviewModal.historyNeedsAttention') });
                for (const problem of history.problems) issues.createDiv({ cls: 'ert-section-desc ert-delivery-file-path', text: problem });
            }
        } catch (error) {
            if (this.closed) return;
            loading.setText(error instanceof Error ? error.message : t('ui.exportDeliveryReviewModal.checkNotSaved'));
        }
        if (this.closed) return;
        const actions = this.contentEl.createDiv({ cls: 'ert-modal-actions' });
        new ButtonComponent(actions).setButtonText(t('ui.exportDeliveryReviewModal.close')).onClick(() => this.close());
    }
    onClose(): void { this.closed = true; this.contentEl.empty(); }
}
