/*
 * Radial Timeline Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 *
 * The <defs> the Inquiry SVG shell needs: icon symbols, the zone and
 * backbone gradients, and the scene dossier focus gradient. Pure over the
 * defs element and the two things the gradients read from the view.
 */

import type { InquiryMinimapRenderer } from '../minimap/InquiryMinimapRenderer';
import { ZONE_RING_THICKNESS, ZONE_SEGMENT_RADIUS } from '../components/InquiryGlyph';
import { VIEWBOX_MAX } from '../constants/inquiryLayout';
import { getBackboneStartColors, toRgbString } from '../minimap/InquiryMinimapRenderer';
import { createSvgElement } from '../minimap/svgUtils';
import { InquiryZone } from '../state';

export interface ZoneGradientDeps {
    /** The element whose computed style supplies the backbone colours. */
    styleSource: Element;
    minimap: Pick<InquiryMinimapRenderer, 'setGradientStops' | 'setShineStops' | 'initBackboneClip'>;
}

export function buildIconSymbols(defs: SVGDefsElement, createIconSymbol: (defs: SVGDefsElement, iconName: string) => string | null): string[] {
    const ids: string[] = [];
    [
        'waves',
        'waves-arrow-down',
        'file',
        'file-text',
        'file-x-corner',
        'book',
        'columns-2',
        'cpu',
        'aperture',
        'chevron-left',
        'chevron-right',
        'chevron-up',
        'chevron-down',
        'help-circle',
        'activity',
        'arrow-big-up',
        'arrow-big-up-dash',
        'arrow-big-right-dash',
        'mouse-pointer-click',
        'check-circle',
        'flame-kindling',
        'sigma',
        'x',
        'circle',
        'circle-dot',
        'disc',
        'asterisk'
    ].forEach(icon => {
        const symbolId = createIconSymbol(defs, icon);
        if (symbolId) {
            ids.push(symbolId);
        }
    });
    return ids;
}

export function buildZoneGradients(defs: SVGDefsElement, deps: ZoneGradientDeps): void {
    const zones: InquiryZone[] = ['setup', 'pressure', 'payoff'];
    const zoneAnchors: Record<InquiryZone, { cx: string; cy: string; r: string }> = {
        setup: { cx: '1', cy: '0', r: '1.42' },
        pressure: { cx: '0', cy: '0', r: '1.42' },
        payoff: { cx: '0.5', cy: '0', r: '1' }
    };
    const zoneStopOpacity = '0.35';
    const createStop = (offset: string, color: string, opacity?: string): SVGStopElement => {
        const stop = createSvgElement('stop');
        stop.setAttribute('offset', offset);
        stop.setAttribute('stop-color', color);
        if (opacity) {
            stop.setAttribute('stop-opacity', opacity);
        }
        return stop;
    };
    const createGradient = (
        id: string,
        stops: Array<[string, string]>,
        anchor: { cx: string; cy: string; r: string },
        stopOpacity?: string
    ): SVGRadialGradientElement => {
        const gradient = createSvgElement('radialGradient');
        gradient.setAttribute('id', id);
        gradient.setAttribute('cx', anchor.cx);
        gradient.setAttribute('cy', anchor.cy);
        gradient.setAttribute('fx', anchor.cx);
        gradient.setAttribute('fy', anchor.cy);
        gradient.setAttribute('r', anchor.r);
        stops.forEach(([offset, color]) => {
            gradient.appendChild(createStop(offset, color, stopOpacity));
        });
        return gradient;
    };

    const glassGradient = createSvgElement('radialGradient');
    glassGradient.setAttribute('id', 'ert-inquiry-zone-glass');
    glassGradient.setAttribute('gradientUnits', 'userSpaceOnUse');
    glassGradient.setAttribute('cx', '0');
    glassGradient.setAttribute('cy', '0');
    glassGradient.setAttribute('fx', '0');
    glassGradient.setAttribute('fy', '0');
    glassGradient.setAttribute('r', String(VIEWBOX_MAX));
    const toPercent = (radius: number): string => {
        const clamped = Math.min(Math.max(radius / VIEWBOX_MAX, 0), 1);
        return `${(clamped * 100).toFixed(2)}%`;
    };
    const zoneInner = ZONE_SEGMENT_RADIUS - (ZONE_RING_THICKNESS / 2);
    const zoneOuter = ZONE_SEGMENT_RADIUS + (ZONE_RING_THICKNESS / 2);
    const bandInset = ZONE_RING_THICKNESS * 0.18;
    const innerFade = Math.max(0, zoneInner - (ZONE_RING_THICKNESS * 0.22));
    const outerFade = zoneOuter + (ZONE_RING_THICKNESS * 0.22);
    [
        [toPercent(innerFade), '#ffffff', '0.015'],
        [toPercent(zoneInner), '#ffffff', '0.03'],
        [toPercent(zoneInner + bandInset), '#ffffff', '0.12'],
        [toPercent(zoneInner + (ZONE_RING_THICKNESS * 0.5)), '#ffffff', '0.26'],
        [toPercent(zoneOuter - bandInset), '#ffffff', '0.12'],
        [toPercent(zoneOuter), '#ffffff', '0.03'],
        [toPercent(outerFade), '#ffffff', '0.015']
    ].forEach(([offset, color, opacity]) => {
        glassGradient.appendChild(createStop(offset, color, opacity));
    });
    defs.appendChild(glassGradient);

    zones.forEach(zone => {
        const zoneVar = `var(--ert-inquiry-zone-${zone})`;
        const anchor = zoneAnchors[zone];
        defs.appendChild(createGradient(
            `ert-inquiry-zone-${zone}-raised`,
            [
                ['0%', `color-mix(in srgb, ${zoneVar} 55%, #ffffff)`],
                ['50%', zoneVar],
                ['100%', `color-mix(in srgb, ${zoneVar} 55%, #000000)`]
            ],
            anchor,
            zoneStopOpacity
        ));
        defs.appendChild(createGradient(
            `ert-inquiry-zone-${zone}-pressed`,
            [
                ['0%', `color-mix(in srgb, ${zoneVar} 55%, #000000)`],
                ['60%', zoneVar],
                ['100%', `color-mix(in srgb, ${zoneVar} 55%, #ffffff)`]
            ],
            anchor,
            zoneStopOpacity
        ));
    });

    // Neumorphic filters for zone pill states.
    const pillOutFilter = createSvgElement('filter');
    pillOutFilter.setAttribute('id', 'ert-inquiry-zone-pill-out');
    pillOutFilter.setAttribute('x', '-50%');
    pillOutFilter.setAttribute('y', '-50%');
    pillOutFilter.setAttribute('width', '200%');
    pillOutFilter.setAttribute('height', '200%');
    pillOutFilter.setAttribute('color-interpolation-filters', 'sRGB');
    const pillOutLight = createSvgElement('feDropShadow');
    pillOutLight.setAttribute('dx', '-2');
    pillOutLight.setAttribute('dy', '-2');
    pillOutLight.setAttribute('stdDeviation', '1.6');
    pillOutLight.setAttribute('flood-color', '#ffffff');
    pillOutLight.setAttribute('flood-opacity', '0.28');
    const pillOutDark = createSvgElement('feDropShadow');
    pillOutDark.setAttribute('dx', '2');
    pillOutDark.setAttribute('dy', '2');
    pillOutDark.setAttribute('stdDeviation', '1.8');
    pillOutDark.setAttribute('flood-color', '#000000');
    pillOutDark.setAttribute('flood-opacity', '0.35');
    pillOutFilter.appendChild(pillOutLight);
    pillOutFilter.appendChild(pillOutDark);
    defs.appendChild(pillOutFilter);

    const pillInFilter = createSvgElement('filter');
    pillInFilter.setAttribute('id', 'ert-inquiry-zone-pill-in');
    pillInFilter.setAttribute('x', '-50%');
    pillInFilter.setAttribute('y', '-50%');
    pillInFilter.setAttribute('width', '200%');
    pillInFilter.setAttribute('height', '200%');
    pillInFilter.setAttribute('color-interpolation-filters', 'sRGB');
    const pillInOffsetDark = createSvgElement('feOffset');
    pillInOffsetDark.setAttribute('in', 'SourceAlpha');
    pillInOffsetDark.setAttribute('dx', '1.6');
    pillInOffsetDark.setAttribute('dy', '1.6');
    pillInOffsetDark.setAttribute('result', 'pill-in-offset-dark');
    const pillInBlurDark = createSvgElement('feGaussianBlur');
    pillInBlurDark.setAttribute('in', 'pill-in-offset-dark');
    pillInBlurDark.setAttribute('stdDeviation', '1.2');
    pillInBlurDark.setAttribute('result', 'pill-in-blur-dark');
    const pillInCompositeDark = createSvgElement('feComposite');
    pillInCompositeDark.setAttribute('in', 'pill-in-blur-dark');
    pillInCompositeDark.setAttribute('in2', 'SourceAlpha');
    pillInCompositeDark.setAttribute('operator', 'arithmetic');
    pillInCompositeDark.setAttribute('k2', '-1');
    pillInCompositeDark.setAttribute('k3', '1');
    pillInCompositeDark.setAttribute('result', 'pill-in-inner-dark');
    const pillInFloodDark = createSvgElement('feFlood');
    pillInFloodDark.setAttribute('flood-color', '#000000');
    pillInFloodDark.setAttribute('flood-opacity', '0.35');
    pillInFloodDark.setAttribute('result', 'pill-in-flood-dark');
    const pillInShadowDark = createSvgElement('feComposite');
    pillInShadowDark.setAttribute('in', 'pill-in-flood-dark');
    pillInShadowDark.setAttribute('in2', 'pill-in-inner-dark');
    pillInShadowDark.setAttribute('operator', 'in');
    pillInShadowDark.setAttribute('result', 'pill-in-shadow-dark');

    const pillInOffsetLight = createSvgElement('feOffset');
    pillInOffsetLight.setAttribute('in', 'SourceAlpha');
    pillInOffsetLight.setAttribute('dx', '-1.6');
    pillInOffsetLight.setAttribute('dy', '-1.6');
    pillInOffsetLight.setAttribute('result', 'pill-in-offset-light');
    const pillInBlurLight = createSvgElement('feGaussianBlur');
    pillInBlurLight.setAttribute('in', 'pill-in-offset-light');
    pillInBlurLight.setAttribute('stdDeviation', '1.2');
    pillInBlurLight.setAttribute('result', 'pill-in-blur-light');
    const pillInCompositeLight = createSvgElement('feComposite');
    pillInCompositeLight.setAttribute('in', 'pill-in-blur-light');
    pillInCompositeLight.setAttribute('in2', 'SourceAlpha');
    pillInCompositeLight.setAttribute('operator', 'arithmetic');
    pillInCompositeLight.setAttribute('k2', '-1');
    pillInCompositeLight.setAttribute('k3', '1');
    pillInCompositeLight.setAttribute('result', 'pill-in-inner-light');
    const pillInFloodLight = createSvgElement('feFlood');
    pillInFloodLight.setAttribute('flood-color', '#ffffff');
    pillInFloodLight.setAttribute('flood-opacity', '0.22');
    pillInFloodLight.setAttribute('result', 'pill-in-flood-light');
    const pillInShadowLight = createSvgElement('feComposite');
    pillInShadowLight.setAttribute('in', 'pill-in-flood-light');
    pillInShadowLight.setAttribute('in2', 'pill-in-inner-light');
    pillInShadowLight.setAttribute('operator', 'in');
    pillInShadowLight.setAttribute('result', 'pill-in-shadow-light');

    const pillInMerge = createSvgElement('feMerge');
    const pillInMergeGraphic = createSvgElement('feMergeNode');
    pillInMergeGraphic.setAttribute('in', 'SourceGraphic');
    const pillInMergeDark = createSvgElement('feMergeNode');
    pillInMergeDark.setAttribute('in', 'pill-in-shadow-dark');
    const pillInMergeLight = createSvgElement('feMergeNode');
    pillInMergeLight.setAttribute('in', 'pill-in-shadow-light');
    pillInMerge.appendChild(pillInMergeGraphic);
    pillInMerge.appendChild(pillInMergeDark);
    pillInMerge.appendChild(pillInMergeLight);

    pillInFilter.appendChild(pillInOffsetDark);
    pillInFilter.appendChild(pillInBlurDark);
    pillInFilter.appendChild(pillInCompositeDark);
    pillInFilter.appendChild(pillInFloodDark);
    pillInFilter.appendChild(pillInShadowDark);
    pillInFilter.appendChild(pillInOffsetLight);
    pillInFilter.appendChild(pillInBlurLight);
    pillInFilter.appendChild(pillInCompositeLight);
    pillInFilter.appendChild(pillInFloodLight);
    pillInFilter.appendChild(pillInShadowLight);
    pillInFilter.appendChild(pillInMerge);
    defs.appendChild(pillInFilter);

    // Neumorphic "up" filter for zone dot buttons.
    const dotUpFilter = createSvgElement('filter');
    dotUpFilter.setAttribute('id', 'ert-inquiry-zone-dot-up');
    dotUpFilter.setAttribute('x', '-50%');
    dotUpFilter.setAttribute('y', '-50%');
    dotUpFilter.setAttribute('width', '200%');
    dotUpFilter.setAttribute('height', '200%');
    dotUpFilter.setAttribute('color-interpolation-filters', 'sRGB');

    const dotUpFlood = createSvgElement('feFlood');
    dotUpFlood.setAttribute('flood-opacity', '0');
    dotUpFlood.setAttribute('result', 'BackgroundImageFix');
    const dotUpAlphaDark = createSvgElement('feColorMatrix');
    dotUpAlphaDark.setAttribute('in', 'SourceAlpha');
    dotUpAlphaDark.setAttribute('type', 'matrix');
    dotUpAlphaDark.setAttribute('values', '0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0');
    dotUpAlphaDark.setAttribute('result', 'hardAlpha');
    const dotUpOffsetDark = createSvgElement('feOffset');
    dotUpOffsetDark.setAttribute('dx', '2');
    dotUpOffsetDark.setAttribute('dy', '2');
    const dotUpBlurDark = createSvgElement('feGaussianBlur');
    dotUpBlurDark.setAttribute('stdDeviation', '2');
    const dotUpCompositeDark = createSvgElement('feComposite');
    dotUpCompositeDark.setAttribute('in2', 'hardAlpha');
    dotUpCompositeDark.setAttribute('operator', 'out');
    const dotUpColorDark = createSvgElement('feColorMatrix');
    dotUpColorDark.setAttribute('type', 'matrix');
    dotUpColorDark.setAttribute('values', '0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.3 0');
    const dotUpBlendDark = createSvgElement('feBlend');
    dotUpBlendDark.setAttribute('mode', 'normal');
    dotUpBlendDark.setAttribute('in2', 'BackgroundImageFix');
    dotUpBlendDark.setAttribute('result', 'effect1_dropShadow');

    const dotUpAlphaLight = createSvgElement('feColorMatrix');
    dotUpAlphaLight.setAttribute('in', 'SourceAlpha');
    dotUpAlphaLight.setAttribute('type', 'matrix');
    dotUpAlphaLight.setAttribute('values', '0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0');
    dotUpAlphaLight.setAttribute('result', 'hardAlpha');
    const dotUpOffsetLight = createSvgElement('feOffset');
    dotUpOffsetLight.setAttribute('dx', '-2');
    dotUpOffsetLight.setAttribute('dy', '-2');
    const dotUpBlurLight = createSvgElement('feGaussianBlur');
    dotUpBlurLight.setAttribute('stdDeviation', '3');
    const dotUpCompositeLight = createSvgElement('feComposite');
    dotUpCompositeLight.setAttribute('in2', 'hardAlpha');
    dotUpCompositeLight.setAttribute('operator', 'out');
    const dotUpColorLight = createSvgElement('feColorMatrix');
    dotUpColorLight.setAttribute('type', 'matrix');
    dotUpColorLight.setAttribute('values', '0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 0.11 0');
    const dotUpBlendLight = createSvgElement('feBlend');
    dotUpBlendLight.setAttribute('mode', 'normal');
    dotUpBlendLight.setAttribute('in2', 'effect1_dropShadow');
    dotUpBlendLight.setAttribute('result', 'effect2_dropShadow');
    const dotUpBlendShape = createSvgElement('feBlend');
    dotUpBlendShape.setAttribute('mode', 'normal');
    dotUpBlendShape.setAttribute('in', 'SourceGraphic');
    dotUpBlendShape.setAttribute('in2', 'effect2_dropShadow');
    dotUpBlendShape.setAttribute('result', 'shape');

    const dotUpAlphaInnerDark = createSvgElement('feColorMatrix');
    dotUpAlphaInnerDark.setAttribute('in', 'SourceAlpha');
    dotUpAlphaInnerDark.setAttribute('type', 'matrix');
    dotUpAlphaInnerDark.setAttribute('values', '0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0');
    dotUpAlphaInnerDark.setAttribute('result', 'hardAlpha');
    const dotUpOffsetInnerDark = createSvgElement('feOffset');
    dotUpOffsetInnerDark.setAttribute('dx', '-2');
    dotUpOffsetInnerDark.setAttribute('dy', '-2');
    const dotUpBlurInnerDark = createSvgElement('feGaussianBlur');
    dotUpBlurInnerDark.setAttribute('stdDeviation', '1');
    const dotUpCompositeInnerDark = createSvgElement('feComposite');
    dotUpCompositeInnerDark.setAttribute('in2', 'hardAlpha');
    dotUpCompositeInnerDark.setAttribute('operator', 'arithmetic');
    dotUpCompositeInnerDark.setAttribute('k2', '-1');
    dotUpCompositeInnerDark.setAttribute('k3', '1');
    const dotUpColorInnerDark = createSvgElement('feColorMatrix');
    dotUpColorInnerDark.setAttribute('type', 'matrix');
    dotUpColorInnerDark.setAttribute('values', '0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.17 0');
    const dotUpBlendInnerDark = createSvgElement('feBlend');
    dotUpBlendInnerDark.setAttribute('mode', 'normal');
    dotUpBlendInnerDark.setAttribute('in2', 'shape');
    dotUpBlendInnerDark.setAttribute('result', 'effect3_innerShadow');

    const dotUpAlphaInnerLight = createSvgElement('feColorMatrix');
    dotUpAlphaInnerLight.setAttribute('in', 'SourceAlpha');
    dotUpAlphaInnerLight.setAttribute('type', 'matrix');
    dotUpAlphaInnerLight.setAttribute('values', '0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0');
    dotUpAlphaInnerLight.setAttribute('result', 'hardAlpha');
    const dotUpOffsetInnerLight = createSvgElement('feOffset');
    dotUpOffsetInnerLight.setAttribute('dx', '2');
    dotUpOffsetInnerLight.setAttribute('dy', '2');
    const dotUpBlurInnerLight = createSvgElement('feGaussianBlur');
    dotUpBlurInnerLight.setAttribute('stdDeviation', '1');
    const dotUpCompositeInnerLight = createSvgElement('feComposite');
    dotUpCompositeInnerLight.setAttribute('in2', 'hardAlpha');
    dotUpCompositeInnerLight.setAttribute('operator', 'arithmetic');
    dotUpCompositeInnerLight.setAttribute('k2', '-1');
    dotUpCompositeInnerLight.setAttribute('k3', '1');
    const dotUpColorInnerLight = createSvgElement('feColorMatrix');
    dotUpColorInnerLight.setAttribute('type', 'matrix');
    dotUpColorInnerLight.setAttribute('values', '0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 0.17 0');
    const dotUpBlendInnerLight = createSvgElement('feBlend');
    dotUpBlendInnerLight.setAttribute('mode', 'color-dodge');
    dotUpBlendInnerLight.setAttribute('in2', 'effect3_innerShadow');
    dotUpBlendInnerLight.setAttribute('result', 'effect4_innerShadow');

    dotUpFilter.appendChild(dotUpFlood);
    dotUpFilter.appendChild(dotUpAlphaDark);
    dotUpFilter.appendChild(dotUpOffsetDark);
    dotUpFilter.appendChild(dotUpBlurDark);
    dotUpFilter.appendChild(dotUpCompositeDark);
    dotUpFilter.appendChild(dotUpColorDark);
    dotUpFilter.appendChild(dotUpBlendDark);
    dotUpFilter.appendChild(dotUpAlphaLight);
    dotUpFilter.appendChild(dotUpOffsetLight);
    dotUpFilter.appendChild(dotUpBlurLight);
    dotUpFilter.appendChild(dotUpCompositeLight);
    dotUpFilter.appendChild(dotUpColorLight);
    dotUpFilter.appendChild(dotUpBlendLight);
    dotUpFilter.appendChild(dotUpBlendShape);
    dotUpFilter.appendChild(dotUpAlphaInnerDark);
    dotUpFilter.appendChild(dotUpOffsetInnerDark);
    dotUpFilter.appendChild(dotUpBlurInnerDark);
    dotUpFilter.appendChild(dotUpCompositeInnerDark);
    dotUpFilter.appendChild(dotUpColorInnerDark);
    dotUpFilter.appendChild(dotUpBlendInnerDark);
    dotUpFilter.appendChild(dotUpAlphaInnerLight);
    dotUpFilter.appendChild(dotUpOffsetInnerLight);
    dotUpFilter.appendChild(dotUpBlurInnerLight);
    dotUpFilter.appendChild(dotUpCompositeInnerLight);
    dotUpFilter.appendChild(dotUpColorInnerLight);
    dotUpFilter.appendChild(dotUpBlendInnerLight);
    defs.appendChild(dotUpFilter);

    // Neumorphic "down" filter for zone dot buttons.
    const dotDownFilter = createSvgElement('filter');
    dotDownFilter.setAttribute('id', 'ert-inquiry-zone-dot-down');
    dotDownFilter.setAttribute('x', '-50%');
    dotDownFilter.setAttribute('y', '-50%');
    dotDownFilter.setAttribute('width', '200%');
    dotDownFilter.setAttribute('height', '200%');
    dotDownFilter.setAttribute('color-interpolation-filters', 'sRGB');

    const dotDownOffsetDark = createSvgElement('feOffset');
    dotDownOffsetDark.setAttribute('in', 'SourceAlpha');
    dotDownOffsetDark.setAttribute('dx', '3.2');
    dotDownOffsetDark.setAttribute('dy', '3.2');
    dotDownOffsetDark.setAttribute('result', 'dot-down-offset-dark');
    const dotDownBlurDark = createSvgElement('feGaussianBlur');
    dotDownBlurDark.setAttribute('in', 'dot-down-offset-dark');
    dotDownBlurDark.setAttribute('stdDeviation', '2.4');
    dotDownBlurDark.setAttribute('result', 'dot-down-blur-dark');
    const dotDownCompositeDark = createSvgElement('feComposite');
    dotDownCompositeDark.setAttribute('in', 'dot-down-blur-dark');
    dotDownCompositeDark.setAttribute('in2', 'SourceAlpha');
    dotDownCompositeDark.setAttribute('operator', 'arithmetic');
    dotDownCompositeDark.setAttribute('k2', '-1');
    dotDownCompositeDark.setAttribute('k3', '1');
    dotDownCompositeDark.setAttribute('result', 'dot-down-inner-dark');
    const dotDownFloodDark = createSvgElement('feFlood');
    dotDownFloodDark.setAttribute('flood-color', '#000000');
    dotDownFloodDark.setAttribute('flood-opacity', '0.35');
    dotDownFloodDark.setAttribute('result', 'dot-down-flood-dark');
    const dotDownShadowDark = createSvgElement('feComposite');
    dotDownShadowDark.setAttribute('in', 'dot-down-flood-dark');
    dotDownShadowDark.setAttribute('in2', 'dot-down-inner-dark');
    dotDownShadowDark.setAttribute('operator', 'in');
    dotDownShadowDark.setAttribute('result', 'dot-down-shadow-dark');

    const dotDownOffsetLight = createSvgElement('feOffset');
    dotDownOffsetLight.setAttribute('in', 'SourceAlpha');
    dotDownOffsetLight.setAttribute('dx', '-3.2');
    dotDownOffsetLight.setAttribute('dy', '-3.2');
    dotDownOffsetLight.setAttribute('result', 'dot-down-offset-light');
    const dotDownBlurLight = createSvgElement('feGaussianBlur');
    dotDownBlurLight.setAttribute('in', 'dot-down-offset-light');
    dotDownBlurLight.setAttribute('stdDeviation', '2.4');
    dotDownBlurLight.setAttribute('result', 'dot-down-blur-light');
    const dotDownCompositeLight = createSvgElement('feComposite');
    dotDownCompositeLight.setAttribute('in', 'dot-down-blur-light');
    dotDownCompositeLight.setAttribute('in2', 'SourceAlpha');
    dotDownCompositeLight.setAttribute('operator', 'arithmetic');
    dotDownCompositeLight.setAttribute('k2', '-1');
    dotDownCompositeLight.setAttribute('k3', '1');
    dotDownCompositeLight.setAttribute('result', 'dot-down-inner-light');
    const dotDownFloodLight = createSvgElement('feFlood');
    dotDownFloodLight.setAttribute('flood-color', '#ffffff');
    dotDownFloodLight.setAttribute('flood-opacity', '0.22');
    dotDownFloodLight.setAttribute('result', 'dot-down-flood-light');
    const dotDownShadowLight = createSvgElement('feComposite');
    dotDownShadowLight.setAttribute('in', 'dot-down-flood-light');
    dotDownShadowLight.setAttribute('in2', 'dot-down-inner-light');
    dotDownShadowLight.setAttribute('operator', 'in');
    dotDownShadowLight.setAttribute('result', 'dot-down-shadow-light');

    const dotDownMerge = createSvgElement('feMerge');
    const dotDownMergeGraphic = createSvgElement('feMergeNode');
    dotDownMergeGraphic.setAttribute('in', 'SourceGraphic');
    const dotDownMergeDark = createSvgElement('feMergeNode');
    dotDownMergeDark.setAttribute('in', 'dot-down-shadow-dark');
    const dotDownMergeLight = createSvgElement('feMergeNode');
    dotDownMergeLight.setAttribute('in', 'dot-down-shadow-light');
    dotDownMerge.appendChild(dotDownMergeGraphic);
    dotDownMerge.appendChild(dotDownMergeDark);
    dotDownMerge.appendChild(dotDownMergeLight);

    dotDownFilter.appendChild(dotDownOffsetDark);
    dotDownFilter.appendChild(dotDownBlurDark);
    dotDownFilter.appendChild(dotDownCompositeDark);
    dotDownFilter.appendChild(dotDownFloodDark);
    dotDownFilter.appendChild(dotDownShadowDark);
    dotDownFilter.appendChild(dotDownOffsetLight);
    dotDownFilter.appendChild(dotDownBlurLight);
    dotDownFilter.appendChild(dotDownCompositeLight);
    dotDownFilter.appendChild(dotDownFloodLight);
    dotDownFilter.appendChild(dotDownShadowLight);
    dotDownFilter.appendChild(dotDownMerge);
    defs.appendChild(dotDownFilter);

    const backboneGradient = createSvgElement('linearGradient');
    backboneGradient.setAttribute('id', 'ert-inquiry-minimap-backbone-grad');
    backboneGradient.setAttribute('x1', '0%');
    backboneGradient.setAttribute('y1', '0%');
    backboneGradient.setAttribute('x2', '100%');
    backboneGradient.setAttribute('y2', '0%');
    const startColors = getBackboneStartColors(deps.styleSource);
    const gradientStart = startColors.gradient[0] ?? { r: 255, g: 153, b: 0 };
    const gradientMid = startColors.gradient[1] ?? { r: 255, g: 211, b: 106 };
    const gradientEnd = startColors.gradient[2] ?? { r: 255, g: 94, b: 0 };
    const backboneGradientStops = [
        createStop('0%', toRgbString(gradientStart)),
        createStop('50%', toRgbString(gradientMid)),
        createStop('100%', toRgbString(gradientEnd))
    ];
    backboneGradientStops.forEach(stop => backboneGradient.appendChild(stop));
    deps.minimap.setGradientStops(backboneGradientStops);
    defs.appendChild(backboneGradient);

    const backboneShine = createSvgElement('linearGradient');
    backboneShine.setAttribute('id', 'ert-inquiry-minimap-backbone-shine');
    backboneShine.setAttribute('x1', '0%');
    backboneShine.setAttribute('y1', '0%');
    backboneShine.setAttribute('x2', '100%');
    backboneShine.setAttribute('y2', '0%');
    const shineStart = startColors.shine[0] ?? { r: 255, g: 242, b: 207 };
    const shinePeak = startColors.shine[1] ?? { r: 255, g: 247, b: 234 };
    const shineWarm = startColors.shine[2] ?? { r: 255, g: 179, b: 77 };
    const shineEnd = startColors.shine[3] ?? { r: 255, g: 242, b: 207 };
    const backboneShineStops = [
        createStop('0%', toRgbString(shineStart), '0'),
        createStop('40%', toRgbString(shinePeak), '1'),
        createStop('60%', toRgbString(shineWarm), '0.9'),
        createStop('100%', toRgbString(shineEnd), '0')
    ];
    backboneShineStops.forEach(stop => backboneShine.appendChild(stop));
    deps.minimap.setShineStops(backboneShineStops);
    defs.appendChild(backboneShine);

    deps.minimap.initBackboneClip(defs);

    // Hatched pattern for cached portion overlay on token cap bar
    const cachedPattern = createSvgElement('pattern');
    cachedPattern.setAttribute('id', 'ert-inquiry-minimap-cached-hatch');
    cachedPattern.setAttribute('width', '8');
    cachedPattern.setAttribute('height', '8');
    cachedPattern.setAttribute('patternUnits', 'userSpaceOnUse');
    const hatchBg = createSvgElement('rect');
    hatchBg.setAttribute('x', '0');
    hatchBg.setAttribute('y', '0');
    hatchBg.setAttribute('width', '8');
    hatchBg.setAttribute('height', '8');
    hatchBg.classList.add('ert-inquiry-minimap-cached-hatch-bg');
    cachedPattern.appendChild(hatchBg);
    const hatchLine = createSvgElement('line');
    hatchLine.setAttribute('x1', '0');
    hatchLine.setAttribute('y1', '0');
    hatchLine.setAttribute('x2', '8');
    hatchLine.setAttribute('y2', '8');
    hatchLine.classList.add('ert-inquiry-minimap-cached-hatch-stroke');
    cachedPattern.appendChild(hatchLine);
    const hatchLineSecondary = createSvgElement('line');
    hatchLineSecondary.setAttribute('x1', '0');
    hatchLineSecondary.setAttribute('y1', '8');
    hatchLineSecondary.setAttribute('x2', '8');
    hatchLineSecondary.setAttribute('y2', '0');
    hatchLineSecondary.classList.add('ert-inquiry-minimap-cached-hatch-stroke');
    cachedPattern.appendChild(hatchLineSecondary);
    defs.appendChild(cachedPattern);
}

export function buildSceneDossierResources(defs: SVGDefsElement): void {
    if (defs.querySelector('#ert-inquiry-scene-dossier-focus-grad')) return;
    const gradient = createSvgElement('radialGradient');
    gradient.setAttribute('id', 'ert-inquiry-scene-dossier-focus-grad');
    gradient.setAttribute('cx', '50%');
    gradient.setAttribute('cy', '46%');
    gradient.setAttribute('fx', '50%');
    gradient.setAttribute('fy', '42%');
    gradient.setAttribute('r', '54%');
    ['0%', '32%', '70%', '100%'].forEach(offset => {
        const stop = createSvgElement('stop');
        stop.setAttribute('offset', offset);
        gradient.appendChild(stop);
    });
    defs.appendChild(gradient);
}
