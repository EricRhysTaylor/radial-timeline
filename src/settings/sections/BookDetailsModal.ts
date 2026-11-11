/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 */

/*
 * Book details: how the book is narrated, and its optional metadata. Opened
 * from a book's card in Settings → Core → Books and from the Narration section.
 */

import { ButtonComponent, Modal, Setting as ObsidianSetting } from 'obsidian';
import type RadialTimelinePlugin from '../../main';
import type { BookProfile, NarrationMode } from '../../types/settings';
import { isNarrationMode, NARRATION_MODES } from '../../utils/pov';
import { markNarrationChosen } from '../../utils/books';
import { fitSelectToSelectedLabel } from '../selectSizing';
import { t } from '../../i18n';

/** The label each narration mode wears in a dropdown. */
export function narrationModeLabel(mode: NarrationMode): string {
    return t(`settings.pov.modes.${mode}`);
}

type BookDetails = Pick<BookProfile, 'genre' | 'projectStage' | 'publicLabel' | 'publicDescription'> & { narrationMode: NarrationMode };

class BookDetailsModal extends Modal {
    constructor(
        private plugin: RadialTimelinePlugin,
        private book: BookProfile,
        private onSubmit: (details: BookDetails) => Promise<void>
    ) {
        super(plugin.app);
    }

    onOpen() {
        const { contentEl, modalEl } = this;
        contentEl.empty();

        if (modalEl) {
            modalEl.classList.add('ert-ui', 'ert-scope--modal', 'ert-modal-shell');
            modalEl.setCssStyles({ width: '520px', maxWidth: '92vw' }); // SAFE: Modal sizing via inline styles (Obsidian pattern)
        }
        contentEl.addClass('ert-modal-container', 'ert-stack');

        const header = contentEl.createDiv({ cls: 'ert-modal-header' });
        header.createSpan({ cls: 'ert-modal-badge', text: t('ui.generalSection.metadataBadge') });
        // The book this edits, by name: opened from the Narration section it is the active book.
        header.createDiv({ cls: 'ert-modal-title', text: this.book.title });
        header.createDiv({
            cls: 'ert-modal-subtitle',
            text: t('ui.generalSection.metadataSubtitle')
        });

        const form = contentEl.createDiv({ cls: 'ert-stack' });
        let narrationMode: NarrationMode = this.book.narrationMode ?? 'off'; // SAFE: a book without a narration choice is Not set
        let genre = this.book.genre ?? ''; // SAFE: an unset book detail opens empty
        let projectStage = this.book.projectStage ?? ''; // SAFE: an unset book detail opens empty
        let publicLabel = this.book.publicLabel ?? ''; // SAFE: an unset book detail opens empty
        let publicDescription = this.book.publicDescription ?? ''; // SAFE: an unset book detail opens empty

        new ObsidianSetting(form)
            .setName(t('ui.generalSection.narrationName'))
            .setDesc(t('ui.generalSection.narrationDesc'))
            .addDropdown(dropdown => {
                for (const mode of NARRATION_MODES) dropdown.addOption(mode, narrationModeLabel(mode));
                // Sized to the chosen label, capped, so the long option labels
                // never squeeze the description into a sliver beside them.
                dropdown.selectEl.addClass('ert-input', 'ert-input--fit-selected');
                dropdown.setValue(narrationMode);
                const fit = () => fitSelectToSelectedLabel(dropdown.selectEl, { minPx: 140, maxPx: 220, extraPx: 18 });
                fit();
                dropdown.onChange(value => {
                    if (isNarrationMode(value)) narrationMode = value;
                    fit();
                });
            });

        const addText = (name: string, desc: string, value: string, onChange: (value: string) => void) => {
            new ObsidianSetting(form)
                .setName(name)
                .setDesc(desc)
                .addText(text => {
                    text.setValue(value);
                    text.inputEl.addClass('ert-input--full');
                    text.onChange(onChange);
                });
        };

        addText(t('ui.generalSection.genreName'), t('ui.generalSection.genreDesc'), genre, value => { genre = value; });
        addText(t('ui.generalSection.projectStageName'), t('ui.generalSection.projectStageDesc'), projectStage, value => { projectStage = value; });
        addText(t('ui.generalSection.publicLabelName'), t('ui.generalSection.publicLabelDesc'), publicLabel, value => { publicLabel = value; });

        new ObsidianSetting(form)
            .setName(t('ui.generalSection.descriptionName'))
            .setDesc(t('ui.generalSection.descriptionDesc'))
            .addTextArea(text => {
                text.setValue(publicDescription);
                text.inputEl.addClass('ert-input--full');
                text.inputEl.rows = 4;
                text.onChange(value => { publicDescription = value; });
            });

        const actions = contentEl.createDiv({ cls: 'ert-modal-actions' });
        const save = async () => {
            await this.onSubmit({ narrationMode, genre, projectStage, publicLabel, publicDescription });
            this.close();
        };
        new ButtonComponent(actions).setButtonText(t('common.save')).setCta().onClick(() => { void save(); });
        new ButtonComponent(actions).setButtonText(t('common.cancel')).onClick(() => this.close());
    }

    onClose() {
        this.contentEl.empty();
    }
}

/**
 * Open a book's details. Saving writes the book profile and redraws the
 * timeline (a narration change re-marks the POV characters).
 */
export function openBookDetails(plugin: RadialTimelinePlugin, book: BookProfile, onSaved?: () => void): void {
    new BookDetailsModal(plugin, book, async details => {
        // A narration the writer picks is theirs: it no longer follows the old vault value.
        if (details.narrationMode !== (book.narrationMode ?? 'off')) markNarrationChosen(plugin.settings, book.id); // SAFE: a book without a narration choice is Not set
        if (details.narrationMode === 'off') delete book.narrationMode;
        else book.narrationMode = details.narrationMode;
        book.genre = details.genre?.trim() || undefined;
        book.projectStage = details.projectStage?.trim() || undefined;
        book.publicLabel = details.publicLabel?.trim() || undefined;
        book.publicDescription = details.publicDescription?.trim() || undefined;
        await plugin.persistBookSettings();
        onSaved?.();
    }).open();
}
