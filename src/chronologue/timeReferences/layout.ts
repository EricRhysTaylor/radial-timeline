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
    const radius = outerR - Math.min(12, (outerR - innerR) * .22);
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
        const angle = extent === 'earlier' ? startAngle - inset : extent === 'later' ? endAngle + inset
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

/** Concentric interior track, with a real gap and two slashes at an off-range seam. */
export function referenceConnector(innerR: number, outerR: number, source: PositionInfo, slot: ReferenceSlot, terminalRadius: number): { path: string; discontinuity?: string } {
    const thickness = outerR - innerR;
    const track = outerR - Math.min(12, thickness * .22);
    const from = source.endAngle - Math.min(18 / track, source.angularSize / 4);
    const sourceRadius = innerR + Math.min(9, thickness * .18);
    let path = `M ${point(sourceRadius, from)} L ${point(track, from)} `;
    const offRange = slot.extent === 'earlier' || slot.extent === 'later';
    let discontinuity: string | undefined;
    if (offRange) {
        const direction = slot.extent === 'later' ? 1 : -1;
        const halfGap = Math.min(5 / track, Math.abs(slot.angle - slot.seam) / 3);
        path += `${arc(track, from, slot.seam - direction * halfGap)} M ${point(track, slot.seam + direction * halfGap)} ${arc(track, slot.seam + direction * halfGap, slot.angle)}`;
        const x = track * Math.cos(slot.seam), y = track * Math.sin(slot.seam);
        const slashPoint = (tangent: number, radial: number): string => `${x - tangent * Math.sin(slot.seam) + radial * Math.cos(slot.seam)} ${y + tangent * Math.cos(slot.seam) + radial * Math.sin(slot.seam)}`;
        discontinuity = [-2, 2].map(offset => `M ${slashPoint(offset - 1, -3)} L ${slashPoint(offset + 1, 3)}`).join(' ');
    } else path += arc(track, from, slot.angle);
    path += ` L ${point(terminalRadius, slot.angle)}`;
    return { path, discontinuity };
}
