/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 *
 * Shared drag geometry and overlay chrome.
 *
 * Narrative drag (reorder + rename) and Chronologue drag (re-date) commit
 * completely different things, but they draw the same affordances on the same
 * ring. This module is the single source of truth for that chrome so the two
 * controllers cannot drift apart visually.
 */

import { readSubplotColor } from '../../renderer/utils/subplotColors';
import { TFile, type App } from 'obsidian';
import { normalizeAngleSigned } from '../../renderer/utils/angles';
import {
    DRAG_DROP_ARC_RADIUS,
    DRAG_DROP_TICK_OUTER_RADIUS,
    DRAG_DROP_TICK_LENGTH
} from '../../renderer/layout/LayoutConstants';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Lucide move-horizontal, centered on origin so rotate() works naturally. */
const INDICATOR_ICON = [
    'M 6 -4 L 10 0 L 6 4',
    'M -10 0 L 10 0',
    'M -6 -4 L -10 0 L -6 4'
].join(' ');
const INDICATOR_OFFSET = 22;

export function cssEscape(value: string): string {
    if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
        return CSS.escape(value);
    }
    return value.replace(/[^a-zA-Z0-9_-]/g, '\\$&');
}

/**
 * Rotation offset in radians.
 *
 * When the timeline is rotated, `#timeline-rotatable` turns by -360/numActs
 * degrees. Overlay elements live outside that group, so their angles must add
 * this offset to line up with the scene arcs the author sees.
 */
export function getRotationOffsetRad(svg: SVGSVGElement): number {
    if (svg.getAttribute('data-rotated') !== 'true') return 0;
    const numActs = parseInt(
        svg.getAttribute('data-segment-count') || svg.getAttribute('data-num-acts') || '3', // SAFE: three acts is the documented minimum and the settings default
        10
    );
    const angleDeg = numActs > 0 ? 360 / numActs : 120;
    return -(angleDeg * Math.PI) / 180;
}

/** Highest ring index present — the only ring either drag mode operates on. */
export function getOuterRingIndex(svg: SVGSVGElement): number {
    const rings = Array.from(svg.querySelectorAll<SVGGElement>('.rt-scene-group'))
        .map(group => Number(group.getAttribute('data-ring') ?? -1)) // SAFE: -1 is filtered out on the next line
        .filter(ring => ring >= 0);
    return rings.length > 0 ? Math.max(...rings) : 0;
}

export function resolvePublishStageColorFromGroup(app: App, group: SVGGElement): string {
    const readCssVariable = (name: string): string | undefined => {
        const value = getComputedStyle(group.ownerDocument.documentElement).getPropertyValue(name).trim();
        return value || undefined; // SAFE: an unset CSS variable reads as empty; undefined drives the next lookup
    };

    const normalizeStage = (raw: unknown): 'Zero' | 'Author' | 'House' | 'Press' => {
        const value = Array.isArray(raw) ? raw[0] : raw;
        const stage = String(value ?? '').trim().toLowerCase(); // SAFE: absent stage normalizes to Zero below
        if (stage === 'author') return 'Author';
        if (stage === 'house') return 'House';
        if (stage === 'press') return 'Press';
        return 'Zero';
    };

    const encodedPath = group.getAttribute('data-path');
    const filePath = encodedPath ? decodeURIComponent(encodedPath) : '';
    let stage: 'Zero' | 'Author' | 'House' | 'Press' = 'Zero';
    if (filePath) {
        const file = app.vault.getAbstractFileByPath(filePath);
        if (file instanceof TFile) {
            const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter;
            if (frontmatter) {
                stage = normalizeStage(
                    frontmatter['Publish Stage'] ?? frontmatter['publish stage'] ?? frontmatter['publishStage']
                );
            }
        }
    }

    return readCssVariable(`--rt-publishStageColors-${stage}`)
        || readCssVariable('--rt-publishStageColors-Zero')
        || '#9370DB'; // SAFE: brand Zero-draft violet, used only if the theme defines no stage variables at all
}

/** The subplot colour a scene group is painted with, or its literal fill when the group carries no slot. */
export function resolveSubplotColorFromGroup(group: Element): string | undefined {
    const subplotIdxAttr = group.getAttribute('data-subplot-color-index')
        || group.getAttribute('data-subplot-index');
    if (subplotIdxAttr) {
        const idx = Number(subplotIdxAttr);
        if (Number.isFinite(idx)) return readSubplotColor(group.ownerDocument, idx);
    }

    const scenePath = group.querySelector<SVGPathElement>('.rt-scene-path');
    const fillAttr = scenePath?.getAttribute('fill')?.trim();
    if (fillAttr && !fillAttr.startsWith('url(')) return fillAttr;
    return undefined;
}

/**
 * Drop tick, drop arc and hover indicator for one SVG.
 *
 * Elements are created lazily in `#rt-overlays` and re-adopted if a re-render
 * replaced them, so a controller instance survives a timeline refresh.
 */
export class DragOverlays {
    private tick: SVGPathElement | null = null;
    private arc: SVGPathElement | null = null;
    private indicator: SVGGElement | null = null;

    constructor(private readonly svg: SVGSVGElement) {}

    createIndicator(): void {
        if (this.indicator?.isConnected) return;
        const doc = this.svg.ownerDocument;
        const group = doc.createElementNS(SVG_NS, 'g');
        group.classList.add('rt-drag-reorder-indicator');
        const path = doc.createElementNS(SVG_NS, 'path');
        path.setAttribute('d', INDICATOR_ICON);
        group.appendChild(path);
        this.mount(group);
        this.indicator = group;
    }

    showIndicator(group: SVGGElement, color: string | undefined): void {
        if (!this.indicator) return;
        const startAngle = Number(group.getAttribute('data-start-angle') ?? '');
        const endAngle = Number(group.getAttribute('data-end-angle') ?? '');
        const outerR = Number(group.getAttribute('data-outer-r') ?? '');
        if (!Number.isFinite(startAngle) || !Number.isFinite(endAngle) || !Number.isFinite(outerR)) return;

        const centerAngle = (startAngle + endAngle) / 2 + getRotationOffsetRad(this.svg);
        const r = outerR + INDICATOR_OFFSET;
        const x = r * Math.cos(centerAngle);
        const y = r * Math.sin(centerAngle);
        const rotDeg = (centerAngle * 180) / Math.PI + 90;

        this.indicator.setAttribute('transform', `translate(${x}, ${y}) rotate(${rotDeg})`);
        if (color) {
            this.indicator.style.setProperty('--rt-drag-indicator-color', color);
        } else {
            this.indicator.style.removeProperty('--rt-drag-indicator-color');
        }
        this.indicator.classList.add('rt-visible');
    }

    hideIndicator(): void {
        if (!this.indicator) return;
        this.indicator.classList.remove('rt-visible');
        this.indicator.style.removeProperty('--rt-drag-indicator-color');
    }

    showTick(startAngle: number, color: string | undefined): void {
        const angle = startAngle + getRotationOffsetRad(this.svg);
        const rOuter = DRAG_DROP_TICK_OUTER_RADIUS;
        const rInner = rOuter - DRAG_DROP_TICK_LENGTH;
        const tick = this.ensureTick();
        tick.classList.remove('ert-hidden');
        tick.setAttribute(
            'd',
            `M ${rInner * Math.cos(angle)} ${rInner * Math.sin(angle)} `
            + `L ${rOuter * Math.cos(angle)} ${rOuter * Math.sin(angle)}`
        );
        applyStroke(tick, color);
    }

    showArc(startAngle: number, endAngle: number, color: string | undefined): void {
        const arc = this.ensureArc();
        arc.classList.remove('ert-hidden');
        const r = DRAG_DROP_ARC_RADIUS;
        const offset = getRotationOffsetRad(this.svg);
        const a0 = startAngle + offset;
        const a1 = endAngle + offset;
        const delta = normalizeAngleSigned(a1 - a0);
        const largeArc = Math.abs(delta) > Math.PI ? 1 : 0;
        const sweep = delta >= 0 ? 1 : 0;
        arc.setAttribute(
            'd',
            `M ${r * Math.cos(a0)} ${r * Math.sin(a0)} `
            + `A ${r} ${r} 0 ${largeArc} ${sweep} ${r * Math.cos(a1)} ${r * Math.sin(a1)}`
        );
        applyStroke(arc, color);
    }

    /** Hide tick and arc. The indicator is hover chrome and is left alone. */
    clear(): void {
        [this.tick, this.arc].forEach(element => {
            if (!element) return;
            element.setAttribute('d', '');
            element.removeAttribute('stroke');
            element.style.removeProperty('--rt-drag-stroke-color');
            element.classList.add('ert-hidden');
        });
    }

    private ensureTick(): SVGPathElement {
        this.tick = this.ensureOverlayPath(this.tick, 'rt-drop-target-tick');
        return this.tick;
    }

    private ensureArc(): SVGPathElement {
        this.arc = this.ensureOverlayPath(this.arc, 'rt-drop-target-arc');
        return this.arc;
    }

    private ensureOverlayPath(current: SVGPathElement | null, className: string): SVGPathElement {
        if (current?.isConnected) return current;

        const existing = this.svg.querySelector<SVGPathElement>(`.${className}`);
        if (existing) {
            existing.classList.add('ert-hidden');
            existing.setAttribute('d', '');
            existing.removeAttribute('stroke');
            return existing;
        }

        const path = this.svg.ownerDocument.createElementNS(SVG_NS, 'path');
        path.classList.add(className, 'ert-hidden');
        path.setAttribute('d', '');
        this.mount(path);
        return path;
    }

    private mount(element: SVGElement): void {
        const overlays = this.svg.querySelector<SVGGElement>('#rt-overlays');
        if (overlays) overlays.appendChild(element);
        else this.svg.appendChild(element);
    }
}

function applyStroke(element: SVGPathElement, color: string | undefined): void {
    if (color) {
        element.style.setProperty('--rt-drag-stroke-color', color);
        element.setAttribute('stroke', color);
    } else {
        element.style.removeProperty('--rt-drag-stroke-color');
        element.removeAttribute('stroke');
    }
}
