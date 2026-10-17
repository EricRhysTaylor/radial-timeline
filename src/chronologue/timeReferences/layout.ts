import type { TimelineItem } from '../../types';
import { isSceneItem, sceneKey } from '../../utils/sceneHelpers';
import type { PositionInfo } from '../../renderer/utils/SceneLayout';
import { parseReferenceDate, readTimeReferences, TIME_REFERENCES_KEY, type TimeReference } from './model';

export type ReferenceExtent = 'within' | 'earlier' | 'later' | 'unanchored';
export interface ReferenceDomain { start: number; end: number }
export interface ReferenceSlot {
    angle: number;
    extent: ReferenceExtent;
    seam: number;
    clipped: boolean;
    references: TimeReference[];
}
export interface ReferenceLayout { positions: Map<number, PositionInfo>; slots: ReferenceSlot[] }

/** Shared ring geometry keeps routes, stacked markers and seam labels in the scene interior. */
export function referenceRingGeometry(innerR: number, outerR: number) {
    const thickness = outerR - innerR;
    const size = Math.min(10, thickness * .16);
    const pitch = size + 6;
    const base = innerR + size / 2 + 4;
    return {
        track: innerR + thickness * .68,
        base, size, pitch,
        sourceSize: Math.min(16, thickness * .26),
        capacity: Math.max(1, Math.min(3, Math.floor((outerR - base - size / 2) / pitch))),
        seamOffset: Math.PI / 45,
    };
}

/** Precision bounds describe the primary When dates only, never reference dates. */
export function primaryReferenceDomain(items: TimelineItem[]): ReferenceDomain | undefined {
    const bounds = items.filter(isSceneItem).flatMap(item => {
        if (!(item.when instanceof Date) || !Number.isFinite(item.when.getTime())) return [];
        const declared = parseReferenceDate(item.rawFrontmatter?.When);
        if (declared) return [{ start: declared.start, end: declared.end }];
        const start = item.when.getTime();
        if (item.whenHasClock === false) {
            const day = new Date(start); day.setHours(0, 0, 0, 0);
            const next = new Date(day); next.setDate(next.getDate() + 1);
            return [{ start: day.getTime(), end: next.getTime() }];
        }
        return [{ start, end: start + 1 }];
    });
    return bounds.length ? { start: Math.min(...bounds.map(b => b.start)), end: Math.max(...bounds.map(b => b.end)) } : undefined;
}

export function referenceDateIdentity(ref: TimeReference): string { return ref.end ? `${ref.when.text}/${ref.end.text}` : ref.when.text; }

/** Overlay dates onto the existing scene geometry. Primary positions are never reallocated. */
export function placeTimeReferences(items: TimelineItem[], primary: Map<number, PositionInfo>,
    innerR: number, outerR: number, startAngle: number, endAngle: number,
    domain = primaryReferenceDomain(items)): ReferenceLayout {
    const seen = new Set<string>();
    const references = items.flatMap(item => {
        const key = sceneKey(item);
        if (!isSceneItem(item) || !item.path || seen.has(key)) return [];
        seen.add(key);
        return readTimeReferences(item.rawFrontmatter?.[TIME_REFERENCES_KEY], item.path).references;
    }).sort((a, b) => a.when.start - b.when.start || a.path.localeCompare(b.path) || a.index - b.index);
    const geometry = referenceRingGeometry(innerR, outerR);
    const radius = geometry.track;
    const inset = Math.min(18 / radius, (endAngle - startAngle) / 8);
    const anchors = items.flatMap((item, i) => {
        const position = primary.get(i);
        return isSceneItem(item) && position && item.when instanceof Date && Number.isFinite(item.when.getTime())
            ? [{ time: parseReferenceDate(item.rawFrontmatter?.When)?.start ?? item.when.getTime(), angle: position.endAngle - Math.min(inset, position.angularSize / 4) }] : [];
    }).sort((a, b) => a.time - b.time || a.angle - b.angle)
        .filter((anchor, i, all) => i === 0 || anchor.time !== all[i - 1].time);
    const angleAt = (time: number): number => {
        const right = anchors.findIndex(a => a.time >= time);
        if (right === 0) return anchors[0].angle;
        if (right === -1) return anchors[anchors.length - 1].angle;
        const a = anchors[right - 1], b = anchors[right];
        return a.angle + (b.angle - a.angle) * (time - a.time) / (b.time - a.time);
    };
    const slots: ReferenceSlot[] = [];
    for (const ref of references) {
        const finish = ref.end?.end ?? ref.when.end;
        let extent: ReferenceExtent = !domain ? 'unanchored' : finish <= domain.start ? 'earlier' : ref.when.start >= domain.end ? 'later' : 'within';
        if (extent === 'within' && !anchors.length) extent = 'unanchored';
        const parentIndex = items.findIndex(item => item.path === ref.path);
        const parent = primary.get(parentIndex);
        if (!parent) continue;
        const seamOffset = Math.min(geometry.seamOffset, (endAngle - startAngle) / 8);
        const angle = extent === 'earlier' ? startAngle - seamOffset : extent === 'later' ? endAngle + seamOffset
            : extent === 'unanchored' ? parent.endAngle - Math.min(inset, parent.angularSize / 4)
            : angleAt(Math.max(domain!.start, ref.when.start));
        const clipped = extent === 'within' && (ref.when.start < domain!.start || finish > domain!.end);
        const previous = slots.at(-1);
        // Dense dates and off-range dates remain explicit selectable clusters, never discarded.
        if (previous && previous.extent === extent && Math.abs(previous.angle - angle) < 14 / radius) {
            previous.references.push(ref); previous.clipped ||= clipped;
        } else slots.push({ angle, extent, seam: extent === 'later' ? endAngle : startAngle, clipped, references: [ref] });
    }
    return { positions: primary, slots };
}

function point(radius: number, angle: number): string { return `${radius * Math.cos(angle)} ${radius * Math.sin(angle)}`; }
function arc(radius: number, from: number, to: number): string {
    return `A ${radius} ${radius} 0 ${Math.abs(to - from) > Math.PI ? 1 : 0} ${to >= from ? 1 : 0} ${point(radius, to)}`;
}

/** Keep the master marker clear of date stacks without moving the dates or the scene. */
export function referenceSourceAnchor(innerR: number, outerR: number, source: PositionInfo, slots: ReferenceSlot[]): { angle: number; radius: number } {
    const { track, base, size, sourceSize } = referenceRingGeometry(innerR, outerR);
    const center = source.startAngle + source.angularSize / 2;
    // Both choices sit beside the center Question icon and inside this scene.
    const offset = Math.min(32 / track, source.angularSize / 4);
    const preferred = center + offset;
    const alternate = center - offset;
    const clearance = (angle: number) => slots.reduce((closest, slot) =>
        Math.min(closest, Math.abs(2 * base * Math.sin((angle - slot.angle) / 2))), Infinity);
    // Include the selected date's enlargement and the rotated square corners.
    const required = (sourceSize + size * 1.35) / Math.sqrt(2) + 4;
    const preferredClearance = clearance(preferred);
    if (preferredClearance >= required) return { angle: preferred, radius: base };
    // Clear the date-label baseline as well as the square stack. Stay in the
    // inner half of the source scene, below its title and beside its Question.
    return {
        angle: clearance(alternate) > preferredClearance ? alternate : preferred,
        radius: Math.min(base + sourceSize / 2 + 20, (innerR + outerR) / 2)
    };
}

/** Concentric interior track, with a real gap for the Lucide Activity seam mark. */
export function referenceConnector(innerR: number, outerR: number, slot: ReferenceSlot, terminalRadius: number, source: { angle: number; radius: number }): { path: string; origin: { x: number; y: number }; discontinuity?: { x: number; y: number; rotation: number } } {
    const { track } = referenceRingGeometry(innerR, outerR);
    const { angle: from, radius: sourceRadius } = source;
    let path = `M ${point(sourceRadius, from)} L ${point(track, from)} `;
    const offRange = slot.extent === 'earlier' || slot.extent === 'later';
    let discontinuity: { x: number; y: number; rotation: number } | undefined;
    if (offRange) {
        const direction = slot.extent === 'later' ? 1 : -1;
        const halfGap = Math.min(16 / track, Math.abs(slot.angle - slot.seam) / 3);
        path += `${arc(track, from, slot.seam - direction * halfGap)} M ${point(track, slot.seam + direction * halfGap)} ${arc(track, slot.seam + direction * halfGap, slot.angle)}`;
        discontinuity = { x: track * Math.cos(slot.seam), y: track * Math.sin(slot.seam), rotation: slot.seam * 180 / Math.PI + 90 };
    } else path += arc(track, from, slot.angle);
    path += ` L ${point(terminalRadius, slot.angle)}`;
    return { path, origin: { x: sourceRadius * Math.cos(from), y: sourceRadius * Math.sin(from) }, discontinuity };
}
