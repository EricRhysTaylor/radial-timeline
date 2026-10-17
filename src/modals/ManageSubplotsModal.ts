/*
 * Subplot manager modal
 * 
 * A specialized modal for managing subplots (rename, delete) with a custom UI 
 * that matches the Gossamer/Pulse aesthetic.
 */

import { App, Modal, ButtonComponent, setIcon } from 'obsidian';
import type RadialTimelinePlugin from '../main';
import { SubplotManagementService, SubplotStats, isSubplotNameTaken } from '../services/SubplotManagementService';
import { t, tCount } from '../i18n';
import { scheduleFocusAfterPaint } from '../utils/domFocus';
import { getActiveBookTitle } from '../utils/books';
import { IMPACT_FULL } from '../settings/SettingImpact';

/** The main plot's marker: home on the map, pinned to ring 1. Decorative — the text beside it names the role. */
function appendMainPlotPin(parent: HTMLElement): void {
    const pin = parent.createSpan({ cls: 'ert-main-plot-pin', attr: { 'aria-hidden': 'true' } });
    setIcon(pin, 'map-pin');
}

export class ManageSubplotsModal extends Modal {
    private plugin: RadialTimelinePlugin;
    private service: SubplotManagementService;
    private subplots: SubplotStats[] = [];
    
    // UI Elements
    private listContainer: HTMLElement | null = null;

    constructor(app: App, plugin: RadialTimelinePlugin) {
        super(app);
        this.plugin = plugin;
        // Instantiate service on demand, or could be passed in
        // Ideally checking if plugin has it, but for now new instance is fine as it's stateless-ish (depends on app/sceneDataService)
        this.service = new SubplotManagementService(app, plugin.getSceneDataService());
    }

    onOpen() {
        const { contentEl, modalEl } = this;
        contentEl.empty();
        
        // Apply generic modal shell + modal-specific class
        modalEl.classList.add('ert-ui', 'ert-scope--modal', 'ert-modal-shell', 'ert-modal--manage-subplots');
        contentEl.addClass('ert-modal-container', 'ert-stack', 'ert-manage-subplots-modal');

        // Hero Section (generic header)
        const hero = contentEl.createDiv({ cls: 'ert-modal-header' });
        hero.createSpan({ text: t('ui.manageSubplotsModal.badge'), cls: 'ert-modal-badge' });
        hero.createDiv({ text: t('commands.subplotManager'), cls: 'ert-modal-title' });
        hero.createDiv({ text: t('ui.manageSubplotsModal.subtitle'), cls: 'ert-modal-subtitle' });

        // Single card container (avoid extra nesting)
        const card = contentEl.createDiv({ cls: 'ert-manage-subplots-card ert-glass-card' });
        this.listContainer = card.createDiv({ cls: 'ert-manage-subplots-list' });

        const actions = contentEl.createDiv({ cls: 'ert-modal-actions' });
        new ButtonComponent(actions)
            .setButtonText(t('common.cancel'))
            .onClick(() => this.close());
        
        // Initial load
        void this.loadSubplots();
    }

    async loadSubplots() {
        this.subplots = await this.service.getSubplotStats();
        this.renderList();
    }

    renderList() {
        if (!this.listContainer) return;

        // Sort: main plot first, then by count (desc), then name
        const mainPlot = this.service.getMainPlotName();
        const sorted = [...this.subplots].sort((a, b) => {
            if (a.name === mainPlot) return -1;
            if (b.name === mainPlot) return 1;
            if (b.count !== a.count) return b.count - a.count;
            return a.name.localeCompare(b.name);
        });

        // Clear list
        this.listContainer.empty();
        
        // Header
        const header = this.listContainer.createDiv({ cls: 'ert-manage-subplots-header' });
        header.setText(t('ui.manageSubplotsModal.activeSubplots', { count: sorted.length }));

        // List Scroll Area
        const scrollArea = this.listContainer.createDiv({ cls: 'ert-manage-subplots-scroll' });

        sorted.forEach(subplot => {
            const row = scrollArea.createDiv({ cls: 'ert-manage-subplots-row' });
            
            // Left: Name and Count. The main plot is pinned to ring 1 whatever
            // it is called, so it carries the pin and says so.
            const isMainPlot = subplot.name === mainPlot;
            const info = row.createDiv({ cls: 'ert-manage-subplots-info' });
            
            const nameEl = info.createDiv({ cls: 'ert-manage-subplots-name' });
            if (isMainPlot) appendMainPlotPin(nameEl);
            nameEl.createSpan({ text: subplot.name });

            const countEl = info.createDiv({ cls: 'ert-manage-subplots-count' });
            const sceneCount = tCount('scene', subplot.count);
            countEl.setText(isMainPlot ? t('ui.manageSubplotsModal.mainPlotMeta', { scenes: sceneCount }) : sceneCount);

            // Right: Actions
            const actions = row.createDiv({ cls: 'ert-manage-subplots-actions' });

            // Rename Button (the main plot can be renamed, never deleted)
            const renameBtn = new ButtonComponent(actions)
                .setIcon('pencil-line')
                .setTooltip(t('ui.manageSubplotsModal.renameTooltip'))
                .onClick(() => this.handleRename(subplot.name));

            renameBtn.buttonEl.classList.add('ert-pulse-icon-button', 'ert-manage-subplots-btn');

            // Delete Button (Disable for the main plot)
            const deleteBtn = new ButtonComponent(actions)
                .setIcon('eraser')
                .setTooltip(isMainPlot ? t('ui.manageSubplotsModal.mainPlotCannotDelete') : t('ui.manageSubplotsModal.deleteTooltip'))
                .setDisabled(isMainPlot)
                .onClick(() => this.handleDelete(subplot.name));

            deleteBtn.buttonEl.classList.add('ert-pulse-icon-button', 'ert-manage-subplots-btn', 'ert-manage-subplots-delete-btn');
            
            if (isMainPlot) {
                deleteBtn.buttonEl.classList.add('ert-manage-subplots-disabled');
            }
        });
    }

    async handleRename(oldName: string) {
        const renamingMainPlot = oldName === this.service.getMainPlotName();
        new RenameSubplotModal(this.app, {
            oldName,
            isMainPlot: renamingMainPlot,
            scenesNote: t('ui.manageSubplotsModal.renameScenesNote', {
                scenes: tCount('scene', this.service.countScenesListing(oldName)),
                book: getActiveBookTitle(this.plugin.settings),
            }),
            // Renaming onto another subplot merges the two for good; the main
            // plot never may, since its scenes could not be told apart again.
            nameTaken: renamingMainPlot ? (name) => isSubplotNameTaken(this.subplots, oldName, name) : () => false,
        }, async (newName) => {
            await this.service.renameSubplot(oldName, newName);
            // The rename may have changed settings (the book's main plot name,
            // Dominant Subplots); persist them.
            await this.plugin.saveSettings();
            // Scenes with no Subplot change rings without any file edit.
            if (renamingMainPlot) this.plugin.onSettingChanged(IMPACT_FULL);
            await this.loadSubplots();
        }).open();
    }

    async handleDelete(subplotName: string) {
        new SubplotDeletionConfirmModal(this.app, subplotName, async () => {
            await this.service.deleteSubplot(subplotName);
            await this.loadSubplots();
        }).open();
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}

/**
 * Confirmation Modal for Deletion
 */
class SubplotDeletionConfirmModal extends Modal {
    private subplotName: string;
    private onConfirm: () => Promise<void>;

    constructor(app: App, subplotName: string, onConfirm: () => Promise<void>) {
        super(app);
        this.subplotName = subplotName;
        this.onConfirm = onConfirm;
    }

    onOpen() {
        const { contentEl, modalEl, titleEl } = this;
        contentEl.empty();
        titleEl.setText('');
        
        if (modalEl) {
            modalEl.classList.add('ert-ui', 'ert-scope--modal', 'ert-modal-shell');
            modalEl.setCssStyles({ width: '600px', maxWidth: '92vw' }); // SAFE: Modal sizing via inline styles (Obsidian pattern)
        }
        contentEl.addClass('ert-modal-container', 'ert-stack');

        // Header
        const header = contentEl.createDiv({ cls: 'ert-modal-header' });
        header.createSpan({ cls: 'ert-modal-badge', text: t('ui.manageSubplotsModal.removeBadge') });
        header.createDiv({ cls: 'ert-modal-title', text: t('ui.manageSubplotsModal.removeTitle') });
        header.createDiv({ cls: 'ert-modal-subtitle', text: t('ui.manageSubplotsModal.removeSubtitle') });
        const meta = header.createDiv({ cls: 'ert-modal-meta' });
        meta.createSpan({ cls: 'ert-modal-meta-item', text: t('ui.manageSubplotsModal.removeMeta') });

        // Warning card
        const card = contentEl.createDiv({ cls: 'ert-panel ert-panel--glass' });
        const warningEl = card.createDiv({ cls: 'ert-pulse-warning' });
        warningEl.setText(t('ui.manageSubplotsModal.removeConfirm', { subplot: this.subplotName }));

        // Actions
        const buttonRow = contentEl.createDiv({ cls: 'ert-modal-actions' });

        new ButtonComponent(buttonRow)
            .setButtonText(t('ui.manageSubplotsModal.removeButton'))
            .setDestructive()
            .onClick(async () => {
                await this.onConfirm();
                this.close();
            });

        new ButtonComponent(buttonRow)
            .setButtonText(t('common.cancel'))
            .onClick(() => this.close());
    }

    onClose() {
        this.contentEl.empty();
    }
}

/**
 * Modal for Renaming
 */
class RenameSubplotModal extends Modal {
    constructor(
        app: App,
        private readonly options: {
            oldName: string;
            isMainPlot: boolean;
            /** Which scenes the rename edits, shown before anything is written. */
            scenesNote: string;
            nameTaken: (name: string) => boolean;
        },
        private readonly onRename: (newName: string) => Promise<void>,
    ) {
        super(app);
    }

    onOpen() {
        const { contentEl, modalEl } = this;
        const { oldName, isMainPlot, scenesNote, nameTaken } = this.options;
        contentEl.empty();
        
        // Shell & Container (matching PlanetaryTimeModal)
        modalEl.classList.add('ert-ui', 'ert-scope--modal', 'ert-modal-shell', 'ert-rename-subplot-modal');
        contentEl.addClass('ert-modal-container', 'ert-stack');

        // Header (matching PlanetaryTimeModal)
        const header = contentEl.createDiv({ cls: 'ert-modal-header' });
        header.createSpan({ cls: 'ert-modal-badge', text: t('ui.manageSubplotsModal.renameBadge') });
        header.createDiv({ cls: 'ert-modal-title', text: t('ui.manageSubplotsModal.renameTitle') });
        header.createDiv({ cls: 'ert-modal-subtitle', text: t('ui.manageSubplotsModal.renameSubtitle', { subplot: oldName }) });
        if (isMainPlot) {
            const note = header.createDiv({ cls: 'ert-modal-subtitle ert-main-plot-note' });
            appendMainPlotPin(note);
            note.createSpan({ text: t('ui.manageSubplotsModal.mainPlotRenameNote') });
        }
        header.createDiv({ cls: 'ert-modal-subtitle', text: scenesNote });

        // Input Field (Large template input field style)
        // Container with border
        const inputContainer = contentEl.createDiv({ 
            cls: 'ert-search-input-container',
        });
        
        const inputEl = inputContainer.createEl('input', { 
            type: 'text', 
            value: oldName, 
            cls: 'ert-input--full' 
        });
        let takenEl: HTMLElement | null = null;

        scheduleFocusAfterPaint(inputEl, { selectText: true });

        // Actions
        const buttonRow = contentEl.createDiv({ cls: 'ert-modal-actions' });
        
        const save = async () => {
            const val = inputEl.value.trim();
            if (val === oldName) {
                this.close();
                return;
            }
            if (!val) return;
            if (nameTaken(val)) {
                if (!takenEl) {
                    takenEl = createDiv({ cls: 'ert-pulse-warning' });
                    inputContainer.after(takenEl);
                }
                takenEl.setText(t('ui.manageSubplotsModal.mainPlotNameTaken', { name: val }));
                return;
            }
            await this.onRename(val);
            this.close();
        };

        new ButtonComponent(buttonRow)
            .setButtonText(t('ui.manageSubplotsModal.renameButton'))
            .setCta()
            .onClick(save);

        new ButtonComponent(buttonRow)
            .setButtonText(t('common.cancel'))
            .onClick(() => this.close());
        
        // Handle Enter key
        inputEl.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') void save();
            if (e.key === 'Escape') this.close();
        });
    }

    onClose() {
        this.contentEl.empty();
    }
}
