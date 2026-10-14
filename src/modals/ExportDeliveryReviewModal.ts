import { ButtonComponent, Modal, Notice, type App } from 'obsidian';
import { getVaultAbsolutePath } from '../utils/exportFormats';
import { isDeliveryReviewed, readDeliveryReceipt, recheckDelivery, writeDeliveryReceipt, type ExportDeliveryReceipt } from '../publishing/exportDelivery';
import { t, tCount } from '../i18n';

/** Resume output review from its portable receipt; opening a file never marks it reviewed. */
export class ExportDeliveryReviewModal extends Modal {
    private busy = false;
    private closed = false;
    private checkError: string | null = null;
    constructor(app: App, private receipt: ExportDeliveryReceipt) { super(app); }

    async onOpen(): Promise<void> {
        this.modalEl.addClass('ert-ui', 'ert-scope--modal', 'ert-modal-shell');
        this.modalEl.setCssStyles({ width: '800px', maxWidth: '92vw', maxHeight: '92vh' }); // SAFE: Obsidian modal sizing.
        this.contentEl.addClass('ert-modal-container', 'ert-stack');
        this.contentEl.createDiv({ cls: 'ert-section-desc', text: t('ui.exportDeliveryReviewModal.checkingFiles'), attr: { role: 'status' } });
        await this.runCheck();
    }

    onClose(): void { this.closed = true; this.contentEl.empty(); }

    private async runCheck(reviewPath?: string, checked?: boolean, confirm = false): Promise<void> {
        if (this.busy) return;
        this.busy = true;
        this.contentEl.inert = true;
        try {
            // Reload persisted checkmarks so another review window cannot overwrite them.
            const stored = await readDeliveryReceipt(this.app, this.receipt.receiptPath);
            const next = await recheckDelivery(this.app, stored);
            const changed = next.files.some(file => file.sha256 !== this.receipt.files.find(previous => previous.path === file.path)?.sha256);
            if (reviewPath) {
                const file = next.files.find(file => file.path === reviewPath);
                if (changed) new Notice(t('ui.exportDeliveryReviewModal.fileChangedNotice'));
                else if (file && file.sha256 && !file.error) { file.reviewedSha256 = checked ? file.sha256 : undefined; next.reviewedAt = undefined; }
            }
            if (confirm) {
                if (changed || !isDeliveryReviewed(next)) {
                    await writeDeliveryReceipt(this.app, next);
                    this.receipt = next;
                    throw new Error(t('ui.exportDeliveryReviewModal.reviewEachFileFirst'));
                }
                next.reviewedAt = new Date().toISOString();
            }
            await writeDeliveryReceipt(this.app, next);
            this.receipt = next;
            this.checkError = null;
            if (confirm) new Notice(t('ui.exportDeliveryReviewModal.reviewRecordedNotice'));
        } catch (error) {
            this.checkError = error instanceof Error ? error.message : t('ui.exportDeliveryReviewModal.checkNotSaved');
            new Notice(error instanceof Error ? error.message : t('ui.exportDeliveryReviewModal.checkNotSaved'));
        } finally {
            this.busy = false;
            this.contentEl.inert = false;
            if (!this.closed) { const scrollTop = this.contentEl.scrollTop; this.render(); this.contentEl.scrollTop = scrollTop; }
        }
    }

    private render(): void {
        this.contentEl.empty();
        const receipt = this.receipt;
        const header = this.contentEl.createDiv({ cls: 'ert-modal-header' });
        header.createDiv({ cls: 'ert-modal-title', text: t('ui.exportDeliveryReviewModal.title') });
        header.createDiv({ cls: 'ert-modal-subtitle', text: receipt.sourceTitle });
        const status = this.contentEl.createDiv({ cls: 'ert-panel ert-stack', attr: { role: 'status', 'aria-live': 'polite' } });
        status.createEl('h4', { cls: 'ert-section-title', text: this.checkError || receipt.problems.length ? t('ui.exportDeliveryReviewModal.checksNeedAttention') : receipt.reviewedAt && isDeliveryReviewed(receipt) ? t('ui.exportDeliveryReviewModal.reviewRecorded') : t('ui.exportDeliveryReviewModal.checksPassed') });
        const primary = receipt.files.filter(file => file.primary);
        const valid = primary.filter(file => file.available && !file.error).length;
        const formatLabel = receipt.format === 'docx' ? t('manuscriptModal.formatDocx') : receipt.format === 'markdown' ? t('manuscriptModal.formatMarkdown') : receipt.format.toUpperCase();
        const checkVars = { valid, expected: receipt.expectedFiles, format: formatLabel };
        status.createDiv({ cls: 'ert-section-desc', text: this.checkError ? t('ui.exportDeliveryReviewModal.lastRecordedCheckSummary', checkVars) : t('ui.exportDeliveryReviewModal.filesCheckedSummary', checkVars) });
        status.createDiv({ cls: 'ert-section-desc ert-delivery-file-path', text: t('ui.exportDeliveryReviewModal.savedTo', { folder: receipt.outputFolder }) });
        status.createDiv({ cls: 'ert-section-desc', text: t('ui.exportDeliveryReviewModal.generatedAt', { date: new Date(receipt.createdAt).toLocaleString() }) });
        for (const problem of receipt.problems) status.createDiv({ cls: 'ert-section-desc ert-section-desc--alert', text: problem });
        if (this.checkError) status.createDiv({ cls: 'ert-section-desc ert-section-desc--alert', text: this.checkError });
        status.createDiv({ cls: 'ert-section-desc', text: t('ui.exportDeliveryReviewModal.checksExplainer') });
        const contents = status.createEl('details');
        contents.createEl('summary', { text: t('ui.exportDeliveryReviewModal.sourceSelectionSummary', { count: receipt.sourcePaths.length }) });
        for (const sourcePath of receipt.sourcePaths) contents.createDiv({ cls: 'ert-section-desc ert-delivery-file-path', text: sourcePath });
        if (receipt.options) {
            const choices = status.createEl('details');
            choices.createEl('summary', { text: t('ui.exportDeliveryReviewModal.exportChoices') });
            choices.createDiv({ cls: 'ert-section-desc', text: receipt.options.source && receipt.options.source.kind !== 'book' ? t('ui.exportDeliveryReviewModal.authorReviewedOrder') : t('ui.exportDeliveryReviewModal.orderingValue', { order: receipt.options.order }) });
            choices.createDiv({ cls: 'ert-section-desc', text: receipt.options.includeMatter ? t('ui.exportDeliveryReviewModal.matterIncluded') : t('ui.exportDeliveryReviewModal.matterExcluded') });
        }

        for (const file of primary) {
            const card = this.contentEl.createDiv({ cls: 'ert-panel ert-stack' });
            card.createEl('h4', { cls: 'ert-section-title ert-delivery-file-path', text: file.path.split('/').pop() || file.path });
            card.createDiv({ cls: 'ert-section-desc', text: file.error || (file.pages
                ? t('ui.exportDeliveryReviewModal.fileSizePages', { bytes: file.bytes.toLocaleString(), pages: tCount('page', file.pages) })
                : receipt.format === 'docx'
                    ? t('ui.exportDeliveryReviewModal.fileSizeWordChecked', { bytes: file.bytes.toLocaleString() })
                    : t('ui.exportDeliveryReviewModal.fileSizeTextChecked', { bytes: file.bytes.toLocaleString() })) });
            if (file.modifiedAfterExport) card.createDiv({ cls: 'ert-section-desc', text: t('ui.exportDeliveryReviewModal.changedSinceExport') });
            const row = card.createDiv({ cls: 'ert-inline' });
            new ButtonComponent(row).setButtonText(receipt.format === 'docx' ? t('ui.exportDeliveryReviewModal.openWordFile') : t('ui.exportDeliveryReviewModal.openFile')).setDisabled(!file.available || !!file.error || !!this.checkError).onClick(() => { void this.openFile(file.path); });
            const label = row.createEl('label', { cls: 'ert-delivery-review-mark' });
            const check = label.createEl('input', { attr: { type: 'checkbox' } });
            check.checked = !!file.sha256 && file.reviewedSha256 === file.sha256;
            check.disabled = !file.available || !!file.error || !!this.checkError;
            label.createSpan({ text: t('ui.exportDeliveryReviewModal.contentReviewed') });
            check.addEventListener('change', () => { void this.runCheck(file.path, check.checked); });
        }
        const working = receipt.files.filter(file => !file.primary);
        if (working.length) {
            const details = this.contentEl.createEl('details');
            details.createEl('summary', { text: t('ui.exportDeliveryReviewModal.workingMarkdownSummary', { count: working.length }) });
            for (const file of working) details.createDiv({ cls: 'ert-section-desc ert-delivery-file-path', text: file.error ? `${file.path} · ${file.error}` : file.path });
        }
        this.contentEl.createDiv({ cls: 'ert-section-desc', text: t('ui.exportDeliveryReviewModal.reviewMarksSaved') });
        const actions = this.contentEl.createDiv({ cls: 'ert-modal-actions' });
        new ButtonComponent(actions).setButtonText(t('ui.exportDeliveryReviewModal.recheckFiles')).onClick(() => { void this.runCheck(); });
        new ButtonComponent(actions).setButtonText(t('ui.exportDeliveryReviewModal.recordReviewComplete')).setCta().setDisabled(!!this.checkError || !isDeliveryReviewed(receipt) || !!receipt.reviewedAt).onClick(() => { void this.runCheck(undefined, undefined, true); });
        new ButtonComponent(actions).setButtonText(t('ui.exportDeliveryReviewModal.close')).onClick(() => this.close());
    }

    private async openFile(vaultPath: string): Promise<void> {
        try {
            if (this.receipt.format === 'docx') {
                const absolute = getVaultAbsolutePath({ app: this.app }, vaultPath);
                if (!absolute) throw new Error(t('ui.exportDeliveryReviewModal.openWithDeviceApp'));
                const shell = (window as unknown as { require?: (name: string) => { shell?: { openPath(path: string): Promise<string> } } }).require?.('electron').shell;
                if (!shell) throw new Error(t('ui.exportDeliveryReviewModal.openerUnavailable'));
                const error = await shell.openPath(absolute);
                if (error) throw new Error(error);
            } else {
                await this.app.workspace.openLinkText(vaultPath, '', 'tab');
                this.close();
            }
        } catch (error) { new Notice(error instanceof Error ? error.message : t('ui.exportDeliveryReviewModal.fileNotOpened')); }
    }
}
