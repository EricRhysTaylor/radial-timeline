import { App, DropdownComponent, TextComponent, ToggleComponent, setIcon } from 'obsidian';
import { ErtModal } from '../ui/ErtModal';
import type { PromotionPlan } from '../services/PromoteToSceneService';
import { t, tCount } from '../i18n';
import { safeTitle } from '../utils/noteTitle';

/** A scene the author can number a promoted note after. */
export interface PromotionAnchorOption {
    path: string;
    label: string;
}

export interface PromotionChoice {
    advanced: boolean;
    /** Number the note after this scene; null keeps its current name. */
    anchorPath: string | null;
    /** The title typed for a note that still had a placeholder name; null otherwise. */
    title: string | null;
}

export interface PromoteToSceneModalOptions {
    advancedDefault: boolean;
    /** Book title, or a "several books" label when the plan spans books. */
    bookLabel: string;
    /** Single unnumbered note only: scenes in manuscript order. */
    anchors: PromotionAnchorOption[] | null;
    /** Single note with a placeholder name ("Untitled sketch"): ask for its title, and promote only once it has one. */
    askTitle: boolean;
}

const NAME_LIST_LIMIT = 6;

/**
 * Confirm dialog for Promote to scene. Follows the Add scene confirm pattern:
 * confirm, then the modal stays open while the caller applies the promotion
 * and reports progress, then a summary the author dismisses.
 */
export class PromoteToSceneModal extends ErtModal {
    private phase: 'confirm' | 'running' | 'done' = 'confirm';
    private closed = false;
    private advanced: boolean;
    private anchorPath: string | null = null;
    private title = '';
    private beginResolver: ((choice: PromotionChoice | null) => void) | null = null;
    private dismissResolver: (() => void) | null = null;
    private primaryButtonEl: HTMLButtonElement | null = null;
    private cancelButtonEl: HTMLButtonElement | null = null;
    private statusRowEl: HTMLElement | null = null;
    private statusTextEl: HTMLElement | null = null;
    private fieldsTextEl: HTMLElement | null = null;
    private backdropGuard: ((evt: MouseEvent) => void) | null = null;

    constructor(app: App, private readonly plan: PromotionPlan, private readonly options: PromoteToSceneModalOptions) {
        super(app);
        this.advanced = options.advancedDefault;
    }

    onOpen(): void {
        const { contentEl } = this;
        this.closed = false;
        contentEl.empty();
        this.applyShell({ width: 'min(660px, 90vw)' });
        contentEl.addClass('ert-drag-confirm-modal');

        this.scope.register([], 'Escape', () => {
            if (this.phase === 'confirm') {
                this.resolveBegin(null);
                this.close();
            }
            return false;
        });

        // Once the promotion runs, a stray backdrop click must not close the
        // modal and lose the summary (same guard as Add scene).
        this.backdropGuard = (evt: MouseEvent) => {
            if (this.phase === 'confirm' || evt.target !== this.containerEl) return;
            evt.preventDefault();
            evt.stopPropagation();
            evt.stopImmediatePropagation();
        };
        this.containerEl.addEventListener('mousedown', this.backdropGuard, true);
        this.containerEl.addEventListener('click', this.backdropGuard, true);

        const single = this.plan.entries.length === 1;
        const only = single ? this.plan.entries[0] : undefined;
        this.mountHeader({
            badge: { text: t('ui.promoteToScene.badge') },
            title: single ? t('ui.promoteToScene.titleOne') : t('ui.promoteToScene.titleMany'),
        });

        const listDiv = contentEl.createDiv({ cls: 'ert-drag-confirm-list' });
        const section = listDiv.createDiv({ cls: 'ert-drag-confirm-section' });
        section.createDiv({ cls: 'ert-drag-confirm-section-title', text: t('ui.promoteToScene.summaryTitle') });

        let titleInput: TextComponent | null = null;
        if (only) {
            this.addRow(section, 'file-up', t('ui.promoteToScene.promoteOne', { name: only.file.basename, book: this.options.bookLabel }));
            if (only.fromSketch) this.addRow(section, 'pencil-line', t('ui.promoteToScene.fromSketch'));
            if (this.options.askTitle) {
                const titleRow = this.addRow(section, 'text-cursor-input', t('ui.promoteToScene.titleLabel'));
                const titleSlot = titleRow.parentElement?.createDiv({ cls: 'ert-drag-confirm-row-control' });
                if (titleSlot) {
                    titleInput = new TextComponent(titleSlot)
                        .setPlaceholder(t('ui.promoteToScene.titlePlaceholder'))
                        .onChange(value => {
                            this.title = value;
                            this.updateConfirmState();
                        });
                }
            }
        } else {
            this.addRow(section, 'file-up', t('ui.promoteToScene.promoteMany', {
                notes: tCount('note', this.plan.entries.length),
                book: this.options.bookLabel,
            }));
            this.addRow(section, 'list', this.nameList());
        }

        const fieldsRow = this.addRow(section, 'braces', '');
        this.fieldsTextEl = fieldsRow;
        this.renderFieldsText();

        const toggleRow = this.addRow(section, 'sliders-horizontal', t('ui.promoteToScene.advancedToggle'));
        const toggleSlot = toggleRow.parentElement?.createDiv({ cls: 'ert-drag-confirm-row-control' });
        if (toggleSlot) {
            new ToggleComponent(toggleSlot)
                .setValue(this.advanced)
                .onChange(value => {
                    this.advanced = value;
                    this.renderFieldsText();
                });
        }

        if (only && !only.prefix && this.options.anchors && this.options.anchors.length > 0) {
            const positionRow = this.addRow(section, 'list-ordered', t('ui.promoteToScene.positionLabel'));
            const dropdownSlot = positionRow.parentElement?.createDiv({ cls: 'ert-drag-confirm-row-control' });
            if (dropdownSlot) {
                const dropdown = new DropdownComponent(dropdownSlot);
                dropdown.addOption('', t('ui.promoteToScene.keepName'));
                for (const anchor of this.options.anchors) {
                    dropdown.addOption(anchor.path, t('ui.promoteToScene.afterScene', { scene: anchor.label }));
                }
                dropdown.setValue('');
                dropdown.onChange(value => { this.anchorPath = value || null; });
            }
        } else if (only?.prefix) {
            this.addRow(section, 'list-ordered', t('ui.promoteToScene.keepsNumber', { prefix: only.prefix }));
        } else if (!single) {
            const unnumbered = this.plan.entries.filter(entry => !entry.prefix).length;
            if (unnumbered > 0) {
                this.addRow(section, 'list-ordered', t('ui.promoteToScene.unnumberedMany', { notes: tCount('note', unnumbered) }));
            }
        }

        this.addRow(section, 'shield-check', t('ui.promoteToScene.keepsValues'));

        const alreadyScenes = this.plan.skipped.filter(skip => skip.reason === 'alreadyScene').length;
        const otherClass = this.plan.skipped.filter(skip => skip.reason === 'otherClass').length;
        const outside = this.plan.skipped.filter(skip => skip.reason === 'notInBook').length;
        if (alreadyScenes > 0) this.addRow(section, 'circle-slash', t('ui.promoteToScene.skippedScenes', { notes: tCount('note', alreadyScenes) }));
        if (otherClass > 0) this.addRow(section, 'circle-slash', t('ui.promoteToScene.skippedOtherClass', { notes: tCount('note', otherClass) }));
        if (outside > 0) this.addRow(section, 'circle-slash', t('ui.promoteToScene.skippedOutside', { notes: tCount('note', outside) }));

        const statusRow = listDiv.createDiv({ cls: 'ert-drag-confirm-row is-status-row is-hidden' });
        const statusIcon = statusRow.createDiv({ cls: 'ert-drag-confirm-row-icon' });
        setIcon(statusIcon, 'file-up');
        this.statusTextEl = statusRow.createDiv({ cls: 'ert-drag-confirm-row-text ert-drag-confirm-status-text' });
        this.statusTextEl.setText(t('ui.promoteToScene.preparing'));
        this.statusRowEl = statusRow;

        const actions = this.mountActions();
        const confirmButton = actions.createEl('button', { text: t('ui.promoteToScene.promoteButton'), cls: 'ert-mod-cta' });
        const cancelButton = actions.createEl('button', { text: t('common.cancel') });
        this.primaryButtonEl = confirmButton;
        this.cancelButtonEl = cancelButton;

        this.updateConfirmState();
        // Enter in the title field promotes, once there is a title.
        titleInput?.inputEl.addEventListener('keydown', (evt: KeyboardEvent) => {
            if (evt.key !== 'Enter' || confirmButton.disabled) return;
            evt.preventDefault();
            confirmButton.click();
        });
        titleInput?.inputEl.focus();

        confirmButton.addEventListener('click', () => {
            if (this.phase === 'confirm') {
                if (!this.hasTitle()) return;
                this.phase = 'running';
                this.showStatusRow('is-live');
                confirmButton.disabled = true;
                confirmButton.textContent = t('ui.promoteToScene.workingButton');
                cancelButton.classList.add('is-hidden-action');
                this.resolveBegin({ advanced: this.advanced, anchorPath: this.anchorPath, title: this.options.askTitle ? safeTitle(this.title) : null });
                return;
            }
            if (this.phase === 'done') {
                this.resolveDismiss();
                this.close();
            }
        });
        cancelButton.addEventListener('click', () => {
            if (this.phase !== 'confirm') return;
            this.resolveBegin(null);
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
        this.resolveBegin(null);
        this.resolveDismiss();
        this.contentEl.empty();
    }

    /** Open, and resolve with the author's choices, or null when cancelled. */
    async waitForBegin(): Promise<PromotionChoice | null> {
        return await new Promise<PromotionChoice | null>(resolve => {
            this.beginResolver = resolve;
            this.open();
        });
    }

    updateProgress(message: string): void {
        if (this.closed || this.phase !== 'running') return;
        this.statusTextEl?.setText(message);
    }

    async finishWithDismiss(message: string, isError = false): Promise<void> {
        if (this.closed) return;
        this.phase = 'done';
        this.showStatusRow(isError ? 'is-error' : 'is-complete');
        this.statusTextEl?.setText(message);
        this.cancelButtonEl?.classList.add('is-hidden-action');
        if (this.primaryButtonEl) {
            this.primaryButtonEl.disabled = false;
            this.primaryButtonEl.textContent = t('ui.promoteToScene.doneButton');
        }
        await new Promise<void>(resolve => { this.dismissResolver = resolve; });
    }

    /** A note with a placeholder name promotes only once it has a usable title. */
    private hasTitle(): boolean {
        return !this.options.askTitle || safeTitle(this.title).length > 0;
    }

    private updateConfirmState(): void {
        if (this.phase === 'confirm' && this.primaryButtonEl) this.primaryButtonEl.disabled = !this.hasTitle();
    }

    private renderFieldsText(): void {
        if (!this.fieldsTextEl) return;
        const single = this.plan.entries.length === 1;
        if (!single) {
            this.fieldsTextEl.setText(t('ui.promoteToScene.fieldsMany'));
            return;
        }
        const entry = this.plan.entries[0];
        const keys = this.advanced
            ? [...entry.missingCoreKeys, ...entry.missingAdvancedKeys]
            : entry.missingCoreKeys;
        this.fieldsTextEl.setText(keys.length > 0
            ? t('ui.promoteToScene.fieldsOne', { list: keys.join(', ') })
            : t('ui.promoteToScene.fieldsNone'));
    }

    private nameList(): string {
        const names = this.plan.entries.map(entry => entry.file.basename);
        const shown = names.slice(0, NAME_LIST_LIMIT).join(', ');
        const rest = names.length - NAME_LIST_LIMIT;
        return rest > 0 ? t('ui.promoteToScene.namesAndMore', { names: shown, notes: tCount('note', rest) }) : shown;
    }

    /** Adds a summary row and returns its text element. */
    private addRow(container: HTMLElement, icon: string, text: string): HTMLElement {
        const row = container.createDiv({ cls: 'ert-drag-confirm-row' });
        const iconEl = row.createDiv({ cls: 'ert-drag-confirm-row-icon' });
        setIcon(iconEl, icon);
        return row.createDiv({ cls: 'ert-drag-confirm-row-text', text });
    }

    private showStatusRow(stateClass: 'is-live' | 'is-complete' | 'is-error'): void {
        if (!this.statusRowEl) return;
        this.statusRowEl.classList.remove('is-hidden', 'is-live', 'is-complete', 'is-error');
        this.statusRowEl.classList.add(stateClass);
    }

    private resolveBegin(choice: PromotionChoice | null): void {
        const resolve = this.beginResolver;
        this.beginResolver = null;
        resolve?.(choice);
    }

    private resolveDismiss(): void {
        const resolve = this.dismissResolver;
        this.dismissResolver = null;
        resolve?.();
    }
}
