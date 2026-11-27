/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 *
 * Writing Studio: Reading View
 * ----------------------------
 * The active book as one continuous manuscript, read straight from its scene
 * notes, with the book's wheel and contents on the left and the scene being
 * read on the right. The layout follows the Community book reader:
 * - Left rail: the compact wheel, a caption naming a scene, the contents.
 *   Choosing a wedge or an entry scrolls the manuscript to that scene.
 * - Center: the manuscript, with the current location and previous/next by
 *   the reading header. Scope (whole book, chapter, scene) and step unit
 *   (scene, chapter) are independent.
 * - Right rail: the scene being read, and Open source note.
 * Narrow panes fold the navigator into a strip above the manuscript and the
 * scene details behind a header button (container queries, writing-studio.css).
 *
 * The prose is rendered with Obsidian's own Markdown renderer from each scene
 * note's body. An edit to a scene note re-renders that scene in place; a
 * change to the book's order, chapters or acts rebuilds the manuscript at the
 * scene being read. Nothing is exported and nothing is written to the notes.
 */

import { Component, ItemView, Keymap, MarkdownRenderer, MarkdownView, TFile, getFrontMatterInfo, setIcon, type ViewStateResult, type WorkspaceLeaf } from 'obsidian';
import type RadialTimelinePlugin from '../main';
import { t } from '../i18n';
import { getActiveBook } from '../utils/books';
import { bookChapterContext } from '../utils/timelineChapters';
import { isPathInFolderScope } from '../utils/pathScope';
import { stripEditorialistReviewBlocks } from '../utils/manuscriptSanitize';
import { extractCountableBodyText, formatExportWhen } from '../utils/manuscript';
import { countWords } from '../utils/text';
import { toRomanNumeral } from '../utils/romanNumerals';
import { setAccessibleLabel, setTooltip } from '../utils/domTooltip';
import { assignSubplotColors, bookOwnSubplotColors, subplotColorCss, subplotColorOn } from '../renderer/utils/subplotColors';
import { WRITING_STUDIO_VIEW_TYPE } from './constants';
import { actStarts, buildOutline, buildStudioBook, chapterAt, chapterTitleIsNumber, scopeRange, stepTarget, type OutlineLeaf, type StudioBook, type StudioScene, type StudioScope, type StudioUnit } from './studioModel';
import { buildStudioWheel, wheelSubplotOrder, type StudioWheelHandle } from './studioWheel';

interface StudioState {
    scenePath?: string;
    scope?: StudioScope;
    unit?: StudioUnit;
}

/** How far down the reading column a scene must reach to be the one being read. */
const READING_LINE = 0.3;
/** How long the reading position must rest before the source split follows it, in ms. */
const FOLLOW_DELAY_MS = 300;
const MODEL_REFRESH_MS = 500;
const PROSE_REFRESH_MS = 250;

/** "Act II". Acts in the studio model are always 1 or more. */
function actLabel(act: number): string {
    return t('ui.writingStudio.act', { n: toRomanNumeral(act) ?? String(act) });
}

interface RenderedScene {
    section: HTMLElement;
    prose: HTMLElement;
    component: Component | null;
    words: number | null;
}

export class WritingStudioView extends ItemView {
    navigation = true;

    private book: StudioBook | null = null;
    private bookTitle = '';
    private sourceFolder = '';
    private current = 0;
    private readingScope: StudioScope = 'book';
    private unit: StudioUnit = 'scene';
    private pendingScenePath: string | null = null;
    private loadToken = 0;
    private rendered = new Map<number, RenderedScene>();
    /** Listeners on controls inside a region that is rebuilt; replaced with the region. */
    private regionEvents = new Map<'head' | 'details' | 'text', Component>();
    private range = { first: 0, last: -1 };

    private rootEl!: HTMLElement;
    private navEl!: HTMLElement;
    private stripKickerEl!: HTMLElement;
    private stripTitleEl!: HTMLElement;
    private stripActionEl!: HTMLElement;
    private wheelHostEl!: HTMLElement;
    private captionEl!: HTMLElement;
    private contentsEl!: HTMLElement;
    private mainEl!: HTMLElement;
    private headEl!: HTMLElement;
    private textEl!: HTMLElement;
    private detailsEl!: HTMLElement;
    private wheel: StudioWheelHandle | null = null;
    private hovered: number | null = null;
    /** A scene's wedge color: its primary subplot's timeline color. Set with the wheel. */
    private sceneColor: (scene: StudioScene) => string = () => {
        throw new Error('Writing Studio: a scene color was read before the wheel was built.');
    };
    /** Chapters folded in the contents; kept while the view is open. */
    private foldedChapters = new Set<number>();

    /** Set by a jump: the scene stays current until the author scrolls themselves. */
    private pinned: number | null = null;
    private scrollFrame = 0;
    private modelTimer: number | null = null;
    private proseTimers = new Map<string, number>();
    /**
     * The split beside the studio that Open source note opened. It follows the
     * scene being read until the author closes it or opens another note in it.
     */
    private sourceLeaf: WorkspaceLeaf | null = null;
    private followTimer: number | null = null;

    constructor(leaf: WorkspaceLeaf, private plugin: RadialTimelinePlugin) {
        super(leaf);
    }

    getViewType(): string {
        return WRITING_STUDIO_VIEW_TYPE;
    }

    getDisplayText(): string {
        return this.bookTitle ? t('ui.writingStudio.tabTitle', { book: this.bookTitle }) : t('ui.writingStudio.title');
    }

    getIcon(): string {
        return 'book-open-text';
    }

    getState(): Record<string, unknown> {
        const scene = this.book?.scenes[this.current];
        return { scenePath: scene?.path ?? this.pendingScenePath ?? undefined, scope: this.readingScope, unit: this.unit };
    }

    async setState(state: unknown, result: ViewStateResult): Promise<void> {
        const next = (state ?? {}) as StudioState;
        if (next.scope === 'book' || next.scope === 'chapter' || next.scope === 'scene') this.readingScope = next.scope;
        if (next.unit === 'scene' || next.unit === 'chapter') this.unit = next.unit;
        if (typeof next.scenePath === 'string' && next.scenePath.length > 0) {
            this.pendingScenePath = next.scenePath;
            if (this.book) {
                const index = this.book.scenes.findIndex(scene => scene.path === next.scenePath);
                if (index >= 0) this.goTo(index);
            }
        }
        await super.setState(state, result);
    }

    /** Re-read the book and its chapters, staying at the scene being read. */
    refreshBook(): void {
        void this.reload();
    }

    /** Open at a scene of the book being read (from the timeline or Timetable). */
    showScene(path: string): void {
        this.pendingScenePath = path;
        if (!this.book) return;
        const index = this.book.scenes.findIndex(scene => scene.path === path);
        if (index >= 0) this.goTo(index);
        else void this.reload();
    }

    async onOpen(): Promise<void> {
        this.contentEl.empty();
        this.contentEl.addClass('ert-studio-host');
        this.buildShell();
        this.registerLiveUpdates();
        this.app.workspace.onLayoutReady(() => { void this.reload(); });
    }

    async onClose(): Promise<void> {
        this.unloadRendered();
        if (this.modelTimer !== null) window.clearTimeout(this.modelTimer);
        for (const timer of this.proseTimers.values()) window.clearTimeout(timer);
        this.proseTimers.clear();
        if (this.scrollFrame) window.cancelAnimationFrame(this.scrollFrame);
        if (this.followTimer !== null) window.clearTimeout(this.followTimer);
    }

    // ── Shell ────────────────────────────────────────────────────────────

    private buildShell(): void {
        this.rootEl = this.contentEl.createDiv({ cls: 'ert-studio' });

        this.navEl = setAccessibleLabel(this.rootEl.createEl('nav', { cls: 'ert-studio__nav' }), t('ui.writingStudio.navLabel'));
        const strip = this.navEl.createEl('button', { cls: 'ert-studio__strip', attr: { type: 'button', 'aria-expanded': 'false' } });
        const stripText = strip.createSpan({ cls: 'ert-studio__strip-text' });
        this.stripKickerEl = stripText.createSpan({ cls: 'ert-studio__strip-kicker' });
        this.stripTitleEl = stripText.createSpan({ cls: 'ert-studio__strip-title' });
        this.stripActionEl = strip.createSpan({ cls: 'ert-studio__strip-action', text: t('ui.writingStudio.stripTimeline') });
        this.registerDomEvent(strip, 'click', () => this.setNavOpen(this.rootEl.dataset.navOpen !== 'true'));

        const panel = this.navEl.createDiv({ cls: 'ert-studio__nav-panel' });
        this.wheelHostEl = panel.createDiv({ cls: 'ert-studio__wheel' });
        this.registerDomEvent(this.wheelHostEl, 'pointerover', event => {
            const index = Number((event.target as Element).closest('[data-scene-index]')?.getAttribute('data-scene-index'));
            this.hovered = Number.isInteger(index) ? index : null;
            this.renderCaption();
        });
        this.registerDomEvent(this.wheelHostEl, 'pointerleave', () => { this.hovered = null; this.renderCaption(); });
        this.registerDomEvent(this.wheelHostEl, 'click', (event: MouseEvent) => {
            const index = Number((event.target as Element).closest('[data-scene-index]')?.getAttribute('data-scene-index'));
            if (!Number.isInteger(index)) return;
            this.setNavOpen(false);
            this.goTo(index);
        });
        this.captionEl = panel.createDiv({ cls: 'ert-studio__caption' });
        this.contentsEl = panel.createDiv({ cls: 'ert-studio__contents' });

        this.mainEl = this.rootEl.createDiv({ cls: 'ert-studio__main' });
        this.headEl = this.mainEl.createEl('header', { cls: 'ert-studio__head' });
        this.textEl = this.mainEl.createEl('article', { cls: 'ert-studio__text' });
        this.registerDomEvent(this.textEl, 'click', (event: MouseEvent) => this.followLink(event));

        this.detailsEl = setAccessibleLabel(this.rootEl.createEl('aside', { cls: 'ert-studio__details' }), t('ui.writingStudio.details'));

        this.registerDomEvent(this.mainEl, 'scroll', () => this.scheduleSpy(), { passive: true });
        // Any reading gesture of the author's own releases a jump's pin.
        for (const type of ['wheel', 'touchmove', 'pointerdown', 'keydown'] as const) {
            this.registerDomEvent(this.mainEl, type, () => { this.pinned = null; }, { passive: true });
        }
        // Back in the studio after writing in the source split: it catches up.
        this.registerDomEvent(this.rootEl, 'pointerdown', () => this.scheduleFollow(), { passive: true });
    }

    private setNavOpen(open: boolean): void {
        if (open) this.rootEl.dataset.navOpen = 'true';
        else delete this.rootEl.dataset.navOpen;
        this.navEl.querySelector('.ert-studio__strip')?.setAttribute('aria-expanded', String(open));
        this.stripActionEl.setText(open ? t('ui.writingStudio.stripClose') : t('ui.writingStudio.stripTimeline'));
    }

    private setDetailsOpen(open: boolean): void {
        if (open) this.rootEl.dataset.detailsOpen = 'true';
        else delete this.rootEl.dataset.detailsOpen;
        this.headEl.querySelector('.ert-studio__details-toggle')?.setAttribute('aria-expanded', String(open));
    }

    private showMessage(text: string): void {
        this.unloadRendered();
        this.book = null;
        this.wheel = null;
        this.wheelHostEl.empty();
        this.captionEl.empty();
        this.contentsEl.empty();
        this.headEl.empty();
        this.detailsEl.empty();
        this.textEl.empty();
        this.textEl.createDiv({ cls: 'ert-studio__message', text });
        this.stripKickerEl.setText('');
        this.stripTitleEl.setText(t('ui.writingStudio.title'));
    }

    // ── Loading ──────────────────────────────────────────────────────────

    /** Read the active book and render it at the scene being read. */
    private async reload(): Promise<void> {
        const token = ++this.loadToken;
        const profile = getActiveBook(this.plugin.settings);
        if (!profile || !profile.sourceFolder) {
            this.bookTitle = '';
            this.showMessage(t('ui.writingStudio.noBook'));
            return;
        }
        const keepPath = this.pendingScenePath ?? this.book?.scenes[this.current]?.path ?? null;
        const items = await this.plugin.getSceneData({ sourcePath: profile.sourceFolder });
        if (token !== this.loadToken) return;
        const book = buildStudioBook(items, bookChapterContext(profile));
        this.bookTitle = profile.title;
        this.sourceFolder = profile.sourceFolder;
        // The tab title names the book.
        (this.leaf as unknown as { updateHeader?: () => void }).updateHeader?.(); // SAFE: Obsidian's untyped leaf header refresh, as InquiryView and TimeLineView use it.
        if (book.scenes.length === 0) {
            this.showMessage(t('ui.writingStudio.noScenes'));
            return;
        }
        this.book = book;
        const found = keepPath ? book.scenes.findIndex(scene => scene.path === keepPath) : -1;
        this.current = found >= 0 ? found : Math.min(this.current, book.scenes.length - 1);
        this.pendingScenePath = null;
        this.renderNavigator(profile);
        await this.renderManuscript(token);
    }

    private registerLiveUpdates(): void {
        const inBook = (path: string): boolean => !!this.sourceFolder && isPathInFolderScope(path, this.sourceFolder);
        this.registerEvent(this.app.metadataCache.on('changed', file => {
            if (!inBook(file.path)) return;
            this.scheduleProse(file.path);
            this.scheduleModel();
        }));
        this.registerEvent(this.app.vault.on('create', file => { if (inBook(file.path)) this.scheduleModel(); }));
        this.registerEvent(this.app.vault.on('delete', file => { if (inBook(file.path)) this.scheduleModel(); }));
        this.registerEvent(this.app.vault.on('rename', (file, oldPath) => {
            if (inBook(file.path) || inBook(oldPath)) this.scheduleModel();
        }));
        // Another book chosen in Settings → Books.
        this.registerEvent(this.app.workspace.on('layout-change', () => {
            const profile = getActiveBook(this.plugin.settings);
            if (profile && profile.sourceFolder !== this.sourceFolder) void this.reload();
        }));
    }

    private scheduleModel(): void {
        if (this.modelTimer !== null) window.clearTimeout(this.modelTimer);
        this.modelTimer = window.setTimeout(() => { this.modelTimer = null; void this.refreshModel(); }, MODEL_REFRESH_MS);
    }

    private scheduleProse(path: string): void {
        const pending = this.proseTimers.get(path);
        if (pending !== undefined) window.clearTimeout(pending);
        this.proseTimers.set(path, window.setTimeout(() => {
            this.proseTimers.delete(path);
            void this.refreshProse(path);
        }, PROSE_REFRESH_MS));
    }

    /** The book's shape as the manuscript shows it; a change means the manuscript is rebuilt. */
    private structureKey(book: StudioBook): string {
        return book.scenes.map(scene => `${scene.path}|${scene.title}|${scene.act}|${scene.chapter ?? ''}`).join('\n')
            + '\n#' + book.chapters.map(chapter => chapter.title).join('\n');
    }

    private async refreshModel(): Promise<void> {
        const profile = getActiveBook(this.plugin.settings);
        if (!this.book || !profile || profile.sourceFolder !== this.sourceFolder) { await this.reload(); return; }
        const token = this.loadToken;
        const items = await this.plugin.getSceneData({ sourcePath: profile.sourceFolder });
        if (token !== this.loadToken || !this.book) return;
        const book = buildStudioBook(items, bookChapterContext(profile));
        if (book.scenes.length === 0 || this.structureKey(book) !== this.structureKey(this.book)) {
            await this.reload();
            return;
        }
        // Same manuscript; details (synopsis, status, subplots) may have changed.
        this.book = book;
        this.renderNavigator(profile);
        this.renderHeader();
        this.renderDetails();
    }

    private async refreshProse(path: string): Promise<void> {
        if (!this.book) return;
        const index = this.book.scenes.findIndex(scene => scene.path === path);
        const entry = this.rendered.get(index);
        if (!entry) return;
        await this.keepingPlace(() => this.renderProse(this.book!.scenes[index], entry)); // SAFE: checked non-null above; the callback runs before any await
        if (index === this.current) this.renderDetails();
    }

    // ── Navigator ────────────────────────────────────────────────────────

    private renderNavigator(profile: NonNullable<ReturnType<typeof getActiveBook>>): void {
        const book = this.book;
        if (!book) return;
        const colors = assignSubplotColors(wheelSubplotOrder(book), bookOwnSubplotColors(profile));
        const colorFor = (subplot: string): string => subplotColorCss(subplotColorOn(colors, subplot));
        this.sceneColor = (scene: StudioScene): string => colorFor(scene.subplots[0]);
        this.paintSceneColor();

        this.wheelHostEl.empty();
        this.wheel = buildStudioWheel(this.contentEl.ownerDocument, book, colorFor);
        this.wheel.svg.setAttribute('role', 'img');
        setAccessibleLabel(this.wheel.svg, t('ui.writingStudio.wheelLabel', { book: this.bookTitle }));
        this.wheelHostEl.appendChild(this.wheel.svg);
        this.wheel.setCurrent(this.current);

        this.renderContents(book);
        this.contentsEl.onclick = event => {
            const fold = (event.target as Element).closest<HTMLElement>('.ert-studio__toc-fold');
            if (fold) {
                this.toggleChapterFold(Number(fold.dataset.chapterIndex));
                return;
            }
            const link = (event.target as Element).closest<HTMLElement>('[data-scene-index]');
            if (!link) return;
            this.setNavOpen(false);
            this.goTo(Number(link.dataset.sceneIndex));
        };
        this.markContents();
        this.renderCaption();
    }

    /**
     * The contents as an outline (buildOutline): act headings; chapters with
     * a book-mark icon, their scene count and a fold control, their scenes and
     * beats indented on a guide line; scenes outside a chapter and story beats
     * between chapters at act level. Beats have no prose, so they are quiet
     * markers rather than links.
     */
    private renderContents(book: StudioBook): void {
        this.contentsEl.empty();
        this.contentsEl.createEl('h2', { cls: 'ert-studio__contents-heading', text: t('ui.writingStudio.contents') });
        const leaf = (list: HTMLElement, entry: OutlineLeaf): void => {
            if (entry.kind === 'beat') {
                const beat = book.beats[entry.beat];
                const item = list.createEl('li', { cls: 'ert-studio__toc-beat' });
                setIcon(item.createSpan({ cls: 'ert-studio__toc-icon' }), 'milestone');
                item.createSpan({ cls: 'ert-studio__toc-beat-name', text: beat.name });
                return;
            }
            const scene = book.scenes[entry.scene];
            const link = list.createEl('li').createEl('button', { cls: 'ert-studio__contents-link', attr: { type: 'button' } });
            link.dataset.sceneIndex = String(scene.index);
            link.createSpan({ cls: 'ert-studio__contents-num', text: scene.prefix ?? String(scene.index + 1) });
            link.createSpan({ cls: 'ert-studio__contents-name', text: scene.name });
        };
        for (const act of buildOutline(book)) {
            const section = this.contentsEl.createEl('section', { cls: 'ert-studio__toc-act' });
            section.createDiv({ cls: 'ert-studio__toc-act-head', text: actLabel(act.act) });
            const list = section.createEl('ol', { cls: 'ert-studio__toc' });
            for (const entry of act.entries) {
                if (entry.kind !== 'chapter') { leaf(list, entry); continue; }
                const chapter = book.chapters[entry.chapter];
                const item = list.createEl('li', { cls: 'ert-studio__toc-chapter' });
                item.dataset.chapterIndex = String(chapter.index);
                item.toggleClass('is-folded', this.foldedChapters.has(chapter.index));
                const row = item.createDiv({ cls: 'ert-studio__toc-chapter-row' });
                const fold = row.createEl('button', { cls: 'clickable-icon ert-studio__toc-fold', attr: { type: 'button' } });
                fold.dataset.chapterIndex = String(chapter.index);
                setIcon(fold, 'chevron-down');
                setTooltip(fold, this.foldedChapters.has(chapter.index) ? t('ui.writingStudio.unfoldChapter') : t('ui.writingStudio.foldChapter'));
                const firstScene = entry.children.find(child => child.kind === 'scene');
                const link = row.createEl('button', { cls: 'ert-studio__contents-link ert-studio__contents-link--chapter', attr: { type: 'button' } });
                link.dataset.sceneIndex = String(firstScene && firstScene.kind === 'scene' ? firstScene.scene : chapter.firstScene);
                link.dataset.chapterIndex = String(chapter.index);
                setIcon(link.createSpan({ cls: 'ert-studio__toc-icon' }), 'bookmark');
                link.createSpan({ cls: 'ert-studio__contents-name', text: entry.continued ? t('ui.writingStudio.chapterContinued', { title: chapter.title }) : chapter.title });
                link.createSpan({ cls: 'ert-studio__toc-count', text: String(entry.children.filter(child => child.kind === 'scene').length) });
                const children = item.createEl('ol', { cls: 'ert-studio__toc ert-studio__toc--children' });
                for (const child of entry.children) leaf(children, child);
            }
        }
    }

    private toggleChapterFold(chapter: number): void {
        if (this.foldedChapters.has(chapter)) this.foldedChapters.delete(chapter);
        else this.foldedChapters.add(chapter);
        const folded = this.foldedChapters.has(chapter);
        this.contentsEl.querySelectorAll<HTMLElement>(`.ert-studio__toc-chapter[data-chapter-index="${chapter}"]`).forEach(item => {
            item.toggleClass('is-folded', folded);
            const fold = item.querySelector<HTMLElement>('.ert-studio__toc-fold');
            if (fold) setTooltip(fold, folded ? t('ui.writingStudio.unfoldChapter') : t('ui.writingStudio.foldChapter'));
        });
    }

    private markContents(): void {
        const chapter = this.book ? chapterAt(this.book, this.current) : null;
        this.contentsEl.querySelectorAll<HTMLElement>('.ert-studio__contents-link').forEach(link => {
            const isChapter = link.dataset.chapterIndex !== undefined;
            const active = isChapter
                ? chapter !== null && Number(link.dataset.chapterIndex) === chapter.index
                : Number(link.dataset.sceneIndex) === this.current;
            link.toggleClass('is-current', active);
            if (active && !isChapter) link.setAttribute('aria-current', 'location');
            else link.removeAttribute('aria-current');
        });
    }

    /** The line under the wheel: the scene being read, or the one under the pointer. */
    private renderCaption(): void {
        this.captionEl.empty();
        const book = this.book;
        if (!book) return;
        const target = this.hovered !== null && this.hovered !== this.current;
        const scene = book.scenes[target ? this.hovered! : this.current]; // SAFE: target implies hovered is non-null
        if (!scene) return;
        this.captionEl.toggleClass('is-target', target);
        this.captionEl.style.setProperty('--ert-studio-chip-color', this.sceneColor(scene)); // SAFE: CSS custom property carrying the scene's timeline color into writing-studio.css
        this.captionEl.createSpan({ cls: 'ert-studio__caption-num', text: scene.prefix ?? String(scene.index + 1) });
        const body = this.captionEl.createSpan({ cls: 'ert-studio__caption-body' });
        body.createSpan({ cls: 'ert-studio__caption-title', text: scene.name });
        const when = [actLabel(scene.act), scene.when ? formatExportWhen(scene.when) : ''].filter(Boolean).join(' · ');
        body.createSpan({ cls: 'ert-studio__caption-quiet', text: when });
        body.createSpan({ cls: 'ert-studio__caption-quiet', text: scene.subplots.join(', ') });
    }

    // ── Manuscript ───────────────────────────────────────────────────────

    private unloadRendered(): void {
        for (const entry of this.rendered.values()) if (entry.component) this.removeChild(entry.component);
        this.rendered.clear();
    }

    /** A fresh owner for a region's listeners, dropping the ones on its old controls. */
    private regionEventsFor(region: 'head' | 'details' | 'text'): Component {
        const old = this.regionEvents.get(region);
        if (old) this.removeChild(old);
        const events = this.addChild(new Component());
        this.regionEvents.set(region, events);
        return events;
    }

    private async renderManuscript(token: number): Promise<void> {
        const book = this.book;
        if (!book) return;
        this.unloadRendered();
        this.textEl.empty();
        const textEvents = this.regionEventsFor('text');
        this.range = scopeRange(book, this.readingScope, this.current);
        this.renderHeader();
        this.renderDetails();
        this.rootEl.dataset.scope = this.readingScope;

        for (let index = this.range.first; index <= this.range.last; index++) {
            const scene = book.scenes[index];
            const chapter = chapterAt(book, index);
            const section = this.textEl.createEl('section', { cls: 'ert-studio__scene' });
            section.id = `ert-studio-scene-${index}`;
            section.dataset.sceneIndex = String(index);
            if (book.acts.length > 1 && (index === 0 || book.scenes[index - 1].act !== scene.act)) {
                section.createDiv({ cls: 'ert-studio__act', text: actLabel(scene.act) });
            }
            if (chapter && chapter.firstScene === index) {
                const heading = section.createEl('h2', { cls: 'ert-studio__chapter' });
                if (!chapterTitleIsNumber(chapter.title)) heading.createSpan({ cls: 'ert-studio__chapter-kicker', text: t('ui.writingStudio.chapterNumber', { n: String(chapter.index + 1) }) });
                heading.createSpan({ cls: 'ert-studio__chapter-title', text: chapter.title });
            } else if (index !== this.range.first) {
                section.createDiv({ cls: 'ert-studio__break', attr: { 'aria-hidden': 'true' } });
            }
            const label = section.createDiv({ cls: 'ert-studio__scene-label' });
            label.setText(scene.prefix ? `${scene.prefix} · ${scene.name}` : scene.name);
            const prose = section.createDiv({ cls: 'ert-studio__prose markdown-rendered' });
            this.rendered.set(index, { section, prose, component: null, words: null });
        }
        if (this.range.last < book.scenes.length - 1 || this.range.first > 0) {
            this.renderScopeEnd(textEvents);
        }

        // The scene being read first, so the author can start at once; then the rest in order.
        const order = [this.current, ...[...this.rendered.keys()].filter(index => index !== this.current)];
        let scrolled = false;
        for (const index of order) {
            if (token !== this.loadToken) return;
            const entry = this.rendered.get(index);
            if (!entry) continue;
            if (scrolled && index < this.current) {
                await this.keepingPlace(() => this.renderProse(book.scenes[index], entry));
            } else {
                await this.renderProse(book.scenes[index], entry);
            }
            if (!scrolled) {
                this.scrollToScene(this.current);
                scrolled = true;
            }
        }
        this.renderDetails();
    }

    /** At the end of a narrowed scope: a way back to the whole book. */
    private renderScopeEnd(events: Component): void {
        const end = this.textEl.createDiv({ cls: 'ert-studio__scope-end' });
        const button = end.createEl('button', { cls: 'mod-cta ert-studio__whole-book', text: t('ui.writingStudio.readWholeBook'), attr: { type: 'button' } });
        events.registerDomEvent(button, 'click', () => this.setScope('book'));
    }

    private async renderProse(scene: StudioScene, entry: RenderedScene): Promise<void> {
        const file = this.app.vault.getAbstractFileByPath(scene.path);
        if (entry.component) this.removeChild(entry.component);
        entry.component = null;
        entry.prose.empty();
        if (!(file instanceof TFile)) {
            entry.prose.createDiv({ cls: 'ert-studio__prose-missing', text: t('ui.writingStudio.readFailed', { name: scene.title }) });
            return;
        }
        let raw: string;
        try {
            raw = await this.app.vault.cachedRead(file);
        } catch {
            entry.prose.createDiv({ cls: 'ert-studio__prose-missing', text: t('ui.writingStudio.readFailed', { name: scene.title }) });
            return;
        }
        const info = getFrontMatterInfo(raw);
        const body = stripEditorialistReviewBlocks(info.exists ? raw.slice(info.contentStart) : raw).trim();
        entry.words = countWords(extractCountableBodyText(raw));
        if (body.length === 0) {
            entry.prose.createDiv({ cls: 'ert-studio__prose-empty', text: t('ui.writingStudio.emptyScene') });
            return;
        }
        const component = this.addChild(new Component());
        entry.component = component;
        await MarkdownRenderer.render(this.app, body, entry.prose, scene.path, component);
    }

    /** Run a change above or in the reading position without moving the text under the author's eyes. */
    private async keepingPlace(change: () => Promise<void>): Promise<void> {
        const anchor = this.rendered.get(this.current)?.section;
        const before = anchor ? anchor.getBoundingClientRect().top : null;
        await change();
        if (anchor && before !== null && anchor.isConnected) {
            this.mainEl.scrollTop += anchor.getBoundingClientRect().top - before;
        }
    }

    private followLink(event: MouseEvent): void {
        const link = (event.target as Element).closest<HTMLAnchorElement>('a.internal-link');
        if (!link) return;
        event.preventDefault();
        const section = link.closest<HTMLElement>('[data-scene-index]');
        const scene = section && this.book ? this.book.scenes[Number(section.dataset.sceneIndex)] : undefined;
        const target = link.getAttribute('data-href') ?? link.getAttribute('href');
        if (!target) return;
        void this.app.workspace.openLinkText(target, scene?.path ?? '', Keymap.isModEvent(event));
    }

    // ── Header and details ───────────────────────────────────────────────

    private renderHeader(): void {
        const book = this.book;
        this.headEl.empty();
        const events = this.regionEventsFor('head');
        if (!book) return;
        const scene = book.scenes[this.current];
        const chapter = chapterAt(book, this.current);

        const top = this.headEl.createDiv({ cls: 'ert-studio__head-row' });
        top.createDiv({ cls: 'ert-studio__crumb', text: this.bookTitle });
        const controls = top.createDiv({ cls: 'ert-studio__controls' });

        const unit = setAccessibleLabel(controls.createDiv({ cls: 'ert-studio__segmented', attr: { role: 'group' } }), t('ui.writingStudio.stepBy'));
        const unitButton = (value: StudioUnit, label: string, disabled: boolean): void => {
            const button = unit.createEl('button', { text: label, attr: { type: 'button', 'aria-pressed': String(this.unit === value) } });
            button.toggleClass('is-active', this.unit === value);
            button.disabled = disabled;
            events.registerDomEvent(button, 'click', () => { this.unit = value; this.renderHeader(); this.app.workspace.requestSaveLayout(); });
        };
        unitButton('scene', t('ui.writingStudio.unitScene'), false);
        unitButton('chapter', t('ui.writingStudio.unitChapter'), book.chapters.length === 0);

        const pager = controls.createDiv({ cls: 'ert-studio__pager' });
        this.pagerButton(pager, -1, events);
        this.pagerButton(pager, 1, events);

        const scope = setAccessibleLabel(controls.createEl('select', { cls: 'dropdown ert-studio__scope' }), t('ui.writingStudio.scopeLabel'));
        for (const [value, label] of [['book', t('ui.writingStudio.scopeBook')], ['chapter', t('ui.writingStudio.scopeChapter')], ['scene', t('ui.writingStudio.scopeScene')]] as const) {
            scope.createEl('option', { value, text: label });
        }
        scope.value = this.readingScope;
        events.registerDomEvent(scope, 'change', () => this.setScope(scope.value as StudioScope));

        const starts = actStarts(book);
        if (starts.length > 1) {
            const acts = setAccessibleLabel(controls.createEl('select', { cls: 'dropdown ert-studio__acts' }), t('ui.writingStudio.actJump'));
            acts.createEl('option', { value: '', text: t('ui.writingStudio.actJump') });
            for (const start of starts) acts.createEl('option', { value: String(start.scene), text: actLabel(start.act) });
            events.registerDomEvent(acts, 'change', () => {
                if (acts.value !== '') this.goTo(Number(acts.value));
                acts.value = '';
            });
        }

        const toggle = controls.createEl('button', { cls: 'clickable-icon ert-studio__details-toggle', attr: { type: 'button', 'aria-expanded': String(this.rootEl.dataset.detailsOpen === 'true') } });
        setIcon(toggle, 'panel-right');
        setTooltip(toggle, t('ui.writingStudio.details'));
        events.registerDomEvent(toggle, 'click', () => this.setDetailsOpen(this.rootEl.dataset.detailsOpen !== 'true'));

        const location = this.headEl.createDiv({ cls: 'ert-studio__location' });
        // A chapter titled "Chapter 1" is not labelled "Chapter 1" again above its title.
        const numbered = chapter && !chapterTitleIsNumber(chapter.title);
        location.createSpan({ cls: 'ert-studio__kicker', text: numbered ? t('ui.writingStudio.chapterNumber', { n: String(chapter.index + 1) }) : t('ui.writingStudio.sceneOf', { n: String(this.current + 1), total: String(book.scenes.length) }) });
        if (numbered) location.createSpan({ cls: 'ert-studio__kicker-quiet', text: t('ui.writingStudio.sceneOf', { n: String(this.current + 1), total: String(book.scenes.length) }) });
        this.headEl.createDiv({ cls: 'ert-studio__title', text: chapter ? chapter.title : scene.name });

        this.stripKickerEl.setText(chapter
            ? `${t('ui.writingStudio.chapterNumber', { n: String(chapter.index + 1) })} · ${t('ui.writingStudio.sceneOf', { n: String(this.current + 1), total: String(book.scenes.length) })}`
            : t('ui.writingStudio.sceneOf', { n: String(this.current + 1), total: String(book.scenes.length) }));
        this.stripTitleEl.setText(scene.name);
    }

    private pagerButton(parent: HTMLElement, direction: -1 | 1, events: Component): void {
        const book = this.book;
        if (!book) return;
        const target = stepTarget(book, this.unit, this.current, direction);
        const button = parent.createEl('button', { cls: 'clickable-icon ert-studio__pager-button', attr: { type: 'button' } });
        setIcon(button, direction < 0 ? 'chevron-left' : 'chevron-right');
        if (target === null) {
            button.disabled = true;
            setTooltip(button, direction < 0 ? t('ui.writingStudio.previous') : t('ui.writingStudio.next'));
            return;
        }
        const targetChapter = chapterAt(book, target);
        const name = this.unit === 'chapter' && targetChapter && targetChapter.firstScene === target ? targetChapter.title : book.scenes[target].name;
        const key = this.unit === 'chapter'
            ? (direction < 0 ? 'ui.writingStudio.previousChapter' : 'ui.writingStudio.nextChapter')
            : (direction < 0 ? 'ui.writingStudio.previousScene' : 'ui.writingStudio.nextScene');
        setTooltip(button, t(key, { name }));
        events.registerDomEvent(button, 'click', () => this.goTo(target));
    }

    private renderDetails(): void {
        const book = this.book;
        this.detailsEl.empty();
        const events = this.regionEventsFor('details');
        if (!book) return;
        const scene = book.scenes[this.current];
        if (!scene) return;
        const chapter = chapterAt(book, this.current);
        const card = this.detailsEl.createDiv({ cls: 'ert-studio__card' });
        card.createDiv({ cls: 'ert-studio__card-kicker', text: t('ui.writingStudio.sceneOf', { n: String(this.current + 1), total: String(book.scenes.length) }) });
        card.createDiv({ cls: 'ert-studio__card-title', text: scene.name });

        const facts = card.createEl('dl', { cls: 'ert-studio__facts' });
        const fact = (label: string, value: string | null): void => {
            if (!value) return;
            facts.createEl('dt', { text: label });
            facts.createEl('dd', { text: value });
        };
        fact(t('ui.writingStudio.detailsChapter'), chapter ? (chapterTitleIsNumber(chapter.title) ? chapter.title : `${chapter.index + 1} · ${chapter.title}`) : null);
        fact(t('ui.writingStudio.detailsAct'), toRomanNumeral(scene.act));
        fact(t('ui.writingStudio.detailsWhen'), scene.when ? formatExportWhen(scene.when) : null);
        fact(t('ui.writingStudio.detailsSubplots'), scene.subplots.join(', '));
        fact(t('ui.writingStudio.detailsStatus'), scene.status);
        fact(t('ui.writingStudio.detailsStage'), scene.stage);
        const words = this.rendered.get(this.current)?.words;
        fact(t('ui.writingStudio.detailsWords'), words !== null && words !== undefined ? words.toLocaleString() : null);

        if (scene.synopsis) {
            card.createDiv({ cls: 'ert-studio__card-label', text: t('ui.writingStudio.detailsSynopsis') });
            card.createEl('p', { cls: 'ert-studio__synopsis', text: scene.synopsis });
        }

        const open = card.createEl('button', { cls: 'mod-cta ert-studio__open', attr: { type: 'button' } });
        const icon = open.createSpan({ cls: 'ert-studio__open-icon' });
        setIcon(icon, 'file-pen-line');
        open.createSpan({ text: t('ui.writingStudio.openSource') });
        events.registerDomEvent(open, 'click', (event: MouseEvent) => { void this.openSource(scene, Keymap.isModEvent(event) !== false); });
    }

    /**
     * Open the scene's note for editing. A note already open is revealed. The
     * first note opens in a split beside the studio, which then follows the
     * scene being read (followSource), so the studio stays in view; Cmd/Ctrl-
     * click opens a new tab instead, which does not follow.
     */
    private async openSource(scene: StudioScene, newTab: boolean): Promise<void> {
        const file = this.app.vault.getAbstractFileByPath(scene.path);
        if (!(file instanceof TFile)) return;
        const open = this.app.workspace.getLeavesOfType('markdown').find(leaf => leaf.view instanceof MarkdownView && leaf.view.file?.path === file.path);
        if (open) {
            this.app.workspace.setActiveLeaf(open, { focus: true });
            return;
        }
        let leaf: WorkspaceLeaf;
        if (newTab) leaf = this.app.workspace.getLeaf('tab');
        else if (this.sourceLeaf && this.app.workspace.getLeavesOfType('markdown').includes(this.sourceLeaf)) leaf = this.sourceLeaf;
        else leaf = this.app.workspace.createLeafBySplit(this.leaf, 'vertical');
        if (!newTab) this.sourceLeaf = leaf;
        await leaf.openFile(file, { active: true }); // SAFE: openFile used to keep source notes in one split beside the studio; an already-open note is revealed above
    }

    // ── Moving through the book ──────────────────────────────────────────

    private setScope(scope: StudioScope): void {
        if (scope === this.readingScope) return;
        this.readingScope = scope;
        this.app.workspace.requestSaveLayout();
        void this.renderManuscript(this.loadToken);
    }

    /** Make a scene the one being read and bring its prose into view. */
    private goTo(index: number): void {
        const book = this.book;
        if (!book || index < 0 || index >= book.scenes.length) return;
        const inRange = index >= this.range.first && index <= this.range.last;
        this.setCurrent(index);
        if (inRange) {
            this.scrollToScene(index);
            return;
        }
        // Outside a narrowed scope: the scope moves with the reader.
        void this.renderManuscript(this.loadToken);
    }

    private scrollToScene(index: number): void {
        const section = this.rendered.get(index)?.section;
        if (!section) return;
        this.pinned = index;
        const top = section.offsetTop - this.headEl.offsetHeight;
        this.mainEl.scrollTop = index === this.range.first ? 0 : Math.max(0, top);
    }

    /** The scene being read, in its own wedge color, for the contents highlight. */
    private paintSceneColor(): void {
        const scene = this.book?.scenes[this.current];
        if (scene) this.rootEl.style.setProperty('--ert-studio-scene-color', this.sceneColor(scene)); // SAFE: CSS custom property carrying the scene's timeline color into writing-studio.css
    }

    private setCurrent(index: number): void {
        if (!this.book) return;
        const changed = index !== this.current;
        this.current = index;
        this.wheel?.setCurrent(index);
        this.paintSceneColor();
        this.markContents();
        this.renderCaption();
        this.renderHeader();
        this.renderDetails();
        if (changed) {
            this.app.workspace.requestSaveLayout();
            this.scheduleFollow();
        }
    }

    /** Bring the source split to the scene being read once the reading settles. */
    private scheduleFollow(): void {
        if (!this.sourceLeaf) return;
        if (this.followTimer !== null) window.clearTimeout(this.followTimer);
        this.followTimer = window.setTimeout(() => {
            this.followTimer = null;
            void this.followSource().catch((error: unknown) => console.error('[Writing Studio] Could not open the scene beside the studio', error));
        }, FOLLOW_DELAY_MS);
    }

    /**
     * Show the scene being read in the source split, without taking focus.
     * Never while the author's cursor is in the split: it waits until they
     * come back to the studio. Following ends when the split is closed or
     * shows a note outside this book.
     */
    private async followSource(): Promise<void> {
        const leaf = this.sourceLeaf;
        const book = this.book;
        if (!leaf || !book) return;
        const view = leaf.view;
        const shown = view instanceof MarkdownView ? view.file?.path : undefined;
        if (!this.app.workspace.getLeavesOfType('markdown').includes(leaf) || !shown || !book.scenes.some(scene => scene.path === shown)) {
            this.sourceLeaf = null;
            return;
        }
        if (view.containerEl.contains(view.containerEl.ownerDocument.activeElement)) return;
        const scene = book.scenes[this.current];
        if (!scene || scene.path === shown) return;
        const file = this.app.vault.getAbstractFileByPath(scene.path);
        if (file instanceof TFile) await leaf.openFile(file, { active: false });
    }

    private scheduleSpy(): void {
        if (this.scrollFrame) return;
        this.scrollFrame = window.requestAnimationFrame(() => {
            this.scrollFrame = 0;
            if (this.pinned !== null) return;
            const index = this.sceneAtReadingLine();
            if (index !== null && index !== this.current) this.setCurrent(index);
        });
    }

    /** The last scene whose start has passed the reading line. */
    private sceneAtReadingLine(): number | null {
        const box = this.mainEl.getBoundingClientRect();
        const line = box.top + this.headEl.offsetHeight + (box.height - this.headEl.offsetHeight) * READING_LINE;
        let found: number | null = null;
        for (const [index, entry] of this.rendered) {
            if (entry.section.getBoundingClientRect().top <= line) found = index;
            else break;
        }
        return found ?? (this.rendered.size > 0 ? this.range.first : null);
    }
}
