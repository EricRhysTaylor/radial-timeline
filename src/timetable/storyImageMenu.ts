import { FuzzySuggestModal, Menu, Notice, TFile } from 'obsidian';
import type RadialTimelinePlugin from '../main';
import { t } from '../i18n';
import { readFrontmatterProperty } from '../utils/frontmatterKeys';
import { authorKeyFor } from './timetableFiles';
import { imageSubjectName, matchingStoryImages, stableStoryImage } from './storyImageMatching';
import { saveStoryImageChoice, storyImageChoice, type StoryImageChoice } from './storyImageStore';
import { notifyStoryImagesChanged } from './storyCardImages';
import { panelPlaceImage, type PanelPlaceImage } from './panelPlaceImage';
import { storyPortraitSource } from './storyPortrait';

const isImage = (file: TFile) => /^(png|jpe?g|gif|webp|avif)$/i.test(file.extension);
const fileName = (path: string) => path.split('/').pop() ?? path;

export function explicitCardImage(plugin: RadialTimelinePlugin, file: TFile): TFile | null {
    const path = storyImageChoice(plugin, file.path).image;
    const image = path ? plugin.app.vault.getAbstractFileByPath(path) : null;
    return image instanceof TFile && isImage(image) ? image : null;
}

/** Where a card's place image came from, for its menu and its tooltip. */
export function describePlaceImage(place: PanelPlaceImage): string {
    if (place.source === 'card') return t('ui.timetable.storyImageSourcePlaceCard');
    if (place.source === 'note') return t('ui.timetable.storyImageSourcePlaceNote', { name: place.name });
    return t('ui.timetable.storyImageSourcePlaceNamed', { file: fileName(place.path) });
}

/**
 * The card's pictures and where each came from, so the automatic choices can be seen: the portrait (chosen for the
 * card, from the character's note, or a picture named after the character) and the place, when the scene has one.
 */
export function storyImageSources(plugin: RadialTimelinePlugin, file: TFile, fm: Record<string, unknown> | undefined, images: TFile[], subject: string | undefined): string[] {
    const lines: string[] = [];
    const raw = readFrontmatterProperty(fm, authorKeyFor('Character', plugin.settings));
    const links = (Array.isArray(raw) ? raw : [raw]).filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
    if (explicitCardImage(plugin, file)) lines.push(t('ui.timetable.storyImageSourcePortraitCard'));
    else if (subject) {
        const link = links.find(value => imageSubjectName(value) === subject);
        const portrait = link ? storyPortraitSource(plugin.app, file.path, link, images) : null;
        lines.push(!portrait ? t('ui.timetable.storyImageSourcePortraitNone', { name: subject })
            : portrait.source === 'note' ? t('ui.timetable.storyImageSourcePortraitNote', { name: subject })
                : t('ui.timetable.storyImageSourcePortraitNamed', { file: portrait.file.name }));
    }
    const placeKey = authorKeyFor('Place', plugin.settings);
    const places = readFrontmatterProperty(fm, placeKey);
    const firstPlace = imageSubjectName(Array.isArray(places) ? places[0] : places);
    const chosenPlace = storyImageChoice(plugin, file.path).placeImage;
    if (firstPlace || chosenPlace) {
        const place = panelPlaceImage(plugin.app, file, fm, placeKey, images, chosenPlace);
        // A chosen place picture that was deleted or renamed, on a scene with no Place, has no name to report.
        lines.push(place ? describePlaceImage(place)
            : firstPlace ? t('ui.timetable.storyImageSourcePlaceNone', { name: firstPlace })
                : t('ui.timetable.storyImageSourcePlaceMissing'));
    }
    return lines;
}

class StoryImagePicker extends FuzzySuggestModal<TFile> {
    constructor(app: RadialTimelinePlugin['app'], private readonly files: TFile[], private readonly choose: (file: TFile) => void) { super(app); }
    getItems(): TFile[] { return this.files.filter(isImage); }
    getItemText(file: TFile): string { return file.path; }
    onChooseItem(file: TFile): void { this.choose(file); }
}

/** A card's own picture choices, kept in plugin data, never in author notes. */
export function showStoryImageMenu(plugin: RadialTimelinePlugin, file: TFile, fm: Record<string, unknown> | undefined, images: TFile[], event: MouseEvent, refresh: () => void, automaticSubject?: string): void {
    const menu = new Menu().setUseNativeMenu(false);
    const write = (change: Partial<StoryImageChoice> | null) => {
        const next = change ? { ...storyImageChoice(plugin, file.path), ...change } : null;
        void saveStoryImageChoice(plugin, file.path, next).then(() => {
            refresh();
            notifyStoryImagesChanged(plugin);
        }).catch(() => new Notice(t('ui.timetable.storyImageSaveFailed')));
    };
    const raw = readFrontmatterProperty(fm, authorKeyFor('Character', plugin.settings));
    const names = (Array.isArray(raw) ? raw : [raw]).map(imageSubjectName).filter((name): name is string => !!name);
    const currentName = storyImageChoice(plugin, file.path).character ?? automaticSubject ?? names[0];
    const sources = storyImageSources(plugin, file, fm, images, currentName);
    for (const line of sources) menu.addItem(item => item.setTitle(line).setIsLabel(true));
    if (sources.length) menu.addSeparator();
    for (const name of names) menu.addItem(item => item.setTitle(`${t('ui.timetable.storyImageChooseCharacter')}: ${name}`).onClick(() => write({ character: name, image: undefined })));
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
