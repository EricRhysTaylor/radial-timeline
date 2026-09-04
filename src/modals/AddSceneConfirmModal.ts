import { App, setIcon } from 'obsidian';
import { ErtModal } from '../ui/ErtModal';
import type { SceneInsertionPlan } from '../services/SceneInsertService';
import { basename } from '../utils/paths';

export class AddSceneConfirmModal extends ErtModal {
    private phase: 'confirm' | 'running' | 'done' = 'confirm';
    private closed = false;
    private beginResolver: ((value: boolean) => void) | null = null;
    private dismissResolver: (() => void) | null = null;
    private primaryButtonEl: HTMLButtonElement | null = null;
    private cancelButtonEl: HTMLButtonElement | null = null;
    private statusRowEl: HTMLElement | null = null;
    private statusTextEl: HTMLElement | null = null;
    private backdropGuard: ((evt: MouseEvent) => void) | null = null;

    constructor(app: App, private readonly plan: SceneInsertionPlan, private readonly accent?: string) {
        super(app);
    }

    onOpen(): void {
        const { contentEl } = this;
        this.closed = false;
        contentEl.empty();
        this.applyShell({ width: 'min(660px, 90vw)' });

        // Escape only cancels during the confirm phase. Once the insert is
        // running, the operation owns the modal until it finishes.
        this.scope.register([], 'Escape', () => {
            if (this.phase === 'confirm') {
                this.resolveBegin(false);
                this.close();
            }
            return false;
        });

        // Block backdrop dismissal while the insert is running or awaiting
        // dismissal, so the author can't accidentally lose the summary.
        this.backdropGuard = (evt: MouseEvent) => {
            if (this.phase === 'confirm') return;
            if (evt.target === this.containerEl) {
                evt.preventDefault();
                evt.stopPropagation();
                evt.stopImmediatePropagation();
            }
        };
        this.containerEl.addEventListener('mousedown', this.backdropGuard, true);
        this.containerEl.addEventListener('click', this.backdropGuard, true);

        contentEl.addClass('ert-drag-confirm-modal');
        if (this.accent) {
            contentEl.style.setProperty('--ert-confirm-accent', this.accent);
        }

        const header = contentEl.createDiv({ cls: 'ert-modal-header' });
        header.createSpan({ cls: 'ert-modal-badge', text: 'Add Scene' });
        header.createDiv({ cls: 'ert-modal-title', text: 'Confirm scene insert' });

        const listDiv = contentEl.createDiv({ cls: 'ert-drag-confirm-list' });
        const summarySection = listDiv.createDiv({ cls: 'ert-drag-confirm-section' });
        summarySection.createDiv({ cls: 'ert-drag-confirm-section-title', text: 'Scene insert summary' });

        this.addSummaryRow(summarySection, 'file-plus-2', `Add ${basename(this.plan.path)} after ${this.plan.anchorBasename}`);

        const impactGrid = summarySection.createDiv({ cls: 'ert-drag-confirm-impact-grid' });
        this.createImpactCard(impactGrid, 'When', this.plan.when || 'Blank', 'calendar-clock');
        this.createImpactCard(impactGrid, 'Subplot', this.plan.subplotLabel, 'orbit');
        this.createImpactCard(impactGrid, 'YAML', this.plan.yamlMode, 'braces');

        // The new scene takes a decimal between its neighbours, so no other
        // scene or beat filename changes.
        this.addSummaryRow(summarySection, 'list-ordered', 'No existing scene or beat filenames will be renamed.');

        const statusRow = listDiv.createDiv({ cls: 'ert-drag-confirm-row is-status-row is-hidden' });
        const statusIcon = statusRow.createDiv({ cls: 'ert-drag-confirm-row-icon' });
        setIcon(statusIcon, 'list-ordered');
        this.statusTextEl = statusRow.createDiv({ cls: 'ert-drag-confirm-row-text ert-drag-confirm-status-text' });
        this.statusTextEl.setText('Preparing scene insert...');
        this.statusRowEl = statusRow;

        const actions = contentEl.createDiv({ cls: 'ert-modal-actions' });
        const confirmButton = actions.createEl('button', { text: 'Add scene', cls: 'ert-mod-cta' });
        const cancelButton = actions.createEl('button', { text: 'Cancel' });
        this.primaryButtonEl = confirmButton;
        this.cancelButtonEl = cancelButton;

        confirmButton.addEventListener('click', () => {
            if (this.phase === 'confirm') {
                this.phase = 'running';
                this.setCloseControlDisabled(true);
                this.showStatusRow('is-live');
                if (this.primaryButtonEl) {
                    this.primaryButtonEl.disabled = true;
                    this.primaryButtonEl.textContent = 'Working...';
                }
                if (this.cancelButtonEl) {
                    this.cancelButtonEl.classList.add('is-hidden-action');
                }
                this.resolveBegin(true);
                return;
            }

            if (this.phase === 'done') {
                this.resolveDismiss();
                this.close();
            }
        });

        cancelButton.addEventListener('click', () => {
            if (this.phase !== 'confirm') return;
            this.resolveBegin(false);
            this.close();
        });
    }

    onClose(): void {
        if (this.backdropGuard) {
            this.containerEl.removeEventListener('mousedown', this.backdropGuard, true);
            this.containerEl.removeEventListener('click', this.backdropGuard, true);
            this.backdropGuard = null;
        }
        this.closed = true;
        this.resolveBegin(false);
        this.resolveDismiss();
        this.setCloseControlDisabled(false);
        this.contentEl.empty();
    }

    /**
     * Open the modal and resolve once the author commits the insert (true)
     * or cancels (false). The modal stays open after `true` so the caller can
     * drive progress and finish with a summary via {@link finishWithDismiss}.
     */
    async waitForBegin(): Promise<boolean> {
        return await new Promise<boolean>((resolve) => {
            this.beginResolver = resolve;
            this.open();
        });
    }

    updateProgress(message: string): void {
        if (this.closed || this.phase !== 'running') return;
        this.showStatusRow('is-live');
        this.statusTextEl?.setText(message);
    }

    async finishWithDismiss(message: string, isError: boolean = false): Promise<void> {
        if (this.closed) return;
        this.phase = 'done';
        this.showStatusRow(isError ? 'is-error' : 'is-complete');
        this.statusTextEl?.setText(message);
        this.setCloseControlDisabled(true);
        if (this.cancelButtonEl) {
            this.cancelButtonEl.classList.add('is-hidden-action');
        }
        if (this.primaryButtonEl) {
            this.primaryButtonEl.disabled = false;
            this.primaryButtonEl.textContent = 'Done';
        }

        await new Promise<void>((resolve) => {
            this.dismissResolver = resolve;
        });
    }

    private showStatusRow(stateClass: 'is-live' | 'is-complete' | 'is-error'): void {
        if (!this.statusRowEl) return;
        this.statusRowEl.classList.remove('is-hidden', 'is-live', 'is-complete', 'is-error');
        this.statusRowEl.classList.add(stateClass);
    }

    private setCloseControlDisabled(disabled: boolean): void {
        const closeBtn = this.modalEl.querySelector<HTMLElement>('.modal-close-button');
        if (!closeBtn) return;
        closeBtn.classList.toggle('is-locked-close', disabled);
    }

    private addSummaryRow(container: HTMLElement, icon: string, text: string): void {
        const row = container.createDiv({ cls: 'ert-drag-confirm-row' });
        const iconEl = row.createDiv({ cls: 'ert-drag-confirm-row-icon' });
        setIcon(iconEl, icon);
        row.createDiv({ cls: 'ert-drag-confirm-row-text', text });
    }

    private createImpactCard(container: HTMLElement, label: string, value: string, icon: string): void {
        const card = container.createDiv({ cls: 'ert-drag-confirm-impact-card' });
        const iconContainer = card.createDiv({ cls: 'ert-drag-confirm-row-icon' });
        setIcon(iconContainer, icon);
        const text = card.createDiv({ cls: 'ert-drag-confirm-impact-text' });
        text.createDiv({ cls: 'ert-drag-confirm-impact-label', text: label });
        text.createDiv({ cls: 'ert-drag-confirm-impact-value', text: value });
    }

    private resolveBegin(value: boolean): void {
        const resolver = this.beginResolver;
        this.beginResolver = null;
        resolver?.(value);
    }

    private resolveDismiss(): void {
        const resolver = this.dismissResolver;
        this.dismissResolver = null;
        resolver?.();
    }
}
