import { App, ButtonComponent, Modal } from 'obsidian';
import { scheduleFocusAfterPaint } from '../utils/domFocus';
import { scheduleClassAfterPaint } from '../utils/domClassEffects';

export type RtNoteFamilyId = 'scene' | 'manuscript-matter' | 'story-world';
export type RtNoteSubtypeId =
    | 'basic-scene'
    | 'advanced-scene'
    | 'screenplay-scene'
    | 'podcast-scene'
    | 'front-matter'
    | 'back-matter'
    | 'bookmeta'
    | 'backdrop'
    | 'beat'
    | 'character'
    | 'place';

interface RtNoteSubtypeOption {
    id: RtNoteSubtypeId;
    title: string;
    description: string;
}

interface RtNoteFamilyOption {
    id: RtNoteFamilyId;
    title: string;
    description: string;
    subtypes: RtNoteSubtypeOption[];
}

const RT_NOTE_FAMILIES: RtNoteFamilyOption[] = [
    {
        id: 'scene',
        title: 'Scene',
        description: 'Start a new story scene in prose, screenplay, or podcast format.',
        subtypes: [
            { id: 'basic-scene', title: 'Core scene', description: 'Core scene properties for straightforward drafting.' },
            { id: 'advanced-scene', title: 'Scene with advanced properties', description: 'Core scene properties plus optional advanced scene metadata.' },
            { id: 'screenplay-scene', title: 'Screenplay scene', description: 'Screenplay-oriented scaffold with runtime defaults.' },
            { id: 'podcast-scene', title: 'Podcast scene', description: 'Podcast script scaffold with host and guest defaults.' },
        ],
    },
    {
        id: 'manuscript-matter',
        title: 'Manuscript matter',
        description: 'Add book-end notes and project-level metadata.',
        subtypes: [
            { id: 'front-matter', title: 'Front matter', description: 'Preface, title page, dedication, or opening matter.' },
            { id: 'back-matter', title: 'Back matter', description: 'Appendix, acknowledgments, notes, or ending matter.' },
            { id: 'bookmeta', title: 'BookMeta', description: 'Publication and rights metadata for the active book.' },
        ],
    },
    {
        id: 'story-world',
        title: 'Story world',
        description: 'Create contextual notes that shape time, place, or surrounding events.',
        subtypes: [
            { id: 'beat', title: 'Beat', description: 'A single story beat note with act and purpose fields.' },
            { id: 'backdrop', title: 'Backdrop', description: 'Timeline context note with start and end dates.' },
            { id: 'character', title: 'Character', description: 'Character profile: description, motivations, change arc, summary.' },
            { id: 'place', title: 'Place', description: 'Setting profile: description, layout, role in story, history.' },
        ],
    },
];

const findFamily = (familyId: RtNoteFamilyId | null): RtNoteFamilyOption | null => {
    if (!familyId) return null;
    return RT_NOTE_FAMILIES.find((family) => family.id === familyId) ?? null;
};

export class CreateRtNoteModal extends Modal {
    private selectedFamilyId: RtNoteFamilyId | null = null;
    private headerSubtitleEl: HTMLDivElement | null = null;
    private headerMetaEl: HTMLDivElement | null = null;
    private panelDescEl: HTMLDivElement | null = null;
    private gridEl: HTMLDivElement | null = null;
    private actionsEl: HTMLDivElement | null = null;
    private backButton: ButtonComponent | null = null;
    private familyButtonEls = new Map<RtNoteFamilyId, HTMLButtonElement>();
    private subtypeButtonEls = new Map<RtNoteSubtypeId, HTMLButtonElement>();

    constructor(app: App, private readonly onSelectSubtype: (subtypeId: RtNoteSubtypeId) => Promise<void> | void) {
        super(app);
    }

    onOpen(): void {
        const { contentEl, modalEl, titleEl } = this;
        titleEl?.setText('');

        if (modalEl) {
            modalEl.classList.add('ert-ui', 'ert-scope--modal', 'ert-modal-shell', 'ert-modal-shell--md', 'ert-modal--note-creator');
            modalEl.classList.remove('is-ui-settled');
            scheduleClassAfterPaint(modalEl, 'is-ui-settled');
        }

        contentEl.addClass('ert-modal-container', 'ert-stack', 'ert-note-creator-modal');
        const header = contentEl.createDiv({ cls: 'ert-modal-header' });
        header.createSpan({ cls: 'ert-modal-badge', text: 'Create' });
        header.createDiv({ cls: 'ert-modal-title', text: 'Create RT note' });
        this.headerSubtitleEl = header.createDiv({ cls: 'ert-modal-subtitle' });
        this.headerMetaEl = header.createDiv({ cls: 'ert-modal-meta' });

        const panel = contentEl.createDiv({ cls: 'ert-panel ert-panel--glass ert-note-creator-panel ert-stack' });
        this.panelDescEl = panel.createDiv({ cls: 'ert-section-desc' });
        this.gridEl = panel.createDiv({ cls: 'ert-note-creator-grid' });

        this.actionsEl = contentEl.createDiv({ cls: 'ert-modal-actions' });
        // Back sits immediately left of Cancel — both right-aligned via justify-content
        this.backButton = new ButtonComponent(this.actionsEl)
            .setButtonText('Back')
            .onClick(() => {
                this.selectedFamilyId = null;
                this.render();
            });
        new ButtonComponent(this.actionsEl)
            .setButtonText('Cancel')
            .onClick(() => this.close());
        this.render();
    }

    onClose(): void {
        this.contentEl.empty();
        this.selectedFamilyId = null;
        this.headerSubtitleEl = null;
        this.headerMetaEl = null;
        this.panelDescEl = null;
        this.gridEl = null;
        this.actionsEl = null;
        this.backButton = null;
        this.familyButtonEls.clear();
        this.subtypeButtonEls.clear();
    }

    private render(): void {
        const activeFamily = findFamily(this.selectedFamilyId);
        if (!this.headerSubtitleEl || !this.headerMetaEl || !this.panelDescEl || !this.gridEl || !this.actionsEl) return;

        this.headerSubtitleEl.setText(
            activeFamily
                ? 'Choose the exact note type you want to create.'
                : 'Select a note family first, then choose the specific note type.'
        );
        this.headerMetaEl.empty();
        if (activeFamily) {
            this.headerMetaEl.createSpan({ cls: 'ert-modal-meta-item', text: 'Step 2 of 2' });
            this.headerMetaEl.createSpan({ cls: 'ert-modal-meta-item', text: activeFamily.title });
        }

        this.panelDescEl.setText(
            activeFamily ? activeFamily.description : 'These groups match the main note categories used across Radial Timeline.'
        );
        const grid = this.gridEl;
        const nextButtons = activeFamily
            ? activeFamily.subtypes.map((subtype) => this.getSubtypeButton(subtype))
            : RT_NOTE_FAMILIES.map((family) => this.getFamilyButton(family));
        grid.replaceChildren(...nextButtons);

        if (this.backButton?.buttonEl) {
            this.backButton.buttonEl.toggleClass('is-hidden', !activeFamily);
        }

        const firstOption = grid.querySelector<HTMLButtonElement>('.ert-note-creator-option');
        if (firstOption) {
            scheduleFocusAfterPaint(firstOption);
        }
    }

    private async handleSubtypeSelection(subtypeId: RtNoteSubtypeId): Promise<void> {
        this.close();
        await this.onSelectSubtype(subtypeId);
    }

    private getFamilyButton(family: RtNoteFamilyOption): HTMLButtonElement {
        const existing = this.familyButtonEls.get(family.id);
        if (existing) return existing;

        const { button, optionBody } = this.createOptionButton(family.title, family.description);
        optionBody.createDiv({
            cls: 'ert-note-creator-option__meta',
            text: `${family.subtypes.length} type${family.subtypes.length === 1 ? '' : 's'}`,
        });
        button.addEventListener('click', () => {
            this.selectedFamilyId = family.id;
            this.render();
        });
        this.familyButtonEls.set(family.id, button);
        return button;
    }

    private getSubtypeButton(subtype: RtNoteSubtypeOption): HTMLButtonElement {
        const existing = this.subtypeButtonEls.get(subtype.id);
        if (existing) return existing;

        const { button } = this.createOptionButton(subtype.title, subtype.description);
        button.addEventListener('click', () => {
            void this.handleSubtypeSelection(subtype.id);
        });
        this.subtypeButtonEls.set(subtype.id, button);
        return button;
    }

    private createOptionButton(title: string, description: string): { button: HTMLButtonElement; optionBody: HTMLDivElement } {
        const button = this.contentEl.ownerDocument.win.createEl('button');
        button.className = 'ert-modal-choice ert-note-creator-option';
        button.type = 'button';
        const optionBody = button.createDiv({ cls: 'ert-note-creator-option__body' });
        optionBody.createDiv({
            cls: 'ert-note-creator-option__title',
            text: title,
        });
        optionBody.createDiv({
            cls: 'ert-note-creator-option__desc',
            text: description,
        });
        return { button, optionBody };
    }
}
