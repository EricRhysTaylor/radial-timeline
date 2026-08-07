import { TFile } from 'obsidian';
import { openOrRevealFile } from '../../utils/fileUtils';
import { buildSearchHighlight } from '../../services/searchHighlight';
import { SceneInteractionManager } from '../interactions/SceneInteractionManager';
import { maybeHandleZeroDraftClick } from '../interactions/ZeroDraftHandler';
import { setupSceneContextMenu } from '../interactions/SceneContextMenu';
import type { RadialTimelineView } from '../TimeLineView';

export function setupMainPlotMode(view: RadialTimelineView, svg: SVGSVGElement): void {
    // Main Plot mode shows main plot SCENES (not beats)
    // Story beats are removed entirely in this mode
    // No muting needed - only main plot scenes are rendered
    
    // Note: Don't add 'scene-hover' class here - it hides subplot labels!
    // The class should only be added during actual hover events

    // Create scene interaction manager for title expansion and styling
    const totalActs = Math.max(3, view.plugin.settings.actCount ?? 3);
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

    const getSceneIdFromGroup = (group: Element): string | null => {
        const pathEl = group.querySelector('.rt-scene-path');
        return pathEl?.id || null;
    };

    // Register handlers for Scene elements (main plot scenes)
    view.registerDomEvent(svg as unknown as HTMLElement, 'pointerover', (e: PointerEvent) => {
        if (suspendHoverUntilPointerMove) return;

        const g = (e.target as Element).closest('.rt-scene-group[data-item-type="Scene"]');
        if (!g || g === currentGroup) return;
        
        const sid = getSceneIdFromGroup(g);
        if (!sid) return;
        
        // Clear previous selection
        clearSelection();
        
        // Add scene-hover class to hide subplot labels during hover
        svg.classList.add('scene-hover');
        
        currentGroup = g;
        
        // Use manager for hover interactions (handles title expansion and styling)
        // Pass mouse event to position synopsis immediately and prevent flicker
        manager.onSceneHover(g, sid, e);
    });

    view.registerDomEvent(svg as unknown as HTMLElement, 'pointerout', (e: PointerEvent) => {
        if (suspendHoverUntilPointerMove) return;

        const toEl = e.relatedTarget as Element | null;
        if (currentGroup && toEl && currentGroup.contains(toEl)) return;
        
        // Remove scene-hover class to show subplot labels again
        svg.classList.remove('scene-hover');
        
        clearSelection();
    });

    view.registerDomEvent(svg as unknown as HTMLElement, 'pointermove', (e: PointerEvent) => {
        if (suspendHoverUntilPointerMove) {
            suspendHoverUntilPointerMove = false;
            return;
        }

        if (rafId !== null) return;
        rafId = window.requestAnimationFrame(() => {
            manager.onMouseMove(e);
            rafId = null;
        });
    });
    
    // Cleanup on pointerout
    view.registerDomEvent(svg as unknown as HTMLElement, 'pointerout', () => {
        if (rafId !== null) {
            cancelAnimationFrame(rafId);
            rafId = null;
        }
    });

    view.registerDomEvent(svg as unknown as HTMLElement, 'click', (e: MouseEvent) => { void (async () => {
        const g = (e.target as Element).closest('.rt-scene-group[data-item-type="Scene"]');
        if (!g) return;
        e.stopPropagation();

        // Suspend hover until pointer moves again after click-open.
        // Prevents stale re-hover when timeline remains visible in split panes.
        suspendHoverUntilPointerMove = true;
        svg.classList.remove('scene-hover');
        clearSelection();

        const encodedPath = g.getAttribute('data-path');
        if (!encodedPath) return;
        const filePath = decodeURIComponent(encodedPath);
        const file = view.plugin.app.vault.getAbstractFileByPath(filePath);
        if (file instanceof TFile) {
            const highlight = await buildSearchHighlight(view.plugin.app, file, view.plugin.searchState);

            const zeroDraftHandled = await maybeHandleZeroDraftClick({
                app: view.plugin.app,
                file,
                enableZeroDraftMode: view.plugin.settings.enableZeroDraftMode,
                sceneTitle: file.basename || 'Scene',
                onOverrideOpen: async () => openOrRevealFile(view.plugin.app, file, false, highlight)
            });
            if (zeroDraftHandled) {
                e.preventDefault();
                e.stopPropagation();
                return;
            }
            await openOrRevealFile(view.plugin.app, file, false, highlight);
        }
    })(); });
}
