import { App } from 'obsidian';
import { ErtModal } from '../ui/ErtModal';
import type { StructuralMoveHistoryEntry } from '../types/settings';

const ICON_SHUFFLE = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-shuffle-icon lucide-shuffle"><path d="m18 14 4 4-4 4"/><path d="m18 2 4 4-4 4"/><path d="M2 18h1.973a4 4 0 0 0 3.3-1.7l5.454-8.6a4 4 0 0 1 3.3-1.7H22"/><path d="M2 6h1.972a4 4 0 0 1 3.6 2.2"/><path d="M22 18h-6.041a4 4 0 0 1-3.3-1.8l-.359-.45"/></svg>`;
const ICON_LIST_ORDERED = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-list-ordered-icon lucide-list-ordered"><path d="M11 5h10"/><path d="M11 12h10"/><path d="M11 19h10"/><path d="M4 4h1v5"/><path d="M4 9h2"/><path d="M6.5 20H3.4c0-1 2.6-1.925 2.6-3.5a1.5 1.5 0 0 0-2.6-1.02"/></svg>`;
const ICON_BLOCKS = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-blocks-icon lucide-blocks"><path d="M10 22V7a1 1 0 0 0-1-1H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5a1 1 0 0 0-1-1H2"/><rect x="14" y="2" width="8" height="8" rx="1"/></svg>`;
const ICON_WAVES = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-waves"><path d="M2 6c1.2 0 1.8.6 2.4 1.2.6.6 1.2 1.2 2.4 1.2s1.8-.6 2.4-1.2C9.8 6.6 10.4 6 11.6 6s1.8.6 2.4 1.2c.6.6 1.2 1.2 2.4 1.2s1.8-.6 2.4-1.2C19.4 6.6 20 6 21.2 6"/><path d="M2 12c1.2 0 1.8.6 2.4 1.2.6.6 1.2 1.2 2.4 1.2s1.8-.6 2.4-1.2c.6-.6 1.2-1.2 2.4-1.2s1.8.6 2.4 1.2c.6.6 1.2 1.2 2.4 1.2s1.8-.6 2.4-1.2c.6-.6 1.2-1.2 2.4-1.2"/><path d="M2 18c1.2 0 1.8.6 2.4 1.2.6.6 1.2 1.2 2.4 1.2s1.8-.6 2.4-1.2c.6-.6 1.2-1.2 2.4-1.2s1.8.6 2.4 1.2c.6.6 1.2 1.2 2.4 1.2s1.8-.6 2.4-1.2c.6-.6 1.2-1.2 2.4-1.2"/></svg>`;
const ICON_ARROW_RIGHT_TO_LINE = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-arrow-right-to-line"><path d="M17 12H3"/><path d="m11 18 6-6-6-6"/><path d="M21 5v14"/></svg>`;
const ICON_ARROW_RIGHT = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-corner-up-right"><polyline points="15 14 20 9 15 4"/><path d="M4 20v-7a4 4 0 0 1 4-4h12"/></svg>`;

export interface DragConfirmCurrentMoveSummary {
    actionSummary: string;
    renameCount: number;
    contextChange?: string;
    rippleRename?: boolean;
}

export class DragConfirmModal extends ErtModal {
    private readonly currentMove: DragConfirmCurrentMoveSummary;
    private readonly recentMoves: StructuralMoveHistoryEntry[];
    private readonly onHistoryClick?: (entry: StructuralMoveHistoryEntry) => Promise<void> | void;
    private readonly accent?: string;
    private readonly itemLabel: string; // 'scene' or 'beat'
    private phase: 'confirm' | 'running' | 'done' = 'confirm';
    private closed = false;
    private beginResolver: ((value: boolean) => void) | null = null;
    private dismissResolver: (() => void) | null = null;
    private primaryButtonEl: HTMLButtonElement | null = null;
    private cancelButtonEl: HTMLButtonElement | null = null;
    private statusRowEl: HTMLElement | null = null;
    private statusTextEl: HTMLElement | null = null;
    private backdropGuard: ((evt: MouseEvent) => void) | null = null;

    constructor(
        app: App,
        currentMove: DragConfirmCurrentMoveSummary,
        recentMoves: StructuralMoveHistoryEntry[],
        onHistoryClick?: (entry: StructuralMoveHistoryEntry) => Promise<void> | void,
        accent?: string,
        itemLabel?: string
    ) {
        super(app);
        this.currentMove = currentMove;
        this.recentMoves = recentMoves.slice(0, 20);
        this.onHistoryClick = onHistoryClick;
        this.accent = accent;
        this.itemLabel = itemLabel || 'scene';
    }

    onOpen(): void {
        const { contentEl } = this;
        this.closed = false;
        contentEl.empty();
        this.applyShell({ width: 'min(660px, 90vw)' });

        this.scope.register([], 'Escape', () => {
            if (this.phase === 'confirm') {
                this.resolveBegin(false);
                this.close();
            }
            return false;
        });

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

        // Use the passed accent color (subplot color)
        if (this.accent) {
            contentEl.style.setProperty('--ert-confirm-accent', this.accent);
        }

        // Header — differentiates between scene and beat moves
        const capitalLabel = this.itemLabel.charAt(0).toUpperCase() + this.itemLabel.slice(1);
        const header = contentEl.createDiv({ cls: 'ert-modal-header' });
        header.createSpan({ cls: 'ert-modal-badge', text: `Reorder ${capitalLabel}` });
        header.createDiv({ cls: 'ert-modal-title', text: `Confirm ${this.itemLabel} reorder` });

        const listDiv = contentEl.createDiv({ cls: 'ert-drag-confirm-list' });

        const currentMoveSection = listDiv.createDiv({ cls: 'ert-drag-confirm-section' });
        currentMoveSection.createDiv({ cls: 'ert-drag-confirm-section-title', text: 'Current move summary' });

        const actionRow = currentMoveSection.createDiv({ cls: 'ert-drag-confirm-row' });
        const actionIcon = actionRow.createDiv({ cls: 'ert-drag-confirm-row-icon' });
        this.setIcon(actionIcon, ICON_SHUFFLE);
        const actionSummary = actionRow.createDiv({ cls: 'ert-drag-confirm-row-text' });
        this.renderMoveSummary(actionSummary, this.currentMove.actionSummary);

        const impactGrid = currentMoveSection.createDiv({ cls: 'ert-drag-confirm-impact-grid' });
        this.createImpactCard(impactGrid, 'Rename impact', this.formatRenameImpact(this.currentMove.renameCount), ICON_LIST_ORDERED);
        if (this.currentMove.contextChange) {
            this.createImpactCard(impactGrid, 'Context change', this.currentMove.contextChange, ICON_BLOCKS);
        }
        if (this.currentMove.rippleRename) {
            this.createImpactCard(impactGrid, 'Extra effect', 'Ripple rename enabled', ICON_WAVES);
        }

        if (this.recentMoves.length > 0) {
            const historySection = listDiv.createDiv({ cls: 'ert-drag-confirm-section' });
            historySection.createDiv({ cls: 'ert-drag-confirm-section-title', text: 'Recent moves' });
            const historyFrame = historySection.createDiv({ cls: 'ert-drag-confirm-history-frame' });
            const historyList = historyFrame.createDiv({ cls: 'ert-drag-confirm-history-list' });
            this.recentMoves.forEach((entry) => {
                const row = historyList.createDiv({
                    cls: 'ert-drag-confirm-history-item',
                    attr: { role: 'button', tabindex: '0' }
                });
                const rowHeader = row.createDiv({ cls: 'ert-drag-confirm-history-header' });
                const rowIcon = rowHeader.createDiv({ cls: 'ert-drag-confirm-history-icon' });
                this.setIcon(rowIcon, ICON_ARROW_RIGHT_TO_LINE);
                const rowSummary = rowHeader.createDiv({ cls: 'ert-drag-confirm-history-summary' });
                this.renderMoveSummary(rowSummary, entry.summary);

                const metaParts = [this.formatRenameImpact(entry.renameCount ?? 0)];
                if (entry.crossedActs) metaParts.push('Crossed Acts');
                if (entry.rippleRename) metaParts.push('Ripple rename');
                row.createDiv({ cls: 'ert-drag-confirm-history-meta', text: metaParts.join(' • ') });
                row.addEventListener('click', () => {
                    void this.onHistoryClick?.(entry);
                });
            });
        }

        const statusRow = listDiv.createDiv({ cls: 'ert-drag-confirm-row is-status-row is-hidden' });
        const statusIcon = statusRow.createDiv({ cls: 'ert-drag-confirm-row-icon' });
        this.setIcon(statusIcon, ICON_LIST_ORDERED);
        this.statusTextEl = statusRow.createDiv({ cls: 'ert-drag-confirm-row-text ert-drag-confirm-status-text' });
        this.statusTextEl.setText('Preparing reorder...');
        this.statusRowEl = statusRow;

        const buttons = contentEl.createDiv({ cls: 'ert-modal-actions' });
        const primaryBtn = buttons.createEl('button', { text: 'Begin', cls: 'ert-mod-cta' });
        const cancelBtn = buttons.createEl('button', { text: 'Cancel' });
        this.primaryButtonEl = primaryBtn;
        this.cancelButtonEl = cancelBtn;

        primaryBtn.addEventListener('click', () => {
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

        cancelBtn.addEventListener('click', () => {
            if (this.phase !== 'confirm') return;
            this.resolveBegin(false);
            this.close();
        });
    }

    private setIcon(container: HTMLElement, svgString: string): void {
        const parser = new DOMParser();
        const doc = parser.parseFromString(svgString, 'image/svg+xml');
        if (doc.documentElement) {
            container.empty();
            container.appendChild(container.ownerDocument.importNode(doc.documentElement, true));
        }
    }

    private createImpactCard(container: HTMLElement, label: string, value: string, icon: string): void {
        const card = container.createDiv({ cls: 'ert-drag-confirm-impact-card' });
        const iconContainer = card.createDiv({ cls: 'ert-drag-confirm-row-icon' });
        this.setIcon(iconContainer, icon);
        const text = card.createDiv({ cls: 'ert-drag-confirm-impact-text' });
        text.createDiv({ cls: 'ert-drag-confirm-impact-label', text: label });
        text.createDiv({ cls: 'ert-drag-confirm-impact-value', text: value });
    }

    private renderMoveSummary(container: HTMLElement, summaryText: string): void {
        const [sourcePipe, targetPipe] = summaryText.split('|').map((part) => part.trim());
        if (sourcePipe && targetPipe) {
            container.createSpan({ text: sourcePipe });
            const inlineIcon = container.createSpan({ cls: 'ert-drag-confirm-inline-icon' });
            this.setIcon(inlineIcon, ICON_ARROW_RIGHT);
            container.createSpan({ text: targetPipe });
            return;
        }

        const beforeMatch = summaryText.match(/^(?:Move\s+)?(.+?)\s+before\s+(.+)$/i);
        if (beforeMatch) {
            container.createSpan({ text: beforeMatch[1].trim() });
            const inlineIcon = container.createSpan({ cls: 'ert-drag-confirm-inline-icon' });
            this.setIcon(inlineIcon, ICON_ARROW_RIGHT);
            container.createSpan({ text: beforeMatch[2].trim() });
            return;
        }

        container.setText(summaryText);
    }

    private formatRenameImpact(renameCount: number): string {
        if (!renameCount || renameCount <= 0) return 'No note renames';
        return `Renames ${renameCount} note${renameCount === 1 ? '' : 's'}`;
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
            this.primaryButtonEl.textContent = 'Dismiss';
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
