/*
 * Radial Timeline Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 *
 * Create, rename, or delete one author-saved APR background colour preset.
 */

import { App, ButtonComponent, Setting, TextComponent } from 'obsidian';
import { ErtModal } from '../ui/ErtModal';
import { colorSwatch } from '../ui/ui';

export interface CustomBgPreset {
    label: string;
    color: string;
}

export interface CustomBgPresetModalOptions {
    index: number;
    existing: CustomBgPreset | null;
    currentBg: string;
    onSave: (preset: CustomBgPreset) => Promise<void>;
    onDelete: () => Promise<void>;
}

export class CustomBgPresetModal extends ErtModal {
    private readonly opts: CustomBgPresetModalOptions;

    constructor(app: App, opts: CustomBgPresetModalOptions) {
        super(app);
        this.opts = opts;
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();
        this.applyShell({ size: 'sm' });

        const isEdit = !!this.opts.existing;
        const initialColor = this.opts.existing?.color ?? this.opts.currentBg;
        const initialLabel = this.opts.existing?.label ?? '';
        this.mountHeader({ title: isEdit ? 'Edit custom preset' : 'Save custom preset' });

        const colorRow = new Setting(contentEl).setName('Color');
        colorRow.settingEl.addClass('ert-settingRow');
        let pickedColor = initialColor;
        let hexInput: TextComponent | null = null;
        const swatch = colorSwatch(colorRow.controlEl, {
            value: initialColor,
            ariaLabel: 'Preset color',
            onChange: (val) => {
                pickedColor = val;
                hexInput?.setValue(val);
            }
        });
        colorRow.addText(text => {
            hexInput = text;
            text.setPlaceholder('#000000').setValue(initialColor);
            text.inputEl.classList.add('ert-input', 'ert-input--hex');
            text.onChange((val) => {
                if (/^#[0-9a-f]{6}$/i.test(val)) {
                    pickedColor = val;
                    swatch.setValue(val);
                }
            });
        });

        const nameRow = new Setting(contentEl).setName('Name');
        nameRow.settingEl.addClass('ert-settingRow');
        let pickedLabel = initialLabel;
        nameRow.addText(text => {
            text.setPlaceholder('e.g. My Blog').setValue(initialLabel);
            text.onChange((val) => { pickedLabel = val.trim(); });
            window.setTimeout(() => text.inputEl.focus(), 50);
        });

        const actions = this.mountActions();
        if (isEdit) {
            const deleteBtn = new ButtonComponent(actions).setButtonText('Delete').setDestructive();
            deleteBtn.buttonEl.addClass('ert-btn--fit');
            deleteBtn.onClick(async () => {
                await this.opts.onDelete();
                this.close();
            });
        }
        actions.createDiv({ cls: 'ert-modal-actions-spacer' });
        const cancelBtn = new ButtonComponent(actions).setButtonText('Cancel');
        cancelBtn.buttonEl.addClass('ert-btn--fit');
        cancelBtn.onClick(() => this.close());
        const saveBtn = new ButtonComponent(actions).setButtonText('Save').setCta();
        saveBtn.buttonEl.addClass('ert-btn--fit');
        saveBtn.onClick(async () => {
            await this.opts.onSave({ label: pickedLabel || `Custom ${this.opts.index + 1}`, color: pickedColor });
            this.close();
        });
    }
}
