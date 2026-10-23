/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 */

import { setIcon } from 'obsidian';
import type { TimelineItem } from '../../types';
import type { RuntimeContentType } from '../../types/settings';
import { formatRuntimeValue } from '../../utils/runtimeEstimator';
import { addTooltipData } from '../../utils/tooltip';
import { t } from '../../i18n';
import { SHIFT_BUTTON_POS_X, SHIFT_BUTTON_POS_Y } from '../../renderer/layout/LayoutConstants';
import { inclusiveRuntimeBetween, readSceneRuntimeSeconds } from '../../renderer/utils/NarrativeRuntime';
import {
    buildSceneNumberLookup,
    drawComparisonArc,
    removeComparisonArc,
    removeSceneHighlights,
    sceneIdOfGroup,
    setNumberSquareActive,
    updateSceneSelection
} from './sceneComparison';
import type { RadialTimelineView } from '../TimeLineView';

/** Scale applied to the keycap while the runtime view is on. */
const BUTTON_ACTIVE_SCALE = 1.2;
/** The RT keycap is a 32px rounded square in the top-left corner. */
const RT_SIZE = 32;
const RT_POS_X = SHIFT_BUTTON_POS_X;
const RT_POS_Y = SHIFT_BUTTON_POS_Y;

/** One scene of the runtime overlay, read back from the rendered SVG in narrative order. */
interface RuntimeSlice {
    path: string;
    seconds: number;
    startAngle: number;
    endAngle: number;
}

/**
 * The Narrative runtime view's controls: the RT keycap, the header Runtime chip,
 * and two-scene selection. With the view on, clicking two scenes shows the
 * runtime of every scene from the first to the second, both included, in the
 * order the book presents them.
 *
 * The overlay itself is drawn by the renderer; toggling re-renders.
 */
export function setupNarrativeRuntimeController(view: RadialTimelineView, svg: SVGSVGElement): void {
    if (view.currentMode !== 'narrative') return;

    const state = view.narrativeState;
    const hasRuntimeData = view.sceneData.some(scene => scene.itemType === 'Scene' && readSceneRuntimeSeconds(scene) !== null);
    const contentType: RuntimeContentType = view.plugin.settings?.runtimeContentType || 'novel';

    const rtButton = createRtButton(contentType, !hasRuntimeData);
    svg.appendChild(rtButton);
    updateRtButtonState(rtButton, state.runtime);

    const syncHeader = () => view.syncNarrativeSubNav({ runtime: state.runtime });

    const toggleRuntime = () => {
        state.runtime = !state.runtime;
        updateRtButtonState(rtButton, state.runtime);
        syncHeader();
        // Re-render on the next frame so the keycap responds at once.
        const rafId = window.requestAnimationFrame(() => view.refreshTimeline());
        view.renderScope.register(() => cancelAnimationFrame(rafId));
    };

    view.renderScope.registerDomEvent(rtButton as unknown as HTMLElement, 'click', (e: MouseEvent) => {
        e.stopPropagation();
        toggleRuntime();
    });

    view.narrativeSubNav = { toggleRuntime };
    view.renderScope.register(() => {
        if (view.narrativeSubNav?.toggleRuntime === toggleRuntime) view.narrativeSubNav = undefined;
    });
    view.showNarrativeSubNav({ runtimeNoData: !hasRuntimeData });
    syncHeader();

    // Selection follows what the renderer drew, so it never wires up over a
    // wheel that has no runtime overlay.
    if (svg.getAttribute('data-runtime-view') !== 'true') return;
    setupRuntimeSelection(view, svg);
}

/**
 * Two-scene selection while the runtime view is on. Hover and clicks are taken
 * in the capture phase so the regular Narrative hover, synopsis and open-scene
 * handlers stay quiet underneath.
 */
function setupRuntimeSelection(view: RadialTimelineView, svg: SVGSVGElement): void {
    const numberLookup = buildSceneNumberLookup(svg);
    const slices: RuntimeSlice[] = Array.from(svg.querySelectorAll('.rt-runtime-scene')).map(group => ({
        path: group.getAttribute('data-path') ?? '',
        seconds: parseFloat(group.getAttribute('data-runtime-seconds') ?? '0'),
        startAngle: parseFloat(group.getAttribute('data-start-angle') ?? 'NaN'),
        endAngle: parseFloat(group.getAttribute('data-end-angle') ?? 'NaN')
    }));
    // Scenes without a path can't be matched to a slice, so they stay out of the lookup.
    const sliceIndexByPath = new Map(slices.flatMap((slice, index): Array<[string, number]> => (slice.path ? [[slice.path, index]] : [])));
    const runtimes = slices.map(slice => (slice.seconds > 0 ? slice.seconds : null));
    const layer = svg.querySelector('.rt-runtime-overlay');
    let selected: TimelineItem[] = [];

    const isLocked = (encodedPath: string) => selected.some(scene => scene.path && encodeURIComponent(scene.path) === encodedPath);

    const showRuntimeBetween = () => {
        removeComparisonArc(svg);
        if (selected.length !== 2) return;
        const indices = selected.map(scene => sliceIndexByPath.get(encodeURIComponent(scene.path ?? '')));
        if (indices[0] === undefined || indices[1] === undefined) return;
        const first = slices[Math.min(indices[0], indices[1])];
        const last = slices[Math.max(indices[0], indices[1])];
        drawComparisonArc(svg, {
            startAngle: first.startAngle,
            endAngle: last.endAngle,
            markerAngles: [first.startAngle, last.endAngle],
            label: formatRuntimeValue(inclusiveRuntimeBetween(runtimes, indices[0], indices[1])),
            layer
        });
    };

    view.renderScope.registerDomEvent(svg as unknown as HTMLElement, 'pointerover', (e: PointerEvent) => {
        const group = (e.target as Element).closest('.rt-scene-group[data-item-type="Scene"]');
        if (!group) return;
        e.stopImmediatePropagation();
        svg.classList.add('rt-shift-scene-hover');
        const encodedPath = group.getAttribute('data-path');
        if (!encodedPath || isLocked(encodedPath)) return;
        group.classList.add('rt-shift-hover');
        setNumberSquareActive(sceneIdOfGroup(group), true, numberLookup);
    }, { capture: true });

    view.renderScope.registerDomEvent(svg as unknown as HTMLElement, 'pointerout', (e: PointerEvent) => {
        const group = (e.target as Element).closest('.rt-scene-group[data-item-type="Scene"]');
        if (!group) return;
        e.stopImmediatePropagation();
        svg.classList.remove('rt-shift-scene-hover');
        const encodedPath = group.getAttribute('data-path');
        if (!encodedPath || isLocked(encodedPath)) return;
        group.classList.remove('rt-shift-hover');
        setNumberSquareActive(sceneIdOfGroup(group), false, numberLookup);
    }, { capture: true });

    view.renderScope.registerDomEvent(svg as unknown as HTMLElement, 'click', (e: MouseEvent) => {
        const group = (e.target as Element).closest('.rt-scene-group[data-item-type="Scene"]');
        if (!group) return;
        e.preventDefault();
        e.stopPropagation();
        const encodedPath = group.getAttribute('data-path');
        if (!encodedPath) return;
        const decodedPath = decodeURIComponent(encodedPath);
        const scene = view.sceneData.find(item => item.path === decodedPath);
        if (!scene) return;

        if (isLocked(encodedPath)) {
            selected = selected.filter(item => item.path !== decodedPath);
        } else {
            selected = [...selected, scene].slice(-2);
        }
        updateSceneSelection(svg, selected, numberLookup);
        showRuntimeBetween();
    }, { capture: true });

    view.renderScope.register(() => {
        removeComparisonArc(svg);
        removeSceneHighlights(svg);
    });
}

/** Rounded square for the RT keycap, matching the Shift and Alt keycaps' corners. */
function createRtButtonShape(): string {
    const r = 10;
    return `M${r} 0 H${RT_SIZE - r} Q${RT_SIZE} 0 ${RT_SIZE} ${r} V${RT_SIZE - r} Q${RT_SIZE} ${RT_SIZE} ${RT_SIZE - r} ${RT_SIZE} H${r} Q0 ${RT_SIZE} 0 ${RT_SIZE - r} V${r} Q0 0 ${r} 0 Z`;
}

/**
 * The RT (Runtime) keycap. Lucide 'projector' for screenplay, 'mic-vocal' for
 * novel/audiobook. With no Runtime data in the book it shows its warning state.
 */
function createRtButton(contentType: RuntimeContentType, noData: boolean): SVGGElement {
    const button = activeWindow.createSvg('g');
    button.setAttribute('class', 'rt-shift-mode-button rt-runtime-button');
    button.setAttribute('id', 'runtime-mode-toggle');
    if (noData) button.classList.add('rt-runtime-no-data');

    const bg = activeWindow.createSvg('path');
    bg.setAttribute('d', createRtButtonShape());
    bg.setAttribute('class', 'rt-shift-button-bg rt-runtime-icon-bg');
    bg.setAttribute('fill', 'var(--interactive-normal)');
    bg.setAttribute('stroke', 'var(--text-normal)');
    bg.setAttribute('stroke-width', '6');

    // The icon ignores the pointer so hover and click reach the keycap group,
    // which carries the tooltip.
    const foreignObject = activeWindow.createSvg('foreignObject');
    foreignObject.setAttribute('x', '0');
    foreignObject.setAttribute('y', '0');
    foreignObject.setAttribute('width', String(RT_SIZE));
    foreignObject.setAttribute('height', String(RT_SIZE));
    foreignObject.setAttribute('class', 'rt-runtime-icon-container');
    foreignObject.classList.add('ert-pointer-events-none');

    const iconWrapper = activeWindow.createDiv();
    iconWrapper.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
    iconWrapper.className = 'rt-runtime-icon-wrapper';
    setIcon(iconWrapper, contentType === 'screenplay' ? 'projector' : 'mic-vocal');
    iconWrapper.querySelector('svg')?.classList.add('rt-runtime-lucide-icon');
    foreignObject.appendChild(iconWrapper);

    const tooltipText = noData
        ? t('ui.narrativeRuntimeController.runtimeNoData')
        : contentType === 'screenplay'
            ? t('ui.narrativeRuntimeController.runtimeScreenplay')
            : t('ui.narrativeRuntimeController.runtimeNovel');
    addTooltipData(button, tooltipText, 'bottom');
    button.setAttribute('data-content-type', contentType);

    button.appendChild(bg);
    button.appendChild(foreignObject);
    return button;
}

/** Scale the keycap up from its bottom-left corner while the runtime view is on. */
function updateRtButtonState(button: SVGGElement, active: boolean): void {
    if (active) {
        const scaledPosY = RT_POS_Y - RT_SIZE * (BUTTON_ACTIVE_SCALE - 1);
        button.setAttribute('transform', `translate(${RT_POS_X}, ${scaledPosY}) scale(${BUTTON_ACTIVE_SCALE})`);
        button.classList.add('rt-shift-mode-active', 'rt-runtime-mode-active');
    } else {
        button.setAttribute('transform', `translate(${RT_POS_X}, ${RT_POS_Y})`);
        button.classList.remove('rt-shift-mode-active', 'rt-runtime-mode-active');
    }
}
