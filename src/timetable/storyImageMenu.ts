import { FuzzySuggestModal, Menu, Notice, TFile } from 'obsidian';
import type RadialTimelinePlugin from '../main';
import { t } from '../i18n';
import { readFrontmatterProperty } from '../utils/frontmatterKeys';
import { getOpenDocuments } from '../utils/documents';
import { authorKeyFor } from './timetableFiles';
import { imageSubjectName, matchingStoryImages, stableStoryImage } from './storyImageMatching';
import { saveStoryImageChoice, storyImageChoice, type StoryImageChoice } from './storyImageStore';

const isImage = (file: TFile) => /^(png|jpe?g|gif|webp|avif)$/i.test(file.extension);

export function explicitCardImage(plugin: RadialTimelinePlugin, file: TFile): TFile | null {
    const path = storyImageChoice(plugin, file.path).image;
    const image = path ? plugin.app.vault.getAbstractFileByPath(path) : null;
    return image instanceof TFile && isImage(image) ? image : null;
}

class StoryImagePicker extends FuzzySuggestModal<TFile> {
    constructor(app: RadialTimelinePlugin['app'], private readonly files: TFile[], private readonly choose: (file: TFile) => void) { super(app); }
    getItems(): TFile[] { return this.files.filter(isImage); }
    getItemText(file: TFile): string { return file.path; }
    onChooseItem(file: TFile): void { this.choose(file); }
}

/** Presentation choices are stored in plugin data, never in author notes. */
export function showStoryImageMenu(plugin: RadialTimelinePlugin, file: TFile, fm: Record<string, unknown> | undefined, images: TFile[], event: MouseEvent, refresh: () => void, automaticSubject?: string): void {
    const menu = new Menu();
    const write = (change: Partial<StoryImageChoice> | null) => {
        const next = change ? { ...storyImageChoice(plugin, file.path), ...change } : null;
        void saveStoryImageChoice(plugin, file.path, next).then(() => {
            refresh();
            for (const doc of getOpenDocuments(plugin.app.workspace)) doc.defaultView?.dispatchEvent(new Event('rt-story-image-strategy-changed'));
        }).catch(() => new Notice(t('ui.timetable.storyImageSaveFailed')));
    };
    const raw = readFrontmatterProperty(fm, authorKeyFor('Character', plugin.settings));
    const names = (Array.isArray(raw) ? raw : [raw]).map(imageSubjectName).filter((name): name is string => !!name);
    for (const name of names) menu.addItem(item => item.setTitle(`${t('ui.timetable.storyImageChooseCharacter')}: ${name}`).onClick(() => write({ character: name, image: undefined })));
    const currentName = storyImageChoice(plugin, file.path).character ?? automaticSubject ?? names[0];
    if (currentName) {
        const variants = matchingStoryImages(images, currentName);
        if (variants.length > 1) menu.addItem(item => item.setTitle(t('ui.timetable.storyImageNext')).onClick(() => {
            const current = explicitCardImage(plugin, file) ?? stableStoryImage(images, file.path, currentName);
            const at = variants.findIndex(image => image.path === current?.path);
            write({ image: variants[(at + 1) % variants.length].path });
        }));
    }
    menu.addItem(item => item.setTitle(t('ui.timetable.storyImageChoose')).onClick(() => new StoryImagePicker(plugin.app, images, chosen => write({ image: chosen.path })).open()));
    menu.addItem(item => item.setTitle(t('ui.timetable.storyImageChoosePlace')).onClick(() => new StoryImagePicker(plugin.app, images, chosen => write({ placeImage: chosen.path })).open()));
    menu.addSeparator();
    menu.addItem(item => item.setTitle(t('ui.timetable.storyImageAutomatic')).onClick(() => write(null)));
    menu.showAtMouseEvent(event);
}
