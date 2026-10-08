import { sleep } from '../../utils/sleep';
import { Notice, TFile } from 'obsidian';
import type RadialTimelinePlugin from '../../main';
import {
    applySceneNumberUpdates,
    buildRippleRenamePlan,
    SceneReorderVerificationError,
    type SceneUpdate,
    type SceneReorderProgress
} from '../../services/SceneReorderService';
import { DragConfirmModal } from '../../modals/DragConfirmModal';
import {
    DragOverlays,
    cssEscape,
    getOuterRingIndex,
    resolvePublishStageColorFromGroup,
    resolveSubplotColorFromGroup
} from './dragGeometry';
import { formatBeatDecimalPrefix, formatIntegerPrefix } from '../../utils/prefixOrder';
import { resolveSelectedBeatModelFromSettings } from '../../utils/beatSystemState';
import { appendRecentStructuralMove, getActiveRecentStructuralMoves } from '../../utils/recentStructuralMoves';
import { openStructuralMoveHistoryLog } from '../../utils/recentStructuralMoveLog';
import type { RadialTimelineSettings } from '../../types/settings';
import { fileStem } from '../../utils/paths';

export interface OuterRingViewAdapter {
    plugin: RadialTimelinePlugin;
    renderScope: {
        register: (cb: () => void) => void;
        registerDomEvent: (el: HTMLElement, event: string, handler: (ev: Event) => void) => void;
    };
}

export interface OuterRingDragOptions {
    onRefresh: () => void;
    enableDebug?: boolean;
    mode: string;
}

/** 
 * Result type for drop target detection
 * Can be either a scene group or a void cell (empty act/subplot ring)
 */
type DropTarget = 
    | { type: 'scene'; group: SVGGElement; sceneId: string; act: number; ring: number }
    | { type: 'void'; element: SVGPathElement; act: number; ring: number; startAngle: number; endAngle: number; isOuterRing: boolean };

export type OuterRingOrderEntry = {
    sceneId: string;
    path: string;
    basename: string;
    numberText: string;
    /** 0-based act, from the group's data-act. */
    act: number;
    ring: number;
    itemType: 'Scene' | 'Beat';
    startAngle: number;
};

/**
 * Where a drop on an empty act of the outer ring puts the item: at the drop
 * angle in manuscript order. (Drops on subplot rings are membership edits and
 * never reorder; see services/SubplotMembership.)
 */
export function planEmptyActDropOrder(
    order: OuterRingOrderEntry[],
    movedPath: string,
    dropStartAngle: number
): OuterRingOrderEntry[] {
    const fromIdx = order.findIndex(entry => entry.path === movedPath);
    if (fromIdx === -1) return [...order];
    const moved = order[fromIdx];
    const rest = order.filter((_, index) => index !== fromIdx);
    let insertionIndex = Number.isFinite(dropStartAngle)
        ? rest.findIndex(entry => entry.startAngle >= dropStartAngle)
        : -1;
    if (insertionIndex === -1) insertionIndex = rest.length;
    rest.splice(insertionIndex, 0, moved);
    return rest;
}

export function dedupeOuterRingOrderEntries(entries: OuterRingOrderEntry[]): OuterRingOrderEntry[] {
    const seenPaths = new Set<string>();
    const deduped: OuterRingOrderEntry[] = [];
    for (const entry of entries) {
        if (!entry.path || seenPaths.has(entry.path)) continue;
        seenPaths.add(entry.path);
        deduped.push(entry);
    }
    return deduped;
}

export function reorderScenesPreservingBeatGaps(
    order: OuterRingOrderEntry[],
    sourceSceneId: string,
    targetSceneId: string
): OuterRingOrderEntry[] {
    const sceneEntries: OuterRingOrderEntry[] = [];
    const beatGaps: OuterRingOrderEntry[][] = [[]];

    for (const entry of order) {
        if (entry.itemType === 'Scene') {
            sceneEntries.push(entry);
            beatGaps[sceneEntries.length] = [];
        } else {
            beatGaps[sceneEntries.length] ||= [];
            beatGaps[sceneEntries.length].push(entry);
        }
    }

    const fromSceneIdx = sceneEntries.findIndex((entry) => entry.sceneId === sourceSceneId);
    const toSceneIdx = sceneEntries.findIndex((entry) => entry.sceneId === targetSceneId);
    if (fromSceneIdx === -1 || toSceneIdx === -1) return [...order];

    const reorderedScenes = [...sceneEntries];
    const [movedScene] = reorderedScenes.splice(fromSceneIdx, 1);
    if (!movedScene) return [...order];

    const insertionIndex = fromSceneIdx < toSceneIdx ? Math.max(0, toSceneIdx - 1) : toSceneIdx;
    reorderedScenes.splice(insertionIndex, 0, movedScene);

    const rebuilt: OuterRingOrderEntry[] = [];
    rebuilt.push(...(beatGaps[0] ?? []));
    reorderedScenes.forEach((scene, index) => {
        rebuilt.push(scene);
        rebuilt.push(...(beatGaps[index + 1] ?? []));
    });
    return rebuilt;
}

function describeFollowUpIssue(error: unknown): string {
    if (error instanceof SceneReorderVerificationError && error.message.trim()) {
        return error.message.trim();
    }
    if (error instanceof Error && error.message.trim()) {
        return error.message.trim();
    }
    if (typeof error === 'string' && error.trim()) {
        return error.trim();
    }
    return 'Unknown follow-up issue';
}

/**
 * Flag to coordinate with click handlers - prevents file open during/after drag
 */
let dragInProgress = false;
let lastInteractionTime = 0;
let dragInteractionActive = false;

export function isDragInProgress(): boolean {
    return dragInProgress;
}

/**
 * Check if drag interaction is active (arming or dragging).
 * Use this to suspend hover expansion while pointer is engaged for reorder.
 */
export function isDragInteractionActive(): boolean {
    return dragInteractionActive;
}

/**
 * Check if the drag controller recently handled an interaction.
 * This prevents the click handler from double-opening files.
 */
export function wasRecentlyHandledByDrag(): boolean {
    return Date.now() - lastInteractionTime < 100;
}

/**
 * Drag controller for reordering scenes and beats on the outer ring in narrative mode.
 *
 * Drag operates entirely on .rt-scene-group SVG elements (both Scene and Beat item types).
 * Number squares are not involved in drag — they have no hover/drag functionality.
 * Order is built by reading scene groups from the outer ring, sorted by data-start-angle
 * (manuscript order). Number text for renumbering is extracted from the file path basename.
 */
export class OuterRingDragController {
    private readonly svg: SVGSVGElement;
    private readonly view: OuterRingViewAdapter;
    private readonly options: OuterRingDragOptions;

    // Click vs drag discrimination timing
    private CLICK_THRESHOLD_MS = 500;  // If release within this time, treat as click
    private MOVE_THRESHOLD_PX = 7;     // Movement beyond this triggers drag mode

    private currentTarget: DropTarget | null = null;
    private dragging = false;
    private sourceSceneId: string | null = null;
    private sourceSceneGroup: SVGGElement | null = null;  // The .rt-scene-group being dragged
    private sourceItemType: 'Scene' | 'Beat' = 'Scene';  // Track whether dragged item is Scene or Beat
    private holdTimer: number | null = null;
    private startX = 0;
    private startY = 0;
    private startTime = 0;
    private confirming = false;
    private originColor?: string;
    private originModalColor?: string;
    private originStartAngle?: number;
    private originOuterR?: number;
    private sourcePath: string | null = null;
    private sourceScenePathEl: SVGPathElement | null = null;
    private readonly overlays: DragOverlays;

    constructor(view: OuterRingViewAdapter, svg: SVGSVGElement, options: OuterRingDragOptions) {
        this.view = view;
        this.svg = svg;
        this.options = options;
        this.overlays = new DragOverlays(svg);
    }

    attach(): void {
        if (this.options.mode !== 'narrative') return;
        
        // Only the outer ring reorders. Scenes on subplot rings drag to change
        // subplots (SubplotRingDragController); the All Scenes ring does not.
        const outerRing = this.getOuterRingIndex();
        const draggableGroups = Array.from(
            this.svg.querySelectorAll<SVGGElement>('.rt-scene-group[data-item-type="Scene"], .rt-scene-group[data-item-type="Beat"]')
        ).filter(g => Number(g.getAttribute('data-ring') ?? -1) === outerRing);
        if (!draggableGroups.length) return;

        // Mark outer ring groups so CSS can scope grab cursor to them only
        draggableGroups.forEach(g => g.setAttribute('data-draggable', 'true'));

        // Create the tangent-aligned drag reorder indicator (move-horizontal arrows)
        this.overlays.createIndicator();

        // The hold timer that promotes a press into a drag must not outlive the SVG it was pressed on.
        this.view.renderScope.register(() => {
            if (this.holdTimer !== null) {
                window.clearTimeout(this.holdTimer);
                this.holdTimer = null;
            }
        });
        this.view.renderScope.registerDomEvent(window as unknown as HTMLElement, 'pointermove', (evt: PointerEvent) => this.onPointerMove(evt));
        this.view.renderScope.registerDomEvent(window as unknown as HTMLElement, 'pointerup', (evt: PointerEvent) => { void this.onPointerUp(evt); });
        this.view.renderScope.registerDomEvent(window as unknown as HTMLElement, 'keydown', (evt: KeyboardEvent) => this.onKey(evt));
        
        draggableGroups.forEach(group => {
            // Listen on the scene/beat path for pointer events (outer ring only)
            const scenePath = group.querySelector('.rt-scene-path');
            if (scenePath) {
                this.view.renderScope.registerDomEvent(scenePath as unknown as HTMLElement, 'pointerdown', (evt: PointerEvent) => this.startDrag(evt, group));
            }
        });

        // Delegated hover for the drag indicator — show tangent arrows on outer ring groups only
        this.view.renderScope.registerDomEvent(this.svg as unknown as HTMLElement, 'pointerover', (e: PointerEvent) => {
            if (this.dragging) return;
            const group = (e.target as Element).closest<SVGGElement>('.rt-scene-group[data-draggable="true"]');
            if (group) this.showDragIndicator(group);
        });
        this.view.renderScope.registerDomEvent(this.svg as unknown as HTMLElement, 'pointerout', (e: PointerEvent) => {
            const toEl = e.relatedTarget as Element | null;
            const group = (e.target as Element).closest('.rt-scene-group');
            // Only hide if leaving the scene group entirely
            if (group && toEl && group.contains(toEl)) return;
            this.hideDragIndicator();
        });
    }

    private log(msg: string, data?: Record<string, unknown>): void {
        if (!this.options.enableDebug) return;
        const pluginAny = this.view?.plugin as { log?: (message: string, meta?: Record<string, unknown>) => void } | undefined;
        if (pluginAny?.log) {
            pluginAny.log(`Outer ring drag · ${msg}`, data);
        }
    }

    /**
     * Determine the outer ring index (the highest ring number among all scene groups).
     * Only the outer ring supports drag reorder; inner subplot rings are read-only.
     */
    private getOuterRingIndex(): number {
        return getOuterRingIndex(this.svg);
    }

    private cssEscape(value: string): string {
        return cssEscape(value);
    }

    private getCurrentPrefixForCompare(entry: OuterRingOrderEntry): string {
        const basenameMatch = entry.basename.match(/^\s*(\d+(?:\.\d+)?)\s+/);
        if (basenameMatch) return basenameMatch[1];
        return (entry.numberText ?? '').trim();
    }

    private getPrefixWidthForEntry(entry: OuterRingOrderEntry): number {
        const basenameMatch = entry.basename.match(/^\s*(\d+)(?:\.\d+)?\s+/);
        if (basenameMatch?.[1]) return basenameMatch[1].length;
        const numberTextMatch = (entry.numberText ?? '').trim().match(/^(\d+)(?:\.\d+)?$/);
        return numberTextMatch?.[1]?.length ?? 0;
    }

    private formatPrefixWithWidth(index: number, width: number): string {
        return formatIntegerPrefix(index, width);
    }

    private getLabelFromBasename(basename: string, fallbackType: 'Scene' | 'Beat'): string {
        const stripped = basename.replace(/^\s*\d+(?:\.\d+)?\s+/, '').trim();
        return stripped || fallbackType;
    }

    private formatItemDescriptor(entry: Pick<OuterRingOrderEntry, 'itemType' | 'numberText' | 'basename'>): string {
        const label = this.getLabelFromBasename(entry.basename, entry.itemType);
        if (entry.itemType === 'Scene') {
            if (entry.numberText && label && label !== 'Scene') {
                return `Scene ${entry.numberText} ${label}`;
            }
            return entry.numberText ? `Scene ${entry.numberText}` : label;
        }
        if (entry.numberText && label && label !== 'Beat') {
            return `Beat ${entry.numberText} ${label}`;
        }
        if (label && label !== 'Beat') {
            return `${label} beat`;
        }
        return entry.numberText ? `Beat ${entry.numberText}` : 'Beat';
    }

    private formatContext(actNumber?: number, subplot?: string): string | undefined {
        const parts: string[] = [];
        if (actNumber !== undefined && Number.isFinite(actNumber)) {
            parts.push(`Act ${actNumber}`);
        }
        if (subplot && subplot.trim().length > 0) {
            parts.push(subplot.trim());
        }
        return parts.length > 0 ? parts.join(' • ') : undefined;
    }

    private resolveStableItemId(filePath: string | null, fallbackId: string | null | undefined): string {
        const normalizedFallback = (typeof fallbackId === 'string' ? fallbackId.trim() : '')
            || filePath?.trim()
            || 'unknown-item';
        if (!filePath) return normalizedFallback;
        const file = this.view.plugin.app.vault.getAbstractFileByPath(filePath);
        if (!(file instanceof TFile)) return normalizedFallback;
        const frontmatter = this.view.plugin.app.metadataCache.getFileCache(file)?.frontmatter;
        const fromId: unknown = frontmatter?.ID ?? frontmatter?.id ?? frontmatter?.['Reference ID'] ?? frontmatter?.referenceId;
        if (typeof fromId === 'string' && fromId.trim().length > 0) {
            return fromId.trim();
        }
        return normalizedFallback;
    }

    private async recordRecentMove(entry: {
        itemType: 'Scene' | 'Beat';
        filePath: string | null;
        fallbackItemId: string;
        itemLabel: string;
        sourceContext?: string;
        destinationContext?: string;
        summary: string;
        renameCount?: number;
        crossedActs?: boolean;
        rippleRename?: boolean;
    }): Promise<void> {
        const pluginAny = this.view.plugin as {
            settings: RadialTimelineSettings;
            saveSettings?: () => Promise<void>;
        };
        const itemId = this.resolveStableItemId(entry.filePath, entry.fallbackItemId);
        const changed = appendRecentStructuralMove(pluginAny.settings, {
            timestamp: new Date().toISOString(),
            itemType: entry.itemType,
            itemId,
            itemLabel: entry.itemLabel,
            summary: entry.summary,
            renameCount: entry.renameCount ?? 0,
            crossedActs: entry.crossedActs ?? false,
            rippleRename: entry.rippleRename ?? false,
            ...(entry.sourceContext ? { sourceContext: entry.sourceContext } : {}),
            ...(entry.destinationContext ? { destinationContext: entry.destinationContext } : {}),
        });
        if (!changed || typeof pluginAny.saveSettings !== 'function') return;
        try {
            await pluginAny.saveSettings();
        } catch (error) {
            console.warn('Failed to persist recent structural moves history:', error);
        }
    }

    private buildRenumberDiff(
        reordered: OuterRingOrderEntry[],
        forceNoRenumber: boolean = false
    ): { updates: SceneUpdate[]; nextNumberByPath: Map<string, string> } {
        const updates: SceneUpdate[] = [];
        const nextNumberByPath = new Map<string, string>();
        const beatMinorByMajor = new Map<string, number>();
        let nextSceneNumber = 1;
        let currentScenePrefix = '0';

        reordered.forEach((entry) => {
            const nextNumber = entry.itemType === 'Scene'
                ? (() => {
                    const width = this.getPrefixWidthForEntry(entry);
                    const prefix = this.formatPrefixWithWidth(nextSceneNumber, width);
                    currentScenePrefix = prefix;
                    nextSceneNumber += 1;
                    return prefix;
                })()
                : (() => {
                    const major = currentScenePrefix || '0';
                    const nextMinor = (beatMinorByMajor.get(major) ?? 0) + 1;
                    beatMinorByMajor.set(major, nextMinor);
                    return formatBeatDecimalPrefix(major, nextMinor, 2);
                })();
            nextNumberByPath.set(entry.path, nextNumber);
            if (!forceNoRenumber) {
                const currentPrefix = this.getCurrentPrefixForCompare(entry);
                if (nextNumber !== currentPrefix) {
                    updates.push({ path: entry.path, newNumber: nextNumber });
                }
            }
        });
        return { updates, nextNumberByPath };
    }

    private isRippleRenameEnabled(): boolean {
        return Boolean(this.view.plugin.settings.enableManuscriptRippleRename);
    }

    private buildContextChangeSummary(sourceContext?: string, destinationContext?: string): string | undefined {
        if (!sourceContext && !destinationContext) return undefined;
        if (!sourceContext) return destinationContext;
        if (!destinationContext) return sourceContext;
        if (sourceContext === destinationContext) return undefined;
        return `${sourceContext} → ${destinationContext}`;
    }

    /** Extract the scene/beat path element ID from an .rt-scene-group */
    private getSceneIdFromSceneGroup(group: Element | null): string | null {
        if (!group) return null;
        const pathEl = group.querySelector<SVGPathElement>('.rt-scene-path');
        return pathEl?.id || null;
    }

    /**
     * Build the combined order of scenes and beats on the outer ring.
     * Reads directly from .rt-scene-group elements sorted by data-start-angle (manuscript order).
     * Number text is extracted from the file path basename prefix (e.g., "03 Scene Title.md" → "03").
     */
    private buildOuterRingOrder(): OuterRingOrderEntry[] {
        // Use shared helper for outer ring detection
        const outerRing = this.getOuterRingIndex();
        
        // Get all scene AND beat groups on the outer ring, sorted by start angle (manuscript order)
        const outerGroups = Array.from(
            this.svg.querySelectorAll<SVGGElement>('.rt-scene-group')
        ).filter(g => {
            const ring = Number(g.getAttribute('data-ring') ?? -1);
            const itemType = g.getAttribute('data-item-type');
            return ring === outerRing && (itemType === 'Scene' || itemType === 'Beat');
        }).sort((a, b) => {
            const aAngle = Number(a.getAttribute('data-start-angle') ?? 0);
            const bAngle = Number(b.getAttribute('data-start-angle') ?? 0);
            return aAngle - bAngle;
        });
        
        const mapped = outerGroups.map((group) => {
            const sceneId = this.getSceneIdFromSceneGroup(group) || '';
            const encodedPath = group.getAttribute('data-path') || '';
            const path = encodedPath ? decodeURIComponent(encodedPath) : '';
            const itemType = (group.getAttribute('data-item-type') as 'Scene' | 'Beat') || 'Scene';
            
            // Extract basename and numeric prefix from file path (e.g., "01 Opening Image.md" → "01")
            const basename = path ? fileStem(path) : '';
            let numberText = '';
            const prefixMatch = basename.match(/^\s*(\d+(?:\.\d+)?)\s+/);
            numberText = prefixMatch ? prefixMatch[1] : '';
            
            const act = Number(group.getAttribute('data-act') ?? 0);
            const ring = Number(group.getAttribute('data-ring') ?? 0);
            const startAngle = Number(group.getAttribute('data-start-angle') ?? 0);
            return { sceneId, path, basename, numberText, act, ring, itemType, startAngle };
        }).filter(entry => entry.sceneId && entry.path);

        const deduped = dedupeOuterRingOrderEntries(mapped);
        if (deduped.length !== mapped.length) {
            this.log('deduped outer ring order', { before: mapped.length, after: deduped.length });
        }
        return deduped;
    }

    private clearHighlight(): void {
        // Clear scene/beat group highlight
        if (this.currentTarget?.type === 'scene') {
            this.currentTarget.group.classList.remove('rt-drop-target');
            this.currentTarget.group.style.removeProperty('--rt-drag-stroke-color');
        }
        // Clear void cell highlight
        if (this.currentTarget?.type === 'void') {
            this.currentTarget.element.classList.remove('rt-drop-target');
            this.currentTarget.element.style.removeProperty('--rt-drag-stroke-color');
        }
        this.currentTarget = null;

        // Hide tick and arc completely when not in use
        this.overlays.clear();
    }

    private setHighlight(target: DropTarget | null): void {
        if (!target) {
            this.clearHighlight();
            return;
        }
        
        // Check if same target
        if (this.currentTarget) {
            if (target.type === 'scene' && this.currentTarget.type === 'scene' && 
                target.group === this.currentTarget.group) return;
            if (target.type === 'void' && this.currentTarget.type === 'void' &&
                target.element === this.currentTarget.element) return;
        }
        
        this.clearHighlight();
        this.currentTarget = target;

        if (target.type === 'scene') {
            // target.group is always an .rt-scene-group element (Scene or Beat)
            target.group.classList.add('rt-drop-target');
            if (this.originColor) {
                target.group.style.setProperty('--rt-drag-stroke-color', this.originColor);
            }
            
            const startAngle = Number(target.group.getAttribute('data-start-angle') ?? '');
            const outerR = Number(target.group.getAttribute('data-outer-r') ?? '');
            if (!Number.isFinite(startAngle) || !Number.isFinite(outerR)) return;
            this.overlays.showTick(startAngle, this.originColor);
            if (this.originStartAngle !== undefined && this.originOuterR !== undefined) {
                this.overlays.showArc(this.originStartAngle, startAngle, this.originColor);
            }
        } else if (target.type === 'void') {
            target.element.classList.add('rt-drop-target');
            if (this.originColor) {
                target.element.style.setProperty('--rt-drag-stroke-color', this.originColor);
            }
            // For void cell, show tick at the start of the void area
            const outerR = Number(target.element.getAttribute('data-outer-r') ?? '');
            if (Number.isFinite(target.startAngle) && Number.isFinite(outerR)) {
                this.overlays.showTick(target.startAngle, this.originColor);
                if (this.originStartAngle !== undefined) {
                    this.overlays.showArc(this.originStartAngle, target.startAngle, this.originColor);
                }
            }
        }
    }

    /**
     * Reorder targets are on the outer ring only: its scenes and beats, and
     * its empty acts. A drop on a subplot ring does nothing from here — the
     * All Scenes ring is no subplot membership.
     */
    private isValidTarget(target: DropTarget): boolean {
        return target.type === 'void' ? target.isOuterRing : target.ring === this.getOuterRingIndex();
    }

    private findDropTarget(evt: PointerEvent): DropTarget | null {
        const fromPoint = this.svg.ownerDocument.elementFromPoint(evt.clientX, evt.clientY);
        if (!fromPoint) return null;
        
        // First check for void cells (empty act areas or empty subplot rings)
        // Look for ANY void cell with data-act attribute (all rings)
        const voidCell = fromPoint.closest<SVGPathElement>('.rt-void-cell[data-act]');
        if (voidCell) {
            const act = Number(voidCell.getAttribute('data-act') ?? '');
            const ring = Number(voidCell.getAttribute('data-ring') ?? '');
            const startAngle = Number(voidCell.getAttribute('data-start-angle') ?? '');
            const endAngle = Number(voidCell.getAttribute('data-end-angle') ?? '');
            const isOuterRing = voidCell.getAttribute('data-outer-ring') === 'true';
            if (Number.isFinite(act) && Number.isFinite(ring)) {
                const target: DropTarget = { type: 'void', element: voidCell, act, ring, startAngle, endAngle, isOuterRing };
                return this.isValidTarget(target) ? target : null;
            }
        }
        
        // Check for scene or beat groups (any ring, not just outer)
        const sceneGroup = fromPoint.closest<SVGGElement>('.rt-scene-group[data-item-type="Scene"], .rt-scene-group[data-item-type="Beat"]');
        if (sceneGroup) {
            const sceneId = this.getSceneIdFromSceneGroup(sceneGroup);
            const act = Number(sceneGroup.getAttribute('data-act') ?? '0');
            const ring = Number(sceneGroup.getAttribute('data-ring') ?? '0');
            if (sceneId) {
                const target: DropTarget = { type: 'scene', group: sceneGroup, sceneId, act, ring };
                return this.isValidTarget(target) ? target : null;
            }
        }
        
        return null;
    }


    private resetState(): void {
        // Only mark interaction time if a drag was actually in progress
        // Quick clicks should NOT block the click handler
        if (this.dragging) {
            lastInteractionTime = Date.now();
        }
        this.dragging = false;
        dragInProgress = false;
        dragInteractionActive = false;
        this.sourceSceneId = null;
        this.sourcePath = null;
        this.sourceItemType = 'Scene';
        this.originModalColor = undefined;
        if (this.sourceScenePathEl) {
            this.sourceScenePathEl.style.removeProperty('fill');
        }
        this.sourceScenePathEl = null;
        if (this.sourceSceneGroup) {
            this.sourceSceneGroup.classList.remove('rt-drag-source');
            this.sourceSceneGroup.style.removeProperty('--rt-drag-stroke-color');
        }
        this.sourceSceneGroup = null;
        if (this.holdTimer !== null) {
            window.clearTimeout(this.holdTimer);
            this.holdTimer = null;
        }
        this.svg.classList.remove('rt-dragging-outer');
        this.clearHighlight();
        this.log('resetState');
    }

    private beginDrag(): void {
        if (this.dragging || !this.sourceSceneGroup) return;
        this.dragging = true;
        dragInProgress = true;
        lastInteractionTime = Date.now(); // Mark start so click handler knows to skip
        this.svg.classList.add('rt-dragging-outer');
        this.sourceSceneGroup.classList.add('rt-drag-source');
        if (this.originColor) {
            this.sourceSceneGroup.style.setProperty('--rt-drag-stroke-color', this.originColor);
            if (this.sourceScenePathEl) {
                this.sourceScenePathEl.style.setProperty('fill', this.originColor);
            }
        } else {
            this.sourceSceneGroup.style.removeProperty('--rt-drag-stroke-color');
            if (this.sourceScenePathEl) {
                this.sourceScenePathEl.style.removeProperty('fill');
            }
        }
        this.hideDragIndicator(); // Hide tangent arrows during drag
        this.log('beginDrag', { sceneId: this.sourceSceneId, itemType: this.sourceItemType });
    }

    private async finishDrag(): Promise<void> {
        if (this.confirming) {
            this.resetState();
            return;
        }
        const target = this.currentTarget;
        if (!target) {
            this.resetState();
            return;
        }
        // An empty act on the outer ring.
        if (target.type === 'void') {
            await this.finishDropOnEmptyAct({ act: target.act, startAngle: target.startAngle });
            return;
        }
        // Another outer-ring scene or beat: reorder.
        await this.finishDropOnScene(target);
    }

    private async finishDropOnScene(target: { type: 'scene'; group: SVGGElement; sceneId: string; act: number; ring: number }): Promise<void> {
        const targetId = target.sceneId;
        if (!this.sourceSceneId || !targetId || this.sourceSceneId === targetId) {
            this.resetState();
            return;
        }

        const order = this.buildOuterRingOrder();
        const fromIdx = order.findIndex(o => o.sceneId === this.sourceSceneId);
        const toIdx = order.findIndex(o => o.sceneId === targetId);
        if (fromIdx === -1 || toIdx === -1) {
            this.resetState();
            return;
        }

        const moved = order[fromIdx];
        const sourceSceneId = this.sourceSceneId;
        const targetEntry = order[toIdx];
        const insertionRelation = 'before' as const;
        let reordered = [...order];
        let isNoOpReorder = false;
        if (moved.itemType === 'Scene' && targetEntry?.itemType === 'Scene') {
            reordered = reorderScenesPreservingBeatGaps(order, sourceSceneId, targetId);
            isNoOpReorder = reordered.every((entry, index) => entry.path === order[index]?.path);
        } else {
            // Always insert before the drop target.
            // When moving forward (fromIdx < toIdx), the target shifts left after removal.
            const insertionIndex = fromIdx < toIdx ? Math.max(0, toIdx - 1) : toIdx;
            isNoOpReorder = insertionIndex === fromIdx;
            reordered = [...order];
            if (!isNoOpReorder) {
                reordered.splice(fromIdx, 1);
                reordered.splice(insertionIndex, 0, moved);
            }
        }

        const { updates: renumberUpdates, nextNumberByPath } = this.buildRenumberDiff(reordered, isNoOpReorder);
        const updates: SceneUpdate[] = [...renumberUpdates];
        const expectedOrderedPaths = reordered.map(entry => entry.path);
        const expectedNumbersByPath = Object.fromEntries(nextNumberByPath);

        const targetPathEl = this.svg.querySelector<SVGPathElement>(`#${this.cssEscape(targetId)}`);
        const targetGroup = targetPathEl?.closest('.rt-scene-group');
        const targetActIdx = targetGroup ? Number(targetGroup.getAttribute('data-act') ?? 0) : 0;
        const targetActNumber = Number.isFinite(targetActIdx) ? (targetActIdx + 1) : undefined;
        const sourcePath = moved.path;
        const sourceType = moved.itemType;

        // Determine source act for comparison (only show Act row if it changes)
        const sourceActIdx = this.sourceSceneGroup ? Number(this.sourceSceneGroup.getAttribute('data-act') ?? 0) : 0;
        const sourceActNumber = sourceActIdx + 1;
        const actChanged = targetActNumber !== undefined && targetActNumber !== sourceActNumber;

        // A reorder on the outer ring never changes a scene's subplot: every
        // scene shares that ring. Subplot changes are drops on a subplot ring.

        // No-op drop: no reorder and no act change means nothing to do.
        if (isNoOpReorder && !actChanged) {
            this.resetState();
            return;
        }

        const sourceOriginalNumber = order[fromIdx]?.numberText ?? '';
        const sourceLabel = sourceType === 'Beat' ? 'beat' : 'scene';
        const sourceDescriptor = this.formatItemDescriptor(moved);
        const targetDescriptor = this.formatItemDescriptor(order[toIdx]);
        // Narrative-mode reorders happen on the "All Scenes" outer ring, where
        // every group carries the ring's subplot-index (0 = Main Plot), not the
        // note's real YAML Subplot. A reorder here never changes a scene's
        // subplot, so show Act context only — a subplot label would be
        // misleading (e.g. "Main Plot" for a scene that lives in another subplot).
        const sourceContext = this.formatContext(sourceActNumber);
        const destinationContext = this.formatContext(targetActNumber);
        const contextChange = this.buildContextChangeSummary(
            sourceContext,
            actChanged ? destinationContext : sourceContext
        );
        const rippleRename = this.isRippleRenameEnabled();
        const recentMoves = getActiveRecentStructuralMoves(this.view.plugin.settings);

        this.confirming = true;
        const modal = new DragConfirmModal(
            this.view.plugin.app,
            {
                actionSummary: `Move ${sourceDescriptor} ${insertionRelation} ${targetDescriptor}`,
                renameCount: renumberUpdates.length,
                ...(contextChange ? { contextChange } : {}),
                rippleRename,
            },
            recentMoves,
            (entry) => openStructuralMoveHistoryLog(this.view.plugin, entry),
            this.originModalColor ?? this.originColor,
            sourceLabel
        );
        const started = await modal.waitForBegin();
        if (!started) {
            this.confirming = false;
            this.resetState();
            return;
        }

        // Apply the act update to the moved item (only if it changed)
        updates.forEach(u => {
            if (u.path === sourcePath && actChanged) {
                u.actNumber = targetActNumber;
            }
        });

        // If the moved item didn't need renumbering, we still need to update its act
        if (!updates.find(u => u.path === sourcePath) && actChanged) {
            updates.push({
                path: sourcePath,
                newNumber: sourceOriginalNumber,
                actNumber: targetActNumber,
            });
        }

        if (updates.length === 0) {
            this.confirming = false;
            this.resetState();
            return;
        }
        let reorderApplied = false;
        try {
            this.log('apply updates', { count: updates.length, from: fromIdx, to: toIdx, itemType: sourceType });
            await applySceneNumberUpdates(this.view.plugin.app, updates, {
                onProgress: (progress) => {
                    modal.updateProgress(this.formatRenameProgressLine('Reorder', progress));
                },
                verification: {
                    expectedOrderedPaths,
                    expectedNumbersByPath,
                    movedItemPath: sourcePath,
                    expectedMovedIndex: reordered.findIndex(entry => entry.path === sourcePath),
                },
                onWarning: () => {
                    new Notice('RT detected a potential issue after this operation. Please review the affected note. If needed, use backup or sync/version history to restore.', 8000);
                },
            });
            reorderApplied = true;
            const historySummary = `${sourceDescriptor} | ${targetDescriptor}`;
            const noticeText = `${sourceDescriptor} before ${targetDescriptor}`;
            await this.recordRecentMove({
                itemType: sourceType,
                filePath: sourcePath,
                fallbackItemId: sourceSceneId,
                itemLabel: this.getLabelFromBasename(moved.basename, sourceType),
                sourceContext,
                destinationContext,
                summary: historySummary,
                renameCount: renumberUpdates.length,
                crossedActs: actChanged,
                rippleRename,
            });
            new Notice(noticeText, 2000);
            await this.runRippleRenameIfEnabled((message) => modal.updateProgress(message));
            modal.updateProgress('Refreshing timeline...');
            // Small delay to allow Obsidian's metadata cache to update before refresh
            await sleep(100);
            this.options.onRefresh();
            await modal.finishWithDismiss('Reorder complete.');
        } catch (error) {
            if (error instanceof SceneReorderVerificationError) {
                console.error('Drag reorder verification warning:', error);
                modal.updateProgress('Refreshing timeline...');
                await sleep(100);
                this.options.onRefresh();
                await modal.finishWithDismiss(`Reorder applied, but RT detected a potential issue: ${describeFollowUpIssue(error)}. Please review the affected notes, then dismiss.`, true);
            } else if (reorderApplied) {
                console.error('Drag reorder post-apply warning:', error);
                try {
                    modal.updateProgress('Refreshing timeline...');
                    await sleep(100);
                    this.options.onRefresh();
                } catch (refreshError) {
                    console.error('Drag reorder refresh after post-apply warning failed:', refreshError);
                }
                await modal.finishWithDismiss(`Reorder applied, but a follow-up step reported an issue: ${describeFollowUpIssue(error)}. Please review the affected notes, then dismiss.`, true);
            } else {
                console.error('Drag reorder failed:', error);
                await modal.finishWithDismiss('Reorder failed. Check console for details, then dismiss.', true);
            }
        } finally {
            this.confirming = false;
            this.resetState();
        }
    }

    /**
     * A drop on an empty act of the outer ring: the item moves into that act at
     * the drop position. Its subplots never change here.
     */
    private async finishDropOnEmptyAct(target: { act: number; startAngle: number }): Promise<void> {
        if (!this.sourceSceneId || !this.sourcePath) {
            this.resetState();
            return;
        }
        const sourcePath = this.sourcePath;
        const sourceSceneId = this.sourceSceneId;

        const targetActNumber = target.act + 1; // Convert 0-indexed to 1-indexed
        const order = this.buildOuterRingOrder();
        const fromIdx = order.findIndex(o => o.path === sourcePath);
        if (fromIdx === -1) {
            this.resetState();
            return;
        }
        const movedEntry = order[fromIdx];
        const sourceActNumber = movedEntry.act + 1;
        const actChanged = targetActNumber !== sourceActNumber;

        const sourceType = movedEntry.itemType;
        const sourceLabel = sourceType === 'Beat' ? 'beat' : 'scene';
        const sourceDescriptor = this.formatItemDescriptor(movedEntry);

        const reordered = planEmptyActDropOrder(order, sourcePath, target.startAngle);
        const isNoOpReorder = reordered.every((entry, index) => entry.path === order[index]?.path);
        const { updates: renumberUpdates, nextNumberByPath } = this.buildRenumberDiff(reordered, isNoOpReorder);
        const updates: SceneUpdate[] = [...renumberUpdates];
        const expectedOrderedPaths = reordered.map(entry => entry.path);
        const expectedNumbersByPath = Object.fromEntries(nextNumberByPath);

        // Merge the act update onto the moved item's renumber update. An act-only
        // update keeps the item's own number; '' (no prefix) leaves the filename alone.
        const movedUpdate = updates.find(update => update.path === sourcePath);
        if (movedUpdate) {
            if (actChanged) movedUpdate.actNumber = targetActNumber;
        } else if (actChanged) {
            updates.push({ path: sourcePath, newNumber: movedEntry.numberText ?? '', actNumber: targetActNumber });
        }

        if (updates.length === 0) {
            this.resetState();
            return;
        }
        let reorderApplied = false;

        const sourceContext = this.formatContext(sourceActNumber);
        const destinationContext = this.formatContext(targetActNumber);
        const contextChange = this.buildContextChangeSummary(sourceContext, actChanged ? destinationContext : sourceContext);
        const rippleRename = this.isRippleRenameEnabled();
        const recentMoves = getActiveRecentStructuralMoves(this.view.plugin.settings);
        const destinationLabel = `Act ${targetActNumber}`;

        this.confirming = true;
        const modal = new DragConfirmModal(
            this.view.plugin.app,
            {
                actionSummary: `Move ${sourceDescriptor} to ${destinationLabel}`,
                renameCount: renumberUpdates.length,
                ...(contextChange ? { contextChange } : {}),
                rippleRename,
            },
            recentMoves,
            (entry) => openStructuralMoveHistoryLog(this.view.plugin, entry),
            this.originModalColor ?? this.originColor,
            sourceLabel
        );
        const started = await modal.waitForBegin();
        if (!started) {
            this.confirming = false;
            this.resetState();
            return;
        }

        try {
            this.log('apply empty-act drop', { targetAct: targetActNumber, path: sourcePath, itemType: sourceType, renames: renumberUpdates.length });
            await applySceneNumberUpdates(this.view.plugin.app, updates, {
                onProgress: (progress) => {
                    modal.updateProgress(this.formatRenameProgressLine('Reorder', progress));
                },
                verification: {
                    expectedOrderedPaths,
                    expectedNumbersByPath,
                    movedItemPath: sourcePath,
                    expectedMovedIndex: reordered.findIndex(entry => entry.path === sourcePath),
                },
                onWarning: () => {
                    new Notice('RT detected a potential issue after this operation. Please review the affected note. If needed, use backup or sync/version history to restore.', 8000);
                },
            });
            reorderApplied = true;
            await this.recordRecentMove({
                itemType: sourceType,
                filePath: sourcePath,
                fallbackItemId: sourceSceneId,
                itemLabel: this.getLabelFromBasename(movedEntry.basename, sourceType),
                sourceContext,
                destinationContext,
                summary: `${sourceDescriptor} | ${destinationLabel}`,
                renameCount: renumberUpdates.length,
                crossedActs: actChanged,
                rippleRename,
            });
            new Notice(`Moved ${sourceDescriptor} to ${destinationLabel}`, 2000);
            await this.runRippleRenameIfEnabled((message) => modal.updateProgress(message));
            modal.updateProgress('Refreshing timeline...');
            // Small delay to allow Obsidian's metadata cache to update before refresh
            await sleep(100);
            this.options.onRefresh();
            await modal.finishWithDismiss('Reorder complete.');
        } catch (error) {
            if (error instanceof SceneReorderVerificationError) {
                console.error('Drag reorder verification warning:', error);
                modal.updateProgress('Refreshing timeline...');
                await sleep(100);
                this.options.onRefresh();
                await modal.finishWithDismiss(`Reorder applied, but RT detected a potential issue: ${describeFollowUpIssue(error)}. Please review the affected notes, then dismiss.`, true);
            } else if (reorderApplied) {
                console.error('Drag reorder post-apply warning:', error);
                try {
                    modal.updateProgress('Refreshing timeline...');
                    await sleep(100);
                    this.options.onRefresh();
                } catch (refreshError) {
                    console.error('Drag reorder refresh after post-apply warning failed:', refreshError);
                }
                await modal.finishWithDismiss(`Reorder applied, but a follow-up step reported an issue: ${describeFollowUpIssue(error)}. Please review the affected notes, then dismiss.`, true);
            } else {
                console.error('Drag reorder failed:', error);
                await modal.finishWithDismiss('Reorder failed. Check console for details, then dismiss.', true);
            }
        } finally {
            this.confirming = false;
            this.resetState();
        }
    }

    private formatRenameProgressLine(prefix: string, progress: SceneReorderProgress): string {
        if (progress.phase === 'scan') {
            if (progress.totalFiles === 0) return `${prefix}: no filename renames needed.`;
            return `${prefix}: planning ${progress.totalFiles} file rename(s)...`;
        }
        if (progress.phase === 'stage') {
            return `${prefix}: staging ${progress.stagedFiles}/${progress.totalFiles} files...`;
        }
        if (progress.phase === 'rename') {
            return `${prefix}: renamed ${progress.renamedFiles}/${progress.totalFiles} files.`;
        }
        if (progress.totalFiles === 0) {
            return `${prefix}: no filename renames needed.`;
        }
        return `${prefix}: renamed ${progress.totalFiles}/${progress.totalFiles} files.`;
    }

    private async runRippleRenameIfEnabled(onStatus?: (message: string) => void): Promise<void> {
        const enabled = Boolean(this.view.plugin.settings.enableManuscriptRippleRename);
        if (!enabled) return;

        try {
            const sceneData = await this.view.plugin.getSceneData();
            const plan = buildRippleRenamePlan(sceneData, {
                beatModel: resolveSelectedBeatModelFromSettings(this.view.plugin.settings)
            });
            if (plan.needRename === 0) {
                if (onStatus) onStatus('Ripple rename: already normalized (filenames only; no content edits).');
                else new Notice('Ripple rename: already normalized (filenames only; no content edits).', 2600);
                return;
            }

            if (onStatus) onStatus(`Ripple rename: ${plan.needRename} file(s) need renaming (${plan.checked} checked, filenames only).`);
            else new Notice(`Ripple rename: ${plan.needRename} file(s) need renaming (${plan.checked} checked, filenames only).`, 3200);

            await applySceneNumberUpdates(this.view.plugin.app, plan.updates, {
                onProgress: (progress) => {
                    if (!onStatus) return;
                    onStatus(this.formatRenameProgressLine('Ripple rename', progress));
                },
                verification: {
                    expectedOrderedPaths: plan.orderedPaths,
                    expectedNumbersByPath: plan.expectedNumbersByPath,
                },
                onWarning: () => {
                    new Notice('RT detected a potential issue after this operation. Please review the affected note. If needed, use backup or sync/version history to restore.', 8000);
                },
            });
        } catch (error) {
            if (error instanceof SceneReorderVerificationError) {
                console.warn('Ripple rename verification warning:', error);
                if (onStatus) onStatus('Ripple rename applied, but RT detected a potential issue. Review affected notes.');
                else new Notice('Ripple rename applied, but RT detected a potential issue. Review affected notes.', 5000);
            } else {
                console.error('Ripple rename failed:', error);
                if (onStatus) onStatus('Ripple rename failed. See console for details.');
                else new Notice('Ripple rename failed. See console for details.', 3500);
            }
        }
    }

    private onPointerMove(evt: PointerEvent): void {
        if (!this.sourceSceneGroup || !this.sourceSceneId) return;
        if (!this.dragging) {
            const dx = evt.clientX - this.startX;
            const dy = evt.clientY - this.startY;
            if (Math.sqrt(dx * dx + dy * dy) >= this.MOVE_THRESHOLD_PX) {
                if (this.holdTimer !== null) {
                    window.clearTimeout(this.holdTimer);
                    this.holdTimer = null;
                }
                this.beginDrag();
            }
        }
        if (this.dragging) {
            const target = this.findDropTarget(evt);
            this.setHighlight(target);
            this.log('drag move', { targetType: target?.type });
        }
    }

    private async onPointerUp(evt: PointerEvent): Promise<void> {
        if (this.holdTimer !== null) {
            window.clearTimeout(this.holdTimer);
            this.holdTimer = null;
        }
        
        if (this.dragging) {
            // Drag was in progress - finish it and prevent click handler from firing
            await this.finishDrag();
        } else {
            // No drag happened - just reset, let the click event fire naturally
            // The click handler in AllScenesMode will handle file opening
            // Only mark interaction time if we were tracking (had a source)
            if (this.sourceSceneGroup) {
                // Check if user moved - if so, they started a drag but didn't complete it
                const dx = evt.clientX - this.startX;
                const dy = evt.clientY - this.startY;
                const moved = Math.sqrt(dx * dx + dy * dy) >= this.MOVE_THRESHOLD_PX;
                if (moved) {
                    // User moved but cancelled - mark as handled to prevent click
                    lastInteractionTime = Date.now();
                }
                // If no movement, let the click event fire naturally
            }
            this.resetState();
        }
    }

    private onKey(evt: KeyboardEvent): void {
        // Escape cancels the drag; nothing changes.
        if (evt.key === 'Escape' && this.sourceSceneGroup && !this.confirming) this.resetState();
    }

    /**
     * Check if dragging is possible - requires at least 2 possible locations
     * (either multiple scenes or multiple subplots/acts to drop into)
     */
    private canDrag(): boolean {
        // Count total draggable items (scenes + beats)
        const draggableGroups = this.svg.querySelectorAll('.rt-scene-group[data-item-type="Scene"], .rt-scene-group[data-item-type="Beat"]');
        const itemCount = draggableGroups.length;
        
        // Count void cells (empty slots to drop into)
        const voidCells = this.svg.querySelectorAll('.rt-void-cell[data-act]');
        const voidCount = voidCells.length;
        
        // If only 1 item and no void cells, can't drag anywhere
        if (itemCount <= 1 && voidCount === 0) {
            return false;
        }
        
        // If multiple items, can always reorder
        if (itemCount > 1) {
            return true;
        }
        
        // If 1 item but void cells exist, can move to empty location
        return voidCount > 0;
    }

    private startDrag(evt: PointerEvent, group: SVGGElement): void {
        if (evt.button !== 0) return;
        
        const sceneId = this.getSceneIdFromSceneGroup(group);
        if (!sceneId) return;
        
        // Get the file path
        const encodedPath = group.getAttribute('data-path');
        const filePath = encodedPath ? decodeURIComponent(encodedPath) : null;
        if (!filePath) return;
        
        // Check if dragging is possible
        if (!this.canDrag()) {
            // Let the click proceed normally - don't capture the event
            return;
        }
        
        // Don't call preventDefault/stopPropagation yet - let quick clicks work
        // We'll only block clicks if an actual drag begins
        
        this.sourceSceneId = sceneId;
        this.sourceSceneGroup = group;
        this.sourceScenePathEl = group.querySelector<SVGPathElement>('.rt-scene-path');
        this.sourceItemType = (group.getAttribute('data-item-type') as 'Scene' | 'Beat') || 'Scene';
        this.sourcePath = filePath;
        dragInteractionActive = true;
        this.startX = evt.clientX;
        this.startY = evt.clientY;
        this.startTime = Date.now();
        
        // Drag accent follows publish-stage color (not subplot fill color)
        this.originColor = this.resolvePublishStageColorFromGroup(group);
        this.originModalColor = this.resolveSubplotColorFromGroup(group);
        this.captureOriginGeometry(sceneId);
        
        if (this.holdTimer !== null) {
            window.clearTimeout(this.holdTimer);
        }
        // Begin drag after hold threshold (if not moved)
        this.holdTimer = window.setTimeout(() => {
            this.holdTimer = null;
            this.beginDrag();
        }, this.CLICK_THRESHOLD_MS);
        
        this.log('pointerdown', { sceneId, path: filePath });
    }

    private captureOriginGeometry(sceneId: string): void {
        const pathEl = this.svg.querySelector<SVGPathElement>(`#${this.cssEscape(sceneId)}`);
        const sceneGroup = pathEl?.closest<SVGGElement>('.rt-scene-group');
        if (!sceneGroup) {
            this.originStartAngle = undefined;
            this.originOuterR = undefined;
            return;
        }
        const startAngle = Number(sceneGroup.getAttribute('data-start-angle') ?? '');
        const outerR = Number(sceneGroup.getAttribute('data-outer-r') ?? '');
        this.originStartAngle = Number.isFinite(startAngle) ? startAngle : undefined;
        this.originOuterR = Number.isFinite(outerR) ? outerR : undefined;
    }

    // ── Drag reorder indicator (tangent-aligned move-horizontal arrows) ──
    // Geometry and colour resolution live in ./dragGeometry so Chronologue drag
    // draws identical chrome from one implementation.

    private showDragIndicator(group: SVGGElement): void {
        if (this.dragging) return;
        this.overlays.showIndicator(group, this.resolveSubplotColorFromGroup(group));
    }

    private hideDragIndicator(): void {
        this.overlays.hideIndicator();
    }

    private resolvePublishStageColorFromGroup(group: SVGGElement): string {
        return resolvePublishStageColorFromGroup(this.view.plugin.app, group);
    }

    private resolveSubplotColorFromGroup(group: SVGGElement): string | undefined {
        return resolveSubplotColorFromGroup(group);
    }
}
