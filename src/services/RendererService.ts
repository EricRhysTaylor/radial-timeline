/*
 * Renderer Service
 * Abstraction layer for all SVG rendering.
 * Decouples logic from Obsidian-specific view implementation.
 */
import type { TimelineItem } from '../types';
import type RadialTimelinePlugin from '../main';
import { addHighlightRectangles as addHighlightRectanglesExt } from '../view/interactions';
import { renderGossamerLayer } from '../renderer/gossamerLayer';
import { renderGossamerMonthSpokes } from '../renderer/components/MonthSpokes';
import { renderProgressRing, resolveProgressEstimate, resolveProgressRingDate } from '../renderer/components/ProgressRing';
import { renderTargetDateTick, type TargetTickEnhancedData } from '../renderer/components/ProgressTicks';
import { renderEstimatedDateElements, renderEstimationArc } from '../renderer/components/Progress';
import { renderCenterGrid } from '../renderer/components/Grid';
import { computeGridData } from '../renderer/utils/GridData';
import {
    GRID_CELL_BASE,
    GRID_CELL_WIDTH_EXTRA,
    GRID_CELL_GAP_X,
    GRID_CELL_GAP_Y,
    GRID_HEADER_OFFSET_Y,
} from '../renderer/layout/LayoutConstants';
import { dateToAngle } from '../utils/date';
// Import new DOM updaters
import { updateSceneColors, updateSceneFills } from '../renderer/dom/SceneDOMUpdater';
import { updateNumberSquareStates } from '../renderer/dom/NumberSquareDOMUpdater';
import { updateSynopsisText, updateSynopsisVisibility } from '../renderer/dom/SynopsisDOMUpdater';
import { updateSubplotLabels } from '../renderer/dom/SubplotLabelDOMUpdater';
import { createTimelineSVG as buildTimelineSVG } from '../renderer/TimelineRenderer';
import { adjustBeatLabelsAfterRender } from '../renderer/dom/BeatLabelAdjuster';
import { PluginRendererFacade, isBeatNote, isSceneItem } from '../utils/sceneHelpers';
import type { CompletionEstimate } from './TimelineMetricsService';
import { STAGE_ORDER, STAGES_FOR_GRID, STATUSES_FOR_GRID } from '../utils/constants';
import { AuthorProgressService } from './AuthorProgressService';
import type { MilestoneInfo } from '../renderer/components/MilestoneIndicator';

const STAGE_HEADER_TOOLTIPS: Record<string, string> = {
    Zero: 'Zero stage — The raw first draft. Unpolished ideas on the page, no revisions yet.',
    Author: 'Author stage — The author revises and refines the draft after letting it rest.',
    House: 'House stage — Alpha and beta readers give feedback. Publisher or editor reviews the manuscript. Copy-edited and proofed.',
    Press: 'Press stage — Final version is ready for release.'
};

const STATUS_HEADER_TOOLTIPS: Record<string, string> = {
    Todo: 'Scenes waiting to be written or revised.',
    Working: 'Scenes currently in progress.',
    Due: 'Scenes whose due date has passed and are not complete.',
    Completed: 'Scenes complete for their current publish stage.'
};

export interface RenderResult {
    svgString: string;
    maxStageColor: string;
}

export class RendererService {
    constructor(private plugin: RadialTimelinePlugin) {}

    /**
     * SAFE: RadialTimelinePlugin structurally satisfies the renderer facade; the
     * conversion through unknown keeps renderer modules decoupled from the full
     * plugin type (the facade narrows Obsidian's workspace surface).
     */
    private static asFacade(plugin: RadialTimelinePlugin): PluginRendererFacade {
        return plugin as unknown as PluginRendererFacade;
    }

    public renderTimeline(scenes: TimelineItem[]): RenderResult {
        const pluginFacade = RendererService.asFacade(this.plugin);

        // Check if APR needs refresh (stale check)
        let aprNeedsRefresh = false;
        try {
            const aprService = new AuthorProgressService(this.plugin, this.plugin.app);
            aprNeedsRefresh = aprService.isStale();
        } catch {
            // AuthorProgressService not available - skip indicator
        }
        
        // Detect progress milestones (stage completions, staleness encouragement)
        const milestone = this.detectProgressMilestone(scenes);
        
        return buildTimelineSVG(pluginFacade, scenes, { aprNeedsRefresh, milestone });
    }

    /**
     * Get milestone using the shared MilestonesService.
     * This ensures the timeline indicator always matches the Progress Tracker in settings.
     * 
     * Note: This is the MILESTONES system (stage completions), separate from
     * TimelineMetricsService which handles estimation/tick tracking.
     */
    private detectProgressMilestone(scenes: TimelineItem[]): MilestoneInfo | null {
        // Use the shared service - single source of truth
        // This ensures timeline indicator matches ProgressSection progress tracker exactly
        return this.plugin.milestonesService.detectMilestone(scenes);
    }

    public generateTimeline(scenes: TimelineItem[]): RenderResult {
        return this.renderTimeline(scenes);
    }

    adjustBeatLabelsAfterRender(container: HTMLElement): void {
        adjustBeatLabelsAfterRender(container);
    }

    /**
     * Update scene colors for dominant subplot changes (DOM update)
     */
    updateSceneColorsDOM(container: HTMLElement, plugin: RadialTimelinePlugin, changedScenes: TimelineItem[]): boolean {
        const svg = container.querySelector<SVGSVGElement>('.radial-timeline-svg');
        if (!svg) return false;
        return updateSceneColors(svg, RendererService.asFacade(plugin), changedScenes);
    }

    /**
     * Update scene fills for visual-only YAML changes (DOM update)
     */
    updateSceneFillsDOM(container: HTMLElement, plugin: RadialTimelinePlugin, changedScenes: TimelineItem[]): boolean {
        const svg = container.querySelector<SVGSVGElement>('.radial-timeline-svg');
        if (!svg) return false;
        return updateSceneFills(svg, RendererService.asFacade(plugin), changedScenes);
    }

    /**
     * Update center stage/status matrix for visual YAML changes.
     */
    updateCenterGridDOM(container: HTMLElement, scenes: TimelineItem[]): boolean {
        const svg = container.querySelector<SVGSVGElement>('.radial-timeline-svg');
        if (!svg) return false;

        const existingGrid = svg.querySelector('.rt-center-stage-grid');
        if (!existingGrid?.parentNode) return false;

        const {
            gridCounts,
            gridSceneNames,
            gridStageStates,
            isBookComplete,
            estimatedTotalScenes,
            totalRuntimeSeconds,
        } = computeGridData(scenes);

        const stagesForGrid = [...STAGES_FOR_GRID];
        const statusesForGrid = [...STATUSES_FOR_GRID];
        const cellWidth = Math.round(GRID_CELL_BASE * 1.5) + GRID_CELL_WIDTH_EXTRA;
        const cellHeight = GRID_CELL_BASE;
        const cellGapX = GRID_CELL_GAP_X;
        const cellGapY = GRID_CELL_GAP_Y;
        const gridWidth = statusesForGrid.length * cellWidth + (statusesForGrid.length - 1) * cellGapX;
        const gridHeight = stagesForGrid.length * cellHeight + (stagesForGrid.length - 1) * cellGapY;
        const startXGrid = -gridWidth / 2;
        const startYGrid = -gridHeight / 2;
        const headerY = startYGrid - (cellGapY + GRID_HEADER_OFFSET_Y);

        const gridHtml = renderCenterGrid({
            statusesForGrid,
            stagesForGrid,
            gridCounts,
            gridSceneNames,
            gridStageStates,
            isBookComplete,
            PUBLISH_STAGE_COLORS: this.plugin.settings.publishStageColors,
            currentYearLabel: String(new Date().getFullYear()),
            estimatedTotalScenes,
            totalRuntimeSeconds,
            startXGrid,
            startYGrid,
            cellWidth,
            cellHeight,
            cellGapX,
            cellGapY,
            headerY,
            stageTooltips: STAGE_HEADER_TOOLTIPS,
            statusTooltips: STATUS_HEADER_TOOLTIPS,
            runtimeContentType: this.plugin.settings.runtimeContentType === 'screenplay' ? 'screenplay' : 'novel',
        });

        const parser = new DOMParser();
        const doc = parser.parseFromString(`<svg xmlns="http://www.w3.org/2000/svg">${gridHtml}</svg>`, 'image/svg+xml');
        const newGrid = doc.documentElement.querySelector('.rt-center-stage-grid');
        if (!newGrid) return false;

        existingGrid.parentNode.replaceChild(svg.ownerDocument.importNode(newGrid, true), existingGrid);
        return true;
    }

    /**
     * Update number square states (status, AI grades) (DOM update)
     * Accepts either (container, plugin) or (container, plugin, scenes) for compatibility
     */
    updateNumberSquaresDOM(container: HTMLElement, pluginOrScenes: RadialTimelinePlugin | TimelineItem[], scenes?: TimelineItem[]): boolean {
        const svg = container.querySelector<SVGSVGElement>('.radial-timeline-svg');
        if (!svg) return false;
        
        // Handle both signatures: (container, plugin) and (container, plugin, scenes)
        if (Array.isArray(pluginOrScenes)) {
            return updateNumberSquareStates(svg, RendererService.asFacade(this.plugin), pluginOrScenes);
        }
        const plugin = pluginOrScenes;
        const sceneData = scenes || plugin.lastSceneData || [];
        return updateNumberSquareStates(svg, RendererService.asFacade(plugin), sceneData);
    }

    /**
     * Update synopsis text content (DOM update)
     * Accepts either (container, scenes) or (container, plugin) for compatibility
     */
    updateSynopsisDOM(container: HTMLElement, pluginOrScenes: RadialTimelinePlugin | TimelineItem[]): boolean {
        const svg = container.querySelector<SVGSVGElement>('.radial-timeline-svg');
        if (!svg) return false;
        
        // Handle both signatures
        if (Array.isArray(pluginOrScenes)) {
            return updateSynopsisText(svg, pluginOrScenes);
        }
        // If plugin passed, get scenes from it
        const scenes = pluginOrScenes.lastSceneData || [];
        updateSynopsisText(svg, scenes);
        updateSynopsisVisibility(svg, pluginOrScenes.openScenePaths || new Set());
        return true;
    }

    /**
     * Update subplot labels for mode changes (DOM update)
     */
    updateSubplotLabelsDOM(container: HTMLElement, newLabels: Map<string, string>): boolean {
        const svg = container.querySelector<SVGSVGElement>('.radial-timeline-svg');
        if (!svg) return false;
        return updateSubplotLabels(svg, newLabels);
    }

    /**
     * Update open-file visual state without full re-render.
     * Adds/removes rt-scene-is-open classes on scene groups and associated number elements.
     */
    updateOpenClasses(container: HTMLElement, openPaths: Set<string>): boolean {
        const svg = container.querySelector<SVGSVGElement>('.radial-timeline-svg');
        if (!svg) return false;

        const sceneGroups = Array.from(svg.querySelectorAll('.rt-scene-group'));
        sceneGroups.forEach(group => {
            const encPath = group.getAttribute('data-path');
            const path = encPath ? decodeURIComponent(encPath) : '';
            const isOpen: boolean = path !== '' && openPaths.has(path);

            // Toggle group-level open class
            group.classList.toggle('rt-scene-is-open', isOpen);

            const scenePath = group.querySelector('.rt-scene-path');
            const sceneTitle = group.querySelector('.rt-scene-title');
            if (scenePath) scenePath.classList.toggle('rt-scene-is-open', isOpen);
            if (sceneTitle) sceneTitle.classList.toggle('rt-scene-is-open', isOpen);

            const sceneId = (scenePath as SVGPathElement | null)?.id;
            if (sceneId) {
                const numSquare = svg.querySelector(`.rt-number-square[data-scene-id="${sceneId}"]`);
                const numText = svg.querySelector(`.rt-number-text[data-scene-id="${sceneId}"]`);
                if (numSquare) numSquare.classList.toggle('rt-scene-is-open', isOpen);
                if (numText) numText.classList.toggle('rt-scene-is-open', isOpen);
            }
        });

        return true;
    }

    /**
     * Rebuild search highlights without full re-render.
     * Clears previous rt-search-term nodes and rt-search-result classes,
     * then re-applies highlights using existing logic.
     *
     * Reads the term and scope from `plugin.searchState` — deliberately not a
     * parameter, so a caller cannot pass one term while the state holds another.
     */
    updateSearchHighlights(containerEl: HTMLElement): boolean {
        // Find actual container (may be wrapped)
        const container = containerEl.children[1] as HTMLElement | undefined ?? containerEl;
        const svg = container.querySelector<SVGSVGElement>('.radial-timeline-svg');
        if (!svg) return false;

        // Remove existing inline tspan markers for synopsis text highlighting
        const existing = svg.querySelectorAll('.rt-search-term');
        existing.forEach(node => {
            const parent = node.parentNode;
            if (!parent) return node.remove();
            const textNode = svg.ownerDocument.createTextNode(node.textContent || '');
            parent.replaceChild(textNode, node);
        });

        // Re-apply text highlights if search is active
        try {
            // addHighlightRectangles expects a view-like object with contentEl + plugin
            addHighlightRectanglesExt({
                contentEl: container,
                plugin: this.plugin,
                renderScope: {
                    register: () => { /* no-op: highlights don't attach events */ },
                    registerDomEvent: () => { /* no-op: highlights don't attach events */ }
                }
            });
        } catch { /* highlight refresh is best-effort */ }
        return true;
    }

    /**
     * Selectively rebuild or remove the Gossamer layer and spokes inside the existing SVG.
     */
    updateGossamerLayer(view: { containerEl: HTMLElement; plugin: RadialTimelinePlugin; sceneData?: TimelineItem[]; currentMode?: string }): boolean {
        const container = view.containerEl.children[1] as HTMLElement | undefined;
        if (!container) return false;
        const svg = container.querySelector<SVGSVGElement>('.radial-timeline-svg');
        if (!svg) return false;

        const applyGossamerMask = () => {
            if (view.currentMode === 'gossamer') {
                svg.setAttribute('data-gossamer-mode', 'true');
                const elements = svg.querySelectorAll('.rt-scene-path, .rt-number-square, .rt-number-text, .rt-scene-title');
                elements.forEach(el => {
                    const group = el.closest('.rt-scene-group');
                    const itemType = group?.getAttribute('data-item-type');
                    if (itemType !== 'Beat') {
                        el.classList.add('rt-non-selected');
                    }
                });
            } else {
                svg.removeAttribute('data-gossamer-mode');
            }
        };

        const removeExisting = () => {
            svg.querySelectorAll('.rt-gossamer-layer, .rt-gossamer-spokes').forEach(node => node.parentNode?.removeChild(node));
        };

        const captureGeometry = () => {
            let innerRadius: number | null = null;
            let outerRadius: number | null = null;
            const existingGossamerSpoke = svg.querySelector('.rt-gossamer-spokes line');
            if (existingGossamerSpoke) {
                const x1 = Number(existingGossamerSpoke.getAttribute('x1') || '0');
                const y1 = Number(existingGossamerSpoke.getAttribute('y1') || '0');
                const x2 = Number(existingGossamerSpoke.getAttribute('x2') || '0');
                const y2 = Number(existingGossamerSpoke.getAttribute('y2') || '0');
                innerRadius = Math.hypot(x1, y1);
                outerRadius = Math.hypot(x2, y2);
            }
            const beatGroups = Array.from(svg.querySelectorAll('.rt-scene-group[data-item-type="Beat"]'));
            if (beatGroups.length > 0) {
                if (innerRadius === null || !Number.isFinite(innerRadius)) {
                    const inners = beatGroups.map(g => Number(g.getAttribute('data-inner-r') || '0')).filter(n => Number.isFinite(n));
                    if (inners.length > 0) innerRadius = Math.min(...inners);
                }
                if (outerRadius === null || !Number.isFinite(outerRadius)) {
                    const outers = beatGroups.map(g => Number(g.getAttribute('data-outer-r') || '0')).filter(n => Number.isFinite(n));
                    if (outers.length > 0) outerRadius = Math.max(...outers);
                }
            }
            if (innerRadius === null || !Number.isFinite(innerRadius)) innerRadius = 200;
            if (outerRadius === null || !Number.isFinite(outerRadius)) outerRadius = innerRadius + 300;

            let outerRingInnerRadius = innerRadius;
            if (beatGroups.length > 0) {
                const inners = beatGroups.map(g => Number(g.getAttribute('data-inner-r') || '0')).filter(n => Number.isFinite(n));
                if (inners.length > 0) outerRingInnerRadius = Math.min(...inners);
            }

            return { innerRadius, outerRadius, outerRingInnerRadius };
        };

        const isGossamerMode = view.currentMode === 'gossamer';
        if (!isGossamerMode) {
            removeExisting();
            applyGossamerMask();
            return true;
        }

        const run = view.plugin._gossamerLastRun || null;
        if (!run) {
            removeExisting();
            applyGossamerMask();
            return false;
        }

        const scenes: TimelineItem[] = Array.isArray(view.sceneData) && view.sceneData.length > 0
            ? view.sceneData
            : (view.plugin.lastSceneData || []);

        const anglesByBeat: Map<string, number> = view.plugin._beatAngles || new Map<string, number>();
        const beatSlicesByName: Map<string, { startAngle: number; endAngle: number; innerR: number; outerR: number }>
            = view.plugin._beatSlices || new Map();

        const beatPathByName = new Map<string, string>();
        const publishStageColorByBeat = new Map<string, string>();
        if (scenes.length > 0) {
            scenes.forEach(s => {
                if (!isBeatNote(s) || !s.title) return; // Modern 'Beat' + legacy 'Plot'
                const titleWithoutNumber = (s.title || '').replace(/^\s*\d+(?:\.\d+)?\s+/, '').trim();
                if (s.path) beatPathByName.set(titleWithoutNumber, s.path);
            });
        }

        const { innerRadius, outerRadius, outerRingInnerRadius } = captureGeometry();
        removeExisting();

        const historicalRuns = view.plugin._gossamerHistoricalRuns || [];
        const minMax = view.plugin._gossamerMinMax || undefined;

        const spokesHtml = renderGossamerMonthSpokes({
            innerRadius,
            outerRadius,
            numActs: this.plugin.settings?.actCount ?? 3
        });
        const layerHtml = renderGossamerLayer(
            scenes || [],
            run,
            { innerRadius, outerRadius },
            anglesByBeat.size ? anglesByBeat : undefined,
            beatPathByName.size ? beatPathByName : undefined,
            historicalRuns,
            minMax,
            outerRingInnerRadius,
            publishStageColorByBeat.size ? publishStageColorByBeat : undefined,
            beatSlicesByName,
            this.plugin.settings?.publishStageColors
        );

        const toNode = (html: string): SVGElement | null => {
            if (!html) return null;
            const parser = new DOMParser();
            const doc = parser.parseFromString(`<svg xmlns="http://www.w3.org/2000/svg">${html}</svg>`, 'image/svg+xml');
            return (doc.documentElement.firstElementChild as SVGElement | null);
        };

        const spokesNode = toNode(spokesHtml);
        const layerNode = toNode(layerHtml);
        if (!spokesNode && !layerNode) {
            applyGossamerMask();
            return false;
        }

        const firstSynopsis = svg.querySelector('.rt-scene-info');
        if (firstSynopsis) {
            if (spokesNode) firstSynopsis.parentNode?.insertBefore(spokesNode, firstSynopsis);
            if (layerNode) firstSynopsis.parentNode?.insertBefore(layerNode, firstSynopsis);
        } else {
            if (spokesNode) svg.appendChild(spokesNode);
            if (layerNode) svg.appendChild(layerNode);
        }

        applyGossamerMask();
        return true;
    }

    /**
     * Selectively update the year progress ring, target-date tick/marker,
     * and estimated date elements without full re-render.
     */
    updateProgressAndTicks(containerEl: HTMLElement | { containerEl?: HTMLElement }, _currentSceneId?: string | null): boolean {
        const rootEl = containerEl instanceof HTMLElement ? containerEl : containerEl.containerEl;
        if (!rootEl) return false;
        const container = (rootEl.querySelector('.radial-timeline-container')) ?? rootEl;
        const svg = container.querySelector<SVGSVGElement>('.radial-timeline-svg');
        if (!svg) return false;

        const baseCircle = svg.querySelector('circle.progress-ring-base');
        if (!baseCircle) return false;
        const progressRadius = Number(baseCircle.getAttribute('r') || '0');
        if (!Number.isFinite(progressRadius) || progressRadius <= 0) return false;

        svg.querySelectorAll('path.progress-ring-fill').forEach(n => n.parentNode?.removeChild(n));
        svg.querySelectorAll('.rt-target-tick-group, line.target-date-tick, rect.target-date-marker, .rt-target-hotspot').forEach(n => n.parentNode?.removeChild(n));
        svg.querySelectorAll('.rt-estimate-tick-group, line.estimated-date-tick, circle.estimated-date-dot, .rt-estimate-hotspot').forEach(n => n.parentNode?.removeChild(n));
        svg.querySelectorAll('path.progress-ring-base').forEach(n => n.parentNode?.removeChild(n));

        const scenes: TimelineItem[] = this.plugin.lastSceneData || [];
        const now = resolveProgressRingDate(RendererService.asFacade(this.plugin), scenes);
        const startOfYear = new Date(now.getFullYear(), 0, 1);
        const yearProgress = (now.getTime() - startOfYear.getTime()) / (1000 * 60 * 60 * 24 * 365);
        const currentYearStartAngle = -Math.PI / 2;

        const segmentsHtml = renderProgressRing({ progressRadius, yearProgress, currentYearStartAngle, segmentCount: 6 });
        
        // Get scenes and estimate for enhanced tick tooltips
        let enhancedData: TargetTickEnhancedData | undefined;
        let estimateResult: CompletionEstimate | null = null;

        try {
            if (scenes.length > 0) {
                estimateResult = resolveProgressEstimate(RendererService.asFacade(this.plugin), scenes, this.plugin.calculateCompletionEstimate(scenes));
                enhancedData = this.calculateTargetTickEnhancedData(scenes, estimateResult);
            }
        } catch { /* enhanced tick data is optional */ }

        const tickHtml = renderTargetDateTick({ plugin: RendererService.asFacade(this.plugin), progressRadius, dateToAngle, enhancedData });

        let estimationHtml = '';
        try {
            if (estimateResult && this.plugin.settings?.showCompletionEstimate !== false) {
                if (estimateResult.date) {
                    const yearsDiff = estimateResult.date.getFullYear() - now.getFullYear();
                    if (yearsDiff <= 0) {
                        estimationHtml += renderEstimationArc({ estimateDate: estimateResult.date, progressRadius });
                    }
                }
                estimationHtml += renderEstimatedDateElements({ estimate: estimateResult, progressRadius });
            }
        } catch { /* estimation rendering is optional */ }

        const combined = `${estimationHtml}${segmentsHtml}${tickHtml}`;

        const parser = new DOMParser();
        const doc = parser.parseFromString(`<svg xmlns="http://www.w3.org/2000/svg">${combined}</svg>`, 'image/svg+xml');
        const toInsert: Element[] = Array.from(doc.documentElement.children);
        if (toInsert.length === 0) return true;

        const parent = baseCircle.parentNode;
        if (!parent) return false;
        const nextSibling = baseCircle.nextSibling;
        toInsert.forEach(el => parent.insertBefore(svg.ownerDocument.importNode(el, true), nextSibling));
        return true;
    }
    
    /**
     * Calculate enhanced data for target tick tooltips.
     */
    private calculateTargetTickEnhancedData(
        scenes: TimelineItem[],
        estimate: { date: Date | null; rate: number; stage: string } | null
    ): TargetTickEnhancedData | undefined {
        const realScenes = scenes.filter(isSceneItem);
        if (realScenes.length === 0) return undefined;
        
        const stageRemaining: Record<typeof STAGE_ORDER[number], number> = {
            Zero: 0, Author: 0, House: 0, Press: 0
        };
        
        const normalizeStage = (raw: unknown): typeof STAGE_ORDER[number] => {
            const v = (typeof raw === 'string' ? raw : 'Zero').trim().toLowerCase();
            const match = STAGE_ORDER.find(stage => stage.toLowerCase() === v);
            return match ?? 'Zero';
        };
        
        const isCompleted = (status: unknown): boolean => {
            const val = Array.isArray(status) ? status[0] : status;
            const normalized = (val ?? '').toString().trim().toLowerCase();
            return normalized === 'complete' || normalized === 'completed' || normalized === 'done';
        };
        
        const seenPaths = new Set<string>();
        for (const scene of realScenes) {
            if (scene.path && seenPaths.has(scene.path)) continue;
            if (scene.path) seenPaths.add(scene.path);
            if (!isCompleted(scene.status)) {
                const stage = normalizeStage(scene['Publish Stage']);
                stageRemaining[stage]++;
            }
        }
        
        return {
            stageRemaining,
            currentPace: estimate?.rate ?? 0,
            estimatedStage: (estimate?.stage as typeof STAGE_ORDER[number] | null) ?? null,
            estimatedDate: estimate?.date ?? null
        };
    }
}
