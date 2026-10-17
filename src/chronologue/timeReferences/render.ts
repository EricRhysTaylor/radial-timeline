import { t } from '../../i18n';
import type { TimelineItem } from '../../types';
import { escapeXml } from '../../utils/svg';
import { parseSceneTitle } from '../../utils/text';
import type { PositionInfo } from '../../renderer/utils/SceneLayout';
import { referenceConnector, referenceDateIdentity, referenceRingGeometry, type ReferenceSlot } from './layout';
import { referenceDateLabel, type TimeReference } from './model';

// Lucide Activity, matching the single-line icon convention used by the timeline indicators.
const ACTIVITY_PATH = 'M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2';

/** Keep the source hue visible over a scene filled with that same subplot color. */
export function referenceMarkColor(sourceColor: string): string {
    return `color-mix(in srgb, ${sourceColor} 55%, var(--text-normal))`;
}

/** Reference buttons are overlays, deliberately outside scene IDs, counts and drag targets. */
export function renderTimeReferenceMarkers(items: TimelineItem[], positions: Map<number, PositionInfo>, slots: ReferenceSlot[],
    innerR: number, outerR: number, ring: number, colorOf: (item: TimelineItem) => string): string {
    const byPath = new Map(items.map((item, i) => [item.path, { item, position: positions.get(i) }]));
    const thickness = outerR - innerR;
    const { size, pitch, base, capacity } = referenceRingGeometry(innerR, outerR);
    let connectors = '', markers = '', origins = '';
    const sourcePaths = new Set<string>();
    for (const slot of slots) {
        const refs = slot.references.filter(ref => byPath.get(ref.path)?.position);
        if (!refs.length) continue;
        const dateCount = new Set(refs.map(referenceDateIdentity)).size;
        const mixed = dateCount > 1 || (thickness < 50 && refs.length > 1);
        const shown = mixed ? [refs] : refs.slice(0, capacity).map(ref => [ref]);
        const attrs = (keys: TimeReference[]) => `data-reference-keys="${escapeXml(JSON.stringify(keys.map(ref => ref.key)))}" data-ring="${ring}"`;
        // Only the Later side needs a small lift above the subplot dominance corner.
        const terminalRadius = (index: number) => base + index * pitch + (slot.extent === 'later' ? 6 : 0);
        for (const path of new Set(refs.map(ref => ref.path))) {
            const owned = refs.filter(ref => ref.path === path), parent = byPath.get(path)!;
            const index = mixed ? 0 : Math.min(refs.findIndex(ref => ref.path === path), shown.length - 1);
            const route = referenceConnector(innerR, outerR, parent.position!, slot, terminalRadius(index));
            if (!sourcePaths.has(path)) {
                sourcePaths.add(path);
                const { text, number } = parseSceneTitle(parent.item.title || '', parent.item.number);
                const sourceLabel = [escapeXml(number), text].filter(Boolean).join(' · ');
                const rotation = (Math.atan2(route.origin.y, route.origin.x) * 180 / Math.PI + 450) % 360;
                const flip = rotation > 90 && rotation < 270;
                origins += `<g class="ert-time-reference-origin" ${attrs(owned)} data-source-path="${escapeXml(encodeURIComponent(path))}" transform="translate(${route.origin.x} ${route.origin.y}) rotate(${rotation + (flip ? 180 : 0)})"><title>${sourceLabel}</title>
                    <circle r="4.5" fill="${escapeXml(referenceMarkColor(colorOf(parent.item)))}"/>
                    <text class="ert-time-reference-origin-label" x="${flip ? 12 : -12}" y="4" text-anchor="${flip ? 'start' : 'end'}">${sourceLabel}</text></g>`;
            }
            const routeAttrs = `${attrs(owned)} data-source-path="${escapeXml(encodeURIComponent(path))}" stroke="${escapeXml(referenceMarkColor(colorOf(parent.item)))}" fill="none"`;
            connectors += `<path class="ert-time-reference-connector" ${routeAttrs} d="${route.path}"/>`;
            if (route.discontinuity) {
                const { x, y, rotation } = route.discontinuity;
                connectors += `<path class="ert-time-reference-connector ert-time-reference-break" ${routeAttrs} d="${ACTIVITY_PATH}" transform="translate(${x} ${y}) rotate(${rotation}) scale(.75) translate(-12 -12)"/>`;
            }
        }
        const offRange = slot.extent === 'earlier' || slot.extent === 'later';
        const extentLabel = slot.extent === 'within' ? '' : t(`timeReferences.${slot.extent}`);
        const dateLabel = dateCount > 1 ? t('timeReferences.dateGroups', { count: dateCount }) : referenceDateLabel(refs[0]);
        const button = (choices: TimeReference[], radius: number, overflow: boolean, showRange = false): string => {
            const x = radius * Math.cos(slot.angle), y = radius * Math.sin(slot.angle);
            const detail = choices.map(ref => `${byPath.get(ref.path)!.item.title} · ${ref.label} · ${referenceDateLabel(ref)} · ${t(`timeReferences.kinds.${ref.kind}`)}`).join('\n');
            const title = escapeXml([extentLabel, dateCount > 1 ? dateLabel : '', slot.clipped ? t('timeReferences.overlapsRange') : '', detail, t('timeReferences.earthCalendar')].filter(Boolean).join('\n'));
            const rangeLabel = showRange ? `<text class="ert-time-reference-range" x="${x + (slot.extent === 'earlier' ? -(size / 2 + 12) : size / 2 + 12)}" y="${y + 5}" text-anchor="${slot.extent === 'earlier' ? 'end' : 'start'}">${escapeXml(`${extentLabel} · ${dateLabel}`)}</text>` : '';
            const countAnchor = slot.extent === 'earlier' ? 'end' : slot.extent === 'later' ? 'start' : 'middle';
            const overflowX = x + (slot.extent === 'earlier' ? size / 2 : slot.extent === 'later' ? -size / 2 : 0);
            const mixedX = x + (slot.extent === 'earlier' ? -(size / 2 + 6) : size / 2 + 6);
            const color = escapeXml(referenceMarkColor(colorOf(byPath.get(choices[0].path)!.item)));
            return `<g class="ert-time-reference" ${attrs(choices)} data-extent="${slot.extent}" role="button" tabindex="0" data-rt-tip="${title}"><title>${title}</title>
                <rect class="ert-time-reference-hit" x="${x - 10}" y="${y - 10}" width="20" height="20" fill="transparent"/>
                ${overflow ? `<text class="ert-time-reference-count" x="${overflowX}" y="${y + 4}" text-anchor="${countAnchor}">+${choices.length}</text>` : `<rect class="ert-time-reference-slice" x="${x - size / 2}" y="${y - size / 2}" width="${size}" height="${size}" fill="${color}"/>`}
                ${rangeLabel}
                ${mixed && !overflow ? `<text class="ert-time-reference-count" x="${mixedX}" y="${y + 4}" text-anchor="${slot.extent === 'earlier' ? 'end' : 'start'}">${refs.length}</text>` : ''}</g>`;
        };
        shown.forEach((choices, index) => { markers += button(choices, terminalRadius(index), false, offRange && index === 0); });
        if (!mixed && refs.length > shown.length) markers += button(refs.slice(shown.length), terminalRadius(shown.length), true);
    }
    return connectors + markers + origins;
}
