/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 */
// --- Imports and constants added for standalone module ---
import { ItemView, WorkspaceLeaf, MarkdownView, TFile, Notice, setIcon, Menu } from 'obsidian';
import { TimelineRepairModal } from '../modals/TimelineRepairModal';
import { TimelineAuditModal } from '../modals/TimelineAuditModal';
import RadialTimelinePlugin from '../main';
import { t } from '../i18n';
import type { SubplotAlignment, TimelineItem } from '../types';
import { renderSvgFromString } from '../utils/svgDom';
import { openOrRevealFileByPath } from '../utils/fileUtils';
import { setupRotationController, setupSearchControls as setupSearchControlsExt, addHighlightRectangles as addHighlightRectanglesExt, setupModeToggleController, setupVersionIndicatorController, setupHelpIconController, setupTooltips, setupSubplotKeyController } from './interactions';
import { isShiftModeActive } from './interactions/ChronologueShiftController';
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
import { DiscordChip } from '../communityShare/discordChip';
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
import { formatGossamerCacheClock, formatGossamerCacheCostHint } from '../gossamer/cacheWindow';
import { tooltip as applyTooltip } from '../utils/tooltip';

// Duplicate of constants defined in main for now. We can consolidate later.
export const TIMELINE_VIEW_TYPE = "radial-timeline";
export const TIMELINE_VIEW_DISPLAY_TEXT = "Radial timeline";
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

interface TimelineLegendRow {
    icon?: string;
    swatch?: TimelineLegendSwatch;
    label: string;
    detail?: string;
    detailSegments?: TimelineLegendDetailSegment[];
    detailIcon?: string;
    detailIconLabel?: string;
}

interface TimelineLegendDetailSegment {
    text: string;
    color?: string;
}

interface TimelineLegendSwatch {
    fill?: string;
    stroke?: string;
    text?: string;
    textColor?: string;
}

interface TimelineLegendSection {
    title: string;
    rows: TimelineLegendRow[];
}

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
    
    // Change detection snapshot for optimizing renders
    private lastSnapshot: TimelineSnapshot | null = null;
        
    // Scene data (scenes)
    sceneData: TimelineItem[] = [];
    
    // Set of open scene paths (for tracking open files)
    openScenePaths: Set<string> = new Set<string>();

    // Book switcher UI
    private bookSwitcherEl?: HTMLElement;
    private bookSwitcherSelect?: HTMLSelectElement;
    private bookSwitcherManageBtn?: HTMLButtonElement;
    private modeNavButtons?: Map<string, HTMLButtonElement>;
    private chronologueSubNavEl?: HTMLElement;
    private chronologueSubNavBtns?: { shift: HTMLButtonElement; alt: HTMLButtonElement; runtime: HTMLButtonElement };
    private alignmentToggleEl?: HTMLElement;
    private alignmentToggleBtn?: HTMLButtonElement;
    // Populated by ChronologueShiftController each render (the single source of
    // truth for the sub-mode toggles); cleared on its teardown. The header
    // sub-nav routes clicks through these so keyboard/click stay unified.
    public chronologueSubNav?: {
        hasAlt: boolean;
        runtimeNoData: boolean;
        toggleShift: () => void;
        toggleAlt: () => void;
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
    private discordChip?: DiscordChip;
    private writingSessionModeSelect?: HTMLSelectElement;
    private writingSessionCountdownToggle?: HTMLInputElement;
    private writingSessionGoalInput?: HTMLInputElement;
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
    private modeManager?: ModeManager; // Centralized mode management
    private interactionController?: ModeInteractionController; // Interaction handler management
    
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
    }

    /**
     * Get the ModeManager instance
     * Provides centralized mode switching with lifecycle management
     */
    public getModeManager(): ModeManager | undefined {
        return this.modeManager;
    }

    /**
     * Get the InteractionController instance
     * Manages event handler registration and cleanup
     */
    public getInteractionController(): ModeInteractionController | undefined {
        return this.interactionController;
    }


    constructor(leaf: WorkspaceLeaf, plugin: RadialTimelinePlugin) {
        super(leaf);
        this.plugin = plugin;
        this.openScenePaths = plugin.openScenePaths;
        this.rendererService = plugin.getRendererService();
        
        // Initialize mode management
        this._currentMode = plugin.settings.currentMode || 'narrative';
        try {
            this.modeManager = createModeManager(plugin, this);
            this.interactionController = createInteractionController(this);
        } catch {
            // Mode management initialization failed
        }
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
            .setTitle(t('commands.timelineOrder'))
            .setIcon('calendar-plus')
            .setSection('pane')
            .onClick(() => new TimelineRepairModal(this.app, this.plugin).open()));
        menu.addItem(item => item
            .setTitle(t('commands.timelineAudit'))
            .setIcon('calendar-search')
            .setSection('pane')
            .onClick(() => new TimelineAuditModal(this.app, this.plugin).open()));
    }

    private ensureBookSwitcher(): void {
        const headerEl = this.containerEl.querySelector('.view-header');
        if (!headerEl) return;

        if (!this.bookSwitcherEl) {
            const doc = headerEl.ownerDocument;
            const actionsEl = headerEl.querySelector('.view-actions');
            const wrapper = doc.createElement('div');
            wrapper.className = 'rt-book-switcher';

            const searchShell = doc.createElement('div');
            searchShell.className = 'ert-timeline-search';

            const searchBtn = doc.createElement('button');
            searchBtn.className = 'ert-timeline-search__button clickable-icon';
            searchBtn.type = 'button';

            const searchInput = doc.createElement('input');
            searchInput.className = 'ert-timeline-search__input';
            searchInput.type = 'search';
            searchInput.placeholder = 'Search timeline';
            searchInput.autocomplete = 'off';
            searchInput.spellcheck = false;
            searchInput.setAttribute('aria-label', 'Search timeline');

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

            const legendBtn = doc.createElement('button');
            legendBtn.className = 'ert-timeline-legend__trigger clickable-icon';
            legendBtn.type = 'button';
            legendBtn.setAttribute('aria-expanded', 'false');
            setIcon(legendBtn, 'asterisk');

            const legendPanel = doc.createElement('div');
            legendPanel.className = 'ert-timeline-legend';
            legendPanel.setAttribute('role', 'tooltip');

            // Book selector, badged with a book icon so the control reads
            // unambiguously as "which book / Saga" (not a generic dropdown).
            const booksGroup = doc.createElement('div');
            booksGroup.className = 'rt-book-switcher__books';
            const booksIcon = doc.createElement('span');
            booksIcon.className = 'rt-book-switcher__icon';
            booksIcon.setAttribute('aria-hidden', 'true');
            setIcon(booksIcon, 'book');

            const select = doc.createElement('select');
            select.className = 'rt-book-switcher__select';
            select.setAttribute('aria-label', 'Book selector');
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

            const manageBtn = doc.createElement('button');
            manageBtn.className = 'rt-book-switcher__manage ert-timeline-title-action clickable-icon';
            manageBtn.type = 'button';
            manageBtn.setAttribute('aria-label', 'Manage books');
            setIcon(manageBtn, 'settings');
            applyTooltip(manageBtn, 'Manage books', 'bottom');
            this.registerDomEvent(manageBtn, 'click', () => {
                if (this.plugin.settingsTab) {
                    this.plugin.settingsTab.setActiveTab('core');
                }
                const setting = (this.app as unknown as { setting?: { open: () => void; openTabById: (id: string) => void } }).setting; // SAFE: any type used for Obsidian internal API
                if (setting) {
                    setting.open();
                    setting.openTabById('radial-timeline');
                }
            });

            const commandPaletteBtn = doc.createElement('button');
            commandPaletteBtn.className = 'ert-timeline-title-action clickable-icon';
            commandPaletteBtn.type = 'button';
            commandPaletteBtn.setAttribute('aria-label', 'Radial Timeline commands');
            setIcon(commandPaletteBtn, 'command');
            applyTooltip(commandPaletteBtn, 'Radial Timeline commands', 'bottom');
            this.registerDomEvent(commandPaletteBtn, 'click', (evt: MouseEvent) => {
                evt.preventDefault();
                evt.stopPropagation();
                this.openRadialTimelineCommands();
            });

            const exportBtn = doc.createElement('button');
            exportBtn.className = 'ert-timeline-title-action clickable-icon';
            exportBtn.type = 'button';
            exportBtn.setAttribute('aria-label', 'Manuscript export');
            setIcon(exportBtn, 'printer');
            applyTooltip(exportBtn, 'Manuscript export', 'bottom');
            this.registerDomEvent(exportBtn, 'click', (evt: MouseEvent) => {
                evt.preventDefault();
                evt.stopPropagation();
                this.plugin.openManuscriptExportModal();
            });

            // Bug report — direct entry point in the title bar. Same action as
            // the version-indicator fallback; ModeManager/version state are not
            // duplicated, only this one trigger.
            const bugBtn = doc.createElement('button');
            bugBtn.className = 'ert-timeline-title-action clickable-icon';
            bugBtn.type = 'button';
            bugBtn.setAttribute('aria-label', 'Report a bug');
            setIcon(bugBtn, 'bug');
            applyTooltip(bugBtn, 'Report a bug', 'bottom');
            this.registerDomEvent(bugBtn, 'click', (evt: MouseEvent) => {
                evt.preventDefault();
                evt.stopPropagation();
                new BugReportModal(this.app, this.plugin, 'rt').open();
            });

            const sessionBtn = doc.createElement('button');
            sessionBtn.className = 'ert-timeline-session clickable-icon';
            sessionBtn.type = 'button';
            sessionBtn.setAttribute('aria-label', 'Start writing session');
            const sessionLabel = doc.createElement('span');
            sessionLabel.className = 'ert-timeline-session__label';
            this.renderWritingSessionIdleIcon(sessionLabel);
            sessionBtn.appendChild(sessionLabel);
            this.registerDomEvent(sessionBtn, 'click', (evt: MouseEvent) => {
                evt.preventDefault();
                evt.stopPropagation();
                this.toggleWritingSessionPanel();
            });

            const sessionPanel = doc.createElement('div');
            sessionPanel.className = 'ert-timeline-session-panel ert-hidden';
            sessionPanel.setAttribute('role', 'dialog');
            doc.body.appendChild(sessionPanel);
            this.register(() => sessionPanel.remove());

            // Discord presence chip (shown to every user): fetch/timer state
            // outlives panel re-renders. Wake events refetch presence.
            this.discordChip = new DiscordChip();
            this.register(() => {
                this.discordChip?.destroy();
                this.discordChip = undefined;
            });
            this.registerDomEvent(window, 'focus', () => this.discordChip?.onWake());
            this.registerDomEvent(doc, 'visibilitychange', () => {
                if (doc.visibilityState === 'visible') this.discordChip?.onWake();
            });

            let hideLegendTimer: number | null = null;
            const showLegend = () => {
                if (hideLegendTimer !== null) {
                    window.clearTimeout(hideLegendTimer);
                    hideLegendTimer = null;
                }
                if (legendBtn.hidden) return;
                this.updateTimelineLegend();
                legendPanel.classList.add('is-visible');
                legendBtn.setAttribute('aria-expanded', 'true');
            };
            const hideLegend = () => {
                legendPanel.classList.remove('is-visible');
                legendBtn.setAttribute('aria-expanded', 'false');
            };
            const scheduleLegendHide = () => {
                if (hideLegendTimer !== null) {
                    window.clearTimeout(hideLegendTimer);
                }
                hideLegendTimer = window.setTimeout(() => {
                    hideLegendTimer = null;
                    if (legendPanel.matches(':hover') || legendBtn.matches(':hover') || legendPanel.contains(doc.activeElement)) {
                        return;
                    }
                    hideLegend();
                }, 120);
            };

            this.registerDomEvent(legendBtn, 'mouseenter', showLegend);
            this.registerDomEvent(legendBtn, 'focus', showLegend);
            this.registerDomEvent(legendBtn, 'mouseleave', scheduleLegendHide);
            this.registerDomEvent(legendBtn, 'blur', scheduleLegendHide);
            this.registerDomEvent(legendBtn, 'click', (evt: MouseEvent) => {
                evt.preventDefault();
                evt.stopPropagation();
                if (legendPanel.classList.contains('is-visible')) {
                    hideLegend();
                    return;
                }
                showLegend();
            });
            this.registerDomEvent(legendPanel, 'mouseenter', showLegend);
            this.registerDomEvent(legendPanel, 'mouseleave', scheduleLegendHide);
            this.registerDomEvent(doc.body, 'click', (evt: MouseEvent) => {
                const target = evt.target as Node | null;
                if (target && (legendPanel.contains(target) || legendBtn.contains(target))) return;
                hideLegend();
            });
            this.registerDomEvent(doc, 'keydown', (evt: KeyboardEvent) => {
                if (evt.key === 'Escape') hideLegend();
            });
            this.register(() => {
                if (hideLegendTimer !== null) {
                    window.clearTimeout(hideLegendTimer);
                    hideLegendTimer = null;
                }
            });

            searchShell.appendChild(searchBtn);
            searchShell.appendChild(searchInput);
            booksGroup.appendChild(booksIcon);
            booksGroup.appendChild(select);
            // Right cluster order: legend · search · books · ⌘ · printer · bug · gear
            wrapper.appendChild(legendBtn);
            wrapper.appendChild(legendPanel);
            wrapper.appendChild(searchShell);
            wrapper.appendChild(booksGroup);
            wrapper.appendChild(commandPaletteBtn);
            wrapper.appendChild(exportBtn);
            wrapper.appendChild(bugBtn);
            wrapper.appendChild(manageBtn);

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

            // Discord chip lives in the title bar beside the session control —
            // muted "Discord" link normally, green when Eric is online (per the
            // discord-presence endpoint). Persistent host; state on the controller.
            const discordChipHost = doc.createElement('span');
            discordChipHost.className = 'ert-timeline-discord-chip-host';
            sessionBtn.parentElement?.insertBefore(discordChipHost, sessionBtn.nextSibling);
            this.discordChip?.mount(discordChipHost);

            // Subplot ring key trigger — action icon slot right of the Discord
            // chip. Hidden until SubplotKeyController wires it to a rendered
            // timeline with 2+ subplot rings; no tooltip by design.
            const subplotKeyBtn = doc.createElement('button');
            subplotKeyBtn.className = 'ert-timeline-subplot-key__trigger clickable-icon';
            subplotKeyBtn.type = 'button';
            subplotKeyBtn.hidden = true;
            setIcon(subplotKeyBtn, 'layers');
            discordChipHost.parentElement?.insertBefore(subplotKeyBtn, discordChipHost.nextSibling);
            this.subplotKeyTriggerEl = subplotKeyBtn;

            // Center mode navigation — compact text buttons that replace the
            // removed view title. The canonical switch stays in ModeManager;
            // keyboard shortcuts 1–4 remain wired by ModeToggleController.
            // Active state is kept in sync through the currentMode setter, so
            // keyboard, click, and saga-forced switches all reflect here.
            // Inserted as a DIRECT child of .view-header (not nested with the
            // left cluster inside .view-header-left) so its auto side-margins
            // resolve against the whole bar's free space and truly center it.
            const modeNav = doc.createElement('div');
            modeNav.className = 'ert-timeline-mode-nav';
            modeNav.setAttribute('role', 'tablist');
            modeNav.setAttribute('aria-label', 'Timeline mode');
            const modeButtons = new Map<string, HTMLButtonElement>();
            let chronologueModeBtn: HTMLButtonElement | undefined;
            getToggleableModes().forEach((mode, index) => {
                const modeKey = `timeline.modes.${mode.id}.name`;
                const translated = t(modeKey);
                const label = translated && !translated.startsWith('[missing:') ? translated : mode.name;
                const btn = doc.createElement('button');
                btn.className = 'ert-timeline-mode-nav__btn';
                btn.type = 'button';
                btn.dataset.mode = mode.id;
                btn.setAttribute('role', 'tab');
                btn.setAttribute('aria-selected', 'false');
                // Numeral prefix = the keyboard shortcut, taken from the same
                // getToggleableModes() index the handler uses (never hardcoded).
                // Styled as a subtle mono hint, distinct from the mode name.
                const num = doc.createElement('span');
                num.className = 'ert-timeline-mode-nav__num';
                num.setAttribute('aria-hidden', 'true');
                num.textContent = String(index + 1);
                const labelSpan = doc.createElement('span');
                labelSpan.className = 'ert-timeline-mode-nav__label';
                labelSpan.textContent = label;
                btn.appendChild(num);
                btn.appendChild(labelSpan);
                btn.setAttribute('aria-label', `${label} mode (${index + 1})`);
                applyTooltip(btn, `${label} — press ${index + 1}`, 'bottom');
                this.registerDomEvent(btn, 'click', (evt: MouseEvent) => {
                    evt.preventDefault();
                    evt.stopPropagation();
                    void this.switchTimelineModeFromNav(mode.id);
                });
                modeNav.appendChild(btn);
                modeButtons.set(mode.id, btn);
                if (mode.id === TimelineMode.CHRONOLOGUE) chronologueModeBtn = btn;
            });
            headerEl.insertBefore(modeNav, wrapper);
            this.modeNavButtons = modeButtons;
            this.buildChronologueSubNav(doc, modeNav, chronologueModeBtn);
            this.buildAlignmentToggle(doc, modeNav);

            this.bookSwitcherEl = wrapper;
            this.bookSwitcherSelect = select;
            this.bookSwitcherManageBtn = manageBtn;
            this.timelineSearchInput = searchInput;
            this.timelineSearchButton = searchBtn;
            this.searchPanel = new SearchPanelController(
                {
                    getSearchState: () => this.plugin.searchState,
                    setSearchOptions: (options) => { void this.applySearchOptions(options); },
                    getLocalModelStatus: () => getLocalLlmAvailability(this.plugin),
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
        // Leaving Chronologue: hide its sub-nav immediately (the controller
        // teardown also hides it, but the mode setter fires before re-render).
        if (this._currentMode !== 'chronologue') this.hideChronologueSubNav();
        this.syncAlignmentToggle();
    }

    /**
     * Build the subplot alignment toggle once, leading the mode row.
     *
     * Alignment is a saved layout preference, not a momentary sub-mode like
     * Chronologue's Shift / Alt / Runtime, and it applies to every mode that
     * draws an all-scenes outer ring — all but Progress. So it leads the row
     * rather than nesting under one mode button, which also keeps it clear of
     * the Chronologue chips on the far side.
     *
     * One chip, labelled with the current state: the label IS the value, so
     * there is no "which of these two is on?" to decode.
     */
    private buildAlignmentToggle(doc: Document, modeNav: HTMLElement): void {
        const group = doc.createElement('div');
        group.className = 'ert-timeline-subnav ert-timeline-alignment-toggle';
        group.setAttribute('role', 'group');
        group.setAttribute('aria-label', t('timeline.subplotAlignment.groupLabel'));
        group.hidden = true;

        const btn = doc.createElement('button');
        btn.className = 'ert-timeline-subnav__btn';
        btn.type = 'button';
        const glyphEl = doc.createElement('span');
        glyphEl.className = 'ert-timeline-subnav__glyph';
        glyphEl.setAttribute('aria-hidden', 'true');
        const labelEl = doc.createElement('span');
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
        const glyphEl = btn.querySelector('.ert-timeline-subnav__glyph');
        if (glyphEl) glyphEl.textContent = active === 'sequence' ? '\u25D4' : '\u25CD';
        const labelEl = btn.querySelector('.ert-timeline-subnav__label');
        if (labelEl) labelEl.textContent = activeLabel;
        btn.setAttribute('aria-label', hint);
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
        await this.refreshTimeline();
    }

    /**
     * Build the persistent Chronologue sub-nav (Shift / Alt / Runtime) once,
     * anchored right after the Chronologue mode button. Hidden until the
     * ChronologueShiftController wires it up via showChronologueSubNav().
     * Clicks route through this.chronologueSubNav (the controller's toggles);
     * physical Shift/CapsLock/Alt and the RT click keep working untouched.
     */
    private buildChronologueSubNav(doc: Document, modeNav: HTMLElement, anchorBtn?: HTMLButtonElement): void {
        const subNav = doc.createElement('div');
        subNav.className = 'ert-timeline-subnav';
        subNav.setAttribute('role', 'group');
        subNav.setAttribute('aria-label', 'Chronologue sub-modes');
        subNav.hidden = true;

        const makeBtn = (submode: 'shift' | 'alt' | 'runtime', label: string, glyph: string, aria: string): HTMLButtonElement => {
            const btn = doc.createElement('button');
            btn.className = 'ert-timeline-subnav__btn';
            btn.type = 'button';
            btn.dataset.submode = submode;
            btn.setAttribute('aria-pressed', 'false');
            btn.setAttribute('aria-label', aria);
            const glyphEl = doc.createElement('span');
            glyphEl.className = 'ert-timeline-subnav__glyph';
            glyphEl.setAttribute('aria-hidden', 'true');
            glyphEl.textContent = glyph;
            const labelEl = doc.createElement('span');
            labelEl.className = 'ert-timeline-subnav__label';
            labelEl.textContent = label;
            btn.appendChild(glyphEl);
            btn.appendChild(labelEl);
            applyTooltip(btn, aria, 'bottom');
            return btn;
        };

        const shift = makeBtn('shift', 'Shift', '⇧', 'Shift — elapsed time comparison');
        const alt = makeBtn('alt', 'Alt', '⌥', 'Alt — planetary calendar');
        const runtime = makeBtn('runtime', 'Runtime', 'RT', 'Runtime overlay');

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
        this.registerDomEvent(runtime, 'click', (evt: MouseEvent) => {
            evt.preventDefault();
            evt.stopPropagation();
            this.chronologueSubNav?.toggleRuntime();
        });

        subNav.appendChild(shift);
        subNav.appendChild(alt);
        subNav.appendChild(runtime);

        if (anchorBtn && anchorBtn.parentElement === modeNav) {
            modeNav.insertBefore(subNav, anchorBtn.nextSibling);
        } else {
            modeNav.appendChild(subNav);
        }

        this.chronologueSubNavEl = subNav;
        this.chronologueSubNavBtns = { shift, alt, runtime };
    }

    /**
     * Reveal the Chronologue sub-nav and reflect per-book availability. Called
     * by the controller once its buttons exist. Alt is shown only when a valid
     * planetary profile exists; Runtime carries a no-data hint when no scene
     * has Runtime data (mirroring the in-view keycap — the overlay itself is
     * not click-gated).
     */
    public showChronologueSubNav(opts: { hasAlt: boolean; runtimeNoData: boolean }): void {
        const el = this.chronologueSubNavEl;
        const btns = this.chronologueSubNavBtns;
        if (!el || !btns) return;
        el.hidden = false;
        btns.alt.hidden = !opts.hasAlt;
        btns.runtime.classList.toggle('is-no-data', opts.runtimeNoData);
    }

    /** Hide the Chronologue sub-nav and clear its active states. */
    public hideChronologueSubNav(): void {
        const el = this.chronologueSubNavEl;
        if (el) el.hidden = true;
        const btns = this.chronologueSubNavBtns;
        if (!btns) return;
        for (const btn of [btns.shift, btns.alt, btns.runtime]) {
            btn.classList.remove('is-active');
            btn.setAttribute('aria-pressed', 'false');
        }
    }

    /**
     * Mirror the active Chronologue sub-mode onto the sub-nav. Driven from the
     * controller's own state, so it reflects activation via keyboard (Shift /
     * CapsLock / Alt), the in-view keycaps, or these header chips alike.
     */
    public syncChronologueSubNav(state: { shift: boolean; alt: boolean; runtime: boolean }): void {
        const btns = this.chronologueSubNavBtns;
        if (!btns) return;
        const apply = (btn: HTMLButtonElement, active: boolean) => {
            btn.classList.toggle('is-active', active);
            btn.setAttribute('aria-pressed', active ? 'true' : 'false');
        };
        apply(btns.shift, state.shift);
        apply(btns.alt, state.alt);
        apply(btns.runtime, state.runtime);
    }

    /**
     * Header mode-nav click handler. Routes through ModeManager (the single
     * canonical switch path); the currentMode setter updates the nav state.
     */
    private async switchTimelineModeFromNav(modeId: string): Promise<void> {
        if (modeId === this._currentMode) return;
        this.closeWritingSessionPanel();
        const modeManager = this.getModeManager();
        if (modeManager) {
            await modeManager.switchMode(modeId as TimelineMode);
            return;
        }
        // Fallback mirrors ModeToggleController when no manager is present.
        this.currentMode = modeId;
        this.plugin.settings.currentMode = modeId;
        await this.plugin.saveSettings();
        this.refreshTimeline();
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
        if (mode === 'drafting') return 'fresh drafting';
        if (mode === 'revising') return 'revision';
        if (mode === 'editing') return 'line edit';
        return 'planning';
    }

    private formatWritingSessionStage(stage: WritingSessionStage | WritingSessionStagePreference | undefined): string {
        if (!stage || stage === 'auto') return 'Auto';
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
        return `${value} ${value === 1 ? 'word' : 'words'}`;
    }

    private formatIdleWritingSessionMeta(
        goalMinutes: number,
        goalWords: number,
        targetMode: WritingSessionTargetMode,
        mode: WritingSessionMode,
        stage: WritingSessionStagePreference
    ): string {
        const target = targetMode === 'time'
            ? `${goalMinutes} min target`
            : targetMode === 'words'
                ? `${goalWords} word target`
                : `${goalWords} words + ${goalMinutes} min`;
        return [
            target,
            this.formatWritingSessionMode(mode),
            this.formatWritingSessionStage(stage),
        ].join(' · ');
    }

    private formatCompletedSessionSummary(active: ActiveWritingSession, elapsedMs: number): string {
        const minutes = Math.max(1, Math.round(elapsedMs / 60000));
        const details = [
            `${minutes} min`,
            this.formatWritingSessionMode(active.mode),
            active.bookTitle,
        ].filter(Boolean).join(' ');
        return `Save ${details}?`;
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
            return { value, unit: 'sec', label: `${value} sec` };
        }
        const minutes = mode === 'countdown'
            ? Math.ceil(safeMs / 60000)
            : Math.floor(safeMs / 60000);
        const value = String(Math.max(0, minutes));
        return { value, unit: 'min', label: `${value} min` };
    }

    private getSessionStatusDisplay(active: ActiveWritingSession, elapsedMs: number): SessionStatusDisplay {
        if (this.sessionUsesWordRing(active)) {
            const typedWords = Math.max(0, Math.round(active.typedWords || 0));
            const goalWords = Math.max(1, Math.round(active.goalWords || 1));
            const detail = `${typedWords}/${goalWords} words typed · ${this.formatSessionClockHms(elapsedMs)} elapsed`;
            if (active.pausedAt) {
                return { headline: active.idleAuto ? 'Idle' : 'Paused', detail, tone: 'paused' };
            }
            return { headline: String(typedWords), detail, tone: 'running' };
        }
        const goalMs = active.goalMinutes ? active.goalMinutes * 60000 : undefined;
        const countdownElapsedMs = this.getCountdownSegmentElapsedMs(active, elapsedMs);
        const remainingMs = goalMs ? Math.max(0, goalMs - countdownElapsedMs) : undefined;
        const clockDisplay = this.formatSessionClockDisplay(remainingMs ?? elapsedMs, goalMs ? 'countdown' : 'elapsed');
        const wordsSuffix = this.sessionHasWordGoal(active)
            ? ` · ${Math.max(0, Math.round(active.typedWords || 0))}/${Math.max(1, Math.round(active.goalWords || 1))} words typed` // SAFE: live session readout — an unstarted session shows 0 typed, and the 1-word floor keeps the denominator non-zero
            : '';
        if (goalMs && remainingMs === 0) {
            return {
                headline: 'Session Complete',
                detail: 'Good work. Continue the timer or save this session.',
                tone: 'complete',
            };
        }
        if (active.pausedAt) {
            return {
                headline: active.idleAuto ? 'Idle' : 'Paused',
                detail: `${clockDisplay.label} ${goalMs ? 'left' : 'elapsed'}${wordsSuffix}`,
                tone: 'paused',
            };
        }
        return {
            headline: clockDisplay.value,
            detail: `${clockDisplay.label} ${goalMs ? 'remaining' : 'elapsed'}${wordsSuffix}`,
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
                    detail: `Start writing session, ${this.formatWordCount(defaultGoalWords)} target`,
                    state: 'idle',
                };
            }
            if (dailyProgress.remainingWords && dailyProgress.remainingWords > 0) {
                return {
                    label: String(dailyProgress.remainingWords),
                    detail: `Start writing session, ${this.formatWordCount(dailyProgress.remainingWords)} left today`,
                    state: 'idle',
                };
            }
            if (dailyProgress.sessionsCompleted > 0) {
                return {
                    label: '',
                    detail: `Daily word goal complete, ${this.formatWordCount(dailyProgress.wordsLogged)} logged today`,
                    state: 'idle',
                    renderIcon: true,
                    goalMet: true,
                };
            }
            return {
                label: String(dailyProgress.dailyTargetWords),
                detail: `Start writing session, ${this.formatWordCount(dailyProgress.dailyTargetWords)} target`,
                state: 'idle',
            };
        }
        if (!dailyProgress.dailyTargetMinutes) {
            return {
                label: String(defaultGoalMinutes),
                detail: `Start writing session, ${defaultGoalMinutes} min target`,
                state: 'idle',
            };
        }
        if (dailyProgress.remainingMinutes && dailyProgress.remainingMinutes > 0) {
            return {
                label: String(dailyProgress.remainingMinutes),
                detail: `Start writing session, ${dailyProgress.remainingMinutes} min left today`,
                state: 'idle',
            };
        }
        if (dailyProgress.sessionsCompleted > 0) {
            return {
                label: '',
                detail: `Daily writing goal complete, ${dailyProgress.minutesLogged} min logged today`,
                state: 'idle',
                renderIcon: true,
                goalMet: true,
            };
        }
        return {
            label: String(dailyProgress.dailyTargetMinutes),
            detail: `Start writing session, ${dailyProgress.dailyTargetMinutes} min target`,
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
            label: display.tone === 'complete' ? 'Complete' : display.headline,
            detail: active.pausedAt
                ? `${active.idleAuto ? 'Idle' : 'Paused'} ${this.formatWritingSessionMode(active.mode)} session, ${display.detail}`
                : `Active ${this.formatWritingSessionMode(active.mode)} session, ${display.detail}`,
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
        // Auto-track: pause on idle, finalize a long-abandoned session. Re-render
        // the panel when the session state actually changes.
        if (service.isAutoTrackEnabled()) {
            void service.maybeHandleIdle().then(changed => {
                if (changed) this.renderWritingSessionPanel();
            });
        }
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
        this.writingSessionButton.setAttribute('aria-label', snapshot.detail);
        if (shouldPulseCount && snapshot.pulseKey && pulseColor) {
            this.pulseWritingSessionTitleCount(pulseColor);
        }
        this.writingSessionLastTitlePulseKey = snapshot.pulseKey;
        // Ensure the title-bar Discord chip stays mounted (cheap; no-op once
        // mounted — the chip's own poll drives its content).
        this.discordChip?.sync();
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
        // and auto-track-off sessions show no marker.
        const symbol = service.isAutoTrackEnabled()
            ? (active.pausedAt ? (active.idleAuto ? 'dot' as const : undefined) : 'plus' as const)
            : undefined;
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
        const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
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
            const path = doc.createElementNS('http://www.w3.org/2000/svg', 'path');
            path.setAttribute('d', d);
            svg.appendChild(path);
        });

        const circle = doc.createElementNS('http://www.w3.org/2000/svg', 'circle');
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
            this.registerDomEvent(control, eventName, event => {
                event.stopPropagation();
            });
        });
    }

    private createSessionIconButton(parent: HTMLElement, icon: string, label: string, className: string, onClick: () => void | Promise<void>): HTMLButtonElement {
        const button = parent.createEl('button', { cls: className });
        button.type = 'button';
        setIcon(button, icon);
        button.setAttribute('aria-label', label);
        applyTooltip(button, label, 'bottom');
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
        const setting = (this.app as unknown as { setting?: { open: () => void; openTabById: (id: string) => void } }).setting;
        if (setting) {
            setting.open();
            setting.openTabById('radial-timeline');
        }
        settingsTab?.setActiveTab('core');
        const reveal = () => settingsTab?.revealSettingsSection('core', 'goals-sessions', { force: true });
        window.requestAnimationFrame(reveal);
        window.setTimeout(reveal, 160);
        window.setTimeout(reveal, 360);
    }

    private renderWritingSessionPanel(): void {
        const panel = this.writingSessionPanel;
        if (!panel) return;
        panel.empty();

        const service = this.plugin.getWritingSessionService();
        const active = service.getActiveSession();
        panel.dataset.sessionState = active ? 'active' : 'idle';
        delete panel.dataset.sessionRenderKey;
        // Social accent: saved sessions will post to the public community feed.
        const feedArmed = this.isSessionFeedShareArmed();
        panel.classList.toggle('is-community-shared', feedArmed);
        const header = panel.createDiv({ cls: 'ert-timeline-session-panel__header' });
        header.createDiv({ cls: 'ert-timeline-session-panel__title', text: 'Writing Session' });
        if (feedArmed) {
            const sharedBadge = header.createSpan({ cls: 'ert-timeline-session-panel__shared-badge', text: 'Shared' });
            applyTooltip(sharedBadge, 'Saved sessions post a progress summary to your community feed', 'bottom');
        }
        const settingsBtn = header.createEl('button', { cls: 'ert-timeline-session-panel__icon clickable-icon' });
        settingsBtn.type = 'button';
        setIcon(settingsBtn, 'settings');
        settingsBtn.setAttribute('aria-label', 'Goals & Sessions settings');
        applyTooltip(settingsBtn, 'Goals & Sessions settings', 'bottom');
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
        header.createSpan({ text: 'Recent · last 7 days' });
        header.createSpan({
            cls: 'ert-timeline-session-panel__recent-meta',
            text: rows.length === 1 ? '1 session' : `${rows.length} sessions`,
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
        const intro = panel.createDiv({ cls: 'ert-timeline-session-panel__idle-card' });
        const introIcon = intro.createDiv({ cls: 'ert-timeline-session-panel__idle-icon' });
        setIcon(introIcon, 'play');
        const introText = intro.createDiv({ cls: 'ert-timeline-session-panel__idle-copy' });
        const sessionSettings = service.getSettings();
        const defaultMode = sessionSettings.defaults.defaultMode;
        const defaultStage = this.resolveWritingSessionStageSelection(defaultMode, sessionSettings.defaults.defaultStage ?? 'auto');
        const defaultTargetMode = service.getDefaultTargetMode();
        introText.createDiv({
            cls: 'ert-timeline-session-panel__idle-title',
            text: service.getDailySessionProgress().sessionsCompleted > 0 ? 'Resume today' : 'Ready to write',
        });
        const idleMeta = introText.createDiv({
            cls: 'ert-timeline-session-panel__idle-meta',
            text: this.formatIdleWritingSessionMeta(sessionGoalMinutes, sessionGoalWords, defaultTargetMode, defaultMode, defaultStage),
        });
        // Intentionally NO daily-progress strip ("140m logged · 100m over · 0w
        // logged · 400w left"). The session log below shows today's actual
        // sessions; that's where running totals belong. The intro card answers
        // one question only: "what will this session do?"

        const autoTrackCard = panel.createEl('label', { cls: 'ert-timeline-session-panel__idle-card ert-timeline-session-panel__option' });
        const autoTrackIcon = autoTrackCard.createDiv({ cls: 'ert-timeline-session-panel__section-icon ert-timeline-session-panel__option-icon' });
        setIcon(autoTrackIcon, 'calendar-sync');
        const autoTrackCopy = autoTrackCard.createDiv({ cls: 'ert-timeline-session-panel__idle-copy' });
        autoTrackCopy.createDiv({ cls: 'ert-timeline-session-panel__idle-title', text: 'Auto-track' });
        const idleTimeoutMs = service.getIdleTimeoutMs();
        const idleTimeoutLabel = idleTimeoutMs >= 60000
            ? `${Math.round(idleTimeoutMs / 60000)} min`
            : `${Math.round(idleTimeoutMs / 1000)} sec`;
        autoTrackCopy.createDiv({
            cls: 'ert-timeline-session-panel__idle-meta',
            text: `Once you start a session, it pauses after ${idleTimeoutLabel} idle and resumes when you return to writing.`,
        });
        const autoTrackToggle = autoTrackCard.createEl('input', { cls: 'ert-timeline-session-panel__toggle ert-timeline-session-panel__option-toggle' });
        autoTrackToggle.type = 'checkbox';
        autoTrackToggle.checked = sessionSettings.defaults.autoTrack === true;
        this.isolateSessionPanelControl(autoTrackToggle);
        this.registerDomEvent(autoTrackToggle, 'change', () => {
            void service.setAutoTrack(autoTrackToggle.checked).catch(error => {
                new Notice(error instanceof Error ? error.message : 'Could not save auto-track setting.');
            });
        });

        const form = panel.createDiv({ cls: 'ert-timeline-session-panel__form' });
        const sessionSection = form.createDiv({ cls: 'ert-timeline-session-panel__section' });
        this.createSessionSectionTitle(sessionSection, 'pen-line', 'Session');

        const modeRow = sessionSection.createDiv({ cls: 'ert-timeline-session-panel__row' });
        modeRow.createDiv({ cls: 'ert-timeline-session-panel__label', text: 'Mode' });
        const modeSelect = modeRow.createEl('select', { cls: 'ert-input ert-input--md ert-timeline-session-panel__select' });
        const modeOptions: Array<{ value: WritingSessionMode; label: string }> = [
            { value: 'drafting', label: 'Fresh drafting' },
            { value: 'revising', label: 'Revision' },
            { value: 'editing', label: 'Line edit' },
            { value: 'planning', label: 'Planning' },
        ];
        modeOptions.forEach(option => {
            const opt = modeSelect.createEl('option', { text: option.label });
            opt.value = option.value;
        });
        modeSelect.value = defaultMode;
        this.isolateSessionPanelControl(modeSelect);
        let stageSelect: HTMLSelectElement;
        let targetModeSelect: HTMLSelectElement;
        let goalInput: HTMLInputElement;
        let wordGoalInput: HTMLInputElement;
        let updateIdleMeta = () => undefined;
        this.registerDomEvent(modeSelect, 'change', () => {
            const mode = (modeSelect.value as WritingSessionMode) || 'drafting';
            if (mode === 'drafting') {
                stageSelect.value = 'Zero';
            }
            updateIdleMeta();
            Promise.all([
                service.setDefaultMode(mode),
                mode === 'drafting' ? service.setDefaultStage('Zero') : Promise.resolve(),
            ]).catch(error => {
                new Notice(error instanceof Error ? error.message : 'Could not save writing session defaults.');
            });
        });
        this.writingSessionModeSelect = modeSelect;

        const stageRow = sessionSection.createDiv({ cls: 'ert-timeline-session-panel__row' });
        stageRow.createDiv({ cls: 'ert-timeline-session-panel__label', text: 'Stage' });
        stageSelect = stageRow.createEl('select', { cls: 'ert-input ert-input--sm ert-timeline-session-panel__select' });
        const stageOptions: Array<{ value: WritingSessionStagePreference; label: string }> = [
            { value: 'auto', label: 'Auto' },
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
        this.registerDomEvent(stageSelect, 'change', () => {
            const stage = (stageSelect.value as WritingSessionStagePreference) || 'auto';
            updateIdleMeta();
            void service.setDefaultStage(stage).catch(error => {
                new Notice(error instanceof Error ? error.message : 'Could not save writing session stage.');
            });
        });

        const sprintSection = form.createDiv({ cls: 'ert-timeline-session-panel__section' });
        this.createSessionSectionTitle(sprintSection, 'target', 'Target');

        const targetModeRow = sprintSection.createDiv({ cls: 'ert-timeline-session-panel__row' });
        targetModeRow.createDiv({ cls: 'ert-timeline-session-panel__label', text: 'Type' });
        targetModeSelect = targetModeRow.createEl('select', { cls: 'ert-input ert-input--md ert-timeline-session-panel__select' });
        const targetModeOptions: Array<{ value: WritingSessionTargetMode; label: string }> = [
            { value: 'time', label: 'Time' },
            { value: 'words', label: 'Words' },
            { value: 'both', label: 'Words + time' },
        ];
        targetModeOptions.forEach(option => {
            const opt = targetModeSelect.createEl('option', { text: option.label });
            opt.value = option.value;
        });
        targetModeSelect.value = defaultTargetMode;
        this.isolateSessionPanelControl(targetModeSelect);

        const countdownRow = sprintSection.createDiv({ cls: 'ert-timeline-session-panel__row ert-timeline-session-panel__row--toggle' });
        const countdownLabel = countdownRow.createEl('label', { cls: 'ert-timeline-session-panel__toggle-label' });
        const countdownToggle = countdownLabel.createEl('input', { cls: 'ert-timeline-session-panel__toggle' });
        countdownToggle.type = 'checkbox';
        countdownToggle.checked = true;
        countdownLabel.createSpan({ text: 'Countdown sprint' });
        this.isolateSessionPanelControl(countdownToggle);
        this.writingSessionCountdownToggle = countdownToggle;

        const goalRow = sprintSection.createDiv({ cls: 'ert-timeline-session-panel__row' });
        goalRow.createDiv({ cls: 'ert-timeline-session-panel__label', text: 'Minutes' });
        const goalControls = goalRow.createDiv({ cls: 'ert-timeline-session-panel__goal-controls' });
        const quickRow = goalControls.createDiv({ cls: 'ert-timeline-session-panel__quick ert-timeline-session-panel__quick--inline' });
        goalInput = goalControls.createEl('input', { cls: 'ert-input ert-input--xs ert-timeline-session-panel__number' });
        goalInput.type = 'number';
        goalInput.min = '1';
        goalInput.max = '600';
        goalInput.step = '1';
        goalInput.value = String(sessionGoalMinutes);
        this.isolateSessionPanelControl(goalInput);
        this.writingSessionGoalInput = goalInput;

        [
            { label: '\u00BC', ariaLabel: '1/4 hour', minutes: 15 },
            { label: '\u00BD', ariaLabel: '1/2 hour', minutes: 30 },
            { label: '\u00BE', ariaLabel: '3/4 hour', minutes: 45 },
        ].forEach(preset => {
            const presetButton = this.createSessionButton(quickRow, preset.label, 'ert-timeline-session-panel__ratio', () => {
                goalInput.value = String(preset.minutes);
            });
            this.isolateSessionPanelControl(presetButton);
        });

        const wordGoalRow = sprintSection.createDiv({ cls: 'ert-timeline-session-panel__row' });
        wordGoalRow.createDiv({ cls: 'ert-timeline-session-panel__label', text: 'Words' });
        const wordGoalControls = wordGoalRow.createDiv({ cls: 'ert-timeline-session-panel__goal-controls' });
        wordGoalInput = wordGoalControls.createEl('input', { cls: 'ert-input ert-input--sm ert-timeline-session-panel__number' });
        wordGoalInput.type = 'number';
        wordGoalInput.min = '1';
        wordGoalInput.max = '50000';
        wordGoalInput.step = '50';
        wordGoalInput.value = String(sessionGoalWords);
        this.isolateSessionPanelControl(wordGoalInput);

        updateIdleMeta = () => {
            const parsedMinutes = Number(goalInput.value);
            const parsedWords = Number(wordGoalInput.value);
            idleMeta.setText(this.formatIdleWritingSessionMeta(
                Number.isFinite(parsedMinutes) && parsedMinutes > 0 ? Math.round(parsedMinutes) : sessionGoalMinutes,
                Number.isFinite(parsedWords) && parsedWords > 0 ? Math.round(parsedWords) : sessionGoalWords,
                (targetModeSelect.value as WritingSessionTargetMode) || 'time',
                (modeSelect.value as WritingSessionMode) || 'drafting',
                (stageSelect.value as WritingSessionStagePreference) || 'auto',
            ));
        };

        this.registerDomEvent(targetModeSelect, 'change', () => {
            syncTargetControls();
            void service.setDefaultTargetMode((targetModeSelect.value as WritingSessionTargetMode) || 'time').catch(error => {
                new Notice(error instanceof Error ? error.message : 'Could not save writing session target.');
            });
        });
        this.registerDomEvent(goalInput, 'change', updateIdleMeta);
        this.registerDomEvent(wordGoalInput, 'change', updateIdleMeta);

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
                const targets = [
                    session.goalWords ? this.formatWordCount(session.goalWords) : undefined,
                    session.goalMinutes ? `${session.goalMinutes} min` : undefined,
                ].filter(Boolean).join(' + ');
                new Notice(`Started ${this.formatWritingSessionMode(session.mode)} session${targets ? ` for ${targets}` : ''}.`);
                this.refreshWritingSessionControl();
            } catch (error) {
                new Notice(error instanceof Error ? error.message : 'Could not start writing session.');
            }
        };

        const startButton = this.createSessionIconButton(goalControls, 'play', 'Start writing session', 'ert-timeline-session-panel__primary ert-timeline-session-panel__icon-action', startSession);

        const syncTargetControls = () => {
            const targetMode = (targetModeSelect.value as WritingSessionTargetMode) || 'time';
            const usesTime = targetMode !== 'words';
            const usesWords = targetMode !== 'time';
            countdownRow.classList.toggle('ert-hidden', !usesTime);
            goalRow.classList.toggle('ert-hidden', !usesTime);
            wordGoalRow.classList.toggle('ert-hidden', !usesWords);
            goalControls.classList.toggle('is-countdown-disabled', usesTime && !countdownToggle.checked);
            const startButtonHost = usesWords ? wordGoalControls : goalControls;
            if (startButton.parentElement !== startButtonHost) {
                startButtonHost.appendChild(startButton);
            }
            updateIdleMeta();
        };

        countdownToggle.onchange = () => {
            syncTargetControls();
        };
        syncTargetControls();
        this.registerDomEvent(goalInput, 'keydown', (event: KeyboardEvent) => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            event.stopPropagation();
            void startSession();
        });
        this.registerDomEvent(wordGoalInput, 'keydown', (event: KeyboardEvent) => {
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
            this.createSessionIconButton(actions, 'play', 'Continue', 'ert-timeline-session-panel__primary ert-timeline-session-panel__icon-action', async () => {
                try {
                    await service.continueCountdown();
                    this.refreshWritingSessionControl();
                } catch (error) {
                    new Notice(error instanceof Error ? error.message : 'Could not continue writing session.');
                }
            });
        } else if (active.pausedAt) {
            this.createSessionIconButton(actions, 'play', 'Resume', 'ert-timeline-session-panel__primary ert-timeline-session-panel__icon-action', async () => {
                try {
                    await service.resume();
                    this.refreshWritingSessionControl();
                } catch (error) {
                    new Notice(error instanceof Error ? error.message : 'Could not resume writing session.');
                }
            });
        } else {
            this.createSessionIconButton(actions, 'pause', 'Pause', 'ert-timeline-session-panel__secondary ert-timeline-session-panel__icon-action', async () => {
                try {
                    await service.pause();
                    this.refreshWritingSessionControl();
                } catch (error) {
                    new Notice(error instanceof Error ? error.message : 'Could not pause writing session.');
                }
            });
        }
        this.createSessionIconButton(actions, 'save', 'Save', `ert-timeline-session-panel__primary ert-timeline-session-panel__icon-action${statusDisplay.tone === 'complete' ? ' is-save-ready' : ''}`, async () => {
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
                    new Notice(`Saved ${this.formatWritingSessionMode(record.mode)} session (${this.formatSessionClock(record.elapsedMs)}).`);
                    if (feedShare.eligible && completion.postToFeed !== undefined) {
                        // Remember the toggle for the next save, then post.
                        // Posting is best-effort: the session is already saved.
                        await service.setPostSessionsToFeed(completion.postToFeed);
                        if (completion.postToFeed) {
                            try {
                                await postSessionToCommunityFeed(this.plugin, projectSessionFeedPost(record));
                                new Notice('Posted to your community feed.');
                            } catch (postError) {
                                new Notice(postError instanceof Error ? postError.message : 'Could not post to the community feed.');
                            }
                        }
                    }
                    this.refreshWritingSessionControl();
                } catch (error) {
                    new Notice(error instanceof Error ? error.message : 'Could not stop writing session.');
                }
            }).open();
        });
        this.createSessionIconButton(actions, 'trash-2', 'Cancel', 'ert-timeline-session-panel__ghost ert-timeline-session-panel__icon-action', async () => {
            try {
                await service.discard();
                new Notice('Cancelled writing session.');
                this.refreshWritingSessionControl();
            } catch (error) {
                new Notice(error instanceof Error ? error.message : 'Could not cancel writing session.');
            }
        });
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
            return `${typedWords}/${goalWords}w ${minutes}m`;
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
        await this.plugin.saveSettings();

        if (search.active && search.term) {
            this.plugin.performSearch(search.term);
        } else {
            this.searchPanel?.syncFromState();
        }
    }

    private setTimelineSearchButtonMode(mode: 'search' | 'clear'): void {
        if (!this.timelineSearchButton) return;
        this.timelineSearchButtonMode = mode;
        this.timelineSearchButton.empty();
        setIcon(this.timelineSearchButton, mode === 'clear' ? 'search-x' : 'search');
        this.timelineSearchButton.setAttribute('aria-label', mode === 'clear' ? 'Clear timeline search' : 'Search timeline');
        this.timelineSearchButton.setAttribute('title', mode === 'clear' ? 'Clear timeline search' : 'Search timeline');
        this.timelineSearchButton.classList.toggle('is-clear', mode === 'clear');
    }

    private handleTimelineSearchInput(): void {
        if (!this.timelineSearchInput) return;

        const search = this.plugin.searchState;
        const term = this.timelineSearchInput.value.trim();
        if (!term) {
            this.setTimelineSearchButtonMode('search');
            if (search.active || search.term) {
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
            if (search.active || search.term) {
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
        if (search.active || search.term) {
            this.plugin.clearSearch();
        }
    }

    private openRadialTimelineCommands(): void {
        const commandManager = (this.app as unknown as { commands?: { executeCommandById?: (id: string) => void } }).commands;
        if (!commandManager?.executeCommandById) {
            new Notice('Command palette is not available.');
            return;
        }

        commandManager.executeCommandById('command-palette:open');
        this.seedCommandPaletteQuery('Radial Timeline');
    }

    private seedCommandPaletteQuery(query: string, attempt = 0): void {
        const input = activeDocument.querySelector<HTMLInputElement>('.prompt-input');
        if (!input) {
            if (attempt < 8) {
                window.setTimeout(() => this.seedCommandPaletteQuery(query, attempt + 1), 25);
                return;
            }
            new Notice('Command palette opened, but the search box was not found.');
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

        this.timelineLegendPanel.empty();

        const doc = this.timelineLegendPanel.ownerDocument;
        const surface = doc.createElement('div');
        surface.className = 'ert-timeline-legend__surface';

        const header = doc.createElement('div');
        header.className = 'ert-timeline-legend__header';
        const title = doc.createElement('div');
        title.className = 'ert-timeline-legend__title';
        title.textContent = 'Timeline keys';
        const badge = doc.createElement('div');
        badge.className = 'ert-timeline-legend__mode';
        badge.textContent = this.getTimelineLegendModeLabel(mode);
        header.appendChild(title);
        header.appendChild(badge);
        surface.appendChild(header);

        this.getTimelineLegendSections(mode).forEach(section => {
            const sectionEl = doc.createElement('section');
            sectionEl.className = 'ert-timeline-legend__section';

            const sectionTitle = doc.createElement('div');
            sectionTitle.className = 'ert-timeline-legend__section-title';
            sectionTitle.textContent = section.title;
            sectionEl.appendChild(sectionTitle);

            section.rows.forEach(row => {
                const rowEl = doc.createElement('div');
                rowEl.className = 'ert-timeline-legend__row';

                const iconEl = doc.createElement('span');
                iconEl.className = 'ert-timeline-legend__icon';
                if (row.swatch) {
                    iconEl.classList.add('ert-timeline-legend__icon--swatch');
                    const swatchEl = doc.createElement('span');
                    swatchEl.className = 'ert-timeline-legend__swatch';
                    if (row.swatch.fill) swatchEl.style.setProperty('--ert-legend-swatch-fill', row.swatch.fill);
                    if (row.swatch.stroke) swatchEl.style.setProperty('--ert-legend-swatch-stroke', row.swatch.stroke);
                    if (row.swatch.textColor) swatchEl.style.setProperty('--ert-legend-swatch-text', row.swatch.textColor);
                    if (row.swatch.text) swatchEl.textContent = row.swatch.text;
                    iconEl.appendChild(swatchEl);
                } else if (row.icon) {
                    setIcon(iconEl, row.icon);
                }

                const copyEl = doc.createElement('span');
                copyEl.className = 'ert-timeline-legend__copy';
                const labelEl = doc.createElement('span');
                labelEl.className = 'ert-timeline-legend__label';
                labelEl.textContent = row.label;
                copyEl.appendChild(labelEl);

                if (row.detail) {
                    const detailEl = doc.createElement('span');
                    detailEl.className = 'ert-timeline-legend__detail';
                    if (row.detailSegments) {
                        row.detailSegments.forEach(segment => {
                            const segmentEl = detailEl.createSpan({ text: segment.text });
                            if (segment.color) {
                                segmentEl.className = 'ert-timeline-legend__detail-segment';
                                segmentEl.style.setProperty('--ert-legend-segment-color', segment.color);
                            }
                        });
                    } else {
                        detailEl.appendText(row.detail);
                    }
                    if (row.detailIcon) {
                        const detailIconEl = detailEl.createSpan({
                            cls: 'ert-timeline-legend__detail-icon',
                            attr: {
                                'aria-label': row.detailIconLabel || row.detailIcon,
                                title: row.detailIconLabel || row.detailIcon,
                            },
                        });
                        setIcon(detailIconEl, row.detailIcon);
                    }
                    copyEl.appendChild(detailEl);
                }

                rowEl.appendChild(iconEl);
                rowEl.appendChild(copyEl);
                sectionEl.appendChild(rowEl);
            });

            surface.appendChild(sectionEl);
        });

        this.timelineLegendPanel.appendChild(surface);
    }

    private getTimelineLegendModeLabel(mode: string): string {
        if (mode === 'progress') return 'Progress';
        if (mode === 'chronologue') return 'Chronologue';
        return 'Narrative';
    }

    private randomSceneNumber(): string {
        return String(1 + Math.floor(Math.random() * 99));
    }

    private getTimelineLegendSections(mode: string): TimelineLegendSection[] {
        const sections: TimelineLegendSection[] = [
            {
                title: 'Scene Actions',
                rows: [
                    { icon: 'square-mouse-pointer', label: 'Hover scene', detail: mode === 'chronologue' ? 'show property fields and matching scenes' : 'show property fields and expand title *' },
                    { icon: 'mouse-pointer-click', label: 'Click scene', detail: 'open scene note' },
                    { icon: 'mouse', label: 'Right click scene', detail: 'Add scene, set status, stage or flag pulse' },
                ],
            },
        ];

        if (mode === 'narrative') {
            sections.push({
                title: 'Narrative Only',
                rows: [
                    { icon: 'move-horizontal', label: 'Drag outer ring', detail: 'move scene or beat in manuscript order' },
                    { icon: 'layers', label: 'Hold Shift', detail: 'show subplot ring key' },
                ],
            });
        }

        if (mode === 'chronologue') {
            sections.push({
                title: 'Chronologue Only',
                rows: [
                    { icon: 'arrow-left-right', label: 'Shift / Caps Lock', detail: 'compare elapsed time between scenes' },
                    { icon: 'crosshair', label: 'Click while comparing', detail: 'choose the scene pair' },
                ],
            });
        }

        sections.push({
            title: 'Number Square States',
            rows: [
                {
                    swatch: { fill: 'var(--rt-color-due)', stroke: 'var(--rt-color-due)', text: this.randomSceneNumber(), textColor: 'var(--rt-color-empty)' },
                    label: 'Missing date',
                    detail: 'marked Complete but missing WHEN',
                },
                {
                    swatch: { fill: 'var(--interactive-accent)', text: this.randomSceneNumber(), textColor: 'var(--rt-color-empty)' },
                    label: 'Open in tab',
                    detail: 'scene is currently open',
                },
                {
                    swatch: { fill: 'var(--rt-color-search)', text: this.randomSceneNumber(), textColor: 'var(--rt-legacy-black)' },
                    label: 'Search match',
                    detail: 'matches active search',
                },
                {
                    swatch: { fill: 'var(--rt-color-muted-gray)', text: this.randomSceneNumber(), textColor: 'var(--rt-legacy-black)' },
                    label: 'Pending edits',
                    detail: 'AI edits awaiting review',
                },
                {
                    swatch: { fill: 'var(--rt-color-empty)', text: this.randomSceneNumber(), textColor: 'var(--rt-grade-a-color)' },
                    label: 'Pulse AI grade A',
                    detail: 'strong scene',
                },
                {
                    swatch: { fill: 'var(--rt-color-empty)', text: this.randomSceneNumber(), textColor: 'var(--rt-grade-b-color)' },
                    label: 'Pulse AI grade B',
                    detail: 'acceptable',
                },
                {
                    swatch: { fill: 'var(--rt-color-empty)', text: this.randomSceneNumber(), textColor: 'var(--rt-grade-c-color)' },
                    label: 'Pulse AI grade C',
                    detail: 'needs revision',
                },
            ],
        });

        sections.push({
            title: 'Right Click Menu',
            rows: [
                {
                    icon: 'circle-dot',
                    label: 'Set Status',
                    detail: 'Todo, Working, Complete',
                    detailIcon: 'calendar-check',
                    detailIconLabel: 'Complete updates Due Date to today',
                },
                { icon: 'component', label: 'Change Stage', detail: 'Zero, Author, House, Press', detailSegments: this.getStageLegendDetailSegments() },
                { icon: 'flag', label: 'Misc', detail: 'Flag Triplet Pulse' },
            ],
        });

        return sections;
    }

    private getStageLegendDetailSegments(): TimelineLegendDetailSegment[] {
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
            const sagaOption = doc.createElement('option');
            sagaOption.value = SAGA_SCOPE_OPTION;
            sagaOption.textContent = 'Saga';
            select.appendChild(sagaOption);
        }

        books.forEach(book => {
            const option = doc.createElement('option');
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
                    this.plugin._gossamerLastRun
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
                const loadingEl = container.createEl("div", {
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
                container.createEl("div", {
                    cls: "rt-error-message",
                    text: `Error: ${error.message}`
                });
                console.error("Failed to load timeline data", error);
            });
    }
    

    
    private setupMouseCoordinateTracking(container: HTMLElement) {
        // Mouse coordinate tracking disabled - no debug mode toggle exists
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
        if (this._currentMode === 'gossamer' && this.modeManager) {
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
                    new Notice('Gossamer mode could not load. Returning to Narrative mode.', 6000);
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
    
    // Add missing addHighlightRectangles method
    private addHighlightRectangles(): void {
        addHighlightRectanglesExt(this);
    }
    
    renderTimeline(container: HTMLElement, scenes: TimelineItem[]): void {
        // Clear existing content (including the subplot key's document listeners;
        // its DOM lives in the container being emptied)
        if (this._subplotKeyCleanup) {
            this._subplotKeyCleanup();
            this._subplotKeyCleanup = undefined;
        }
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
        const fragment = doc.createDocumentFragment();
        const timelineContainer = doc.createElement("div");
        timelineContainer.className = "radial-timeline-container";
        fragment.appendChild(timelineContainer);
        
        try {
            // Generate the SVG content and get the max stage color
            const renderer = this.rendererService ?? this.plugin.getRendererService();
            const { svgString, maxStageColor: calculatedMaxStageColor } = renderer.renderTimeline(scenes);

            // Expose the dominant publish-stage colour to CSS so rules can use var(--rt-max-publish-stage-color)
            if (calculatedMaxStageColor) {
                doc.documentElement.style.setProperty('--rt-max-publish-stage-color', calculatedMaxStageColor);
            }
            
            // Render directly into the container
            const svgElement = renderSvgFromString(svgString, timelineContainer, (cleanup) => this.register(cleanup));

                if (svgElement) {
                    // Set data-mode attribute for CSS targeting
                    svgElement.setAttribute('data-mode', this.currentMode);
                    
                    // Preserve shift mode state across re-renders (chronologue mode only)
                    if (this.currentMode === 'chronologue' && isShiftModeActive()) {
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

                // Attach Author Progress Indicator click behavior - opens Settings Social tab
                const aprIndicator = svgElement.querySelector('.rt-apr-indicator');
                if (aprIndicator) {
                    this.registerDomEvent(aprIndicator as unknown as HTMLElement, 'click', () => {
                        // Open settings and switch to Social tab
                        if (this.plugin.settingsTab) {
                            this.plugin.settingsTab.setActiveTab('social');
                        }
                        // SAFE: any type used for accessing Obsidian's internal settings API
                        const setting = (this.app as unknown as { setting?: { open: () => void; openTabById: (id: string) => void } }).setting;
                        if (setting) {
                            setting.open();
                            setting.openTabById('radial-timeline');
                        }
                    });
                }

                // Attach Progress Milestone Indicator click behavior - opens Settings Core tab (where progress preview lives)
                const milestoneIndicator = svgElement.querySelector('.rt-milestone-indicator');
                if (milestoneIndicator) {
                    this.registerDomEvent(milestoneIndicator as unknown as HTMLElement, 'click', () => {
                        // Open settings and switch to Core tab (where the progress preview lives)
                        if (this.plugin.settingsTab) {
                            this.plugin.settingsTab.forceExpandCoreCompletionPreview();
                            this.plugin.settingsTab.setActiveTab('core');
                        }
                        // SAFE: any type used for accessing Obsidian's internal settings API
                        const setting = (this.app as unknown as { setting?: { open: () => void; openTabById: (id: string) => void } }).setting;
                        if (setting) {
                            setting.open();
                            setting.openTabById('radial-timeline');
                        }
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
                this.register(() => {
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
                        this.registerDomEvent(svg as unknown as HTMLElement, 'pointerover', (e: PointerEvent) => {
                            const g = (e.target as Element).closest('.rt-scene-group');
                            if (g && g !== lastHoverGroup) {
                                onEnterLeave(true, g);
                                lastHoverGroup = g;
                            }
                        });
                        this.registerDomEvent(svg as unknown as HTMLElement, 'pointerout', (e: PointerEvent) => {
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
                    this.register(() => {
                        if (gossamerOuterRafId !== null) cancelAnimationFrame(gossamerOuterRafId);
                        if (gossamerInnerRafId !== null) cancelAnimationFrame(gossamerInnerRafId);
                    });
                }
            }
            
        } catch (error) {
            console.error("Error rendering timeline:", error);
            container.createEl("div", {
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
        header.textContent = 'Recent moves';
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
        const window_ = this.plugin.gossamerCacheWindow;
        const clock = formatGossamerCacheClock(window_, Date.now());
        if (!clock || !window_) {
            pill.setAttribute('data-state', 'idle');
            pill.textContent = '';
            pill.removeAttribute('data-tooltip-bound');
            return;
        }
        pill.setAttribute('data-state', 'open');
        pill.textContent = `Cache ${clock}`;
        if (pill.getAttribute('data-tooltip-bound') !== 'true') {
            const costHint = formatGossamerCacheCostHint(window_);
            const tip = `Manuscript cached on ${window_.provider} — score the other signals now to reuse it`;
            applyTooltip(pill, costHint ? `${tip} (${costHint})` : tip, 'bottom');
            pill.setAttribute('data-tooltip-bound', 'true');
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
            this.plugin.gossamerLatestOnly ? 'Click to show all traces' : 'Click to show latest only',
            'bottom'
        );
        const buttonLabel = doc.createElementNS(xhtmlNs, 'span');
        if (runs.length === 0) {
            buttonLabel.textContent = '0 TRACES';
        } else if (this.plugin.gossamerLatestOnly) {
            buttonLabel.textContent = 'LATEST';
        } else {
            buttonLabel.textContent = `${runs.length} TRACES`;
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
            empty.textContent = `No ${GOSSAMER_SIGNAL_METADATA[activeSignal].label.toLowerCase()} traces yet.`;
            panel.appendChild(empty);
        }

        const schedulePanelRefresh = () => {
            window.setTimeout(() => {
                this.lastSnapshot = null;
                this.refreshTimeline();
            }, 0);
        };
        const stopRunsEvent = (event: Event) => {
            event.stopPropagation();
        };

        this.registerDomEvent(panel, 'click', stopRunsEvent);
        this.registerDomEvent(panel, 'mousedown', stopRunsEvent);
        this.registerDomEvent(panel, 'mouseup', stopRunsEvent);
        this.registerDomEvent(panel, 'pointerdown', stopRunsEvent);
        this.registerDomEvent(panel, 'pointerup', stopRunsEvent);

        // Pill click: binary toggle — latest-only vs show-all.
        const togglePillMode = (event: Event) => {
            event.stopPropagation();
            if (runs.length === 0) return;
            this.plugin.gossamerLatestOnly = !this.plugin.gossamerLatestOnly;
            this.plugin.gossamerVisibleRunIds = [];
            void this.plugin.saveGossamerRunFilterState();
            schedulePanelRefresh();
        };
        this.registerDomEvent(button, 'click', togglePillMode);
        this.registerDomEvent(button, 'keydown', (event: KeyboardEvent) => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                togglePillMode(event);
            }
        });

        // Signal selector click: switch the plotted signal.
        signalButtons.forEach(({ el, signal }) => {
            this.registerDomEvent(el, 'click', (event) => {
                event.stopPropagation();
                if (this.plugin.gossamerSelectedSignal === signal) return;
                this.plugin.gossamerSelectedSignal = signal;
                // Switching signals resets run-level filters (IDs are signal-scoped).
                this.plugin.gossamerLatestOnly = false;
                this.plugin.gossamerVisibleRunIds = [];
                void this.plugin.saveGossamerRunFilterState();
                schedulePanelRefresh();
            });
            this.registerDomEvent(el, 'mousedown', stopRunsEvent);
            this.registerDomEvent(el, 'pointerdown', stopRunsEvent);
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
            window.setTimeout(() => {
                this.lastSnapshot = null;
                this.refreshTimeline();
            }, 0);
        };
        const stopRunsEvent = (event: Event) => {
            event.stopPropagation();
        };

        this.registerDomEvent(row, 'click', stopRunsEvent);
        this.registerDomEvent(row, 'mousedown', stopRunsEvent);
        this.registerDomEvent(row, 'mouseup', stopRunsEvent);
        this.registerDomEvent(row, 'pointerdown', stopRunsEvent);
        this.registerDomEvent(row, 'pointerup', stopRunsEvent);

        this.registerDomEvent(checkbox, 'change', (event) => {
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
        this.registerDomEvent(checkbox, 'click', stopRunsEvent);
        this.registerDomEvent(checkbox, 'mousedown', stopRunsEvent);
        this.registerDomEvent(checkbox, 'mouseup', stopRunsEvent);
        this.registerDomEvent(checkbox, 'pointerdown', stopRunsEvent);
        this.registerDomEvent(checkbox, 'pointerup', stopRunsEvent);

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
        if (!Number.isFinite(parsed)) return 'Recently';

        const elapsedMs = Date.now() - parsed;
        if (elapsedMs < 60_000) return 'Just now';
        if (elapsedMs < 3_600_000) return `${Math.max(1, Math.floor(elapsedMs / 60_000))}m ago`;
        if (elapsedMs < 86_400_000) return `${Math.max(1, Math.floor(elapsedMs / 3_600_000))}h ago`;

        try {
            return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(parsed));
        } catch {
            return 'Recently';
        }
    }
    
    // New helper removed; interactions moved to modes/AllScenesMode
    
    // Helper method to highlight files in the navigator and tab bar
    private highlightFileInExplorer(filePath: string, isHighlighting: boolean): void {
        if (!filePath) return;
        
        try {
            // Get the file object
            const file = this.plugin.app.vault.getAbstractFileByPath(filePath);
            
            if (file instanceof TFile) {
                // For highlighting, we'll use Obsidian's file explorer API to reveal the file
                if (isHighlighting) {
                    // Use the file explorer view directly
                    const fileExplorer = this.plugin.app.workspace.getLeavesOfType('file-explorer')[0];
                    if (fileExplorer && fileExplorer.view) {
                        // Cast to any to access the internal reveal method
                        interface ExplorerView { revealInFolder(file: TFile): void }
                        const explorerView = fileExplorer.view as unknown as ExplorerView;
                        if (explorerView.revealInFolder) {
                            // SAFE: Using Obsidian's API
                            explorerView.revealInFolder(file);
                        }
                    }
                    
                    // No additional focus behavior required
                } else {
                    // When unhighlighting, we don't need to do anything special.
                    // The hover effect disappears naturally when mouse leaves.
                }
            }
        } catch {
            // Silently handle file highlighting errors
        }
    }

    // Property to track tab highlight timeout
    private _tabHighlightTimeout: number | null = null;
    
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
