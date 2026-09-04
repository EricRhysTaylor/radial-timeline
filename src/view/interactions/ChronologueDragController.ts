/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 *
 * Chronologue Drag Controller
 *
 * Dragging on the Chronologue ring re-dates a scene. Dropping on scene B means
 * "place immediately before B"; the modal resolves that intent to a timestamp.
 *
 * This never renumbers or renames anything. Manuscript order and chronological
 * order are independent axes — the gap between them is what Chronologue exists
 * to show — so the only thing written is `When`.
 */

import { Notice, TFile } from 'obsidian';
import type RadialTimelinePlugin from '../../main';
import type { TimelineItem } from '../../types';
import { buildChronologueSceneSequence } from '../../utils/sceneHelpers';
import { parseDuration } from '../../utils/date';
import { writeFrontmatterUpdates } from '../../timelineRepair/frontmatterWriter';
import {
    ChronologuePlacementModal,
    type PlacementOption
} from '../../modals/ChronologuePlacementModal';
import { generateCandidates } from '../../chronologue/placement/generateCandidates';
import {
    resolvePlacementNeighbors,
    resolveSeamIntervals,
    type NeighborResolution
} from '../../chronologue/placement/resolveNeighbors';
import type { SeamChoice } from '../../chronologue/placement/types';
import {
    DragOverlays,
    getOuterRingIndex,
    resolvePublishStageColorFromGroup,
    resolveSubplotColorFromGroup
} from './dragGeometry';
import { isAlienModeActive, isRuntimeModeActive, isShiftModeActive } from './ChronologueShiftController';

export interface ChronologueDragViewAdapter {
    plugin: RadialTimelinePlugin;
    sceneData: TimelineItem[];
    renderScope: {
        register: (cb: () => void) => void;
        registerDomEvent: (el: HTMLElement, event: string, handler: (ev: Event) => void) => void;
    };
}

export interface ChronologueDragOptions {
    onRefresh: () => void;
}

/** Click-vs-drag discrimination, matched to narrative drag so the ring feels the same. */
const CLICK_THRESHOLD_MS = 500;
const MOVE_THRESHOLD_PX = 7;

let lastInteractionTime = 0;

/** Guards the click handler from opening a file at the end of a drag. */
export function wasRecentlyHandledByChronologueDrag(): boolean {
    return Date.now() - lastInteractionTime < 100;
}

interface DropTarget {
    group: SVGGElement;
    path: string;
    startAngle: number;
}

export class ChronologueDragController {
    private readonly overlays: DragOverlays;

    private dragging = false;
    private sourceGroup: SVGGElement | null = null;
    private sourcePath: string | null = null;
    private sourceStartAngle: number | undefined;
    private accentColor: string | undefined;
    private modalAccent: string | undefined;
    private currentTarget: DropTarget | null = null;
    private holdTimer: number | null = null;
    private startX = 0;
    private startY = 0;
    private committing = false;

    constructor(
        private readonly view: ChronologueDragViewAdapter,
        private readonly svg: SVGSVGElement,
        private readonly options: ChronologueDragOptions
    ) {
        this.overlays = new DragOverlays(svg);
    }

    attach(): void {
        const outerRing = getOuterRingIndex(this.svg);
        const sources = Array.from(
            this.svg.querySelectorAll<SVGGElement>('.rt-scene-group[data-item-type="Scene"]')
        ).filter(group => Number(group.getAttribute('data-ring') ?? -1) === outerRing); // SAFE: -1 never equals a real ring index, so ringless groups are skipped
        if (sources.length < 2) return;

        sources.forEach(group => group.setAttribute('data-draggable', 'true'));
        this.overlays.createIndicator();

        this.view.renderScope.registerDomEvent(window as unknown as HTMLElement, 'pointermove', (evt: PointerEvent) => this.onPointerMove(evt));
        this.view.renderScope.registerDomEvent(window as unknown as HTMLElement, 'pointerup', (evt: PointerEvent) => { void this.onPointerUp(evt); });

        sources.forEach(group => {
            const scenePath = group.querySelector('.rt-scene-path');
            if (!scenePath) return;
            this.view.renderScope.registerDomEvent(scenePath as unknown as HTMLElement, 'pointerdown', (evt: PointerEvent) => this.startDrag(evt, group));
        });

        this.view.renderScope.registerDomEvent(this.svg as unknown as HTMLElement, 'pointerover', (evt: PointerEvent) => {
            if (this.dragging || this.subModeActive()) return;
            const group = (evt.target as Element).closest<SVGGElement>('.rt-scene-group[data-draggable="true"]');
            if (group) {
                this.overlays.showIndicator(group, resolveSubplotColorFromGroup(group, this.view.plugin.settings.subplotColors));
            }
        });
        this.view.renderScope.registerDomEvent(this.svg as unknown as HTMLElement, 'pointerout', (evt: PointerEvent) => {
            const toEl = evt.relatedTarget as Element | null;
            const group = (evt.target as Element).closest('.rt-scene-group');
            if (group && toEl && group.contains(toEl)) return;
            this.overlays.hideIndicator();
        });
    }

    /**
     * Shift / Alien / Runtime own the pointer and rewrite the date labels while
     * active. A drag underneath them would be incoherent, so it is suppressed.
     */
    private subModeActive(): boolean {
        return isShiftModeActive() || isAlienModeActive() || isRuntimeModeActive();
    }

    // ── gesture ────────────────────────────────────────────────────────────

    private startDrag(evt: PointerEvent, group: SVGGElement): void {
        if (evt.button !== 0 || this.subModeActive() || this.committing) return;

        const encodedPath = group.getAttribute('data-path');
        const path = encodedPath ? decodeURIComponent(encodedPath) : null;
        if (!path) return;

        this.sourceGroup = group;
        this.sourcePath = path;
        this.startX = evt.clientX;
        this.startY = evt.clientY;

        const startAngle = Number(group.getAttribute('data-start-angle') ?? '');
        this.sourceStartAngle = Number.isFinite(startAngle) ? startAngle : undefined;
        this.accentColor = resolvePublishStageColorFromGroup(this.view.plugin.app, group);
        this.modalAccent = resolveSubplotColorFromGroup(group, this.view.plugin.settings.subplotColors);

        if (this.holdTimer !== null) window.clearTimeout(this.holdTimer);
        this.holdTimer = window.setTimeout(() => {
            this.holdTimer = null;
            this.beginDrag();
        }, CLICK_THRESHOLD_MS);
    }

    private beginDrag(): void {
        if (this.dragging || !this.sourceGroup) return;
        this.dragging = true;
        lastInteractionTime = Date.now();
        this.svg.classList.add('rt-dragging-outer');
        this.sourceGroup.classList.add('rt-drag-source');
        if (this.accentColor) {
            this.sourceGroup.style.setProperty('--rt-drag-stroke-color', this.accentColor);
        }
        this.overlays.hideIndicator();
    }

    private onPointerMove(evt: PointerEvent): void {
        if (!this.sourceGroup) return;

        if (!this.dragging) {
            const dx = evt.clientX - this.startX;
            const dy = evt.clientY - this.startY;
            if (Math.sqrt(dx * dx + dy * dy) < MOVE_THRESHOLD_PX) return;
            if (this.holdTimer !== null) {
                window.clearTimeout(this.holdTimer);
                this.holdTimer = null;
            }
            this.beginDrag();
        }

        this.setHighlight(this.findDropTarget(evt));
    }

    private async onPointerUp(evt: PointerEvent): Promise<void> {
        if (this.holdTimer !== null) {
            window.clearTimeout(this.holdTimer);
            this.holdTimer = null;
        }

        if (!this.dragging) {
            if (this.sourceGroup) {
                const dx = evt.clientX - this.startX;
                const dy = evt.clientY - this.startY;
                // Moved but never armed: swallow the click so no file opens.
                if (Math.sqrt(dx * dx + dy * dy) >= MOVE_THRESHOLD_PX) lastInteractionTime = Date.now();
            }
            this.reset();
            return;
        }

        const target = this.currentTarget;
        const sourcePath = this.sourcePath;
        if (!target || !sourcePath) {
            this.reset();
            return;
        }

        await this.commitDrop(sourcePath, target.path);
    }

    private findDropTarget(evt: PointerEvent): DropTarget | null {
        const fromPoint = this.svg.ownerDocument.elementFromPoint(evt.clientX, evt.clientY);
        const group = fromPoint?.closest<SVGGElement>('.rt-scene-group[data-item-type="Scene"]');
        if (!group) return null;

        const encodedPath = group.getAttribute('data-path');
        const path = encodedPath ? decodeURIComponent(encodedPath) : null;
        if (!path || path === this.sourcePath) return null;

        const startAngle = Number(group.getAttribute('data-start-angle') ?? '');
        if (!Number.isFinite(startAngle)) return null;
        return { group, path, startAngle };
    }

    private setHighlight(target: DropTarget | null): void {
        if (this.currentTarget?.group === target?.group) return;

        if (this.currentTarget) {
            this.currentTarget.group.classList.remove('rt-drop-target');
            this.currentTarget.group.style.removeProperty('--rt-drag-stroke-color');
        }
        this.currentTarget = target;
        this.overlays.clear();
        if (!target) return;

        target.group.classList.add('rt-drop-target');
        if (this.accentColor) {
            target.group.style.setProperty('--rt-drag-stroke-color', this.accentColor);
        }
        this.overlays.showTick(target.startAngle, this.accentColor);
        if (this.sourceStartAngle !== undefined) {
            this.overlays.showArc(this.sourceStartAngle, target.startAngle, this.accentColor);
        }
    }

    // ── commit ─────────────────────────────────────────────────────────────

    private async commitDrop(sourcePath: string, targetPath: string): Promise<void> {
        const sequence = buildChronologueSceneSequence(this.view.sceneData);
        const resolution = resolvePlacementNeighbors(sequence, sourcePath, targetPath);

        if (resolution.kind === 'noop' || resolution.kind === 'not_found') {
            this.reset();
            return;
        }
        if (resolution.kind === 'undated') {
            new Notice(`Give "${resolution.sceneTitle}" a When date before placing a scene next to it.`, 6000);
            this.reset();
            return;
        }

        const draggedScene = sequence.find(scene => scene.path === sourcePath);
        const file = this.view.plugin.app.vault.getAbstractFileByPath(sourcePath);
        if (!draggedScene || !(file instanceof TFile)) {
            new Notice('That scene note could not be found in the vault.', 6000);
            this.reset();
            return;
        }

        const draggedDurationMs = parseDuration(draggedScene.Duration);
        const currentWhen = draggedScene.when instanceof Date ? draggedScene.when : null; // SAFE: an undated scene simply gets no keep-the-time candidate
        const placementOptions = this.buildOptions(resolution, sequence, sourcePath, currentWhen, draggedDurationMs);
        if (placementOptions.length === 0) {
            new Notice('There is no room between those two scenes for another date.', 6000);
            this.reset();
            return;
        }

        this.committing = true;
        const modal = new ChronologuePlacementModal(this.view.plugin.app, placementOptions, {
            sceneTitle: draggedScene.title || file.basename, // SAFE: the filename is the author-visible identity when a note has no Title
            currentWhen,
            draggedDurationMs,
            accent: this.modalAccent ?? this.accentColor // SAFE: publish-stage colour is the documented accent when a scene has no subplot colour
        });

        const placement = await modal.waitForPlacement();
        if (!placement) {
            this.committing = false;
            this.reset();
            return;
        }

        try {
            // writeFrontmatterUpdates catches per-file errors and reports them in
            // its result — it does not throw. Reporting success without reading
            // that result would tell the author the scene moved when When is
            // unchanged, and the timeline refresh below would silently disagree.
            const writeResult = await writeFrontmatterUpdates(
                this.view.plugin.app,
                [{ file, when: placement.when, whenSource: 'manual' }],
                { logTool: 'chronologue' }
            );
            if (writeResult.success === 0) {
                const detail = writeResult.errors[0]?.error ?? 'the note could not be updated'; // SAFE: a zero-success write with no recorded error still needs author-facing wording
                console.error('Chronologue placement write failed:', writeResult.errors);
                await modal.finishWithDismiss(`Could not write the When field: ${detail}`, true);
                return;
            }
            new Notice(`${draggedScene.title || file.basename} → ${placement.storedWhen}`, 2000); // SAFE: filename identity again, same rule as the modal title
            modal.updateProgress('Refreshing timeline...');
            // Let Obsidian's metadata cache catch up before the re-render reads it.
            await new Promise(resolve => window.setTimeout(resolve, 100));
            this.options.onRefresh();
            await modal.finishWithDismiss('Placed.');
        } catch (error) {
            console.error('Chronologue placement failed:', error);
            await modal.finishWithDismiss(
                `Could not write the When field: ${error instanceof Error ? error.message : String(error)}`,
                true
            );
        } finally {
            this.committing = false;
            this.reset();
        }
    }

    /**
     * One option normally; two at the circular seam, where "before the opening
     * scene" and "after the closing scene" are the same arc and only the author
     * knows which was meant.
     */
    private buildOptions(
        resolution: Extract<NeighborResolution, { kind: 'ok' } | { kind: 'seam' }>,
        sequence: TimelineItem[],
        sourcePath: string,
        currentWhen: Date | null,
        draggedDurationMs: number | null
    ): PlacementOption[] {
        const toOption = (
            id: PlacementOption['id'],
            label: string,
            candidate: NeighborResolution
        ): PlacementOption | null => {
            if (candidate.kind !== 'ok') return null;
            return {
                id,
                label,
                interval: candidate.interval,
                candidates: generateCandidates(candidate.interval, currentWhen, draggedDurationMs)
            };
        };

        if (resolution.kind === 'ok') {
            const option = toOption('default', 'Placement', resolution);
            return option ? [option] : [];
        }

        const seams = resolveSeamIntervals(sequence, sourcePath);
        const labels: Record<SeamChoice, string> = {
            'before-first': 'Before the opening scene',
            'after-last': 'After the closing scene'
        };
        return [
            toOption('before-first', labels['before-first'], seams.beforeFirst),
            toOption('after-last', labels['after-last'], seams.afterLast)
        ].filter((option): option is PlacementOption => option !== null);
    }

    private reset(): void {
        if (this.dragging) lastInteractionTime = Date.now();
        this.dragging = false;

        if (this.sourceGroup) {
            this.sourceGroup.classList.remove('rt-drag-source');
            this.sourceGroup.style.removeProperty('--rt-drag-stroke-color');
        }
        this.sourceGroup = null;
        this.sourcePath = null;
        this.sourceStartAngle = undefined;

        if (this.currentTarget) {
            this.currentTarget.group.classList.remove('rt-drop-target');
            this.currentTarget.group.style.removeProperty('--rt-drag-stroke-color');
            this.currentTarget = null;
        }

        if (this.holdTimer !== null) {
            window.clearTimeout(this.holdTimer);
            this.holdTimer = null;
        }

        this.svg.classList.remove('rt-dragging-outer');
        this.overlays.clear();
    }
}
