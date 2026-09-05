import { App, Modal, ButtonComponent, DropdownComponent, Notice } from 'obsidian';
import { NamePromptModal } from '../ui/NamePromptModal';
import type RadialTimelinePlugin from '../main';
import { AiContextTemplate } from '../types/settings';
import { buildDefaultAiSettings } from '../ai/settings/aiSettings';
import { validateAiSettings } from '../ai/settings/validateAiSettings';
import { confirmWithErtModal } from '../modals/ErtConfirmModal';

/**
 * AiContextModal allows users to manage AI context templates for story analysis.
 * Users can select, create, edit, rename, and delete custom templates.
 * Built-in templates are read-only but can be copied.
 */
export class AiContextModal extends Modal {
    private readonly plugin: RadialTimelinePlugin;
    private readonly onSave: () => void;
    
    private currentTemplateId: string;
    private templates: AiContextTemplate[];
    private isDirty: boolean = false;
    
    private dropdownComponent?: DropdownComponent;
    private textareaEl?: HTMLTextAreaElement;
    private _inputHandler?: () => void;
    private saveButton?: ButtonComponent;
    private deleteButton?: ButtonComponent;
    private renameButton?: ButtonComponent;
    private copyButton?: ButtonComponent;

    constructor(app: App, plugin: RadialTimelinePlugin, onSave: () => void) {
        super(app);
        this.plugin = plugin;
        this.onSave = onSave;
        const aiSettings = validateAiSettings(plugin.settings.aiSettings ?? buildDefaultAiSettings()).value;
        this.plugin.settings.aiSettings = aiSettings;

        // Clone templates to allow cancel without saving
        this.templates = structuredClone(aiSettings.roleTemplates || []);
        this.currentTemplateId = aiSettings.roleTemplateId || 'commercial_genre';
    }

    onOpen(): void {
        const { contentEl, titleEl, modalEl } = this;
        // Use generic modal base + AI Context specific styling
        if (modalEl) {
            modalEl.classList.add('ert-ui', 'ert-scope--modal', 'ert-modal-shell');
            modalEl.setCssStyles({ width: '660px', maxWidth: '92vw', maxHeight: '92vh' }); // SAFE: Modal sizing via inline styles (Obsidian pattern)
        }
        titleEl.setText('');
        contentEl.addClass('ert-modal-container', 'ert-modal--aiContext', 'ert-stack');

        const hero = contentEl.createDiv({ cls: 'ert-modal-header' });
        hero.createDiv({ cls: 'ert-modal-title', text: 'AI context templates' });
        hero.createDiv({
            cls: 'ert-modal-subtitle',
            text: 'Define context prepended to AI prompts and Gossamer scoring.'
        });

        // Info section
        const infoEl = contentEl.createDiv({ cls: 'ert-field-note ert-ai-context-info' });
        infoEl.setText('Define context for AI LLM analysis and pulse triplet editorial feedback. This text prepends select prompts to establish role and context and is used for the copy template button to generate Gossamer scores.');

        // Template selector row
        const selectorRow = contentEl.createDiv({ cls: 'ert-row' });
        selectorRow.createDiv({ cls: 'ert-label', text: 'Template' });
        const selectorControl = selectorRow.createDiv({ cls: 'ert-control' });
        const selectorInputRow = selectorControl.createDiv({ cls: 'ert-ai-context-selector-row' });
        
        // Dropdown for template selection
        this.dropdownComponent = new DropdownComponent(selectorInputRow);
        this.dropdownComponent.selectEl.addClass('ert-input');
        this.updateDropdownOptions();
        this.dropdownComponent.setValue(this.currentTemplateId);
        this.dropdownComponent.onChange(async (value) => {
            if (this.isDirty) {
                const discard = await confirmWithErtModal(this.app, {
                    title: 'Discard changes?',
                    message: 'You have unsaved changes. Discard them?',
                    confirmText: 'Discard'
                });
                if (!discard) {
                    // Revert dropdown to previous selection
                    this.dropdownComponent?.setValue(this.currentTemplateId);
                    return;
                }
                this.isDirty = false;
            }
            this.currentTemplateId = value;
            this.updateEditorSection();
        });
        
        // Template management buttons row
        const templateActionsRow = contentEl.createDiv({ cls: 'ert-row' });
        templateActionsRow.createDiv({ cls: 'ert-label', attr: { 'aria-hidden': 'true' } });
        const templateActionsControl = templateActionsRow.createDiv({ cls: 'ert-control' });
        const buttonRow = templateActionsControl.createDiv({ cls: 'ert-ai-context-button-row' });
        
        // New Template button
        new ButtonComponent(buttonRow)
            .setButtonText('New')
            .onClick(() => this.createNewTemplate());
        
        // Rename button
        this.renameButton = new ButtonComponent(buttonRow)
            .setButtonText('Rename')
            .onClick(() => this.renameTemplate());
        
        // Copy button (for built-in templates)
        this.copyButton = new ButtonComponent(buttonRow)
            .setButtonText('Copy')
            .onClick(() => this.copyTemplate());
        
        // Delete button
        this.deleteButton = new ButtonComponent(buttonRow)
            .setButtonText('Delete')
            .setDestructive()
            .onClick(() => { void this.deleteTemplate(); });

        // Editor row
        const editorRow = contentEl.createDiv({ cls: 'ert-row ert-row--wideControl' });
        editorRow.createDiv({ cls: 'ert-label', text: 'Prompt' });
        const editorControl = editorRow.createDiv({ cls: 'ert-control' });

        // Textarea for editing prompt
        this.textareaEl = editorControl.createEl('textarea', { cls: 'ert-textarea ert-ai-context-textarea' });
        this.textareaEl.placeholder = 'Enter your AI context prompt here...';
        
        // Track changes
        const handleInput = () => {
            const currentTemplate = this.getCurrentTemplate();
            if (currentTemplate && !currentTemplate.isBuiltIn) {
                this.isDirty = true;
                this.updateButtonStates();
            }
        };
        // Note: Modal classes don't have registerDomEvent, use addEventListener instead
        // Cleanup handled in onClose()
        this.textareaEl.addEventListener('input', handleInput);
        
        // Store handler reference for cleanup
        this._inputHandler = handleInput;

        // Action buttons
        const actionRow = contentEl.createDiv({ cls: 'ert-modal-actions' });
        
        // Save button
        this.saveButton = new ButtonComponent(actionRow)
            .setButtonText('Save changes')
            .setCta()
            .onClick(() => { void this.saveChanges(); });
        
        // Set Active button
        new ButtonComponent(actionRow)
            .setButtonText('Set as active & close')
            .onClick(() => { void this.setActiveAndClose(); });
        
        // Close button
        new ButtonComponent(actionRow)
            .setButtonText('Cancel')
            .onClick(async () => {
                if (this.isDirty) {
                    const discard = await confirmWithErtModal(this.app, {
                        title: 'Discard changes?',
                        message: 'You have unsaved changes. Discard them?',
                        confirmText: 'Discard'
                    });
                    if (!discard) return;
                }
                this.close();
            });

        // Initialize editor state
        this.updateEditorSection();
        this.updateButtonStates();
    }

    onClose(): void {
        // Clean up event listeners to prevent memory leaks
        if (this.textareaEl && this._inputHandler) {
            this.textareaEl.removeEventListener('input', this._inputHandler);
        }
    }


    private updateDropdownOptions(): void {
        if (!this.dropdownComponent) return;
        
        // Clear existing options
        this.dropdownComponent.selectEl.empty();
        
        // Add all templates
        this.templates.forEach(template => {
            const label = template.isBuiltIn ? `${template.name} (Built-in)` : template.name;
            this.dropdownComponent!.addOption(template.id, label);
        });
    }

    private getCurrentTemplate(): AiContextTemplate | undefined {
        return this.templates.find(t => t.id === this.currentTemplateId);
    }

    private updateEditorSection(): void {
        const currentTemplate = this.getCurrentTemplate();
        if (!currentTemplate) return;
        
        if (this.textareaEl) {
            this.textareaEl.value = currentTemplate.prompt;
            this.textareaEl.disabled = currentTemplate.isBuiltIn;
        }
        
        this.isDirty = false;
        this.updateButtonStates();
    }

    private updateButtonStates(): void {
        const currentTemplate = this.getCurrentTemplate();
        if (!currentTemplate) return;
        
        const isBuiltIn = currentTemplate.isBuiltIn;
        
        // Save button only enabled for custom templates with changes
        if (this.saveButton) {
            this.saveButton.setDisabled(isBuiltIn || !this.isDirty);
        }
        
        // Delete and Rename only for custom templates
        if (this.deleteButton) {
            this.deleteButton.setDisabled(isBuiltIn);
        }
        if (this.renameButton) {
            this.renameButton.setDisabled(isBuiltIn);
        }
        
        // Copy button only visible/enabled for built-in templates
        if (this.copyButton) {
            this.copyButton.setDisabled(!isBuiltIn);
        }
    }

    private createNewTemplate(): void {
        // Get current template's prompt to use as starting point
        const currentTemplate = this.getCurrentTemplate();
        const basePrompt = currentTemplate?.prompt || '';
        
        const modal = new NamePromptModal(this.app, {
            title: 'Enter template name',
            initialValue: '',
            actionLabel: 'OK',
            emptyNotice: 'Please enter a template name',
            shell: { width: '480px' },
            onSubmit: (name) => {
                // Generate unique ID
                const id = `custom-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
                
                // Create new template with current template's prompt as starting point
                const newTemplate: AiContextTemplate = {
                    id,
                    name: name,
                    prompt: basePrompt,
                    isBuiltIn: false
                };
                
                this.templates.push(newTemplate);
                this.updateDropdownOptions();
                this.dropdownComponent?.setValue(id);
                this.currentTemplateId = id;
                this.updateEditorSection();
                
                void this.persistTemplates(`Created template: ${name}`);
            }
        });
        modal.open();
    }

    private renameTemplate(): void {
        const currentTemplate = this.getCurrentTemplate();
        if (!currentTemplate || currentTemplate.isBuiltIn) return;
        
        const modal = new NamePromptModal(this.app, {
            title: 'Enter new name',
            initialValue: currentTemplate.name,
            actionLabel: 'OK',
            emptyNotice: 'Please enter a template name',
            shell: { width: '480px' },
            onSubmit: (newName) => {
                currentTemplate.name = newName;
                this.updateDropdownOptions();
                this.dropdownComponent?.setValue(this.currentTemplateId);
                void this.persistTemplates(`Renamed to: ${newName}`);
            }
        });
        modal.open();
    }

    private copyTemplate(): void {
        const currentTemplate = this.getCurrentTemplate();
        if (!currentTemplate) return;
        
        const modal = new NamePromptModal(this.app, {
            title: 'Enter name for copy',
            initialValue: `${currentTemplate.name} (Copy)`,
            actionLabel: 'OK',
            emptyNotice: 'Please enter a template name',
            shell: { width: '480px' },
            onSubmit: (name) => {
                // Generate unique ID
                const id = `custom-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
                
                const newTemplate: AiContextTemplate = {
                    id,
                    name: name,
                    prompt: currentTemplate.prompt,
                    isBuiltIn: false
                };
                
                this.templates.push(newTemplate);
                this.updateDropdownOptions();
                this.dropdownComponent?.setValue(id);
                this.currentTemplateId = id;
                this.updateEditorSection();
                
                void this.persistTemplates(`Created copy: ${name}`);
            }
        });
        modal.open();
    }

    private async deleteTemplate(): Promise<void> {
        const currentTemplate = this.getCurrentTemplate();
        if (!currentTemplate || currentTemplate.isBuiltIn) return;
        
        const confirmed = await confirmWithErtModal(this.app, {
            title: `Delete template "${currentTemplate.name}"?`,
            message: 'This cannot be undone.',
            confirmText: 'Delete'
        });
        if (!confirmed) return;
        
        // Remove template
        this.templates = this.templates.filter(t => t.id !== this.currentTemplateId);
        
        // Switch to first available template
        if (this.templates.length > 0) {
            this.currentTemplateId = this.templates[0].id;
        } else {
            // Fallback (should not occur with built-ins present)
            this.currentTemplateId = 'commercial_genre';
        }
        
        this.updateDropdownOptions();
        this.dropdownComponent?.setValue(this.currentTemplateId);
        this.updateEditorSection();
        
        await this.persistTemplates(`Deleted template: ${currentTemplate.name}`);
    }

    /**
     * Write the local template array through to plugin settings and disk.
     * Every template mutation goes through here so the success Notice is a
     * report of a completed write, not of an intention. `activeTemplateId` is
     * only set when the caller is also switching the active template.
     */
    private async persistTemplates(successMessage: string, activeTemplateId?: string): Promise<boolean> {
        const aiSettings = validateAiSettings(this.plugin.settings.aiSettings ?? buildDefaultAiSettings()).value;
        aiSettings.roleTemplates = structuredClone(this.templates);
        if (activeTemplateId !== undefined) {
            aiSettings.roleTemplateId = activeTemplateId;
        }
        this.plugin.settings.aiSettings = aiSettings;
        try {
            await this.plugin.saveSettings();
        } catch (error) {
            new Notice(`Could not save AI context templates: ${error instanceof Error ? error.message : String(error)}`, 0);
            return false;
        }
        new Notice(successMessage);
        return true;
    }

    private async saveChanges(): Promise<void> {
        const currentTemplate = this.getCurrentTemplate();
        if (!currentTemplate || currentTemplate.isBuiltIn) return;
        
        if (this.textareaEl) {
            currentTemplate.prompt = this.textareaEl.value;
        }
        
        // isDirty stays true when the write failed, so the discard guard keeps
        // warning about work that is still only in this modal.
        if (!await this.persistTemplates('Template saved')) return;
        
        this.isDirty = false;
        this.updateButtonStates();
    }

    private async setActiveAndClose(): Promise<void> {
        if (this.isDirty) {
            await this.saveChanges();
        }

        const currentTemplate = this.getCurrentTemplate();
        if (!await this.persistTemplates(
            `Active template: ${currentTemplate?.name || 'Unknown'}`, // SAFE: UX default — placeholder label when the active template was just deleted
            this.currentTemplateId
        )) return;
        
        this.onSave();
        this.close();
    }
}

export default AiContextModal;
