import type { InquiryCanonicalQuestionTier } from '../../types/settings';
import { addTooltipData } from '../../utils/tooltip';
import { polarToCartesian } from '../utils/inquiryGeometry';
import type { InquiryZone } from '../state';
import { ZONE_LAYOUT } from '../zoneLayout';

export interface InquiryGlyphProps {
    scopeLabel: string;
    flowValue: number;  // 0..1 normalized
    depthValue: number; // 0..1 normalized
    flowVisualValue?: number; // Optional display-only arc position for truthful zero-state stubs
    depthVisualValue?: number; // Optional display-only arc position for truthful zero-state stubs
    errorRing?: 'flow' | 'depth' | null;
    ringOverrideColor?: string;
}

export interface InquiryZonePromptItem {
    id: string;
    question: string;
    tier?: InquiryCanonicalQuestionTier;
}

export interface InquiryGlyphPromptState {
    promptsByZone: Record<InquiryZone, InquiryZonePromptItem[]>;
    selectedPromptIds: Record<InquiryZone, string>;
    processedPromptId?: string | null;
    processedStatus?: 'success' | 'error' | null;
    lockedPromptId?: string | null;
    focusedFormIds?: Set<string>;
    cachedPromptIds?: Set<string>;
    priorPromptIds?: Set<string>;
    stalePromptIds?: Set<string>;
    onPromptSelect?: (zone: InquiryZone, promptId: string, event: MouseEvent) => void;
    onPromptContextMenu?: (zone: InquiryZone, promptId: string, event: MouseEvent) => void;
    onPromptHover?: (zone: InquiryZone, promptId: string, promptText: string) => void;
    onPromptHoverEnd?: () => void;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
export const FLOW_RADIUS = 130;
export const DEPTH_RADIUS = 88;
export const FLOW_STROKE = 30;
export const DEPTH_STROKE = 46;
const FLOW_HIT_STROKE = 38;
const DEPTH_HIT_STROKE = 48;
const FLOW_BADGE_RADIUS_PX = FLOW_STROKE / 2;
const DEPTH_BADGE_RADIUS_PX = DEPTH_STROKE / 2;
const FLOW_BADGE_TEXT_SCALE = 1.1;
const DEPTH_BADGE_TEXT_SCALE = 1.1;
const FLOW_BADGE_TEXT_PX = Math.round(FLOW_BADGE_RADIUS_PX * FLOW_BADGE_TEXT_SCALE);
const DEPTH_BADGE_TEXT_PX = Math.round(DEPTH_BADGE_RADIUS_PX * DEPTH_BADGE_TEXT_SCALE);
const LABEL_TEXT_RADIUS_SCALE = 1.2;
const ARC_BASE_TINT = '#dff5e7';
const ARC_MAX_GREEN = '#00FF00';
const DOT_DARKEN = 0.35;
const ZONE_SEGMENT_COUNT = 3;
export const ZONE_SEGMENT_RADIUS = 273.5;
export const ZONE_RING_THICKNESS = 70;
const ZONE_RING_GAP_PX = 10;
const ZONE_DOT_RADIUS_PX = 14;
const ZONE_DOT_TEXT_PX = 16;
const ZONE_DOT_RETICLE_OFFSET = ZONE_DOT_RADIUS_PX + 3;
const ZONE_DOT_RETICLE_LEN = 4;
const ZONE_NUMBER_COUNT = 9;
const ZONE_NUMBER_SPACING_DEG = 10;
const ZONE_SEGMENT_VIEWBOX_WIDTH = 159;
const ZONE_SEGMENT_VIEWBOX_HEIGHT = 257;
const ZONE_SEGMENT_SCALE = 1.3;
export const ZONE_SEGMENT_HALF_HEIGHT = (ZONE_SEGMENT_VIEWBOX_HEIGHT * ZONE_SEGMENT_SCALE) / 2;
const ZONE_SEGMENT_STROKE_WIDTH = 2;
const ZONE_SEGMENT_PATH = 'M154.984 7.67055C154.316 3.30311 150.229 0.286294 145.895 1.14796C120.714 6.15504 96.8629 16.4983 75.9632 31.5162C52.8952 48.0921 34.0777 69.8922 21.0492 95.1341C8.02081 120.376 1.15135 148.343 1.00251 176.748C0.867659 202.484 6.25287 227.917 16.7583 251.344C18.5662 255.375 23.3927 256.959 27.3399 254.974L42.9203 247.138C57.7222 239.693 63.2828 221.65 59.5838 205.5C57.4532 196.197 56.3914 186.649 56.4417 177.039C56.5447 157.382 61.2984 138.029 70.3141 120.562C79.3298 103.094 92.3515 88.0087 108.315 76.5382C116.118 70.9305 124.517 66.2647 133.334 62.6127C148.641 56.2724 160.128 41.2878 157.622 24.9099L154.984 7.67055Z';
const ZONE_SEGMENT_FILL = '#7b6448';
const ZONE_SEGMENT_STROKE = '#d6c3ad';
const ZONE_BASE_ANGLE = Math.PI;
const ZONE_SEGMENT_AXIS_ROTATION_DEG = 90;
const ZONE_CONTROL_SCALE = 1.05;
const DEBUG_INQUIRY_ZONES = false;

export class InquiryGlyph {
    private props: InquiryGlyphProps;

    readonly root: SVGGElement;
    readonly flowRingHit: SVGCircleElement;
    readonly depthRingHit: SVGCircleElement;
    readonly labelHit: SVGRectElement;

    private flowProgressGroup: SVGGElement;
    private depthProgressGroup: SVGGElement;
    private flowArc: SVGPathElement;
    private depthArc: SVGPathElement;
    private flowBadgeCircle: SVGCircleElement;
    private flowBadgeText: SVGTextElement;
    private depthBadgeCircle: SVGCircleElement;
    private depthBadgeText: SVGTextElement;
    private flowBadgeIcon?: SVGUseElement;
    private depthBadgeIcon?: SVGUseElement;
    private labelText: SVGTextElement;
    private flowGroup: SVGGElement;
    private depthGroup: SVGGElement;
    private badgeScaleFactor = 1;
    private zoneDots: Array<{ circle: SVGCircleElement; text: SVGTextElement; hit: SVGCircleElement }> = [];
    private zoneControlGroups = new Map<InquiryZone, SVGGElement>();
    private zoneControlStates = new Map<InquiryZone, { hovered: boolean; locked: boolean }>();
    private zoneInteractionsEnabled = true;
    private promptState?: InquiryGlyphPromptState;
    private zoneNumberMarkers = new Map<InquiryZone, Array<{
        group: SVGGElement;
        circle: SVGCircleElement;
        text: SVGTextElement;
        zone: InquiryZone;
        index: number;
        promptId?: string;
        promptText?: string;
    }>>();

    constructor(container: SVGElement, props: InquiryGlyphProps) {
        this.props = props;
        const doc = container.ownerDocument;
        this.root = doc.createElementNS(SVG_NS, 'g');
        this.root.classList.add('ert-inquiry-glyph');
        container.appendChild(this.root);

        this.root.appendChild(this.buildZoneRing());
        this.flowGroup = this.buildRingGroup('flow', FLOW_RADIUS, FLOW_STROKE, FLOW_HIT_STROKE, FLOW_BADGE_RADIUS_PX);
        this.depthGroup = this.buildRingGroup('depth', DEPTH_RADIUS, DEPTH_STROKE, DEPTH_HIT_STROKE, DEPTH_BADGE_RADIUS_PX);

        this.flowProgressGroup = this.flowGroup.querySelector('.ert-inquiry-ring-progress') as SVGGElement;
        this.depthProgressGroup = this.depthGroup.querySelector('.ert-inquiry-ring-progress') as SVGGElement;
        this.flowArc = this.flowGroup.querySelector('.ert-inquiry-ring-arc') as SVGPathElement;
        this.depthArc = this.depthGroup.querySelector('.ert-inquiry-ring-arc') as SVGPathElement;
        this.flowRingHit = this.flowGroup.querySelector('.ert-inquiry-ring-hit') as SVGCircleElement;
        this.depthRingHit = this.depthGroup.querySelector('.ert-inquiry-ring-hit') as SVGCircleElement;
        this.flowBadgeCircle = this.flowGroup.querySelector('.ert-inquiry-ring-badge-circle') as SVGCircleElement;
        this.flowBadgeText = this.flowGroup.querySelector('.ert-inquiry-ring-badge-text') as SVGTextElement;
        this.depthBadgeCircle = this.depthGroup.querySelector('.ert-inquiry-ring-badge-circle') as SVGCircleElement;
        this.depthBadgeText = this.depthGroup.querySelector('.ert-inquiry-ring-badge-text') as SVGTextElement;
        this.flowBadgeIcon = this.flowGroup.querySelector('.ert-inquiry-ring-badge-icon') as SVGUseElement;
        this.depthBadgeIcon = this.depthGroup.querySelector('.ert-inquiry-ring-badge-icon') as SVGUseElement;

        const labelGroup = doc.createElementNS(SVG_NS, 'g');
        labelGroup.classList.add('ert-inquiry-glyph-label-group');
        this.labelHit = doc.createElementNS(SVG_NS, 'rect');
        this.labelHit.classList.add('ert-inquiry-glyph-hit');
        const labelInnerRadius = Math.max(0, DEPTH_RADIUS - (DEPTH_STROKE / 2) - 3);
        const labelWidth = labelInnerRadius * 2;
        const labelHeight = labelWidth * (220 / 360);
        const labelRadius = labelWidth / 6;
        this.labelHit.setAttribute('x', (-labelWidth / 2).toFixed(2));
        this.labelHit.setAttribute('y', (-labelHeight / 2).toFixed(2));
        this.labelHit.setAttribute('width', labelWidth.toFixed(2));
        this.labelHit.setAttribute('height', labelHeight.toFixed(2));
        this.labelHit.setAttribute('rx', labelRadius.toFixed(2));
        this.labelHit.setAttribute('ry', labelRadius.toFixed(2));

        this.labelText = doc.createElementNS(SVG_NS, 'text');
        this.labelText.classList.add('ert-inquiry-glyph-label');
        this.labelText.setAttribute('x', '0');
        this.labelText.setAttribute('y', '0');
        this.labelText.setAttribute('text-anchor', 'middle');
        this.labelText.setAttribute('dominant-baseline', 'middle');
        this.labelText.setAttribute('dy', '0.12em');
        this.labelText.setAttribute('aria-hidden', 'true');

        labelGroup.appendChild(this.labelHit);
        labelGroup.appendChild(this.labelText);

        this.root.appendChild(this.flowGroup);
        this.root.appendChild(this.depthGroup);
        this.root.appendChild(labelGroup);

        this.applyProps(props);
        this.setDisplayScale(1, 1);
    }

    update(next: Partial<InquiryGlyphProps>): void {
        this.props = { ...this.props, ...next };
        this.applyProps(this.props);
    }

    updatePromptState(state: InquiryGlyphPromptState): void {
        this.promptState = state;
        this.syncZoneNumberMarkers();
    }

    setPromptPulse(promptId: string, active: boolean): void {
        this.zoneNumberMarkers.forEach(markers => {
            markers.forEach(marker => {
                if (marker.promptId !== promptId) return;
                marker.group.classList.toggle('is-duplicate-pulse', active);
            });
        });
    }

    setZoneInteractionsEnabled(enabled: boolean): void {
        if (this.zoneInteractionsEnabled === enabled) return;
        this.zoneInteractionsEnabled = enabled;
        if (enabled) return;
        this.zoneControlGroups.forEach((group, zone) => {
            const state = this.ensureZoneControlState(zone);
            if (!state.hovered && !state.locked) return;
            state.hovered = false;
            state.locked = false;
            this.updateZoneControlScale(state, group);
        });
    }

    setZoneScaleLocked(zone: InquiryZone, locked: boolean): void {
        const group = this.zoneControlGroups.get(zone);
        if (!group) return;
        const state = this.ensureZoneControlState(zone);
        if (state.locked === locked) return;
        state.locked = locked;
        this.updateZoneControlScale(state, group);
    }

    setDisplayScale(scale: number, unitsPerPx: number): void {
        const safeScale = Number.isFinite(scale) && scale > 0 ? scale : 1;
        const safeUnits = Number.isFinite(unitsPerPx) && unitsPerPx > 0 ? unitsPerPx : 1;
        const scaleFactor = safeUnits / safeScale;
        this.badgeScaleFactor = scaleFactor;
        this.updateLabelFontSize();
        this.flowBadgeText.setAttribute('font-size', (FLOW_BADGE_TEXT_PX * scaleFactor).toFixed(2));
        this.depthBadgeText.setAttribute('font-size', (DEPTH_BADGE_TEXT_PX * scaleFactor).toFixed(2));
        this.flowBadgeCircle.setAttribute('r', ((FLOW_STROKE / 2) * scaleFactor).toFixed(2));
        this.depthBadgeCircle.setAttribute('r', ((DEPTH_STROKE / 2) * scaleFactor).toFixed(2));
        this.zoneDots.forEach(dot => {
            dot.circle.setAttribute('r', String(ZONE_DOT_RADIUS_PX));
            dot.text.setAttribute('font-size', String(ZONE_DOT_TEXT_PX));
            dot.hit.setAttribute('r', String(ZONE_DOT_RADIUS_PX));
        });
    }

    private applyProps(props: InquiryGlyphProps): void {
        this.labelText.textContent = props.scopeLabel;
        this.updateLabelFontSize();

        const errorRing = props.errorRing ?? null;
        this.applyRingState(
            this.flowProgressGroup,
            this.flowArc,
            this.flowBadgeCircle,
            this.flowBadgeText,
            this.flowBadgeIcon,
            props.flowValue,
            props.flowVisualValue ?? props.flowValue,
            FLOW_RADIUS,
            FLOW_STROKE,
            'flow',
            errorRing,
            props.ringOverrideColor
        );
        this.applyRingState(
            this.depthProgressGroup,
            this.depthArc,
            this.depthBadgeCircle,
            this.depthBadgeText,
            this.depthBadgeIcon,
            props.depthValue,
            props.depthVisualValue ?? props.depthValue,
            DEPTH_RADIUS,
            DEPTH_STROKE,
            'depth',
            errorRing,
            props.ringOverrideColor
        );
    }

    private buildRingGroup(
        kind: 'flow' | 'depth',
        radius: number,
        strokeWidth: number,
        hitStrokeWidth: number,
        badgeRadius: number
    ): SVGGElement {
        const doc = this.root.ownerDocument;
        const group = doc.createElementNS(SVG_NS, 'g');
        group.classList.add('ert-inquiry-ring', `ert-inquiry-ring--${kind}`);

        const track = this.buildCircle(radius, strokeWidth, 'ert-inquiry-ring-track');
        const progress = doc.createElementNS(SVG_NS, 'g');
        progress.classList.add('ert-inquiry-ring-progress');
        const arc = doc.createElementNS(SVG_NS, 'path');
        arc.classList.add('ert-inquiry-ring-arc');
        progress.appendChild(arc);
        const hit = this.buildCircle(radius, hitStrokeWidth, 'ert-inquiry-ring-hit');
        const badgeGroup = this.buildBadgeGroup(badgeRadius);

        group.appendChild(track);
        group.appendChild(progress);
        group.appendChild(hit);
        group.appendChild(badgeGroup);

        return group;
    }

    private buildZoneRing(): SVGGElement {
        const doc = this.root.ownerDocument;
        const group = doc.createElementNS(SVG_NS, 'g');
        group.classList.add('inq-zones', 'ert-inquiry-zones');

        const midR = ZONE_SEGMENT_RADIUS;
        const innerR = midR - (ZONE_RING_THICKNESS / 2);
        const outerR = midR + (ZONE_RING_THICKNESS / 2);
        const gapAngle = ZONE_RING_GAP_PX / midR;
        const zoneStep = (2 * Math.PI) / ZONE_SEGMENT_COUNT;
        const zoneSpacing = zoneStep + gapAngle;
        const zoneArcRange = zoneStep - gapAngle;
        const zoneTemplate = this.buildZoneSegmentTemplate();

        const zones: Array<{ id: InquiryZone; label: string; index: number }> = [
            { id: 'setup', label: '1', index: 1 },
            { id: 'pressure', label: '2', index: -1 },
            { id: 'payoff', label: '3', index: 0 }
        ];

        zones.forEach(zone => {
            const centerAngle = ZONE_BASE_ANGLE + (zone.index * zoneSpacing);
            const layout = ZONE_LAYOUT[zone.id];
            const fallbackX = midR * Math.sin(centerAngle);
            const fallbackY = -midR * Math.cos(centerAngle);
            const zoneX = layout?.x ?? fallbackX;
            const zoneY = layout?.y ?? fallbackY;
            const axisRotationDeg = layout?.axisRotationDeg ?? ZONE_SEGMENT_AXIS_ROTATION_DEG;
            const zoneRadius = Math.hypot(zoneX, zoneY);
            const zoneAngle = Math.atan2(zoneY, zoneX);
            const zoneGroup = doc.createElementNS(SVG_NS, 'g');
            zoneGroup.classList.add(
                'inq-zone-segment-wrap',
                `inq-zone-segment-wrap--${zone.id}`,
                'inq-zone-control',
                `inq-zone-control--${zone.id}`
            );
            zoneGroup.setAttribute('transform', 'scale(1)');
            this.zoneControlGroups.set(zone.id, zoneGroup);

            const translateGroup = doc.createElementNS(SVG_NS, 'g');
            translateGroup.setAttribute('transform', `translate(${zoneX.toFixed(2)} ${zoneY.toFixed(2)})`);
            const axisGroup = doc.createElementNS(SVG_NS, 'g');
            axisGroup.setAttribute('transform', `rotate(${axisRotationDeg})`);
            const zoneNode = zoneTemplate.cloneNode(true) as SVGGElement;
            const zonePath = zoneNode.querySelector<SVGPathElement>('.inq-zone-segment-path');
            axisGroup.appendChild(zoneNode);
            translateGroup.appendChild(axisGroup);
            zoneGroup.appendChild(translateGroup);
            this.bindZoneControlInteractions(zoneGroup, zone.id, zonePath ?? undefined);
            group.appendChild(zoneGroup);

            const numberRadius = layout?.numberRadius ?? zoneRadius;
            const numberStartAngle = layout?.numberStartAngleDeg ?? ((zoneAngle + (zoneArcRange / 2)) * (180 / Math.PI));
            const numberDirection = layout?.numberDirection ?? 'ccw';
            const dotSpacingRad = (ZONE_NUMBER_SPACING_DEG * Math.PI) / 180;
            const startAngleRad = (numberStartAngle * Math.PI) / 180;
            const step = numberDirection === 'ccw' ? -dotSpacingRad : dotSpacingRad;
            const markers: Array<{
                group: SVGGElement;
                circle: SVGCircleElement;
                text: SVGTextElement;
                zone: InquiryZone;
                index: number;
                promptId?: string;
                promptText?: string;
            }> = [];
            for (let i = 0; i < ZONE_NUMBER_COUNT; i += 1) {
                const dotAngle = startAngleRad + (step * i);
                const dotX = numberRadius * Math.cos(dotAngle);
                const dotY = numberRadius * Math.sin(dotAngle);
                const dotGroup = doc.createElementNS(SVG_NS, 'g');
                dotGroup.classList.add('inq-zone-dot', `inq-zone-dot--${zone.id}`);
                dotGroup.setAttribute('transform', `translate(${dotX.toFixed(2)} ${dotY.toFixed(2)})`);
                dotGroup.setAttribute('role', 'note');

                const dotHit = doc.createElementNS(SVG_NS, 'circle');
                dotHit.classList.add('inq-zone-dot-hit');
                dotHit.setAttribute('r', String(ZONE_DOT_RADIUS_PX));

                const dotCircle = doc.createElementNS(SVG_NS, 'circle');
                dotCircle.classList.add('inq-zone-dot-circle');
                dotCircle.setAttribute('r', String(ZONE_DOT_RADIUS_PX));

                const dotText = doc.createElementNS(SVG_NS, 'text');
                dotText.classList.add('inq-zone-dot-text');
                dotText.setAttribute('text-anchor', 'middle');
                dotText.setAttribute('dominant-baseline', 'central');
                dotText.setAttribute('alignment-baseline', 'central');
                dotText.setAttribute('font-size', String(ZONE_DOT_TEXT_PX));
                dotText.textContent = String(i + 1);

                // Reticle ticks — 4 short lines just outside the circle
                const reticlePositions: Array<[number, number, number, number]> = [
                    [0, -ZONE_DOT_RETICLE_OFFSET, 0, -(ZONE_DOT_RETICLE_OFFSET + ZONE_DOT_RETICLE_LEN)], // top
                    [0, ZONE_DOT_RETICLE_OFFSET, 0, ZONE_DOT_RETICLE_OFFSET + ZONE_DOT_RETICLE_LEN],     // bottom
                    [-ZONE_DOT_RETICLE_OFFSET, 0, -(ZONE_DOT_RETICLE_OFFSET + ZONE_DOT_RETICLE_LEN), 0], // left
                    [ZONE_DOT_RETICLE_OFFSET, 0, ZONE_DOT_RETICLE_OFFSET + ZONE_DOT_RETICLE_LEN, 0]      // right
                ];
                for (const [x1, y1, x2, y2] of reticlePositions) {
                    const tick = doc.createElementNS(SVG_NS, 'line');
                    tick.classList.add('inq-zone-dot-reticle');
                    tick.setAttribute('x1', String(x1));
                    tick.setAttribute('y1', String(y1));
                    tick.setAttribute('x2', String(x2));
                    tick.setAttribute('y2', String(y2));
                    dotGroup.appendChild(tick);
                }

                dotGroup.appendChild(dotHit);
                dotGroup.appendChild(dotCircle);
                dotGroup.appendChild(dotText);
                zoneGroup.appendChild(dotGroup);
                this.zoneDots.push({ circle: dotCircle, text: dotText, hit: dotHit });
                const marker: {
                    group: SVGGElement;
                    circle: SVGCircleElement;
                    text: SVGTextElement;
                    zone: InquiryZone;
                    index: number;
                    promptId?: string;
                    promptText?: string;
                } = { group: dotGroup, circle: dotCircle, text: dotText, zone: zone.id, index: i };
                // SAFE: InquiryGlyph is a plain class without Component lifecycle; owner view manages cleanup
                dotGroup.addEventListener('click', (event: MouseEvent) => {
                    if (!this.zoneInteractionsEnabled) return;
                    if (!marker.promptId) return;
                    this.promptState?.onPromptSelect?.(marker.zone, marker.promptId, event);
                });
                // SAFE: InquiryGlyph is a plain class without Component lifecycle
                dotGroup.addEventListener('contextmenu', (event: MouseEvent) => {
                    if (!this.zoneInteractionsEnabled) return;
                    if (!marker.promptId) return;
                    event.preventDefault();
                    this.promptState?.onPromptContextMenu?.(marker.zone, marker.promptId, event);
                });
                // SAFE: InquiryGlyph is a plain class without Component lifecycle
                dotGroup.addEventListener('pointerenter', () => {
                    if (!this.zoneInteractionsEnabled) return;
                    if (!marker.promptId || !marker.promptText) return;
                    this.promptState?.onPromptHover?.(marker.zone, marker.promptId, marker.promptText);
                });
                // SAFE: InquiryGlyph is a plain class without Component lifecycle
                dotGroup.addEventListener('pointerleave', () => {
                    if (!this.zoneInteractionsEnabled) return;
                    this.promptState?.onPromptHoverEnd?.();
                });
                markers.push(marker);
            }
            this.zoneNumberMarkers.set(zone.id, markers);
        });

        if (DEBUG_INQUIRY_ZONES) {
            const debugGroup = doc.createElementNS(SVG_NS, 'g');
            debugGroup.classList.add('inq-zone-debug');
            [innerR, midR, outerR].forEach(radius => {
                const circle = doc.createElementNS(SVG_NS, 'circle');
                circle.setAttribute('r', radius.toFixed(2));
                circle.setAttribute('fill', 'none');
                circle.setAttribute('stroke', '#ffb400');
                circle.setAttribute('stroke-width', '1');
                circle.setAttribute('stroke-dasharray', '5 4');
                debugGroup.appendChild(circle);
            });
            group.appendChild(debugGroup);
        }

        return group;
    }

    private ensureZoneControlState(zone: InquiryZone): { hovered: boolean; locked: boolean } {
        let state = this.zoneControlStates.get(zone);
        if (!state) {
            state = { hovered: false, locked: false };
            this.zoneControlStates.set(zone, state);
        }
        return state;
    }

    private updateZoneControlScale(
        state: { hovered: boolean; locked: boolean },
        group: SVGGElement
    ): void {
        const shouldScale = state.hovered;
        group.classList.toggle('is-scaled', shouldScale);
        group.classList.toggle('is-glass-hovered', state.hovered);
        group.classList.toggle('is-locked', state.locked);
        group.setAttribute('transform', `scale(${shouldScale ? String(ZONE_CONTROL_SCALE) : '1'})`);
    }

    private bindZoneControlInteractions(
        group: SVGGElement,
        zone: InquiryZone,
        hoverTarget?: SVGElement
    ): void {
        const state = this.ensureZoneControlState(zone);
        const entryTarget = hoverTarget ?? group;
        // SAFE: InquiryGlyph is a plain class without Component lifecycle; owner view manages cleanup
        entryTarget.addEventListener('pointerenter', () => {
            if (!this.zoneInteractionsEnabled) return;
            state.hovered = true;
            this.updateZoneControlScale(state, group);
        });
        // SAFE: InquiryGlyph is a plain class without Component lifecycle
        group.addEventListener('pointerout', event => {
            if (!this.zoneInteractionsEnabled) return;
            const related = event.relatedTarget;
            if (related instanceof Node && group.contains(related)) return;
            state.hovered = false;
            this.updateZoneControlScale(state, group);
        });
        // SAFE: InquiryGlyph is a plain class without Component lifecycle
        group.addEventListener('click', () => {
            if (!this.zoneInteractionsEnabled) return;
            if (state.locked) return;
            state.locked = true;
            this.updateZoneControlScale(state, group);
        });
    }

    private syncZoneNumberMarkers(): void {
        if (!this.promptState) return;
        const {
            promptsByZone,
            selectedPromptIds,
            processedPromptId,
            processedStatus,
            lockedPromptId
        } = this.promptState;
        this.zoneNumberMarkers.forEach((markers, zone) => {
            const prompts = promptsByZone[zone] ?? [];
            const selectedId = selectedPromptIds[zone];
            markers.forEach((marker, idx) => {
                const prompt = prompts[idx];
                marker.promptId = prompt?.id;
                marker.promptText = prompt?.question;
                const isProcessed = !!prompt && processedPromptId === prompt.id;
                const isError = isProcessed && processedStatus === 'error';
                const isLocked = !!prompt && lockedPromptId === prompt.id;
                const cachedPromptIds = this.promptState?.cachedPromptIds;
                const priorPromptIds = this.promptState?.priorPromptIds;
                const stalePromptIds = this.promptState?.stalePromptIds;
                const isCached = !!prompt && !isProcessed && !!cachedPromptIds && cachedPromptIds.has(prompt.id);
                const isPrior = !!prompt && !isProcessed && !isCached && !!priorPromptIds && priorPromptIds.has(prompt.id);
                const isStale = !!prompt && !isProcessed && !isCached && !isPrior && !!stalePromptIds && stalePromptIds.has(prompt.id);
                marker.text.textContent = prompt ? (isError ? 'X' : String(idx + 1)) : '';
                marker.group.setAttribute('display', prompt ? 'inline' : 'none');
                marker.group.classList.toggle('is-signature', prompt?.tier === 'signature');
                marker.group.classList.toggle('is-active', !!prompt && selectedId === prompt.id);
                marker.group.classList.toggle('is-processed', isProcessed);
                marker.group.classList.toggle('is-processed-success', isProcessed && processedStatus === 'success');
                marker.group.classList.toggle('is-processed-error', isError);
                marker.group.classList.toggle('is-locked', isLocked);
                marker.group.classList.toggle('is-cached', isCached || isPrior);
                marker.group.classList.toggle('is-stale', isStale);
                const focusedFormIds = this.promptState?.focusedFormIds;
                const isFocusedForm = !!prompt && !!focusedFormIds && focusedFormIds.has(prompt.id);
                marker.group.classList.toggle('is-focused-form', isFocusedForm);
                if (prompt) {
                    marker.group.setAttribute('role', 'button');
                    marker.group.setAttribute('tabindex', '0');
                    // Styled rt-tooltip via data-rt-tip (delegated handler on
                    // the Inquiry root SVG). NEVER aria-label: this is an SVG
                    // <g>, and aria-label would trigger Obsidian's tooltip
                    // handler -> HTMLElement.isShown() (which SVG lacks) ->
                    // "e.isShown is not a function". NEVER <title> either: it
                    // renders the plain native OS tooltip.
                    let tip: string;
                    if (isProcessed && processedStatus === 'success') {
                        tip = 'Current result';
                    } else if (isCached) {
                        tip = 'Open previous result';
                    } else if (isPrior) {
                        tip = 'Prior result from another model; run selected model';
                    } else if (isStale) {
                        tip = 'Prior result — corpus changed, re-run to refresh';
                    } else {
                        tip = 'Run question';
                    }
                    addTooltipData(marker.group, tip, 'bottom');
                    marker.group.setAttribute('data-rt-tip-offset-y', '6');
                } else {
                    marker.group.removeAttribute('role');
                    marker.group.removeAttribute('tabindex');
                    marker.group.removeAttribute('data-rt-tip');
                    marker.group.removeAttribute('data-rt-tip-placement');
                    marker.group.removeAttribute('data-rt-tip-offset-y');
                }
            });
        });
    }

    private buildZoneSegmentTemplate(): SVGGElement {
        const doc = this.root.ownerDocument;
        const group = doc.createElementNS(SVG_NS, 'g');
        group.classList.add('inq-zone-segment-template');
        const offsetX = -(ZONE_SEGMENT_VIEWBOX_WIDTH * ZONE_SEGMENT_SCALE) / 2;
        const offsetY = -(ZONE_SEGMENT_VIEWBOX_HEIGHT * ZONE_SEGMENT_SCALE) / 2;
        group.setAttribute('transform', `translate(${offsetX} ${offsetY})`);

        const scaleGroup = doc.createElementNS(SVG_NS, 'g');
        scaleGroup.setAttribute('transform', `scale(${ZONE_SEGMENT_SCALE})`);

        const path = doc.createElementNS(SVG_NS, 'path');
        path.classList.add('inq-zone-segment-path');
        path.setAttribute('d', ZONE_SEGMENT_PATH);
        path.setAttribute('fill', ZONE_SEGMENT_FILL);
        path.setAttribute('stroke', ZONE_SEGMENT_STROKE);
        path.setAttribute('stroke-width', String(ZONE_SEGMENT_STROKE_WIDTH));
        path.setAttribute('pointer-events', 'auto');
        scaleGroup.appendChild(path);

        const glass = doc.createElementNS(SVG_NS, 'path');
        glass.classList.add('inq-zone-segment-glass');
        glass.setAttribute('d', ZONE_SEGMENT_PATH);
        glass.setAttribute('fill', 'url(#ert-inquiry-zone-glass)');
        glass.setAttribute('stroke', 'none');
        glass.setAttribute('pointer-events', 'none');
        scaleGroup.appendChild(glass);
        group.appendChild(scaleGroup);

        return group;
    }

    private buildBadgeGroup(badgeRadius: number): SVGGElement {
        const doc = this.root.ownerDocument;
        const group = doc.createElementNS(SVG_NS, 'g');
        group.classList.add('ert-inquiry-ring-badge');
        group.setAttribute('stroke', 'none');

        const circle = doc.createElementNS(SVG_NS, 'circle');
        circle.classList.add('ert-inquiry-ring-badge-circle');
        circle.setAttribute('r', String(badgeRadius));
        circle.setAttribute('stroke', 'none');
        circle.setAttribute('stroke-width', '0');

        const text = doc.createElementNS(SVG_NS, 'text');
        text.classList.add('ert-inquiry-ring-badge-text');
        text.setAttribute('text-anchor', 'middle');
        text.setAttribute('dominant-baseline', 'central');
        text.setAttribute('alignment-baseline', 'central');
        text.setAttribute('dy', '0');

        const icon = doc.createElementNS(SVG_NS, 'use');
        icon.classList.add('ert-inquiry-ring-badge-icon');
        icon.setAttribute('href', '#ert-icon-x');
        icon.setAttributeNS('http://www.w3.org/1999/xlink', 'href', '#ert-icon-x');

        group.appendChild(circle);
        group.appendChild(text);
        group.appendChild(icon);

        return group;
    }

    private buildCircle(radius: number, strokeWidth: number, cls: string): SVGCircleElement {
        const circle = this.root.ownerDocument.createElementNS(SVG_NS, 'circle');
        circle.classList.add(cls);
        circle.setAttribute('cx', '0');
        circle.setAttribute('cy', '0');
        circle.setAttribute('r', String(radius));
        circle.setAttribute('fill', 'none');
        circle.setAttribute('stroke-width', String(strokeWidth));
        return circle;
    }

    private applyRingState(
        progress: SVGGElement,
        arc: SVGPathElement,
        badgeCircle: SVGCircleElement,
        badgeText: SVGTextElement,
        badgeIcon: SVGUseElement | undefined,
        value: number,
        visualValue: number,
        radius: number,
        strokeWidth: number,
        kind: 'flow' | 'depth',
        errorRing: InquiryGlyphProps['errorRing'],
        overrideColor?: string
    ): void {
        const showError = errorRing === kind;
        const errorColor = showError ? '#ff4d4d' : undefined;
        const ringColor = overrideColor ?? errorColor;
        const resolvedRingColor = ringColor ?? InquiryGlyph.mixColors(
            ARC_BASE_TINT,
            ARC_MAX_GREEN,
            Math.min(Math.max(value, 0), 1)
        );
        this.updateRingArc(progress, arc, value, visualValue, radius, strokeWidth, ringColor);
        this.updateBadge(badgeCircle, badgeText, badgeIcon, value, visualValue, radius, strokeWidth, showError, ringColor);
        const ownerSvg = this.root.ownerSVGElement;
        if (ownerSvg) {
            ownerSvg.style.setProperty(
                kind === 'flow' ? '--ert-inquiry-flow-ring-color' : '--ert-inquiry-depth-ring-color',
                resolvedRingColor
            );
        }
    }

    private updateRingArc(
        progressGroup: SVGGElement,
        arc: SVGPathElement,
        normalized: number,
        visualNormalized: number,
        radius: number,
        strokeWidth: number,
        overrideColor?: string
    ): void {
        const safeValue = Math.min(Math.max(normalized, 0), 1);
        const safeVisualValue = Math.min(Math.max(visualNormalized, 0), 1);
        if (safeVisualValue <= 0) {
            arc.setAttribute('d', '');
            progressGroup.setAttribute('opacity', '0');
            return;
        }
        progressGroup.setAttribute('opacity', '1');
        const startDeg = -90;
        let sweepDeg = safeVisualValue * 360;
        if (sweepDeg > 359.999) sweepDeg = 359.999;
        const endDeg = startDeg + sweepDeg;
        const start = this.polarToCartesianSvg(radius, startDeg);
        const end = this.polarToCartesianSvg(radius, endDeg);
        const largeArc = sweepDeg > 180 ? 1 : 0;
        let d = `M ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArc} 1 ${end.x} ${end.y}`;
        if (safeValue >= 0.9999) {
            const mid = this.polarToCartesianSvg(radius, startDeg + 180);
            d = [
                `M ${start.x} ${start.y}`,
                `A ${radius} ${radius} 0 1 1 ${mid.x} ${mid.y}`,
                `A ${radius} ${radius} 0 1 1 ${start.x} ${start.y}`
            ].join(' ');
        }
        arc.setAttribute('d', d);
        arc.setAttribute('stroke-width', String(strokeWidth));
        arc.setAttribute('stroke-linecap', 'round');
        arc.setAttribute('fill', 'none');
        const arcColor = overrideColor ?? InquiryGlyph.mixColors(ARC_BASE_TINT, ARC_MAX_GREEN, safeValue);
        arc.setAttribute('stroke', arcColor);
    }

    private updateBadge(
        badgeCircle: SVGCircleElement,
        badgeText: SVGTextElement,
        badgeIcon: SVGUseElement | undefined,
        normalized: number,
        visualNormalized: number,
        radius: number,
        strokeWidth: number,
        showErrorIcon: boolean,
        overrideColor?: string
    ): void {
        const safeValue = Math.min(Math.max(normalized, 0), 1);
        const safeVisualValue = Math.min(Math.max(visualNormalized, 0), 1);
        const theta = (-90 + (360 * safeVisualValue)) * (Math.PI / 180);
        const x = radius * Math.cos(theta);
        const y = radius * Math.sin(theta);
        const badgeRadius = (strokeWidth / 2) * this.badgeScaleFactor;
        badgeCircle.setAttribute('cx', x.toFixed(2));
        badgeCircle.setAttribute('cy', y.toFixed(2));
        badgeCircle.setAttribute('r', badgeRadius.toFixed(2));
        badgeText.setAttribute('x', x.toFixed(2));
        badgeText.setAttribute('y', y.toFixed(2));
        badgeText.textContent = showErrorIcon ? '' : String(Math.round(safeValue * 100));
        badgeText.setAttribute('opacity', showErrorIcon ? '0' : '1');
        const arcColor = overrideColor ?? InquiryGlyph.mixColors(ARC_BASE_TINT, ARC_MAX_GREEN, safeValue);
        badgeText.style.setProperty('--ert-inquiry-badge-text-color', arcColor);
        badgeText.style.setProperty('fill', arcColor);
        const badgeColor = overrideColor ? overrideColor : InquiryGlyph.darkenColor(arcColor, DOT_DARKEN);
        badgeCircle.style.setProperty('--ert-inquiry-badge-color', badgeColor);
        const badgeStroke = 1 * this.badgeScaleFactor;
        badgeCircle.style.setProperty('stroke', badgeColor);
        badgeCircle.style.setProperty('stroke-width', badgeStroke.toFixed(2));
        if (badgeIcon) {
            const iconSize = (strokeWidth * 0.55) * this.badgeScaleFactor;
            badgeIcon.setAttribute('x', (x - (iconSize / 2)).toFixed(2));
            badgeIcon.setAttribute('y', (y - (iconSize / 2)).toFixed(2));
            badgeIcon.setAttribute('width', iconSize.toFixed(2));
            badgeIcon.setAttribute('height', iconSize.toFixed(2));
            badgeIcon.style.setProperty('color', arcColor);
            badgeIcon.setAttribute('opacity', showErrorIcon ? '1' : '0');
        }
    }

    private updateLabelFontSize(): void {
        const label = this.labelText.textContent?.trim() ?? '';
        const innerPadding = 8 * this.badgeScaleFactor;
        const innerRadius = Math.max(0, (DEPTH_RADIUS - (DEPTH_STROKE / 2)) - innerPadding);
        const baseSize = innerRadius * this.badgeScaleFactor;
        if (!label || innerRadius <= 0) {
            this.labelText.setAttribute('font-size', baseSize.toFixed(2));
            return;
        }

        let fontSize = baseSize;
        this.labelText.setAttribute('font-size', fontSize.toFixed(2));

        let radiusNeeded = 0;
        try {
            const bounds = this.labelText.getBBox();
            const halfWidth = bounds.width / 2;
            const halfHeight = bounds.height / 2;
            radiusNeeded = Math.hypot(halfWidth, halfHeight);
        } catch {
            // Fallback to estimated bounds when text metrics are unavailable.
        }

        if (!Number.isFinite(radiusNeeded) || radiusNeeded <= 0) {
            const length = Math.max(label.length, 1);
            const estWidth = length * fontSize * 0.62;
            const estHeight = fontSize;
            radiusNeeded = Math.hypot(estWidth / 2, estHeight / 2);
        }

        if (!Number.isFinite(radiusNeeded) || radiusNeeded <= 0) return;
        const targetRadius = innerRadius * LABEL_TEXT_RADIUS_SCALE;
        const fitScale = targetRadius / radiusNeeded;
        if (!Number.isFinite(fitScale) || fitScale <= 0) return;
        fontSize *= fitScale;
        this.labelText.setAttribute('font-size', fontSize.toFixed(2));
    }

    private static mixColors(start: string, end: string, t: number): string {
        const clamp = Math.min(Math.max(t, 0), 1);
        const parse = (hex: string) => {
            const clean = hex.replace('#', '');
            const num = parseInt(clean, 16);
            return {
                r: (num >> 16) & 0xff,
                g: (num >> 8) & 0xff,
                b: num & 0xff
            };
        };
        const a = parse(start);
        const b = parse(end);
        const r = Math.round(a.r + (b.r - a.r) * clamp);
        const g = Math.round(a.g + (b.g - a.g) * clamp);
        const bl = Math.round(a.b + (b.b - a.b) * clamp);
        return `#${((1 << 24) + (r << 16) + (g << 8) + bl).toString(16).slice(1)}`;
    }

    private static darkenColor(hex: string, amount: number): string {
        const clamp = Math.min(Math.max(amount, 0), 1);
        const clean = hex.replace('#', '');
        const num = parseInt(clean, 16);
        const r = (num >> 16) & 0xff;
        const g = (num >> 8) & 0xff;
        const b = num & 0xff;
        const factor = 1 - clamp;
        const dr = Math.round(r * factor);
        const dg = Math.round(g * factor);
        const db = Math.round(b * factor);
        return `#${((1 << 24) + (dr << 16) + (dg << 8) + db).toString(16).slice(1)}`;
    }

    // SVG path-serialization boundary: canonical numeric polar math +
    // fixed 2-decimal precision for compact, stable path `d` strings.
    private polarToCartesianSvg(radius: number, degrees: number): { x: string; y: string } {
        const point = polarToCartesian(radius, degrees);
        return {
            x: point.x.toFixed(2),
            y: point.y.toFixed(2)
        };
    }
}
