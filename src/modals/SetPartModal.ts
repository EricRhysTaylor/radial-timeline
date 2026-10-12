import { App, ButtonComponent, Notice, Setting, TextComponent, setIcon } from 'obsidian';
import { ErtModal } from '../ui/ErtModal';
import type { TimelineItem } from '../types';
import { buildTimelineChapterResolverItems } from '../utils/timelineChapters';
import { readPartMarker } from '../utils/timelineParts';
import { t, tCount } from '../i18n';

/**
 * Set part… — the Part twin of Set chapter….
 *
 * Parts are author-placed markers on scenes, so this mirrors the chapter modal
 * deliberately: same container list, same save/clear shape. The differences are
 * the two things Parts have and Chapters do not — an untitled form, and a
 * layout that may or may not print what you write.
 */

export interface PartContainerSummary {
    /** Roman numeral shown to the author — sequential by marker order. */
    numeral: string;
    title?: string;
    start: number;
    end: number;
    sceneCount: number;
    markerPath?: string;
    /** Scenes before the first marker, which belong to no part. */
    isUnparted?: boolean;
}

export interface SetPartResult {
    /** The literal `Part:` value to write: `true` untitled, or a title. */
    value?: string | true;
    clear: boolean;
}

function sceneLabel(start: number, end: number): string {
    return start === end
        ? t('ui.setPartModal.sceneSingle', { number: start })
        : t('ui.setPartModal.sceneRange', { start, end });
}

function toRomanNumeral(value: number): string {
    const numerals: Array<[number, string]> = [
        [1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'],
        [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I'],
    ];
    let remaining = Math.floor(value);
    if (!Number.isFinite(remaining) || remaining <= 0) return String(value);
    let output = '';
    for (const [amount, glyph] of numerals) {
        while (remaining >= amount) {
            output += glyph;
            remaining -= amount;
        }
    }
    return output;
}

/**
 * Summarize the book's parts as the author would see them printed.
 *
 * Numbering is sequential by marker order, matching the export, so what this
 * list calls Part III is what the PDF will call Part III.
 */
export function buildPartContainerSummaries(scenes: TimelineItem[]): PartContainerSummary[] {
    const orderedScenes = buildTimelineChapterResolverItems(scenes);
    const summaries: PartContainerSummary[] = [];
    let current: PartContainerSummary | undefined;
    let partIndex = 0;

    orderedScenes.forEach((scene, index) => {
        const position = index + 1;
        const marker = readPartMarker(scene.rawFrontmatter);

        if (marker) {
            partIndex += 1;
            current = {
                numeral: toRomanNumeral(partIndex),
                ...(marker.titled && marker.title ? { title: marker.title } : {}),
                start: position,
                end: position,
                sceneCount: 0,
                markerPath: scene.path,
            };
            summaries.push(current);
        } else if (!current) {
            // A prologue ahead of Part I is legitimate; it simply belongs to no
            // part, the same way scenes before the first chapter are unchaptered.
            current = {
                numeral: '—',
                start: position,
                end: position,
                sceneCount: 0,
                isUnparted: true,
            };
            summaries.push(current);
        }

        current.end = position;
        current.sceneCount += 1;
    });

    return summaries;
}

export class SetPartModal extends ErtModal {
    private resolver: ((result: SetPartResult | null) => void) | null = null;
    private resolved = false;

    constructor(
        app: App,
        private readonly targetSceneTitle: string,
        private readonly currentValue: string | true | undefined,
        private readonly parts: PartContainerSummary[],
        /** How the selected layout will print this marker, or null when it won't. */
        private readonly layoutDescription: string | null,
        private readonly layoutName: string | undefined
    ) {
        super(app);
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();
        this.resolved = false;
        this.applyShell({
            size: 'md',
            shellClasses: ['ert-modal--set-part'],
            containerClasses: ['ert-set-part-modal'],
        });

        this.scope.register([], 'Escape', () => {
            this.resolve(null);
            this.close();
            return false;
        });

        this.mountHeader({
            badge: { text: t('ui.setPartModal.badge', { scene: this.targetSceneTitle }) },
            title: t('ui.setPartModal.title'),
        });

        const form = contentEl.createDiv({ cls: 'ert-stack' });

        // Untitled is a first-class choice, not an empty text box: a Part with
        // no name prints its numeral alone, which is what most books do.
        let titled = typeof this.currentValue === 'string';
        let nextTitle = typeof this.currentValue === 'string' ? this.currentValue : '';
        let titleInput: TextComponent | undefined;

        const save = () => {
            if (!titled) {
                this.resolve({ value: true, clear: false });
                this.close();
                return;
            }
            const title = nextTitle.trim();
            if (!title) {
                new Notice(t('ui.setPartModal.titleRequiredNotice'));
                return;
            }
            this.resolve({ value: title, clear: false });
            this.close();
        };

        new Setting(form)
            .setName(t('ui.setPartModal.partNameName'))
            .setDesc(t('ui.setPartModal.partNameDesc'))
            .addDropdown(dropdown => {
                dropdown.addOption('untitled', t('ui.setPartModal.numeralOnlyOption'));
                dropdown.addOption('titled', t('ui.setPartModal.numeralAndTitleOption'));
                dropdown.setValue(titled ? 'titled' : 'untitled');
                dropdown.onChange(value => {
                    titled = value === 'titled';
                    if (titleInput) titleInput.inputEl.toggleClass('is-hidden', !titled);
                });
            });

        new Setting(form)
            .setName(t('ui.setPartModal.titleName'))
            .setDesc(t('ui.setPartModal.titleDesc'))
            .addText((text: TextComponent) => {
                titleInput = text;
                text.inputEl.addClass('ert-input', 'ert-input--lg');
                text.setPlaceholder(t('ui.setPartModal.titlePlaceholder'));
                text.setValue(nextTitle);
                text.inputEl.toggleClass('is-hidden', !titled);
                text.onChange(value => { nextTitle = value; });
                text.inputEl.addEventListener('keydown', (event: KeyboardEvent) => {
                    if (event.key !== 'Enter') return;
                    event.preventDefault();
                    save();
                });
            });

        const listSection = form.createDiv({ cls: 'ert-set-part-modal__list-section' });
        listSection.createDiv({ cls: 'ert-set-part-modal__list-title', text: t('ui.setPartModal.currentParts') });
        const list = listSection.createDiv({ cls: 'ert-set-part-modal__list' });
        if (this.parts.length === 0) {
            list.createDiv({ cls: 'ert-set-part-modal__empty', text: t('ui.setPartModal.noScenes') });
        } else {
            this.parts.forEach(part => {
                const row = list.createDiv({ cls: 'ert-set-part-modal__part-row' });
                const icon = row.createSpan({ cls: 'ert-set-part-modal__part-icon' });
                setIcon(icon, part.isUnparted ? 'folder-open' : 'bookmark');
                const body = row.createDiv({ cls: 'ert-set-part-modal__part-body' });
                body.createDiv({
                    cls: 'ert-set-part-modal__part-name',
                    text: part.isUnparted
                        ? t('ui.setPartModal.beforePartOne')
                        : part.title
                            ? t('ui.setPartModal.partNumeralTitled', { numeral: part.numeral, title: part.title })
                            : t('ui.setPartModal.partNumeral', { numeral: part.numeral }),
                });
                body.createDiv({
                    cls: 'ert-set-part-modal__part-range',
                    text: `${sceneLabel(part.start, part.end)} · ${tCount('scene', part.sceneCount)}`,
                });
            });
        }

        // Read-only mirror of the layout's own description. Content is authored
        // here; appearance is changed in layout settings. Saving is never gated
        // on the layout — a marker is structure, and structure is the author's.
        const layoutSection = form.createDiv({ cls: 'ert-set-part-modal__layout-section' });
        if (!this.layoutName) {
            layoutSection.createDiv({
                cls: 'ert-set-part-modal__layout-note',
                text: t('ui.setPartModal.noLayoutNote'),
            });
        } else if (!this.layoutDescription) {
            layoutSection.createDiv({
                cls: 'ert-set-part-modal__layout-note',
                text: t('ui.setPartModal.layoutSkipsPartsNote', { layout: this.layoutName }),
            });
        } else {
            layoutSection.createDiv({
                cls: 'ert-set-part-modal__layout-title',
                text: t('ui.setPartModal.layoutPrintsTitle', { layout: this.layoutName }),
            });
            layoutSection.createDiv({
                cls: 'ert-set-part-modal__layout-note',
                text: this.layoutDescription,
            });
        }

        const actions = this.mountActions();
        new ButtonComponent(actions)
            .setButtonText(t('ui.setPartModal.saveButton'))
            .setCta()
            .onClick(save);
        if (this.currentValue !== undefined) {
            new ButtonComponent(actions)
                .setButtonText(t('ui.setPartModal.clearButton'))
                .onClick(() => {
                    this.resolve({ clear: true });
                    this.close();
                });
        }
        new ButtonComponent(actions)
            .setButtonText(t('common.cancel'))
            .onClick(() => {
                this.resolve(null);
                this.close();
            });
    }

    onClose(): void {
        this.resolve(null);
        this.contentEl.empty();
    }

    waitForResult(): Promise<SetPartResult | null> {
        return new Promise(resolve => {
            this.resolver = resolve;
            this.open();
        });
    }

    private resolve(result: SetPartResult | null): void {
        if (this.resolved) return;
        this.resolved = true;
        this.resolver?.(result);
        this.resolver = null;
    }
}
