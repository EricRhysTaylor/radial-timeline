import { TFile } from 'obsidian';
import { openOrRevealFile } from '../../utils/fileUtils';
import { buildSearchHighlight } from '../../services/searchHighlight';
import type { TimelineItem } from '../../types';
import { handleDominantSubplotSelection } from '../interactions/DominantSubplotHandler';
import { SceneInteractionManager } from '../interactions/SceneInteractionManager';
import { OuterRingDragController, isDragInProgress, isDragInteractionActive, wasRecentlyHandledByDrag } from '../interactions/OuterRingDragController';
import { maybeHandleZeroDraftClick } from '../interactions/ZeroDraftHandler';
import { setupSceneContextMenu } from '../interactions/SceneContextMenu';
import type { RadialTimelineView } from '../TimeLineView';

export function setupSceneInteractions(view: RadialTimelineView, group: Element, svgElement: SVGSVGElement, scenes: TimelineItem[]): void {
    if (view.currentMode !== 'narrative') return;

    const path = group.querySelector('.rt-scene-path');
    if (!path) return;

    const encodedPath = group.getAttribute('data-path');
    if (encodedPath && encodedPath !== '') {
        const filePath = decodeURIComponent(encodedPath);
        view.renderScope.registerDomEvent(path as HTMLElement, 'click', (evt: MouseEvent) => { void (async () => {
            // Skip if drag controller is handling this interaction
            // The drag controller handles click-to-open for quick clicks and drag operations
            if (isDragInProgress() || wasRecentlyHandledByDrag()) return;

            // Suspend hover until pointer moves again after click-open.
            // This prevents immediate stale re-hover when the timeline stays visible in a split pane.
            svgElement.dispatchEvent(new CustomEvent('rt-scene-open-begin', { bubbles: true }));
            
            const file = view.plugin.app.vault.getAbstractFileByPath(filePath);
            if (!(file instanceof TFile)) return;
            
            // Handle dominant subplot selection for scenes in multiple subplots
            await handleDominantSubplotSelection(view, group, svgElement, scenes);

            // Built once and reused by both open paths, so a Zero Draft
            // override lands on the passage too.
            const highlight = await buildSearchHighlight(view.plugin.app, file, view.plugin.searchState);

            const zeroDraftHandled = await maybeHandleZeroDraftClick({
                app: view.plugin.app,
                file,
                enableZeroDraftMode: view.plugin.settings.enableZeroDraftMode,
                sceneTitle: file.basename || 'Scene',
                onOverrideOpen: async () => openOrRevealFile(view.plugin.app, file, false, highlight)
            });
            if (zeroDraftHandled) {
                evt.preventDefault();
                evt.stopPropagation();
                return;
            }

            await openOrRevealFile(view.plugin.app, file, false, highlight);
        })(); });

        view.renderScope.registerDomEvent(group as HTMLElement, 'mouseenter', () => {
            const itemType = group.getAttribute('data-item-type');
            if (view.currentMode === 'gossamer' && itemType !== 'Beat') return;
        });
        view.renderScope.registerDomEvent(group as HTMLElement, 'mouseleave', () => {
            const itemType = group.getAttribute('data-item-type');
            if (view.currentMode === 'gossamer' && itemType !== 'Beat') return;
        });
    }
}

export function setupAllScenesDelegatedHover(view: RadialTimelineView, container: HTMLElement, scenes: TimelineItem[]): void {
    const svg = container.querySelector<SVGSVGElement>('.radial-timeline-svg');
    if (!svg) return;
    
    // Create scene interaction manager
    // Prefer SVG's declared segment count for accurate hover redistribution; fall back to settings.
    const svgActsAttr = svg.getAttribute('data-segment-count') ?? svg.getAttribute('data-num-acts');
    const svgActs = svgActsAttr ? parseInt(svgActsAttr, 10) : NaN;
    const totalActs = Number.isFinite(svgActs) && svgActs >= 1
        ? svgActs
        : Math.max(3, view.plugin.settings.actCount ?? 3);
    const manager = new SceneInteractionManager(view, svg, totalActs);
    // Keep manager enabled in this mode and read the user setting live at hover-time.
    // This allows toggling auto-expand without reopening the timeline view.
    manager.setTitleExpansionEnabled(true);
    setupSceneContextMenu(view, svg);

    let currentGroup: Element | null = null;
    let rafId: number | null = null;
    let suspendHoverUntilPointerMove = false;

    const clearSelection = () => {
        manager.onSceneLeave();
        currentGroup = null;
    };

    // Custom event name isn't part of HTMLElementEventMap, so register directly.
    // SAFE: listener removed via view.renderScope.register() (Component lifecycle cleanup).
    const onSceneOpenBegin = () => {
        suspendHoverUntilPointerMove = true;
        svg.classList.remove('scene-hover');
        clearSelection();
    };
    svg.addEventListener('rt-scene-open-begin', onSceneOpenBegin);
    view.renderScope.register(() => svg.removeEventListener('rt-scene-open-begin', onSceneOpenBegin));

    const getSceneIdFromGroup = (group: Element): string | null => {
        const pathEl = group.querySelector('.rt-scene-path');
        return pathEl?.id || null;
    };

    view.renderScope.registerDomEvent(svg as unknown as HTMLElement, 'pointerover', (e: PointerEvent) => {
        if (suspendHoverUntilPointerMove) return;

        if (isDragInteractionActive()) {
            if (currentGroup) {
                svg.classList.remove('scene-hover');
                clearSelection();
            }
            return;
        }

        // Check SVG data-mode attribute for definitive mode state
        const svgMode = svg.getAttribute('data-mode');
        if (svgMode === 'gossamer') return;
        
        const g = (e.target as Element).closest('.rt-scene-group');
        if (!g || g === currentGroup) return;
        clearSelection();
        const sid = getSceneIdFromGroup(g);
        if (!sid) return;
        svg.classList.add('scene-hover');
        currentGroup = g;
        
        // Use manager for hover interactions - pass mouse event to position synopsis immediately
        manager.onSceneHover(g, sid, e);
    });

    view.renderScope.registerDomEvent(svg as unknown as HTMLElement, 'pointerout', (e: PointerEvent) => {
        if (suspendHoverUntilPointerMove) return;

        if (isDragInteractionActive()) {
            if (currentGroup) {
                svg.classList.remove('scene-hover');
                clearSelection();
            }
            return;
        }

        // Check SVG data-mode attribute for definitive mode state  
        const svgMode = svg.getAttribute('data-mode');
        if (svgMode === 'gossamer') return;
        
        const toEl = e.relatedTarget as Element | null;
        if (currentGroup && toEl && currentGroup.contains(toEl)) return;
        svg.classList.remove('scene-hover');
        clearSelection();
    });

    view.renderScope.registerDomEvent(svg as unknown as HTMLElement, 'pointermove', (e: PointerEvent) => {
        if (suspendHoverUntilPointerMove) {
            suspendHoverUntilPointerMove = false;
            return;
        }

        if (isDragInteractionActive()) {
            if (currentGroup) {
                svg.classList.remove('scene-hover');
                clearSelection();
            }
            return;
        }

        if (rafId !== null) return;
        rafId = window.requestAnimationFrame(() => {
            manager.onMouseMove(e);
            rafId = null;
        });
    });
    
    // Cleanup on pointerout
    view.renderScope.registerDomEvent(svg as unknown as HTMLElement, 'pointerout', () => {
        if (rafId !== null) {
            cancelAnimationFrame(rafId);
            rafId = null;
        }
    });
}

export function setupOuterRingDrag(view: RadialTimelineView, svg: SVGSVGElement): void {
    if (view.plugin.settings.timelineScope === 'saga') return;

    const controller = new OuterRingDragController(view, svg, {
        onRefresh: () => {
            // Use direct refresh (bypasses debounce) for immediate update after drag operations
            view.refreshTimeline();
        },
        enableDebug: view.plugin.settings.enableHoverDebugLogging,
        mode: view.currentMode,
    });
    controller.attach();
}
