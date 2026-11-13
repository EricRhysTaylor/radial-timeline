import type { CanvasCard, StoryCanvasData } from './canvasSketches';
import type { StoryMapScene } from './storyMapDiff';

type Point = { x: number; y: number };
type Rect = { x: number; y: number; width: number; height: number };
export type CanvasTextDropTarget =
    | { kind: 'sketch' }
    | { kind: 'scene'; laneId: string; subplot: string; after: string | null; before: string | null; act: number; actChoices: number[] }
    | { kind: 'ambiguous'; reason: CanvasDropProblem };

export type CanvasDropProblem = 'invalidPosition' | 'overlappingLanes' | 'unassignedLane' | 'splitScene' | 'noScenes' | 'outOfOrder' | 'hiddenScenes' | 'missingAct';

function rect(node: CanvasCard): Rect | null {
    const { x, y, width, height } = node;
    if (typeof x !== 'number' || typeof y !== 'number' || typeof width !== 'number' || typeof height !== 'number'
        || ![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return null;
    return { x, y, width, height };
}

/** Resolve a story-map drop without confusing author-created groups for lanes.
 * Missing scenes are allowed only when the visible neighbors identify one gap. */
export function planCanvasTextDrop(data: StoryCanvasData, generated: StoryCanvasData, scenes: readonly StoryMapScene[], point: Point, vertical: boolean): CanvasTextDropTarget {
    if (![point.x, point.y].every(Number.isFinite)) return { kind: 'ambiguous', reason: 'invalidPosition' };
    const generatedNodes = new Map((generated.nodes ?? []).map(node => [node.id, node]));
    const nodes = data.nodes ?? [];
    const lanes = nodes.filter(node => {
        const original = generatedNodes.get(node.id);
        const bounds = rect(node);
        return node.type === 'group' && original?.type === 'group' && bounds && point.x >= bounds.x && point.x <= bounds.x + bounds.width
            && point.y >= bounds.y && point.y <= bounds.y + bounds.height;
    });
    if (lanes.length === 0) return { kind: 'sketch' };
    if (lanes.length !== 1) return { kind: 'ambiguous', reason: 'overlappingLanes' };
    const lane = lanes[0];
    const original = generatedNodes.get(lane.id);
    if (typeof original?.label !== 'string' || !original.label || lane.label !== original.label || original.label === 'Story' || original.label === 'No subplot') {
        return { kind: 'ambiguous', reason: 'unassignedLane' };
    }
    // Each manuscript scene must have one unambiguous story-axis position.
    // A partial or manually rearranged map requires author review, not a guess.
    const axis = vertical ? 'y' : 'x';
    const positions = new Map<string, number[]>();
    for (const node of nodes) {
        const originalNode = generatedNodes.get(node.id);
        if (node.type !== 'file' || originalNode?.type !== 'file' || typeof node.file !== 'string' || node.file !== originalNode.file) continue;
        const bounds = rect(node);
        if (!bounds) continue;
        const value = bounds[axis] + (vertical ? bounds.height : bounds.width) / 2;
        const values = positions.get(node.file) ?? [];
        values.push(value); positions.set(node.file, values);
    }
    const ordered: { index: number; position: number }[] = [];
    for (const [index, scene] of scenes.entries()) {
        const values = positions.get(scene.path);
        if (!values?.length) continue;
        if (Math.max(...values) - Math.min(...values) > 1) return { kind: 'ambiguous', reason: 'splitScene' };
        ordered.push({ index, position: values[0] });
    }
    if (!ordered.length) return { kind: 'ambiguous', reason: 'noScenes' };
    if (ordered.some((value, i) => i > 0 && value.position <= ordered[i - 1].position)) return { kind: 'ambiguous', reason: 'outOfOrder' };
    const coordinate = point[axis];
    const nextVisible = ordered.findIndex(value => value.position > coordinate);
    const previous = nextVisible === -1 ? ordered.at(-1)!.index : nextVisible === 0 ? -1 : ordered[nextVisible - 1].index;
    const next = nextVisible === -1 ? scenes.length : ordered[nextVisible].index;
    if (next !== previous + 1) return { kind: 'ambiguous', reason: 'hiddenScenes' };
    const after = previous >= 0 ? scenes[previous] : undefined;
    const before = scenes[previous + 1];
    const acts = [...new Set([after?.act, before?.act].filter((act): act is number => typeof act === 'number'))];
    if (!acts.length || (after && after.act === null) || (before && before.act === null)) return { kind: 'ambiguous', reason: 'missingAct' };
    return { kind: 'scene', laneId: lane.id, subplot: original.label, after: after?.path ?? null, before: before?.path ?? null, act: acts[0], actChoices: acts };
}
