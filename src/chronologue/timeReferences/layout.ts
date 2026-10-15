import type { TimelineItem } from '../../types';
import { sceneKey } from '../../utils/sceneHelpers';
import type { PositionInfo } from '../../renderer/utils/SceneLayout';
import { readTimeReferences, TIME_REFERENCES_KEY, type TimeReference } from './model';

export interface ReferenceSlot extends PositionInfo { references: TimeReference[] }
export interface ReferenceLayout { positions: Map<number, PositionInfo>; slots: ReferenceSlot[] }

/** Reserve at most a quarter of the circle for references; density becomes explicit clusters. */
export function placeTimeReferences(items: TimelineItem[], primary: Map<number, PositionInfo>,
    innerR: number, outerR: number, startAngle: number, endAngle: number): ReferenceLayout {
    const seen = new Set<string>();
    const references = items.flatMap(item => {
        const key = sceneKey(item);
        if (!item.path || seen.has(key)) return [];
        seen.add(key);
        return readTimeReferences(item.rawFrontmatter?.[TIME_REFERENCES_KEY], item.path).references;
    }).sort((a, b) => a.when.start - b.when.start || a.path.localeCompare(b.path) || a.index - b.index);
    if (!references.length) return { positions: primary, slots: [] };
    const span = endAngle - startAngle;
    const slotWidth = 4 / ((innerR + outerR) / 2);
    const capacity = Math.max(1, Math.floor(span * .25 / slotWidth));
    const groupSize = Math.ceil(references.length / capacity);
    const groups: TimeReference[][] = [];
    for (let i = 0; i < references.length; i += groupSize) groups.push(references.slice(i, i + groupSize));
    const width = Math.min(slotWidth, span * .25 / groups.length);
    const before = new Map<number, TimeReference[][]>();
    groups.forEach(group => {
        const next = items.findIndex(item => item.when instanceof Date && item.when.getTime() > group[0].when.start);
        const index = next < 0 ? items.length : next;
        const bucket = before.get(index) ?? [];
        bucket.push(group); before.set(index, bucket);
    });
    const factor = (span - groups.length * width) / span;
    const positions = new Map<number, PositionInfo>(), slots: ReferenceSlot[] = [];
    let cursor = startAngle;
    for (let i = 0; i <= items.length; i++) {
        for (const group of before.get(i) ?? []) {
            slots.push({ startAngle: cursor, endAngle: cursor + width, angularSize: width, references: group });
            cursor += width;
        }
        const position = primary.get(i);
        if (position) {
            const angularSize = position.angularSize * factor;
            positions.set(i, { startAngle: cursor, endAngle: cursor + angularSize, angularSize }); cursor += angularSize;
        }
    }
    return { positions, slots };
}

export function bottomRadiusConnector(radius: number, from: number, to: number): string {
    if (!(radius > 0) || !Number.isFinite(from) || !Number.isFinite(to)) throw new Error('Invalid reference connector geometry');
    return `M ${radius * Math.cos(from)} ${radius * Math.sin(from)} A ${radius} ${radius} 0 ${Math.abs(to - from) > Math.PI ? 1 : 0} ${to >= from ? 1 : 0} ${radius * Math.cos(to)} ${radius * Math.sin(to)}`;
}
