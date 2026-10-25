import { setAccessibleLabel, setTooltip } from '../utils/domTooltip';
/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 */
// --- Imports and constants added for standalone module ---
import { executeCommandById, openSettingsTab } from '../utils/obsidianInternals';
import { ItemView, WorkspaceLeaf, MarkdownView, TFile, Notice, setIcon, Menu, Component, getFrontMatterInfo } from 'obsidian';
import { TimelineScaffoldModal } from '../modals/TimelineScaffoldModal';
import { TimelineAuditModal } from '../modals/TimelineAuditModal';
import RadialTimelinePlugin from '../main';
import { t, tCount } from '../i18n';
import type { SubplotAlignment, TimelineItem } from '../types';
import { renderSvgFromString } from '../utils/svgDom';
import { openOrRevealFileByPath } from '../utils/fileUtils';
import { setupRotationController, setupSearchControls as setupSearchControlsExt, setupModeToggleController, setupVersionIndicatorController, setupHelpIconController, setupTooltips, setupSubplotKeyController, setupBeatNameKeyController, setupTitleBarFit } from './interactions';
import { RendererService } from '../services/RendererService';
import { ModeManager, createModeManager } from '../modes/ModeManager';
import { getModeDefinition, getToggleableModes } from '../modes/ModeRegistry';
import { modeHasAllScenesOuterRing } from '../renderer/modules/ModeRenderingHelpers';
import { TimelineMode } from '../modes/ModeDefinition';
import { BugReportModal } from '../modals/BugReportModal';
import { ModeInteractionController, createInteractionController } from '../modes/ModeInteractionController';
import { renderWelcomeScreen } from './WelcomeScreen';
import {
    MONTH_LABEL_RADIUS,
    SESSION_TIMER_RING_GAP,
    SESSION_TIMER_RING_PROGRESS_RADIUS_OFFSET_ANCHOR,
    SESSION_TIMER_RING_PROGRESS_WIDTH_ANCHOR,
    SESSION_TIMER_RING_WIDTH,
    SVG_SIZE
} from '../renderer/layout/LayoutConstants';
import { buildSessionTimerRingState, renderSessionTimerRingLayer, buildTabTimerDiscSvg } from '../renderer/components/SessionTimerRing';
import { renderSessionLogList } from '../renderer/components/SessionLogList';
import {
    createSnapshot,
    detectChanges,
    type TimelineSnapshot,
    ChangeType
} from '../renderer/ChangeDetection';
import { WritingSessionCompletionModal } from '../modals/WritingSessionCompletionModal';
import { canPostSessionsToFeed, postSessionToCommunityFeed } from '../communityShare/communityShareClient';
import { openMailboxMenu, paintMailboxButton } from '../communityShare/communityMailbox';
import { DESK_LAMP_PANEL_NOTE, openDeskLampsMenu, openSessionDeskLampMenu, paintDeskLampButton } from '../communityShare/deskLamps';
import { projectSessionFeedPost } from '../services/WritingSessionLog';
import { isRenderedOnTimeline } from '../utils/sceneHelpers';
import { SearchPanelController } from './interactions/SearchPanelController';
import { getLocalLlmAvailability } from '../ai/localLlm/availability';
import { searchOptionsSignature, writeTimelineSearchSettings, type TimelineSearchOptions } from '../services/searchState';
import { DEFAULT_BOOK_TITLE, getTimelineScope, getTimelineScopeTitle, isSagaScopeAvailable } from '../utils/books';
import { getActiveRecentStructuralMoves } from '../utils/recentStructuralMoves';
import type {
    ActiveWritingSession,
    StructuralMoveHistoryEntry,
    WritingSessionMode,
    WritingSessionStage,
    WritingSessionStagePreference,
    WritingSessionTargetMode
} from '../types/settings';
import type { GossamerRunRecord } from '../utils/gossamer';
import { GOSSAMER_SIGNAL_METADATA, GOSSAMER_SIGNAL_TYPES, type GossamerSignalType } from '../types/gossamerSignals';
import { formatGossamerCacheClock, formatGossamerCacheCostHint, getGossamerCacheContext, resolveGossamerCacheWindow } from '../gossamer/cacheWindow';
import { tooltip as applyTooltip } from '../utils/tooltip';
import { currentTimelineColoring, currentTimelineLens, hasOpenTimetable, onTimelineOverlayChange, onTimetablePresenceChange, publishTimelineMode } from '../timetable/timetableRegistry';
import { applyQueryMarks, applyTimetableOverlayToSvg, linkActLabelsToTimetable } from './interactions/TimetableLink';
import { renderLegendSurface, wireLegendTrigger, type LegendDetailSegment, type LegendSection } from './interactions/LegendPanel';
import { listAuthorQueries } from '../utils/authorQueryComments';
import { referenceMarkColor } from '../chronologue/timeReferences/render';

// Duplicate of constants defined in main for now. We can consolidate later.
export const TIMELINE_VIEW_TYPE = "radial-timeline";
const TIMELINE_REFRESH_DELAY_MS = 1000;
const SAGA_SCOPE_OPTION = '__rt_saga__';
const SESSION_PROGRESS_STEP_PERCENT = 5;
const SESSION_SECONDS_DISPLAY_THRESHOLD_MS = 15 * 60 * 1000;

type SessionClockUnit = 'min' | 'sec';

interface SessionClockDisplay {
    value: string;
    unit: SessionClockUnit;
    label: string;
}

interface SessionStatusDisplay {
    headline: string;
    detail: string;
    tone: 'running' | 'paused' | 'complete';
}

// Namespace rule for Timeline view work:
// - New Timeline chrome (legends, panels, badges, overlays, tooltips, controls) uses ert-timeline-*.
// - Existing SVG/rendering primitives may still reference legacy rt-* islands.
// - Do not introduce fresh rt-* class creation for new chrome here unless it is explicitly allowlisted.

const TIMELINE_LEGEND_MODES = new Set(['progress', 'narrative', 'chronologue']);

// SceneNumberInfo now imported from constants

// Timeline View implementation
export class RadialTimelineView extends ItemView {
    static readonly viewType = TIMELINE_VIEW_TYPE;
    plugin: RadialTimelinePlugin;
    private rendererService?: RendererService;
    
    // Frontmatter values to track to reduce unnecessary SVG View refreshes
    private lastFrontmatterValues: Record<string, unknown> = {};
    private timelineRefreshTimeout: number | null = null;
    private beatLabelAdjustTimeout: number | null = null;
    private beatLabelAdjustRaf: number | null = null;

    // Registrations that belong to the current SVG, not to the view. Every
    // render replaces the SVG, so every listener, cleanup, and timer bound to
    // it must die with it; registering them on the view itself kept each
    // generation alive until the view closed. A child Component per render
    // is unloaded at the top of the next render (and with the view).
    private renderScopeComponent: Component | null = null;

    /** The Component that owns registrations for the SVG currently on screen. */
    public get renderScope(): Component {
        if (!this.renderScopeComponent) {
            this.renderScopeComponent = this.addChild(new Component());
        }
        return this.renderScopeComponent;
    }

    private resetRenderScope(): void {
        if (this.renderScopeComponent) {
            this.removeChild(this.renderScopeComponent);
            this.renderScopeComponent = null;
        }
    }

    // The writing-session panel is emptied and rebuilt on every state change
    // (start, pause, idle, save). Its controls' listeners live exactly as long
    // as that build, not as long as the view.
    private sessionPanelScopeComponent: Component | null = null;

    private get sessionPanelScope(): Component {
        if (!this.sessionPanelScopeComponent) {
            this.sessionPanelScopeComponent = this.addChild(new Component());
        }
        return this.sessionPanelScopeComponent;
    }

    private resetSessionPanelScope(): void {
        if (this.sessionPanelScopeComponent) {
            this.removeChild(this.sessionPanelScopeComponent);
            this.sessionPanelScopeComponent = null;
        }
    }
    
    // Change detection snapshot for optimizing renders
    private lastSnapshot: TimelineSnapshot | null = null;
        
    // Scene data (scenes)
    sceneData: TimelineItem[] = [];
    
    // Set of open scene paths (for tracking open files)
    openScenePaths: Set<string> = new Set<string>();

    // Book switcher UI
    private bookSwitcherEl?: HTMLElement;
    private bookSwitcherSelect?: HTMLSelectElement;
    private modeNavButtons?: Map<string, HTMLButtonElement>;
    private chronologueSubNavEl?: HTMLElement;
    private chronologueSubNavBtns?: { shift: HTMLButtonElement; alt: HTMLButtonElement };
    private narrativeSubNavEl?: HTMLElement;
    private narrativeRuntimeBtn?: HTMLButtonElement;
    private alignmentToggleEl?: HTMLElement;
    private alignmentToggleBtn?: HTMLButtonElement;
    // Populated by ChronologueShiftController each render (the single source of
    // truth for the sub-mode toggles); cleared on its teardown. The header
    // sub-nav routes clicks through these so keyboard/click stay unified.
    public chronologueSubNav?: {
        hasAlt: boolean;
        toggleShift: () => void;
        toggleAlt: () => void;
    };
    // Populated by NarrativeRuntimeController each Narrative render (the single
    // owner of the runtime view toggle); the header chip routes through it.
    public narrativeSubNav?: {
        toggleRuntime: () => void;
    };
    private timelineSearchInput?: HTMLInputElement;
    private timelineSearchButton?: HTMLButtonElement;
    private timelineSearchButtonMode: 'search' | 'clear' = 'search';
    private searchPanel?: SearchPanelController;
    private timelineLegendTrigger?: HTMLButtonElement;
    private timelineLegendPanel?: HTMLElement;
    private writingSessionButton?: HTMLButtonElement;
    private writingSessionLabel?: HTMLElement;
    private writingSessionPanel?: HTMLElement;
    private writingSessionTickInterval?: number;
    private gossamerCachePillEl?: HTMLElement;
    private gossamerCacheTickInterval?: number;
    private tabTimerIconActive = false;
    private writingSessionPulseTimeout?: number;
    private writingSessionLastTitlePulseKey?: string;
    private writingSessionLastPulseColor?: string;
    private writingSessionRingRenderKey?: string;
    private writingSessionRingPulseTimeout?: number;
    
    // Store rotation state to persist across timeline refreshes
    private rotationState: boolean = false;

    // Chronologue shift-mode hooks installed per-render by ChronologueShiftController
    public handleShiftModeClick?: (e: MouseEvent, sceneGroup: Element) => boolean;
    public _chronologueShiftCleanup?: () => void;

    // Subplot ring key overlay installed per-render by SubplotKeyController;
    // the title-bar trigger button is persistent (created in ensureBookSwitcher)
    public _subplotKeyCleanup?: () => void;
    public subplotKeyPinned: boolean = false;
    public subplotKeyTriggerEl?: HTMLButtonElement;
    
    // Mode system
    private _currentMode: string = 'narrative'; // TimelineMode enum value
    private readonly modeManager: ModeManager; // Centralized mode management
    private readonly interactionController: ModeInteractionController; // Interaction handler management
    
    // Store event handler references for clean removal
    private normalEventHandlers: Map<string, EventListener> = new Map();
    private gossamerEventHandlers: Map<string, EventListener> = new Map();

    // Expose a safe registrar for Gossamer handlers so external modules can record svg-level listeners
    public registerGossamerHandler(key: string, handler: EventListener): void {
        this.gossamerEventHandlers.set(key, handler);
    }

    /**
     * Get the current timeline mode
     */
    public get currentMode(): string {
        return this._currentMode;
    }

    /**
     * Set the current timeline mode
     */
    public set currentMode(mode: string) {
        this._currentMode = mode;
        this.updateTimelineLegend();
        this.syncModeNav();
        this.publishModeToTimetables();
    }

    /** Open Timetables follow the timeline's mode, Chronologue's micro-modes and Narrative's runtime view. */
    private publishModeToTimetables(): void {
        publishTimelineMode({
            mode: this._currentMode,
            shift: this.chronologueState.shift,
            alt: this.chronologueState.alien,
            runtime: this.narrativeState.runtime,
        });
    }

    private overlaysEl: HTMLElement | null = null;

    /**
     * What open Timetables lay over the wheel: a lens lights a table's rows,
     * and a coloring paints scenes by a table column; either way the rest of
     * the wheel recedes. Each shows a pill with a button that turns it off at
     * its source. A full render passes its new wheel and container, which are
     * not in the view yet when this runs.
     */
    private applyTimetableOverlays(
        svg: Element | null = this.contentEl.querySelector('.radial-timeline-svg'),
        container: HTMLElement | null = this.contentEl.querySelector<HTMLElement>('.radial-timeline-container')
    ): void {
        const lens = currentTimelineLens();
        const coloring = currentTimelineColoring();
        if (svg) {
            applyTimetableOverlayToSvg(svg, lens, coloring);
            // Act labels link to an open Timetable; only then do they look clickable.
            svg.classList.toggle('rt-timetable-linked', hasOpenTimetable());
        }
        if (!lens && !coloring) {
            this.overlaysEl?.remove();
            this.overlaysEl = null;
            return;
        }
        if (!container) return;
        if (!this.overlaysEl || !this.overlaysEl.isConnected) {
            const overlays = container.createDiv({ cls: 'ert-timeline-overlays' });
            this.renderScope.registerDomEvent(overlays, 'click', (evt: MouseEvent) => {
                const close = evt.target instanceof Element ? evt.target.closest<HTMLElement>('[data-overlay]') : null;
                if (close?.dataset.overlay === 'lens') currentTimelineLens()?.turnOff();
                if (close?.dataset.overlay === 'coloring') currentTimelineColoring()?.turnOff();
            });
            this.overlaysEl = overlays;
        }
        const overlays = this.overlaysEl;
        overlays.empty();
        const pill = (kind: 'lens' | 'coloring', icon: string, label: string): HTMLElement => {
            const el = overlays.createDiv({ cls: 'ert-timeline-lens' });
            setIcon(el.createSpan({ cls: 'ert-timeline-lens__icon' }), icon);
            el.createSpan({ cls: 'ert-timeline-lens__label', text: label });
            const body = el.createSpan({ cls: 'ert-timeline-lens__legend' });
            const close = el.createEl('button', { cls: 'ert-timeline-lens__close clickable-icon' });
            close.dataset.overlay = kind;
            setAccessibleLabel(close, kind === 'lens' ? t('ui.timetable.lensClose') : t('ui.timetable.coloringClose'));
            setIcon(close, 'x');
            return body;
        };
        if (lens) pill('lens', 'scan-eye', t('ui.timetable.lensPill', { view: lens.label, count: lens.paths.size }));
        if (coloring) {
            const legend = pill('coloring', 'palette', t('ui.timetable.coloredBy', { property: coloring.property }));
            for (const entry of coloring.legend) {
                const item = legend.createSpan({ cls: 'ert-timeline-lens__item' });
                item.createSpan({ cls: 'ert-timeline-lens__swatch' }).setCssProps({ '--ert-timeline-swatch': `var(--rt-subplot-colors-${entry.colorIndex})` });
                item.createSpan({ text: entry.value });
            }
        }
    }

    /** Each scene note's open author queries, cached by modification time. */
    private readonly queryCache = new Map<string, { mtime: number; questions: string[] }>();
    private queryDotsTimer: number | null = null;

    private scheduleQueryDots(delayMs = 600): void {
        if (this.queryDotsTimer !== null) window.clearTimeout(this.queryDotsTimer);
        this.queryDotsTimer = window.setTimeout(() => {
            this.queryDotsTimer = null;
            void this.refreshQueryDots();
        }, delayMs);
    }

    /** Open author queries (`%%query: …%%`) show as a question bubble in each of the scene's cells. */
    private async refreshQueryDots(): Promise<void> {
        const svg = this.contentEl.querySelector('.radial-timeline-svg');
        if (!svg) return;
        const paths = new Set<string>();
        svg.querySelectorAll('.rt-scene-group[data-path]').forEach(group => {
            const encoded = group.getAttribute('data-path');
            if (encoded) paths.add(decodeURIComponent(encoded));
        });
        const queries = new Map<string, string[]>();
        for (const path of paths) {
            const file = this.app.vault.getFileByPath(path);
            if (!file) continue;
            const cached = this.queryCache.get(path);
            let questions = cached && cached.mtime === file.stat.mtime ? cached.questions : null;
            if (!questions) {
                const content = await this.app.vault.cachedRead(file);
                const info = getFrontMatterInfo(content);
                questions = listAuthorQueries(content.slice(info.exists ? info.contentStart : 0));
                this.queryCache.set(path, { mtime: file.stat.mtime, questions });
            }
            if (questions.length > 0) queries.set(path, questions);
        }
        // A redraw while the notes were read replaces the SVG; that render schedules its own pass.
        if (this.contentEl.querySelector('.radial-timeline-svg') !== svg) return;
        applyQueryMarks(svg, queries);
    }

    /**
     * Get the ModeManager instance
     * Provides centralized mode switching with lifecycle management
     */
    public getModeManager(): ModeManager {
        return this.modeManager;
    }

    /**
     * Get the InteractionController instance
     * Manages event handler registration and cleanup
     */
    public getInteractionController(): ModeInteractionController {
        return this.interactionController;
    }


    readonly chronologueState = { shift: false, alien: false };

    /** Narrative's runtime view: runtime arcs and running totals in the order the book presents its scenes. */
    readonly narrativeState = { runtime: false };

    constructor(leaf: WorkspaceLeaf, plugin: RadialTimelinePlugin) {
        super(leaf);
        this.plugin = plugin;
        this.openScenePaths = plugin.openScenePaths;
        this.rendererService = plugin.getRendererService();
        
        // Initialize mode management
        this._currentMode = plugin.settings.currentMode || 'narrative';
        this.modeManager = createModeManager(plugin, this);
        this.interactionController = createInteractionController(this);
    }

    getViewType(): string {
        return TIMELINE_VIEW_TYPE;
    }
    
    getDisplayText(): string {
        return getTimelineScopeTitle(this.plugin.settings, DEFAULT_BOOK_TITLE);
    }
    
    getIcon(): string {
        return "rt-logo";
    }

    /**
     * Timeline tools in the view's three-dot menu — the in-view entry point
     * for authors who never open the command palette.
     */
    onPaneMenu(menu: Menu, source: string): void {
        super.onPaneMenu(menu, source);
        menu.addItem(item => item
            .setTitle(t('commands.timelineDateScaffold'))
            .setIcon('calendar-plus')
            .setSection('pane')
            .onClick(() => new TimelineScaffoldModal(this.app, this.plugin).open()));
        menu.addItem(item => item
            .setTitle(t('commands.timelineAudit'))
            .setIcon('calendar-search')
            .setSection('pane')
            .onClick(() => new TimelineAuditModal(this.app, this.plugin).open()));
    }

    private ensureBookSwitcher(): void {
        const headerEl = this.containerEl.querySelector<HTMLElement>('.view-header');
        if (!headerEl) return;

        if (!this.bookSwitcherEl) {
            const doc = headerEl.ownerDocument;
            const actionsEl = headerEl.querySelector('.view-actions');
            const wrapper = doc.win.createDiv();
            wrapper.className = 'rt-book-switcher';

            const searchShell = doc.win.createDiv();
            searchShell.className = 'ert-timeline-search';

            const searchBtn = doc.win.createEl('button');
            searchBtn.className = 'ert-timeline-search__button clickable-icon';
            searchBtn.type = 'button';

            const searchInput = doc.win.createEl('input');
            searchInput.className = 'ert-timeline-search__input';
            searchInput.type = 'search';
            searchInput.placeholder = t('timeline.search.placeholder');
            searchInput.autocomplete = 'off';
            searchInput.spellcheck = false;

            this.registerDomEvent(searchBtn, 'mousedown', (evt: MouseEvent) => {
                evt.preventDefault();
            });
            this.registerDomEvent(searchBtn, 'click', (evt: MouseEvent) => {
                evt.preventDefault();
                evt.stopPropagation();
                if (this.timelineSearchButtonMode === 'clear') {
                    this.clearTimelineSearchFromControl();
                    return;
                }
                this.commitTimelineSearchFromInput();
            });
            this.registerDomEvent(searchInput, 'input', () => {
                this.handleTimelineSearchInput();
            });
            this.registerDomEvent(searchInput, 'blur', () => {
                // Blur commits only while assist is off. Once a local-model run
                // is on the line, leaving the field must not silently start one
                // — commit becomes explicit (Enter or the icon).
                if (this.plugin.searchState.options.llmAssist) return;
                this.commitTimelineSearchFromInput();
            });
            this.registerDomEvent(searchInput, 'keydown', (evt: KeyboardEvent) => {
                if (evt.key === 'Enter') {
                    evt.preventDefault();
                    this.commitTimelineSearchFromInput();
                    return;
                }
                // The panel handles the first Escape by collapsing itself; a
                // second one, with the panel already closed, clears the search.
                if (evt.key === 'Escape' && !this.searchPanel?.isExpanded()) {
                    evt.preventDefault();
                    this.clearTimelineSearchFromControl();
                }
            });

            const legendBtn = doc.win.createEl('button');
            legendBtn.className = 'ert-timeline-legend__trigger clickable-icon';
            legendBtn.type = 'button';
            legendBtn.setAttribute('aria-expanded', 'false');
            setIcon(legendBtn, 'asterisk');

            const legendPanel = doc.win.createDiv();
            legendPanel.className = 'ert-timeline-legend ert-timeline-legend--compact';
            legendPanel.setAttribute('role', 'tooltip');

            // Book selector, badged with a book icon so the control reads
            // unambiguously as "which book / Saga" (not a generic dropdown).
            const booksGroup = doc.win.createDiv();
            booksGroup.className = 'rt-book-switcher__books';
            const booksIcon = doc.win.createSpan();
            booksIcon.className = 'rt-book-switcher__icon';
            booksIcon.setAttribute('aria-hidden', 'true');
            setIcon(booksIcon, 'book');

            const select = doc.win.createEl('select');
            select.className = 'rt-book-switcher__select';
            this.registerDomEvent(select, 'change', async () => {
                const nextId = select.value;
                if (nextId === SAGA_SCOPE_OPTION) {
                    await this.plugin.setTimelineScope('saga');
                    if (getTimelineScope(this.plugin.settings) === 'saga') {
                        this.currentMode = 'narrative';
                    }
                    this.updateBookSwitcherOptions();
                    this.updateViewTitle();
                    return;
                }
                await this.plugin.setActiveBookId(nextId);
                this.updateBookSwitcherOptions();
                this.updateViewTitle();
            });

            // Title actions, in cluster order after the book selector. Each is
            // an icon button; on a bar too narrow for the full row, TitleBarFit
            // folds them into one menu built from this same list.
            const titleActions: Array<{ label: string; icon: string; run: () => void }> = [
                { label: t('ui.timetable.viewName'), icon: 'table-2', run: () => { void this.plugin.openTimetable(); } },
                { label: t('ui.timeLineView.radialTimelineCommands'), icon: 'command', run: () => this.openRadialTimelineCommands() },
                { label: t('commands.manuscriptExport'), icon: 'printer', run: () => this.plugin.openManuscriptExportModal() },
                // Same action as the version-indicator fallback; only the
                // trigger is duplicated here.
                { label: t('ui.timeLineView.reportBug'), icon: 'bug', run: () => new BugReportModal(this.app, this.plugin, 'rt').open() },
                {
                    label: t('ui.timeLineView.manageBooks'),
                    icon: 'settings',
                    run: () => {
                        if (this.plugin.settingsTab) {
                            this.plugin.settingsTab.setActiveTab('core');
                        }
                        openSettingsTab(this.app);
                    }
                },
            ];
            const titleActionBtns = titleActions.map(action => {
                const btn = doc.win.createEl('button');
                btn.className = 'ert-timeline-title-action clickable-icon';
                btn.type = 'button';
                setIcon(btn, action.icon);
                setAccessibleLabel(btn, action.label);
                this.registerDomEvent(btn, 'click', (evt: MouseEvent) => {
                    evt.preventDefault();
                    evt.stopPropagation();
                    action.run();
                });
                return btn;
            });

            const actionsMenuBtn = doc.win.createEl('button');
            actionsMenuBtn.className = 'ert-timeline-title-menu clickable-icon';
            actionsMenuBtn.type = 'button';
            setAccessibleLabel(actionsMenuBtn, t('ui.timeLineView.timelineActions'));
            actionsMenuBtn.setAttribute('aria-haspopup', 'menu');
            setIcon(actionsMenuBtn, 'menu');
            setAccessibleLabel(actionsMenuBtn, t('ui.timeLineView.timelineActions'));
            this.registerDomEvent(actionsMenuBtn, 'click', (evt: MouseEvent) => {
                evt.preventDefault();
                evt.stopPropagation();
                const menu = new Menu();
                titleActions.forEach(action => menu.addItem(item => item
                    .setTitle(action.label)
                    .setIcon(action.icon)
                    .onClick(() => action.run())));
                const rect = actionsMenuBtn.getBoundingClientRect();
                menu.showAtPosition({ x: rect.right, y: rect.bottom, width: rect.width, left: true }, doc);
            });

            const sessionBtn = doc.win.createEl('button');
            sessionBtn.className = 'ert-timeline-session clickable-icon';
            sessionBtn.type = 'button';
            setAccessibleLabel(sessionBtn, t('ui.timeLineView.startWritingSession'));
            const sessionLabel = doc.win.createSpan();
            sessionLabel.className = 'ert-timeline-session__label';
            this.renderWritingSessionIdleIcon(sessionLabel);
            sessionBtn.appendChild(sessionLabel);
            this.registerDomEvent(sessionBtn, 'click', (evt: MouseEvent) => {
                evt.preventDefault();
                evt.stopPropagation();
                this.toggleWritingSessionPanel();
            });

            const sessionPanel = doc.win.createDiv();
            sessionPanel.className = 'ert-timeline-session-panel ert-hidden';
            sessionPanel.setAttribute('role', 'dialog');
            doc.body.appendChild(sessionPanel);
            this.register(() => sessionPanel.remove());

            wireLegendTrigger(this, legendBtn, legendPanel, () => this.updateTimelineLegend());

            searchShell.appendChild(searchBtn);
            searchShell.appendChild(searchInput);
            setAccessibleLabel(searchInput, t('timeline.search.inputLabel'));
            booksGroup.appendChild(booksIcon);
            booksGroup.appendChild(select);
            setAccessibleLabel(select, t('ui.timeLineView.bookSelector'));
            // Right cluster order: legend · search · books · ⌘ · printer · bug · gear
            // (or the one actions menu in their place on a narrow bar)
            wrapper.appendChild(legendBtn);
            wrapper.appendChild(legendPanel);
            wrapper.appendChild(searchShell);
            wrapper.appendChild(booksGroup);
            titleActionBtns.forEach(btn => wrapper.appendChild(btn));
            wrapper.appendChild(actionsMenuBtn);

            if (actionsEl && actionsEl.parentElement) {
                actionsEl.parentElement.insertBefore(wrapper, actionsEl);
            } else {
                headerEl.appendChild(wrapper);
            }

            const navButtonsEl = headerEl.querySelector('.view-header-nav-buttons');
            const titleContainerEl = headerEl.querySelector('.view-header-title-container');
            if (navButtonsEl?.parentElement) {
                navButtonsEl.parentElement.insertBefore(sessionBtn, navButtonsEl.nextSibling);
            } else if (titleContainerEl?.parentElement) {
                titleContainerEl.parentElement.insertBefore(sessionBtn, titleContainerEl);
            } else {
                headerEl.insertBefore(sessionBtn, headerEl.firstChild);
            }

            // Community mailbox — right of the writing-session control, where
            // the Discord pill was. Mirrors the website account chip; state and
            // checking live on the plugin-wide CommunityMailbox, which checks
            // only while a view like this one is subscribed.
            const mailbox = this.plugin.communityMailbox;
            const mailboxBtn = doc.win.createEl('button');
            mailboxBtn.className = 'ert-timeline-mailbox clickable-icon';
            mailboxBtn.type = 'button';
            mailboxBtn.setAttribute('aria-haspopup', 'menu');
            setIcon(mailboxBtn, 'mail');
            // Named like the Discord pill it replaced: icon + "Mailbox".
            const mailboxLabel = doc.win.createSpan();
            mailboxLabel.className = 'ert-timeline-mailbox__label';
            mailboxLabel.setText(t('ui.timeLineView.mailbox'));
            mailboxBtn.appendChild(mailboxLabel);
            const mailboxBadgeEl = doc.win.createSpan();
            mailboxBtn.appendChild(mailboxBadgeEl);
            sessionBtn.parentElement?.insertBefore(mailboxBtn, sessionBtn.nextSibling);
            const paintMailbox = () => paintMailboxButton(mailboxBtn, mailboxBadgeEl, mailbox.view());
            this.register(mailbox.subscribe(paintMailbox));
            paintMailbox();
            this.registerDomEvent(mailboxBtn, 'click', (evt: MouseEvent) => {
                evt.preventDefault();
                evt.stopPropagation();
                openMailboxMenu(mailboxBtn, mailbox.view().answer);
            });
            // Desk Lamps — right of the mailbox: a lamp and the count of
            // friends at their desks. Shown once connected with a Desk Lamp or
            // an invite; state and checking live on the plugin-wide DeskLamps.
            const deskLamps = this.plugin.deskLamps;
            const deskLampBtn = doc.win.createEl('button');
            deskLampBtn.className = 'ert-timeline-desk-lamps clickable-icon';
            deskLampBtn.type = 'button';
            deskLampBtn.hidden = true;
            deskLampBtn.setAttribute('aria-haspopup', 'menu');
            setIcon(deskLampBtn, 'lamp-ceiling');
            const deskLampBadgeEl = doc.win.createSpan();
            deskLampBadgeEl.className = 'ert-mailbox-badge is-new';
            deskLampBtn.appendChild(deskLampBadgeEl);
            mailboxBtn.parentElement?.insertBefore(deskLampBtn, mailboxBtn.nextSibling);
            const paintDeskLamps = () => paintDeskLampButton(deskLampBtn, deskLampBadgeEl, deskLamps.view());
            this.register(deskLamps.subscribe(paintDeskLamps));
            paintDeskLamps();
            this.registerDomEvent(deskLampBtn, 'click', (evt: MouseEvent) => {
                evt.preventDefault();
                evt.stopPropagation();
                openDeskLampsMenu(deskLampBtn, deskLamps);
            });
            // Coming back from the website is when a mail mark may have
            // cleared or a Desk Lamp invite been answered.
            const wake = () => {
                mailbox.onWake();
                deskLamps.onWake();
            };
            this.registerDomEvent(doc.win, 'focus', wake);
            this.registerDomEvent(doc, 'visibilitychange', () => {
                if (doc.visibilityState === 'visible') wake();
            });

            // Subplot ring key trigger — action icon slot right of the
            // Desk Lamps. Hidden until SubplotKeyController wires it to a
            // rendered timeline with 2+ subplot rings; no tooltip by design.
            const subplotKeyBtn = doc.win.createEl('button');
            subplotKeyBtn.className = 'ert-timeline-subplot-key__trigger clickable-icon';
            subplotKeyBtn.type = 'button';
            subplotKeyBtn.hidden = true;
            setIcon(subplotKeyBtn, 'layers');
            deskLampBtn.parentElement?.insertBefore(subplotKeyBtn, deskLampBtn.nextSibling);
            this.subplotKeyTriggerEl = subplotKeyBtn;

            // Center mode navigation — compact text buttons that replace the
            // removed view title. The canonical switch stays in ModeManager;
            // keyboard shortcuts 1–4 remain wired by ModeToggleController.
            // Active state is kept in sync through the currentMode setter, so
            // keyboard, click, and saga-forced switches all reflect here.
            // Inserted as a DIRECT child of .view-header (not nested with the
            // left cluster inside .view-header-left) so the header's three
            // flex clusters (.view-header-left / mode nav / .rt-book-switcher)
            // center it against the whole bar.
            const modeNav = doc.win.createDiv();
            modeNav.className = 'ert-timeline-mode-nav';
            modeNav.setAttribute('role', 'tablist');
            setAccessibleLabel(modeNav, t('ui.timeLineView.timelineModeNav'));
            const modeButtons = new Map<string, HTMLButtonElement>();
            let chronologueModeBtn: HTMLButtonElement | undefined;
            let narrativeModeBtn: HTMLButtonElement | undefined;
            getToggleableModes().forEach((mode, index) => {
                const modeKey = `timeline.modes.${mode.id}.name`;
                const translated = t(modeKey);
                const label = translated && !translated.startsWith('[missing:') ? translated : mode.name;
                const btn = doc.win.createEl('button');
                btn.className = 'ert-timeline-mode-nav__btn';
                btn.type = 'button';
                btn.dataset.mode = mode.id;
                btn.setAttribute('role', 'tab');
                btn.setAttribute('aria-selected', 'false');
                // Numeral prefix = the keyboard shortcut, taken from the same
                // getToggleableModes() index the handler uses (never hardcoded).
                // Styled as a subtle mono hint, distinct from the mode name.
                const num = doc.win.createSpan();
                num.className = 'ert-timeline-mode-nav__num';
                num.setAttribute('aria-hidden', 'true');
                num.textContent = String(index + 1);
                const labelSpan = doc.win.createSpan();
                labelSpan.className = 'ert-timeline-mode-nav__label';
                labelSpan.textContent = label;
                btn.appendChild(num);
                btn.appendChild(labelSpan);
                setAccessibleLabel(btn, t('ui.timeLineView.modeNavAria', { mode: label, number: index + 1 }));
                applyTooltip(btn, t('ui.timeLineView.modeNavTooltip', { mode: label, number: index + 1 }), 'bottom');
                this.registerDomEvent(btn, 'click', (evt: MouseEvent) => {
                    evt.preventDefault();
                    evt.stopPropagation();
                    void this.switchTimelineModeFromNav(mode.id);
                });
                modeNav.appendChild(btn);
                modeButtons.set(mode.id, btn);
                if (mode.id === TimelineMode.CHRONOLOGUE) chronologueModeBtn = btn;
                if (mode.id === TimelineMode.NARRATIVE) narrativeModeBtn = btn;
            });
            headerEl.insertBefore(modeNav, wrapper);
            // Scopes the header layout rules in timeline.css to this view
            // without a :has() selector; the header dies with the view, so
            // there is nothing to remove.
            headerEl.classList.add('ert-timeline-header');
            this.modeNavButtons = modeButtons;
            this.buildNarrativeSubNav(doc, modeNav, narrativeModeBtn);
            this.buildChronologueSubNav(doc, modeNav, chronologueModeBtn);
            this.buildAlignmentToggle(doc, modeNav);
            setupTitleBarFit(
                headerEl,
                [sessionBtn, mailboxBtn, subplotKeyBtn, modeNav, legendBtn, booksGroup],
                (cleanup) => this.register(cleanup)
            );

            this.bookSwitcherEl = wrapper;
            this.bookSwitcherSelect = select;
            this.timelineSearchInput = searchInput;
            this.timelineSearchButton = searchBtn;
            this.searchPanel = new SearchPanelController(
                {
                    getSearchState: () => this.plugin.searchState,
                    setSearchOptions: (options) => { void this.applySearchOptions(options); },
                    getLocalModelStatus: () => this.plugin.settings.enableAiSceneAnalysis === true
                        ? getLocalLlmAvailability(this.plugin, { force: true, timeoutMs: 2000 })
                        : Promise.resolve({ available: false, reason: t('notices.aiTurnedOff') }),
                    cancelSearch: () => this.plugin.cancelSearch(),
                    registerDomEvent: (el, event, handler) =>
                        this.registerDomEvent(el as HTMLElement, event, handler),
                    register: (cleanup) => this.register(cleanup)
                },
                searchShell,
                searchInput
            );
            this.timelineLegendTrigger = legendBtn;
            this.timelineLegendPanel = legendPanel;
            this.writingSessionButton = sessionBtn;
            this.writingSessionLabel = sessionLabel;
            this.writingSessionPanel = sessionPanel;
            this.writingSessionTickInterval = window.setInterval(() => this.refreshWritingSessionControl(), 1000);
            this.register(() => {
                if (this.writingSessionTickInterval !== undefined) {
                    window.clearInterval(this.writingSessionTickInterval);
                    this.writingSessionTickInterval = undefined;
                }
                if (this.gossamerCacheTickInterval !== undefined) {
                    window.clearInterval(this.gossamerCacheTickInterval);
                    this.gossamerCacheTickInterval = undefined;
                }
                if (this.writingSessionPulseTimeout !== undefined) {
                    window.clearTimeout(this.writingSessionPulseTimeout);
                    this.writingSessionPulseTimeout = undefined;
                }
                if (this.writingSessionRingPulseTimeout !== undefined) {
                    window.clearTimeout(this.writingSessionRingPulseTimeout);
                    this.writingSessionRingPulseTimeout = undefined;
                }
            });
            this.registerDomEvent(doc.body, 'click', (evt: MouseEvent) => {
                const target = evt.target as Node | null;
                if (!target) return;
                if (sessionPanel.contains(target) || sessionBtn.contains(target)) return;
                this.hideWritingSessionPanel();
            });
            this.registerDomEvent(doc, 'keydown', (evt: KeyboardEvent) => {
                if (evt.key === 'Escape') this.hideWritingSessionPanel();
            });
            this.syncTimelineSearchControl();
            this.refreshWritingSessionControl();
        }

        this.updateBookSwitcherOptions();
        this.updateTimelineLegend();
        this.syncTimelineSearchControl();
        this.refreshWritingSessionControl();
        this.syncModeNav();
    }

    /**
     * Reflect the active timeline mode on the header mode-nav buttons. Called
     * from the currentMode setter, so keyboard (1–4), header clicks, and
     * saga-forced narrative switches all keep the nav in sync from one place.
     */
    private syncModeNav(): void {
        if (!this.modeNavButtons) return;
        this.modeNavButtons.forEach((btn, modeId) => {
            const isActive = modeId === this._currentMode;
            btn.classList.toggle('is-active', isActive);
            btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
        });
        // Leaving a mode: hide its sub-nav immediately (the controller
        // teardown also hides it, but the mode setter fires before re-render).
        if (this._currentMode !== 'chronologue') this.hideChronologueSubNav();
        if (this._currentMode !== 'narrative') this.hideNarrativeSubNav();
        this.syncAlignmentToggle();
    }

    /**
     * Build the subplot alignment toggle once, leading the mode row.
     *
     * Alignment is a saved layout preference, not a momentary sub-mode like
     * Chronologue's Shift / Alt or Narrative's Runtime, and it applies to every mode that
     * draws an all-scenes outer ring — all but Progress. So it leads the row
     * rather than nesting under one mode button, which also keeps it clear of
     * the Chronologue chips on the far side.
     *
     * One chip, labelled with the current state: the label IS the value, so
     * there is no "which of these two is on?" to decode.
     */
    private buildAlignmentToggle(doc: Document, modeNav: HTMLElement): void {
        const group = doc.win.createDiv();
        group.className = 'ert-timeline-subnav ert-timeline-alignment-toggle';
        group.setAttribute('role', 'group');
        setAccessibleLabel(group, t('timeline.subplotAlignment.groupLabel'));
        group.hidden = true;

        const btn = doc.win.createEl('button');
        btn.className = 'ert-timeline-subnav__btn';
        btn.type = 'button';
        // A drawn icon, not a character: a font's ◍ and ◔ sit off-center and read poorly at this size.
        const glyphEl = doc.win.createSpan();
        glyphEl.className = 'ert-timeline-subnav__glyph ert-timeline-subnav__glyph--icon';
        glyphEl.setAttribute('aria-hidden', 'true');
        const labelEl = doc.win.createSpan();
        labelEl.className = 'ert-timeline-subnav__label';
        btn.appendChild(glyphEl);
        btn.appendChild(labelEl);
        this.registerDomEvent(btn, 'click', (evt: MouseEvent) => {
            evt.preventDefault();
            evt.stopPropagation();
            const next: SubplotAlignment = (this.plugin.settings.subplotAlignment ?? 'fill') === 'sequence'
                ? 'fill'
                : 'sequence';
            void this.setSubplotAlignment(next);
        });
        group.appendChild(btn);

        modeNav.insertBefore(group, modeNav.firstChild);

        this.alignmentToggleEl = group;
        this.alignmentToggleBtn = btn;
        this.syncAlignmentToggle();
    }

    /**
     * Reflect the saved alignment on the toggle, and hide it in modes with no
     * all-scenes outer ring to align against (Progress). The mode test is the
     * same one the renderer gates on, asked by mode id.
     */
    private syncAlignmentToggle(): void {
        const group = this.alignmentToggleEl;
        const btn = this.alignmentToggleBtn;
        if (!group || !btn) return;

        group.hidden = !modeHasAllScenesOuterRing(this._currentMode as TimelineMode);

        const active: SubplotAlignment = this.plugin.settings.subplotAlignment ?? 'fill';
        const other: SubplotAlignment = active === 'sequence' ? 'fill' : 'sequence';
        const activeLabel = t(`timeline.subplotAlignment.${active}.label`);
        const otherLabel = t(`timeline.subplotAlignment.${other}.label`);
        const hint = `${t(`timeline.subplotAlignment.${active}.tooltip`)} ${t('timeline.subplotAlignment.switchTo', { name: otherLabel })}`;

        btn.dataset.alignment = active;
        // Fill leaves no gaps in a subplot ring; Sequence leaves gaps where other rings' scenes sit.
        const glyphEl = btn.querySelector<HTMLElement>('.ert-timeline-subnav__glyph');
        if (glyphEl) setIcon(glyphEl, active === 'sequence' ? 'circle-dashed' : 'circle');
        const labelEl = btn.querySelector('.ert-timeline-subnav__label');
        if (labelEl) labelEl.textContent = activeLabel;
        setAccessibleLabel(btn, hint);
        applyTooltip(btn, hint, 'bottom');
        // Always the current state, never an unchosen option — the chip reads
        // as a value, so the dashed "inactive" styling would misrepresent it.
        btn.classList.add('is-active');
    }

    /**
     * Switch subplot alignment. Layout-affecting, so it saves and re-renders;
     * ChangeDetection carries subplotAlignment so the render is not skipped.
     */
    private async setSubplotAlignment(alignment: SubplotAlignment): Promise<void> {
        if ((this.plugin.settings.subplotAlignment ?? 'fill') === alignment) return;
        this.plugin.settings.subplotAlignment = alignment;
        await this.plugin.saveSettings();
        this.syncAlignmentToggle();
        this.refreshTimeline();
    }

    /** One header sub-mode chip: a glyph and a label, pressed state kept in aria-pressed. */
    private makeSubNavButton(doc: Document, submode: string, label: string, glyph: string, aria: string): HTMLButtonElement {
        const btn = doc.win.createEl('button');
        btn.className = 'ert-timeline-subnav__btn';
        btn.type = 'button';
        btn.dataset.submode = submode;
        btn.setAttribute('aria-pressed', 'false');
        setAccessibleLabel(btn, aria);
        const glyphEl = doc.win.createSpan();
        glyphEl.className = 'ert-timeline-subnav__glyph';
        glyphEl.setAttribute('aria-hidden', 'true');
        glyphEl.textContent = glyph;
        const labelEl = doc.win.createSpan();
        labelEl.className = 'ert-timeline-subnav__label';
        labelEl.textContent = label;
        btn.appendChild(glyphEl);
        btn.appendChild(labelEl);
        return btn;
    }

    /** Place a sub-nav right after its mode's button. */
    private insertSubNav(modeNav: HTMLElement, subNav: HTMLElement, anchorBtn?: HTMLButtonElement): void {
        if (anchorBtn && anchorBtn.parentElement === modeNav) {
            modeNav.insertBefore(subNav, anchorBtn.nextSibling);
        } else {
            modeNav.appendChild(subNav);
        }
    }

    /**
     * Build the persistent Chronologue sub-nav (Shift / Alt) once, anchored
     * right after the Chronologue mode button. Hidden until the
     * ChronologueShiftController wires it up via showChronologueSubNav().
     * Clicks route through this.chronologueSubNav (the controller's toggles);
     * physical Shift/CapsLock/Alt keep working untouched.
     */
    private buildChronologueSubNav(doc: Document, modeNav: HTMLElement, anchorBtn?: HTMLButtonElement): void {
        const subNav = doc.win.createDiv();
        subNav.className = 'ert-timeline-subnav';
        subNav.setAttribute('role', 'group');
        setAccessibleLabel(subNav, t('ui.timeLineView.chronologueSubModes'));
        subNav.hidden = true;

        const shift = this.makeSubNavButton(doc, 'shift', t('ui.timeLineView.subNavShift'), '⇧', t('ui.timeLineView.subNavShiftAria'));
        const alt = this.makeSubNavButton(doc, 'alt', t('ui.timeLineView.subNavAlt'), '⌥', t('ui.timeLineView.subNavAltAria'));

        this.registerDomEvent(shift, 'click', (evt: MouseEvent) => {
            evt.preventDefault();
            evt.stopPropagation();
            this.chronologueSubNav?.toggleShift();
        });
        this.registerDomEvent(alt, 'click', (evt: MouseEvent) => {
            evt.preventDefault();
            evt.stopPropagation();
            this.chronologueSubNav?.toggleAlt();
        });

        subNav.appendChild(shift);
        subNav.appendChild(alt);
        this.insertSubNav(modeNav, subNav, anchorBtn);

        this.chronologueSubNavEl = subNav;
        this.chronologueSubNavBtns = { shift, alt };
    }

    /**
     * Reveal the Chronologue sub-nav and reflect per-book availability. Called
     * by the controller once its buttons exist. Alt is shown only when a valid
     * planetary profile exists.
     */
    public showChronologueSubNav(opts: { hasAlt: boolean }): void {
        const el = this.chronologueSubNavEl;
        const btns = this.chronologueSubNavBtns;
        if (!el || !btns) return;
        el.hidden = false;
        btns.alt.hidden = !opts.hasAlt;
    }

    /** Hide the Chronologue sub-nav and clear its active states. */
    public hideChronologueSubNav(): void {
        this.publishModeToTimetables();
        const el = this.chronologueSubNavEl;
        if (el) el.hidden = true;
        const btns = this.chronologueSubNavBtns;
        if (!btns) return;
        for (const btn of [btns.shift, btns.alt]) {
            btn.classList.remove('is-active');
            btn.setAttribute('aria-pressed', 'false');
        }
    }

    /**
     * Mirror the active Chronologue sub-mode onto the sub-nav. Driven from the
     * controller's own state, so it reflects activation via keyboard (Shift /
     * CapsLock / Alt), the in-view keycaps, or these header chips alike.
     */
    public syncChronologueSubNav(state: { shift: boolean; alt: boolean }): void {
        this.publishModeToTimetables();
        const btns = this.chronologueSubNavBtns;
        if (!btns) return;
        const apply = (btn: HTMLButtonElement, active: boolean) => {
            btn.classList.toggle('is-active', active);
            btn.setAttribute('aria-pressed', active ? 'true' : 'false');
        };
        apply(btns.shift, state.shift);
        apply(btns.alt, state.alt);
    }

    /**
     * Build the persistent Narrative sub-nav (Runtime) once, anchored right
     * after the Narrative mode button. Hidden until the
     * NarrativeRuntimeController wires it up via showNarrativeSubNav(). The
     * chip and the in-view RT keycap run the same toggle.
     */
    private buildNarrativeSubNav(doc: Document, modeNav: HTMLElement, anchorBtn?: HTMLButtonElement): void {
        const subNav = doc.win.createDiv();
        subNav.className = 'ert-timeline-subnav';
        subNav.setAttribute('role', 'group');
        setAccessibleLabel(subNav, t('ui.timeLineView.narrativeSubModes'));
        subNav.hidden = true;

        const runtime = this.makeSubNavButton(doc, 'runtime', t('ui.timeLineView.subNavRuntime'), 'RT', t('ui.timeLineView.subNavRuntimeAria'));
        this.registerDomEvent(runtime, 'click', (evt: MouseEvent) => {
            evt.preventDefault();
            evt.stopPropagation();
            this.narrativeSubNav?.toggleRuntime();
        });

        subNav.appendChild(runtime);
        this.insertSubNav(modeNav, subNav, anchorBtn);

        this.narrativeSubNavEl = subNav;
        this.narrativeRuntimeBtn = runtime;
    }

    /**
     * Reveal the Narrative sub-nav. Runtime carries a no-data hint when no
     * scene has Runtime data, mirroring the in-view keycap; the view itself
     * still opens, showing every scene's missing-runtime stub.
     */
    public showNarrativeSubNav(opts: { runtimeNoData: boolean }): void {
        const el = this.narrativeSubNavEl;
        const btn = this.narrativeRuntimeBtn;
        if (!el || !btn) return;
        el.hidden = false;
        btn.classList.toggle('is-no-data', opts.runtimeNoData);
    }

    /** Hide the Narrative sub-nav and clear its active state. */
    public hideNarrativeSubNav(): void {
        this.publishModeToTimetables();
        const el = this.narrativeSubNavEl;
        if (el) el.hidden = true;
        const btn = this.narrativeRuntimeBtn;
        if (!btn) return;
        btn.classList.remove('is-active');
        btn.setAttribute('aria-pressed', 'false');
    }

    /** Mirror the runtime view's state onto the Narrative sub-nav. */
    public syncNarrativeSubNav(state: { runtime: boolean }): void {
        this.publishModeToTimetables();
        const btn = this.narrativeRuntimeBtn;
        if (!btn) return;
        btn.classList.toggle('is-active', state.runtime);
        btn.setAttribute('aria-pressed', state.runtime ? 'true' : 'false');
    }

    /**
     * Header mode-nav click handler. Routes through ModeManager (the single
     * canonical switch path); the currentMode setter updates the nav state.
     */
    private async switchTimelineModeFromNav(modeId: string): Promise<void> {
        if (modeId === this._currentMode) return;
        this.closeWritingSessionPanel();
        await this.modeManager.switchMode(modeId as TimelineMode);
    }

    private formatSessionClock(ms: number): string {
        const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = totalSeconds % 60;
        if (hours > 0) {
            return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
        }
        return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }

    private formatSessionClockHms(ms: number): string {
        const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = totalSeconds % 60;
        return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }

    private formatWritingSessionMode(mode: WritingSessionMode): string {
        if (mode === 'drafting') return t('ui.timeLineView.modeFreshDraftingLower');
        if (mode === 'revising') return t('ui.timeLineView.modeRevisionLower');
        if (mode === 'editing') return t('ui.timeLineView.modeLineEditLower');
        return t('ui.timeLineView.modePlanningLower');
    }

    private formatWritingSessionStage(stage: WritingSessionStage | WritingSessionStagePreference | undefined): string {
        if (!stage || stage === 'auto') return t('ui.timeLineView.stageAuto');
        return stage;
    }

    private resolveWritingSessionStageSelection(
        mode: WritingSessionMode,
        stage: WritingSessionStagePreference
    ): WritingSessionStagePreference {
        if (mode === 'drafting' && stage === 'auto') return 'Zero';
        return stage;
    }

    /**
     * True when saved sessions will post to the community feed: the author is
     * at the top sharing level with an active connection AND the remembered
     * per-save toggle is on. Drives the social (yellow) accent on the session
     * button and popover.
     */
    private isSessionFeedShareArmed(): boolean {
        return canPostSessionsToFeed(this.plugin)
            && this.plugin.getWritingSessionService().isPostSessionsToFeedEnabled();
    }

    private sessionHasWordGoal(active: ActiveWritingSession): boolean {
        return (active.targetMode === 'words' || active.targetMode === 'both') && Boolean(active.goalWords);
    }

    // A countdown timer always owns the rings (center + tab): in "word + time"
    // mode word progress starts at 0 and would render an empty arc, hiding the
    // countdown entirely. Words drive the ring only when no timer is set.
    private sessionUsesWordRing(active: ActiveWritingSession): boolean {
        return this.sessionHasWordGoal(active) && !active.goalMinutes;
    }

    private formatWordCount(value: number): string {
        return tCount('word', value);
    }

    private formatWritingSessionModeTitle(mode: WritingSessionMode): string {
        if (mode === 'drafting') return t('ui.timeLineView.modeFreshDrafting');
        if (mode === 'revising') return t('ui.timeLineView.modeRevision');
        if (mode === 'editing') return t('ui.timeLineView.modeLineEdit');
        return t('ui.timeLineView.modePlanning');
    }

    /** The idle panel's summary: "400 words + 40 min" over "Planning · Author". */
    private formatIdleWritingSessionMeta(
        goalMinutes: number,
        goalWords: number,
        targetMode: WritingSessionTargetMode,
        mode: WritingSessionMode,
        stage: WritingSessionStagePreference
    ): { target: string; detail: string } {
        const target = targetMode === 'time'
            ? t('ui.timeLineView.minTarget', { minutes: goalMinutes })
            : targetMode === 'words'
                ? t('ui.timeLineView.wordTarget', { words: goalWords })
                : t('ui.timeLineView.wordsPlusMinutes', { words: goalWords, minutes: goalMinutes });
        return {
            target,
            detail: [this.formatWritingSessionModeTitle(mode), this.formatWritingSessionStage(stage)].join(' · '),
        };
    }

    private formatCompletedSessionSummary(active: ActiveWritingSession, elapsedMs: number): string {
        const minutes = Math.max(1, Math.round(elapsedMs / 60000));
        const details = [
            t('ui.timeLineView.minutesShort', { minutes }),
            this.formatWritingSessionMode(active.mode),
            active.bookTitle,
        ].filter(Boolean).join(' ');
        return t('ui.timeLineView.saveSessionPrompt', { details });
    }

    private getCountdownSegmentElapsedMs(active: ActiveWritingSession, elapsedMs: number): number {
        if (!active.goalMinutes) return elapsedMs;
        return Math.max(0, elapsedMs - (active.countdownSegmentStartElapsedMs ?? 0));
    }

    private formatSessionClockDisplay(ms: number, mode: 'countdown' | 'elapsed'): SessionClockDisplay {
        const safeMs = Math.max(0, ms);
        const showSeconds = mode === 'countdown'
            ? safeMs <= SESSION_SECONDS_DISPLAY_THRESHOLD_MS
            : safeMs < 60000;
        if (showSeconds) {
            const value = String(Math.max(0, Math.ceil(safeMs / 1000)));
            return { value, unit: 'sec', label: t('ui.timeLineView.secondsShort', { seconds: value }) };
        }
        const minutes = mode === 'countdown'
            ? Math.ceil(safeMs / 60000)
            : Math.floor(safeMs / 60000);
        const value = String(Math.max(0, minutes));
        return { value, unit: 'min', label: t('ui.timeLineView.minutesShort', { minutes: value }) };
    }

    private getSessionStatusDisplay(active: ActiveWritingSession, elapsedMs: number): SessionStatusDisplay {
        if (this.sessionUsesWordRing(active)) {
            const typedWords = Math.max(0, Math.round(active.typedWords || 0));
            const goalWords = Math.max(1, Math.round(active.goalWords || 1));
            const detail = [
                t('ui.timeLineView.wordsTyped', { typed: typedWords, goal: goalWords }),
                t('ui.timeLineView.clockElapsed', { clock: this.formatSessionClockHms(elapsedMs) }),
            ].join(' · ');
            if (active.pausedAt) {
                return { headline: active.idleAuto ? t('ui.timeLineView.idle') : t('ui.timeLineView.paused'), detail, tone: 'paused' };
            }
            return { headline: String(typedWords), detail, tone: 'running' };
        }
        const goalMs = active.goalMinutes ? active.goalMinutes * 60000 : undefined;
        const countdownElapsedMs = this.getCountdownSegmentElapsedMs(active, elapsedMs);
        const remainingMs = goalMs ? Math.max(0, goalMs - countdownElapsedMs) : undefined;
        const clockDisplay = this.formatSessionClockDisplay(remainingMs ?? elapsedMs, goalMs ? 'countdown' : 'elapsed');
        const wordsTyped = this.sessionHasWordGoal(active)
            ? t('ui.timeLineView.wordsTyped', { typed: Math.max(0, Math.round(active.typedWords || 0)), goal: Math.max(1, Math.round(active.goalWords || 1)) }) // SAFE: live session readout — an unstarted session shows 0 typed, and the 1-word floor keeps the denominator non-zero
            : '';
        const withWordsTyped = (clockText: string): string => [clockText, wordsTyped].filter(Boolean).join(' · ');
        if (goalMs && remainingMs === 0) {
            return {
                headline: t('ui.timeLineView.sessionComplete'),
                detail: t('ui.timeLineView.sessionCompleteDetail'),
                tone: 'complete',
            };
        }
        if (active.pausedAt) {
            return {
                headline: active.idleAuto ? t('ui.timeLineView.idle') : t('ui.timeLineView.paused'),
                detail: withWordsTyped(goalMs
                    ? t('ui.timeLineView.clockLeft', { clock: clockDisplay.label })
                    : t('ui.timeLineView.clockElapsed', { clock: clockDisplay.label })),
                tone: 'paused',
            };
        }
        return {
            headline: clockDisplay.value,
            detail: withWordsTyped(goalMs
                ? t('ui.timeLineView.clockRemaining', { clock: clockDisplay.label })
                : t('ui.timeLineView.clockElapsed', { clock: clockDisplay.label })),
            tone: 'running',
        };
    }

    private getSessionProgressStep(progress: number): number {
        const clamped = Math.min(1, Math.max(0, progress));
        return Math.round((clamped * 100) / SESSION_PROGRESS_STEP_PERCENT) * SESSION_PROGRESS_STEP_PERCENT;
    }

    private getActiveSessionProgressStep(active: ActiveWritingSession, elapsedMs: number): number {
        if (this.sessionUsesWordRing(active)) {
            const targetWords = Math.max(1, Math.round(active.goalWords || 1));
            return this.getSessionProgressStep(Math.max(0, Math.round(active.typedWords || 0)) / targetWords);
        }
        const targetMinutes = active.goalMinutes ?? this.plugin.getWritingSessionService().getDefaultGoalMinutes() ?? 120;
        const targetMs = Math.max(1, targetMinutes) * 60000;
        const progressElapsedMs = active.goalMinutes
            ? this.getCountdownSegmentElapsedMs(active, elapsedMs)
            : elapsedMs;
        return this.getSessionProgressStep(progressElapsedMs / targetMs);
    }

    private applySessionProgressClass(el: HTMLElement, progressStep: number | undefined): void {
        for (let step = 0; step <= 100; step += SESSION_PROGRESS_STEP_PERCENT) {
            el.classList.toggle(`is-progress-${step}`, progressStep === step);
        }
    }

    private getIdleSessionClockSnapshot(): { label: string; detail: string; state: 'idle'; renderIcon?: boolean; goalMet?: boolean } {
        const service = this.plugin.getWritingSessionService();
        const dailyProgress = service.getDailySessionProgress();
        const defaultGoalMinutes = this.getDefaultSessionGoalMinutes();
        const defaultGoalWords = this.getDefaultSessionGoalWords();
        if (dailyProgress.targetMode === 'words' || dailyProgress.targetMode === 'both') {
            if (!dailyProgress.dailyTargetWords) {
                return {
                    label: String(defaultGoalWords),
                    detail: t('ui.timeLineView.idleStartWordTarget', { words: this.formatWordCount(defaultGoalWords) }),
                    state: 'idle',
                };
            }
            if (dailyProgress.remainingWords && dailyProgress.remainingWords > 0) {
                return {
                    label: String(dailyProgress.remainingWords),
                    detail: t('ui.timeLineView.idleStartWordsLeft', { words: this.formatWordCount(dailyProgress.remainingWords) }),
                    state: 'idle',
                };
            }
            if (dailyProgress.sessionsCompleted > 0) {
                return {
                    label: '',
                    detail: t('ui.timeLineView.idleWordGoalComplete', { words: this.formatWordCount(dailyProgress.wordsLogged) }),
                    state: 'idle',
                    renderIcon: true,
                    goalMet: true,
                };
            }
            return {
                label: String(dailyProgress.dailyTargetWords),
                detail: t('ui.timeLineView.idleStartWordTarget', { words: this.formatWordCount(dailyProgress.dailyTargetWords) }),
                state: 'idle',
            };
        }
        if (!dailyProgress.dailyTargetMinutes) {
            return {
                label: String(defaultGoalMinutes),
                detail: t('ui.timeLineView.idleStartMinuteTarget', { minutes: defaultGoalMinutes }),
                state: 'idle',
            };
        }
        if (dailyProgress.remainingMinutes && dailyProgress.remainingMinutes > 0) {
            return {
                label: String(dailyProgress.remainingMinutes),
                detail: t('ui.timeLineView.idleStartMinutesLeft', { minutes: dailyProgress.remainingMinutes }),
                state: 'idle',
            };
        }
        if (dailyProgress.sessionsCompleted > 0) {
            return {
                label: '',
                detail: t('ui.timeLineView.idleTimeGoalComplete', { minutes: dailyProgress.minutesLogged }),
                state: 'idle',
                renderIcon: true,
                goalMet: true,
            };
        }
        return {
            label: String(dailyProgress.dailyTargetMinutes),
            detail: t('ui.timeLineView.idleStartMinuteTarget', { minutes: dailyProgress.dailyTargetMinutes }),
            state: 'idle',
        };
    }

    private getSessionClockSnapshot(): { label: string; detail: string; state: 'idle' | 'active' | 'paused'; progressStep?: number; pulseKey?: string; renderIcon?: boolean; goalMet?: boolean } {
        const service = this.plugin.getWritingSessionService();
        const active = service.getActiveSession();
        if (!active) return this.getIdleSessionClockSnapshot();
        const elapsedMs = service.getActiveElapsedMs();
        const display = this.getSessionStatusDisplay(active, elapsedMs);
        return {
            label: display.tone === 'complete' ? t('ui.timeLineView.completeLabel') : display.headline,
            detail: active.pausedAt
                ? (active.idleAuto
                    ? t('ui.timeLineView.idleSessionDetail', { mode: this.formatWritingSessionMode(active.mode), detail: display.detail })
                    : t('ui.timeLineView.pausedSessionDetail', { mode: this.formatWritingSessionMode(active.mode), detail: display.detail }))
                : t('ui.timeLineView.activeSessionDetail', { mode: this.formatWritingSessionMode(active.mode), detail: display.detail }),
            state: active.pausedAt ? 'paused' : 'active',
            progressStep: this.getActiveSessionProgressStep(active, elapsedMs),
            pulseKey: display.tone === 'running' ? this.getSessionTitlePulseKey(active, elapsedMs) : undefined,
        };
    }

    private refreshWritingSessionControl(): void {
        if (!this.writingSessionButton || !this.writingSessionLabel) return;
        const service = this.plugin.getWritingSessionService();
        // Heartbeat: marks the running session as still alive so an app
        // crash/quit freezes elapsed time instead of counting dead time.
        void service.markActiveSessionSeen();
        // Auto-track (always on): pause on idle, resume on activity. Re-render
        // the panel when the session state actually changes.
        void service.maybeHandleIdle().then(changed => {
            if (changed) this.renderWritingSessionPanel();
        });
        const snapshot = this.getSessionClockSnapshot();
        const shouldPulseCount = this.shouldPulseWritingSessionTitleCount(snapshot.pulseKey);
        const pulseColor = shouldPulseCount ? this.getWritingSessionPulseColor() : undefined;
        this.writingSessionLabel.empty();
        if (snapshot.state === 'idle' && snapshot.renderIcon) {
            this.renderWritingSessionIdleIcon(this.writingSessionLabel);
        } else {
            this.writingSessionLabel.setText(snapshot.label);
        }
        this.writingSessionButton.classList.toggle('is-idle', snapshot.state === 'idle');
        this.writingSessionButton.classList.toggle('is-icon-only', snapshot.state === 'idle' && Boolean(snapshot.renderIcon));
        this.writingSessionButton.classList.toggle('is-active', snapshot.state === 'active');
        this.writingSessionButton.classList.toggle('is-paused', snapshot.state === 'paused');
        this.writingSessionButton.classList.toggle('is-goal-met', Boolean(snapshot.goalMet));
        // Social accent: sessions saved while this is armed post to the
        // author's public community feed.
        this.writingSessionButton.classList.toggle('is-community-shared', this.isSessionFeedShareArmed());
        this.applySessionProgressClass(this.writingSessionButton, snapshot.progressStep);
        setAccessibleLabel(this.writingSessionButton, snapshot.detail);
        setTooltip(this.writingSessionButton, snapshot.detail);
        if (shouldPulseCount && snapshot.pulseKey && pulseColor) {
            this.pulseWritingSessionTitleCount(pulseColor);
        }
        this.writingSessionLastTitlePulseKey = snapshot.pulseKey;
        this.syncOpenWritingSessionPanel();
        this.updateWritingSessionRing(undefined, { pulseColor });
        this.updateTabTimerIcon();
    }

    // Paints a muted filled-pie over the workspace tab icon while a session is
    // running so the timer stays visible even when editing a note. Falls back
    // to the plugin logo when idle. `tabHeaderInnerIconEl` is an Obsidian
    // internal — guarded so a missing element no-ops instead of throwing.
    private updateTabTimerIcon(): void {
        const iconEl = (this.leaf as unknown as { tabHeaderInnerIconEl?: HTMLElement }).tabHeaderInnerIconEl;
        if (!iconEl) return;
        const service = this.plugin.getWritingSessionService();
        const active = service.getActiveSession();
        if (!active) {
            if (this.tabTimerIconActive) {
                setIcon(iconEl, 'rt-logo');
                this.tabTimerIconActive = false;
            }
            return;
        }
        const elapsedMs = service.getActiveElapsedMs();
        // Auto-track state marker inside the disc: a dot while the session is
        // idle-suspended, a plus while activity is being tracked. Manual pauses
        // show no marker.
        const symbol = active.pausedAt
            ? (active.idleAuto ? 'dot' as const : undefined)
            : 'plus' as const;
        if (this.sessionUsesWordRing(active)) {
            const goalWords = Math.max(1, Math.round(active.goalWords || 1));
            const typedWords = Math.max(0, Math.round(active.typedWords || 0));
            const elapsedProgress = Math.min(1, Math.max(0, typedWords / goalWords));
            iconEl.empty();
            iconEl.appendChild(buildTabTimerDiscSvg({
                progress: elapsedProgress,
                direction: 'clockwise',
                paused: Boolean(active.pausedAt),
                symbol,
            }));
            this.tabTimerIconActive = true;
            return;
        }
        const countdown = Boolean(active.goalMinutes);
        const targetMinutes = active.goalMinutes ?? service.getDefaultGoalMinutes() ?? 120;
        const targetMs = Math.max(1, targetMinutes) * 60000;
        const timerElapsedMs = countdown ? this.getCountdownSegmentElapsedMs(active, elapsedMs) : elapsedMs;
        const elapsedProgress = Math.min(1, Math.max(0, timerElapsedMs / targetMs));
        iconEl.empty();
        iconEl.appendChild(buildTabTimerDiscSvg({
            progress: countdown ? 1 - elapsedProgress : elapsedProgress,
            direction: countdown ? 'counterclockwise' : 'clockwise',
            paused: Boolean(active.pausedAt),
            symbol,
        }));
        this.tabTimerIconActive = true;
    }

    private getSessionTitlePulseKey(active: ActiveWritingSession, elapsedMs: number): string {
        if (this.sessionUsesWordRing(active)) {
            return `typed-words-${Math.max(0, Math.round(active.typedWords || 0))}`;
        }
        const goalMs = active.goalMinutes ? active.goalMinutes * 60000 : undefined;
        if (goalMs) {
            const remainingMs = Math.max(0, goalMs - this.getCountdownSegmentElapsedMs(active, elapsedMs));
            return `remaining-min-${Math.ceil(remainingMs / 60000)}`;
        }
        return `elapsed-min-${Math.floor(elapsedMs / 60000)}`;
    }

    private shouldPulseWritingSessionTitleCount(nextPulseKey: string | undefined): boolean {
        const previousPulseKey = this.writingSessionLastTitlePulseKey;
        return previousPulseKey !== undefined && nextPulseKey !== undefined && previousPulseKey !== nextPulseKey;
    }

    private getWritingSessionPulseColor(): string {
        const colors = ['white', 'yellow', 'lime', 'cyan', 'deepskyblue', 'magenta', 'orange'];
        const available = colors.filter(color => color !== this.writingSessionLastPulseColor);
        const color = available[Math.floor(Math.random() * available.length)] ?? colors[0] ?? 'white';
        this.writingSessionLastPulseColor = color;
        return color;
    }

    private pulseWritingSessionTitleCount(pulseColor: string): void {
        if (!this.writingSessionLabel) return;
        this.writingSessionLabel.classList.remove('is-count-pulse');
        this.writingSessionLabel.style.setProperty('--ert-session-pulse-color', pulseColor);
        void this.writingSessionLabel.offsetWidth;
        this.writingSessionLabel.classList.add('is-count-pulse');
        if (this.writingSessionPulseTimeout !== undefined) {
            window.clearTimeout(this.writingSessionPulseTimeout);
        }
        this.writingSessionPulseTimeout = window.setTimeout(() => {
            this.writingSessionLabel?.classList.remove('is-count-pulse');
            this.writingSessionPulseTimeout = undefined;
        }, 300);
    }

    private renderWritingSessionIdleIcon(target: HTMLElement): void {
        target.empty();
        setIcon(target, 'metronome');
        const icon = target.querySelector('svg');
        if (icon instanceof SVGSVGElement) {
            icon.classList.add('ert-timeline-session__icon');
            icon.setAttribute('aria-hidden', 'true');
            return;
        }

        const doc = target.ownerDocument;
        const svg = doc.win.createSvg('svg');
        svg.classList.add('svg-icon', 'lucide', 'lucide-metronome-icon', 'lucide-metronome', 'ert-timeline-session__icon');
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('aria-hidden', 'true');
        svg.setAttribute('fill', 'none');
        svg.setAttribute('stroke', 'currentColor');
        svg.setAttribute('stroke-width', '2');
        svg.setAttribute('stroke-linecap', 'round');
        svg.setAttribute('stroke-linejoin', 'round');

        [
            'M12 11.4V9.1',
            'm12 17 6.59-6.59',
            'm15.05 5.7-.218-.691a3 3 0 0 0-5.663 0L4.418 19.695A1 1 0 0 0 5.37 21h13.253a1 1 0 0 0 .951-1.31L18.45 16.2',
        ].forEach((d) => {
            const path = doc.win.createSvg('path');
            path.setAttribute('d', d);
            svg.appendChild(path);
        });

        const circle = doc.win.createSvg('circle');
        circle.setAttribute('cx', '20');
        circle.setAttribute('cy', '9');
        circle.setAttribute('r', '2');
        svg.appendChild(circle);

        target.appendChild(svg);
    }

    private toggleWritingSessionPanel(): void {
        if (!this.writingSessionPanel) return;
        if (this.writingSessionPanel.classList.contains('ert-hidden')) {
            this.showWritingSessionPanel();
        } else {
            this.hideWritingSessionPanel();
        }
    }

    private showWritingSessionPanel(): void {
        if (!this.writingSessionPanel) return;
        this.renderWritingSessionPanel();
        this.positionWritingSessionPanel();
        this.writingSessionPanel.classList.remove('ert-hidden');
        this.writingSessionButton?.setAttribute('aria-expanded', 'true');
    }

    private hideWritingSessionPanel(): void {
        this.writingSessionPanel?.classList.add('ert-hidden');
        this.writingSessionButton?.setAttribute('aria-expanded', 'false');
    }

    public closeWritingSessionPanel(): void {
        this.hideWritingSessionPanel();
    }

    private positionWritingSessionPanel(): void {
        if (!this.writingSessionPanel || !this.writingSessionButton) return;
        const btnRect = this.writingSessionButton.getBoundingClientRect();
        const panelRect = this.writingSessionPanel.getBoundingClientRect();
        const viewportPadding = 12;
        const left = Math.min(
            Math.max(viewportPadding, btnRect.left),
            Math.max(viewportPadding, window.innerWidth - panelRect.width - viewportPadding)
        );
        this.writingSessionPanel.style.left = `${left}px`;
        this.writingSessionPanel.style.top = `${btnRect.bottom + 8}px`;
    }

    private getDefaultSessionGoalMinutes(): number {
        return this.plugin.getWritingSessionService().getDefaultGoalMinutes() ?? 120;
    }

    private getDefaultSessionGoalWords(): number {
        return this.plugin.getWritingSessionService().getDefaultGoalWords() ?? 1000;
    }

    private getSessionGoalMinutesForToday(): number {
        const service = this.plugin.getWritingSessionService();
        const dailyProgress = service.getDailySessionProgress();
        return dailyProgress.remainingMinutes && dailyProgress.remainingMinutes > 0
            ? dailyProgress.remainingMinutes
            : this.getDefaultSessionGoalMinutes();
    }

    private getSessionGoalWordsForToday(): number {
        const service = this.plugin.getWritingSessionService();
        const dailyProgress = service.getDailySessionProgress();
        return dailyProgress.remainingWords && dailyProgress.remainingWords > 0
            ? dailyProgress.remainingWords
            : this.getDefaultSessionGoalWords();
    }

    private createSessionButton(parent: HTMLElement, label: string, className: string, onClick: () => void | Promise<void>): HTMLButtonElement {
        const button = parent.createEl('button', { cls: className, text: label });
        button.type = 'button';
        button.onclick = (event: MouseEvent) => {
            event.preventDefault();
            event.stopPropagation();
            void onClick();
        };
        return button;
    }

    private isolateSessionPanelControl(control: HTMLElement): void {
        (['keydown', 'keypress', 'keyup'] as const).forEach(eventName => {
            this.sessionPanelScope.registerDomEvent(control, eventName, event => {
                event.stopPropagation();
            });
        });
    }

    private createSessionIconButton(parent: HTMLElement, icon: string, label: string, className: string, onClick: () => void | Promise<void>): HTMLButtonElement {
        const button = parent.createEl('button', { cls: className });
        button.type = 'button';
        setIcon(button, icon);
        setAccessibleLabel(button, label);
        button.onclick = (event: MouseEvent) => {
            event.preventDefault();
            event.stopPropagation();
            void onClick();
        };
        return button;
    }

    private createSessionSectionTitle(parent: HTMLElement, icon: string, title: string): HTMLElement {
        const titleEl = parent.createDiv({ cls: 'ert-timeline-session-panel__section-title' });
        const iconEl = titleEl.createSpan({ cls: 'ert-timeline-session-panel__section-icon' });
        setIcon(iconEl, icon);
        titleEl.createSpan({ text: title });
        return titleEl;
    }

    private revealGoalsSessionsSettings(): void {
        const settingsTab = this.plugin.settingsTab;
        openSettingsTab(this.app);
        settingsTab?.setActiveTab('core');
        const reveal = () => settingsTab?.revealSettingsSection('core', 'goals-sessions', { force: true });
        window.requestAnimationFrame(reveal);
        window.setTimeout(reveal, 160);
        window.setTimeout(reveal, 360);
    }

    private renderWritingSessionPanel(): void {
        const panel = this.writingSessionPanel;
        if (!panel) return;
        this.resetSessionPanelScope();
        panel.empty();

        const service = this.plugin.getWritingSessionService();
        const active = service.getActiveSession();
        panel.dataset.sessionState = active ? 'active' : 'idle';
        delete panel.dataset.sessionRenderKey;
        // Social accent: saved sessions will post to the public community feed.
        const feedArmed = this.isSessionFeedShareArmed();
        panel.classList.toggle('is-community-shared', feedArmed);
        const header = panel.createDiv({ cls: 'ert-timeline-session-panel__header' });
        header.createDiv({ cls: 'ert-timeline-session-panel__title', text: t('ui.timeLineView.writingSessionTitle') });
        if (feedArmed) {
            const sharedBadge = header.createSpan({ cls: 'ert-timeline-session-panel__shared-badge', text: t('ui.timeLineView.sharedBadge') });
            applyTooltip(sharedBadge, t('ui.timeLineView.sharedTooltip'), 'bottom');
        }
        const settingsBtn = header.createEl('button', { cls: 'ert-timeline-session-panel__icon clickable-icon' });
        settingsBtn.type = 'button';
        setIcon(settingsBtn, 'settings');
        setAccessibleLabel(settingsBtn, t('ui.timeLineView.goalsSessionsSettings'));
        settingsBtn.onclick = (event: MouseEvent) => {
            event.preventDefault();
            event.stopPropagation();
            this.revealGoalsSessionsSettings();
            this.hideWritingSessionPanel();
        };

        if (!active) {
            this.renderIdleWritingSessionPanel(panel);
        } else {
            this.renderActiveWritingSessionPanel(panel, active);
        }
        this.renderWritingSessionRecentStrip(panel);
    }

    /**
     * Compact "last 7 days" session-log strip at the bottom of the writing
     * session popover. Private audience only. Hidden when there is nothing
     * to show.
     */
    private renderWritingSessionRecentStrip(panel: HTMLElement): void {
        const rows = this.plugin.getWritingSessionService().getPrivateSessionLog({
            days: 7,
            limit: 5,
        });
        if (rows.length === 0) return;

        const strip = panel.createDiv({ cls: 'ert-timeline-session-panel__recent' });
        const header = strip.createDiv({ cls: 'ert-timeline-session-panel__recent-header' });
        const iconEl = header.createSpan({ cls: 'ert-timeline-session-panel__recent-header-icon' });
        setIcon(iconEl, 'history');
        header.createSpan({ text: t('ui.timeLineView.recentLast7Days') });
        header.createSpan({
            cls: 'ert-timeline-session-panel__recent-meta',
            text: tCount('session', rows.length),
        });

        const list = strip.createDiv();
        renderSessionLogList(list, rows, {
            mode: 'compact',
            onSceneClick: (path) => {
                void openOrRevealFileByPath(this.app, path);
                this.hideWritingSessionPanel();
            },
        });
    }

    private renderIdleWritingSessionPanel(panel: HTMLElement): void {
        const service = this.plugin.getWritingSessionService();
        const sessionGoalMinutes = this.getSessionGoalMinutesForToday();
        const sessionGoalWords = this.getSessionGoalWordsForToday();
        // A title, not a control: no hover, and the icon is the clock this
        // session will run — a gray ring with an accent notch at twelve counts
        // up; inverted (accent ring, gray notch), a countdown starts full.
        const intro = panel.createDiv({ cls: 'ert-timeline-session-panel__intro' });
        const ring = intro.createSvg('svg', {
            cls: 'ert-timeline-session-panel__count-ring',
            attr: { viewBox: '0 0 24 24', 'aria-hidden': 'true' },
        });
        ring.createSvg('circle', { cls: 'ert-timeline-session-panel__count-ring-track', attr: { cx: '12', cy: '12', r: '9.5' } });
        ring.createSvg('path', { cls: 'ert-timeline-session-panel__count-ring-notch', attr: { d: 'M 8.75 3.07 A 9.5 9.5 0 0 1 15.25 3.07' } });
        const introText = intro.createDiv({ cls: 'ert-timeline-session-panel__intro-copy' });
        const sessionSettings = service.getSettings();
        const defaultMode = sessionSettings.defaults.defaultMode;
        const defaultStage = this.resolveWritingSessionStageSelection(defaultMode, sessionSettings.defaults.defaultStage ?? 'auto');
        const defaultTargetMode = service.getDefaultTargetMode();
        introText.createDiv({
            cls: 'ert-timeline-session-panel__intro-title',
            text: service.getDailySessionProgress().sessionsCompleted > 0 ? t('ui.timeLineView.resumeToday') : t('ui.timeLineView.readyToWrite'),
        });
        // When today's writing began; before the first session, the moment this one would.
        const dayStart = service.getTodayFirstSessionStart() ?? new Date();
        introText.createDiv({
            cls: 'ert-timeline-session-panel__intro-time',
            text: `${dayStart.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} ${dayStart.toLocaleDateString([], { weekday: 'short' })}`,
        });
        const initialMeta = this.formatIdleWritingSessionMeta(sessionGoalMinutes, sessionGoalWords, defaultTargetMode, defaultMode, defaultStage);
        const introTarget = introText.createDiv({ cls: 'ert-timeline-session-panel__intro-meta', text: initialMeta.target });
        const introDetail = introText.createDiv({ cls: 'ert-timeline-session-panel__intro-meta', text: initialMeta.detail });
        // Intentionally NO daily-progress strip ("140m logged · 100m over · 0w
        // logged · 400w left"). The session log below shows today's actual
        // sessions; that's where running totals belong. The intro card answers
        // one question only: "what will this session do?"
        //
        // Auto-track is not a setting: every session paces itself on real
        // editing activity (pauses when idle, resumes when writing resumes).
        // The pause/resume buttons remain the author's manual override.

        const form = panel.createDiv({ cls: 'ert-timeline-session-panel__form' });

        let modeSelect: HTMLSelectElement;
        let stageSelect: HTMLSelectElement;
        let targetModeSelect: HTMLSelectElement;
        let countdownToggle: HTMLInputElement;
        let goalInput: HTMLInputElement;
        let wordGoalInput: HTMLInputElement;
        let updateIdleMeta = () => undefined;
        // Desk Lamps ticked for this session; empty when the section isn't shown.
        const deskLamps = this.plugin.deskLamps;
        const lampFriends = deskLamps.panelFriends();
        const lampBoxes: Array<{ profileId: string; box: HTMLInputElement }> = [];

        const startSession = async () => {
            const mode = (modeSelect.value as WritingSessionMode) || 'drafting';
            const stage = (stageSelect.value as WritingSessionStagePreference) || 'auto';
            const targetMode = (targetModeSelect.value as WritingSessionTargetMode) || 'time';
            const parsedGoal = Number(goalInput.value);
            const parsedWordGoal = Number(wordGoalInput.value);
            const goalMinutes = targetMode !== 'words' && countdownToggle.checked && Number.isFinite(parsedGoal) && parsedGoal > 0
                ? parsedGoal
                : undefined;
            const goalWords = targetMode !== 'time' && Number.isFinite(parsedWordGoal) && parsedWordGoal > 0
                ? parsedWordGoal
                : undefined;
            try {
                await service.setDefaultMode(mode);
                await service.setDefaultStage(stage);
                await service.setDefaultTargetMode(targetMode);
                const session = await service.start({ mode, stage, targetMode, goalMinutes, goalWords });
                // Every session is shared by choice: only the boxes ticked
                // here light the lamp, and they become next session's default.
                if (lampBoxes.length > 0) {
                    await deskLamps.shareSession(session.id, lampBoxes.filter(entry => entry.box.checked).map(entry => entry.profileId));
                }
                const targets = [
                    session.goalWords ? this.formatWordCount(session.goalWords) : undefined,
                    session.goalMinutes ? t('ui.timeLineView.minutesShort', { minutes: session.goalMinutes }) : undefined,
                ].filter(Boolean).join(' + ');
                const modeLabel = this.formatWritingSessionMode(session.mode);
                new Notice(targets
                    ? t('ui.timeLineView.startedSessionFor', { mode: modeLabel, targets })
                    : t('ui.timeLineView.startedSession', { mode: modeLabel }));
                this.refreshWritingSessionControl();
            } catch (error) {
                new Notice(error instanceof Error ? error.message : t('ui.timeLineView.startFailed'));
            }
        };

        // Target leads the form: what this session is aiming at is the decision
        // the author makes every time. Mode/stage below are set-and-forget.
        const sprintSection = form.createDiv({ cls: 'ert-timeline-session-panel__section' });
        this.createSessionSectionTitle(sprintSection, 'target', t('ui.timeLineView.targetSection'));

        const targetModeRow = sprintSection.createDiv({ cls: 'ert-timeline-session-panel__row' });
        targetModeRow.createDiv({ cls: 'ert-timeline-session-panel__label', text: t('ui.timeLineView.typeLabel') });
        targetModeSelect = targetModeRow.createEl('select', { cls: 'ert-input ert-input--md ert-timeline-session-panel__select' });
        const targetModeOptions: Array<{ value: WritingSessionTargetMode; label: string }> = [
            { value: 'time', label: t('settings.goalsSessions.targetMode.time') },
            { value: 'words', label: t('settings.goalsSessions.targetMode.words') },
            { value: 'both', label: t('settings.goalsSessions.targetMode.both') },
        ];
        targetModeOptions.forEach(option => {
            const opt = targetModeSelect.createEl('option', { text: option.label });
            opt.value = option.value;
        });
        targetModeSelect.value = defaultTargetMode;
        this.isolateSessionPanelControl(targetModeSelect);

        // Minutes and words share one row; each takes the full row when alone.
        const goalsRow = sprintSection.createDiv({ cls: 'ert-timeline-session-panel__goals' });
        const goalField = goalsRow.createDiv({ cls: 'ert-timeline-session-panel__goal-field' });
        goalField.createDiv({ cls: 'ert-timeline-session-panel__label', text: t('ui.timeLineView.minutesLabel') });
        goalInput = goalField.createEl('input', { cls: 'ert-input ert-input--xs ert-timeline-session-panel__number' });
        goalInput.type = 'number';
        goalInput.min = '1';
        goalInput.max = '600';
        goalInput.step = '1';
        goalInput.value = String(sessionGoalMinutes);
        this.isolateSessionPanelControl(goalInput);

        const wordGoalField = goalsRow.createDiv({ cls: 'ert-timeline-session-panel__goal-field' });
        wordGoalField.createDiv({ cls: 'ert-timeline-session-panel__label', text: t('settings.goalsSessions.targetMode.words') });
        wordGoalInput = wordGoalField.createEl('input', { cls: 'ert-input ert-input--sm ert-timeline-session-panel__number' });
        wordGoalInput.type = 'number';
        wordGoalInput.min = '1';
        wordGoalInput.max = '50000';
        wordGoalInput.step = '50';
        wordGoalInput.value = String(sessionGoalWords);
        this.isolateSessionPanelControl(wordGoalInput);

        // Countdown choice on the left, the panel's one action on the right.
        const beginRow = sprintSection.createDiv({ cls: 'ert-timeline-session-panel__begin-row' });
        const countdownLabel = beginRow.createEl('label', { cls: 'ert-timeline-session-panel__toggle-label' });
        countdownToggle = countdownLabel.createEl('input', { cls: 'ert-timeline-session-panel__toggle' });
        countdownToggle.type = 'checkbox';
        countdownToggle.checked = service.isCountdownSprintEnabled();
        countdownLabel.createSpan({ text: t('ui.timeLineView.countdownSprint') });
        this.isolateSessionPanelControl(countdownToggle);
        const beginButton = this.createSessionButton(beginRow, t('ui.timeLineView.beginSession'), 'ert-timeline-session-panel__begin', startSession);
        this.isolateSessionPanelControl(beginButton);

        const sessionSection = form.createDiv({ cls: 'ert-timeline-session-panel__section' });
        this.createSessionSectionTitle(sessionSection, 'pen-line', t('ui.timeLineView.sessionSection'));

        const modeRow = sessionSection.createDiv({ cls: 'ert-timeline-session-panel__row' });
        modeRow.createDiv({ cls: 'ert-timeline-session-panel__label', text: t('ui.timeLineView.modeLabel') });
        modeSelect = modeRow.createEl('select', { cls: 'ert-input ert-input--md ert-timeline-session-panel__select' });
        (['drafting', 'revising', 'editing', 'planning'] as const).forEach(mode => {
            const opt = modeSelect.createEl('option', { text: this.formatWritingSessionModeTitle(mode) });
            opt.value = mode;
        });
        modeSelect.value = defaultMode;
        this.isolateSessionPanelControl(modeSelect);
        this.sessionPanelScope.registerDomEvent(modeSelect, 'change', () => {
            const mode = (modeSelect.value as WritingSessionMode) || 'drafting';
            if (mode === 'drafting') {
                stageSelect.value = 'Zero';
            }
            updateIdleMeta();
            Promise.all([
                service.setDefaultMode(mode),
                mode === 'drafting' ? service.setDefaultStage('Zero') : Promise.resolve(),
            ]).catch(error => {
                new Notice(error instanceof Error ? error.message : t('ui.timeLineView.saveDefaultsFailed'));
            });
        });

        const stageRow = sessionSection.createDiv({ cls: 'ert-timeline-session-panel__row' });
        stageRow.createDiv({ cls: 'ert-timeline-session-panel__label', text: t('ui.timeLineView.stageLabel') });
        stageSelect = stageRow.createEl('select', { cls: 'ert-input ert-input--sm ert-timeline-session-panel__select' });
        const stageOptions: Array<{ value: WritingSessionStagePreference; label: string }> = [
            { value: 'auto', label: t('ui.timeLineView.stageAuto') },
            { value: 'Zero', label: 'Zero' },
            { value: 'Author', label: 'Author' },
            { value: 'House', label: 'House' },
            { value: 'Press', label: 'Press' },
            { value: 'Mixed', label: 'Mixed' },
        ];
        stageOptions.forEach(option => {
            const opt = stageSelect.createEl('option', { text: option.label });
            opt.value = option.value;
        });
        stageSelect.value = defaultStage;
        this.isolateSessionPanelControl(stageSelect);
        this.sessionPanelScope.registerDomEvent(stageSelect, 'change', () => {
            const stage = (stageSelect.value as WritingSessionStagePreference) || 'auto';
            updateIdleMeta();
            void service.setDefaultStage(stage).catch(error => {
                new Notice(error instanceof Error ? error.message : t('ui.timeLineView.saveStageFailed'));
            });
        });

        if (lampFriends.length > 0) {
            const lampSection = form.createDiv({ cls: 'ert-timeline-session-panel__section' });
            this.createSessionSectionTitle(lampSection, 'lamp-ceiling', t('ui.timeLineView.deskLamps'));
            const remembered = new Set(deskLamps.rememberedAudience());
            const allLabel = lampSection.createEl('label', { cls: 'ert-timeline-session-panel__toggle-label' });
            const allBox = allLabel.createEl('input', { cls: 'ert-timeline-session-panel__toggle' });
            allBox.type = 'checkbox';
            allLabel.createSpan({ text: t('ui.timeLineView.allLamps') });
            this.isolateSessionPanelControl(allBox);
            const lampList = lampSection.createDiv({ cls: 'ert-timeline-session-panel__lamp-list' });
            for (const friend of lampFriends) {
                const label = lampList.createEl('label', { cls: 'ert-timeline-session-panel__toggle-label' });
                const box = label.createEl('input', { cls: 'ert-timeline-session-panel__toggle' });
                box.type = 'checkbox';
                box.checked = remembered.has(friend.profile_id);
                label.createSpan({ text: friend.display_name });
                this.isolateSessionPanelControl(box);
                lampBoxes.push({ profileId: friend.profile_id, box });
            }
            const syncAllBox = () => {
                const ticked = lampBoxes.filter(entry => entry.box.checked).length;
                allBox.checked = ticked === lampBoxes.length;
                allBox.indeterminate = ticked > 0 && ticked < lampBoxes.length;
            };
            this.sessionPanelScope.registerDomEvent(allBox, 'change', () => {
                lampBoxes.forEach(entry => { entry.box.checked = allBox.checked; });
                syncAllBox();
            });
            lampBoxes.forEach(entry => this.sessionPanelScope.registerDomEvent(entry.box, 'change', syncAllBox));
            syncAllBox();
            lampSection.createDiv({ cls: 'ert-timeline-session-panel__lamp-note', text: DESK_LAMP_PANEL_NOTE });
        }

        updateIdleMeta = () => {
            const parsedMinutes = Number(goalInput.value);
            const parsedWords = Number(wordGoalInput.value);
            const meta = this.formatIdleWritingSessionMeta(
                Number.isFinite(parsedMinutes) && parsedMinutes > 0 ? Math.round(parsedMinutes) : sessionGoalMinutes,
                Number.isFinite(parsedWords) && parsedWords > 0 ? Math.round(parsedWords) : sessionGoalWords,
                (targetModeSelect.value as WritingSessionTargetMode) || 'time',
                (modeSelect.value as WritingSessionMode) || 'drafting',
                (stageSelect.value as WritingSessionStagePreference) || 'auto',
            );
            introTarget.setText(meta.target);
            introDetail.setText(meta.detail);
        };

        const syncTargetControls = () => {
            const targetMode = (targetModeSelect.value as WritingSessionTargetMode) || 'time';
            const usesTime = targetMode !== 'words';
            const usesWords = targetMode !== 'time';
            countdownLabel.classList.toggle('ert-hidden', !usesTime);
            goalField.classList.toggle('ert-hidden', !usesTime);
            wordGoalField.classList.toggle('ert-hidden', !usesWords);
            goalField.classList.toggle('is-countdown-disabled', usesTime && !countdownToggle.checked);
            intro.classList.toggle('is-countdown', usesTime && countdownToggle.checked);
            updateIdleMeta();
        };

        this.sessionPanelScope.registerDomEvent(targetModeSelect, 'change', () => {
            syncTargetControls();
            void service.setDefaultTargetMode((targetModeSelect.value as WritingSessionTargetMode) || 'time').catch(error => {
                new Notice(error instanceof Error ? error.message : t('ui.timeLineView.saveTargetFailed'));
            });
        });
        this.sessionPanelScope.registerDomEvent(goalInput, 'change', updateIdleMeta);
        this.sessionPanelScope.registerDomEvent(wordGoalInput, 'change', updateIdleMeta);

        countdownToggle.onchange = () => {
            syncTargetControls();
            void service.setCountdownSprint(countdownToggle.checked).catch(error => {
                new Notice(error instanceof Error ? error.message : t('ui.timeLineView.saveCountdownFailed'));
            });
        };
        syncTargetControls();
        this.sessionPanelScope.registerDomEvent(goalInput, 'keydown', (event: KeyboardEvent) => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            event.stopPropagation();
            void startSession();
        });
        this.sessionPanelScope.registerDomEvent(wordGoalInput, 'keydown', (event: KeyboardEvent) => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            event.stopPropagation();
            void startSession();
        });
    }

    private renderActiveWritingSessionPanel(panel: HTMLElement, active: ActiveWritingSession): void {
        const service = this.plugin.getWritingSessionService();
        const elapsedMs = service.getActiveElapsedMs();
        const statusDisplay = this.getSessionStatusDisplay(active, elapsedMs);
        const clockProgressStep = this.getActiveSessionProgressStep(active, elapsedMs);
        const clockText = statusDisplay.tone === 'complete'
            ? this.formatCompletedSessionSummary(active, elapsedMs)
            : this.getActiveWritingSessionPanelClockText(active, elapsedMs);
        panel.dataset.sessionRenderKey = this.getActiveWritingSessionPanelRenderKey(active, elapsedMs);

        const clock = panel.createDiv({ cls: `ert-timeline-session-panel__clock is-${statusDisplay.tone}` });
        this.applySessionProgressClass(clock, clockProgressStep);
        clock.createDiv({ cls: 'ert-timeline-session-panel__clock-value', text: clockText });
        // Live tracking stays one line: the clock is the whole story. Session
        // shape (mode/stage/book/targets) lives in the aria detail and the
        // start form, not repeated here.

        const actions = panel.createDiv({ cls: 'ert-timeline-session-panel__actions' });
        if (statusDisplay.tone === 'complete' && active.goalMinutes) {
            this.createSessionIconButton(actions, 'play', t('ui.timeLineView.continue'), 'ert-timeline-session-panel__primary ert-timeline-session-panel__icon-action', async () => {
                try {
                    await service.continueCountdown();
                    this.refreshWritingSessionControl();
                } catch (error) {
                    new Notice(error instanceof Error ? error.message : t('ui.timeLineView.continueFailed'));
                }
            });
        } else if (active.pausedAt) {
            this.createSessionIconButton(actions, 'play', t('ui.timeLineView.resume'), 'ert-timeline-session-panel__primary ert-timeline-session-panel__icon-action', async () => {
                try {
                    await service.resume();
                    this.refreshWritingSessionControl();
                } catch (error) {
                    new Notice(error instanceof Error ? error.message : t('ui.timeLineView.resumeFailed'));
                }
            });
        } else {
            this.createSessionIconButton(actions, 'pause', t('ui.timeLineView.pause'), 'ert-timeline-session-panel__secondary ert-timeline-session-panel__icon-action', async () => {
                try {
                    await service.pause();
                    this.refreshWritingSessionControl();
                } catch (error) {
                    new Notice(error instanceof Error ? error.message : t('ui.timeLineView.pauseFailed'));
                }
            });
        }
        this.createSessionIconButton(actions, 'save', t('common.save'), `ert-timeline-session-panel__primary ert-timeline-session-panel__icon-action${statusDisplay.tone === 'complete' ? ' is-save-ready' : ''}`, async () => {
            const sceneSuggestions = await service.collectTouchedSceneSuggestions(active).catch(() => []);
            const netWordDelta = await service.getActiveNetWordDelta(active).catch(() => undefined);
            const titleByPath = new Map<string, string>();
            for (const scene of this.sceneData) {
                if (scene.path && scene.title) titleByPath.set(scene.path, scene.title);
            }
            const sceneActivity = service.getTodaySceneActivity().map(entry => ({
                title: titleByPath.get(entry.path)
                    ?? entry.path.split('/').pop()?.replace(/\.md$/i, '') // SAFE: basename fallback when a scene title isn't loaded
                    ?? entry.path,
                activeMs: entry.activeMs,
                typedWords: entry.typedWords,
            }));
            const feedShare = {
                eligible: canPostSessionsToFeed(this.plugin),
                defaultOn: service.isPostSessionsToFeedEnabled(),
            };
            new WritingSessionCompletionModal(this.app, active, service.getActiveElapsedMs(), sceneSuggestions, {
                typedWords: active.typedWords,
                netWordDelta,
            }, sceneActivity, feedShare, async (completion) => {
                try {
                    const record = await service.stop(completion);
                    new Notice(t('ui.timeLineView.savedSession', { mode: this.formatWritingSessionMode(record.mode), clock: this.formatSessionClock(record.elapsedMs) }));
                    if (feedShare.eligible && completion.postToFeed !== undefined) {
                        // Remember the toggle for the next save, then post.
                        // Posting is best-effort: the session is already saved.
                        await service.setPostSessionsToFeed(completion.postToFeed);
                        if (completion.postToFeed) {
                            try {
                                await postSessionToCommunityFeed(this.plugin, projectSessionFeedPost(record));
                                new Notice(t('ui.timeLineView.postedToFeed'));
                            } catch (postError) {
                                new Notice(postError instanceof Error ? postError.message : t('ui.timeLineView.postFailed'));
                            }
                        }
                    }
                    this.refreshWritingSessionControl();
                } catch (error) {
                    new Notice(error instanceof Error ? error.message : t('ui.timeLineView.stopFailed'));
                }
            }).open();
        });
        this.createSessionIconButton(actions, 'trash-2', t('common.cancel'), 'ert-timeline-session-panel__ghost ert-timeline-session-panel__icon-action', async () => {
            try {
                await service.discard();
                new Notice(t('ui.timeLineView.cancelledSession'));
                this.refreshWritingSessionControl();
            } catch (error) {
                new Notice(error instanceof Error ? error.message : t('ui.timeLineView.cancelFailed'));
            }
        });

        // Desk Lamps: who sees this session, with a way to change it or turn
        // the lamp off mid-session.
        const lampLine = this.plugin.deskLamps.sessionLine();
        if (lampLine) {
            const lampRow = panel.createDiv({ cls: 'ert-timeline-session-panel__lamp-status' });
            const lampIcon = lampRow.createSpan({ cls: 'ert-timeline-session-panel__lamp-icon' });
            setIcon(lampIcon, 'lamp-ceiling');
            lampRow.createSpan({ text: lampLine });
            const lampEdit: HTMLButtonElement = this.createSessionIconButton(lampRow, 'pencil', t('ui.timeLineView.changeLampAudience'), 'ert-timeline-session-panel__ghost ert-timeline-session-panel__lamp-edit', () => {
                openSessionDeskLampMenu(lampEdit, this.plugin.deskLamps);
            });
        }
    }

    private getActiveWritingSessionPanelRenderKey(active: ActiveWritingSession, elapsedMs: number): string {
        const statusDisplay = this.getSessionStatusDisplay(active, elapsedMs);
        return [
            active.id,
            active.pausedAt ? (active.idleAuto ? 'idle' : 'paused') : 'running',
            statusDisplay.tone,
            active.targetMode ?? 'time',
            active.goalWords ?? 0,
            active.goalMinutes ? 'countdown' : 'elapsed',
            active.countdownSegmentStartElapsedMs ?? 0,
            active.mode,
            active.stage,
            active.bookTitle,
            this.plugin.deskLamps.sessionLine() ?? '', // SAFE: no Desk Lamps line is part of the render key as empty
        ].join('|');
    }

    private getActiveWritingSessionPanelClockText(active: ActiveWritingSession, elapsedMs: number): string {
        const goalMs = active.goalMinutes ? active.goalMinutes * 60000 : undefined;
        const countdownElapsedMs = this.getCountdownSegmentElapsedMs(active, elapsedMs);
        const remainingMs = goalMs ? Math.max(0, goalMs - countdownElapsedMs) : undefined;
        const statusDisplay = this.getSessionStatusDisplay(active, elapsedMs);
        if (statusDisplay.tone === 'complete') {
            return this.formatCompletedSessionSummary(active, elapsedMs);
        }
        // Word-goal sessions get one compact line ("0/400w 31m"): word progress
        // plus minutes remaining on a countdown, or minutes elapsed without one.
        if (this.sessionHasWordGoal(active)) {
            const typedWords = Math.max(0, Math.round(active.typedWords || 0));
            const goalWords = Math.max(1, Math.round(active.goalWords || 1));
            const minutes = remainingMs !== undefined
                ? Math.ceil(remainingMs / 60000)
                : Math.floor(elapsedMs / 60000);
            return t('ui.timeLineView.compactWordClock', { typed: typedWords, goal: goalWords, minutes });
        }
        return this.formatSessionClockHms(remainingMs ?? elapsedMs);
    }

    private syncActiveWritingSessionPanelClock(panel: HTMLElement, active: ActiveWritingSession): boolean {
        const service = this.plugin.getWritingSessionService();
        const elapsedMs = service.getActiveElapsedMs();
        const renderKey = this.getActiveWritingSessionPanelRenderKey(active, elapsedMs);
        if (panel.dataset.sessionRenderKey !== renderKey) return false;

        const clock = panel.querySelector<HTMLElement>('.ert-timeline-session-panel__clock');
        const clockValue = panel.querySelector<HTMLElement>('.ert-timeline-session-panel__clock-value');
        if (!clock || !clockValue) return false;

        const statusDisplay = this.getSessionStatusDisplay(active, elapsedMs);
        const clockProgressStep = this.getActiveSessionProgressStep(active, elapsedMs);
        clock.classList.toggle('is-running', statusDisplay.tone === 'running');
        clock.classList.toggle('is-paused', statusDisplay.tone === 'paused');
        clock.classList.toggle('is-complete', statusDisplay.tone === 'complete');
        this.applySessionProgressClass(clock, clockProgressStep);
        clockValue.setText(this.getActiveWritingSessionPanelClockText(active, elapsedMs));
        return true;
    }

    private syncOpenWritingSessionPanel(): void {
        const panel = this.writingSessionPanel;
        if (!panel || panel.classList.contains('ert-hidden')) return;

        const active = this.plugin.getWritingSessionService().getActiveSession();
        const previousPanelState = panel.dataset.sessionState;
        let didRender = false;
        if (active) {
            const didSyncClockOnly = previousPanelState === 'active' && this.syncActiveWritingSessionPanelClock(panel, active);
            if (!didSyncClockOnly) {
                this.renderWritingSessionPanel();
                didRender = true;
            }
        } else if (previousPanelState === 'active') {
            this.renderWritingSessionPanel();
            didRender = true;
        }

        if (didRender) this.positionWritingSessionPanel();
    }

    private getRenderedTimelineSvg(): SVGSVGElement | null {
        return this.containerEl.querySelector('.radial-timeline-svg');
    }

    private getSessionRingElapsedMs(elapsedMs: number, targetMinutes: number): number {
        const targetMs = Math.max(1, targetMinutes) * 60000;
        return Math.min(targetMs, Math.max(0, elapsedMs));
    }

    private getSessionRingRenderKey(active: ActiveWritingSession, elapsedMs: number, targetMinutes: number): string {
        const targetMs = Math.max(1, targetMinutes) * 60000;
        const clampedElapsedMs = Math.min(targetMs, Math.max(0, elapsedMs));
        const timeKey = this.sessionUsesWordRing(active)
            ? `typed-words-${Math.min(Math.round(active.goalWords || 0), Math.max(0, Math.round(active.typedWords || 0)))}`
            : `elapsed-second-${Math.floor(clampedElapsedMs / 1000)}`;
        return [
            active.id,
            timeKey,
            active.pausedAt ? 'paused' : 'running',
            active.targetMode ?? 'time',
            active.goalWords ?? 0,
            active.goalMinutes ? 'countdown' : 'elapsed',
            active.countdownSegmentStartElapsedMs ?? 0,
            targetMinutes,
            SESSION_TIMER_RING_WIDTH,
            SESSION_TIMER_RING_PROGRESS_RADIUS_OFFSET_ANCHOR,
            SESSION_TIMER_RING_PROGRESS_WIDTH_ANCHOR,
            SESSION_TIMER_RING_GAP,
        ].join('|');
    }

    private updateWritingSessionRing(
        svg: SVGSVGElement | null = this.getRenderedTimelineSvg(),
        options: { pulseColor?: string } = {}
    ): void {
        if (!svg) return;
        const lineInnerRadiusAttr = svg.getAttribute('data-line-inner-radius');
        const lineInnerRadius = lineInnerRadiusAttr ? Number(lineInnerRadiusAttr) : NaN;
        if (!Number.isFinite(lineInnerRadius)) return;

        const service = this.plugin.getWritingSessionService();
        const active = service.getActiveSession();
        const elapsedMs = active ? service.getActiveElapsedMs() : 0;
        const usesWordRing = active ? this.sessionUsesWordRing(active) : false;
        const targetMinutes = active?.goalMinutes ?? service.getDefaultGoalMinutes() ?? 120;
        const timerElapsedMs = active?.goalMinutes
            ? this.getCountdownSegmentElapsedMs(active, elapsedMs)
            : elapsedMs;
        const renderKey = active
            ? this.getSessionRingRenderKey(active, timerElapsedMs, targetMinutes)
            : [
                'inactive',
                targetMinutes,
                SESSION_TIMER_RING_WIDTH,
                SESSION_TIMER_RING_PROGRESS_RADIUS_OFFSET_ANCHOR,
                SESSION_TIMER_RING_PROGRESS_WIDTH_ANCHOR,
                SESSION_TIMER_RING_GAP,
            ].join('|');
        const hasRenderedRing = Boolean(svg.querySelector('.ert-timeline-session-ring-layer'));
        if (this.writingSessionRingRenderKey === renderKey && hasRenderedRing && !options.pulseColor) return;
        svg.querySelectorAll('.ert-timeline-session-ring-layer, .ert-timeline-session-ring').forEach(el => el.remove());
        const ringElapsedMs = this.getSessionRingElapsedMs(timerElapsedMs, targetMinutes);
        const commonStateParams = {
            progressRadius: lineInnerRadius + SESSION_TIMER_RING_PROGRESS_RADIUS_OFFSET_ANCHOR,
            progressRingWidth: SESSION_TIMER_RING_PROGRESS_WIDTH_ANCHOR,
            ringGap: SESSION_TIMER_RING_GAP,
            sessionRingWidth: SESSION_TIMER_RING_WIDTH,
            paused: !!active?.pausedAt,
        };
        const state = usesWordRing
            ? buildSessionTimerRingState({
                ...commonStateParams,
                progressValue: Math.max(0, Math.round(active?.typedWords || 0)),
                targetValue: Math.max(1, Math.round(active?.goalWords || 1)),
                countdown: false,
            })
            : buildSessionTimerRingState({
                ...commonStateParams,
                elapsedMs: ringElapsedMs,
                targetMinutes,
                countdown: Boolean(active?.goalMinutes),
            });
        const ringSvg = renderSessionTimerRingLayer(state);
        if (!ringSvg.trim()) return;

        const doc = new DOMParser().parseFromString(`<svg xmlns="http://www.w3.org/2000/svg">${ringSvg}</svg>`, 'image/svg+xml');
        const ringLayer = doc.documentElement.firstElementChild;
        const timelineRoot = svg.querySelector('#timeline-root');
        if (!ringLayer || !timelineRoot) return;
        const imported = svg.ownerDocument.importNode(ringLayer, true);
        imported.setAttribute('aria-hidden', 'true');
        if (options.pulseColor) {
            imported.classList.add('is-count-pulse');
            (imported as SVGElement).style.setProperty('--ert-session-pulse-color', options.pulseColor);
            if (this.writingSessionRingPulseTimeout !== undefined) {
                window.clearTimeout(this.writingSessionRingPulseTimeout);
            }
            this.writingSessionRingPulseTimeout = window.setTimeout(() => {
                imported.classList.remove('is-count-pulse');
                this.writingSessionRingPulseTimeout = undefined;
            }, 300);
        }
        const firstAnchor = this.resolveWritingSessionRingAnchor(timelineRoot);
        if (firstAnchor) {
            timelineRoot.insertBefore(imported, firstAnchor);
        } else {
            timelineRoot.appendChild(imported);
        }
        this.writingSessionRingRenderKey = renderKey;
    }

    private resolveWritingSessionRingAnchor(timelineRoot: Element): Element | null {
        const selectors = this.currentMode === 'gossamer'
            ? ['.rt-gossamer-layer', '.rt-scene-info']
            : ['.rt-scene-info'];
        for (const selector of selectors) {
            const candidate = timelineRoot.querySelector(selector);
            const directChild = this.findTimelineRootChild(timelineRoot, candidate);
            if (directChild) return directChild;
        }
        return null;
    }

    private findTimelineRootChild(timelineRoot: Element, candidate: Element | null): Element | null {
        let anchor = candidate;
        while (anchor && anchor.parentElement !== timelineRoot) {
            anchor = anchor.parentElement;
        }
        return anchor;
    }

    public focusTimelineSearchInput(): void {
        this.ensureBookSwitcher();
        if (!this.timelineSearchInput) return;
        this.timelineSearchInput.focus();
        this.timelineSearchInput.select();
    }

    public syncTimelineSearchControl(): void {
        this.searchPanel?.syncFromState();
        if (!this.timelineSearchInput || !this.timelineSearchButton) return;

        const search = this.plugin.searchState;
        // Progress must not replace the author's draft with a previous query.
        if (search.status === 'running' || search.status === 'error') {
            if (search.pendingTerm && (!this.timelineSearchInput.value || this.timelineSearchInput.value === search.term)) {
                this.timelineSearchInput.value = search.pendingTerm;
            }
            this.setTimelineSearchButtonMode(this.timelineSearchInput.value.trim() === search.pendingTerm ? 'clear' : 'search');
            return;
        }
        if (search.active && search.term) {
            this.timelineSearchInput.value = search.term;
            this.setTimelineSearchButtonMode('clear');
            return;
        }

        this.timelineSearchInput.value = '';
        this.setTimelineSearchButtonMode('search');
    }

    /**
     * Apply a scope-options change: persist it, then re-run any active search
     * so the results on screen always correspond to the options shown.
     */
    private async applySearchOptions(options: TimelineSearchOptions): Promise<void> {
        const search = this.plugin.searchState;
        if (searchOptionsSignature(search.options) === searchOptionsSignature(options)) return;

        search.options = { ...options };
        this.plugin.settings.timelineSearch = writeTimelineSearchSettings(search.options);
        const term = search.pendingTerm ?? search.term;
        if (term) {
            // Invalidate immediately, before asynchronous settings persistence.
            this.plugin.performSearch(term);
        } else {
            this.searchPanel?.syncFromState();
        }
        await this.plugin.saveSettings();
    }

    private setTimelineSearchButtonMode(mode: 'search' | 'clear'): void {
        if (!this.timelineSearchButton) return;
        this.timelineSearchButtonMode = mode;
        this.timelineSearchButton.empty();
        setIcon(this.timelineSearchButton, mode === 'clear' ? 'search-x' : 'search');
        const buttonLabel = mode === 'clear' ? t('timeline.search.clearAction') : t('timeline.search.searchAction');
        setAccessibleLabel(this.timelineSearchButton, buttonLabel);
        this.timelineSearchButton.classList.toggle('is-clear', mode === 'clear');
    }

    private handleTimelineSearchInput(): void {
        if (!this.timelineSearchInput) return;

        const search = this.plugin.searchState;
        const term = this.timelineSearchInput.value.trim();
        if (!term) {
            this.setTimelineSearchButtonMode('search');
            if (search.status !== 'idle' || search.active || search.term) {
                this.plugin.clearSearch();
            }
            return;
        }

        this.setTimelineSearchButtonMode(
            search.active && term === search.term ? 'clear' : 'search'
        );
    }

    private commitTimelineSearchFromInput(): void {
        if (!this.timelineSearchInput) return;

        const search = this.plugin.searchState;
        const term = this.timelineSearchInput.value.trim();
        if (!term) {
            if (search.status !== 'idle' || search.active || search.term) {
                this.plugin.clearSearch();
            } else {
                this.setTimelineSearchButtonMode('search');
            }
            return;
        }

        if (search.active && term === search.term && this.timelineSearchButtonMode === 'clear') {
            return;
        }

        this.plugin.performSearch(term);
        this.setTimelineSearchButtonMode('clear');
    }

    private clearTimelineSearchFromControl(): void {
        if (this.timelineSearchInput) {
            this.timelineSearchInput.value = '';
            this.timelineSearchInput.focus();
        }
        this.setTimelineSearchButtonMode('search');
        const search = this.plugin.searchState;
        if (search.status !== 'idle' || search.active || search.term) {
            this.plugin.clearSearch();
        }
    }

    private openRadialTimelineCommands(): void {
        if (!executeCommandById(this.app, 'command-palette:open')) {
            new Notice(t('ui.timeLineView.commandPaletteUnavailable'));
            return;
        }
        this.seedCommandPaletteQuery('Radial Timeline');
    }

    private seedCommandPaletteQuery(query: string, attempt = 0): void {
        const input = activeDocument.querySelector<HTMLInputElement>('.prompt-input');
        if (!input) {
            if (attempt < 8) {
                window.setTimeout(() => this.seedCommandPaletteQuery(query, attempt + 1), 25);
                return;
            }
            new Notice(t('ui.timeLineView.commandPaletteSearchMissing'));
            return;
        }

        input.value = query;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.focus();
        input.setSelectionRange(query.length, query.length);
    }

    private updateTimelineLegend(): void {
        if (!this.timelineLegendTrigger || !this.timelineLegendPanel) return;

        const mode = this.currentMode || 'narrative';
        const isSupportedMode = TIMELINE_LEGEND_MODES.has(mode);
        this.timelineLegendTrigger.hidden = !isSupportedMode;
        this.timelineLegendPanel.classList.toggle('is-disabled', !isSupportedMode);
        this.timelineLegendPanel.classList.toggle('is-visible', false);
        this.timelineLegendTrigger.setAttribute('aria-expanded', 'false');
        if (!isSupportedMode) return;

        renderLegendSurface(this.timelineLegendPanel, {
            title: t('ui.timeLineView.legendTitle'),
            badge: this.getTimelineLegendModeLabel(mode),
            sections: this.getTimelineLegendSections(mode),
        });
    }

    private getTimelineLegendModeLabel(mode: string): string {
        if (mode === 'progress') return t('timeline.modes.progress.name');
        if (mode === 'chronologue') return t('timeline.modes.chronologue.name');
        return t('timeline.modes.narrative.name');
    }

    private randomSceneNumber(): string {
        return String(1 + Math.floor(Math.random() * 99));
    }

    private getTimelineLegendSections(mode: string): LegendSection[] {
        const sections: LegendSection[] = [
            {
                title: t('ui.timeLineView.legendSceneActions'),
                rows: [
                    {
                        icon: 'square-mouse-pointer',
                        label: t('ui.timeLineView.legendHoverScene'),
                        detail: mode === 'chronologue'
                            ? t('ui.timeLineView.legendHoverChronologueDetail')
                            : t('ui.timeLineView.legendHoverDetail'),
                    },
                    { icon: 'mouse-pointer-click', label: t('ui.timeLineView.legendClickScene'), detail: t('ui.timeLineView.legendClickSceneDetail') },
                    { icon: 'mouse', label: t('ui.timeLineView.legendRightClickScene'), detail: t('ui.timeLineView.legendRightClickSceneDetail') },
                ],
            },
        ];

        if (mode === 'narrative') {
            sections.push({
                title: t('ui.timeLineView.legendNarrativeOnly'),
                rows: [
                    { icon: 'move-horizontal', label: t('ui.timeLineView.legendDragOuterRing'), detail: t('ui.timeLineView.legendDragOuterRingDetail') },
                    { icon: 'layers', label: t('ui.timeLineView.legendHoldShift'), detail: t('ui.timeLineView.legendHoldShiftDetail') },
                ],
            });
        }

        if (mode === 'chronologue') {
            sections.push({
                title: t('ui.timeLineView.legendChronologueOnly'),
                rows: [
                    { icon: 'arrow-left-right', label: t('ui.timeLineView.legendShiftCapsLock'), detail: t('ui.timeLineView.legendShiftCapsLockDetail') },
                    { icon: 'crosshair', label: t('ui.timeLineView.legendClickWhileComparing'), detail: t('ui.timeLineView.legendClickWhileComparingDetail') },
                    // Drawn in ring 1's color, the way the wheel draws a reference from a main-plot scene.
                    { timeReference: referenceMarkColor('var(--rt-subplot-colors-0)'), label: t('ui.timeLineView.legendTimeReference'), detail: t('ui.timeLineView.legendTimeReferenceDetail') },
                ],
            });
        }

        sections.push({
            title: t('ui.timeLineView.legendNumberSquareStates'),
            rows: [
                {
                    swatch: { fill: 'var(--rt-color-due)', stroke: 'var(--rt-color-due)', text: this.randomSceneNumber(), textColor: 'var(--rt-color-empty)' },
                    label: t('ui.timeLineView.legendMissingDate'),
                    detail: t('ui.timeLineView.legendMissingDateDetail'),
                },
                {
                    swatch: { fill: 'var(--interactive-accent)', text: this.randomSceneNumber(), textColor: 'var(--rt-color-empty)' },
                    label: t('ui.timeLineView.legendOpenInTab'),
                    detail: t('ui.timeLineView.legendOpenInTabDetail'),
                },
                {
                    swatch: { fill: 'var(--rt-color-search)', text: this.randomSceneNumber(), textColor: 'var(--rt-legacy-black)' },
                    label: t('ui.timeLineView.legendSearchMatch'),
                    detail: t('ui.timeLineView.legendSearchMatchDetail'),
                },
                {
                    swatch: { fill: 'var(--rt-color-muted-gray)', text: this.randomSceneNumber(), textColor: 'var(--rt-legacy-black)' },
                    label: t('ui.timeLineView.legendPendingEdits'),
                    detail: t('ui.timeLineView.legendPendingEditsDetail'),
                },
                {
                    swatch: { fill: 'var(--rt-color-empty)', text: this.randomSceneNumber(), textColor: 'var(--rt-grade-a-color)' },
                    label: t('ui.timeLineView.legendGradeA'),
                    detail: t('ui.timeLineView.legendGradeADetail'),
                },
                {
                    swatch: { fill: 'var(--rt-color-empty)', text: this.randomSceneNumber(), textColor: 'var(--rt-grade-b-color)' },
                    label: t('ui.timeLineView.legendGradeB'),
                    detail: t('ui.timeLineView.legendGradeBDetail'),
                },
                {
                    swatch: { fill: 'var(--rt-color-empty)', text: this.randomSceneNumber(), textColor: 'var(--rt-grade-c-color)' },
                    label: t('ui.timeLineView.legendGradeC'),
                    detail: t('ui.timeLineView.legendGradeCDetail'),
                },
            ],
        });

        sections.push({
            title: t('ui.timeLineView.legendSceneMarks'),
            rows: [
                { icon: 'message-circle-question', label: t('ui.timeLineView.legendOpenQuery'), detail: t('ui.timeLineView.legendOpenQueryDetail') },
            ],
        });

        // Act labels and scene clicks link to a Timetable only while one is open.
        if (hasOpenTimetable()) {
            sections.push({
                title: t('ui.timeLineView.legendWithTimetable'),
                rows: [
                    { icon: 'mouse-pointer-click', label: t('ui.timeLineView.legendClickSceneTimetable'), detail: t('ui.timeLineView.legendClickSceneTimetableDetail') },
                    { icon: 'table-2', label: t('ui.timeLineView.legendClickActLabel'), detail: t('ui.timeLineView.legendClickActLabelDetail') },
                ],
            });
        }

        sections.push({
            title: t('ui.timeLineView.legendRightClickMenu'),
            rows: [
                {
                    icon: 'circle-dot',
                    label: t('ui.timeLineView.legendSetStatus'),
                    // Status values are the author's YAML values, shown as written.
                    detail: 'Todo, Working, Complete',
                    detailIcon: 'calendar-check',
                    detailIconLabel: t('ui.timeLineView.legendCompleteUpdatesDue'),
                },
                { icon: 'component', label: t('ui.timeLineView.legendChangeStage'), detail: 'Zero, Author, House, Press', detailSegments: this.getStageLegendDetailSegments() },
                { icon: 'flag', label: t('ui.timeLineView.legendMisc'), detail: t('ui.timeLineView.legendFlagTripletPulse') },
            ],
        });

        return sections;
    }

    private getStageLegendDetailSegments(): LegendDetailSegment[] {
        const colors = this.plugin.settings.publishStageColors || {};
        return [
            { text: 'Zero', color: colors.Zero },
            { text: ', ' },
            { text: 'Author', color: colors.Author },
            { text: ', ' },
            { text: 'House', color: colors.House },
            { text: ', ' },
            { text: 'Press', color: colors.Press },
        ];
    }

    private updateBookSwitcherOptions(): void {
        if (!this.bookSwitcherSelect) return;
        const select = this.bookSwitcherSelect;
        while (select.firstChild) {
            select.removeChild(select.firstChild);
        }

        const books = this.plugin.settings.books || [];
        const sagaAvailable = isSagaScopeAvailable(this.plugin.settings);
        const doc = select.ownerDocument;
        if (sagaAvailable) {
            const sagaOption = doc.win.createEl('option');
            sagaOption.value = SAGA_SCOPE_OPTION;
            sagaOption.textContent = t('ui.timeLineView.sagaOption');
            select.appendChild(sagaOption);
        }

        books.forEach(book => {
            const option = doc.win.createEl('option');
            option.value = book.id;
            option.textContent = book.title?.trim() || DEFAULT_BOOK_TITLE;
            select.appendChild(option);
        });

        if (getTimelineScope(this.plugin.settings) === 'saga' && sagaAvailable) {
            select.value = SAGA_SCOPE_OPTION;
        } else if (books.length > 0) {
            select.value = this.plugin.settings.activeBookId || books[0].id;
        }

        select.toggleAttribute('disabled', books.length <= 1 && !sagaAvailable);
    }

    private updateViewTitle(): void {
        const titleText = this.getDisplayText();
        const headerTitle = this.containerEl.querySelector('.view-header-title');
        if (headerTitle) headerTitle.textContent = titleText;

        // The tab-header title lives in the tab bar, OUTSIDE this leaf's content
        // container, so a containerEl.querySelector never found it and the tab
        // stayed stale (e.g. "Untitled Manuscript" after a book is activated).
        // Ask Obsidian to re-read getDisplayText() the official way instead.
        (this.leaf as unknown as { updateHeader?: () => void }).updateHeader?.();
    }

    private scheduleBeatLabelAdjustment(delayMs = 0): void {
        if (this.beatLabelAdjustTimeout !== null) {
            window.clearTimeout(this.beatLabelAdjustTimeout);
            this.beatLabelAdjustTimeout = null;
        }
        if (this.beatLabelAdjustRaf !== null) {
            window.cancelAnimationFrame(this.beatLabelAdjustRaf);
            this.beatLabelAdjustRaf = null;
        }

        const run = () => {
            this.beatLabelAdjustTimeout = null;
            const timelineContainer = this.containerEl.querySelector<HTMLElement>('.radial-timeline-container');
            if (!timelineContainer) return;
            this.beatLabelAdjustRaf = window.requestAnimationFrame(() => {
                this.beatLabelAdjustRaf = null;
                this.rendererService?.adjustBeatLabelsAfterRender(timelineContainer);
            });
        };

        if (delayMs > 0) {
            this.beatLabelAdjustTimeout = window.setTimeout(run, delayMs);
            return;
        }

        run();
    }

    public syncBookHeader(): void {
        this.ensureBookSwitcher();
        this.updateViewTitle();
    }

    // --- Helpers for number-square orientation/position (shared across modes) ---
    public applyRotationToNumberSquares(svg: SVGSVGElement, rotated: boolean): void {
        const segmentCount = parseInt(svg.getAttribute('data-segment-count') || svg.getAttribute('data-num-acts') || '3', 10);
        const angle = segmentCount > 0 ? 360 / segmentCount : 120; // Dynamic counter-rotation based on active segment count
        const orients = svg.querySelectorAll<SVGGElement>('.number-square-orient');
        orients.forEach((el) => {
            const base = (el.getAttribute('transform') || '').replace(/\s*rotate\([^)]*\)/g, '').trim();
            if (rotated) {
                el.setAttribute('transform', `${base} rotate(${angle})`.trim());
            } else {
                if (base) el.setAttribute('transform', base); else el.removeAttribute('transform');
            }
        });
    }

    public getRotationState(): boolean { return this.rotationState; }
    public setRotationState(rotated: boolean): void { this.rotationState = rotated; }

    public getSquareGroupForSceneId(svg: SVGSVGElement, sceneId: string): SVGGElement | null {
        const rect = svg.querySelector(`.rt-number-square[data-scene-id="${sceneId}"]`);
        if (!rect) return null;
        const group = rect.closest<SVGGElement>('.number-square-group');
        return group;
    }

    public setNumberSquareGroupPosition(svg: SVGSVGElement, sceneId: string, x: number, y: number): void {
        const group = this.getSquareGroupForSceneId(svg, sceneId);
        if (group) {
            // Only translate on the outer group; orientation is handled by inner wrapper
            group.setAttribute('transform', `translate(${x}, ${y})`);
        }
    }

    // Add this method to handle search indicator clicks
    private setupSearchControls(): void {
        setupSearchControlsExt(this);
    }
    
    /**
     * Setup interactions based on the current mode
     */
    private setupInteractionsForMode(svg: SVGSVGElement): void {
        if (this.interactionController) {
            const modeDef = getModeDefinition(this.currentMode as TimelineMode);
            void this.interactionController.setupMode(modeDef, svg);
        }
    }
    
    updateOpenFilesTracking(): void {
        
        // Store the previous state to check if it changed
        const previousOpenFiles = new Set(this.openScenePaths);
        
        this.openScenePaths = new Set<string>();

        // Collect the paths of all open markdown files (including deferred/unactivated tabs)
        const leaves = this.app.workspace.getLeavesOfType('markdown');
        leaves.forEach(leaf => {
            const view = leaf.view;
            if (view instanceof MarkdownView && view.file) {
                this.openScenePaths.add(view.file.path);
            } else {
                // Deferred/unactivated tab — read path from view state
                try {
                    const state = leaf.getViewState();
                    const filePath = (state?.state as Record<string, unknown>)?.file;
                    if (typeof filePath === 'string' && filePath.length > 0) {
                        this.openScenePaths.add(filePath);
                    }
                } catch { /* ignore */ }
            }
        });

        // Also check if there's an active file not in a leaf
        const activeFile = this.app.workspace.getActiveFile();
        if (activeFile && !this.openScenePaths.has(activeFile.path)) {
            this.openScenePaths.add(activeFile.path);
        }
        
        
        // Check if the open files have changed
        let hasChanged = false;
        
        // Different size means something changed
        if (previousOpenFiles.size !== this.openScenePaths.size) {
            hasChanged = true;
        } else {
            // Check if any files were added or removed
            for (const path of previousOpenFiles) {
                if (!this.openScenePaths.has(path)) {
                    hasChanged = true;
                    break;
                }
            }
            if (!hasChanged) {
                for (const path of this.openScenePaths) {
                    if (!previousOpenFiles.has(path)) {
                        hasChanged = true;
                        break;
                    }
                }
            }
        }

        // Keep the plugin-level tracking in sync so rerenders know which scenes are open
        this.plugin.openScenePaths = new Set(this.openScenePaths);
        
        // Update the UI if something changed
        if (hasChanged) {
            const container = this.containerEl.children[1] as HTMLElement;
            // Try selective update first
            this.rendererService?.updateOpenClasses(container, this.openScenePaths);
        }
    }

    refreshTimeline() {
        if (!this.plugin) return;

        if (getTimelineScope(this.plugin.settings) === 'saga' && this.currentMode !== 'narrative') {
            this.currentMode = 'narrative';
            this.plugin.settings.currentMode = 'narrative';
        }

        const container = this.containerEl.children[1] as HTMLElement;
        
        // First update the tracking of open files
        this.updateOpenFilesTracking();
        
        // Get the scene data using the plugin's method
        this.plugin.getTimelineSceneData()
            .then(async (sceneData) => {
                // Same predicate search uses, so the two can never disagree
                // about what the timeline draws — a match must always have
                // somewhere to show itself.
                const timelineSceneData = sceneData.filter(item => isRenderedOnTimeline(item));

                // If in Gossamer mode, the change might be a score update. We must
                // rebuild the run data here to ensure the renderer gets the latest scores.
                if (this._currentMode === 'gossamer') {
                    const { syncGossamerPresentationState } = await import('../GossamerCommands');
                    await syncGossamerPresentationState(this.plugin, timelineSceneData);
                }
                
                this.sceneData = timelineSceneData;
                // Expose last scene data on plugin for selective services that need it
                this.plugin.lastSceneData = timelineSceneData;
                
                // Create snapshot of current state
                const currentSnapshot = createSnapshot(
                    timelineSceneData,
                    this.plugin.openScenePaths,
                    this.plugin.searchState,
                    this._currentMode,
                    this.plugin.settings,
                    this.plugin._gossamerLastRun,
                    this.narrativeState.runtime
                );
                
                // Detect changes from last render
                const changeResult = detectChanges(this.lastSnapshot, currentSnapshot);
                
                // Decide rendering strategy
                if (changeResult.updateStrategy === 'none') {
                    // No changes - skip render entirely
                    return;
                } else if (changeResult.updateStrategy === 'selective' && this.rendererService) {
                    // Selective update using RendererService
                    let updated = false;
                    
                    // Handle open files changes
                    if (changeResult.changeTypes.has(ChangeType.OPEN_FILES)) {
                        this.rendererService.updateOpenClasses(container, this.plugin.openScenePaths);
                        updated = true;
                    }
                    
                    // Handle search changes (highlight text + number square state)
                    if (changeResult.changeTypes.has(ChangeType.SEARCH)) {
                        this.rendererService.updateNumberSquaresDOM(container, this.plugin);
                        this.rendererService.updateSearchHighlights(container);
                        updated = true;
                    }
                    
                    // Handle time and progress target-date changes using selective update
                    if (changeResult.changeTypes.has(ChangeType.TIME) ||
                        changeResult.changeTypes.has(ChangeType.TARGET_DATES)) {
                        updated = this.rendererService.updateProgressAndTicks(container) || updated;
                    }
                    
                    // Handle synopsis text changes
                    if (changeResult.changeTypes.has(ChangeType.SYNOPSIS)) {
                        this.rendererService.updateSynopsisDOM(container, this.plugin);
                        updated = true;
                    }

                    // Handle dominant subplot changes (scene colors only)
                    if (changeResult.changeTypes.has(ChangeType.DOMINANT_SUBPLOT)) {
                        const scenes = this.sceneData || [];
                        updated = this.rendererService.updateSceneColorsDOM(container, this.plugin, scenes) || updated;
                    }

                    // Handle visual-only scene YAML changes (status, due, publish stage)
                    if (changeResult.changeTypes.has(ChangeType.SCENE_VISUAL)) {
                        const scenes = this.sceneData || [];
                        updated = this.rendererService.updateSceneFillsDOM(container, this.plugin, scenes) || updated;
                        updated = this.rendererService.updateCenterGridDOM(container, scenes) || updated;
                        updated = this.rendererService.updateProgressAndTicks(container) || updated;
                    }

                    // Handle gossamer changes
                    if (changeResult.changeTypes.has(ChangeType.GOSSAMER)) {
                        updated = this.rendererService.updateGossamerLayer(this) || updated;
                    }
                    
                    if (updated) {
                        // Selective update succeeded
                        this.lastSnapshot = currentSnapshot;
                        return;
                    }
                    
                    // Selective update failed - fall through to full render
                }
                
                // Full render
                const loadingEl = container.createDiv({
                    cls: "rt-loading-message",
                    text: t('timeline.loadingData')
                });
                
                // Clear container for full render
                container.empty();
                container.appendChild(loadingEl);
                
                // Render the timeline with the scene data
                this.renderTimeline(container, this.sceneData);

                // Remove loading message
                loadingEl.remove();
                
                // Update snapshot after successful render
                this.lastSnapshot = currentSnapshot;

                // Re-wire search controls and highlights now that DOM is current
                this.setupSearchControls();
                if (this.plugin.searchState.active) {
                    const containerEl = container;
                    if (this.rendererService) {
                         this.rendererService.updateSearchHighlights(containerEl);
                    }
                }

            })
            .catch(error => {
                container.createDiv({
                    cls: "rt-error-message",
                    text: t('ui.timeLineView.loadError', { message: error instanceof Error ? error.message : String(error) })
                });
                console.error("Failed to load timeline data", error);
            });
    }
    
    /**
     * Called whenever the view is shown/revealed (e.g., when switching tabs back to this view)
     * Unlike onOpen which is called only once when the view is created
     */
    onload(): void {
        // View is now loaded and visible
    }
    
    async onOpen(): Promise<void> {
        this.contentEl.addClass('radial-timeline-view');
        this.publishModeToTimetables();
        this.register(onTimelineOverlayChange(() => this.applyTimetableOverlays()));
        this.register(onTimetablePresenceChange(() => this.applyTimetableOverlays()));
        // A query added or answered in a scene note updates its dot.
        this.registerEvent(this.app.vault.on('modify', (file) => {
            if (file instanceof TFile && file.extension === 'md') this.scheduleQueryDots();
        }));
        this.register(() => {
            if (this.queryDotsTimer !== null) window.clearTimeout(this.queryDotsTimer);
        });
        this.syncBookHeader();
        await this.plugin.maybeShowReleaseNotesModal();
        
        // Note: Workspace events (file-open, layout-change, active-leaf-change, quick-preview)
        // are handled by FileTrackingService at the plugin level to avoid duplicate handlers.
        // The service calls refreshTimeline() on all views when open files change.
        this.registerEvent(this.app.workspace.on('active-leaf-change', () => {
            if (this.app.workspace.getActiveViewOfType(RadialTimelineView) !== this) return;
            this.scheduleBeatLabelAdjustment(50);
        }));

        // Frontmatter values to track changes only to YAML frontmatter with debounce every 1 second.
        this.registerEvent(
            this.app.metadataCache.on('changed', (file) => {
                // Skip if not a markdown file
                if (!(file instanceof TFile) || file.extension !== 'md') return;
                
                // Get the current frontmatter
                const cache = this.app.metadataCache.getFileCache(file);
                if (!cache || !cache.frontmatter) return;
                
                // Check if this is a scene, beat/plot, or backdrop file.
                const fm = cache.frontmatter;
                const isScene = (fm.Class === 'Scene') || (fm.class === 'Scene');
                const isBeatOrPlot = (fm.Class === 'Plot') || (fm.class === 'Plot') || (fm.Class === 'Beat') || (fm.class === 'Beat');
                const isBackdrop = (fm.Class === 'Backdrop') || (fm.class === 'Backdrop');

                if (!isScene && !isBeatOrPlot && !isBackdrop) return;

                // Scene, Beat/Plot, and Backdrop frontmatter can affect timeline render
                // and hover content in multiple modes. Always refresh on those YAML
                // changes so note values remain the source of truth over cached DOM.
                
                // Check if this is a frontmatter change
                const fileId = file.path;
                const currentFrontmatter = JSON.stringify(cache.frontmatter);
                const previousFrontmatter = this.lastFrontmatterValues[fileId];
                
                // Update our stored value regardless
                this.lastFrontmatterValues[fileId] = currentFrontmatter;
                
                // If values are the same, no need to trigger refresh
                if (previousFrontmatter === currentFrontmatter) return;
                
                // Debounce frontmatter-triggered refreshes using the internal timeline delay.
                if (this.timelineRefreshTimeout) window.clearTimeout(this.timelineRefreshTimeout);
                this.timelineRefreshTimeout = window.setTimeout(() => {
                    this.refreshTimeline();
                }, TIMELINE_REFRESH_DELAY_MS);
            })
        );
        
        if (getTimelineScope(this.plugin.settings) === 'saga' && this._currentMode !== 'narrative') {
            this._currentMode = 'narrative';
            this.plugin.settings.currentMode = 'narrative';
            try { await this.plugin.saveSettings(); } catch { /* best effort */ }
        }

        // If starting in Gossamer mode, initialize it before the first render
        if (this._currentMode === 'gossamer') {
            const { TimelineMode } = await import('../modes/ModeDefinition');
            const { getModeDefinition } = await import('../modes/ModeRegistry');
            const gossamerDef = getModeDefinition(TimelineMode.GOSSAMER);
            
            // Run the onEnter hook to build gossamer data
            if (gossamerDef.onEnter) {
                try {
                    await gossamerDef.onEnter(this);
                } catch (e) {
                    console.error('[Gossamer] Failed to initialize on load:', e);
                    // Fallback to narrative mode if initialization fails
                    this._currentMode = 'narrative';
                    this.plugin.settings.currentMode = 'narrative';
                    try { await this.plugin.saveSettings(); } catch { /* best effort */ }
                    new Notice(t('ui.timeLineView.gossamerLoadFailed'), 6000);
                }
            }
        }
        
        // Initial timeline render
        this.refreshTimeline();
    }
    
    async onClose(): Promise<void> {
        // Search state is global, but closing one timeline must not wipe the
        // search another open timeline is still showing — the surviving view
        // would keep its highlighted squares and its term in the box while the
        // state behind them said "no search", until something unrelated forced
        // a re-render. Only the last timeline to close clears it.
        //
        // Compared by identity rather than counting, because the closing leaf
        // is still enumerated by getTimelineViews() at this point.
        //
        // Going through the service is what invalidates the in-flight run
        // token; resetting the state object directly would let a search still
        // in flight commit into the state we just cleared.
        const otherTimelineViews = this.plugin.getTimelineViews().filter(view => view !== this);
        if (otherTimelineViews.length === 0) {
            this.plugin.abandonSearch();
        }
        
        // Clean up chronologue shift mode buttons (keyboard listeners auto-cleanup via view.register())
        if (this._chronologueShiftCleanup) {
            this._chronologueShiftCleanup();
        }
        if (this._subplotKeyCleanup) {
            this._subplotKeyCleanup();
            this._subplotKeyCleanup = undefined;
        }
        if (this.timelineRefreshTimeout !== null) {
            window.clearTimeout(this.timelineRefreshTimeout);
            this.timelineRefreshTimeout = null;
        }
        if (this.writingSessionPulseTimeout !== undefined) {
            window.clearTimeout(this.writingSessionPulseTimeout);
            this.writingSessionPulseTimeout = undefined;
        }
        if (this.writingSessionRingPulseTimeout !== undefined) {
            window.clearTimeout(this.writingSessionRingPulseTimeout);
            this.writingSessionRingPulseTimeout = undefined;
        }
        if (this.beatLabelAdjustTimeout !== null) {
            window.clearTimeout(this.beatLabelAdjustTimeout);
            this.beatLabelAdjustTimeout = null;
        }
        if (this.beatLabelAdjustRaf !== null) {
            window.cancelAnimationFrame(this.beatLabelAdjustRaf);
            this.beatLabelAdjustRaf = null;
        }
        if (this.tabTimerIconActive) {
            const iconEl = (this.leaf as unknown as { tabHeaderInnerIconEl?: HTMLElement }).tabHeaderInnerIconEl;
            if (iconEl) setIcon(iconEl, 'rt-logo');
            this.tabTimerIconActive = false;
        }
        // Note: ModeToggleController keyboard listeners are cleaned up automatically via view.register()
    }
    
    renderTimeline(container: HTMLElement, scenes: TimelineItem[]): void {
        // Clear existing content (including the subplot key's document listeners;
        // its DOM lives in the container being emptied)
        if (this._subplotKeyCleanup) {
            this._subplotKeyCleanup();
            this._subplotKeyCleanup = undefined;
        }
        this.resetRenderScope();
        container.empty();
        
        // Check if there are any actual scenes (not just backdrops or beats)
        // The user wants to see the Welcome Screen until they have at least one Scene note.
        const hasScenes = scenes && scenes.some(item => item.itemType === 'Scene');
        
        if (!scenes || scenes.length === 0 || !hasScenes) {
            renderWelcomeScreen({
                container,
                plugin: this.plugin,
                refreshTimeline: () => this.refreshTimeline()
            });
            return;
        }
        
        this.sceneData = scenes;

        // Performance optimization: Create DocumentFragment to minimize reflows
        const doc = container.ownerDocument;
        const fragment = doc.win.createFragment();
        const timelineContainer = doc.win.createDiv();
        timelineContainer.className = "radial-timeline-container";
        fragment.appendChild(timelineContainer);
        
        try {
            // Generate the SVG content and get the max stage color
            const renderer = this.rendererService ?? this.plugin.getRendererService();
            const { svgString, maxStageColor: calculatedMaxStageColor } = renderer.renderTimeline(scenes, { runtime: this.narrativeState.runtime, alien: this.chronologueState.alien });

            // Expose the dominant publish-stage colour to CSS so rules can use var(--rt-max-publish-stage-color)
            if (calculatedMaxStageColor) {
                doc.documentElement.style.setProperty('--rt-max-publish-stage-color', calculatedMaxStageColor);
            }
            
            // Render directly into the container
            const svgElement = renderSvgFromString(svgString, timelineContainer);

                if (svgElement) {
                    // Set data-mode attribute for CSS targeting
                    svgElement.setAttribute('data-mode', this.currentMode);
                    
                    // Preserve shift mode state across re-renders (chronologue mode only)
                    if (this.currentMode === 'chronologue' && this.chronologueState.shift) {
                        svgElement.setAttribute('data-shift-mode', 'active');
                    }
                    
                    // Set data-chronologue-mode for CSS targeting (hides rotation toggle, etc.)
                    if (this.currentMode === 'chronologue') {
                        svgElement.setAttribute('data-chronologue-mode', 'true');
                    } else {
                        svgElement.removeAttribute('data-chronologue-mode');
                    }
                    try {
                        this.updateWritingSessionRing(svgElement);
                    } catch (error) {
                        console.warn('[WritingSession] Failed to render session ring overlay.', error);
                    }
                    
                    // If Gossamer mode is active, reuse hover-state styling: mute everything except Beat notes
                    if (this.currentMode === 'gossamer') {
                    svgElement.setAttribute('data-gossamer-mode', 'true');
                    // Apply the same logic as scene hover: add rt-non-selected to all elements except Beat notes
                    const allElements = svgElement.querySelectorAll('.rt-scene-path, .rt-number-square, .rt-number-text, .rt-scene-title');
                    allElements.forEach(el => {
                        const group = el.closest('.rt-scene-group');
                        const itemType = group?.getAttribute('data-item-type');
                        // Treat story beats like "selected" items - they stay unmuted
                        if (itemType !== 'Beat') {
                            el.classList.add('rt-non-selected');
                        }
                    });
                    } else {
                        svgElement.removeAttribute('data-gossamer-mode');
                    }

                    // Setup interactions based on current mode
                    this.setupInteractionsForMode(svgElement);
                // Set CSS variables for subplot labels based on data attributes
                const subplotLabelGroups = svgElement.querySelectorAll('.subplot-label-group[data-font-size]');
                subplotLabelGroups.forEach((group) => {
                    const fontSize = group.getAttribute('data-font-size');
                    if (fontSize) {
                        (group as SVGElement).style.setProperty('--rt-subplot-font-size', `${fontSize}px`);
                    }
                });
                
                // Attach rotation toggle behavior (inline SVG scripts won't run here)
                setupRotationController(this, svgElement);

                // Attach mode toggle behavior
                setupModeToggleController(this, svgElement);

                // Attach version indicator click behavior
                setupVersionIndicatorController(this, svgElement);

                // Attach help icon click behavior
                setupHelpIconController(this, svgElement);

                // Attach subplot ring key overlay (hover trigger / pin / hold Shift)
                setupSubplotKeyController(this, svgElement, timelineContainer);

                // Timetable: act labels show their part of the table; a Timetable lens or coloring lies over the scenes.
                linkActLabelsToTimetable(this, svgElement);
                this.applyTimetableOverlays(svgElement, timelineContainer);
                // Open author queries: a dot on each scene's number square.
                this.scheduleQueryDots(0);

                // Hold Shift (Narrative): beat labels show their In This Book names
                setupBeatNameKeyController(this, timelineContainer);

                // Attach Author Progress Indicator click behavior - opens Settings Social tab
                const aprIndicator = svgElement.querySelector('.rt-apr-indicator');
                if (aprIndicator) {
                    this.renderScope.registerDomEvent(aprIndicator as unknown as HTMLElement, 'click', () => {
                        // Open settings and switch to Social tab
                        if (this.plugin.settingsTab) {
                            this.plugin.settingsTab.setActiveTab('social');
                        }
                        openSettingsTab(this.app);
                    });
                }

                // Attach Progress Milestone Indicator click behavior - opens Settings Core tab (where progress preview lives)
                const milestoneIndicator = svgElement.querySelector('.rt-milestone-indicator');
                if (milestoneIndicator) {
                    this.renderScope.registerDomEvent(milestoneIndicator as unknown as HTMLElement, 'click', () => {
                        // Open settings and switch to Core tab (where the progress preview lives)
                        if (this.plugin.settingsTab) {
                            this.plugin.settingsTab.forceExpandCoreCompletionPreview();
                            this.plugin.settingsTab.setActiveTab('core');
                        }
                        openSettingsTab(this.app);
                    });
                }

                // Performance optimization: Use batch operations where possible
                const allSynopses = Array.from(svgElement.querySelectorAll(".rt-scene-info"));
                const sceneGroups = Array.from(svgElement.querySelectorAll(".rt-scene-group"));
                
                // Track RAF IDs for cleanup
                const sceneGroupRafIds: number[] = [];
                
                // Performance optimization: Process scene groups in chunks to avoid UI blocking
                const CHUNK_SIZE = 20;
                const processSceneGroups = (startIdx: number) => {
                    const endIdx = Math.min(startIdx + CHUNK_SIZE, sceneGroups.length);
                    
                    for (let i = startIdx; i < endIdx; i++) {
                        const group = sceneGroups[i];
                    const encodedPath = group.getAttribute("data-path");
                        
                    if (encodedPath && encodedPath !== "") {
                        const filePath = decodeURIComponent(encodedPath);
                        
                        // Check if this file is currently open in a tab
                        if (this.openScenePaths.has(filePath)) {
                            // Add a class to indicate this scene is open
                            group.classList.add("rt-scene-is-open");
                            
                            // Mark the scene path element
                            const scenePath = group.querySelector(".rt-scene-path");
                            if (scenePath) {
                                scenePath.classList.add("rt-scene-is-open");
                            }
                            
                            // Mark the scene title text if present
                            const sceneTitle = group.querySelector(".rt-scene-title");
                            if (sceneTitle) {
                                sceneTitle.classList.add("rt-scene-is-open");
                            }
                            
                                // Get scene ID from path element
                                const sceneId = scenePath?.id;
                                if (sceneId) {
                                    // Mark the number elements
                                    const numberSquare = svgElement.querySelector(`.rt-number-square[data-scene-id="${sceneId}"]`);
                            if (numberSquare) {
                                numberSquare.classList.add("rt-scene-is-open");
                            }
                            
                                    const numberText = svgElement.querySelector(`.rt-number-text[data-scene-id="${sceneId}"]`);
                            if (numberText) {
                                numberText.classList.add("rt-scene-is-open");
                                    }
                                }
                            }
                        }
                    }
                    
                    // Process next chunk if there are more scene groups
                    if (endIdx < sceneGroups.length) {
                        const rafId = window.requestAnimationFrame(() => processSceneGroups(endIdx));
                        sceneGroupRafIds.push(rafId);
                    }
                };
                
                // Register cleanup for RAF IDs
                this.renderScope.register(() => {
                    sceneGroupRafIds.forEach(id => cancelAnimationFrame(id));
                });
                
                // Start processing scene groups in chunks
                processSceneGroups(0);
                
                // All synopses default to the CSS-defined hidden state (opacity 0, pointer-events none)
                allSynopses.forEach(synopsis => {
                    synopsis.classList.remove('rt-visible');
                });
                
        // Setup search controls after SVG is rendered
        this.setupSearchControls();

                // --- START: Add hover effect for scene paths to fade subplot labels ---
                // Reuse the existing sceneGroups variable declared earlier
                // const sceneGroups = svgElement.querySelectorAll('.scene-group'); // REMOVE this redeclaration
                const subplotLabels = svgElement.querySelectorAll<SVGTextElement>('.rt-subplot-ring-label-text'); // Use type assertion for arching ring labels

                if (subplotLabels.length > 0) {
                    const onEnterLeave = (hovering: boolean, targetGroup: Element | null) => {
                        if (!targetGroup) return;
                        subplotLabels.forEach(label => {
                            if (hovering) label.classList.add('rt-non-selected'); else label.classList.remove('rt-non-selected');
                        });
                    };
                    const svg = container.querySelector('.radial-timeline-svg') as SVGSVGElement;
                    if (svg) {
                        let lastHoverGroup: Element | null = null;
                        this.renderScope.registerDomEvent(svg as unknown as HTMLElement, 'pointerover', (e: PointerEvent) => {
                            const g = (e.target as Element).closest('.rt-scene-group');
                            if (g && g !== lastHoverGroup) {
                                onEnterLeave(true, g);
                                lastHoverGroup = g;
                            }
                        });
                        this.renderScope.registerDomEvent(svg as unknown as HTMLElement, 'pointerout', (e: PointerEvent) => {
                            const g = (e.target as Element).closest('.rt-scene-group');
                            if (g && g === lastHoverGroup) {
                                onEnterLeave(false, g);
                                lastHoverGroup = null;
                            }
                        });
                    }
                }
                // --- END: Add hover effect for scene paths ---

                // Delegated hover will be bound after we append the fragment
            }
                
            // Add the fragment to the container
            container.appendChild(fragment);
            const svgForRecentMoves = timelineContainer.querySelector<SVGSVGElement>('.radial-timeline-svg');
            if (svgForRecentMoves) {
                this.renderRecentMovesPanel(svgForRecentMoves);
                this.renderGossamerRunsPanel(svgForRecentMoves);
            }
            this.scheduleBeatLabelAdjustment();
            
            // Attach Obsidian bubble tooltips to grid headers and buttons
            // Must be done after fragment is in DOM for getBoundingClientRect to work
            const svgForTooltips = container.querySelector('.radial-timeline-svg');
            if (svgForTooltips) {
                setupTooltips(svgForTooltips as SVGElement, this.registerDomEvent.bind(this));
            }
            
            // ============================================================================
            // MODE-SPECIFIC INTERACTIONS
            // ============================================================================
            // Scene hover interactions are now handled by mode-specific files using
            // SceneInteractionManager. The legacy 400-line closure has been removed.
            //
            // See: src/view/interactions/SceneInteractionManager.ts
            // See: src/view/modes/AllScenesMode.ts
            // See: src/view/modes/ChronologueMode.ts
            // ============================================================================
            
            // Set up Gossamer event listeners AFTER everything is rendered
            if (this.currentMode === 'gossamer') {
                const svg = container.querySelector('.radial-timeline-svg') as SVGSVGElement;
                if (svg) {
                    // Use DOUBLE requestAnimationFrame to ensure DOM is fully painted
                    let gossamerOuterRafId: number | null = null;
                    let gossamerInnerRafId: number | null = null;
                    gossamerOuterRafId = window.requestAnimationFrame(() => {
                        gossamerInnerRafId = window.requestAnimationFrame(() => {
                            this.setupGossamerEventListeners(svg);
                            gossamerOuterRafId = null;
                            gossamerInnerRafId = null;
                        });
                    });
                    
                    // Register cleanup for gossamer RAF IDs
                    this.renderScope.register(() => {
                        if (gossamerOuterRafId !== null) cancelAnimationFrame(gossamerOuterRafId);
                        if (gossamerInnerRafId !== null) cancelAnimationFrame(gossamerInnerRafId);
                    });
                }
            }
            
        } catch (error) {
            console.error("Error rendering timeline:", error);
            container.createDiv({
                text: t('timeline.renderError')
            });
        }
    }

    private renderRecentMovesPanel(svg: SVGSVGElement): void {
        if (this.currentMode !== 'narrative') return;
        if (this.plugin.settings.showRecentMovesOverlay === false) return;

        const entries = getActiveRecentStructuralMoves(this.plugin.settings).slice(0, 10);
        if (entries.length === 0) return;

        const xhtmlNs = 'http://www.w3.org/1999/xhtml';
        const svgNs = 'http://www.w3.org/2000/svg';
        const viewBoxMin = -(SVG_SIZE / 2);
        const panelX = viewBoxMin;
        const panelY = viewBoxMin + 24;
        const panelWidth = 520;
        const rowHeight = 52;
        const panelHeight = 28 + (entries.length * rowHeight);

        const doc = svg.ownerDocument;
        const foreignObject = doc.createElementNS(svgNs, 'foreignObject');
        foreignObject.setAttribute('x', String(panelX));
        foreignObject.setAttribute('y', String(panelY));
        foreignObject.setAttribute('width', String(panelWidth));
        foreignObject.setAttribute('height', String(panelHeight));
        foreignObject.setAttribute('class', 'ert-recent-moves-fo');
        foreignObject.classList.add('ert-pointer-events-none');

        const panel = doc.createElementNS(xhtmlNs, 'section');
        panel.className = 'ert-recent-moves';
        panel.style.setProperty('--rt-recent-moves-fade-center-x', `${-panelX}px`);
        panel.style.setProperty('--rt-recent-moves-fade-center-y', `${-panelY}px`);
        panel.style.setProperty('--rt-recent-moves-fade-radius', `${MONTH_LABEL_RADIUS}px`);
        panel.setCssProps({ '--rt-recent-moves-fade-width': '110px' });

        const header = doc.createElementNS(xhtmlNs, 'div');
        header.className = 'ert-recent-moves__header';
        header.textContent = t('ui.timeLineView.recentMoves');
        panel.appendChild(header);

        const list = doc.createElementNS(xhtmlNs, 'div');
        list.className = 'ert-recent-moves__list';
        panel.appendChild(list);

        entries.forEach((entry) => {
            list.appendChild(this.buildRecentMoveRow(entry));
        });

        foreignObject.appendChild(panel);
        svg.appendChild(foreignObject);
    }

    /**
     * Refresh the Gossamer cache-window pill in the runs header. Reads the
     * plugin's live window and shows a MM:SS countdown while it is open;
     * hides the pill (and stops its own tick) once it closes.
     */
    private updateGossamerCachePill(): void {
        const pill = this.gossamerCachePillEl;
        if (!pill || !pill.isConnected) {
            if (this.gossamerCacheTickInterval !== undefined) {
                window.clearInterval(this.gossamerCacheTickInterval);
                this.gossamerCacheTickInterval = undefined;
            }
            return;
        }
        const window_ = resolveGossamerCacheWindow(this.plugin.gossamerCacheWindows, getGossamerCacheContext(this.plugin.settings), Date.now());
        const clock = formatGossamerCacheClock(window_, Date.now());
        if (!clock || !window_) {
            pill.setAttribute('data-state', 'idle');
            pill.textContent = '';
            pill.removeAttribute('data-tooltip-text');
            return;
        }
        pill.setAttribute('data-state', 'open');
        pill.textContent = t('ui.timeLineView.recentCache', { clock });
        // Re-bind whenever the text changes: each signal run (or reused
        // result) replaces the window and its last-run cost.
        const costHint = formatGossamerCacheCostHint(window_);
        const baseTip = t('ui.timeLineView.cacheTooltip', { provider: window_.provider });
        const tip = costHint ? `${baseTip} (${costHint})` : baseTip;
        if (pill.getAttribute('data-tooltip-text') !== tip) {
            applyTooltip(pill, tip, 'bottom');
            pill.setAttribute('data-tooltip-text', tip);
        }
    }

    private renderGossamerRunsPanel(svg: SVGSVGElement): void {
        if (this.currentMode !== 'gossamer') return;

        const runs = this.plugin.gossamerRunInventory || [];
        const activeSignal: GossamerSignalType = this.plugin.gossamerSelectedSignal ?? 'momentum';

        const xhtmlNs = 'http://www.w3.org/1999/xhtml';
        const svgNs = 'http://www.w3.org/2000/svg';
        const viewBoxMin = -(SVG_SIZE / 2);
        const panelX = viewBoxMin;
        const panelY = viewBoxMin + 24;
        const panelWidth = 520;
        const displayedRuns = runs.slice().reverse().slice(0, 30);
        const dividerHeight = displayedRuns.length > 1 ? 9 : 0;
        const listHeight = 8 + (displayedRuns.length * 30) + dividerHeight;
        // Header row remains ~44px; even with zero runs we still show the signal selector + pill.
        const panelHeight = 44 + (runs.length === 0 ? 0 : listHeight);

        const doc = svg.ownerDocument;
        const foreignObject = doc.createElementNS(svgNs, 'foreignObject');
        foreignObject.setAttribute('x', String(panelX));
        foreignObject.setAttribute('y', String(panelY));
        foreignObject.setAttribute('width', String(panelWidth));
        foreignObject.setAttribute('height', String(panelHeight));
        foreignObject.setAttribute('class', 'rt-gossamer-runs-fo');
        foreignObject.classList.add('ert-pointer-events-none');

        const panel = doc.createElementNS(xhtmlNs, 'section');
        panel.className = 'rt-gossamer-runs';
        panel.style.setProperty('--rt-gossamer-runs-fade-center-x', `${-panelX}px`);
        panel.style.setProperty('--rt-gossamer-runs-fade-center-y', `${-panelY}px`);
        panel.style.setProperty('--rt-gossamer-runs-fade-radius', `${MONTH_LABEL_RADIUS}px`);
        panel.setCssProps({ '--rt-gossamer-runs-fade-width': '110px' });

        const controlsRow = doc.createElementNS(xhtmlNs, 'div');
        controlsRow.className = 'rt-gossamer-runs__controls';

        // Pill: two states only — "LATEST" (latest only) or "{n} TRACES" (everything else).
        const button = doc.createElementNS(xhtmlNs, 'div') as HTMLDivElement;
        button.className = 'rt-gossamer-runs__button';
        button.setAttribute('role', 'button');
        button.setAttribute('tabindex', '0');
        button.setAttribute('data-state', this.plugin.gossamerLatestOnly ? 'latest' : 'all');
        applyTooltip(
            button,
            this.plugin.gossamerLatestOnly ? t('ui.timeLineView.showAllTraces') : t('ui.timeLineView.showLatestOnly'),
            'bottom'
        );
        const buttonLabel = doc.createElementNS(xhtmlNs, 'span');
        if (runs.length === 0) {
            buttonLabel.textContent = t('ui.timeLineView.tracesCount', { count: 0 });
        } else if (this.plugin.gossamerLatestOnly) {
            buttonLabel.textContent = t('ui.timeLineView.latest');
        } else {
            buttonLabel.textContent = t('ui.timeLineView.tracesCount', { count: runs.length });
        }
        button.appendChild(buttonLabel);
        controlsRow.appendChild(button);

        // Signal selector — 4 lucide icons, one per signal.
        const signalSelector = doc.createElementNS(xhtmlNs, 'div') as HTMLDivElement;
        signalSelector.className = 'rt-gossamer-runs__signals';
        signalSelector.setAttribute('role', 'tablist');
        const signalButtons: Array<{ el: HTMLDivElement; signal: GossamerSignalType }> = [];
        GOSSAMER_SIGNAL_TYPES.forEach((signalId) => {
            const meta = GOSSAMER_SIGNAL_METADATA[signalId];
            const btn = doc.createElementNS(xhtmlNs, 'div') as HTMLDivElement;
            btn.className = 'rt-gossamer-runs__signal';
            btn.setAttribute('role', 'tab');
            btn.setAttribute('tabindex', '0');
            btn.setAttribute('aria-selected', signalId === activeSignal ? 'true' : 'false');
            btn.setAttribute('data-signal', signalId);
            if (signalId === activeSignal) btn.classList.add('is-active');
            if (meta.inlineIconPath) {
                // Custom Lucide override. Intentionally DOES NOT carry the
                // `svg-icon` or `lucide-<name>` classes — those opt into
                // Obsidian's global icon styling (and potential re-renders).
                // Our own class alone is enough for our CSS to size it.
                const svgNs2 = 'http://www.w3.org/2000/svg';
                const iconSvg = doc.createElementNS(svgNs2, 'svg');
                iconSvg.setAttribute('viewBox', '0 0 24 24');
                iconSvg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
                iconSvg.setAttribute('class', 'rt-gossamer-runs__signal-icon');
                iconSvg.setAttribute('width', '28');
                iconSvg.setAttribute('height', '28');
                iconSvg.setAttribute('fill', 'none');
                iconSvg.setAttribute('stroke', 'currentColor');
                iconSvg.setAttribute('stroke-width', '2');
                iconSvg.setAttribute('stroke-linecap', 'round');
                iconSvg.setAttribute('stroke-linejoin', 'round');
                const path = doc.createElementNS(svgNs2, 'path');
                path.setAttribute('d', meta.inlineIconPath);
                iconSvg.appendChild(path);
                btn.appendChild(iconSvg);
            } else {
                setIcon(btn, meta.icon);
            }
            // Narrower balance width than default so the tooltip's native CSS wrap
            // can't re-break our last line into a widow (e.g. "count." alone).
            applyTooltip(btn, meta.tooltip, 'bottom', 300, { custom: true });
            signalSelector.appendChild(btn);
            signalButtons.push({ el: btn, signal: signalId });
        });
        controlsRow.appendChild(signalSelector);

        // Cache-window pill — shown while a prior run's manuscript cache is still
        // live, so switching signals here reuses it. Self-ticking; hidden when no
        // window is open. (xhtml element so it lives inside the foreignObject.)
        const cachePill = doc.createElementNS(xhtmlNs, 'div') as HTMLDivElement;
        cachePill.className = 'ert-gossamer-cache-pill';
        cachePill.setAttribute('data-state', 'idle');
        controlsRow.appendChild(cachePill);
        this.gossamerCachePillEl = cachePill;
        this.updateGossamerCachePill();
        if (this.gossamerCacheTickInterval !== undefined) {
            window.clearInterval(this.gossamerCacheTickInterval);
        }
        this.gossamerCacheTickInterval = window.setInterval(() => this.updateGossamerCachePill(), 1000);

        panel.appendChild(controlsRow);

        if (runs.length > 0) {
            const list = doc.createElementNS(xhtmlNs, 'div');
            list.className = 'rt-gossamer-runs__list rt-gossamer-runs__list--inline';
            displayedRuns.forEach((record, idx) => {
                list.appendChild(this.buildGossamerRunToggleRow(record));
                if (idx === 0 && displayedRuns.length > 1 && record.isLatest) {
                    const divider = doc.createElementNS(xhtmlNs, 'div');
                    divider.className = 'rt-gossamer-runs__divider';
                    list.appendChild(divider);
                }
            });
            panel.appendChild(list);
        } else {
            const empty = doc.createElementNS(xhtmlNs, 'div') as HTMLDivElement;
            empty.className = 'rt-gossamer-runs__empty';
            empty.textContent = t('ui.timeLineView.noTraces', { signal: GOSSAMER_SIGNAL_METADATA[activeSignal].label.toLowerCase() });
            panel.appendChild(empty);
        }

        const schedulePanelRefresh = () => {
            const id = window.setTimeout(() => {
                this.lastSnapshot = null;
                this.refreshTimeline();
            }, 0);
            this.renderScope.register(() => window.clearTimeout(id));
        };
        const stopRunsEvent = (event: Event) => {
            event.stopPropagation();
        };

        this.renderScope.registerDomEvent(panel, 'click', stopRunsEvent);
        this.renderScope.registerDomEvent(panel, 'mousedown', stopRunsEvent);
        this.renderScope.registerDomEvent(panel, 'mouseup', stopRunsEvent);
        this.renderScope.registerDomEvent(panel, 'pointerdown', stopRunsEvent);
        this.renderScope.registerDomEvent(panel, 'pointerup', stopRunsEvent);

        // Pill click: binary toggle — latest-only vs show-all.
        const togglePillMode = (event: Event) => {
            event.stopPropagation();
            if (runs.length === 0) return;
            this.plugin.gossamerLatestOnly = !this.plugin.gossamerLatestOnly;
            this.plugin.gossamerVisibleRunIds = [];
            void this.plugin.saveGossamerRunFilterState();
            schedulePanelRefresh();
        };
        this.renderScope.registerDomEvent(button, 'click', togglePillMode);
        this.renderScope.registerDomEvent(button, 'keydown', (event: KeyboardEvent) => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                togglePillMode(event);
            }
        });

        // Signal selector click: switch the plotted signal.
        signalButtons.forEach(({ el, signal }) => {
            this.renderScope.registerDomEvent(el, 'click', (event) => {
                event.stopPropagation();
                if (this.plugin.gossamerSelectedSignal === signal) return;
                this.plugin.gossamerSelectedSignal = signal;
                // Switching signals resets run-level filters (IDs are signal-scoped).
                this.plugin.gossamerLatestOnly = false;
                this.plugin.gossamerVisibleRunIds = [];
                void this.plugin.saveGossamerRunFilterState();
                schedulePanelRefresh();
            });
            this.renderScope.registerDomEvent(el, 'mousedown', stopRunsEvent);
            this.renderScope.registerDomEvent(el, 'pointerdown', stopRunsEvent);
        });

        foreignObject.appendChild(panel);
        svg.insertBefore(foreignObject, svg.firstChild);
    }

    private buildGossamerRunToggleRow(record: GossamerRunRecord): HTMLElement {
        const xhtmlNs = 'http://www.w3.org/1999/xhtml';
        const doc = this.containerEl.ownerDocument;
        const row = doc.createElementNS(xhtmlNs, 'label');
        row.className = 'rt-gossamer-runs__checkbox-row';

        const checkbox = doc.createElementNS(xhtmlNs, 'input') as HTMLInputElement;
        checkbox.type = 'checkbox';
        const selectedIds = this.plugin.gossamerLatestOnly
            ? this.plugin.gossamerRunInventory.filter((run) => run.isLatest).map((run) => run.id)
            : (this.plugin.gossamerVisibleRunIds.length > 0
                ? this.plugin.gossamerVisibleRunIds
                : this.plugin.gossamerRunInventory.map((run) => run.id));
        checkbox.checked = selectedIds.includes(record.id);
        row.appendChild(checkbox);

        const text = doc.createElementNS(xhtmlNs, 'span');
        text.textContent = record.label;
        row.appendChild(text);

        const schedulePanelRefresh = () => {
            const id = window.setTimeout(() => {
                this.lastSnapshot = null;
                this.refreshTimeline();
            }, 0);
            this.renderScope.register(() => window.clearTimeout(id));
        };
        const stopRunsEvent = (event: Event) => {
            event.stopPropagation();
        };

        this.renderScope.registerDomEvent(row, 'click', stopRunsEvent);
        this.renderScope.registerDomEvent(row, 'mousedown', stopRunsEvent);
        this.renderScope.registerDomEvent(row, 'mouseup', stopRunsEvent);
        this.renderScope.registerDomEvent(row, 'pointerdown', stopRunsEvent);
        this.renderScope.registerDomEvent(row, 'pointerup', stopRunsEvent);

        this.renderScope.registerDomEvent(checkbox, 'change', (event) => {
            event.stopPropagation();
            const allIds = this.plugin.gossamerRunInventory.map((run) => run.id);
            const latestIds = this.plugin.gossamerRunInventory.filter((run) => run.isLatest).map((run) => run.id);
            const nextSelected = this.plugin.gossamerLatestOnly
                ? [...latestIds]
                : (this.plugin.gossamerVisibleRunIds.length > 0
                    ? [...this.plugin.gossamerVisibleRunIds]
                    : [...allIds]);

            if (checkbox.checked) {
                if (!nextSelected.includes(record.id)) nextSelected.push(record.id);
            } else {
                const filtered = nextSelected.filter((id) => id !== record.id);
                if (filtered.length === 0) {
                    checkbox.checked = true;
                    return;
                }
                nextSelected.splice(0, nextSelected.length, ...filtered);
            }

            this.plugin.gossamerLatestOnly = false;
            this.plugin.gossamerVisibleRunIds = nextSelected;
            void this.plugin.saveGossamerRunFilterState();
            schedulePanelRefresh();
        });
        this.renderScope.registerDomEvent(checkbox, 'click', stopRunsEvent);
        this.renderScope.registerDomEvent(checkbox, 'mousedown', stopRunsEvent);
        this.renderScope.registerDomEvent(checkbox, 'mouseup', stopRunsEvent);
        this.renderScope.registerDomEvent(checkbox, 'pointerdown', stopRunsEvent);
        this.renderScope.registerDomEvent(checkbox, 'pointerup', stopRunsEvent);

        return row;
    }

    private buildRecentMoveRow(entry: StructuralMoveHistoryEntry): HTMLElement {
        const xhtmlNs = 'http://www.w3.org/1999/xhtml';
        const doc = this.containerEl.ownerDocument;
        const row = doc.createElementNS(xhtmlNs, 'div');
        row.className = 'ert-recent-moves__item';

        const header = doc.createElementNS(xhtmlNs, 'div');
        header.className = 'ert-recent-moves__header-row';

        const icon = doc.createElementNS(xhtmlNs, 'div');
        icon.className = 'ert-recent-moves__icon';
        setIcon(icon, 'arrow-right-to-line');
        header.appendChild(icon);

        const summary = doc.createElementNS(xhtmlNs, 'div');
        summary.className = 'ert-recent-moves__summary';
        const [sourceLabel, targetLabel] = entry.summary.split('|').map((part) => part.trim());
        if (sourceLabel && targetLabel) {
            const source = doc.createElementNS(xhtmlNs, 'span');
            source.textContent = sourceLabel;
            summary.appendChild(source);

            const cornerIcon = doc.createElementNS(xhtmlNs, 'span');
            cornerIcon.className = 'ert-recent-moves__inline-icon';
            setIcon(cornerIcon, 'corner-up-right');
            summary.appendChild(cornerIcon);

            const target = doc.createElementNS(xhtmlNs, 'span');
            target.textContent = targetLabel;
            summary.appendChild(target);
        } else {
            summary.textContent = entry.summary;
        }
        header.appendChild(summary);
        row.appendChild(header);

        const meta = doc.createElementNS(xhtmlNs, 'div');
        meta.className = 'ert-recent-moves__meta';
        const parts = [this.formatRecentMoveAge(entry.timestamp)];
        if (entry.sourceContext && entry.destinationContext) {
            parts.push(`${entry.sourceContext} -> ${entry.destinationContext}`);
        } else if (entry.destinationContext) {
            parts.push(entry.destinationContext);
        } else if (entry.sourceContext) {
            parts.push(entry.sourceContext);
        }
        meta.textContent = parts.join(' • ');
        row.appendChild(meta);

        return row;
    }

    private formatRecentMoveAge(timestamp: string): string {
        const parsed = Date.parse(timestamp);
        if (!Number.isFinite(parsed)) return t('ui.timeLineView.recently');

        const elapsedMs = Date.now() - parsed;
        if (elapsedMs < 60_000) return t('ui.timeLineView.justNow');
        if (elapsedMs < 3_600_000) return t('ui.timeLineView.minutesAgo', { minutes: Math.max(1, Math.floor(elapsedMs / 60_000)) });
        if (elapsedMs < 86_400_000) return t('ui.timeLineView.hoursAgo', { hours: Math.max(1, Math.floor(elapsedMs / 3_600_000)) });

        try {
            return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(parsed));
        } catch {
            return t('ui.timeLineView.recently');
        }
    }

    /**
     * Remove all Gossamer-specific event listeners and restore normal mode.
     * Public: invoked by GossamerCommands during the non-ModeManager exit path.
     */
    public removeGossamerEventListeners(svg: SVGSVGElement): void {
        this.gossamerEventHandlers.forEach((handler, key) => {
            const [eventType] = key.split('::');
            // All handlers recorded here were attached to the SVG root via delegation
            svg.removeEventListener(eventType, handler);
        });
        this.gossamerEventHandlers.clear();
    }
    
    /**
     * Setup Gossamer-specific event listeners
     * These are simpler and don't have conditionals - just Plot slice and dot interactions.
     * Public: invoked by GossamerCommands during the non-ModeManager enter path.
     */
    public setupGossamerEventListeners(svg: SVGSVGElement): void {
        // Clear any existing Gossamer handlers first
        this.removeGossamerEventListeners(svg);
        
        // Use ModeInteractionController system
        if (this.interactionController) {
            const modeDef = getModeDefinition(TimelineMode.GOSSAMER);
            void this.interactionController.setupMode(modeDef, svg);
        }
    }
}
