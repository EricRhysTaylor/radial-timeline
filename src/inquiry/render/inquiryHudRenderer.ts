import {
    MINIMAP_GROUP_Y
} from '../minimap/InquiryMinimapRenderer';
import {
    PREVIEW_DETAIL_GAP,
    PREVIEW_FOOTER_GAP,
    PREVIEW_FOOTER_HEIGHT,
    PREVIEW_HERO_LINE_HEIGHT,
    PREVIEW_HERO_MAX_LINES,
    PREVIEW_META_GAP,
    PREVIEW_META_LINE_HEIGHT,
    PREVIEW_PANEL_PADDING_X,
    PREVIEW_PANEL_PADDING_Y,
    PREVIEW_PANEL_WIDTH,
    PREVIEW_PILL_GAP_X,
    PREVIEW_PILL_GAP_Y,
    PREVIEW_PILL_HEIGHT,
    PREVIEW_PILL_PADDING_X,
    PREVIEW_RESULTS_FOOTER_OFFSET,
    PREVIEW_RESULTS_HERO_MAX_LINES,
    PREVIEW_RESULTS_HERO_MAX_WIDTH,
    PREVIEW_RUNNING_CONTENT_OFFSET_Y,
    PREVIEW_SHIMMER_OVERHANG,
    PREVIEW_SHIMMER_WIDTH
} from '../constants/inquiryLayout';
import { clearSvgChildren, createSvgElement } from '../minimap/svgUtils';
import type { InquiryLens, InquiryZone } from '../state';
import type { InquiryRunProgressEvent } from '../runner/types';
import type { InquiryPreviewRow } from '../types/inquiryViewTypes';

export type InquiryPreviewRendererRefs = {
    previewGroup?: SVGGElement;
    previewHero?: SVGTextElement;
    previewMeta?: SVGTextElement;
    previewFooter?: SVGTextElement;
    previewClickTarget?: SVGRectElement;
    previewRows: InquiryPreviewRow[];
    previewRunningNote?: SVGTextElement;
    previewShimmerGroup?: SVGGElement;
    previewShimmerMask?: SVGMaskElement;
    previewShimmerMaskRect?: SVGRectElement;
    previewPanelHeight: number;
};

export function renderInquiryPromptPreviewLayout(args: {
    refs: InquiryPreviewRendererRefs;
    zone: InquiryZone;
    mode: InquiryLens;
    question: string;
    rows: string[];
    metaOverride?: string;
    hideEmpty?: boolean;
    isRunning: boolean;
    minimapLayoutLength?: number;
    setBalancedHeroText: (
        textEl: SVGTextElement,
        text: string,
        maxWidth: number,
        lineHeight: number,
        maxLines?: number
    ) => number;
    setWrappedSvgText: (
        textEl: SVGTextElement,
        text: string,
        maxWidth: number,
        maxLines: number,
        lineHeight: number,
        options?: {
            preferFrontLoaded?: boolean;
            minNonFinalFillRatio?: number;
        }
    ) => number;
    onSvgClear: () => void;
    onSvgNodeCreate: () => void;
}): number {
    const { refs } = args;
    if (!refs.previewGroup || !refs.previewHero) {
        return refs.previewPanelHeight;
    }

    ['setup', 'pressure', 'payoff'].forEach(zoneName => {
        refs.previewGroup?.classList.remove(`is-zone-${zoneName}`);
    });
    refs.previewGroup.classList.add(`is-zone-${args.zone}`);

    const zoneLabel = args.zone === 'setup' ? 'Setup' : args.zone === 'pressure' ? 'Pressure' : 'Payoff';
    const modeLabel = args.mode === 'flow' ? 'Flow' : 'Depth';
    const isResultsPreview = refs.previewGroup.classList.contains('is-results');
    const heroTargetLines = 3;
    const heroBaseWidth = args.minimapLayoutLength ?? (PREVIEW_PANEL_WIDTH - (PREVIEW_PANEL_PADDING_X * 2));
    const contentOffsetY = args.isRunning ? PREVIEW_RUNNING_CONTENT_OFFSET_Y : 0;
    refs.previewHero.setAttribute('y', String(PREVIEW_PANEL_PADDING_Y + contentOffsetY));

    let heroLines = 0;
    if (isResultsPreview) {
        const resultsWidth = Math.max(heroBaseWidth, PREVIEW_RESULTS_HERO_MAX_WIDTH);
        heroLines = args.setWrappedSvgText(
            refs.previewHero,
            args.question,
            resultsWidth,
            PREVIEW_RESULTS_HERO_MAX_LINES,
            PREVIEW_HERO_LINE_HEIGHT,
            {
                preferFrontLoaded: true,
                minNonFinalFillRatio: 0.72
            }
        );
    } else {
        const hoverHeroWidth = Math.max(heroBaseWidth, PREVIEW_RESULTS_HERO_MAX_WIDTH);
        heroLines = args.setBalancedHeroText(
            refs.previewHero,
            args.question,
            hoverHeroWidth,
            PREVIEW_HERO_LINE_HEIGHT,
            PREVIEW_HERO_MAX_LINES
        );
        if (heroLines > heroTargetLines) {
            heroLines = args.setBalancedHeroText(
                refs.previewHero,
                args.question,
                hoverHeroWidth,
                PREVIEW_HERO_LINE_HEIGHT,
                heroTargetLines
            );
        }
    }

    if (refs.previewMeta) {
        const metaY = PREVIEW_PANEL_PADDING_Y + contentOffsetY + (heroLines * PREVIEW_HERO_LINE_HEIGHT) + PREVIEW_META_GAP;
        const metaText = args.metaOverride ?? `${zoneLabel} + ${modeLabel}`.toUpperCase();
        refs.previewMeta.textContent = metaText;
        refs.previewMeta.setAttribute('y', String(metaY));
    }

    const detailStartY = PREVIEW_PANEL_PADDING_Y
        + contentOffsetY
        + (heroLines * PREVIEW_HERO_LINE_HEIGHT)
        + PREVIEW_META_GAP
        + PREVIEW_META_LINE_HEIGHT
        + PREVIEW_DETAIL_GAP;
    const rowCount = layoutInquiryPreviewPills({
        rows: refs.previewRows,
        values: args.rows,
        startY: detailStartY,
        hideEmpty: args.hideEmpty,
        onSvgClear: args.onSvgClear,
        onSvgNodeCreate: args.onSvgNodeCreate
    });
    const rowsBlockHeight = rowCount
        ? (rowCount * PREVIEW_PILL_HEIGHT) + ((rowCount - 1) * PREVIEW_PILL_GAP_Y)
        : 0;
    const footerY = detailStartY + rowsBlockHeight + PREVIEW_FOOTER_GAP;
    if (refs.previewFooter) {
        refs.previewFooter.setAttribute('y', String(footerY));
    }

    return footerY + PREVIEW_FOOTER_HEIGHT;
}

export function renderInquiryRunningHud(args: {
    engineTimerIcon?: SVGUseElement;
    engineTimerLabel?: SVGTextElement;
    navSessionLabel?: SVGTextElement;
    isRunning: boolean;
    currentRunElapsedMs: number;
    currentRunProgress: InquiryRunProgressEvent | null;
    formatElapsedRunClock: (elapsedMs: number) => string;
    buildRunningStageLabel: (progress: InquiryRunProgressEvent | null) => string;
    engineTimerText?: string;
    engineTimerVisible?: boolean;
    engineTimerIconVisible?: boolean;
    setTextIfChanged: (el: Element | null | undefined, text: string) => void;
    toggleClassIfChanged: (el: Element | null | undefined, cls: string, force: boolean) => void;
}): void {
    if (args.engineTimerIcon) {
        const iconVisible = typeof args.engineTimerIconVisible === 'boolean'
            ? args.engineTimerIconVisible
            : false;
        args.toggleClassIfChanged(args.engineTimerIcon, 'ert-hidden', !iconVisible);
    }

    if (args.engineTimerLabel) {
        const visible = typeof args.engineTimerVisible === 'boolean'
            ? args.engineTimerVisible
            : args.isRunning;
        const timerText = typeof args.engineTimerText === 'string'
            ? args.engineTimerText
            : (args.isRunning ? args.formatElapsedRunClock(args.currentRunElapsedMs) : '');
        args.toggleClassIfChanged(args.engineTimerLabel, 'ert-hidden', !visible);
        args.setTextIfChanged(args.engineTimerLabel, timerText);
    }

    if (args.isRunning && args.navSessionLabel) {
        args.setTextIfChanged(
            args.navSessionLabel,
            args.buildRunningStageLabel(args.currentRunProgress) || 'Waiting for the provider response.'
        );
    }
}

export function updateInquiryPreviewShimmerText(args: {
    previewShimmerGroup?: SVGGElement;
    previewHero?: SVGTextElement;
}): void {
    if (!args.previewShimmerGroup) return;
    args.previewShimmerGroup.removeAttribute('display');
    clearSvgChildren(args.previewShimmerGroup);
    if (!args.previewHero) return;
    const clone = args.previewHero.cloneNode(true) as SVGTextElement;
    clone.setAttribute('fill', '#fff');
    clone.setAttribute('opacity', '1');
    args.previewShimmerGroup.appendChild(clone);
}

export function updateInquiryPreviewShimmerLayout(args: {
    refs: InquiryPreviewRendererRefs;
    isRunning: boolean;
}): void {
    if (!args.refs.previewShimmerMaskRect || !args.refs.previewShimmerGroup) return;
    const height = Math.max(args.refs.previewPanelHeight, PREVIEW_PILL_HEIGHT * 2);
    const shimmerPadding = Math.max(PREVIEW_SHIMMER_OVERHANG, PREVIEW_SHIMMER_WIDTH * 0.6);
    let textWidth = PREVIEW_PANEL_WIDTH - (PREVIEW_PANEL_PADDING_X * 2);
    let textStartX = -textWidth / 2;
    if (args.refs.previewHero) {
        try {
            const heroBox = args.refs.previewHero.getBBox();
            if (Number.isFinite(heroBox.width) && heroBox.width > 0) {
                textWidth = heroBox.width;
                textStartX = heroBox.x;
            }
        } catch {
            // Ignore DOM measurement failures and fall back to panel bounds.
        }
    }
    const maskWidth = Math.max(PREVIEW_SHIMMER_WIDTH + 2, textWidth + (shimmerPadding * 2));
    const startX = textStartX - shimmerPadding;

    if (args.refs.previewShimmerMask) {
        args.refs.previewShimmerMask.setAttribute('x', String(startX));
        args.refs.previewShimmerMask.setAttribute('y', '0');
        args.refs.previewShimmerMask.setAttribute('width', String(maskWidth));
        args.refs.previewShimmerMask.setAttribute('height', String(height));
    }

    args.refs.previewShimmerMaskRect.setAttribute('x', String(startX));
    args.refs.previewShimmerMaskRect.setAttribute('y', '0');
    args.refs.previewShimmerMaskRect.setAttribute('width', String(PREVIEW_SHIMMER_WIDTH));
    args.refs.previewShimmerMaskRect.setAttribute('height', String(height));
    args.refs.previewShimmerMaskRect.style.setProperty(
        '--ert-inquiry-shimmer-travel',
        `${Math.max(0, maskWidth - PREVIEW_SHIMMER_WIDTH)}px`
    );

    updateInquiryPreviewClickTargetLayout({
        refs: args.refs,
        isRunning: args.isRunning
    });
}

export function updateInquiryResultsFooterPosition(args: {
    refs: InquiryPreviewRendererRefs;
    isRunning: boolean;
    panelY: number;
    backboneBottom: number;
}): void {
    if (!args.refs.previewFooter || !args.refs.previewGroup) return;
    if (!args.refs.previewGroup.classList.contains('is-results')) return;
    const footerY = (MINIMAP_GROUP_Y + args.backboneBottom + PREVIEW_RESULTS_FOOTER_OFFSET) - args.panelY;
    args.refs.previewFooter.setAttribute('y', footerY.toFixed(2));
    updateInquiryPreviewClickTargetLayout({
        refs: args.refs,
        isRunning: args.isRunning
    });
}

export function updateInquiryPreviewClickTargetLayout(args: {
    refs: InquiryPreviewRendererRefs;
    isRunning: boolean;
}): void {
    const clickTarget = args.refs.previewClickTarget;
    if (!clickTarget) return;
    const baseHeight = Math.max(args.refs.previewPanelHeight, PREVIEW_PILL_HEIGHT * 2);
    const startX = -PREVIEW_PANEL_WIDTH / 2;
    let startY = 0;
    let height = baseHeight;

    if (args.isRunning && args.refs.previewRunningNote && !args.refs.previewRunningNote.classList.contains('ert-hidden')) {
        const noteTop = Number(args.refs.previewRunningNote.getAttribute('y') ?? '-24');
        if (Number.isFinite(noteTop)) {
            startY = Math.min(startY, noteTop);
            height = Math.max(height, baseHeight - startY);
        }
    }

    if (args.refs.previewFooter && args.refs.previewGroup?.classList.contains('is-results')) {
        const footerY = Number(args.refs.previewFooter.getAttribute('y') ?? '0');
        if (Number.isFinite(footerY)) {
            const minY = Math.min(0, footerY);
            const maxY = Math.max(baseHeight, footerY + PREVIEW_FOOTER_HEIGHT);
            startY = minY;
            height = maxY - minY;
        }
    }

    clickTarget.setAttribute('x', String(startX));
    clickTarget.setAttribute('y', String(startY));
    clickTarget.setAttribute('width', String(PREVIEW_PANEL_WIDTH));
    clickTarget.setAttribute('height', String(height));
}

function layoutInquiryPreviewPills(args: {
    rows: InquiryPreviewRow[];
    values: string[];
    startY: number;
    hideEmpty?: boolean;
    onSvgClear: () => void;
    onSvgNodeCreate: () => void;
}): number {
    const items: Array<{ row: InquiryPreviewRow; width: number }> = [];
    args.rows.forEach((row, index) => {
        const value = args.values[index] ?? '';
        const isEmpty = !value.trim();
        if (args.hideEmpty && isEmpty) {
            row.group.classList.add('ert-hidden');
            clearSvgChildren(row.text);
            row.text.removeAttribute('data-rt-pill-cache');
            return;
        }

        row.group.classList.remove('ert-hidden');
        setInquiryPreviewPillText(row, value, args.onSvgClear, args.onSvgNodeCreate);
        const textWidth = row.text.getComputedTextLength();
        const width = Math.ceil(textWidth + (PREVIEW_PILL_PADDING_X * 2));
        row.bg.setAttribute('width', String(width));
        row.bg.setAttribute('height', String(PREVIEW_PILL_HEIGHT));
        row.bg.setAttribute('rx', String(PREVIEW_PILL_HEIGHT / 2));
        row.bg.setAttribute('ry', String(PREVIEW_PILL_HEIGHT / 2));
        row.bg.setAttribute('x', '0');
        row.bg.setAttribute('y', '0');
        items.push({ row, width });
    });

    if (!items.length) return 0;
    const maxRowWidth = PREVIEW_PANEL_WIDTH - (PREVIEW_PANEL_PADDING_X * 2);
    const splitIndex = items.length > 3
        ? pickInquiryPillSplit(items.map(item => item.width), maxRowWidth)
        : items.length;
    const rows = [items.slice(0, splitIndex), items.slice(splitIndex)].filter(row => row.length);

    rows.forEach((row, rowIndex) => {
        const widths = row.map(item => item.width);
        const totalWidth = widths.reduce((sum, value) => sum + value, 0);
        const rowWidth = totalWidth + (PREVIEW_PILL_GAP_X * (row.length - 1));
        let cursor = -rowWidth / 2;
        const rowY = args.startY + (rowIndex * (PREVIEW_PILL_HEIGHT + PREVIEW_PILL_GAP_Y));
        row.forEach((item, index) => {
            item.row.group.setAttribute('transform', `translate(${cursor.toFixed(2)} ${rowY.toFixed(2)})`);
            cursor += widths[index] + PREVIEW_PILL_GAP_X;
        });
    });

    return rows.length;
}

function setInquiryPreviewPillText(
    row: InquiryPreviewRow,
    value: string,
    onSvgClear: () => void,
    onSvgNodeCreate: () => void
): void {
    const cacheKey = `${row.label}|${value}`;
    if (row.text.getAttribute('data-rt-pill-cache') === cacheKey && row.text.childNodes.length > 0) return;

    onSvgClear();
    clearSvgChildren(row.text);
    const labelText = row.label?.trim() ?? '';
    if (labelText) {
        onSvgNodeCreate();
        const label = createSvgElement('tspan');
        label.classList.add('ert-inquiry-preview-pill-label');
        label.textContent = value ? `${labelText} ` : labelText;
        row.text.appendChild(label);
    }
    if (value) {
        onSvgNodeCreate();
        const detail = createSvgElement('tspan');
        detail.classList.add('ert-inquiry-preview-pill-value');
        detail.textContent = value;
        row.text.appendChild(detail);
    }
    row.text.setAttribute('data-rt-pill-cache', cacheKey);
}

function pickInquiryPillSplit(widths: number[], maxWidth: number): number {
    const total = widths.length;
    let bestIndex = Math.ceil((total + 1) / 2);
    let bestScore = Number.POSITIVE_INFINITY;
    const computeRowWidth = (slice: number[]): number => {
        if (!slice.length) return 0;
        const rowTotal = slice.reduce((sum, value) => sum + value, 0);
        return rowTotal + (PREVIEW_PILL_GAP_X * (slice.length - 1));
    };

    const totalRowWidth = computeRowWidth(widths);
    const targetRowWidth = totalRowWidth * 0.6;

    for (let index = 1; index < total; index += 1) {
        const row1Width = computeRowWidth(widths.slice(0, index));
        const row2Width = computeRowWidth(widths.slice(index));
        const overflow = Math.max(0, row1Width - maxWidth) + Math.max(0, row2Width - maxWidth);
        const orderPenalty = row1Width < row2Width ? 180 : 0;
        const score = Math.abs(row1Width - targetRowWidth) + (overflow * 8) + orderPenalty;
        if (score < bestScore) {
            bestScore = score;
            bestIndex = index;
        }
    }

    return bestIndex;
}
