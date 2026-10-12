/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 *
 * Timetable: opening and following the book
 * -----------------------------------------
 * Registers the Bases view and the command, and opens the right `.base` file
 * for the timeline's current scope: the active book's table, or the saga
 * table. The timeline is the master view. A Timetable tab that RT opened
 * follows it when the author switches books; the Timetable never changes
 * which book the timeline shows.
 */

import { Notice, normalizePath, parseYaml, requireApiVersion, stringifyYaml, TFile, type WorkspaceLeaf } from 'obsidian';
import type RadialTimelinePlugin from '../main';
import { t } from '../i18n';
import { getActiveBook, getSagaBooks, getTimelineScope } from '../utils/books';
import { openSettingsTab } from '../utils/obsidianInternals';
import { confirmWithErtModal } from '../modals/ErtConfirmModal';
import { TIMELINE_VIEW_TYPE } from '../view/TimeLineView';
import { refreshTimetableViews, TimetableView, timetableViewOptions } from './TimetableView';
import {
    buildBookTimetableContent,
    buildSagaTimetableContent,
    findTimetableViewName,
    retargetFolderFilter,
    SAGA_TIMETABLE_KEY,
    tableFilePath,
    tableFileStem,
    TIMETABLES_FOLDER,
    TIMETABLE_VIEW_TYPE,
    type BaseFileContent,
    type TimetableFileRecord,
} from './timetableFiles';

const TIMETABLE_ICON = 'table-2';
const BASES_LEAF_TYPE = 'bases';
/** Obsidian's kanban view (the Act and Status boards) arrived in 1.14. */
const KANBAN_MIN_API = '1.14.0';

/** The table the timeline's current scope calls for. */
interface TimetableTarget {
    key: string;
    title: string;
    folders: string[];
    build: () => BaseFileContent;
}

export class TimetableService {
    private registered = false;
    /** Timetable tabs RT opened; these follow the timeline's book. */
    private readonly following = new Set<WorkspaceLeaf>();

    constructor(private readonly plugin: RadialTimelinePlugin) { }

    register(): void {
        this.ensureRegistered();
        this.plugin.addCommand({
            id: 'open-timetable',
            name: t('commands.openTimetable'),
            callback: () => { void this.open(); },
        });
        // After a restart, a table tab that matches the timeline's scope follows it again.
        this.plugin.app.workspace.onLayoutReady(() => this.adoptOpenTables());
    }

    /** Register the Bases view. False while the Bases core plugin is off. */
    private ensureRegistered(): boolean {
        if (this.registered) return true;
        this.registered = this.plugin.registerBasesView(TIMETABLE_VIEW_TYPE, {
            name: t('ui.timetable.viewName'),
            icon: TIMETABLE_ICON,
            factory: (controller, containerEl) => new TimetableView(controller, containerEl, this.plugin),
            options: timetableViewOptions,
        });
        return this.registered;
    }

    /** The title bar button and the command: open (or focus) the Timetable for the timeline's scope. */
    async open(): Promise<void> {
        if (!this.ensureRegistered()) {
            new Notice(t('ui.timetable.basesDisabled'), 8000);
            return;
        }
        const target = this.resolveTarget();
        if (!target) return;
        const file = await this.ensureFile(target);
        if (!file) return;
        await this.show(file);
    }

    /** Called when the timeline switches books or scope: re-target the tabs that follow it. */
    async followTimeline(): Promise<void> {
        refreshTimetableViews();
        const leaves = this.liveFollowingLeaves();
        if (leaves.length === 0) return;
        const target = this.resolveTarget({ quiet: true });
        if (!target) return;
        const file = await this.ensureFile(target);
        if (!file) return;
        const viewName = await this.timetableViewName(file);
        for (const leaf of leaves) {
            if (this.leafFilePath(leaf) === file.path) continue;
            await leaf.setViewState({ type: BASES_LEAF_TYPE, state: { file: file.path, viewName }, active: false });
        }
    }

    private resolveTarget(options: { quiet?: boolean } = {}): TimetableTarget | null {
        const { settings } = this.plugin;
        const names = {
            timetable: t('ui.timetable.viewName'),
            table: t('ui.timetable.viewTable'),
            notOnTimeline: t('ui.timetable.viewNotOnTimeline'),
            actBoard: t('ui.timetable.viewActBoard'),
            statusBoard: t('ui.timetable.viewStatusBoard'),
        };
        if (getTimelineScope(settings) === 'saga') {
            const books = getSagaBooks(settings);
            return {
                key: SAGA_TIMETABLE_KEY,
                title: t('ui.timetable.sagaTitle'),
                folders: books.map(book => book.sourceFolder),
                build: () => buildSagaTimetableContent(books, settings, names),
            };
        }
        const book = getActiveBook(settings);
        if (!book || !book.sourceFolder.trim()) {
            // No fallback to a vault-wide table: say why, and open Book Manager.
            if (!options.quiet) {
                new Notice(t('ui.timetable.noSourceFolder', { book: book?.title ?? t('ui.timetable.thisBook') }), 8000);
                this.plugin.settingsTab?.setActiveTab('core');
                openSettingsTab(this.plugin.app);
            }
            return null;
        }
        return {
            key: book.id,
            title: book.title,
            folders: [book.sourceFolder],
            build: () => buildBookTimetableContent(book, settings, names, requireApiVersion(KANBAN_MIN_API)),
        };
    }

    /** The table file for a target: found, kept pointed at the book's folder, or created after a confirm. */
    private async ensureFile(target: TimetableTarget): Promise<TFile | null> {
        const { app, settings } = this.plugin;
        const record = settings.timetableFiles?.[target.key];
        const existing = record ? app.vault.getFileByPath(record.path) : null;
        if (record && existing) {
            await this.followFolders(existing, record, target);
            return existing;
        }

        const path = this.availablePath(tableFilePath(tableFileStem(target.title)));
        const confirmed = await confirmWithErtModal(app, {
            title: t('ui.timetable.createTitle', { book: target.title }),
            message: t('ui.timetable.createMessage', { path }),
            confirmText: t('ui.timetable.createButton'),
            cancelText: t('common.cancel'),
            badge: { text: t('ui.timetable.viewName'), icon: TIMETABLE_ICON },
        });
        if (!confirmed) return null;

        try {
            await this.ensureFolder(TIMETABLES_FOLDER);
            const file = await app.vault.create(path, stringifyYaml(target.build()));
            await this.remember(target.key, { path: file.path, folders: target.folders });
            return file;
        } catch (error) {
            console.error('[Timetable] Could not write the table file:', error);
            new Notice(t('ui.timetable.writeFailed', { message: error instanceof Error ? error.message : String(error) }), 8000);
            return null;
        }
    }

    /**
     * Keep the table's folder filter on the book's folder when the book has
     * moved. Only the filter term RT wrote changes; if the author edited it,
     * the file is left alone.
     */
    private async followFolders(file: TFile, record: TimetableFileRecord, target: TimetableTarget): Promise<void> {
        if (record.folders.join('\n') === target.folders.join('\n')) return;
        const { app } = this.plugin;
        if (target.key === SAGA_TIMETABLE_KEY) {
            // The saga's book list changed: replace the filter, keep everything else.
            await app.vault.process(file, content => {
                const parsed = parseYaml(content) as Record<string, unknown> | null;
                if (!parsed || typeof parsed !== 'object') return content;
                return stringifyYaml({ ...parsed, filters: target.build().filters });
            });
        } else if (record.folders.length === 1) {
            await app.vault.process(file, content => retargetFolderFilter(content, record.folders[0], target.folders[0]) ?? content);
        }
        await this.remember(target.key, { path: file.path, folders: target.folders });
    }

    private async remember(key: string, record: TimetableFileRecord): Promise<void> {
        const { settings } = this.plugin;
        settings.timetableFiles = { ...(settings.timetableFiles ?? {}), [key]: record };
        await this.plugin.saveSettings();
    }

    private availablePath(path: string): string {
        const { vault } = this.plugin.app;
        if (!vault.getAbstractFileByPath(path)) return path;
        const stem = path.replace(/\.base$/, '');
        let counter = 2;
        while (vault.getAbstractFileByPath(`${stem} ${counter}.base`)) counter += 1;
        return `${stem} ${counter}.base`;
    }

    private async ensureFolder(folder: string): Promise<void> {
        const { vault } = this.plugin.app;
        let current = '';
        for (const segment of normalizePath(folder).split('/')) {
            current = current ? `${current}/${segment}` : segment;
            if (!vault.getAbstractFileByPath(current)) await vault.createFolder(current);
        }
    }

    private async timetableViewName(file: TFile): Promise<string | undefined> {
        try {
            return findTimetableViewName(parseYaml(await this.plugin.app.vault.cachedRead(file))) ?? undefined;
        } catch {
            return undefined; // SAFE: a hand-edited file that no longer parses opens on its first view
        }
    }

    /** Focus the table if it's open; otherwise open it beside the timeline. */
    private async show(file: TFile): Promise<void> {
        const { workspace } = this.plugin.app;
        const viewName = await this.timetableViewName(file);
        const open = workspace.getLeavesOfType(BASES_LEAF_TYPE).find(leaf => this.leafFilePath(leaf) === file.path);
        if (open) {
            this.following.add(open);
            await workspace.revealLeaf(open);
            return;
        }
        // Re-use a following tab that shows another table rather than opening a second one.
        const reuse = this.liveFollowingLeaves()[0];
        const timeline = workspace.getLeavesOfType(TIMELINE_VIEW_TYPE).find(leaf => leaf.getRoot() === workspace.rootSplit);
        const leaf = reuse ?? (timeline ? workspace.createLeafBySplit(timeline, 'vertical') : workspace.getLeaf('tab'));
        await leaf.setViewState({ type: BASES_LEAF_TYPE, state: { file: file.path, viewName }, active: true });
        this.following.add(leaf);
        await workspace.revealLeaf(leaf);
    }

    /** The file a bases tab shows, read from its state so deferred (not yet shown) tabs count too. */
    private leafFilePath(leaf: WorkspaceLeaf): string | null {
        const state = leaf.getViewState();
        if (state.type !== BASES_LEAF_TYPE) return null;
        const file = (state.state as { file?: unknown } | undefined)?.file;
        return typeof file === 'string' ? file : null;
    }

    private liveFollowingLeaves(): WorkspaceLeaf[] {
        const open = new Set(this.plugin.app.workspace.getLeavesOfType(BASES_LEAF_TYPE));
        const tablePaths = new Set(Object.values(this.plugin.settings.timetableFiles ?? {}).map(record => record.path));
        for (const leaf of [...this.following]) {
            const path = this.leafFilePath(leaf);
            // A tab the author closed, or pointed at some other base, stops following.
            if (!open.has(leaf) || !path || !tablePaths.has(path)) this.following.delete(leaf);
        }
        return [...this.following];
    }

    /** Tables already open for the timeline's current scope follow it, as they did before the restart. */
    private adoptOpenTables(): void {
        const { settings } = this.plugin;
        const key = getTimelineScope(settings) === 'saga' ? SAGA_TIMETABLE_KEY : getActiveBook(settings)?.id;
        const path = key ? settings.timetableFiles?.[key]?.path : undefined;
        if (!path) return;
        for (const leaf of this.plugin.app.workspace.getLeavesOfType(BASES_LEAF_TYPE)) {
            if (this.leafFilePath(leaf) === path) this.following.add(leaf);
        }
    }
}
