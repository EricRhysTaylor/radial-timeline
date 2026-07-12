import { formatNumber } from '../../utils/svg';

export interface SessionTimerRingState {
    radius: number;
    strokeWidth: number;
    progress: number;
    colorProgress: number;
    direction: 'clockwise' | 'counterclockwise';
    paused: boolean;
}

function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}

export function buildSessionTimerRingState(params: {
    progressRadius: number;
    progressRingWidth: number;
    ringGap: number;
    sessionRingWidth: number;
    elapsedMs?: number;
    targetMinutes?: number;
    progressValue?: number;
    targetValue?: number;
    countdown?: boolean;
    paused?: boolean;
}): SessionTimerRingState | null {
    const elapsedProgress = params.targetValue !== undefined
        ? clamp((params.progressValue ?? 0) / Math.max(1, params.targetValue), 0, 1)
        : clamp((params.elapsedMs ?? 0) / (Math.max(1, params.targetMinutes ?? 1) * 60000), 0, 1);
    const progress = params.countdown ? 1 - elapsedProgress : elapsedProgress;
    const radius = params.progressRadius + (params.progressRingWidth / 2) + params.ringGap + (params.sessionRingWidth / 2);
    return {
        radius,
        strokeWidth: params.sessionRingWidth,
        progress,
        colorProgress: elapsedProgress,
        direction: params.countdown ? 'counterclockwise' : 'clockwise',
        paused: !!params.paused,
    };
}

export function sessionTimerArcPath(
    radius: number,
    progress: number,
    direction: 'clockwise' | 'counterclockwise' = 'clockwise'
): string {
    const clampedProgress = clamp(progress, 0, 1);
    if (clampedProgress <= 0) return '';
    const topAngle = -Math.PI / 2;
    const sweep = direction === 'counterclockwise' ? -1 : 1;
    const startAngle = direction === 'counterclockwise'
        ? topAngle + (sweep * Math.PI * 2 * (1 - clampedProgress))
        : topAngle;
    const endAngle = startAngle + (sweep * Math.PI * 2 * clampedProgress);
    const x0 = radius * Math.cos(startAngle);
    const y0 = radius * Math.sin(startAngle);
    const x1 = radius * Math.cos(endAngle);
    const y1 = radius * Math.sin(endAngle);
    const largeArc = clampedProgress > 0.5 ? 1 : 0;
    const sweepFlag = direction === 'counterclockwise' ? 0 : 1;
    if (clampedProgress >= 0.999) {
        const midAngle = startAngle + (sweep * Math.PI);
        const xm = radius * Math.cos(midAngle);
        const ym = radius * Math.sin(midAngle);
        return [
            `M ${formatNumber(x0)} ${formatNumber(y0)}`,
            `A ${formatNumber(radius)} ${formatNumber(radius)} 0 1 ${sweepFlag} ${formatNumber(xm)} ${formatNumber(ym)}`,
            `A ${formatNumber(radius)} ${formatNumber(radius)} 0 1 ${sweepFlag} ${formatNumber(x0)} ${formatNumber(y0)}`
        ].join(' ');
    }
    return [
        `M ${formatNumber(x0)} ${formatNumber(y0)}`,
        `A ${formatNumber(radius)} ${formatNumber(radius)} 0 ${largeArc} ${sweepFlag} ${formatNumber(x1)} ${formatNumber(y1)}`
    ].join(' ');
}

export function renderSessionTimerRing(state: SessionTimerRingState | null): string {
    if (!state) return '';
    const arcPath = sessionTimerArcPath(state.radius, state.progress, state.direction);
    const progressStep = clamp(Math.round(state.colorProgress * 20) * 5, 0, 100);
    return `
        <g class="ert-timeline-session-ring is-progress-${progressStep} is-${state.direction}${state.paused ? ' is-paused' : ''}">
            <circle cx="0" cy="0" r="${formatNumber(state.radius)}" class="ert-timeline-session-ring__track" stroke-width="${formatNumber(state.strokeWidth)}" />
            ${arcPath ? `<path d="${arcPath}" class="ert-timeline-session-ring__arc" stroke-width="${formatNumber(state.strokeWidth)}" />` : ''}
        </g>
    `;
}

// Compact filled-pie variant for the workspace tab icon. Mirrors the count
// ring's direction semantics (countdown depletes counterclockwise; elapsed
// grows clockwise) but as a solid wedge so it reads at ~16px.
export function tabTimerWedgePath(
    radius: number,
    progress: number,
    direction: 'clockwise' | 'counterclockwise'
): string {
    const p = clamp(progress, 0, 1);
    if (p <= 0) return '';
    if (p >= 0.999) {
        return [
            `M 0 ${formatNumber(-radius)}`,
            `A ${formatNumber(radius)} ${formatNumber(radius)} 0 1 1 0 ${formatNumber(radius)}`,
            `A ${formatNumber(radius)} ${formatNumber(radius)} 0 1 1 0 ${formatNumber(-radius)}`,
            'Z',
        ].join(' ');
    }
    const topAngle = -Math.PI / 2;
    const sweep = direction === 'counterclockwise' ? -1 : 1;
    const startAngle = direction === 'counterclockwise'
        ? topAngle + (sweep * Math.PI * 2 * (1 - p))
        : topAngle;
    const endAngle = startAngle + (sweep * Math.PI * 2 * p);
    const x0 = radius * Math.cos(startAngle);
    const y0 = radius * Math.sin(startAngle);
    const x1 = radius * Math.cos(endAngle);
    const y1 = radius * Math.sin(endAngle);
    const largeArc = p > 0.5 ? 1 : 0;
    const sweepFlag = direction === 'counterclockwise' ? 0 : 1;
    return [
        'M 0 0',
        `L ${formatNumber(x0)} ${formatNumber(y0)}`,
        `A ${formatNumber(radius)} ${formatNumber(radius)} 0 ${largeArc} ${sweepFlag} ${formatNumber(x1)} ${formatNumber(y1)}`,
        'Z',
    ].join(' ');
}

export const TAB_TIMER_DISC_RADIUS = 11;
export const TAB_TIMER_HOLE_RADIUS = 4.5;

let tabTimerMaskCounter = 0;

export function buildTabTimerDiscSvg(params: {
    progress: number;
    direction: 'clockwise' | 'counterclockwise';
    paused: boolean;
    /** Auto-track marker: 'dot' = idle-suspended (donut hole), 'plus' = actively tracking. */
    symbol?: 'dot' | 'plus';
}): SVGSVGElement {
    const ns = 'http://www.w3.org/2000/svg';
    const radius = TAB_TIMER_DISC_RADIUS;
    const svg = activeDocument.createElementNS(ns, 'svg');
    svg.setAttribute('class', `svg-icon ert-tab-timer-disc${params.paused ? ' is-paused' : ''}`);
    svg.setAttribute('viewBox', '-12 -12 24 24');
    svg.setAttribute('aria-hidden', 'true');

    const disc = svg.ownerDocument.createElementNS(ns, 'g');
    svg.appendChild(disc);

    const track = svg.ownerDocument.createElementNS(ns, 'circle');
    track.setAttribute('cx', '0');
    track.setAttribute('cy', '0');
    track.setAttribute('r', formatNumber(radius));
    track.setAttribute('class', 'ert-tab-timer-disc__track');
    disc.appendChild(track);

    const wedge = tabTimerWedgePath(radius, params.progress, params.direction);
    if (wedge) {
        const fill = svg.ownerDocument.createElementNS(ns, 'path');
        fill.setAttribute('d', wedge);
        fill.setAttribute('class', 'ert-tab-timer-disc__fill');
        disc.appendChild(fill);
    }
    if (params.symbol === 'dot') {
        // Idle-suspended: punch a hole through the disc so it reads as a donut —
        // the tab background shows through, which stays legible in any theme.
        const maskId = `ert-tab-timer-hole-${++tabTimerMaskCounter}`;
        const mask = svg.ownerDocument.createElementNS(ns, 'mask');
        mask.setAttribute('id', maskId);
        const keep = svg.ownerDocument.createElementNS(ns, 'rect');
        keep.setAttribute('x', '-12');
        keep.setAttribute('y', '-12');
        keep.setAttribute('width', '24');
        keep.setAttribute('height', '24');
        keep.setAttribute('fill', 'white');
        mask.appendChild(keep);
        const hole = svg.ownerDocument.createElementNS(ns, 'circle');
        hole.setAttribute('cx', '0');
        hole.setAttribute('cy', '0');
        hole.setAttribute('r', formatNumber(TAB_TIMER_HOLE_RADIUS));
        hole.setAttribute('fill', 'black');
        mask.appendChild(hole);
        svg.insertBefore(mask, disc);
        disc.setAttribute('mask', `url(#${maskId})`);
    } else if (params.symbol === 'plus') {
        const plus = svg.ownerDocument.createElementNS(ns, 'path');
        plus.setAttribute('d', 'M -3.5 0 H 3.5 M 0 -3.5 V 3.5');
        plus.setAttribute('class', 'ert-tab-timer-disc__symbol ert-tab-timer-disc__symbol--plus');
        svg.appendChild(plus);
    }
    return svg;
}

export function renderSessionTimerRingLayer(state: SessionTimerRingState | null): string {
    const ring = renderSessionTimerRing(state);
    if (!ring.trim()) return '';
    return `
        <g class="ert-timeline-session-ring-layer">
            ${ring}
        </g>
    `;
}
