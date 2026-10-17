import { resolveSubplotColorFromGroup } from './dragGeometry';
import { membershipOfRing } from './subplotRings';
import { getFrontMatterInfo, parseYaml, Menu, Notice, TFile, type App } from 'obsidian';
import { normalizeStatus } from '../../utils/text';
import { applySceneInsertionPlan, planSceneInsertion } from '../../services/SceneInsertService';
import { resolveSelectedBeatModelFromSettings } from '../../utils/beatSystemState';
import { openOrRevealFile } from '../../utils/fileUtils';
import type { RadialTimelineSettings, TimelineItem } from '../../types';
import { AddSceneConfirmModal } from '../../modals/AddSceneConfirmModal';
import { buildChapterContainerSummaries, SetChapterModal } from '../../modals/SetChapterModal';
import { buildPartContainerSummaries, SetPartModal } from '../../modals/SetPartModal';
import { readPartMarker, SHARED_PART_FIELD_KEY } from '../../utils/timelineParts';
import { describeParts } from '../../publishing/layoutVisuals';
import { resolveActiveNovelPandocLayout } from '../../utils/exportFormats';
import { readSharedChapterTitle, SHARED_CHAPTER_FIELD_KEY } from '../../utils/timelineChapters';
import { canonicalizeFrontmatterKey, frontmatterValueToText, getActiveFrontmatterMappings } from '../../utils/frontmatter';
import {
    applySubplotMembershipChange,
    planSubplotMembership,
    readSubplotMemberships,
    type SubplotMembershipChange,
} from '../../services/SubplotMembership';
import { SubplotPickerModal } from '../../modals/SubplotPickerModal';
import { formatLocalDateKey } from '../../utils/date';
import { t } from '../../i18n';
import { getMainPlotName } from '../../utils/mainPlot';

/** What the menu needs from whoever opens it: the wheel's view, or the Timetable. */
export type SceneMenuHost = {
    plugin: {
        app: App;
        settings: RadialTimelineSettings;
        getSceneData?: () => Promise<TimelineItem[]>;
        refreshTimelineIfNeeded?: (file: TFile | null, delayMs?: number) => void;
    };
    refreshTimeline?: () => void;
    /** Where a note the menu creates opens: the Timetable's reading pane. Without it, as the wheel opens notes. */
    openNote?: (file: TFile) => Promise<void>;
};

type SceneContextMenuView = SceneMenuHost & {
    renderScope: {
        register: (cb: () => void) => void;
        registerDomEvent: (el: HTMLElement, event: string, handler: (ev: Event) => void) => void;
    };
};

/**
 * The scene the menu acts on, wherever it was clicked. On the wheel it comes
 * from the clicked SVG group; in the Timetable, from the row.
 */
export interface SceneMenuTarget {
    file: TFile;
    itemType: 'Scene' | 'Backdrop';
    /** The ring the click landed on, when that ring stands for one subplot; null on a ring of every scene (or a table row). */
    ringSubplot: string | null;
    /** Subplots the author can move or add the scene to. */
    knownSubplots: string[];
    /** The subplot a new scene added after this one should take. */
    primarySubplot?: string;
    /** That subplot's color, for the Add scene dialog. */
    subplotColor?: string;
}

export type TimelineStatusOption = {
    label: string;
    value: 'Todo' | 'Working' | 'Complete';
    normalized: 'Todo' | 'Working' | 'Completed';
    icon: string;
};

export type PublishStageOption = {
    label: string;
    value: 'Zero' | 'Author' | 'House' | 'Press';
    icon: string;
};

const SCENE_CONTEXT_SELECTOR = '.rt-scene-group[data-item-type="Scene"], .rt-scene-group[data-item-type="Backdrop"]';
const CHAPTER_INSERT_BEFORE_KEYS = ['Synopsis'];
const CHAPTER_INSERT_AFTER_KEYS = ['Duration', 'When', 'Act', 'Class'];

export const STATUS_OPTIONS: TimelineStatusOption[] = [
    { label: 'Todo', value: 'Todo', normalized: 'Todo', icon: 'circle' },
    { label: 'Working', value: 'Working', normalized: 'Working', icon: 'loader' },
    { label: 'Complete', value: 'Complete', normalized: 'Completed', icon: 'check-circle-2' },
];

export const PUBLISH_STAGE_OPTIONS: PublishStageOption[] = [
    { label: 'Zero', value: 'Zero', icon: 'circle-dashed' },
    { label: 'Author', value: 'Author', icon: 'pen-line' },
    { label: 'House', value: 'House', icon: 'home' },
    { label: 'Press', value: 'Press', icon: 'newspaper' },
];

function normalizeScalar(value: unknown): string {
    if (value === null || value === undefined) return '';
    if (Array.isArray(value)) return value.length > 0 ? normalizeScalar(value[0]) : '';
    return frontmatterValueToText(value).trim();
}

function normalizeFrontmatterKey(key: string): string {
    return key.toLowerCase().replace(/[\s_-]/g, '');
}

function findChapterFrontmatterKey(frontmatter?: Record<string, unknown>): string | undefined {
    if (!frontmatter) return undefined;
    return Object.keys(frontmatter).find(key => normalizeFrontmatterKey(key) === 'chapter');
}

function getEncodedScenePath(group: Element): string | null {
    const encodedPath = group.getAttribute('data-path');
    if (!encodedPath) return null;
    try {
        return decodeURIComponent(encodedPath);
    } catch {
        return encodedPath;
    }
}

function getSceneFile(view: SceneMenuHost, group: Element): TFile | null {
    const filePath = getEncodedScenePath(group);
    if (!filePath) return null;

    const file = view.plugin.app.vault.getAbstractFileByPath(filePath);
    return file instanceof TFile ? file : null;
}

function refreshTimelineView(view: SceneMenuHost, file: TFile): void {
    if (typeof view.plugin.refreshTimelineIfNeeded === 'function') {
        view.plugin.refreshTimelineIfNeeded(file, 100);
        return;
    }
    if (typeof view.refreshTimeline === 'function') {
        view.refreshTimeline();
    }
}

async function updateSceneFrontmatter(
    view: SceneMenuHost,
    file: TFile,
    update: (frontmatter: Record<string, unknown>) => void,
    successMessage: string
): Promise<void> {
    try {
        await view.plugin.app.fileManager.processFrontMatter(file, update);
        refreshTimelineView(view, file);
        new Notice(successMessage);
    } catch (error) {
        console.error('[SceneContextMenu] Failed to update scene frontmatter:', error);
        new Notice(t('ui.sceneContextMenu.updateFailed', { name: file.basename }), 7000);
    }
}

function getFrontmatterLineKey(line: string): string | undefined {
    const match = line.match(/^([^:#\n][^:\n]*):/);
    return match?.[1]?.trim();
}

function formatYamlString(value: string): string {
    return JSON.stringify(value);
}

function insertChapterFieldInYaml(yaml: string, title: string): string {
    const newline = yaml.includes('\r\n') ? '\r\n' : '\n';
    const lines = yaml.length > 0 ? yaml.split(/\r?\n/) : [];
    const chapterLine = `${SHARED_CHAPTER_FIELD_KEY}: ${formatYamlString(title)}`;

    const beforeIndex = lines.findIndex(line => {
        const key = getFrontmatterLineKey(line);
        return key ? CHAPTER_INSERT_BEFORE_KEYS.some(candidate => normalizeFrontmatterKey(candidate) === normalizeFrontmatterKey(key)) : false;
    });

    if (beforeIndex >= 0) {
        lines.splice(beforeIndex, 0, chapterLine);
        return lines.join(newline);
    }

    for (const afterKey of CHAPTER_INSERT_AFTER_KEYS) {
        const afterIndex = lines.findIndex(line => {
            const key = getFrontmatterLineKey(line);
            return key ? normalizeFrontmatterKey(key) === normalizeFrontmatterKey(afterKey) : false;
        });
        if (afterIndex >= 0) {
            lines.splice(afterIndex + 1, 0, chapterLine);
            return lines.join(newline);
        }
    }

    return [...lines, chapterLine].join(newline);
}

async function insertMissingChapterFrontmatter(
    view: SceneMenuHost,
    file: TFile,
    title: string
): Promise<boolean> {
    let changed = false;

    await view.plugin.app.vault.process(file, (content) => {
        const info = getFrontMatterInfo(content) as {
            exists?: boolean;
            frontmatter?: string;
            position?: { end?: { offset?: number } };
        };
        if (!info.exists || typeof info.frontmatter !== 'string') return content;

        const parsed: unknown = parseYaml(info.frontmatter);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return content;

        const frontmatter = parsed as Record<string, unknown>;
        if (findChapterFrontmatterKey(frontmatter)) return content;

        const updatedYaml = insertChapterFieldInYaml(info.frontmatter, title);
        const endOffset = info.position?.end?.offset;
        if (typeof endOffset !== 'number' || endOffset < 0 || endOffset > content.length) return content;

        const body = content.slice(endOffset);
        const newline = content.includes('\r\n') ? '\r\n' : '\n';
        const updatedContent = `---${newline}${updatedYaml.endsWith(newline) ? updatedYaml : `${updatedYaml}${newline}`}---${body.startsWith(newline) || body.length === 0 ? '' : newline}${body}`;
        const verifiedInfo = getFrontMatterInfo(updatedContent) as { frontmatter?: string };
        const verified: unknown = verifiedInfo.frontmatter ? parseYaml(verifiedInfo.frontmatter) : null;
        if (!verified || typeof verified !== 'object' || Array.isArray(verified)) {
            throw new Error('Chapter frontmatter insert could not be verified.');
        }
        if (readSharedChapterTitle(verified as Record<string, unknown>) !== title) {
            throw new Error('Chapter frontmatter insert wrote an unexpected value.');
        }

        changed = true;
        return updatedContent;
    });

    return changed;
}

async function writeChapterMarker(
    view: SceneMenuHost,
    file: TFile,
    title: string,
    successMessage: string
): Promise<void> {
    const cache = view.plugin.app.metadataCache.getFileCache(file);
    const existingChapterKey = findChapterFrontmatterKey(cache?.frontmatter);

    if (!existingChapterKey) {
        const inserted = await insertMissingChapterFrontmatter(view, file, title);
        if (inserted) {
            refreshTimelineView(view, file);
            new Notice(successMessage);
            return;
        }
    }

    await updateSceneFrontmatter(
        view,
        file,
        (fm) => {
            const key = findChapterFrontmatterKey(fm) ?? SHARED_CHAPTER_FIELD_KEY;
            fm[key] = title;
        },
        successMessage
    );
}

async function clearChapterMarker(
    view: SceneMenuHost,
    file: TFile,
    successMessage: string
): Promise<void> {
    await updateSceneFrontmatter(
        view,
        file,
        (fm) => {
            const key = findChapterFrontmatterKey(fm) ?? SHARED_CHAPTER_FIELD_KEY;
            delete fm[key];
        },
        successMessage
    );
}

/** Find the note's own `Part` key, tolerating case and separator drift. */
function findPartFrontmatterKey(frontmatter: Record<string, unknown> | undefined): string | undefined {
    if (!frontmatter) return undefined;
    const wanted = SHARED_PART_FIELD_KEY.toLowerCase();
    for (const key of Object.keys(frontmatter)) {
        if (key.toLowerCase().replace(/[\s_-]/g, '') === wanted) return key;
    }
    return undefined;
}

async function writePartMarker(
    view: SceneMenuHost,
    file: TFile,
    value: string | true,
    successMessage: string
): Promise<void> {
    await updateSceneFrontmatter(
        view,
        file,
        (fm) => {
            const key = findPartFrontmatterKey(fm) ?? SHARED_PART_FIELD_KEY;
            fm[key] = value;
        },
        successMessage
    );
}

async function clearPartMarker(
    view: SceneMenuHost,
    file: TFile,
    successMessage: string
): Promise<void> {
    await updateSceneFrontmatter(
        view,
        file,
        (fm) => {
            const key = findPartFrontmatterKey(fm);
            // Clearing deletes the key rather than blanking it: an empty `Part:`
            // is not a marker, and leaving it behind is noise in the note.
            if (key) delete fm[key];
        },
        successMessage
    );
}

async function setPartAtScene(
    view: SceneMenuHost,
    file: TFile,
    currentValue: string | true | undefined
): Promise<void> {
    if (typeof view.plugin.getSceneData !== 'function') {
        new Notice(t('ui.sceneContextMenu.partDataUnavailable'), 5000);
        return;
    }

    try {
        const scenes = await view.plugin.getSceneData();
        const layout = resolveActiveNovelPandocLayout(view.plugin.settings);
        const result = await new SetPartModal(
            view.plugin.app,
            file.basename,
            currentValue,
            buildPartContainerSummaries(scenes),
            layout?.designedSpec ? describeParts(layout.designedSpec) : null,
            layout?.name
        ).waitForResult();
        if (!result) return;

        if (result.clear) {
            await clearPartMarker(view, file, t('ui.sceneContextMenu.partCleared', { name: file.basename }));
            return;
        }
        if (result.value !== undefined) {
            await writePartMarker(view, file, result.value, t('ui.sceneContextMenu.partSet', { name: file.basename }));
        }
    } catch (error) {
        console.error('[SceneContextMenu] Failed to set part:', error);
        new Notice(t('ui.sceneContextMenu.partFailed', { name: file.basename }), 7000);
    }
}

function menuTitle(label: string, active: boolean): string {
    return active ? `${label}  ✓` : label;
}

function resolvePrimarySubplotFromGroup(group: Element): string | undefined {
    const subplotIndex = group.getAttribute('data-subplot-index');
    const svg = group.instanceOf(SVGElement) ? group.ownerSVGElement : null;
    if (!svg || subplotIndex === null) return undefined;
    const label = svg.querySelector(`.rt-subplot-ring-label-text[data-subplot-index="${subplotIndex}"]`);
    return label?.getAttribute('data-subplot-name') ?? undefined;
}

// ── Subplot membership (same mutation path as dragging between rings) ──

/** The subplot the clicked ring stands for; null on a ring that lists every scene. */
function ringSubplotForGroup(view: SceneMenuHost, group: Element): string | null {
    const svg = group.instanceOf(SVGElement) ? group.ownerSVGElement : null;
    const ring = group.getAttribute('data-ring');
    if (!svg || ring === null) return null;
    return membershipOfRing(svg, Number(ring), view.plugin.settings.currentMode);
}

function knownSubplots(group: Element): string[] {
    const svg = group.instanceOf(SVGElement) ? group.ownerSVGElement : null;
    if (!svg) return [];
    const names = Array.from(svg.querySelectorAll('.rt-subplot-ring-label-text[data-subplot-name]'))
        .map(label => label.getAttribute('data-subplot-name') ?? '')
        .filter(Boolean);
    return [...new Set(names)];
}

async function changeSubplotMembership(view: SceneMenuHost, file: TFile, change: SubplotMembershipChange): Promise<void> {
    try {
        const after = await applySubplotMembershipChange(view.plugin.app, file, change, {
            mappings: getActiveFrontmatterMappings(view.plugin.settings),
            itemLabel: file.basename,
            onChanged: () => refreshTimelineView(view, file),
        });
        if (!after) new Notice(t('ui.sceneContextMenu.noSubplotChange', { name: file.basename }));
    } catch (error) {
        console.error('[SceneContextMenu] Failed to change subplot membership:', error);
        new Notice(t('ui.sceneContextMenu.updateFailed', { name: file.basename }), 7000);
    }
}

function pickSubplot(view: SceneMenuHost, names: string[], placeholder: string, onChoose: (name: string) => void): void {
    if (names.length === 0) {
        new Notice(t('ui.sceneContextMenu.noOtherSubplot'));
        return;
    }
    new SubplotPickerModal(view.plugin.app, names, placeholder, onChoose).open();
}

function addSubplotMenuItems(menu: Menu, view: SceneMenuHost, target: SceneMenuTarget): void {
    const { file, ringSubplot } = target;
    const mappings = getActiveFrontmatterMappings(view.plugin.settings);
    const current = readSubplotMemberships(view.plugin.app, file, mappings);
    const effective = current.length > 0 ? current : [getMainPlotName()];
    const known = target.knownSubplots;
    const moveFrom = (from: string): void => pickSubplot(view, known.filter(name => name !== from), t('ui.sceneContextMenu.moveSceneFromToPlaceholder', { name: file.basename, from }),
        to => { void changeSubplotMembership(view, file, { kind: 'move', from, to }); });

    menu.addItem(item => {
        item.setIcon('plus-circle');
        item.setTitle(t('ui.sceneContextMenu.addToSubplot'));
        item.onClick(() => pickSubplot(view, known.filter(name => !effective.includes(name)), t('ui.sceneContextMenu.addSceneToPlaceholder', { name: file.basename }),
            to => { void changeSubplotMembership(view, file, { kind: 'add', to }); }));
    });

    // On a subplot ring the ring is the source. On a ring that lists every
    // scene, the source is the scene's subplot, chosen first if it has several.
    const sources = ringSubplot ? [ringSubplot] : effective;
    if (sources.length === 1) {
        const from = sources[0];
        menu.addItem(item => {
            item.setIcon('arrow-right-left');
            item.setTitle(t('ui.sceneContextMenu.moveFromTo', { from }));
            item.onClick(() => moveFrom(from));
        });
    } else {
        menu.addItem(item => {
            item.setIcon('arrow-right-left');
            item.setTitle(t('ui.sceneContextMenu.moveFromSubplot'));
            item.onClick(() => pickSubplot(view, sources, t('ui.sceneContextMenu.moveSceneFromPlaceholder', { name: file.basename }), moveFrom));
        });
    }
    // One removable subplot is the one the Move item above names (or the
    // clicked ring), so the label needn't repeat it; several open a picker.
    const removable = (ringSubplot ? [ringSubplot] : effective)
        .filter(from => planSubplotMembership(current, { kind: 'remove', from }) !== null);
    if (removable.length === 1) {
        const from = removable[0];
        menu.addItem(item => {
            item.setIcon('minus-circle');
            item.setTitle(t('ui.sceneContextMenu.removeFromThisSubplot'));
            item.onClick(() => { void changeSubplotMembership(view, file, { kind: 'remove', from }); });
        });
    } else if (removable.length > 1) {
        menu.addItem(item => {
            item.setIcon('minus-circle');
            item.setTitle(t('ui.sceneContextMenu.removeFromSubplot'));
            item.onClick(() => pickSubplot(view, removable, t('ui.sceneContextMenu.removeSceneFromPlaceholder', { name: file.basename }),
                from => { void changeSubplotMembership(view, file, { kind: 'remove', from }); }));
        });
    }
}

/**
 * Take a scene off the timeline without moving or deleting the note: only its
 * Class goes, so the timeline stops drawing it and the Timetable lists it as a
 * note with no Class, where Promote to scene puts it back. The scene ID stays,
 * so a promoted scene keeps the identity its history is filed under.
 */
async function removeSceneFromTimeline(view: SceneMenuHost, file: TFile): Promise<void> {
    await updateSceneFrontmatter(
        view,
        file,
        (fm) => {
            for (const key of Object.keys(fm)) {
                if (key.toLowerCase() === 'class') delete fm[key];
            }
        },
        t('ui.sceneContextMenu.removedFromTimeline', { name: file.basename })
    );
}

async function addSceneAfterAnchor(view: SceneMenuHost, target: SceneMenuTarget): Promise<void> {
    const { file } = target;
    if (typeof view.plugin.getSceneData !== 'function') {
        new Notice(t('ui.sceneContextMenu.addDataUnavailable'), 5000);
        return;
    }

    const plan = await planSceneInsertion({
        app: view.plugin.app,
        settings: view.plugin.settings,
        anchorFile: file,
        primarySubplot: target.primarySubplot,
        getSceneData: view.plugin.getSceneData.bind(view.plugin),
        beatModel: resolveSelectedBeatModelFromSettings(view.plugin.settings)
    }).catch((error) => {
        console.error('[SceneContextMenu] Failed to plan scene insert:', error);
        new Notice(t('ui.sceneContextMenu.addFailed', { name: file.basename }), 7000);
        return null;
    });
    if (!plan) return;

    const modal = new AddSceneConfirmModal(
        view.plugin.app,
        plan,
        target.subplotColor
    );
    const started = await modal.waitForBegin();
    if (!started) return;

    // The modal stays open through the insert. Keeping it open also defers
    // FileTrackingService's timeline refresh (gated on an open modal), so the
    // create lands as one quiet update instead of a refresh plus a notice.
    // Progress and the final summary live in the modal.
    try {
        const result = await applySceneInsertionPlan(view.plugin.app, plan);
        modal.updateProgress(t('ui.sceneContextMenu.refreshing'));
        await new Promise((resolve) => window.setTimeout(resolve, 100));
        const createdFile = view.plugin.app.vault.getAbstractFileByPath(result.path);
        if (createdFile instanceof TFile) {
            refreshTimelineView(view, createdFile);
            if (view.openNote) await view.openNote(createdFile);
            else await openOrRevealFile(view.plugin.app, createdFile, false);
        } else {
            refreshTimelineView(view, file);
        }
        await modal.finishWithDismiss(t('ui.sceneContextMenu.addedAfter', { name: file.basename }));
    } catch (error) {
        console.error('[SceneContextMenu] Failed to add scene:', error);
        await modal.finishWithDismiss(t('ui.sceneContextMenu.addFailedDismiss', { name: file.basename }), true);
    }
}

async function setChapterAtScene(view: SceneMenuHost, file: TFile, currentChapterTitle: string | undefined): Promise<void> {
    if (typeof view.plugin.getSceneData !== 'function') {
        new Notice(t('ui.sceneContextMenu.chapterDataUnavailable'), 5000);
        return;
    }

    try {
        const scenes = await view.plugin.getSceneData();
        const result = await new SetChapterModal(
            view.plugin.app,
            file.basename,
            currentChapterTitle,
            buildChapterContainerSummaries(scenes)
        ).waitForResult();
        if (!result) return;

        if (result.clear) {
            await clearChapterMarker(view, file, t('ui.sceneContextMenu.chapterCleared', { name: file.basename }));
            return;
        }

        const title = result.title?.trim();
        if (title) {
            await writeChapterMarker(view, file, title, t('ui.sceneContextMenu.chapterSet', { name: file.basename }));
        }
    } catch (error) {
        console.error('[SceneContextMenu] Failed to set chapter:', error);
        new Notice(t('ui.sceneContextMenu.chapterFailed', { name: file.basename }), 7000);
    }
}

/** The note's own key for a property (any letter case, or the author's mapped name), or its canonical name. */
function frontmatterKeyFor(view: SceneMenuHost, frontmatter: Record<string, unknown>, canonical: string): string {
    const mappings = getActiveFrontmatterMappings(view.plugin.settings);
    return Object.keys(frontmatter).find(key => canonicalizeFrontmatterKey(key, mappings) === canonical) ?? canonical;
}

function cachedFrontmatter(view: SceneMenuHost, file: TFile): Record<string, unknown> {
    return view.plugin.app.metadataCache.getFileCache(file)?.frontmatter ?? {};
}

/** Set a scene's Status in its frontmatter. Complete also sets Due to today. */
export function applyStatusToFrontmatter(view: SceneMenuHost, fm: Record<string, unknown>, value: TimelineStatusOption['value']): void {
    fm[frontmatterKeyFor(view, fm, 'Status')] = value;
    if (value === 'Complete') fm[frontmatterKeyFor(view, fm, 'Due')] = formatLocalDateKey();
}

/** Set a scene's Publish Stage in its frontmatter. */
export function applyStageToFrontmatter(view: SceneMenuHost, fm: Record<string, unknown>, value: PublishStageOption['value']): void {
    fm[frontmatterKeyFor(view, fm, 'Publish Stage')] = value;
}

/**
 * Status items (Todo, Working, Complete), the current one checked. Complete
 * also sets Due to today. Shared by the wheel's menu and the Timetable.
 */
export function addStatusMenuItems(menu: Menu, view: SceneMenuHost, file: TFile): void {
    const frontmatter = cachedFrontmatter(view, file);
    const currentStatus = normalizeStatus(frontmatter[frontmatterKeyFor(view, frontmatter, 'Status')]);
    STATUS_OPTIONS.forEach(option => {
        menu.addItem(item => {
            item.setIcon(option.icon);
            item.setTitle(menuTitle(option.label, currentStatus === option.normalized));
            item.onClick(() => {
                void updateSceneFrontmatter(
                    view,
                    file,
                    (fm) => applyStatusToFrontmatter(view, fm, option.value),
                    option.value === 'Complete'
                        ? t('ui.sceneContextMenu.markedComplete', { name: file.basename })
                        : t('ui.sceneContextMenu.statusSet', { name: file.basename, status: option.label })
                );
            });
        });
    });
}

/** Publish Stage items (Zero, Author, House, Press), the current one checked. Shared by the wheel and the Timetable. */
export function addPublishStageMenuItems(menu: Menu, view: SceneMenuHost, file: TFile): void {
    const frontmatter = cachedFrontmatter(view, file);
    const currentStage = normalizeScalar(frontmatter[frontmatterKeyFor(view, frontmatter, 'Publish Stage')]) || 'Zero';
    PUBLISH_STAGE_OPTIONS.forEach(option => {
        menu.addItem(item => {
            item.setIcon(option.icon);
            item.setTitle(menuTitle(option.label, currentStage.toLowerCase() === option.value.toLowerCase()));
            item.onClick(() => {
                void updateSceneFrontmatter(
                    view,
                    file,
                    (fm) => applyStageToFrontmatter(view, fm, option.value),
                    t('ui.sceneContextMenu.stageSet', { name: file.basename, stage: option.label })
                );
            });
        });
    });
}

/** Read the menu target from a clicked scene group on the wheel. */
function targetFromGroup(view: SceneMenuHost, group: Element): SceneMenuTarget | null {
    const file = getSceneFile(view, group);
    if (!file) return null;
    return {
        file,
        itemType: group.getAttribute('data-item-type') === 'Backdrop' ? 'Backdrop' : 'Scene',
        ringSubplot: ringSubplotForGroup(view, group),
        knownSubplots: knownSubplots(group),
        primarySubplot: resolvePrimarySubplotFromGroup(group),
        subplotColor: resolveSubplotColorFromGroup(group),
    };
}

/** The scene menu: Add scene, chapter and part, subplot moves, Status, Publish Stage, Pulse, Remove from timeline. */
export function showSceneContextMenu(view: SceneMenuHost, target: SceneMenuTarget, event: MouseEvent): void {
    const { file } = target;
    const cache = view.plugin.app.metadataCache.getFileCache(file);
    const frontmatter = (cache?.frontmatter ?? {}) as Record<string, unknown>;
    const currentChapterTitle = readSharedChapterTitle(frontmatter);
    const currentPartMarker = readPartMarker(frontmatter);
    const currentPartValue: string | true | undefined = currentPartMarker
        ? (currentPartMarker.titled && currentPartMarker.title ? currentPartMarker.title : true)
        : undefined;
    const currentPartLabel = currentPartMarker
        ? (currentPartMarker.title ?? t('ui.sceneContextMenu.partNumeralOnly'))
        : undefined;
    const pulseFlag = normalizeScalar(frontmatter['Pulse Update']);
    const pulseAlreadyFlagged = /^(yes|true|1)$/i.test(pulseFlag);

    const menu = new Menu();

    if (target.itemType === 'Scene') {
        menu.addItem(item => {
            item.setIcon('file-plus-2');
            item.setTitle(t('ui.sceneContextMenu.addScene'));
            item.onClick(() => {
                void addSceneAfterAnchor(view, target);
            });
        });
        menu.addItem(item => {
            item.setIcon('book-marked');
            item.setTitle(currentChapterTitle
                ? t('ui.sceneContextMenu.setChapterCurrent', { chapter: currentChapterTitle })
                : t('ui.sceneContextMenu.setChapter'));
            item.onClick(() => {
                void setChapterAtScene(view, file, currentChapterTitle);
            });
        });
        menu.addItem(item => {
            item.setIcon('bookmark');
            item.setTitle(currentPartLabel
                ? t('ui.sceneContextMenu.setPartCurrent', { part: currentPartLabel })
                : t('ui.sceneContextMenu.setPart'));
            item.onClick(() => {
                void setPartAtScene(view, file, currentPartValue);
            });
        });
        menu.addSeparator();
        addSubplotMenuItems(menu, view, target);
        menu.addSeparator();
    }

    addStatusMenuItems(menu, view, file);
    menu.addSeparator();
    addPublishStageMenuItems(menu, view, file);

    menu.addSeparator();

    menu.addItem(item => {
        item.setIcon('sparkles');
        item.setTitle(menuTitle(t('ui.sceneContextMenu.flagTripletPulse'), pulseAlreadyFlagged));
        item.onClick(() => {
            void updateSceneFrontmatter(
                view,
                file,
                (fm) => {
                    fm['Pulse Update'] = 'Yes';
                },
                t('ui.sceneContextMenu.flaggedTripletPulse', { name: file.basename })
            );
        });
    });

    if (target.itemType === 'Scene') {
        menu.addSeparator();
        menu.addItem(item => {
            item.setIcon('book-x');
            item.setTitle(t('ui.sceneContextMenu.removeFromTimeline'));
            item.onClick(() => { void removeSceneFromTimeline(view, file); });
        });
    }

    menu.showAtMouseEvent(event);
}

export function setupSceneContextMenu(view: SceneContextMenuView, svg: SVGSVGElement): void {
    view.renderScope.registerDomEvent(svg as unknown as HTMLElement, 'contextmenu', (event: Event) => {
        const mouseEvent = event as MouseEvent;
        const group = (mouseEvent.target as Element | null)?.closest(SCENE_CONTEXT_SELECTOR);
        if (!group) return;

        mouseEvent.preventDefault();
        mouseEvent.stopPropagation();
        const target = targetFromGroup(view, group);
        if (!target) {
            new Notice(t('ui.sceneContextMenu.sceneNoteNotFound'), 5000);
            return;
        }
        showSceneContextMenu(view, target, mouseEvent);
    });
}
