import { Modal } from 'obsidian';

export type ErtModalSize = 'sm' | 'md' | 'lg' | 'xl';

export interface ErtModalShellOptions {
    /** Standard size variant — adds `ert-modal-shell--{size}`. */
    size?: ErtModalSize;
    /** Custom width override — applied to `modalEl.style.width`. */
    width?: string;
    /** Additional classes for `modalEl` (feature-specific shells like `ert-modal--note-creator`). */
    shellClasses?: string[];
    /** Additional classes for `contentEl` (feature-specific containers). */
    containerClasses?: string[];
}

export interface ErtModalHeaderOptions {
    title: string;
    subtitle?: string;
    badge?: {
        text: string;
        /** Override default badge class. Defaults to `ert-modal-badge`. */
        cls?: string;
    };
}

/**
 * Shared base for modals using the ERT shell contract.
 *
 * Subclasses call `applyShell()` in `onOpen()` (after `contentEl.empty()`) and
 * may use `mountHeader()` / `mountActions()` to compose the canonical layout.
 * Subclasses are free to skip the helpers and render directly into `contentEl`
 * when the modal needs a non-standard layout — the base only enforces the
 * shell classes, not the body structure.
 */
export abstract class ErtModal extends Modal {
    protected applyShell(options: ErtModalShellOptions = {}): void {
        const { modalEl, contentEl } = this;
        if (modalEl) {
            modalEl.classList.add('ert-ui', 'ert-scope--modal', 'ert-modal-shell');
            if (options.size) {
                modalEl.classList.add(`ert-modal-shell--${options.size}`);
            }
            if (options.width) {
                modalEl.style.width = options.width; // SAFE: Modal sizing via inline styles (Obsidian pattern)
            }
            if (options.shellClasses && options.shellClasses.length > 0) {
                modalEl.classList.add(...options.shellClasses);
            }
        }
        contentEl.addClass('ert-modal-container', 'ert-stack');
        if (options.containerClasses && options.containerClasses.length > 0) {
            contentEl.addClass(...options.containerClasses);
        }
    }

    protected mountHeader(options: ErtModalHeaderOptions): HTMLElement {
        const header = this.contentEl.createDiv({ cls: 'ert-modal-header' });
        if (options.badge) {
            header.createSpan({
                cls: options.badge.cls ?? 'ert-modal-badge',
                text: options.badge.text,
            });
        }
        header.createDiv({ cls: 'ert-modal-title', text: options.title });
        if (options.subtitle) {
            header.createDiv({ cls: 'ert-modal-subtitle', text: options.subtitle });
        }
        return header;
    }

    protected mountActions(): HTMLElement {
        return this.contentEl.createDiv({ cls: 'ert-modal-actions' });
    }
}
