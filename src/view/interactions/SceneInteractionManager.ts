/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 */

/**
 * Scene Interaction Manager
 * 
 * Manages scene hover interactions, synopsis display, and scene title auto-expansion.
 * Extracted from the 400-line closure in TimeLineView.ts to enable reuse across modes.
 */

import type { App } from 'obsidian';
import type { RadialTimelineView } from '../TimeLineView';
import { measureInteraction } from '../../renderer/utils/Performance';
import { updateSynopsisTitleColor } from './SynopsisTitleColorManager';
import {
    SceneAngleData,
    needsExpansion,
    calculateTargetSize,
    getSegmentBoundaries,
    redistributeAngles,
    expandIntoGap,
    buildArcPath,
    buildTextPath,
    SCENE_TITLE_INSET
} from './SceneTitleExpansion';

export class SceneInteractionManager {
    private svg: SVGSVGElement;
    private enabled: boolean = true;
    private totalSegments: number = 3;
    
    // State tracking
    private currentGroup: Element | null = null;
    private currentSynopsis: Element | null = null;
    private currentSceneId: string | null = null;
    private rafId: number | null = null;
    private registerFn: ((fn: () => void) => void) | null = null;
    
    // Original state storage for reset
    private originalAngles = new Map<string, { start: number; end: number }>();
    private originalSquareTransforms = new Map<string, string>();

    // Groups with suppressed pointer-events during expansion (prevents hover flickering)
    private suppressedGroups = new Set<string>();

    // Text measurement element (reused to avoid constant creation/destruction)
    private measurementText: SVGTextElement;
    
    // Cleanup registration (for Obsidian's Component system)
    private cleanupCallbacks: (() => void)[] = [];
    
    constructor(view: RadialTimelineView, svg: SVGSVGElement, totalActs?: number) {
        this.svg = svg;
        // Prefer segment count from the rendered SVG so hover redistribution matches the actual geometry.
        const svgSegments = this.getSegmentCountFromSvg(svg);
        this.totalSegments = svgSegments ?? Math.max(3, totalActs ?? 3);
        // Cleanups belong to the SVG this manager was built for, not to the view.
        this.registerFn = (fn) => view.renderScope.register(fn);
        
        // Create reusable text measurement element
        this.measurementText = svg.ownerDocument.win.createSvg('text');
        this.measurementText.classList.add('rt-measure-text');
        svg.appendChild(this.measurementText);
        
        // Register cleanup for animation frames
        this.register(() => {
            if (this.rafId !== null) {
                cancelAnimationFrame(this.rafId);
                this.rafId = null;
            }
        });
    }

    setActCount(count: number): void {
        this.totalSegments = Math.max(1, count);
    }
    /**
     * Read act count from the rendered SVG (authoritative for hover redistribution)
     */
    private getSegmentCountFromSvg(svg: SVGSVGElement): number | null {
        const attr = svg.getAttribute('data-segment-count') ?? svg.getAttribute('data-num-acts');
        if (!attr) return null;
        const parsed = parseInt(attr, 10);
        return Number.isFinite(parsed) && parsed >= 1 ? parsed : null;
    }

    /**
     * Safely read angle attribute with raw fallback for higher precision
     */
    private getAngleAttr(el: Element, rawAttr: string, fallbackAttr: string): number {
        const raw = el.getAttribute(rawAttr);
        if (raw !== null && raw !== undefined && raw !== '') {
            const val = Number(raw);
            if (Number.isFinite(val)) return val;
        }
        const fb = el.getAttribute(fallbackAttr);
        const fbNum = fb !== null && fb !== undefined && fb !== '' ? Number(fb) : NaN;
        return Number.isFinite(fbNum) ? fbNum : 0;
    }

    /**
     * Ensure totalActs stays in sync with the rendered SVG
     */
    private refreshActCount(): void {
        const svgSegments = this.getSegmentCountFromSvg(this.svg);
        if (svgSegments !== null) {
            this.totalSegments = svgSegments;
        }
    }

    
    /**
     * Get the view (uses getLeavesOfType to avoid persistent reference)
     */
    private getView(): RadialTimelineView | null {
        // Access app through the SVG's owner document
        const doc = this.svg.ownerDocument;
        if (!doc || !doc.defaultView) return null;
        
        // app is added to the window object by Obsidian (popout windows included)
        const win = doc.defaultView as Window & { app?: App };
        if (!win.app) return null;

        const leaves = win.app.workspace.getLeavesOfType('radial-timeline');
        if (!leaves || leaves.length === 0) return null;
        return leaves[0].view as RadialTimelineView;
    }
    
    /**
     * Enable or disable title expansion based on settings
     */
    setTitleExpansionEnabled(enabled: boolean): void {
        this.enabled = enabled;
    }
    
    /**
     * Handle scene hover.
     * Instrumented: 'hover.enter.js' / 'hover.enter.frame' in the perf buffer
     * (read via the "Copy performance report" command) so hover cost on large
     * books is measured, not guessed.
     */
    onSceneHover(group: Element, sceneId: string, mouseEvent?: MouseEvent): void {
        const view = this.getView();
        if (!view) return;
        // SAFE: the svg belongs to a live view; its document always has a window
        const win = this.svg.ownerDocument.defaultView!;
        measureInteraction(view.plugin, 'hover.enter', win, () => this.doSceneHover(view, group, sceneId, mouseEvent));
    }

    private doSceneHover(view: RadialTimelineView, group: Element, sceneId: string, mouseEvent?: MouseEvent): void {
        // If an expanded state is already active, always return to baseline first.
        // This keeps consecutive hover transitions deterministic.
        if (this.originalAngles.size > 0) {
            this.resetAngularRedistribution();
        }
        
        this.currentGroup = group;
        this.currentSceneId = sceneId;
        this.currentSynopsis = this.findSynopsisForScene(sceneId);
        
        // Apply selection styles
        this.applySelection(group, sceneId);
        
        // Show synopsis - position it BEFORE making visible to prevent flicker
        if (this.currentSynopsis) {
            // If mouse event provided, position immediately to prevent flicker
            if (mouseEvent) {
                view.plugin.synopsisManager.updatePosition(
                    this.currentSynopsis,
                    mouseEvent,
                    this.svg,
                    sceneId
                );
            }
            
            // Update title color based on mode
            const currentMode = view.plugin.settings.currentMode || 'narrative';
            updateSynopsisTitleColor(this.currentSynopsis, sceneId, currentMode);
            
            this.currentSynopsis.classList.add('rt-visible');
        }
        
        // Trigger title expansion if enabled
        if (this.enabled && view.plugin.settings.enableSceneTitleAutoExpand) {
            const sceneTitle = group.querySelector('.rt-scene-title');
            if (sceneTitle) {
                this.redistributeActScenes(group);
            }
        }
    }
    
    /**
     * Handle scene leave.
     * Instrumented: 'hover.leave.js' / 'hover.leave.frame' (see onSceneHover).
     */
    onSceneLeave(): void {
        const view = this.getView();
        // SAFE: the svg belongs to a live view; its document always has a window
        const win = this.svg.ownerDocument.defaultView!;
        const leave = () => {
            // Always reset expansion if we have stored angles
            // This ensures we clean up properly even if state changed during hover
            if (this.originalAngles.size > 0) {
                this.resetAngularRedistribution();
            }

            // Clear selection
            this.clearSelection();

            this.currentGroup = null;
            this.currentSynopsis = null;
            this.currentSceneId = null;
        };
        if (view) {
            measureInteraction(view.plugin, 'hover.leave', win, leave);
        } else {
            leave();
        }
    }
    
    /**
     * Update synopsis position on mouse move
     */
    onMouseMove(e: MouseEvent): void {
        if (this.rafId !== null) return;
        
        const rafId = window.requestAnimationFrame(() => {
            this.rafId = null;
            
            const view = this.getView();
            if (!view) return;

            // Live-sync title expansion with current setting without requiring view reopen.
            const autoExpandEnabled = Boolean(view.plugin.settings.enableSceneTitleAutoExpand);
            if ((!this.enabled || !autoExpandEnabled) && this.originalAngles.size > 0) {
                this.resetAngularRedistribution();
            } else if (this.enabled && autoExpandEnabled && this.currentGroup && this.originalAngles.size === 0) {
                const sceneTitle = this.currentGroup.querySelector('.rt-scene-title');
                if (sceneTitle) {
                    this.redistributeActScenes(this.currentGroup);
                }
            }

            if (!this.currentSynopsis || !this.currentSceneId) return;
            if (!this.currentSynopsis.classList.contains('rt-visible')) return;
            
            view.plugin.synopsisManager.updatePosition(
                this.currentSynopsis,
                e,
                this.svg,
                this.currentSceneId
            );
        });
        this.register(() => cancelAnimationFrame(rafId));
        this.rafId = rafId;
    }
    
    /**
     * Clean up resources
     */
    cleanup(): void {
        if (this.rafId !== null) {
            cancelAnimationFrame(this.rafId);
            this.rafId = null;
        }
        
        if (this.measurementText && this.measurementText.parentNode) {
            this.measurementText.parentNode.removeChild(this.measurementText);
        }
        
        this.resetAngularRedistribution();
        this.clearSelection();

        // Belt-and-suspenders: ensure pointer-events restored even if reset was a no-op
        this.suppressedGroups.forEach(id => {
            const group = this.svg.getElementById(id);
            if (group) group.removeAttribute('pointer-events');
        });
        this.suppressedGroups.clear();

        this.cleanupCallbacks.forEach(fn => {
            try { fn(); } catch { /* ignore */ }
        });
        this.cleanupCallbacks = [];
    }
    
    // ========================================================================
    // Private Helper Methods
    // ========================================================================
    
    private findSynopsisForScene(sceneId: string): Element | null {
        return this.svg.querySelector(`.rt-scene-info[data-for-scene="${sceneId}"]`);
    }
    
    private clearSelection(): void {
        const all = this.svg.querySelectorAll('.rt-scene-path, .rt-number-square, .rt-number-text, .rt-scene-title, .rt-discontinuity-marker');
        all.forEach(el => el.classList.remove('rt-selected'));
        
        // Only clear muted state when NOT in Gossamer mode
        const view = this.getView();
        if (view && view.currentMode !== 'gossamer') {
            all.forEach(el => el.classList.remove('rt-non-selected'));
        }
        
        if (this.currentSynopsis) {
            this.currentSynopsis.classList.remove('rt-visible');
        }
    }
    
    private applySelection(group: Element, sceneId: string): void {
        // Highlight the path
        const pathEl = group.querySelector('.rt-scene-path');
        if (pathEl) pathEl.classList.add('rt-selected');
        
        // Highlight number square and text
        const numberSquare = this.svg.querySelector(`.rt-number-square[data-scene-id="${sceneId}"]`);
        if (numberSquare) numberSquare.classList.add('rt-selected');
        
        const numberText = this.svg.querySelector(`.rt-number-text[data-scene-id="${sceneId}"]`);
        if (numberText) numberText.classList.add('rt-selected');
        
        const sceneTitle = group.querySelector('.rt-scene-title');
        if (sceneTitle) sceneTitle.classList.add('rt-selected');
        
        // Find related scenes (same path) and don't mute them
        const related = new Set<Element>();
        const currentPathAttr = group.getAttribute('data-path');
        if (currentPathAttr) {
            const matches = this.svg.querySelectorAll(`[data-path="${currentPathAttr}"]`);
            matches.forEach(mg => {
                if (mg === group) return;
                const rp = mg.querySelector('.rt-scene-path');
                if (rp) related.add(rp);
                const rt = mg.querySelector('.rt-scene-title');
                if (rt) related.add(rt);
                const rid = (rp as SVGPathElement | null)?.id;
                if (rid) {
                    const rsq = this.svg.querySelector(`.rt-number-square[data-scene-id="${rid}"]`);
                    if (rsq) related.add(rsq);
                    const rtx = this.svg.querySelector(`.rt-number-text[data-scene-id="${rid}"]`);
                    if (rtx) related.add(rtx);
                }
            });
        }
        
        // Mute everything else
        const all = this.svg.querySelectorAll('.rt-scene-path, .rt-number-square, .rt-number-text, .rt-scene-title, .rt-discontinuity-marker');
        all.forEach(el => {
            if (!el.classList.contains('rt-selected') && !related.has(el)) {
                el.classList.add('rt-non-selected');
            }
        });
    }
    
    // ========================================================================
    // Scene Title Expansion Logic
    // ========================================================================
    
    private storeOriginalAngles(): void {
        if (this.originalAngles.size > 0) return; // Already stored
        
        const view = this.getView();
        if (!view) return;
        
        this.svg.querySelectorAll('.rt-scene-group').forEach((group: Element) => {
            const start = this.getAngleAttr(group, 'data-start-angle-raw', 'data-start-angle');
            const end = this.getAngleAttr(group, 'data-end-angle-raw', 'data-end-angle');
            this.originalAngles.set(group.id, { start, end });
            
            // Store original number square transforms
            const scenePathEl = group.querySelector('.rt-scene-path') as SVGPathElement;
            if (scenePathEl) {
                const sceneId = scenePathEl.id;
                const numberSquareGroup = view.getSquareGroupForSceneId(this.svg, sceneId);
                
                if (numberSquareGroup) {
                    const originalTransform = numberSquareGroup.getAttribute('transform') || '';
                    this.originalSquareTransforms.set(sceneId, originalTransform);
                }
            }
        });
    }
    
    private resetAngularRedistribution(): void {
        this.originalAngles.forEach((angles, groupId) => {
            const group = this.svg.getElementById(groupId);
            if (!group) return;
            
            const innerR = Number(group.getAttribute('data-inner-r')) || 0;
            const outerR = Number(group.getAttribute('data-outer-r')) || 0;
            
            // Reset scene path
            const path = group.querySelector('.rt-scene-path') as SVGPathElement;
            if (path) {
                path.setAttribute('d', buildArcPath(innerR, outerR, angles.start, angles.end));
            }
            
            // Reset text path
            const textPath = group.querySelector('path[id^="textPath-"]') as SVGPathElement;
            if (textPath) {
                const insetAttr = group.getAttribute('data-title-inset');
                const titleInset = insetAttr ? Number(insetAttr) : SCENE_TITLE_INSET;
                const textPathRadius = Math.max(innerR, outerR - titleInset);
                textPath.setAttribute('d', buildTextPath(textPathRadius, angles.start, angles.end));
            }
            
            // Reset number square transform
            const scenePathEl = group.querySelector('.rt-scene-path') as SVGPathElement;
            if (scenePathEl) {
                const sceneId = scenePathEl.id;
                const originalTransform = this.originalSquareTransforms.get(sceneId);
                if (originalTransform !== undefined) {
                    const match = originalTransform.match(/translate\(([^,]+),\s*([^)]+)\)/);
                    if (match) {
                        const view = this.getView();
                        if (view) {
                            view.setNumberSquareGroupPosition(
                                this.svg,
                                sceneId,
                                parseFloat(match[1]),
                                parseFloat(match[2])
                            );
                        }
                    }
                }
            }
        });
        
        // Restore pointer-events on suppressed groups
        this.suppressedGroups.forEach(id => {
            const group = this.svg.getElementById(id);
            if (group) group.removeAttribute('pointer-events');
        });
        this.suppressedGroups.clear();

        // Clear stored state after reset
        this.originalAngles.clear();
        this.originalSquareTransforms.clear();
    }
    
    private redistributeActScenes(hoveredGroup: Element): void {
        this.storeOriginalAngles();
        
        const hoveredAct = hoveredGroup.getAttribute('data-act');
        const hoveredRing = hoveredGroup.getAttribute('data-ring');
        if (!hoveredAct || !hoveredRing) return;
        
        // Find all elements in the same act and ring
        const actElements: SceneAngleData[] = [];
        const sceneElements: Element[] = [];
        
        this.svg.querySelectorAll('.rt-scene-group').forEach((group: Element) => {
            if (group.getAttribute('data-act') === hoveredAct && 
                group.getAttribute('data-ring') === hoveredRing) {
                const path = group.querySelector('.rt-scene-path');
                if (path) {
                    const sceneTitle = group.querySelector('.rt-scene-title');
                    const isScene = !!sceneTitle;
                    
                    if (isScene) {
                        sceneElements.push(group);
                    }
                    
                    actElements.push({
                        id: group.id,
                        startAngle: this.getAngleAttr(group, 'data-start-angle-raw', 'data-start-angle'),
                        endAngle: this.getAngleAttr(group, 'data-end-angle-raw', 'data-end-angle'),
                        innerRadius: Number(group.getAttribute('data-inner-r')) || 0,
                        outerRadius: Number(group.getAttribute('data-outer-r')) || 0,
                        isScene
                    });
                }
            }
        });
        
        if (actElements.length <= 1) return; // Need at least 2 elements
        if (!sceneElements.includes(hoveredGroup)) return; // Don't expand plot slices
        
        // Measure if title needs expansion
        const hoveredData = actElements.find(e => e.id === hoveredGroup.id);
        if (!hoveredData) return;
        
        // Measure fit at the title's actual render radius (outerR - inset), not the
        // ring mid-radius — on thick rings (e.g. a single subplot) midR sits far below
        // the text path and computing angle = arc/midR over-expands the slice.
        const hoveredInsetAttr = hoveredGroup.getAttribute('data-title-inset');
        const hoveredTitleInset = hoveredInsetAttr ? Number(hoveredInsetAttr) : SCENE_TITLE_INSET;
        const hoveredTitleR = Math.max(hoveredData.innerRadius, hoveredData.outerRadius - hoveredTitleInset);
        const currentArcPx = (hoveredData.endAngle - hoveredData.startAngle) * hoveredTitleR;
        
        // Measure text width
        const hoveredSceneTitle = hoveredGroup.querySelector('.rt-scene-title');
        if (!hoveredSceneTitle) return;
        
        const titleText = hoveredSceneTitle.textContent || '';
        if (!titleText.trim()) return;
        
        // Use measurement element
        this.measurementText.textContent = titleText;
        const hoveredComputed = getComputedStyle(hoveredSceneTitle);
        
        const fontFamily = hoveredComputed.fontFamily || 'sans-serif';
        const fontSize = hoveredComputed.fontSize || '18px';
        this.measurementText.style.setProperty('--rt-measurement-font-family', fontFamily);
        this.measurementText.style.setProperty('--rt-measurement-font-size', fontSize);
        
        const textBBox = this.measurementText.getBBox();
        const textWidth = textBBox.width;
        
        // Check if expansion is needed
        if (!needsExpansion(textWidth, currentArcPx, hoveredTitleR)) {
            return; // Text already fits
        }

        // Calculate target size
        const targetSize = calculateTargetSize(textWidth, hoveredTitleR);
        
        // Get act boundaries
        this.refreshActCount();
        const actNum = Number(hoveredAct);
        const actBounds = getSegmentBoundaries(actNum, this.totalSegments);
        
        // A Sequence-aligned scene is pinned to its outer-ring angle, so it
        // grows into the gap ahead instead of the ring repacking around it.
        const isAligned = hoveredGroup.getAttribute('data-aligned') === 'true';
        const redistribution = isAligned
            ? expandIntoGap(actElements, hoveredGroup.id, targetSize, actBounds.end)
            : redistributeAngles(
                actElements,
                hoveredGroup.id,
                targetSize,
                actBounds.start,
                actBounds.end
            );
        if (redistribution.length === 0) return; // Nothing to grow into
        
        // Apply redistribution
        redistribution.forEach(result => {
            const group = this.svg.getElementById(result.id);
            if (!group) return;

            const innerR = Number(group.getAttribute('data-inner-r')) || 0;
            const outerR = Number(group.getAttribute('data-outer-r')) || 0;

            // Update scene path (hotspot)
            const path = group.querySelector('.rt-scene-path') as SVGPathElement;
            if (path) {
                path.setAttribute('d', buildArcPath(innerR, outerR, result.newStartAngle, result.newEndAngle));
            }

            // Update text path (use redistributed angles for correct text positioning)
            const textPath = group.querySelector('path[id^="textPath-"]') as SVGPathElement;
            if (textPath) {
                const insetAttr = group.getAttribute('data-title-inset');
                const titleInset = insetAttr ? Number(insetAttr) : SCENE_TITLE_INSET;
                const textPathRadius = Math.max(innerR, outerR - titleInset);
                textPath.setAttribute('d', buildTextPath(textPathRadius, result.newStartAngle, result.newEndAngle));
            }

            // Update number square position
            const scenePathEl = group.querySelector('.rt-scene-path') as SVGPathElement;
            if (scenePathEl) {
                const sceneId = scenePathEl.id;
                const squareRadius = (innerR + outerR) / 2;
                const squareX = squareRadius * Math.cos(result.newStartAngle);
                const squareY = squareRadius * Math.sin(result.newStartAngle);

                const view = this.getView();
                if (view) {
                    view.setNumberSquareGroupPosition(this.svg, sceneId, squareX, squareY);
                }
            }
        });
    }

    private register(fn: () => void): void {
        if (this.registerFn) {
            try {
                this.registerFn(fn);
                return;
            } catch {
                // fall through to manual queue
            }
        }
        this.cleanupCallbacks.push(fn);
    }
}
