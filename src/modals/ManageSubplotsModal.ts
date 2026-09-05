/*
 * Manage Subplots Modal
 * 
 * A specialized modal for managing subplots (rename, delete) with a custom UI 
 * that matches the Gossamer/Pulse aesthetic.
 */

import { App, Modal, ButtonComponent } from 'obsidian';
import type RadialTimelinePlugin from '../main';
import { SubplotManagementService, SubplotStats } from '../services/SubplotManagementService';
import { scheduleFocusAfterPaint } from '../utils/domFocus';

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
        hero.createSpan({ text: 'Configuration', cls: 'ert-modal-badge' });
        hero.createDiv({ text: 'Manage Subplots', cls: 'ert-modal-title' });
        hero.createDiv({ text: 'Rename or remove subplots across the timeline. Orphaned scenes will be moved to Main Plot.', cls: 'ert-modal-subtitle' });

        // Single card container (avoid extra nesting)
        const card = contentEl.createDiv({ cls: 'ert-manage-subplots-card ert-glass-card' });
        this.listContainer = card.createDiv({ cls: 'ert-manage-subplots-list' });

        const actions = contentEl.createDiv({ cls: 'ert-modal-actions' });
        new ButtonComponent(actions)
            .setButtonText('Cancel')
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

        // Sort: Main Plot first, then by count (desc), then name
        const sorted = [...this.subplots].sort((a, b) => {
            if (a.name === "Main Plot") return -1;
            if (b.name === "Main Plot") return 1;
            if (b.count !== a.count) return b.count - a.count;
            return a.name.localeCompare(b.name);
        });

        // Clear list
        this.listContainer.empty();
        
        // Header
        const header = this.listContainer.createDiv({ cls: 'ert-manage-subplots-header' });
        header.setText(`Active Subplots · ${sorted.length}`);

        // List Scroll Area
        const scrollArea = this.listContainer.createDiv({ cls: 'ert-manage-subplots-scroll' });

        sorted.forEach(subplot => {
            const row = scrollArea.createDiv({ cls: 'ert-manage-subplots-row' });
            
            // Left: Name and Count
            const info = row.createDiv({ cls: 'ert-manage-subplots-info' });
            
            const nameEl = info.createDiv({ cls: 'ert-manage-subplots-name' });
            nameEl.setText(subplot.name);

            const countEl = info.createDiv({ cls: 'ert-manage-subplots-count' });
            countEl.setText(`${subplot.count} scenes`);

            // Right: Actions
            const actions = row.createDiv({ cls: 'ert-manage-subplots-actions' });

            // Rename Button
            const renameBtn = new ButtonComponent(actions)
                .setIcon('pencil-line')
                .setTooltip('Rename')
                .setDisabled(subplot.name === "Main Plot")
                .onClick(() => this.handleRename(subplot.name));

            renameBtn.buttonEl.classList.add('ert-pulse-icon-button', 'ert-manage-subplots-btn');

            // Delete Button (Disable for Main Plot)
            const isMainPlot = subplot.name === "Main Plot";
            const deleteBtn = new ButtonComponent(actions)
                .setIcon('eraser')
                .setTooltip(isMainPlot ? 'Main Plot cannot be deleted' : 'Delete')
                .setDisabled(isMainPlot)
                .onClick(() => this.handleDelete(subplot.name));

            deleteBtn.buttonEl.classList.add('ert-pulse-icon-button', 'ert-manage-subplots-btn', 'ert-manage-subplots-delete-btn');
            
            if (isMainPlot) {
                deleteBtn.buttonEl.classList.add('ert-manage-subplots-disabled');
                renameBtn.buttonEl.classList.add('ert-manage-subplots-disabled');
            }
        });
    }

    async handleRename(oldName: string) {
        new RenameSubplotModal(this.app, oldName, async (newName) => {
             if (newName && newName !== oldName) {
                await this.service.renameSubplot(oldName, newName);
                await this.loadSubplots();
             }
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
        header.createSpan({ cls: 'ert-modal-badge', text: 'Warning' });
        header.createDiv({ cls: 'ert-modal-title', text: 'Remove subplot?' });
        header.createDiv({ cls: 'ert-modal-subtitle', text: 'This action cannot be undone.' });
        const meta = header.createDiv({ cls: 'ert-modal-meta' });
        meta.createSpan({ cls: 'ert-modal-meta-item', text: 'Scenes in only this subplot will be moved to Main Plot' });

        // Warning card
        const card = contentEl.createDiv({ cls: 'ert-panel ert-panel--glass' });
        const warningEl = card.createDiv({ cls: 'ert-pulse-warning' });
        warningEl.setText(`Are you sure you want to remove "${this.subplotName}" from the timeline?`);

        // Actions
        const buttonRow = contentEl.createDiv({ cls: 'ert-modal-actions' });

        new ButtonComponent(buttonRow)
            .setButtonText('Remove subplot')
            .setDestructive()
            .onClick(async () => {
                await this.onConfirm();
                this.close();
            });

        new ButtonComponent(buttonRow)
            .setButtonText('Cancel')
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
    private oldName: string;
    private onRename: (newName: string) => Promise<void>;

    constructor(app: App, oldName: string, onRename: (newName: string) => Promise<void>) {
        super(app);
        this.oldName = oldName;
        this.onRename = onRename;
    }

    onOpen() {
        const { contentEl, modalEl } = this;
        contentEl.empty();
        
        // Shell & Container (matching PlanetaryTimeModal)
        modalEl.classList.add('ert-ui', 'ert-scope--modal', 'ert-modal-shell', 'ert-rename-subplot-modal');
        contentEl.addClass('ert-modal-container', 'ert-stack');

        // Header (matching PlanetaryTimeModal)
        const header = contentEl.createDiv({ cls: 'ert-modal-header' });
        header.createSpan({ cls: 'ert-modal-badge', text: 'Edit' });
        header.createDiv({ cls: 'ert-modal-title', text: 'Rename subplot' });
        header.createDiv({ cls: 'ert-modal-subtitle', text: `Enter a new name for "${this.oldName}"` });

        // Input Field (Large template input field style)
        // Container with border
        const inputContainer = contentEl.createDiv({ 
            cls: 'ert-search-input-container',
        });
        
        const inputEl = inputContainer.createEl('input', { 
            type: 'text', 
            value: this.oldName, 
            cls: 'ert-input--full' 
        });

        scheduleFocusAfterPaint(inputEl, { selectText: true });

        // Actions
        const buttonRow = contentEl.createDiv({ cls: 'ert-modal-actions' });
        
        const save = async () => {
            const val = inputEl.value.trim();
            if (val && val !== this.oldName) {
                await this.onRename(val);
                this.close();
            } else if (val === this.oldName) {
                this.close();
            }
        };

        new ButtonComponent(buttonRow)
            .setButtonText('Rename')
            .setCta()
            .onClick(save);

        new ButtonComponent(buttonRow)
            .setButtonText('Cancel')
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
