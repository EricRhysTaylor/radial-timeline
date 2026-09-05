import {
    SCENE_DOSSIER_ANCHOR_BODY_GAP,
    SCENE_DOSSIER_ANCHOR_LINE_HEIGHT,
    SCENE_DOSSIER_ANCHOR_MAX_WIDTH,
    SCENE_DOSSIER_BODY_PRIMARY_LINE_HEIGHT,
    SCENE_DOSSIER_BODY_ROW_GAP,
    SCENE_DOSSIER_BODY_SECONDARY_LINE_HEIGHT,
    SCENE_DOSSIER_BRACE_BASELINE_OFFSET,
    SCENE_DOSSIER_BRACE_INSET,
    SCENE_DOSSIER_BRACE_SIZE,
    SCENE_DOSSIER_CANVAS_Y,
    SCENE_DOSSIER_CENTER_Y,
    SCENE_DOSSIER_FOCUS_RADIUS,
    SCENE_DOSSIER_FOOTER_GAP,
    SCENE_DOSSIER_FOOTER_LINE_HEIGHT,
    SCENE_DOSSIER_FOOTER_SIZE,
    SCENE_DOSSIER_FOOTER_Y_OFFSET,
    SCENE_DOSSIER_HEADER_LINE_HEIGHT,
    SCENE_DOSSIER_HEADER_SIZE,
    SCENE_DOSSIER_HEADER_Y_OFFSET,
    SCENE_DOSSIER_MIN_HEIGHT,
    SCENE_DOSSIER_PADDING_Y,
    SCENE_DOSSIER_SECONDARY_DIVIDER_WIDTH_RATIO,
    SCENE_DOSSIER_SIDE_PADDING,
    SCENE_DOSSIER_SOURCE_GAP,
    SCENE_DOSSIER_SOURCE_LINE_HEIGHT,
    SCENE_DOSSIER_SOURCE_Y_OFFSET,
    SCENE_DOSSIER_TEXT_GROUP_Y,
    SCENE_DOSSIER_TEXT_MAX_WIDTH,
    SCENE_DOSSIER_TITLE_ANCHOR_GAP,
    SCENE_DOSSIER_TITLE_MAX_WIDTH,
    SCENE_DOSSIER_WIDTH
} from '../constants/inquiryLayout';
import { createSvgElement, createSvgGroup, createSvgText, clearSvgChildren } from '../minimap/svgUtils';
import type { InquirySceneDossier } from '../types/inquiryViewTypes';

export type InquirySceneDossierRefs = {
    group: SVGGElement;
    composition: SVGGElement;
    focusCore: SVGCircleElement;
    focusGlow: SVGCircleElement;
    focusOutline: SVGCircleElement;
    bg: SVGRectElement;
    braceLeft: SVGTextElement;
    braceRight: SVGTextElement;
    textGroup: SVGGElement;
    coreGroup: SVGGElement;
    header: SVGTextElement;
    anchor: SVGTextElement;
    body: SVGTextElement;
    bodySecondary: SVGTextElement;
    bodyDivider: SVGLineElement;
    footer: SVGTextElement;
    source: SVGTextElement;
};

export function createInquirySceneDossierLayer(parent: SVGElement, y: number): InquirySceneDossierRefs {
    const group = createSvgGroup(parent, 'ert-inquiry-scene-dossier', 0, y);
    group.setAttribute('pointer-events', 'none');

    const composition = createSvgGroup(group, 'ert-inquiry-scene-dossier-composition');

    const focusCore = createSvgElement('circle');
    focusCore.classList.add('ert-inquiry-scene-dossier-focus-core');
    focusCore.setAttribute('cx', '0');
    focusCore.setAttribute('cy', '0');
    focusCore.setAttribute('r', String(Math.round(SCENE_DOSSIER_FOCUS_RADIUS * 0.62)));
    composition.appendChild(focusCore);

    const focusGlow = createSvgElement('circle');
    focusGlow.classList.add('ert-inquiry-scene-dossier-focus');
    focusGlow.setAttribute('cx', '0');
    focusGlow.setAttribute('cy', '0');
    focusGlow.setAttribute('r', String(SCENE_DOSSIER_FOCUS_RADIUS));
    composition.appendChild(focusGlow);

    const focusOutline = createSvgElement('circle');
    focusOutline.classList.add('ert-inquiry-scene-dossier-focus-outline');
    focusOutline.setAttribute('cx', '0');
    focusOutline.setAttribute('cy', '0');
    focusOutline.setAttribute('r', String(SCENE_DOSSIER_FOCUS_RADIUS));
    composition.appendChild(focusOutline);

    const bg = createSvgElement('rect');
    bg.classList.add('ert-inquiry-scene-dossier-bg');
    bg.setAttribute('x', String(-SCENE_DOSSIER_WIDTH / 2));
    bg.setAttribute('y', '0');
    bg.setAttribute('width', String(SCENE_DOSSIER_WIDTH));
    bg.setAttribute('height', String(SCENE_DOSSIER_MIN_HEIGHT));
    bg.setAttribute('rx', '34');
    bg.setAttribute('ry', '34');
    composition.appendChild(bg);

    const braceLeft = createSvgText(composition, 'ert-inquiry-scene-dossier-brace ert-inquiry-scene-dossier-brace--left', '{', 0, 0);
    braceLeft.setAttribute('text-anchor', 'middle');
    braceLeft.setAttribute('dominant-baseline', 'middle');

    const braceRight = createSvgText(composition, 'ert-inquiry-scene-dossier-brace ert-inquiry-scene-dossier-brace--right', '}', 0, 0);
    braceRight.setAttribute('text-anchor', 'middle');
    braceRight.setAttribute('dominant-baseline', 'middle');

    const textGroup = createSvgGroup(composition, 'ert-inquiry-scene-dossier-text', 0, SCENE_DOSSIER_TEXT_GROUP_Y);
    const header = createSvgText(textGroup, 'ert-inquiry-scene-dossier-header', '', 0, SCENE_DOSSIER_PADDING_Y + SCENE_DOSSIER_HEADER_SIZE);
    header.setAttribute('text-anchor', 'middle');

    const coreGroup = createSvgGroup(textGroup, 'ert-inquiry-scene-dossier-core');
    const anchor = createSvgText(coreGroup, 'ert-inquiry-scene-dossier-anchor', '', 0, 0);
    anchor.setAttribute('text-anchor', 'middle');
    const body = createSvgText(coreGroup, 'ert-inquiry-scene-dossier-body', '', 0, 0);
    body.setAttribute('text-anchor', 'middle');
    const bodySecondary = createSvgText(coreGroup, 'ert-inquiry-scene-dossier-body ert-inquiry-scene-dossier-body--secondary', '', 0, 0);
    bodySecondary.setAttribute('text-anchor', 'middle');

    const bodyDivider = createSvgElement('line');
    bodyDivider.classList.add('ert-inquiry-scene-dossier-divider', 'ert-hidden');
    coreGroup.appendChild(bodyDivider);

    const footer = createSvgText(textGroup, 'ert-inquiry-scene-dossier-footer', '', 0, 0);
    footer.setAttribute('text-anchor', 'middle');
    const source = createSvgText(textGroup, 'ert-inquiry-scene-dossier-source', '', 0, 0);
    source.setAttribute('text-anchor', 'middle');

    return {
        group,
        composition,
        focusCore,
        focusGlow,
        focusOutline,
        bg,
        braceLeft,
        braceRight,
        textGroup,
        coreGroup,
        header,
        anchor,
        body,
        bodySecondary,
        bodyDivider,
        footer,
        source
    };
}

export function renderInquirySceneDossier(args: {
    refs: InquirySceneDossierRefs;
    dossier: InquirySceneDossier;
    rootSvg?: SVGSVGElement;
    previewGroup?: SVGGElement;
    computeBalancedSvgLines: (
        textEl: SVGTextElement,
        text: string,
        maxWidth: number,
        options?: { maxLines?: number; preferFrontLoaded?: boolean; minNonFinalFillRatio?: number }
    ) => string[];
    setPositionedDossierTextBlock: (
        textEl: SVGTextElement,
        text: string,
        maxWidth: number,
        lineHeight: number,
        startDy: number,
        options?: { align?: 'center' | 'start'; justify?: boolean; preferFrontLoaded?: boolean; minNonFinalFillRatio?: number }
    ) => number;
}): void {
    const { refs, dossier } = args;
    const titleTextWidth = Math.min(
        SCENE_DOSSIER_TITLE_MAX_WIDTH,
        SCENE_DOSSIER_WIDTH - (SCENE_DOSSIER_SIDE_PADDING * 2)
    );
    const contentTextWidth = Math.min(
        SCENE_DOSSIER_TEXT_MAX_WIDTH,
        SCENE_DOSSIER_WIDTH - (SCENE_DOSSIER_SIDE_PADDING * 2)
    );
    const anchorTextWidth = Math.min(
        SCENE_DOSSIER_ANCHOR_MAX_WIDTH,
        contentTextWidth
    );
    const titleLines = args.computeBalancedSvgLines(
        refs.header,
        dossier.title,
        titleTextWidth
    ).length || 1;
    const anchorLines = args.computeBalancedSvgLines(
        refs.anchor,
        dossier.anchorLine || 'Finding',
        anchorTextWidth,
        { preferFrontLoaded: true }
    ).length || 1;
    const bodyLines = dossier.bodyLines
        .filter(line => line && line !== dossier.anchorLine)
        .slice(0, 2);
    refs.textGroup.setAttribute('transform', `translate(0 ${SCENE_DOSSIER_TEXT_GROUP_Y})`);
    refs.coreGroup.setAttribute('transform', 'translate(0 0)');
    const bodyPrimaryText = bodyLines[0] || '';
    const bodySecondaryText = bodyLines[1] || '';
    const hasBodyPrimary = !!bodyPrimaryText;
    const hasBodySecondary = !!bodySecondaryText;
    refs.body.classList.toggle('ert-hidden', !hasBodyPrimary);
    refs.bodySecondary.classList.toggle('ert-hidden', !hasBodySecondary);
    refs.bodyDivider.classList.toggle('ert-hidden', !hasBodySecondary);
    const bodyPrimaryLines = hasBodyPrimary
        ? args.computeBalancedSvgLines(refs.body, bodyPrimaryText, contentTextWidth, {
            minNonFinalFillRatio: 0.7
        }).length
        : 0;
    const bodySecondaryLines = hasBodySecondary
        ? args.computeBalancedSvgLines(refs.bodySecondary, bodySecondaryText, contentTextWidth, {
            minNonFinalFillRatio: 0.7
        }).length
        : 0;
    const hasMeta = !!dossier.metaLine;
    const hasSource = !!dossier.sourceLabel;
    refs.footer.classList.toggle('ert-hidden', !hasMeta);
    refs.source.classList.toggle('ert-hidden', !hasSource);
    const metaLines = hasMeta
        ? args.computeBalancedSvgLines(refs.footer, dossier.metaLine ?? '', contentTextWidth).length
        : 0;
    const sourceLines = hasSource
        ? args.computeBalancedSvgLines(refs.source, dossier.sourceLabel ?? '', contentTextWidth).length
        : 0;

    let contentHeight = SCENE_DOSSIER_PADDING_Y
        + (Math.max(titleLines, 1) * SCENE_DOSSIER_HEADER_LINE_HEIGHT)
        + SCENE_DOSSIER_TITLE_ANCHOR_GAP
        + (Math.max(anchorLines, 1) * SCENE_DOSSIER_ANCHOR_LINE_HEIGHT);
    if (hasBodyPrimary) {
        contentHeight += SCENE_DOSSIER_ANCHOR_BODY_GAP
            + (Math.max(bodyPrimaryLines, 1) * SCENE_DOSSIER_BODY_PRIMARY_LINE_HEIGHT);
    }
    if (hasBodySecondary) {
        contentHeight += SCENE_DOSSIER_BODY_ROW_GAP
            + (Math.max(bodySecondaryLines, 1) * SCENE_DOSSIER_BODY_SECONDARY_LINE_HEIGHT);
    }
    if (hasMeta) {
        contentHeight += SCENE_DOSSIER_FOOTER_GAP
            + SCENE_DOSSIER_FOOTER_SIZE
            + ((Math.max(metaLines, 1) - 1) * SCENE_DOSSIER_FOOTER_LINE_HEIGHT);
    }
    if (hasSource) {
        contentHeight += SCENE_DOSSIER_SOURCE_GAP
            + SCENE_DOSSIER_SOURCE_LINE_HEIGHT
            + ((Math.max(sourceLines, 1) - 1) * SCENE_DOSSIER_SOURCE_LINE_HEIGHT);
    }
    contentHeight += SCENE_DOSSIER_PADDING_Y;
    const dossierHeight = Math.max(SCENE_DOSSIER_MIN_HEIGHT, contentHeight);
    const topY = -Math.round(dossierHeight / 2);
    const titleY = topY + SCENE_DOSSIER_PADDING_Y + SCENE_DOSSIER_HEADER_SIZE;
    const anchorY = titleY
        + (Math.max(titleLines, 1) * SCENE_DOSSIER_HEADER_LINE_HEIGHT)
        + SCENE_DOSSIER_TITLE_ANCHOR_GAP;
    let nextY = anchorY + (Math.max(anchorLines, 1) * SCENE_DOSSIER_ANCHOR_LINE_HEIGHT);
    const bodyPrimaryY = nextY + (hasBodyPrimary ? SCENE_DOSSIER_ANCHOR_BODY_GAP : 0);
    if (hasBodyPrimary) {
        nextY = bodyPrimaryY + (Math.max(bodyPrimaryLines, 1) * SCENE_DOSSIER_BODY_PRIMARY_LINE_HEIGHT);
    }
    const bodySecondaryY = nextY + (hasBodySecondary ? SCENE_DOSSIER_BODY_ROW_GAP : 0);
    if (hasBodySecondary) {
        nextY = bodySecondaryY + (Math.max(bodySecondaryLines, 1) * SCENE_DOSSIER_BODY_SECONDARY_LINE_HEIGHT);
    }
    const metaY = nextY + (hasMeta ? SCENE_DOSSIER_FOOTER_GAP : 0);
    if (hasMeta) {
        nextY = metaY
            + SCENE_DOSSIER_FOOTER_SIZE
            + ((Math.max(metaLines, 1) - 1) * SCENE_DOSSIER_FOOTER_LINE_HEIGHT);
    }
    const sourceY = nextY + (hasSource ? SCENE_DOSSIER_SOURCE_GAP : 0);

    refs.bg.setAttribute('y', String(topY));
    refs.bg.setAttribute('height', String(dossierHeight));
    args.setPositionedDossierTextBlock(
        refs.header,
        dossier.title,
        titleTextWidth,
        SCENE_DOSSIER_HEADER_LINE_HEIGHT,
        titleY + SCENE_DOSSIER_HEADER_Y_OFFSET,
        { align: 'center' }
    );
    args.setPositionedDossierTextBlock(
        refs.anchor,
        dossier.anchorLine || 'Finding',
        anchorTextWidth,
        SCENE_DOSSIER_ANCHOR_LINE_HEIGHT,
        anchorY,
        { align: 'center', preferFrontLoaded: true }
    );
    if (hasBodyPrimary) {
        args.setPositionedDossierTextBlock(
            refs.body,
            bodyPrimaryText,
            contentTextWidth,
            SCENE_DOSSIER_BODY_PRIMARY_LINE_HEIGHT,
            bodyPrimaryY,
            { align: 'start', justify: true, minNonFinalFillRatio: 0.7 }
        );
    } else {
        clearSvgChildren(refs.body);
    }
    if (hasBodySecondary) {
        args.setPositionedDossierTextBlock(
            refs.bodySecondary,
            bodySecondaryText,
            contentTextWidth,
            SCENE_DOSSIER_BODY_SECONDARY_LINE_HEIGHT,
            bodySecondaryY,
            { align: 'start', justify: true, minNonFinalFillRatio: 0.7 }
        );
    } else {
        clearSvgChildren(refs.bodySecondary);
    }
    if (hasBodySecondary) {
        const dividerWidth = Math.round(contentTextWidth * SCENE_DOSSIER_SECONDARY_DIVIDER_WIDTH_RATIO);
        const upperTextEl = hasBodyPrimary ? refs.body : refs.anchor;
        const upperBounds = upperTextEl.getBBox();
        const secondaryBounds = refs.bodySecondary.getBBox();
        const dividerY = Math.round(((upperBounds.y + upperBounds.height) + secondaryBounds.y) / 2);
        refs.bodyDivider.setAttribute('x1', String(-dividerWidth / 2));
        refs.bodyDivider.setAttribute('x2', String(dividerWidth / 2));
        refs.bodyDivider.setAttribute('y1', String(dividerY));
        refs.bodyDivider.setAttribute('y2', String(dividerY));
        refs.bodyDivider.classList.remove('ert-hidden');
    } else {
        refs.bodyDivider.classList.add('ert-hidden');
    }
    if (hasMeta) {
        args.setPositionedDossierTextBlock(
            refs.footer,
            dossier.metaLine ?? '',
            contentTextWidth,
            SCENE_DOSSIER_FOOTER_LINE_HEIGHT,
            metaY + SCENE_DOSSIER_FOOTER_Y_OFFSET,
            { align: 'center' }
        );
    } else {
        clearSvgChildren(refs.footer);
    }
    if (hasSource) {
        args.setPositionedDossierTextBlock(
            refs.source,
            dossier.sourceLabel ?? '',
            contentTextWidth,
            SCENE_DOSSIER_SOURCE_LINE_HEIGHT,
            sourceY + SCENE_DOSSIER_SOURCE_Y_OFFSET,
            { align: 'center' }
        );
    } else {
        clearSvgChildren(refs.source);
    }

    const focusRadius = Math.max(SCENE_DOSSIER_FOCUS_RADIUS, Math.round(dossierHeight * 0.84));
    const focusCoreRadius = Math.round(focusRadius * 0.62);
    refs.focusCore.setAttribute('cy', String(-SCENE_DOSSIER_CANVAS_Y));
    refs.focusCore.setAttribute('r', String(focusCoreRadius));
    refs.focusGlow.setAttribute('cy', String(-SCENE_DOSSIER_CANVAS_Y));
    refs.focusGlow.setAttribute('r', String(focusRadius));
    refs.focusOutline.setAttribute('cy', String(-SCENE_DOSSIER_CANVAS_Y));
    refs.focusOutline.setAttribute('r', String(focusRadius));
    const coreBounds = refs.coreGroup.getBBox();
    const coreCenterY = coreBounds.y + (coreBounds.height / 2);
    const coreGroupDelta = Math.round((SCENE_DOSSIER_CENTER_Y - coreCenterY) * 10) / 10;
    refs.coreGroup.setAttribute('transform', `translate(0 ${coreGroupDelta})`);
    const braceOffsetX = Math.round((SCENE_DOSSIER_WIDTH / 2) - SCENE_DOSSIER_BRACE_INSET);
    refs.braceLeft.setAttribute('x', String(-braceOffsetX));
    refs.braceLeft.setAttribute('y', String(SCENE_DOSSIER_CENTER_Y + SCENE_DOSSIER_BRACE_BASELINE_OFFSET));
    refs.braceRight.setAttribute('x', String(braceOffsetX));
    refs.braceRight.setAttribute('y', String(SCENE_DOSSIER_CENTER_Y + SCENE_DOSSIER_BRACE_BASELINE_OFFSET));
    refs.braceLeft.setAttribute('font-size', String(SCENE_DOSSIER_BRACE_SIZE));
    refs.braceRight.setAttribute('font-size', String(SCENE_DOSSIER_BRACE_SIZE));

    if (args.rootSvg?.lastChild !== refs.group) {
        args.rootSvg?.appendChild(refs.group);
    }
    refs.group.classList.add('is-visible');
    args.previewGroup?.classList.add('is-dossier-muted');
}
