/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 */

/**
 * Mode Interaction Controller
 * 
 * Manages event handler registration and cleanup for different timeline modes.
 * Ensures clean transitions between modes without handler conflicts.
 */

import type { RadialTimelineView } from '../view/TimeLineView';
import type { ModeDefinition } from './ModeDefinition';
import { TimelineMode } from './ModeDefinition';

/**
 * Registered handler tracking
 */
interface RegisteredHandler {
    element: Element;
    event: string;
    handler: EventListener;
    removeFunction: () => void;
}

/**
 * Mode Interaction Controller
 */
export class ModeInteractionController {
    // SAFE: View reference passed at construction, tied to view lifecycle, cleaned on view destroy
    private view: RadialTimelineView; // SAFE: Per-view-instance, managed by view lifecycle
    private handlers: RegisteredHandler[] = [];
    private currentMode: TimelineMode | null = null;
    
    constructor(view: RadialTimelineView) {
        this.view = view;
    }
    
    /**
     * Setup interaction handlers for a mode
     * Cleans up previous mode handlers first
     * @param mode - The mode definition to setup
     * @param svg - The SVG element to attach handlers to
     */
    async setupMode(mode: ModeDefinition, svg: SVGSVGElement): Promise<void> {
        // Clean up previous mode handlers
        this.cleanup();
        
        this.currentMode = mode.id;
        
        // Setup handlers based on mode type
        switch (mode.id) {
            case TimelineMode.NARRATIVE:
                await this.setupAllScenesHandlers(svg);
                break;
                
            case TimelineMode.PROGRESS:
                await this.setupProgressHandlers(svg);
                break;
                
            case TimelineMode.GOSSAMER:
                await this.setupGossamerHandlers(svg);
                break;
                
            case TimelineMode.CHRONOLOGUE:
                await this.setupChronologueHandlers(svg);
                break;
        }
    }
    
    /**
     * Clean up all registered handlers
     */
    cleanup(): void {
        // Execute all remove functions
        this.handlers.forEach(handler => {
            try {
                handler.removeFunction();
            } catch {
                // Error removing handler
            }
        });
        
        // Clear the handlers array
        this.handlers = [];
        this.currentMode = null;
    }
    
    /**
     * Register a handler for tracking and cleanup
     */
    private registerHandler(
        element: Element,
        event: string,
        handler: EventListener,
        removeFunction: () => void
    ): void {
        this.handlers.push({
            element,
            event,
            handler,
            removeFunction
        });
    }
    
    /**
     * Setup handlers for All Scenes mode
     */
    private async setupAllScenesHandlers(svg: SVGSVGElement): Promise<void> {
        // Import and use existing All Scenes mode setup
        const { setupAllScenesDelegatedHover, setupSceneInteractions, setupOuterRingDrag } = await import('../view/modes/AllScenesMode');
        
        // Setup delegated hover
        const container = this.view.containerEl;
        if (container) {
            setupAllScenesDelegatedHover(this.view, container, this.view.sceneData || []);
        }

        // Setup scene interactions for each scene group
        const sceneGroups = svg.querySelectorAll('.rt-scene-group');
        sceneGroups.forEach(group => {
            setupSceneInteractions(this.view, group, svg, this.view.sceneData || []);
        });

        // Setup drag-to-reorder on the outer ring (narrative mode only)
        setupOuterRingDrag(this.view, svg);
    }
    
    /**
     * Setup handlers for Progress mode
     */
    private async setupProgressHandlers(svg: SVGSVGElement): Promise<void> {
        // Import and use existing Main Plot mode setup
        const { setupMainPlotMode } = await import('../view/modes/MainPlotMode');
        setupMainPlotMode(this.view, svg);
    }
    
    /**
     * Setup handlers for Gossamer mode
     */
    private async setupGossamerHandlers(svg: SVGSVGElement): Promise<void> {
        // Import and use existing Gossamer mode setup
        const { setupGossamerMode } = await import('../view/modes/GossamerMode');
        setupGossamerMode(this.view, svg);
    }
    
    /**
     * Setup handlers for Chronologue mode
     */
    private async setupChronologueHandlers(svg: SVGSVGElement): Promise<void> {
        // Import and use existing Chronologue mode setup
        const { setupChronologueMode } = await import('../view/modes/ChronologueMode');

        // Pass the actual view instance directly (don't spread - it breaks methods like registerDomEvent).
        // Scene data is read from view.sceneData; the shift controller derives its own outer radius.
        setupChronologueMode(this.view, svg);
    }
    
    /**
     * Get the current mode this controller is managing
     */
    getCurrentMode(): TimelineMode | null {
        return this.currentMode;
    }
}

/**
 * Create a ModeInteractionController instance
 */
export function createInteractionController(view: RadialTimelineView): ModeInteractionController {
    return new ModeInteractionController(view);
}
