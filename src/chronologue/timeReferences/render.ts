import { t } from '../../i18n';
import type { TimelineItem } from '../../types';
import { escapeXml } from '../../utils/svg';
import { sceneArcPath } from '../../renderer/components/SceneArcs';
import type { PositionInfo } from '../../renderer/utils/SceneLayout';
import { bottomRadiusConnector, type ReferenceSlot } from './layout';
import { referenceDateLabel } from './model';

/** Reference groups deliberately do not carry scene classes or scene IDs. */
export function renderTimeReferenceSlices(items: TimelineItem[], positions: Map<number, PositionInfo>, slots: ReferenceSlot[],
    innerR: number, outerR: number, ring: number, colorOf: (item: TimelineItem) => string): string {
    const byPath = new Map(items.map((item, i) => [item.path, { item, position: positions.get(i) }]));
    let svg = '';
    for (const slot of slots) {
        const angle = (slot.startAngle + slot.endAngle) / 2;
        for (const ref of slot.references) {
            const parent = byPath.get(ref.path);
            if (!parent?.position) continue;
            const color = escapeXml(colorOf(parent.item));
            const attrs = `data-reference-key="${escapeXml(ref.key)}" data-source-path="${escapeXml(encodeURIComponent(ref.path))}" data-ring="${ring}"`;
            const source = (parent.position.startAngle + parent.position.endAngle) / 2;
            svg += `<path class="ert-time-reference-connector" ${attrs} d="${bottomRadiusConnector(innerR, source, angle)}" stroke="${color}" fill="none"/>`;
        }
        const parent = byPath.get(slot.references[0].path);
        if (!parent) continue;
        const keys = escapeXml(JSON.stringify(slot.references.map(ref => ref.key)));
        const details = slot.references.map(ref => `${ref.label} · ${referenceDateLabel(ref)} · ${t(`timeReferences.kinds.${ref.kind}`)} · ${t('timeReferences.earthCalendar')}`).join('\n');
        const title = escapeXml(slot.references.length > 1 ? `${t('timeReferences.cluster', { count: slot.references.length })}\n${details}` : details);
        const top = Math.min(outerR, innerR + 15);
        svg += `<g class="ert-time-reference" data-reference-keys="${keys}" data-ring="${ring}" role="button" tabindex="0" data-rt-tip="${title}"><title>${title}</title>
            <path class="ert-time-reference-slice" d="${sceneArcPath(innerR, top, slot.startAngle, slot.endAngle)}" fill="${escapeXml(colorOf(parent.item))}"/>
            <path class="ert-time-reference-hit" d="${sceneArcPath(innerR, top, slot.startAngle, slot.endAngle)}" fill="none" stroke="transparent" stroke-width="12"/>
            ${slot.references.length > 1 ? `<text class="ert-time-reference-count" x="${(top + 8) * Math.cos(angle)}" y="${(top + 8) * Math.sin(angle)}">${slot.references.length}</text>` : ''}</g>`;
    }
    return svg;
}
