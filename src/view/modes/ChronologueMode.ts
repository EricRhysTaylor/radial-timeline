/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 */

import { TFile } from 'obsidian';
import { setupChronologueShiftController, isShiftModeActive, isAlienModeActive, isRuntimeModeActive } from '../interactions/ChronologueShiftController';
import { ChronologueDragController, wasRecentlyHandledByChronologueDrag } from '../interactions/ChronologueDragController';
import { openOrRevealFile } from '../../utils/fileUtils';
import { buildSearchHighlight } from '../../services/searchHighlight';
import { handleDominantSubplotSelection } from '../interactions/DominantSubplotHandler';
import { SceneInteractionManager } from '../interactions/SceneInteractionManager';
import { updateSynopsisTitleColor } from '../interactions/SynopsisTitleColorManager';
import { maybeHandleZeroDraftClick } from '../interactions/ZeroDraftHandler';
import { setupSceneContextMenu } from '../interactions/SceneContextMenu';
import type { RadialTimelineView } from '../TimeLineView';

/**
 * Setup Chronologue Mode interactions
 * Handles scene hover/click interactions and integrates with shift mode
 */
export function setupChronologueMode(view: RadialTimelineView, svg: SVGSVGElement): void {
    // Only setup if in Chronologue mode
    if (view.currentMode !== 'chronologue') {
        return;
    }

    // Setup shift mode controller - pass view directly like yesterday
    setupChronologueShiftController(view, svg);

    // Drag-to-re-date on the outer ring. Writes only When — never renumbers.
    setupChronologueDrag(view, svg);

    // Standard scene hover interactions (will check shift mode internally)
    setupSceneHoverInteractions(view, svg);

    // Scene click interactions (will delegate to shift mode if active)
    setupSceneClickInteractions(view, svg);

    setupSceneContextMenu(view, svg);
}

/**
 * Setup drag-to-re-date on the Chronologue outer ring.
 *
 * Saga scope spans multiple books and has no single chronology to place into,
 * so it is excluded — matching the narrative drag guard.
 */
function setupChronologueDrag(view: RadialTimelineView, svg: SVGSVGElement): void {
    if (view.plugin.settings.timelineScope === 'saga') return;

    const controller = new ChronologueDragController(view, svg, {
        onRefresh: () => view.refreshTimeline()
    });
    controller.attach();
}

/**
 * Setup scene hover interactions for synopsis display
 */
function setupSceneHoverInteractions(view: RadialTimelineView, svg: SVGSVGElement): void {
    // Create scene interaction manager for title expansion
    const totalActs = Math.max(3, view.plugin.settings.actCount ?? 3);
    const manager = new SceneInteractionManager(view, svg, totalActs);

    // ALWAYS DISABLE title expansion in Chronologue mode:
    // - Not needed: Chronological order focuses on temporal relationships, not scene titles
    // - Causes layout breaks: If a scene is expanded when entering shift mode, the expanded 
    //   state persists and breaks the layout
    // - User settings toggle is ignored for Chronologue mode
    manager.setTitleExpansionEnabled(false);

    const sceneIdCache = new WeakMap<Element, string>();

    const getSceneIdFromGroup = (group: Element): string | null => {
        const cached = sceneIdCache.get(group);
        if (cached) return cached;

        const pathEl = group.querySelector<SVGPathElement>('.rt-scene-path');
        const sceneId = pathEl?.id ?? null;
        if (sceneId) {
            sceneIdCache.set(group, sceneId);
        }
        return sceneId;
    };

    const synopsisBySceneId = new Map<string, Element>();
    svg.querySelectorAll<SVGElement>('.rt-scene-info[data-for-scene]').forEach(synopsis => {
        const sceneId = synopsis.getAttribute('data-for-scene');
        if (sceneId) {
            synopsisBySceneId.set(sceneId, synopsis);
        }
    });

    const numberSquareBySceneId = new Map<string, SVGElement>();
    svg.querySelectorAll<SVGElement>('.rt-number-square[data-scene-id]').forEach(square => {
        const sceneId = square.getAttribute('data-scene-id');
        if (sceneId) {
            numberSquareBySceneId.set(sceneId, square);
        }
    });

    const numberTextBySceneId = new Map<string, SVGElement>();
    svg.querySelectorAll<SVGElement>('.rt-number-text[data-scene-id]').forEach(text => {
        const sceneId = text.getAttribute('data-scene-id');
        if (sceneId) {
            numberTextBySceneId.set(sceneId, text);
        }
    });

    interface SceneElementRefs {
        path: SVGPathElement | null;
        numberSquare: SVGElement | null;
        numberText: SVGElement | null;
        title: SVGTextElement | null;
    }

    const sceneElementRefs = new Map<string, SceneElementRefs>();
    const scenesByPath = new Map<string, string[]>(); // Cache: path -> array of sceneIds

    svg.querySelectorAll<SVGGElement>('.rt-scene-group[data-item-type="Scene"], .rt-scene-group[data-item-type="Backdrop"]').forEach(group => {
        const sceneId = getSceneIdFromGroup(group);
        if (!sceneId) return;

        const pathEl = group.querySelector<SVGPathElement>('.rt-scene-path');
        const titleEl = group.querySelector<SVGTextElement>('.rt-scene-title');

        sceneElementRefs.set(sceneId, {
            path: pathEl,
            numberSquare: numberSquareBySceneId.get(sceneId) ?? null,
            numberText: numberTextBySceneId.get(sceneId) ?? null,
            title: titleEl ?? null,
        });

        // Build path-to-sceneIds cache for fast lookups
        const pathAttr = group.getAttribute('data-path');
        if (pathAttr) {
            if (!scenesByPath.has(pathAttr)) {
                scenesByPath.set(pathAttr, []);
            }
            scenesByPath.get(pathAttr)!.push(sceneId);
        }
    });

    const fadeTargets: SVGElement[] = [];
    const seen = new Set<SVGElement>();
    svg.querySelectorAll<SVGElement>('.rt-scene-path, .rt-number-square, .rt-number-text, .rt-scene-title').forEach(el => {
        if (!seen.has(el)) {
            fadeTargets.push(el);
            seen.add(el);
        }
    });

    let currentHoveredSceneId: string | null = null;

    // Optimized: Use CSS class on parent instead of iterating all elements
    const applyGlobalFade = () => {
        if (svg.classList.contains('rt-global-fade')) return;
        svg.classList.add('rt-global-fade');
    };

    const clearGlobalFade = () => {
        if (!svg.classList.contains('rt-global-fade')) return;
        svg.classList.remove('rt-global-fade');
    };

    const highlightScene = (sceneId: string): void => {
        const refs = sceneElementRefs.get(sceneId);
        if (!refs) return;

        // Highlight the primary scene
        if (refs.path) {
            refs.path.classList.add('rt-selected');
            refs.path.classList.remove('rt-non-selected');
        }
        if (refs.numberSquare) {
            refs.numberSquare.classList.remove('rt-non-selected');
        }
        if (refs.numberText) {
            refs.numberText.classList.remove('rt-non-selected');
        }
        if (refs.title) {
            refs.title.classList.remove('rt-non-selected');
        }

        // Find and highlight all matching scenes in other rings using cached path mapping
        const primaryGroup = refs.path?.closest('.rt-scene-group[data-item-type="Scene"]');
        const currentPathAttr = primaryGroup?.getAttribute('data-path');
        if (currentPathAttr) {
            const matchingSceneIds = scenesByPath.get(currentPathAttr);
            if (matchingSceneIds) {
                matchingSceneIds.forEach(matchSceneId => {
                    if (matchSceneId === sceneId) return; // Skip self

                    const matchRefs = sceneElementRefs.get(matchSceneId);
                    if (!matchRefs) return;

                    if (matchRefs.path) {
                        matchRefs.path.classList.add('rt-selected');
                        matchRefs.path.classList.remove('rt-non-selected');
                    }
                    if (matchRefs.numberSquare) {
                        matchRefs.numberSquare.classList.remove('rt-non-selected');
                    }
                    if (matchRefs.numberText) {
                        matchRefs.numberText.classList.remove('rt-non-selected');
                    }
                    if (matchRefs.title) {
                        matchRefs.title.classList.remove('rt-non-selected');
                    }
                });
            }
        }
    };

    const unhighlightScene = (sceneId: string, keepFaded: boolean): void => {
        const refs = sceneElementRefs.get(sceneId);
        if (!refs) return;

        // Unhighlight the primary scene
        if (refs.path) {
            refs.path.classList.remove('rt-selected');
            if (keepFaded) {
                refs.path.classList.add('rt-non-selected');
            } else {
                refs.path.classList.remove('rt-non-selected');
            }
        }

        const toggleFade = (el: SVGElement | null) => {
            if (!el) return;
            if (keepFaded) {
                el.classList.add('rt-non-selected');
            } else {
                el.classList.remove('rt-non-selected');
            }
        };

        toggleFade(refs.numberSquare);
        toggleFade(refs.numberText);
        toggleFade(refs.title);

        // Find and unhighlight all matching scenes using cached path mapping
        const primaryGroup = refs.path?.closest('.rt-scene-group[data-item-type="Scene"]');
        const currentPathAttr = primaryGroup?.getAttribute('data-path');
        if (currentPathAttr) {
            const matchingSceneIds = scenesByPath.get(currentPathAttr);
            if (matchingSceneIds) {
                matchingSceneIds.forEach(matchSceneId => {
                    if (matchSceneId === sceneId) return; // Skip self

                    const matchRefs = sceneElementRefs.get(matchSceneId);
                    if (!matchRefs) return;

                    if (matchRefs.path) {
                        matchRefs.path.classList.remove('rt-selected');
                        if (keepFaded) {
                            matchRefs.path.classList.add('rt-non-selected');
                        } else {
                            matchRefs.path.classList.remove('rt-non-selected');
                        }
                    }

                    toggleFade(matchRefs.numberSquare);
                    toggleFade(matchRefs.numberText);
                    toggleFade(matchRefs.title);
                });
            }
        }
    };

    // Register hover handlers for Scene elements
    view.renderScope.registerDomEvent(svg as unknown as HTMLElement, 'pointerover', (e: PointerEvent) => {
        // Suspend hover synopsis reveal when shift/alt/runtime mode is active
        // CHECK THIS FIRST before any other work!
        if (isShiftModeActive() || isAlienModeActive() || isRuntimeModeActive()) {
            return;
        }

        const g = (e.target as Element).closest('.rt-scene-group[data-item-type="Scene"], .rt-scene-group[data-item-type="Backdrop"]');
        if (!g) return;

        const sid = sceneIdCache.get(g) ?? getSceneIdFromGroup(g);
        if (!sid) return;

        if (currentHoveredSceneId === sid) {
            const syn = synopsisBySceneId.get(sid);
            if (syn) {
                // Calculate position BEFORE making visible to prevent flicker
                view.plugin.synopsisManager.updatePosition(syn, e, svg, sid);
                // Update title color based on Chronologue mode (use subplot color)
                updateSynopsisTitleColor(syn, sid, 'chronologue');
                syn.classList.add('rt-visible');
            }
            if (g.classList.contains('rt-chronologue-warning')) {
                showWhenFieldWarning(svg, g, e);
            } else {
                hideWhenFieldWarning(svg);
            }
            return;
        }

        const previousSceneId = currentHoveredSceneId;
        applyGlobalFade();
        currentHoveredSceneId = sid;

        if (previousSceneId) {
            const previousSynopsis = synopsisBySceneId.get(previousSceneId);
            if (previousSynopsis) {
                previousSynopsis.classList.remove('rt-visible');
            }
            unhighlightScene(previousSceneId, true);
        }

        // Add scene-hover class to hide subplot labels during hover
        svg.classList.add('scene-hover');

        const syn = synopsisBySceneId.get(sid);
        if (syn) {
            // Calculate position BEFORE making visible to prevent flicker in wrong location
            view.plugin.synopsisManager.updatePosition(syn, e, svg, sid);
            // Update title color based on Chronologue mode (use subplot color)
            updateSynopsisTitleColor(syn, sid, 'chronologue');
            syn.classList.add('rt-visible');
        }

        highlightScene(sid);

        // Use manager for scene title expansion
        manager.onSceneHover(g, sid);

        // Show warning for scenes without When field
        if (g.classList.contains('rt-chronologue-warning')) {
            showWhenFieldWarning(svg, g, e);
        } else {
            hideWhenFieldWarning(svg);
        }
    });

    view.renderScope.registerDomEvent(svg as unknown as HTMLElement, 'pointerout', (e: PointerEvent) => {
        const g = (e.target as Element).closest('.rt-scene-group[data-item-type="Scene"], .rt-scene-group[data-item-type="Backdrop"]');
        if (!g) return;

        const sid = sceneIdCache.get(g) ?? getSceneIdFromGroup(g);
        if (!sid) return;

        const related = e.relatedTarget as Element | null;

        // Always cleanup manager state (angles, etc.) even when moving to another scene
        manager.onSceneLeave();

        // If moving to another scene or backdrop, allow the other handler to take over without clearing shared state
        if (related?.closest('.rt-scene-group[data-item-type="Scene"], .rt-scene-group[data-item-type="Backdrop"]')) {
            return;
        }

        const syn = synopsisBySceneId.get(sid);
        if (syn) {
            syn.classList.remove('rt-visible');
        }

        if (currentHoveredSceneId) {
            unhighlightScene(currentHoveredSceneId, false);
            currentHoveredSceneId = null;
        }

        // Remove scene-hover class and restore default styling
        svg.classList.remove('scene-hover');
        clearGlobalFade();
        hideWhenFieldWarning(svg);
    });
}

/**
 * Setup scene click interactions for opening files
 */
function setupSceneClickInteractions(view: RadialTimelineView, svg: SVGSVGElement): void {
    view.renderScope.registerDomEvent(svg as unknown as HTMLElement, 'click', (e: MouseEvent) => { void (async () => {
        const g = (e.target as Element).closest('.rt-scene-group[data-item-type="Scene"], .rt-scene-group[data-item-type="Backdrop"]');
        if (!g) return;

        // A drag just ended on this scene — don't also open the file.
        if (wasRecentlyHandledByChronologueDrag()) {
            e.stopPropagation();
            return;
        }

        // When shift/alt/runtime mode is active, delegate to shift controller
        if (isShiftModeActive() || isAlienModeActive() || isRuntimeModeActive()) {
            const handled = view.handleShiftModeClick?.(e, g);
            if (handled) {
                return; // Shift/ALT mode handled the click
            }
        }

        // Handle dominant subplot selection for scenes in multiple subplots
        const scenes = view.sceneData;
        if (scenes.length > 0) {
            await handleDominantSubplotSelection(view, g, svg, scenes);
        }

        // Normal behavior: open scene file
        e.stopPropagation();

        const encodedPath = g.getAttribute('data-path');
        if (!encodedPath) return;

        const filePath = decodeURIComponent(encodedPath);
        if (view.plugin.app) {
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
        }
    })(); });
}

/**
 * Show warning tooltip for scenes without When field
 */
function showWhenFieldWarning(svg: SVGSVGElement, sceneGroup: Element, event: MouseEvent): void {
    // Remove existing warning
    hideWhenFieldWarning(svg);

    // Create warning tooltip
    const svgNS = 'http://www.w3.org/2000/svg';
    const doc = svg.ownerDocument;
    const warning = doc.createElementNS(svgNS, 'g');
    warning.setAttribute('class', 'rt-when-field-warning');

    const x = event.clientX;
    const y = event.clientY;

    const rect = doc.createElementNS(svgNS, 'rect');
    rect.setAttribute('x', String(x - 60));
    rect.setAttribute('y', String(y - 30));
    rect.setAttribute('width', '120');
    rect.setAttribute('height', '20');
    rect.setAttribute('rx', '4');
    rect.setAttribute('fill', 'var(--background-primary)');
    rect.setAttribute('stroke', 'var(--text-error)');
    rect.setAttribute('stroke-width', '1');
    warning.appendChild(rect);

    const text = doc.createElementNS(svgNS, 'text');
    text.setAttribute('x', String(x));
    text.setAttribute('y', String(y - 15));
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('dominant-baseline', 'middle');
    text.setAttribute('font-family', 'var(--font-text)');
    text.setAttribute('font-size', '10');
    text.setAttribute('font-weight', '600');
    text.setAttribute('fill', 'var(--text-error)');
    text.textContent = 'Missing When field';
    warning.appendChild(text);

    svg.appendChild(warning);
}

/**
 * Hide warning tooltip
 */
function hideWhenFieldWarning(svg: SVGSVGElement): void {
    const existingWarning = svg.querySelector('.rt-when-field-warning');
    if (existingWarning) {
        existingWarning.remove();
    }
}
