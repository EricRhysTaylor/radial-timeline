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
import { formatNumber } from '../../utils/svg';
import { readSubplotColor } from '../../renderer/utils/subplotColors';
import { membershipOfRing } from './subplotRings';
import { t } from '../../i18n';

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
const SVG_NS = 'http://www.w3.org/2000/svg';

/** A whole ring between two radii: both circles, each drawn as two half arcs. */
export function ringOutlinePath(innerR: number, outerR: number): string {
    const circle = (r: number): string => {
        const x = formatNumber(r);
        return `M ${x} 0 A ${x} ${x} 0 1 1 ${formatNumber(-r)} 0 A ${x} ${x} 0 1 1 ${x} 0 Z`;
    };
    return `${circle(outerR)} ${circle(innerR)}`;
}

/** "14 Scene" → "Scene 14"; "3 The Wreck" → "Scene 3 The Wreck". */
export function describeSceneFile(basename: string): string {
    const match = basename.match(/^\s*(\d+(?:\.\d+)?)\s+(.*)$/);
    if (!match) return basename;
    const label = match[2].trim();
    return label && label !== 'Scene'
        ? t('ui.subplotRingDragController.sceneNumberLabel', { number: match[1], label })
        : t('ui.subplotRingDragController.sceneNumber', { number: match[1] });
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
    private outline: SVGGElement | null = null;
    private outlinedRing: number | null = null;
    private ringColors = new Map<number, string | undefined>();
    private previewEl: HTMLElement | null = null;

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
        this.setSourceFill(this.ringColor(this.sourceRing));
        this.log('begin', { path: this.sourcePath, subplot: this.sourceSubplot });
    }

    private onPointerMove(evt: PointerEvent): void {
        if (this.confirming || !this.sourceGroup) return;
        this.lastPointer = { x: evt.clientX, y: evt.clientY };
        this.shiftHeld = evt.shiftKey;
        if (!this.dragging && Math.hypot(evt.clientX - this.startX, evt.clientY - this.startY) >= MOVE_THRESHOLD_PX) {
            if (this.holdTimer !== null) window.clearTimeout(this.holdTimer);
            this.holdTimer = null;
            this.beginDrag();
        }
        if (!this.dragging) return;
        this.target = this.findTarget(evt);
        this.updateFeedback();
    }

    private async onPointerUp(evt: PointerEvent): Promise<void> {
        if (this.confirming || !this.sourceGroup) return;
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
            if (this.dragging) this.updateFeedback();
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

    // ── Feedback. The destination ring is outlined in its own colour. On a
    // move the grabbed scene takes that colour too, since it is leaving its
    // ring for that one; on an add (Shift) it keeps its own, since it stays.
    // A drop that would change nothing outlines nothing. A label by the
    // pointer says what the drop will do ("Move A → D", "Add D").

    private updateFeedback(): void {
        const target = this.target;
        const change = target ? this.changeFor(target.ring, this.shiftHeld) : null;
        const current = change ? this.readCurrent() : null;
        const after = change && current ? planSubplotMembership(current.before, change) : null;
        const destination = target && after ? target.ring : null;
        this.showRingOutline(destination);
        this.setSourceFill(this.ringColor(destination !== null && change?.kind === 'move' ? destination : this.sourceRing));
        // No preview when the scene's note cannot be read.
        this.updatePreview(current ? change : null, after);
    }

    /** The colour a subplot ring is painted in, from its label's colour slot. */
    private ringColor(ring: number): string | undefined {
        if (!this.ringColors.has(ring)) {
            const slot = this.svg.querySelector(`.rt-subplot-ring-label-text[data-ring="${ring}"]`)?.getAttribute('data-color-index');
            this.ringColors.set(ring, slot == null ? undefined : readSubplotColor(this.svg.ownerDocument, Number(slot)));
        }
        return this.ringColors.get(ring);
    }

    private setSourceFill(color: string | undefined): void {
        if (!this.sourceGroup) return;
        if (color) this.sourceGroup.style.setProperty('--rt-membership-color', color);
        else this.sourceGroup.style.removeProperty('--rt-membership-color');
    }

    private ringElements(ring: number): Element[] {
        return Array.from(this.svg.querySelectorAll(`.rt-scene-group[data-ring="${ring}"], .rt-void-cell[data-ring="${ring}"]`));
    }

    /**
     * One outline around the whole ring, laid over the rings and act spokes
     * (under the number squares), so neighbouring rings cannot cover any edge.
     */
    private showRingOutline(ring: number | null): void {
        if (ring === this.outlinedRing) return;
        this.removeRingOutline();
        if (ring === null) return;
        const cells = this.ringElements(ring);
        const innerR = Math.min(...cells.map(el => Number(el.getAttribute('data-inner-r'))));
        const outerR = Math.max(...cells.map(el => Number(el.getAttribute('data-outer-r'))));
        if (!Number.isFinite(innerR) || !Number.isFinite(outerR)) return;

        const doc = this.svg.ownerDocument;
        const outline = doc.createElementNS(SVG_NS, 'g');
        outline.classList.add('rt-membership-ring-outline');
        const color = this.ringColor(ring);
        if (color) outline.style.setProperty('--rt-membership-color', color);
        for (const cls of ['rt-membership-ring-halo', 'rt-membership-ring-line']) {
            const path = doc.createElementNS(SVG_NS, 'path');
            path.classList.add(cls);
            path.setAttribute('d', ringOutlinePath(innerR, outerR));
            outline.appendChild(path);
        }
        const squares = this.svg.querySelector('.rt-number-squares');
        if (squares) squares.before(outline);
        else this.svg.appendChild(outline);
        this.outline = outline;
        this.outlinedRing = ring;
    }

    private removeRingOutline(): void {
        this.outline?.remove();
        this.outline = null;
        this.outlinedRing = null;
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

    private updatePreview(change: MembershipDrop | null, after: string[] | null): void {
        const body = this.svg.ownerDocument?.body;
        if (!change || !body) {
            this.hidePreview();
            return;
        }
        const action = after ? describeSubplotMembershipChange(change) : t('ui.subplotRingDragController.alreadyIn', { subplot: change.to });
        const detail = after
            ? (this.shiftHeld
                ? t('ui.subplotRingDragController.detailReleaseToMove', { subplots: formatMemberships(after) })
                : t('ui.subplotRingDragController.detailHoldToAdd', { subplots: formatMemberships(after) }))
            : t('ui.subplotRingDragController.noChange');
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
        const target = this.target;
        const change = target ? this.changeFor(target.ring, shift) : null;
        const current = change ? this.readCurrent() : null;
        const after = change && current ? planSubplotMembership(current.before, change) : null;
        if (!target || !change || !current || !after) {
            this.reset();
            return;
        }
        const { file, before } = current;
        const itemLabel = describeSceneFile(file.basename);
        // The dialog wears the destination's colour: that is where the scene is going.
        const accent = this.ringColor(target.ring);
        this.hidePreview();

        this.confirming = true;
        const modal = new DragConfirmModal(
            this.view.plugin.app,
            {
                actionSummary: `${itemLabel}: ${describeSubplotMembershipChange(change)}`,
                renameCount: 0,
                showRenameImpact: false,
                contextLabel: t('ui.subplotRingDragController.contextLabel'),
                contextChange: `${formatMemberships(before)} → ${formatMemberships(after)}`,
                badge: change.kind === 'add' ? t('ui.subplotRingDragController.badgeAdd') : t('ui.subplotRingDragController.badgeMove'),
                title: t('ui.subplotRingDragController.confirmTitle'),
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
            await modal.finishWithDismiss(t('ui.subplotRingDragController.changeFailed'), true);
        } finally {
            this.confirming = false;
            this.reset();
        }
    }

    private reset(): void {
        if (this.holdTimer !== null) window.clearTimeout(this.holdTimer);
        this.holdTimer = null;
        this.hidePreview();
        this.removeRingOutline();
        this.svg.classList.remove('rt-dragging-subplot');
        if (this.sourceGroup) {
            this.sourceGroup.classList.remove('rt-drag-source');
            this.sourceGroup.style.removeProperty('--rt-membership-color');
        }
        this.sourceGroup = null;
        this.sourcePath = null;
        this.sourceRing = -1;
        this.sourceSubplot = null;
        this.target = null;
        this.ringColors.clear();
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
