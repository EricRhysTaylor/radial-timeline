import { resolveSubplotColorFromGroup } from './dragGeometry';
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
import { frontmatterValueToText } from '../../utils/frontmatter';
import { formatLocalDateKey } from '../../utils/date';

type SceneContextMenuView = {
    plugin: {
        app: App;
        settings: RadialTimelineSettings;
        getSceneData?: () => Promise<TimelineItem[]>;
        refreshTimelineIfNeeded?: (file: TFile | null, delayMs?: number) => void;
    };
    renderScope: {
        register: (cb: () => void) => void;
        registerDomEvent: (el: HTMLElement, event: string, handler: (ev: Event) => void) => void;
    };
    refreshTimeline?: () => void;
};

type TimelineStatusOption = {
    label: string;
    value: 'Todo' | 'Working' | 'Complete';
    normalized: 'Todo' | 'Working' | 'Completed';
    icon: string;
};

type PublishStageOption = {
    label: string;
    value: 'Zero' | 'Author' | 'House' | 'Press';
    icon: string;
};

const SCENE_CONTEXT_SELECTOR = '.rt-scene-group[data-item-type="Scene"], .rt-scene-group[data-item-type="Backdrop"]';
const CHAPTER_INSERT_BEFORE_KEYS = ['Synopsis'];
const CHAPTER_INSERT_AFTER_KEYS = ['Duration', 'When', 'Act', 'Class'];

const STATUS_OPTIONS: TimelineStatusOption[] = [
    { label: 'Todo', value: 'Todo', normalized: 'Todo', icon: 'circle' },
    { label: 'Working', value: 'Working', normalized: 'Working', icon: 'loader' },
    { label: 'Complete', value: 'Complete', normalized: 'Completed', icon: 'check-circle-2' },
];

const PUBLISH_STAGE_OPTIONS: PublishStageOption[] = [
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

function getSceneFile(view: SceneContextMenuView, group: Element): TFile | null {
    const filePath = getEncodedScenePath(group);
    if (!filePath) return null;

    const file = view.plugin.app.vault.getAbstractFileByPath(filePath);
    return file instanceof TFile ? file : null;
}

function refreshTimelineView(view: SceneContextMenuView, file: TFile): void {
    if (typeof view.plugin.refreshTimelineIfNeeded === 'function') {
        view.plugin.refreshTimelineIfNeeded(file, 100);
        return;
    }
    if (typeof view.refreshTimeline === 'function') {
        view.refreshTimeline();
    }
}

async function updateSceneFrontmatter(
    view: SceneContextMenuView,
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
        new Notice(`Could not update ${file.basename}. Review the note frontmatter and try again.`, 7000);
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
    view: SceneContextMenuView,
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
    view: SceneContextMenuView,
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
    view: SceneContextMenuView,
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
    view: SceneContextMenuView,
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
    view: SceneContextMenuView,
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
    view: SceneContextMenuView,
    file: TFile,
    currentValue: string | true | undefined
): Promise<void> {
    if (typeof view.plugin.getSceneData !== 'function') {
        new Notice('Could not set part because timeline scene data is unavailable.', 5000);
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
            await clearPartMarker(view, file, `Cleared part marker from ${file.basename}.`);
            return;
        }
        if (result.value !== undefined) {
            await writePartMarker(view, file, result.value, `Set part marker on ${file.basename}.`);
        }
    } catch (error) {
        console.error('[SceneContextMenu] Failed to set part:', error);
        new Notice(`Could not set part for ${file.basename}. Review the console for details.`, 7000);
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

async function addSceneAfterAnchor(view: SceneContextMenuView, group: Element, file: TFile): Promise<void> {
    if (typeof view.plugin.getSceneData !== 'function') {
        new Notice('Could not add scene because timeline scene data is unavailable.', 5000);
        return;
    }

    const plan = await planSceneInsertion({
        app: view.plugin.app,
        settings: view.plugin.settings,
        anchorFile: file,
        primarySubplot: resolvePrimarySubplotFromGroup(group),
        getSceneData: view.plugin.getSceneData.bind(view.plugin),
        beatModel: resolveSelectedBeatModelFromSettings(view.plugin.settings)
    }).catch((error) => {
        console.error('[SceneContextMenu] Failed to plan scene insert:', error);
        new Notice(`Could not add a scene after ${file.basename}. Review the console for details.`, 7000);
        return null;
    });
    if (!plan) return;

    const modal = new AddSceneConfirmModal(
        view.plugin.app,
        plan,
        resolveSubplotColorFromGroup(group)
    );
    const started = await modal.waitForBegin();
    if (!started) return;

    // The modal stays open through the insert. Keeping it open also defers
    // FileTrackingService's timeline refresh (gated on an open modal), so the
    // create lands as one quiet update instead of a refresh plus a notice.
    // Progress and the final summary live in the modal.
    try {
        const result = await applySceneInsertionPlan(view.plugin.app, plan);
        modal.updateProgress('Refreshing timeline...');
        await new Promise((resolve) => window.setTimeout(resolve, 100));
        const createdFile = view.plugin.app.vault.getAbstractFileByPath(result.path);
        if (createdFile instanceof TFile) {
            refreshTimelineView(view, createdFile);
            await openOrRevealFile(view.plugin.app, createdFile, false);
        } else {
            refreshTimelineView(view, file);
        }
        await modal.finishWithDismiss(`Added scene after ${file.basename}.`);
    } catch (error) {
        console.error('[SceneContextMenu] Failed to add scene:', error);
        await modal.finishWithDismiss(`Could not add a scene after ${file.basename}. Review the console for details, then dismiss.`, true);
    }
}

async function setChapterAtScene(view: SceneContextMenuView, file: TFile, currentChapterTitle: string | undefined): Promise<void> {
    if (typeof view.plugin.getSceneData !== 'function') {
        new Notice('Could not set chapter because timeline scene data is unavailable.', 5000);
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
            await clearChapterMarker(view, file, `Cleared chapter marker from ${file.basename}.`);
            return;
        }

        const title = result.title?.trim();
        if (title) {
            await writeChapterMarker(view, file, title, `Set chapter marker on ${file.basename}.`);
        }
    } catch (error) {
        console.error('[SceneContextMenu] Failed to set chapter:', error);
        new Notice(`Could not set chapter for ${file.basename}. Review the console for details.`, 7000);
    }
}

function showSceneContextMenu(view: SceneContextMenuView, group: Element, event: MouseEvent): void {
    const file = getSceneFile(view, group);
    if (!file) {
        new Notice('Could not find the scene note for this timeline segment.', 5000);
        return;
    }

    const cache = view.plugin.app.metadataCache.getFileCache(file);
    const frontmatter = (cache?.frontmatter ?? {}) as Record<string, unknown>;
    const currentStatus = normalizeStatus(frontmatter.Status);
    const currentStage = normalizeScalar(frontmatter['Publish Stage']) || 'Zero';
    const currentChapterTitle = readSharedChapterTitle(frontmatter);
    const currentPartMarker = readPartMarker(frontmatter);
    const currentPartValue: string | true | undefined = currentPartMarker
        ? (currentPartMarker.titled && currentPartMarker.title ? currentPartMarker.title : true)
        : undefined;
    const currentPartLabel = currentPartMarker
        ? (currentPartMarker.title ?? 'numeral only')
        : undefined;
    const pulseFlag = normalizeScalar(frontmatter['Pulse Update']);
    const pulseAlreadyFlagged = /^(yes|true|1)$/i.test(pulseFlag);

    const menu = new Menu();
    const itemType = group.getAttribute('data-item-type');

    if (itemType === 'Scene') {
        menu.addItem(item => {
            item.setIcon('file-plus-2');
            item.setTitle('Add scene');
            item.onClick(() => {
                void addSceneAfterAnchor(view, group, file);
            });
        });
        menu.addItem(item => {
            item.setIcon('book-marked');
            item.setTitle(currentChapterTitle ? `Set chapter… (${currentChapterTitle})` : 'Set chapter…');
            item.onClick(() => {
                void setChapterAtScene(view, file, currentChapterTitle);
            });
        });
        menu.addItem(item => {
            item.setIcon('bookmark');
            item.setTitle(currentPartLabel ? `Set part… (${currentPartLabel})` : 'Set part…');
            item.onClick(() => {
                void setPartAtScene(view, file, currentPartValue);
            });
        });
        menu.addSeparator();
    }

    STATUS_OPTIONS.forEach(option => {
        menu.addItem(item => {
            item.setIcon(option.icon);
            item.setTitle(menuTitle(option.label, currentStatus === option.normalized));
            item.onClick(() => {
                void updateSceneFrontmatter(
                    view,
                    file,
                    (fm) => {
                        fm.Status = option.value;
                        if (option.value === 'Complete') {
                            fm.Due = formatLocalDateKey();
                        }
                    },
                    option.value === 'Complete'
                        ? `Marked ${file.basename} complete and set Due to today.`
                        : `Set ${file.basename} status to ${option.label}.`
                );
            });
        });
    });

    menu.addSeparator();

    PUBLISH_STAGE_OPTIONS.forEach(option => {
        menu.addItem(item => {
            item.setIcon(option.icon);
            item.setTitle(menuTitle(option.label, currentStage.toLowerCase() === option.value.toLowerCase()));
            item.onClick(() => {
                void updateSceneFrontmatter(
                    view,
                    file,
                    (fm) => {
                        fm['Publish Stage'] = option.value;
                    },
                    `Set ${file.basename} publish stage to ${option.label}.`
                );
            });
        });
    });

    menu.addSeparator();

    menu.addItem(item => {
        item.setIcon('sparkles');
        item.setTitle(menuTitle('Flag Triplet Pulse', pulseAlreadyFlagged));
        item.onClick(() => {
            void updateSceneFrontmatter(
                view,
                file,
                (fm) => {
                    fm['Pulse Update'] = 'Yes';
                },
                `Flagged ${file.basename} for triplet pulse.`
            );
        });
    });

    menu.showAtMouseEvent(event);
}

export function setupSceneContextMenu(view: SceneContextMenuView, svg: SVGSVGElement): void {
    view.renderScope.registerDomEvent(svg as unknown as HTMLElement, 'contextmenu', (event: Event) => {
        const mouseEvent = event as MouseEvent;
        const group = (mouseEvent.target as Element | null)?.closest(SCENE_CONTEXT_SELECTOR);
        if (!group) return;

        mouseEvent.preventDefault();
        mouseEvent.stopPropagation();
        showSceneContextMenu(view, group, mouseEvent);
    });
}
