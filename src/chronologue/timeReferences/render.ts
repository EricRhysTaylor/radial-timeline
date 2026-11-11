import { t } from '../../i18n';
import type { TimelineItem } from '../../types';
import { escapeXml } from '../../utils/svg';
import { parseSceneTitle } from '../../utils/text';
import { makeSceneId } from '../../utils/numberSquareHelpers';
import type { PositionInfo } from '../../renderer/utils/SceneLayout';
import { REFERENCE_MARK, referenceConnector, referenceDateIdentity, referenceMarkReach, referenceRingGeometry, referenceSourceAnchor, type ReferenceSlot } from './layout';
import { parseReferenceDate, referenceDateLabel, type TimeReference } from './model';

// Lucide Activity, matching the single-line icon convention used by the timeline indicators.
const ACTIVITY_PATH = 'M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2';

/**
 * A reference reads as a callout: a line in the theme's text color from a hollow circle at the source scene to a
 * hollow arrowhead at the date. Every stroke rides on a casing in the background color, so it holds contrast over
 * any subplot fill (the source hue mixed with the text color fell to about 1:1 over pale fills). Colors live in
 * time-references.css.
 *
 * The arrowhead points along the timeline the way the date lies from its scene: counter-clockwise back in time,
 * clockwise forward. A date before the timeline's start or after its end (the Earlier and Later groups at the seam)
 * takes a double arrowhead. A mark whose references point both ways, or a date around the scene's own time, takes a
 * diamond: the two arrowheads joined.
 */
export type ReferenceDirection = 'back' | 'forward' | 'both';

const num = (value: number): number => Number(value.toFixed(2));
const cased = (tag: 'circle' | 'polygon', shapes: string[], cls: string): string =>
    shapes.map(shape => `<${tag} class="ert-time-reference-casing" ${shape}/>`).join('') + shapes.map(shape => `<${tag} class="${cls}" ${shape}/>`).join('');

/** The source scene's end of a callout: a hollow circle one size in radius, its core open on the scene. */
const sourceCircle = (x: number, y: number, size: number): string =>
    cased('circle', [`cx="${num(x)}" cy="${num(y)}" r="${num(size)}"`], 'ert-time-reference-source-mark');

/** The date's end of a callout, centered on (x, y) and oriented along the ring through it. */
function dateMark(x: number, y: number, size: number, direction: ReferenceDirection, double: boolean): string {
    const angle = Math.atan2(y, x);
    // Along the ring clockwise on screen (forward in time), and across it, outward.
    const along = [-Math.sin(angle), Math.cos(angle)], across = [Math.cos(angle), Math.sin(angle)];
    const at = (t: number, r: number) => `${num(x + along[0] * t + across[0] * r)},${num(y + along[1] * t + across[1] * r)}`;
    const half = size * REFERENCE_MARK.span / 2, length = size * REFERENCE_MARK.length, gap = size * REFERENCE_MARK.gap;
    let shapes: string[];
    if (direction === 'both') {
        shapes = [[at(length / 2, 0), at(0, half), at(-length / 2, 0), at(0, -half)].join(' ')];
    } else {
        const sign = direction === 'forward' ? 1 : -1;
        shapes = (double ? [-gap / 2, gap / 2] : [0]).map(shift => {
            const center = shift * sign;
            return [at(center - sign * length / 2, half), at(center + sign * length / 2, 0), at(center - sign * length / 2, -half)].join(' ');
        });
    }
    return `<g class="ert-time-reference-mark" data-direction="${direction}"${double ? ' data-beyond="true"' : ''}>${cased('polygon', shapes.map(points => `points="${points}"`), 'ert-time-reference-slice')}</g>`;
}

/** Where a reference's date lies from its own scene's time: wholly before it, wholly after it, or around it. */
export function referenceDirection(ref: TimeReference, scene: TimelineItem): ReferenceDirection {
    const own = parseReferenceDate(scene.rawFrontmatter?.When);
    const start = own?.start ?? (scene.when instanceof Date ? scene.when.getTime() : NaN);
    if (!Number.isFinite(start)) return 'both';
    const end = own?.end ?? start + 1;
    if ((ref.end?.end ?? ref.when.end) <= start) return 'back';
    if (ref.when.start >= end) return 'forward';
    return 'both';
}

/**
 * Text follows the ring baseline; reverse lower-half paths to keep labels upright. A centered label runs through
 * `radius` itself, its letters straddling it, so it lines up with a mark at that radius.
 */
function curvedReferenceLabel(id: string, radius: number, angle: number, gap: number, before: boolean, text: string, className: string, maxRadius: number, centered = false): string {
    const rotation = (angle * 180 / Math.PI + 450) % 360;
    const reversed = rotation > 90 && rotation < 270;
    const labelRadius = Math.min(radius + (reversed && !centered ? 14 : 0), maxRadius);
    const near = angle + (before ? -gap : gap) / labelRadius;
    const far = near + (before ? -1 : 1) * Math.PI / 2;
    const from = before !== reversed ? far : near;
    const to = before !== reversed ? near : far;
    const point = (a: number) => `${labelRadius * Math.cos(a)} ${labelRadius * Math.sin(a)}`;
    return `<defs><path id="${id}" d="M ${point(from)} A ${labelRadius} ${labelRadius} 0 0 ${reversed ? 0 : 1} ${point(to)}" fill="none"/></defs>
        <text class="${className}" text-anchor="${before !== reversed ? 'end' : 'start'}"${centered ? ' dominant-baseline="central"' : ''}><textPath href="#${id}" startOffset="${before !== reversed ? '100%' : '0%'}">${text}</textPath></text>`;
}

/** Reference buttons are overlays, deliberately outside scene IDs, counts and drag targets. */
export function renderTimeReferenceMarkers(items: TimelineItem[], positions: Map<number, PositionInfo>, slots: ReferenceSlot[],
    innerR: number, outerR: number, ring: number): string {
    const byPath = new Map(items.map((item, i) => [item.path, { item, position: positions.get(i), index: i }]));
    const thickness = outerR - innerR;
    const textRadiusLimit = innerR + thickness * .4;
    const { size, sourceSize, pitch, base, capacity } = referenceRingGeometry(innerR, outerR);
    let connectors = '', markers = '';
    // One source circle per scene, carrying every reference the scene declares across all its dates.
    const sources = new Map<string, { origin: { x: number; y: number }; radius: number; references: TimeReference[] }>();
    for (const [slotIndex, slot] of slots.entries()) {
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
            const sourceAnchor = referenceSourceAnchor(innerR, outerR, parent.position!, slots);
            const route = referenceConnector(slot, terminalRadius(index), sourceAnchor);
            const source = sources.get(path);
            if (source) source.references.push(...owned);
            else sources.set(path, { origin: route.origin, radius: sourceAnchor.radius, references: [...owned] });
            const routeAttrs = `${attrs(owned)} data-source-path="${escapeXml(encodeURIComponent(path))}" fill="none"`;
            // Each casing is painted first and carries the connector class, so selection and filtering treat it
            // exactly like the line on top of it.
            for (const casing of [' ert-time-reference-casing', '']) {
                connectors += `<path class="ert-time-reference-connector${casing}" ${routeAttrs} d="${route.path}"/>`;
                if (route.discontinuity) {
                    const { x, y, rotation } = route.discontinuity;
                    connectors += `<path class="ert-time-reference-connector ert-time-reference-break${casing}" ${routeAttrs} d="${ACTIVITY_PATH}" transform="translate(${x} ${y}) rotate(${rotation}) scale(.75) translate(-12 -12)"/>`;
                }
            }
        }
        const offRange = slot.extent === 'earlier' || slot.extent === 'later';
        const extentLabel = slot.extent === 'within' ? '' : t(`timeReferences.${slot.extent}`);
        const dateLabel = dateCount > 1 ? t('timeReferences.dateCount', { count: dateCount }) : referenceDateLabel(refs[0]);
        const reach = referenceMarkReach(size);
        const button = (choices: TimeReference[], radius: number, overflow: boolean, showRange = false): string => {
            const x = radius * Math.cos(slot.angle), y = radius * Math.sin(slot.angle);
            const directions = new Set(choices.map(ref => referenceDirection(ref, byPath.get(ref.path)!.item)));
            const direction: ReferenceDirection = slot.extent === 'earlier' ? 'back' : slot.extent === 'later' ? 'forward'
                : directions.size === 1 ? [...directions][0] : 'both';
            // The marker's popover (interactions.ts) shows the references; the description is its plain-text twin.
            const heading = extentLabel ? `${extentLabel} · ${dateLabel}` : dateLabel;
            const title = escapeXml([heading, ...choices.map(ref => `${ref.label}, ${referenceDateLabel(ref)}, ${t(`timeReferences.kinds.${ref.kind}`)}`)].join('. '));
            const parent = byPath.get(choices[0].path)!;
            const labelId = `ert-reference-date-${slotIndex}-${makeSceneId(parent.item.bookIndex ?? 0, ring, parent.index, true, true, choices[0].path)}`;
            // The Earlier and Later label sits level with its mark, on the side away from the seam, where the route
            // (which arrives across the seam) never runs (Eric, 2026-11-10: line it up with the line and arrows).
            const rangeLabel = showRange ? `<g class="ert-time-reference-label">${curvedReferenceLabel(labelId, radius, slot.angle, reach + 8, slot.extent === 'earlier', escapeXml(heading), 'ert-time-reference-range', textRadiusLimit, true)}</g>` : '';
            const mixedX = x + (slot.extent === 'earlier' ? -(reach + 6) : reach + 6);
            const hit = Math.max(10, reach);
            const bookIndex = items[0]?.bookIndex ?? 0; // SAFE: a single-book timeline leaves bookIndex unset; it is book 0
            return `<g class="ert-time-reference" ${attrs(choices)} data-extent="${slot.extent}" data-reference-slot="${ring}-${bookIndex}-${slotIndex}" data-reference-x="${x}" data-reference-y="${y}"${overflow ? ' data-reference-overflow="true"' : ''}${slot.clipped ? ' data-clipped="true"' : ''} role="button" tabindex="0"><desc>${title}</desc>
                <rect class="ert-time-reference-hit" x="${num(x - hit)}" y="${num(y - hit)}" width="${num(2 * hit)}" height="${num(2 * hit)}" fill="transparent"/>
                ${overflow ? curvedReferenceLabel(`${labelId}-overflow`, radius, slot.angle, size / 2 + 12, slot.extent === 'earlier', `+${choices.length}`, 'ert-time-reference-count', textRadiusLimit) : dateMark(x, y, size, direction, slot.extent === 'earlier' || slot.extent === 'later')}
                ${rangeLabel}
                ${mixed && !overflow && !showRange ? `<text class="ert-time-reference-count" x="${mixedX}" y="${y + 4}" text-anchor="${slot.extent === 'earlier' ? 'end' : 'start'}">${refs.length}</text>` : ''}</g>`;
        };
        shown.forEach((choices, index) => { markers += button(choices, terminalRadius(index), false, offRange && index === 0); });
        if (!mixed && refs.length > shown.length) markers += button(refs.slice(shown.length), terminalRadius(0), true);
    }
    // A source circle is a button too: hovering it shows all of its scene's routes at once (interactions.ts).
    let origins = '';
    for (const [path, { origin, radius, references }] of sources) {
        const parent = byPath.get(path)!;
        const { text, number } = parseSceneTitle(parent.item.title || '', parent.item.number);
        const sourceLabel = [escapeXml(number), text].filter(Boolean).join(' · ');
        const angle = Math.atan2(origin.y, origin.x);
        const labelId = `ert-reference-source-${makeSceneId(parent.item.bookIndex ?? 0, ring, parent.index, true, true, path)}`; // SAFE: a single-book timeline leaves bookIndex unset; it is book 0
        const hit = Math.max(10, size + 4);
        // In the order the author declared them, as the Timetable lists them.
        const keys = [...references].sort((a, b) => a.index - b.index).map(ref => ref.key);
        origins += `<g class="ert-time-reference-origin" data-reference-keys="${escapeXml(JSON.stringify(keys))}" data-ring="${ring}" data-source-path="${escapeXml(encodeURIComponent(path))}" role="button" tabindex="0"><desc>${sourceLabel}</desc>
            <circle class="ert-time-reference-hit" cx="${num(origin.x)}" cy="${num(origin.y)}" r="${num(hit)}" fill="transparent"/>
            ${sourceCircle(origin.x, origin.y, size)}
            ${curvedReferenceLabel(labelId, radius + size, angle, sourceSize / 2 + 12, true, sourceLabel, 'ert-time-reference-origin-label', textRadiusLimit)}</g>`;
    }
    return connectors + markers + origins;
}
