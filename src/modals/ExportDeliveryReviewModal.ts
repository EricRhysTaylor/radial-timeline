import { ButtonComponent, Modal, Notice, type App } from 'obsidian';
import { getVaultAbsolutePath } from '../utils/exportFormats';
import { isDeliveryReviewed, readDeliveryReceipt, recheckDelivery, writeDeliveryReceipt, type ExportDeliveryReceipt } from '../publishing/exportDelivery';

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
        this.contentEl.createDiv({ cls: 'ert-section-desc', text: 'Checking exported files…', attr: { role: 'status' } });
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
                if (changed) new Notice('An exported file changed. Review its current version before marking it checked.');
                else if (file && file.sha256 && !file.error) { file.reviewedSha256 = checked ? file.sha256 : undefined; next.reviewedAt = undefined; }
            }
            if (confirm) {
                if (changed || !isDeliveryReviewed(next)) {
                    await writeDeliveryReceipt(this.app, next);
                    this.receipt = next;
                    throw new Error('Review each current final file before recording completion.');
                }
                next.reviewedAt = new Date().toISOString();
            }
            await writeDeliveryReceipt(this.app, next);
            this.receipt = next;
            this.checkError = null;
            if (confirm) new Notice('Export review recorded for these files.');
        } catch (error) {
            this.checkError = error instanceof Error ? error.message : 'The delivery check could not be saved.';
            new Notice(error instanceof Error ? error.message : 'The delivery check could not be saved.');
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
        header.createDiv({ cls: 'ert-modal-title', text: 'Export review' });
        header.createDiv({ cls: 'ert-modal-subtitle', text: receipt.sourceTitle });
        const status = this.contentEl.createDiv({ cls: 'ert-panel ert-stack', attr: { role: 'status', 'aria-live': 'polite' } });
        status.createEl('h4', { cls: 'ert-section-title', text: this.checkError || receipt.problems.length ? 'File checks · Needs attention' : receipt.reviewedAt && isDeliveryReviewed(receipt) ? 'Review recorded' : 'File checks · Passed' });
        const primary = receipt.files.filter(file => file.primary);
        const valid = primary.filter(file => file.available && !file.error).length;
        status.createDiv({ cls: 'ert-section-desc', text: `${this.checkError ? 'Last recorded check · ' : ''}${valid} of ${receipt.expectedFiles} final files checked · ${receipt.format === 'docx' ? 'Word' : receipt.format === 'markdown' ? 'Markdown' : receipt.format.toUpperCase()}` });
        status.createDiv({ cls: 'ert-section-desc ert-delivery-file-path', text: `Saved to ${receipt.outputFolder}` });
        status.createDiv({ cls: 'ert-section-desc', text: `Generated ${new Date(receipt.createdAt).toLocaleString()}` });
        for (const problem of receipt.problems) status.createDiv({ cls: 'ert-section-desc ert-section-desc--alert', text: problem });
        if (this.checkError) status.createDiv({ cls: 'ert-section-desc ert-section-desc--alert', text: this.checkError });
        status.createDiv({ cls: 'ert-section-desc', text: 'Checks confirm file availability, basic structure and expected file count. Open every final file to review its content and formatting before sharing.' });
        const contents = status.createEl('details');
        contents.createEl('summary', { text: `Source selection · ${receipt.sourcePaths.length} notes` });
        for (const sourcePath of receipt.sourcePaths) contents.createDiv({ cls: 'ert-section-desc ert-delivery-file-path', text: sourcePath });
        if (receipt.options) {
            const choices = status.createEl('details');
            choices.createEl('summary', { text: 'Export choices' });
            choices.createDiv({ cls: 'ert-section-desc', text: receipt.options.source && receipt.options.source.kind !== 'book' ? 'Author-reviewed note order' : `Ordering: ${receipt.options.order}` });
            choices.createDiv({ cls: 'ert-section-desc', text: receipt.options.includeMatter ? 'Front and back matter included' : 'Front and back matter excluded' });
        }

        for (const file of primary) {
            const card = this.contentEl.createDiv({ cls: 'ert-panel ert-stack' });
            card.createEl('h4', { cls: 'ert-section-title ert-delivery-file-path', text: file.path.split('/').pop() || file.path });
            card.createDiv({ cls: 'ert-section-desc', text: file.error || `${file.bytes.toLocaleString()} bytes${file.pages ? ` · ${file.pages} ${file.pages === 1 ? 'page' : 'pages'}` : receipt.format === 'docx' ? ' · Word package checked' : ' · Text checked'}` });
            if (file.modifiedAfterExport) card.createDiv({ cls: 'ert-section-desc', text: 'Changed since export. Review the current version.' });
            const row = card.createDiv({ cls: 'ert-manuscript-pill-row' });
            new ButtonComponent(row).setButtonText(receipt.format === 'docx' ? 'Open Word file' : 'Open file').setDisabled(!file.available || !!file.error || !!this.checkError).onClick(() => { void this.openFile(file.path); });
            const label = row.createEl('label');
            const check = label.createEl('input', { attr: { type: 'checkbox' } });
            check.checked = !!file.sha256 && file.reviewedSha256 === file.sha256;
            check.disabled = !file.available || !!file.error || !!this.checkError;
            label.appendText(' Content and formatting reviewed');
            check.addEventListener('change', () => { void this.runCheck(file.path, check.checked); });
        }
        const working = receipt.files.filter(file => !file.primary);
        if (working.length) {
            const details = this.contentEl.createEl('details');
            details.createEl('summary', { text: `Working Markdown · ${working.length} files` });
            for (const file of working) details.createDiv({ cls: 'ert-section-desc ert-delivery-file-path', text: file.error ? `${file.path} · ${file.error}` : file.path });
        }
        this.contentEl.createDiv({ cls: 'ert-section-desc', text: 'Checks and review marks are saved beside the export. Reopen them with Review last export. Word pagination must be checked in Word.' });
        const actions = this.contentEl.createDiv({ cls: 'ert-modal-actions' });
        new ButtonComponent(actions).setButtonText('Recheck files').onClick(() => { void this.runCheck(); });
        new ButtonComponent(actions).setButtonText('Record review complete').setCta().setDisabled(!!this.checkError || !isDeliveryReviewed(receipt) || !!receipt.reviewedAt).onClick(() => { void this.runCheck(undefined, undefined, true); });
        new ButtonComponent(actions).setButtonText('Close').onClick(() => this.close());
    }

    private async openFile(vaultPath: string): Promise<void> {
        try {
            if (this.receipt.format === 'docx') {
                const absolute = getVaultAbsolutePath({ app: this.app }, vaultPath);
                if (!absolute) throw new Error('Open this Word file with your device’s document app.');
                const shell = (window as unknown as { require?: (name: string) => { shell?: { openPath(path: string): Promise<string> } } }).require?.('electron').shell;
                if (!shell) throw new Error('The desktop document opener is unavailable.');
                const error = await shell.openPath(absolute);
                if (error) throw new Error(error);
            } else {
                await this.app.workspace.openLinkText(vaultPath, '', 'tab');
                this.close();
            }
        } catch (error) { new Notice(error instanceof Error ? error.message : 'The file could not be opened.'); }
    }
}
