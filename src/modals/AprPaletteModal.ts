/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 */

import { App, Modal, Setting, ButtonComponent } from 'obsidian';
import type RadialTimelinePlugin from '../main';
import type { AuthorProgressDefaults } from '../types/settings';
import { getPresetPalettes, generatePaletteFromColor, type AprPalette } from '../utils/aprPaletteGenerator';

export class AprPaletteModal extends Modal {
    private plugin: RadialTimelinePlugin;
    private defaults: AuthorProgressDefaults;
    private onApply: (palette: AprPalette) => void;
    private seedColor?: string;

    constructor(
        app: App,
        plugin: RadialTimelinePlugin,
        defaults: AuthorProgressDefaults,
        onApply: (palette: AprPalette) => void,
        seedColor?: string
    ) {
        super(app);
        this.plugin = plugin;
        this.defaults = defaults;
        this.onApply = onApply;
        this.seedColor = seedColor;
    }

    onOpen(): void {
        const { contentEl, modalEl, titleEl } = this;
        contentEl.empty();
        titleEl.setText('');
        
        if (modalEl) {
            modalEl.classList.add('ert-ui', 'ert-scope--modal', 'ert-modal-shell');
            modalEl.setCssStyles({ width: '600px', maxWidth: '92vw' }); // SAFE: Modal sizing via inline styles (Obsidian pattern)
        }
        contentEl.addClass('ert-modal-container', 'ert-stack', 'ert-apr-palette-modal');

        const header = contentEl.createDiv({ cls: 'ert-modal-header' });
        header.createSpan({ cls: 'ert-modal-badge', text: 'Palette' });
        header.createDiv({ cls: 'ert-modal-title', text: 'Color palette' });

        const applyPalette = async (palette: AprPalette) => {
            if (!this.plugin.settings.authorProgress) return;
            const defaults = this.plugin.settings.authorProgress.defaults;
            defaults.aprBookAuthorColor = palette.bookTitle;
            defaults.aprAuthorColor = palette.authorName;
            defaults.aprPercentNumberColor = palette.percentNumber;
            defaults.aprPercentSymbolColor = palette.percentSymbol;
            await this.plugin.saveSettings();
            this.onApply(palette);
            this.close();
        };

        // Generate from Color Section (moved to top)
        const generateCard = contentEl.createDiv({ cls: 'ert-panel ert-panel--glass ert-apr-palette-generate' });
        generateCard.createEl('h4', { text: 'Generate from book title color', cls: 'ert-section-title' });

        const currentBookColor = this.seedColor?.trim() || this.defaults?.aprBookAuthorColor || '#6FB971';
        const schemes: Array<{ value: 'analogous' | 'complementary' | 'triadic' | 'monochromatic'; label: string }> = [
            { value: 'analogous', label: 'Analogous (adjacent colors)' },
            { value: 'complementary', label: 'Complementary (opposite colors)' },
            { value: 'triadic', label: 'Triadic (three-way split)' },
            { value: 'monochromatic', label: 'Monochromatic (tints & shades)' }
        ];

        schemes.forEach(({ value, label }) => {
            const schemeSetting = new Setting(generateCard)
                .setName(label)
                .setDesc('');
            
            const generated = generatePaletteFromColor(currentBookColor, value);
            const swatches = schemeSetting.controlEl.createDiv({
                cls: 'ert-apr-palette-swatches ert-apr-palette-swatches--generate'
            });
            [generated.bookTitle, generated.authorName, generated.percentNumber, generated.percentSymbol].forEach(color => {
                const swatch = swatches.createDiv({
                    cls: 'ert-apr-palette-swatch ert-apr-palette-swatch--generate'
                });
                swatch.style.backgroundColor = color; // SAFE: inline style used for dynamic color preview swatch
            });
            
            schemeSetting.addButton(button => {
                button.setButtonText('Apply');
                button.setCta();
                button.onClick(() => applyPalette(generated));
            });
        });

        // Preset Palettes Section
        const presetsCard = contentEl.createDiv({ cls: 'ert-panel ert-panel--glass ert-apr-palette-presets' });
        presetsCard.createEl('h4', { text: 'Preset palettes', cls: 'ert-section-title' });
        presetsCard.createDiv({ text: 'Choose from curated color combinations.', cls: 'ert-section-desc' });

        const presets = getPresetPalettes();
        const presetsGrid = presetsCard.createDiv({ cls: 'ert-gridForm ert-apr-palette-grid' });
        
        presets.forEach(palette => {
            const paletteCard = presetsGrid.createDiv({ cls: 'ert-panel ert-apr-palette-card' });
            paletteCard.createDiv({ text: palette.name, cls: 'ert-apr-palette-name' });
            
            const swatches = paletteCard.createDiv({ cls: 'ert-apr-palette-swatches' });
            [palette.bookTitle, palette.authorName, palette.percentNumber, palette.percentSymbol].forEach(color => {
                const swatch = swatches.createDiv({ cls: 'ert-apr-palette-swatch' });
                swatch.style.backgroundColor = color; // SAFE: inline style used for dynamic color preview swatch
            });
            
            new ButtonComponent(paletteCard)
                .setButtonText('Apply')
                .setCta()
                .onClick(() => applyPalette(palette));
        });
    }

    onClose(): void {
        const { contentEl } = this;
        contentEl.empty();
    }
}
