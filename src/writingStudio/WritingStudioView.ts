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
import { isPathInFolderScope } from '../utils/pathScope';
import { stripEditorialistReviewBlocks } from '../utils/manuscriptSanitize';
import { extractCountableBodyText, formatExportWhen } from '../utils/manuscript';
import { countWords } from '../utils/text';
import { toRomanNumeral } from '../utils/romanNumerals';
import { setAccessibleLabel, setTooltip } from '../utils/domTooltip';
import { assignSubplotColors, bookOwnSubplotColors, subplotColorCss, subplotColorOn } from '../renderer/utils/subplotColors';
import { WRITING_STUDIO_VIEW_TYPE } from './constants';
import { actStarts, buildStudioBook, chapterAt, scopeRange, stepTarget, type StudioBook, type StudioScene, type StudioScope, type StudioUnit } from './studioModel';
import { buildStudioWheel, wheelSubplotOrder, type StudioWheelHandle } from './studioWheel';

interface StudioState {
    scenePath?: string;
    scope?: StudioScope;
    unit?: StudioUnit;
}

/** How far down the reading column a scene must reach to be the one being read. */
const READING_LINE = 0.3;
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

    /** Set by a jump: the scene stays current until the author scrolls themselves. */
    private pinned: number | null = null;
    private scrollFrame = 0;
    private modelTimer: number | null = null;
    private proseTimers = new Map<string, number>();
    private sourceLeaf: WorkspaceLeaf | null = null;

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
        if (this.scrollFrame) cancelAnimationFrame(this.scrollFrame);
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
        strip.addEventListener('click', () => this.setNavOpen(this.rootEl.dataset.navOpen !== 'true'));

        const panel = this.navEl.createDiv({ cls: 'ert-studio__nav-panel' });
        this.wheelHostEl = panel.createDiv({ cls: 'ert-studio__wheel' });
        this.wheelHostEl.addEventListener('pointerover', event => {
            const index = Number((event.target as Element).closest('[data-scene-index]')?.getAttribute('data-scene-index'));
            this.hovered = Number.isInteger(index) ? index : null;
            this.renderCaption();
        });
        this.wheelHostEl.addEventListener('pointerleave', () => { this.hovered = null; this.renderCaption(); });
        this.captionEl = panel.createDiv({ cls: 'ert-studio__caption' });
        this.contentsEl = panel.createDiv({ cls: 'ert-studio__contents' });

        this.mainEl = this.rootEl.createDiv({ cls: 'ert-studio__main' });
        this.headEl = this.mainEl.createEl('header', { cls: 'ert-studio__head' });
        this.textEl = this.mainEl.createEl('article', { cls: 'ert-studio__text' });
        this.textEl.addEventListener('click', event => this.followLink(event));

        this.detailsEl = setAccessibleLabel(this.rootEl.createEl('aside', { cls: 'ert-studio__details' }), t('ui.writingStudio.details'));

        this.mainEl.addEventListener('scroll', () => this.scheduleSpy(), { passive: true });
        // Any reading gesture of the author's own releases a jump's pin.
        for (const type of ['wheel', 'touchmove', 'pointerdown', 'keydown'] as const) {
            this.mainEl.addEventListener(type, () => { this.pinned = null; }, { passive: true });
        }
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
        const book = buildStudioBook(items);
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
        const book = buildStudioBook(items);
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

        this.wheelHostEl.empty();
        this.wheel = buildStudioWheel(this.contentEl.ownerDocument, book, colorFor, index => {
            this.setNavOpen(false);
            this.goTo(index);
        });
        this.wheel.svg.setAttribute('role', 'img');
        setAccessibleLabel(this.wheel.svg, t('ui.writingStudio.wheelLabel', { book: this.bookTitle }));
        this.wheelHostEl.appendChild(this.wheel.svg);
        this.wheel.setCurrent(this.current);

        this.contentsEl.empty();
        this.contentsEl.createEl('h2', { cls: 'ert-studio__contents-heading', text: t('ui.writingStudio.contents') });
        const multiAct = book.acts.length > 1;
        for (const act of book.acts) {
            const section = this.contentsEl.createEl('section');
            if (multiAct) section.createEl('h3', { cls: 'ert-studio__contents-act', text: actLabel(act) });
            const list = section.createEl('ol', { cls: 'ert-studio__contents-list' });
            let openChapter: number | null = null;
            let chapterList: HTMLElement = list;
            for (const scene of book.scenes.filter(item => item.act === act)) {
                if (scene.chapter !== openChapter) {
                    openChapter = scene.chapter;
                    if (scene.chapter === null) {
                        chapterList = list;
                    } else {
                        const chapter = book.chapters[scene.chapter];
                        const item = list.createEl('li', { cls: 'ert-studio__contents-chapter' });
                        const link = item.createEl('button', { cls: 'ert-studio__contents-link ert-studio__contents-link--chapter', attr: { type: 'button' } });
                        link.dataset.sceneIndex = String(chapter.firstScene);
                        link.dataset.chapterIndex = String(chapter.index);
                        link.createSpan({ cls: 'ert-studio__contents-num', text: String(chapter.index + 1) });
                        link.createSpan({ text: chapter.title });
                        chapterList = item.createEl('ol', { cls: 'ert-studio__contents-list ert-studio__contents-list--scenes' });
                    }
                }
                const item = chapterList.createEl('li');
                const link = item.createEl('button', { cls: 'ert-studio__contents-link', attr: { type: 'button' } });
                link.dataset.sceneIndex = String(scene.index);
                link.createSpan({ cls: 'ert-studio__contents-num', text: scene.prefix ?? String(scene.index + 1) });
                link.createSpan({ text: scene.name });
            }
        }
        this.contentsEl.onclick = event => {
            const link = (event.target as Element).closest<HTMLElement>('[data-scene-index]');
            if (!link) return;
            this.setNavOpen(false);
            this.goTo(Number(link.dataset.sceneIndex));
        };
        this.markContents();
        this.renderCaption();
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

    private async renderManuscript(token: number): Promise<void> {
        const book = this.book;
        if (!book) return;
        this.unloadRendered();
        this.textEl.empty();
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
                heading.createSpan({ cls: 'ert-studio__chapter-kicker', text: t('ui.writingStudio.chapterNumber', { n: String(chapter.index + 1) }) });
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
            this.renderScopeEnd();
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
    private renderScopeEnd(): void {
        const end = this.textEl.createDiv({ cls: 'ert-studio__scope-end' });
        const button = end.createEl('button', { cls: 'mod-cta ert-studio__whole-book', text: t('ui.writingStudio.readWholeBook'), attr: { type: 'button' } });
        button.addEventListener('click', () => this.setScope('book'));
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
            button.addEventListener('click', () => { this.unit = value; this.renderHeader(); this.app.workspace.requestSaveLayout(); });
        };
        unitButton('scene', t('ui.writingStudio.unitScene'), false);
        unitButton('chapter', t('ui.writingStudio.unitChapter'), book.chapters.length === 0);

        const pager = controls.createDiv({ cls: 'ert-studio__pager' });
        this.pagerButton(pager, -1);
        this.pagerButton(pager, 1);

        const scope = setAccessibleLabel(controls.createEl('select', { cls: 'dropdown ert-studio__scope' }), t('ui.writingStudio.scopeLabel'));
        for (const [value, label] of [['book', t('ui.writingStudio.scopeBook')], ['chapter', t('ui.writingStudio.scopeChapter')], ['scene', t('ui.writingStudio.scopeScene')]] as const) {
            scope.createEl('option', { value, text: label });
        }
        scope.value = this.readingScope;
        scope.addEventListener('change', () => this.setScope(scope.value as StudioScope));

        const starts = actStarts(book);
        if (starts.length > 1) {
            const acts = setAccessibleLabel(controls.createEl('select', { cls: 'dropdown ert-studio__acts' }), t('ui.writingStudio.actJump'));
            acts.createEl('option', { value: '', text: t('ui.writingStudio.actJump') });
            for (const start of starts) acts.createEl('option', { value: String(start.scene), text: actLabel(start.act) });
            acts.addEventListener('change', () => {
                if (acts.value !== '') this.goTo(Number(acts.value));
                acts.value = '';
            });
        }

        const toggle = controls.createEl('button', { cls: 'clickable-icon ert-studio__details-toggle', attr: { type: 'button', 'aria-expanded': String(this.rootEl.dataset.detailsOpen === 'true') } });
        setIcon(toggle, 'panel-right');
        setTooltip(toggle, t('ui.writingStudio.details'));
        toggle.addEventListener('click', () => this.setDetailsOpen(this.rootEl.dataset.detailsOpen !== 'true'));

        const location = this.headEl.createDiv({ cls: 'ert-studio__location' });
        location.createSpan({ cls: 'ert-studio__kicker', text: chapter ? t('ui.writingStudio.chapterNumber', { n: String(chapter.index + 1) }) : t('ui.writingStudio.sceneOf', { n: String(this.current + 1), total: String(book.scenes.length) }) });
        if (chapter) location.createSpan({ cls: 'ert-studio__kicker-quiet', text: t('ui.writingStudio.sceneOf', { n: String(this.current + 1), total: String(book.scenes.length) }) });
        this.headEl.createDiv({ cls: 'ert-studio__title', text: chapter ? chapter.title : scene.name });

        this.stripKickerEl.setText(chapter
            ? `${t('ui.writingStudio.chapterNumber', { n: String(chapter.index + 1) })} · ${t('ui.writingStudio.sceneOf', { n: String(this.current + 1), total: String(book.scenes.length) })}`
            : t('ui.writingStudio.sceneOf', { n: String(this.current + 1), total: String(book.scenes.length) }));
        this.stripTitleEl.setText(scene.name);
    }

    private pagerButton(parent: HTMLElement, direction: -1 | 1): void {
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
        button.addEventListener('click', () => this.goTo(target));
    }

    private renderDetails(): void {
        const book = this.book;
        this.detailsEl.empty();
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
        fact(t('ui.writingStudio.detailsChapter'), chapter ? `${chapter.index + 1} · ${chapter.title}` : null);
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
        open.addEventListener('click', event => { void this.openSource(scene, Keymap.isModEvent(event) !== false); });
    }

    /**
     * Open the scene's note for editing. A note already open is revealed. The
     * first note opens in a split beside the studio and later ones reuse it,
     * so the studio stays in view; Cmd/Ctrl-click opens a new tab instead.
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

    private setCurrent(index: number): void {
        if (!this.book) return;
        const changed = index !== this.current;
        this.current = index;
        this.wheel?.setCurrent(index);
        this.markContents();
        this.renderCaption();
        this.renderHeader();
        this.renderDetails();
        if (changed) this.app.workspace.requestSaveLayout();
    }

    private scheduleSpy(): void {
        if (this.scrollFrame) return;
        this.scrollFrame = requestAnimationFrame(() => {
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
