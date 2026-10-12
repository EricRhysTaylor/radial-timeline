import { App, ButtonComponent, Modal } from 'obsidian';
import { scheduleFocusAfterPaint } from '../utils/domFocus';
import { scheduleClassAfterPaint } from '../utils/domClassEffects';
import { t, tCount } from '../i18n';

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

// Built on demand so titles and descriptions resolve in the current locale.
const getRtNoteFamilies = (): RtNoteFamilyOption[] => [
    {
        id: 'scene',
        title: t('ui.createRtNoteModal.familySceneTitle'),
        description: t('ui.createRtNoteModal.familySceneDesc'),
        subtypes: [
            { id: 'basic-scene', title: t('ui.createRtNoteModal.basicSceneTitle'), description: t('ui.createRtNoteModal.basicSceneDesc') },
            { id: 'advanced-scene', title: t('ui.createRtNoteModal.advancedSceneTitle'), description: t('ui.createRtNoteModal.advancedSceneDesc') },
            { id: 'screenplay-scene', title: t('ui.createRtNoteModal.screenplaySceneTitle'), description: t('ui.createRtNoteModal.screenplaySceneDesc') },
            { id: 'podcast-scene', title: t('ui.createRtNoteModal.podcastSceneTitle'), description: t('ui.createRtNoteModal.podcastSceneDesc') },
        ],
    },
    {
        id: 'manuscript-matter',
        title: t('ui.createRtNoteModal.familyManuscriptMatterTitle'),
        description: t('ui.createRtNoteModal.familyManuscriptMatterDesc'),
        subtypes: [
            { id: 'front-matter', title: t('ui.createRtNoteModal.frontMatterTitle'), description: t('ui.createRtNoteModal.frontMatterDesc') },
            { id: 'back-matter', title: t('ui.createRtNoteModal.backMatterTitle'), description: t('ui.createRtNoteModal.backMatterDesc') },
            { id: 'bookmeta', title: t('ui.createRtNoteModal.bookMetaTitle'), description: t('ui.createRtNoteModal.bookMetaDesc') },
        ],
    },
    {
        id: 'story-world',
        title: t('ui.createRtNoteModal.familyStoryWorldTitle'),
        description: t('ui.createRtNoteModal.familyStoryWorldDesc'),
        subtypes: [
            { id: 'beat', title: t('ui.createRtNoteModal.beatTitle'), description: t('ui.createRtNoteModal.beatDesc') },
            { id: 'backdrop', title: t('ui.createRtNoteModal.backdropTitle'), description: t('ui.createRtNoteModal.backdropDesc') },
            { id: 'character', title: t('ui.createRtNoteModal.characterTitle'), description: t('ui.createRtNoteModal.characterDesc') },
            { id: 'place', title: t('ui.createRtNoteModal.placeTitle'), description: t('ui.createRtNoteModal.placeDesc') },
        ],
    },
];

const findFamily = (familyId: RtNoteFamilyId | null): RtNoteFamilyOption | null => {
    if (!familyId) return null;
    return getRtNoteFamilies().find((family) => family.id === familyId) ?? null;
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
        header.createSpan({ cls: 'ert-modal-badge', text: t('ui.createRtNoteModal.badge') });
        header.createDiv({ cls: 'ert-modal-title', text: t('ui.createRtNoteModal.title') });
        this.headerSubtitleEl = header.createDiv({ cls: 'ert-modal-subtitle' });
        this.headerMetaEl = header.createDiv({ cls: 'ert-modal-meta' });

        const panel = contentEl.createDiv({ cls: 'ert-panel ert-panel--glass ert-note-creator-panel ert-stack' });
        this.panelDescEl = panel.createDiv({ cls: 'ert-section-desc' });
        this.gridEl = panel.createDiv({ cls: 'ert-note-creator-grid' });

        this.actionsEl = contentEl.createDiv({ cls: 'ert-modal-actions' });
        // Back sits immediately left of Cancel — both right-aligned via justify-content
        this.backButton = new ButtonComponent(this.actionsEl)
            .setButtonText(t('ui.createRtNoteModal.backButton'))
            .onClick(() => {
                this.selectedFamilyId = null;
                this.render();
            });
        new ButtonComponent(this.actionsEl)
            .setButtonText(t('common.cancel'))
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
                ? t('ui.createRtNoteModal.subtitleSubtype')
                : t('ui.createRtNoteModal.subtitleFamily')
        );
        this.headerMetaEl.empty();
        if (activeFamily) {
            this.headerMetaEl.createSpan({ cls: 'ert-modal-meta-item', text: t('ui.createRtNoteModal.stepTwoOfTwo') });
            this.headerMetaEl.createSpan({ cls: 'ert-modal-meta-item', text: activeFamily.title });
        }

        this.panelDescEl.setText(
            activeFamily ? activeFamily.description : t('ui.createRtNoteModal.familyPanelDesc')
        );
        const grid = this.gridEl;
        const nextButtons = activeFamily
            ? activeFamily.subtypes.map((subtype) => this.getSubtypeButton(subtype))
            : getRtNoteFamilies().map((family) => this.getFamilyButton(family));
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
            text: tCount('noteType', family.subtypes.length),
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
