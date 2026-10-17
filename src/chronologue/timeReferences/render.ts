import { t } from '../../i18n';
import type { TimelineItem } from '../../types';
import { escapeXml } from '../../utils/svg';
import type { PositionInfo } from '../../renderer/utils/SceneLayout';
import { referenceConnector, referenceDateIdentity, referenceRingGeometry, type ReferenceSlot } from './layout';
import { referenceDateLabel, type TimeReference } from './model';

/** Reference buttons are overlays, deliberately outside scene IDs, counts and drag targets. */
export function renderTimeReferenceMarkers(items: TimelineItem[], positions: Map<number, PositionInfo>, slots: ReferenceSlot[],
    innerR: number, outerR: number, ring: number, colorOf: (item: TimelineItem) => string): string {
    const byPath = new Map(items.map((item, i) => [item.path, { item, position: positions.get(i) }]));
    const thickness = outerR - innerR;
    const { size, pitch, base, capacity } = referenceRingGeometry(innerR, outerR);
    let connectors = '', markers = '';
    for (const slot of slots) {
        const refs = slot.references.filter(ref => byPath.get(ref.path)?.position);
        if (!refs.length) continue;
        const dateCount = new Set(refs.map(referenceDateIdentity)).size;
        const mixed = dateCount > 1 || (thickness < 50 && refs.length > 1);
        const shown = mixed ? [refs] : refs.slice(0, capacity).map(ref => [ref]);
        const attrs = (keys: TimeReference[]) => `data-reference-keys="${escapeXml(JSON.stringify(keys.map(ref => ref.key)))}" data-ring="${ring}"`;
        const terminalRadius = (index: number) => base + index * pitch;
        for (const path of new Set(refs.map(ref => ref.path))) {
            const owned = refs.filter(ref => ref.path === path), parent = byPath.get(path)!;
            const index = mixed ? 0 : Math.min(refs.findIndex(ref => ref.path === path), shown.length - 1);
            const route = referenceConnector(innerR, outerR, parent.position!, slot, terminalRadius(index));
            const routeAttrs = `${attrs(owned)} data-source-path="${escapeXml(encodeURIComponent(path))}" stroke="${escapeXml(colorOf(parent.item))}" fill="none"`;
            connectors += `<path class="ert-time-reference-connector ert-time-reference-halo" ${routeAttrs} d="${route.path}"/>
                <path class="ert-time-reference-connector" ${routeAttrs} d="${route.path}"/>`;
            if (route.discontinuity) connectors += `<path class="ert-time-reference-connector ert-time-reference-break ert-time-reference-halo" ${routeAttrs} d="${route.discontinuity}"/>
                <path class="ert-time-reference-connector ert-time-reference-break" ${routeAttrs} d="${route.discontinuity}"/>`;
        }
        const offRange = slot.extent === 'earlier' || slot.extent === 'later';
        const extentLabel = slot.extent === 'within' ? '' : t(`timeReferences.${slot.extent}`);
        const dateLabel = dateCount > 1 ? t('timeReferences.dateGroups', { count: dateCount }) : referenceDateLabel(refs[0]);
        const button = (choices: TimeReference[], radius: number, overflow: boolean, showRange = false): string => {
            const x = radius * Math.cos(slot.angle), y = radius * Math.sin(slot.angle);
            const detail = choices.map(ref => `${ref.label} · ${referenceDateLabel(ref)} · ${t(`timeReferences.kinds.${ref.kind}`)}`).join('\n');
            const title = escapeXml([extentLabel, dateCount > 1 ? dateLabel : '', slot.clipped ? t('timeReferences.overlapsRange') : '', detail, t('timeReferences.earthCalendar')].filter(Boolean).join('\n'));
            const rangeLabel = showRange ? `<text class="ert-time-reference-range" x="${x + (slot.extent === 'earlier' ? -(size / 2 + 12) : size / 2 + 12)}" y="${y + 5}" text-anchor="${slot.extent === 'earlier' ? 'end' : 'start'}">${escapeXml(`${extentLabel} · ${dateLabel}`)}</text>` : '';
            const color = escapeXml(colorOf(byPath.get(choices[0].path)!.item));
            return `<g class="ert-time-reference" ${attrs(choices)} data-extent="${slot.extent}" role="button" tabindex="0" data-rt-tip="${title}"><title>${title}</title>
                <rect class="ert-time-reference-hit" x="${x - 10}" y="${y - 10}" width="20" height="20" fill="transparent"/>
                ${overflow ? `<text class="ert-time-reference-count" x="${x}" y="${y + 4}">+${choices.length}</text>` : `<rect class="ert-time-reference-slice" x="${x - size / 2}" y="${y - size / 2}" width="${size}" height="${size}" fill="${color}"/>`}
                ${rangeLabel}
                ${mixed && !overflow ? `<text class="ert-time-reference-count" x="${x + size / 2 + 9}" y="${y + 4}">${refs.length}</text>` : ''}</g>`;
        };
        shown.forEach((choices, index) => { markers += button(choices, terminalRadius(index), false, offRange && index === 0); });
        if (!mixed && refs.length > shown.length) markers += button(refs.slice(shown.length), terminalRadius(shown.length), true);
    }
    return connectors + markers;
}
