import type { CanvasCard, StoryCanvasData } from './canvasSketches';

export type CanvasLayoutProblem = 'laneChanged' | 'nextSceneMissing' | 'invalidCoordinates' | 'noScenePosition' | 'laneEdited' | 'cardEdited' | 'manualCardsInWay' | 'manualCardInLane' | 'connectionChanged';

const CANVAS_LAYOUT_MESSAGES: Record<CanvasLayoutProblem, string> = {
    laneChanged: 'The subplot lane has changed. Review the map before adding a scene.',
    nextSceneMissing: 'The next scene is missing from the map.',
    invalidCoordinates: 'A map card has invalid coordinates.',
    noScenePosition: 'The map has no scene position to insert after.',
    laneEdited: 'A generated subplot lane has been edited. Review the map before adding a scene.',
    cardEdited: 'A generated card has been edited. Review the map before adding a scene.',
    manualCardsInWay: 'Manual cards are in the way. Move them before adding this scene.',
    manualCardInLane: 'A manual card would become part of a subplot lane. Move it before adding this scene.',
    connectionChanged: 'The subplot connection has been changed. Review it before adding a scene.',
};

/** Why a scene card cannot be placed. The message is English for logs; the
 * modal shows the translated text for `problem`. */
export class CanvasLayoutError extends Error {
    constructor(readonly problem: CanvasLayoutProblem) {
        super(CANVAS_LAYOUT_MESSAGES[problem]);
        this.name = 'CanvasLayoutError';
    }
}

const canonical = (value: unknown): string => JSON.stringify(value, (_key, item: unknown) =>
    item && typeof item === 'object' && !Array.isArray(item)
        ? Object.fromEntries(Object.entries(item as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))) : item);

/** Make room only by shifting untouched generated nodes. The caller must show
 * the proposed changes and revalidate the full Canvas before applying them. */
export function insertCanvasSceneCard(current: StoryCanvasData, baseline: StoryCanvasData, options: {
    nodeId: string; edgeId: () => string; path: string; laneId: string; beforePath: string | null; vertical: boolean; keepHeading?: boolean;
}): { data: StoryCanvasData; baseline: StoryCanvasData } {
    const nodes = current.nodes ?? [];
    const originals = new Map((baseline.nodes ?? []).map(node => [node.id, node]));
    const axis = options.vertical ? 'y' : 'x';
    const length = options.vertical ? 'height' : 'width';
    const lane = nodes.find(node => node.id === options.laneId && node.type === 'group');
    if (!lane || canonical(lane) !== canonical(originals.get(lane.id))) throw new CanvasLayoutError('laneChanged');
    const cards = nodes.filter(node => node.type === 'file' && originals.get(node.id)?.type === 'file');
    const anchor = options.beforePath ? cards.find(node => node.file === options.beforePath) : undefined;
    if (options.beforePath && !anchor) throw new CanvasLayoutError('nextSceneMissing');
    const bounds = (node: CanvasCard, key: 'x' | 'y' | 'width' | 'height'): number => {
        const value = node[key];
        if (typeof value !== 'number' || !Number.isFinite(value)) throw new CanvasLayoutError('invalidCoordinates');
        return value;
    };
    const start = anchor ? bounds(anchor, axis) : Math.max(...cards.map(node => bounds(node, axis) + bounds(node, length))) + 50;
    if (!Number.isFinite(start)) throw new CanvasLayoutError('noScenePosition');
    const step = options.vertical ? 220 : 350;
    const transformed = nodes.map(node => {
        if (!originals.has(node.id)) return node;
        const original = originals.get(node.id)!;
        if (node.type === 'group') {
            if (canonical(node) !== canonical(original)) throw new CanvasLayoutError('laneEdited');
            return { ...node, [length]: bounds(node, length) + step };
        }
        if (bounds(node, axis) < start || (options.keepHeading && node.type === 'text' && typeof node.text === 'string' && /^\s*#\s*(?:act\b|no act\b)/i.test(node.text) && Math.abs(bounds(node, axis) - start) <= 110)) return node;
        if (canonical(node) !== canonical(original)) throw new CanvasLayoutError('cardEdited');
        return { ...node, [axis]: bounds(node, axis) + step };
    });
    const node: CanvasCard = options.vertical
        ? { id: options.nodeId, type: 'file', file: options.path, x: bounds(lane, 'x') + 30, y: start, width: 300, height: 170 }
        : { id: options.nodeId, type: 'file', file: options.path, x: start, y: bounds(lane, 'y') + 35, width: 300, height: 170 };
    const overlap = (a: CanvasCard, b: CanvasCard): boolean => bounds(a, 'x') < bounds(b, 'x') + bounds(b, 'width') && bounds(a, 'x') + bounds(a, 'width') > bounds(b, 'x')
        && bounds(a, 'y') < bounds(b, 'y') + bounds(b, 'height') && bounds(a, 'y') + bounds(a, 'height') > bounds(b, 'y');
    const manual = nodes.filter(item => !originals.has(item.id) && item.type !== 'group');
    const moved = transformed.filter(item => item.type !== 'group' && originals.has(item.id) && canonical(item) !== canonical(nodes.find(old => old.id === item.id)));
    if ([node, ...moved].some(item => manual.some(other => overlap(item, other)))) throw new CanvasLayoutError('manualCardsInWay');
    if (transformed.filter(item => item.type === 'group' && originals.has(item.id)).some(group => {
        const old = nodes.find(item => item.id === group.id)!;
        return manual.some(item => overlap(group, item) && !overlap(old, item));
    })) throw new CanvasLayoutError('manualCardInLane');
    const cross = options.vertical ? 'x' : 'y';
    const crossLength = options.vertical ? 'width' : 'height';
    const laneCards = cards.filter(item => bounds(item, cross) + bounds(item, crossLength) / 2 >= bounds(lane, cross)
        && bounds(item, cross) + bounds(item, crossLength) / 2 <= bounds(lane, cross) + bounds(lane, crossLength))
        .sort((a, b) => bounds(a, axis) - bounds(b, axis));
    const prev = laneCards.filter(item => bounds(item, axis) < start).at(-1);
    const next = laneCards.find(item => bounds(item, axis) >= start);
    const baselineEdges = new Map((baseline.edges ?? []).filter(edge => typeof edge.id === 'string').map(edge => [edge.id as string, edge]));
    let edges = [...(current.edges ?? [])];
    let generatedEdges = [...(baseline.edges ?? [])];
    const side = options.vertical ? { fromSide: 'bottom', toSide: 'top' } : { fromSide: 'right', toSide: 'left' };
    if (prev && next) {
        const between = edges.filter(edge => edge.fromNode === prev.id && edge.toNode === next.id);
        if (between.length !== 1 || typeof between[0].id !== 'string' || canonical(between[0]) !== canonical(baselineEdges.get(between[0].id))) {
            throw new CanvasLayoutError('connectionChanged');
        }
        const old = between[0];
        const first = { ...old, toNode: node.id };
        const second = { ...old, id: options.edgeId(), fromNode: node.id };
        edges = edges.flatMap(edge => edge === old ? [first, second] : [edge]);
        generatedEdges = generatedEdges.flatMap(edge => edge.id === old.id ? [first, second] : [edge]);
    } else if (prev || next) {
        const edge = { id: options.edgeId(), fromNode: prev?.id ?? node.id, toNode: next?.id ?? node.id, ...side };
        edges.push(edge); generatedEdges.push(edge);
    }
    const result = { ...current, nodes: [...transformed, node], edges };
    const changedGenerated = new Map(transformed.filter(item => originals.has(item.id)
        && canonical(item) !== canonical(nodes.find(old => old.id === item.id))).map(item => [item.id, item]));
    const generatedResult = { ...baseline, nodes: [...(baseline.nodes ?? []).map(item => changedGenerated.get(item.id) ?? item), node], edges: generatedEdges };
    return { data: result, baseline: generatedResult };
}
