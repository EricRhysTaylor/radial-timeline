/*
 * LatexPreviewModal — small read-only modal that displays the full generated
 * LaTeX for a designed style. Opened from the Designed Style Wizard's footer
 * "View LaTeX" button. The wizard remains open behind it; closing returns
 * focus to the wizard.
 */
import { App, ButtonComponent, Modal, Notice } from 'obsidian';

export interface LatexPreviewModalOptions {
    latex: string;
    title: string;
}

export class LatexPreviewModal extends Modal {
    private readonly options: LatexPreviewModalOptions;

    constructor(app: App, options: LatexPreviewModalOptions) {
        super(app);
        this.options = options;
    }

    onOpen(): void {
        const { contentEl, modalEl, titleEl } = this;
        contentEl.empty();
        titleEl.setText('');

        if (modalEl) {
            modalEl.classList.add(
                'ert-ui',
                'ert-scope--modal',
                'ert-modal-shell',
                'ert-latex-preview-modal',
            );
        }
        contentEl.addClass('ert-modal-container', 'ert-stack', 'ert-latex-preview');

        const header = contentEl.createDiv({ cls: 'ert-modal-header' });
        header.createDiv({
            cls: 'ert-modal-title',
            text: 'Generated LaTeX',
        });
        header.createDiv({
            cls: 'ert-modal-subtitle',
            text: this.options.title,
        });

        const pre = contentEl.createEl('pre', { cls: 'ert-latex-preview__pre' });
        pre.setText(this.options.latex);

        const actions = contentEl.createDiv({ cls: 'ert-modal-actions ert-latex-preview__actions' });

        new ButtonComponent(actions)
            .setButtonText('Copy')
            .onClick(() => {
                const writer = navigator.clipboard;
                if (!writer) {
                    new Notice('Clipboard unavailable in this environment.');
                    return;
                }
                writer.writeText(this.options.latex).then(
                    () => { new Notice('LaTeX copied to clipboard.'); },
                    (err: unknown) => {
                        const msg = err instanceof Error ? err.message : String(err);
                        new Notice(`Copy failed: ${msg}`);
                    },
                );
            });

        new ButtonComponent(actions)
            .setButtonText('Close')
            .setCta()
            .onClick(() => this.close());
    }

    onClose(): void {
        this.contentEl.empty();
    }
}
