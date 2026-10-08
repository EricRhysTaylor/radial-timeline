import { TFile } from 'obsidian';
import type RadialTimelinePlugin from '../../main';
import { DragConfirmModal } from '../../modals/DragConfirmModal';
import {
    applySubplotMembershipChange,
    describeSubplotMembershipChange,
    formatMemberships,
    planSubplotMembership,
    readSubplotMemberships,
    type SubplotMembershipChange,
} from '../../services/SubplotMembership';
import { getActiveFrontmatterMappings } from '../../utils/frontmatter';
import { sleep } from '../../utils/sleep';
import { resolveSubplotColorFromGroup } from './dragGeometry';
import { membershipOfRing } from './subplotRings';

/**
 * Drag a scene from one subplot ring to another to change its subplots
 * (docs/engineering/plans/welcome-scrivener-and-subplot-ring-drag-plan.md,
 * Phase 3). The grabbed ring is the source membership: a drag moves it to the
 * destination ring, Shift at the drop adds the destination instead. Only the
 * scene's Subplot field changes — no renames, reorder, Act or When.
 *
 * Only rings that stand for a subplot take part (see subplotRings). The outer
 * ring does in Progress mode, where it is Main Plot; in Narrative and
 * Chronologue it lists every scene and keeps its own drag (reorder, re-date).
 */

let subplotDragActive = false;
let lastSubplotDragTime = 0;

/** True while a subplot drag is armed or running; hover effects should wait. */
export function isSubplotDragActive(): boolean {
    return subplotDragActive;
}

/** True just after a subplot drag, so the click that ends it does not open the note. */
export function wasRecentlyHandledBySubplotDrag(): boolean {
    return Date.now() - lastSubplotDragTime < 100;
}

export interface SubplotRingViewAdapter {
    plugin: RadialTimelinePlugin;
    renderScope: {
        register: (cb: () => void) => void;
        registerDomEvent: (el: HTMLElement, event: string, handler: (ev: Event) => void) => void;
    };
}

export interface SubplotRingDragOptions {
    mode: string;
    onRefresh: () => void;
    enableDebug?: boolean;
}

type RingTarget = { ring: number; element: Element };
type MembershipDrop = Exclude<SubplotMembershipChange, { kind: 'remove' }>;

const HOLD_MS = 500;
const MOVE_THRESHOLD_PX = 7;

/** "14 Scene" → "Scene 14"; "3 The Wreck" → "Scene 3 The Wreck". */
export function describeSceneFile(basename: string): string {
    const match = basename.match(/^\s*(\d+(?:\.\d+)?)\s+(.*)$/);
    if (!match) return basename;
    const label = match[2].trim();
    return label && label !== 'Scene' ? `Scene ${match[1]} ${label}` : `Scene ${match[1]}`;
}

export class SubplotRingDragController {
    private sourceGroup: SVGGElement | null = null;
    private sourcePath: string | null = null;
    private sourceRing = -1;
    private sourceSubplot: string | null = null;
    private dragging = false;
    private confirming = false;
    private holdTimer: number | null = null;
    private startX = 0;
    private startY = 0;
    private shiftHeld = false;
    private lastPointer: { x: number; y: number } | null = null;
    private target: RingTarget | null = null;
    private highlightedRing: number | null = null;
    private previewEl: HTMLElement | null = null;
    private accent?: string;

    constructor(
        private readonly view: SubplotRingViewAdapter,
        private readonly svg: SVGSVGElement,
        private readonly options: SubplotRingDragOptions
    ) {}

    private membershipOf(ring: number): string | null {
        return membershipOfRing(this.svg, ring, this.options.mode);
    }

    private ringOf(el: Element): number {
        return Number(el.getAttribute('data-ring') ?? -1);
    }

    attach(): void {
        const labelled = Array.from(this.svg.querySelectorAll('.rt-subplot-ring-label-text[data-ring]'))
            .filter(label => this.membershipOf(this.ringOf(label)) !== null);
        // A drop needs somewhere to go: at least two subplot rings.
        if (labelled.length < 2) return;

        const groups = Array.from(this.svg.querySelectorAll<SVGGElement>('.rt-scene-group[data-item-type="Scene"]'))
            .filter(group => this.membershipOf(this.ringOf(group)) !== null);
        if (!groups.length) return;

        this.view.renderScope.register(() => {
            if (this.holdTimer !== null) window.clearTimeout(this.holdTimer);
            this.holdTimer = null;
            this.hidePreview();
            subplotDragActive = false;
        });
        for (const group of groups) {
            group.setAttribute('data-subplot-draggable', 'true');
            const path = group.querySelector('.rt-scene-path');
            if (path) {
                this.view.renderScope.registerDomEvent(path as unknown as HTMLElement, 'pointerdown', (evt: PointerEvent) => this.startDrag(evt, group));
            }
        }
        const win = window as unknown as HTMLElement;
        this.view.renderScope.registerDomEvent(win, 'pointermove', (evt: PointerEvent) => this.onPointerMove(evt));
        this.view.renderScope.registerDomEvent(win, 'pointerup', (evt: PointerEvent) => { void this.onPointerUp(evt); });
        this.view.renderScope.registerDomEvent(win, 'keydown', (evt: KeyboardEvent) => this.onKey(evt));
        this.view.renderScope.registerDomEvent(win, 'keyup', (evt: KeyboardEvent) => this.onKey(evt));
    }

    private log(msg: string, data?: Record<string, unknown>): void {
        if (!this.options.enableDebug) return;
        const pluginAny = this.view.plugin as { log?: (message: string, meta?: Record<string, unknown>) => void };
        pluginAny.log?.(`Subplot ring drag · ${msg}`, data);
    }

    private startDrag(evt: PointerEvent, group: SVGGElement): void {
        if (evt.button !== 0 || this.confirming) return;
        const encodedPath = group.getAttribute('data-path');
        const ring = this.ringOf(group);
        const subplot = this.membershipOf(ring);
        if (!encodedPath || !subplot) return;

        // No preventDefault: a quick click still opens the scene.
        this.sourceGroup = group;
        this.sourcePath = decodeURIComponent(encodedPath);
        this.sourceRing = ring;
        this.sourceSubplot = subplot;
        this.startX = evt.clientX;
        this.startY = evt.clientY;
        this.accent = resolveSubplotColorFromGroup(group);
        subplotDragActive = true;
        if (this.holdTimer !== null) window.clearTimeout(this.holdTimer);
        this.holdTimer = window.setTimeout(() => {
            this.holdTimer = null;
            this.beginDrag();
        }, HOLD_MS);
    }

    private beginDrag(): void {
        if (this.dragging || !this.sourceGroup) return;
        this.dragging = true;
        lastSubplotDragTime = Date.now();
        this.svg.classList.add('rt-dragging-subplot');
        this.sourceGroup.classList.add('rt-drag-source');
        if (this.accent) this.sourceGroup.style.setProperty('--rt-drag-stroke-color', this.accent);
        this.log('begin', { path: this.sourcePath, subplot: this.sourceSubplot });
    }

    private onPointerMove(evt: PointerEvent): void {
        if (!this.sourceGroup) return;
        this.lastPointer = { x: evt.clientX, y: evt.clientY };
        this.shiftHeld = evt.shiftKey;
        if (!this.dragging && Math.hypot(evt.clientX - this.startX, evt.clientY - this.startY) >= MOVE_THRESHOLD_PX) {
            if (this.holdTimer !== null) window.clearTimeout(this.holdTimer);
            this.holdTimer = null;
            this.beginDrag();
        }
        if (!this.dragging) return;
        this.setTarget(this.findTarget(evt));
        this.updatePreview();
    }

    private async onPointerUp(evt: PointerEvent): Promise<void> {
        if (!this.sourceGroup) return;
        if (this.holdTimer !== null) window.clearTimeout(this.holdTimer);
        this.holdTimer = null;
        if (this.dragging) {
            lastSubplotDragTime = Date.now();
            // Shift is read at the drop: releasing it first makes the drop a move.
            await this.finishDrop(evt.shiftKey);
            return;
        }
        if (Math.hypot(evt.clientX - this.startX, evt.clientY - this.startY) >= MOVE_THRESHOLD_PX) {
            lastSubplotDragTime = Date.now();
        }
        this.reset();
    }

    private onKey(evt: KeyboardEvent): void {
        if (!this.sourceGroup || this.confirming) return;
        if (evt.key === 'Escape' && evt.type === 'keydown') {
            if (this.dragging) lastSubplotDragTime = Date.now();
            this.reset();
            return;
        }
        if (evt.key === 'Shift') {
            this.shiftHeld = evt.type === 'keydown';
            this.updatePreview();
        }
    }

    /** Another subplot ring under the pointer: a scene on it or one of its empty cells. */
    private findTarget(evt: PointerEvent): RingTarget | null {
        const el = this.svg.ownerDocument.elementFromPoint(evt.clientX, evt.clientY);
        const hit = el?.closest('.rt-void-cell[data-ring], .rt-scene-group[data-item-type="Scene"]');
        if (!hit) return null;
        const ring = this.ringOf(hit);
        if (ring === this.sourceRing || this.membershipOf(ring) === null) return null;
        return { ring, element: hit };
    }

    // ── Feedback: the destination ring lights up, and a label by the pointer
    // says what the drop will do ("Move A → D", "Add D").

    private setTarget(target: RingTarget | null): void {
        this.target = target;
        if (target?.ring === this.highlightedRing) return;
        this.clearRingHighlight();
        if (!target) return;
        this.highlightedRing = target.ring;
        for (const el of this.ringElements(target.ring)) {
            el.classList.add('rt-membership-target');
            if (this.accent) (el as SVGElement).style.setProperty('--rt-drag-stroke-color', this.accent);
        }
    }

    private ringElements(ring: number): Element[] {
        return Array.from(this.svg.querySelectorAll(`.rt-scene-group[data-ring="${ring}"], .rt-void-cell[data-ring="${ring}"]`));
    }

    private clearRingHighlight(): void {
        if (this.highlightedRing === null) return;
        for (const el of this.ringElements(this.highlightedRing)) {
            el.classList.remove('rt-membership-target');
            (el as SVGElement).style.removeProperty('--rt-drag-stroke-color');
        }
        this.highlightedRing = null;
    }

    private changeFor(ring: number, shift: boolean): MembershipDrop | null {
        const to = this.membershipOf(ring);
        if (!to || !this.sourceSubplot) return null;
        return shift ? { kind: 'add', to } : { kind: 'move', from: this.sourceSubplot, to };
    }

    private readCurrent(): { file: TFile; before: string[] } | null {
        const file = this.sourcePath ? this.view.plugin.app.vault.getAbstractFileByPath(this.sourcePath) : null;
        if (!(file instanceof TFile)) return null;
        return { file, before: readSubplotMemberships(this.view.plugin.app, file, getActiveFrontmatterMappings(this.view.plugin.settings)) };
    }

    private updatePreview(): void {
        const change = this.target ? this.changeFor(this.target.ring, this.shiftHeld) : null;
        const current = change ? this.readCurrent() : null;
        const body = this.svg.ownerDocument?.body;
        if (!change || !current || !body) {
            this.hidePreview();
            return;
        }
        const after = planSubplotMembership(current.before, change);
        const action = after ? describeSubplotMembershipChange(change) : `Already in ${change.to}`;
        const detail = after
            ? `Subplots: ${formatMemberships(after)} · ${this.shiftHeld ? 'release Shift to move' : 'hold Shift to add'}`
            : 'No change';
        if (!this.previewEl) {
            this.previewEl = body.createDiv({ cls: 'rt-drag-membership-preview' });
            this.previewEl.createDiv({ cls: 'rt-drag-membership-preview-action' });
            this.previewEl.createDiv({ cls: 'rt-drag-membership-preview-detail' });
        }
        const [actionEl, detailEl] = Array.from(this.previewEl.children) as HTMLElement[];
        actionEl.setText(action);
        detailEl.setText(detail);
        if (this.lastPointer) {
            this.previewEl.style.setProperty('--rt-drag-preview-x', `${this.lastPointer.x + 16}px`);
            this.previewEl.style.setProperty('--rt-drag-preview-y', `${this.lastPointer.y + 16}px`);
        }
    }

    private hidePreview(): void {
        this.previewEl?.remove();
        this.previewEl = null;
    }

    private async finishDrop(shift: boolean): Promise<void> {
        const change = this.target ? this.changeFor(this.target.ring, shift) : null;
        const current = change ? this.readCurrent() : null;
        const after = change && current ? planSubplotMembership(current.before, change) : null;
        if (!change || !current || !after) {
            this.reset();
            return;
        }
        const { file, before } = current;
        const itemLabel = describeSceneFile(file.basename);
        const accent = this.accent;
        this.hidePreview();

        this.confirming = true;
        const modal = new DragConfirmModal(
            this.view.plugin.app,
            {
                actionSummary: `${itemLabel}: ${describeSubplotMembershipChange(change)}`,
                renameCount: 0,
                showRenameImpact: false,
                contextLabel: 'Subplots',
                contextChange: `${formatMemberships(before)} → ${formatMemberships(after)}`,
                badge: change.kind === 'add' ? 'Add Subplot' : 'Move Scene',
                title: 'Confirm subplot change',
            },
            [],
            undefined,
            accent,
            'scene'
        );
        try {
            if (!(await modal.waitForBegin())) return;
            this.log('apply', { path: file.path, change });
            await applySubplotMembershipChange(this.view.plugin.app, file, change, {
                mappings: getActiveFrontmatterMappings(this.view.plugin.settings),
                itemLabel,
                onChanged: () => {
                    // Let the metadata cache catch up before the timeline redraws.
                    void sleep(100).then(() => this.options.onRefresh());
                },
            });
            // The Undo notice carries the result; no Dismiss step for a subplot change.
            modal.close();
        } catch (error) {
            console.error('Subplot membership change failed:', error);
            await modal.finishWithDismiss('Subplot change failed. Check console for details, then dismiss.', true);
        } finally {
            this.confirming = false;
            this.reset();
        }
    }

    private reset(): void {
        if (this.holdTimer !== null) window.clearTimeout(this.holdTimer);
        this.holdTimer = null;
        this.hidePreview();
        this.clearRingHighlight();
        this.svg.classList.remove('rt-dragging-subplot');
        if (this.sourceGroup) {
            this.sourceGroup.classList.remove('rt-drag-source');
            this.sourceGroup.style.removeProperty('--rt-drag-stroke-color');
        }
        this.sourceGroup = null;
        this.sourcePath = null;
        this.sourceRing = -1;
        this.sourceSubplot = null;
        this.target = null;
        this.dragging = false;
        this.shiftHeld = false;
        this.lastPointer = null;
        subplotDragActive = false;
    }
}

/**
 * Subplot drag for the modes that show subplot rings: Narrative, Chronologue
 * and Progress. Saga scope spans books and is left out, as for the other drags.
 */
export function setupSubplotRingDrag(
    view: SubplotRingViewAdapter & {
        currentMode: string;
        refreshTimeline: () => void;
        plugin: { settings: { timelineScope?: string; enableHoverDebugLogging?: boolean } };
    },
    svg: SVGSVGElement
): void {
    if (view.plugin.settings.timelineScope === 'saga') return;
    new SubplotRingDragController(view, svg, {
        mode: view.currentMode,
        onRefresh: () => view.refreshTimeline(),
        enableDebug: view.plugin.settings.enableHoverDebugLogging,
    }).attach();
}
