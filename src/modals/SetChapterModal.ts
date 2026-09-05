import { App, ButtonComponent, Notice, Setting, TextComponent, setIcon } from 'obsidian';
import { ErtModal } from '../ui/ErtModal';
import type { TimelineItem } from '../types';
import { buildTimelineChapterResolverItems, readSharedChapterTitle } from '../utils/timelineChapters';

export interface ChapterContainerSummary {
    title: string;
    start: number;
    end: number;
    sceneCount: number;
    markerPath?: string;
    isUnchaptered?: boolean;
}

export interface SetChapterResult {
    title?: string;
    clear: boolean;
}

function sceneLabel(start: number, end: number): string {
    return start === end ? `Scene ${start}` : `Scenes ${start}-${end}`;
}

export function buildChapterContainerSummaries(scenes: TimelineItem[]): ChapterContainerSummary[] {
    const orderedScenes = buildTimelineChapterResolverItems(scenes);
    const summaries: ChapterContainerSummary[] = [];
    let current: ChapterContainerSummary | undefined;

    orderedScenes.forEach((scene, index) => {
        const position = index + 1;
        const chapterTitle = readSharedChapterTitle(scene.rawFrontmatter);

        if (chapterTitle) {
            current = {
                title: chapterTitle,
                start: position,
                end: position,
                sceneCount: 0,
                markerPath: scene.path,
            };
            summaries.push(current);
        } else if (!current) {
            current = {
                title: 'Unchaptered',
                start: position,
                end: position,
                sceneCount: 0,
                isUnchaptered: true,
            };
            summaries.push(current);
        }

        current.end = position;
        current.sceneCount += 1;
    });

    return summaries;
}

export class SetChapterModal extends ErtModal {
    private resolver: ((result: SetChapterResult | null) => void) | null = null;
    private resolved = false;

    constructor(
        app: App,
        private readonly targetSceneTitle: string,
        private readonly currentChapterTitle: string | undefined,
        private readonly chapters: ChapterContainerSummary[]
    ) {
        super(app);
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();
        this.resolved = false;
        this.applyShell({
            size: 'md',
            shellClasses: ['ert-modal--set-chapter'],
            containerClasses: ['ert-set-chapter-modal'],
        });

        this.scope.register([], 'Escape', () => {
            this.resolve(null);
            this.close();
            return false;
        });

        this.mountHeader({
            badge: { text: `Chapter · starts at ${this.targetSceneTitle}` },
            title: 'Set chapter marker',
        });

        const form = contentEl.createDiv({ cls: 'ert-stack' });
        let nextTitle = this.currentChapterTitle ?? '';
        const saveChapter = () => {
            const title = nextTitle.trim();
            if (!title) {
                new Notice('Enter a chapter title, or use Clear chapter to remove the marker.');
                return;
            }
            this.resolve({ title, clear: false });
            this.close();
        };

        new Setting(form)
            .setName('Chapter title')
            .setDesc('This scene becomes the chapter start marker.')
            .addText((text: TextComponent) => {
                text.inputEl.addClass('ert-input', 'ert-input--lg');
                text.setPlaceholder('Chapter title');
                text.setValue(nextTitle);
                text.onChange(value => { nextTitle = value; });
                text.inputEl.addEventListener('keydown', (event: KeyboardEvent) => {
                    if (event.key !== 'Enter') return;
                    event.preventDefault();
                    saveChapter();
                });
            });

        const listSection = form.createDiv({ cls: 'ert-set-chapter-modal__list-section' });
        listSection.createDiv({ cls: 'ert-set-chapter-modal__list-title', text: 'Current chapter containers' });
        const list = listSection.createDiv({ cls: 'ert-set-chapter-modal__list' });
        if (this.chapters.length === 0) {
            list.createDiv({ cls: 'ert-set-chapter-modal__empty', text: 'No scenes available.' });
        } else {
            this.chapters.forEach(chapter => {
                const row = list.createDiv({ cls: 'ert-set-chapter-modal__chapter-row' });
                const icon = row.createSpan({ cls: 'ert-set-chapter-modal__chapter-icon' });
                setIcon(icon, chapter.isUnchaptered ? 'folder-open' : 'book-marked');
                const body = row.createDiv({ cls: 'ert-set-chapter-modal__chapter-body' });
                body.createDiv({ cls: 'ert-set-chapter-modal__chapter-name', text: chapter.title });
                body.createDiv({
                    cls: 'ert-set-chapter-modal__chapter-range',
                    text: `${sceneLabel(chapter.start, chapter.end)} · ${chapter.sceneCount} scene${chapter.sceneCount === 1 ? '' : 's'}`,
                });
            });
        }

        const actions = this.mountActions();
        new ButtonComponent(actions)
            .setButtonText('Save chapter')
            .setCta()
            .onClick(saveChapter);
        if (this.currentChapterTitle) {
            new ButtonComponent(actions)
                .setButtonText('Clear chapter')
                .onClick(() => {
                    this.resolve({ clear: true });
                    this.close();
                });
        }
        new ButtonComponent(actions)
            .setButtonText('Cancel')
            .onClick(() => {
                this.resolve(null);
                this.close();
            });
    }

    onClose(): void {
        this.resolve(null);
        this.contentEl.empty();
    }

    waitForResult(): Promise<SetChapterResult | null> {
        return new Promise(resolve => {
            this.resolver = resolve;
            this.open();
        });
    }

    private resolve(result: SetChapterResult | null): void {
        if (this.resolved) return;
        this.resolved = true;
        this.resolver?.(result);
        this.resolver = null;
    }
}
