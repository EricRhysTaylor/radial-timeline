import { FuzzySuggestModal, Menu, Notice, TFile, type App } from 'obsidian';
import type RadialTimelinePlugin from '../main';
import { t } from '../i18n';
import { findFrontmatterKey, readFrontmatterProperty } from '../utils/frontmatterKeys';
import { authorKeyFor } from './timetableFiles';
import { imageSubjectName, matchingStoryImages, stableStoryImage } from './storyImageMatching';

const isImage = (file: TFile) => /^(png|jpe?g|gif|webp|avif)$/i.test(file.extension);

export function explicitCardImage(app: App, file: TFile, fm: Record<string, unknown> | undefined): TFile | null {
    const value = readFrontmatterProperty(fm, 'Card image');
    if (typeof value !== 'string') return null;
    const path = value.trim().replace(/^!?\[\[/, '').replace(/\]\]$/, '').split('|')[0].trim();
    const image = app.metadataCache.getFirstLinkpathDest(path, file.path);
    return image && isImage(image) ? image : null;
}

/** Remove every case variant of a property so none is left behind. */
function clear(frontmatter: Record<string, unknown>, name: string): void {
    for (let key = findFrontmatterKey(frontmatter, name); key !== undefined; key = findFrontmatterKey(frontmatter, name)) delete frontmatter[key];
}

class StoryImagePicker extends FuzzySuggestModal<TFile> {
    constructor(app: App, private readonly files: TFile[], private readonly choose: (file: TFile) => void) { super(app); }
    getItems(): TFile[] { return this.files.filter(isImage); }
    getItemText(file: TFile): string { return file.path; }
    onChooseItem(file: TFile): void { this.choose(file); }
}

/** Save only explicitly chosen presentation properties, preserving all other note content. */
export function showStoryImageMenu(plugin: RadialTimelinePlugin, file: TFile, fm: Record<string, unknown> | undefined, images: TFile[], event: MouseEvent, refresh: () => void, automaticSubject?: string): void {
    const menu = new Menu();
    const write = (key: string, value: string | null) => {
        void plugin.app.fileManager.processFrontMatter(file, frontmatter => {
            const existing = findFrontmatterKey(frontmatter, key) ?? key;
            if (value === null) delete frontmatter[existing]; else frontmatter[existing] = value;
            if (key === 'Card character') clear(frontmatter, 'Card image');
        }).then(refresh).catch(() => new Notice(t('ui.timetable.storyImageSaveFailed')));
    };
    const raw = readFrontmatterProperty(fm, authorKeyFor('Character', plugin.settings));
    const names = (Array.isArray(raw) ? raw : [raw]).map(imageSubjectName).filter((name): name is string => !!name);
    for (const name of names) {
        menu.addItem(item => item.setTitle(`${t('ui.timetable.storyImageChooseCharacter')}: ${name}`).onClick(() => write('Card character', name)));
    }
    const currentName = imageSubjectName(readFrontmatterProperty(fm, 'Card character')) ?? automaticSubject ?? names[0];
    if (currentName) {
        const variants = matchingStoryImages(images, currentName);
        if (variants.length > 1) menu.addItem(item => item.setTitle(t('ui.timetable.storyImageNext')).onClick(() => {
            const current = explicitCardImage(plugin.app, file, fm) ?? stableStoryImage(images, file.path, currentName);
            const at = variants.findIndex(image => image.path === current?.path);
            const next = variants[(at + 1) % variants.length];
            write('Card image', `[[${next.path}]]`);
        }));
    }
    menu.addItem(item => item.setTitle(t('ui.timetable.storyImageChoose')).onClick(() => new StoryImagePicker(plugin.app, images, chosen => write('Card image', `[[${chosen.path}]]`)).open()));
    menu.addItem(item => item.setTitle(t('ui.timetable.storyImageChoosePlace')).onClick(() => new StoryImagePicker(plugin.app, images, chosen => write('Place image', `[[${chosen.path}]]`)).open()));
    menu.addSeparator();
    menu.addItem(item => item.setTitle(t('ui.timetable.storyImageAutomatic')).onClick(() => {
        void plugin.app.fileManager.processFrontMatter(file, frontmatter => { clear(frontmatter, 'Card image'); clear(frontmatter, 'Card character'); clear(frontmatter, 'Place image'); }).then(refresh).catch(() => new Notice(t('ui.timetable.storyImageSaveFailed')));
    }));
    menu.showAtMouseEvent(event);
}
