import { compareManuscriptRows, type TimetableRow } from './timetableModel';

export interface SubplotCanvasNode {
    id: string;
    type: 'file' | 'group' | 'text';
    x: number; y: number; width: number; height: number;
    file?: string; label?: string; text?: string;
}
export interface SubplotCanvasEdge {
    id: string; fromNode: string; toNode: string;
    fromSide: 'right'; toSide: 'left';
}
export interface SubplotCanvasPlan {
    nodes: SubplotCanvasNode[];
    edges: SubplotCanvasEdge[];
    sceneCount: number;
    appearanceCount: number;
}

export type StoryRange = 'all' | 'beginning' | 'middle' | 'end';

export function storyRangeBounds(nodes: SubplotCanvasNode[], rows: TimetableRow[], act: number | null, subplot: string | null, range: StoryRange): { minX: number; minY: number; maxX: number; maxY: number } | null {
    if (range === 'all') return null;
    const selected = rows.filter(row => subplot === null || row.subplots.includes(subplot));
    const paths = new Set(storyRangeRows(selected, act, range).map(row => row.path));
    const cards = nodes.filter(node => node.type === 'file' && node.file && paths.has(node.file));
    if (!cards.length) return null;
    return {
        minX: Math.min(...cards.map(node => node.x)), minY: Math.min(...cards.map(node => node.y)),
        maxX: Math.max(...cards.map(node => node.x + node.width)), maxY: Math.max(...cards.map(node => node.y + node.height)),
    };
}

/** Slice narrative order before subplot filtering, so each third has a stable meaning. */
export function storyRangeRows(rows: TimetableRow[], act: number | null, range: StoryRange): TimetableRow[] {
    const ordered = rows.filter(row => row.kind === 'scene' && (act === null || row.act === act)).sort(compareManuscriptRows);
    if (range === 'all') return ordered;
    const part = range === 'beginning' ? 0 : range === 'middle' ? 1 : 2;
    return ordered.slice(Math.ceil(ordered.length * part / 3), Math.ceil(ordered.length * (part + 1) / 3));
}

/** Build continuous narrative lanes with one column per scene. */
export function planSubplotCanvas(rows: TimetableRow[], options: { act: number | null; subplot: string | null; range?: StoryRange }, id: () => string): SubplotCanvasPlan {
    const scenes = storyRangeRows(rows, options.act, options.range ?? 'all')
        .filter(row => options.subplot === null || row.subplots.includes(options.subplot));
    // A scene without a subplot still belongs on the map. Keep it in its own
    // lane rather than silently dropping it from the generated Canvas.
    const unassigned = Symbol('unassigned');
    const lanesFor = (row: TimetableRow): (string | symbol)[] => row.subplots.length ? row.subplots : [unassigned];
    const laneNames = [...new Set(scenes.flatMap(row => options.subplot ? [options.subplot] : lanesFor(row)))];
    const nodes: SubplotCanvasNode[] = [];
    const edges: SubplotCanvasEdge[] = [];
    const CARD_W = 300, CARD_H = 170, STEP_X = 350, STEP_Y = 300, LEFT = 36, TOP = 170;
    let appearanceCount = 0;
    const width = LEFT * 2 + Math.max(0, scenes.length - 1) * STEP_X + CARD_W;
    // A new heading marks each contiguous act, including repeated or unassigned acts.
    scenes.forEach((row, index) => {
        if (index > 0 && row.act === scenes[index - 1].act) return;
        nodes.push({ id: id(), type: 'text', x: LEFT + index * STEP_X, y: 0, width: CARD_W, height: 100,
            text: `**${row.act === null ? 'No act' : `Act ${row.act}`}**` });
    });
    laneNames.forEach((lane, laneIndex) => {
        const y = TOP + laneIndex * STEP_Y;
        nodes.push({ id: id(), type: 'group', x: 0, y, width, height: 220, label: lane === unassigned ? 'No subplot' : String(lane) });
        let previous: string | null = null;
        scenes.forEach((row, index) => {
            if (!lanesFor(row).includes(lane)) return;
            const nodeId = id();
            nodes.push({ id: nodeId, type: 'file', file: row.path, x: LEFT + index * STEP_X, y: y + 35, width: CARD_W, height: CARD_H });
            appearanceCount++;
            if (previous) edges.push({ id: id(), fromNode: previous, toNode: nodeId, fromSide: 'right', toSide: 'left' });
            previous = nodeId;
        });
    });
    // JSON Canvas renders nodes in array order. Groups must sit behind cards.
    return { nodes: [...nodes.filter(node => node.type !== 'file'), ...nodes.filter(node => node.type === 'file')], edges, sceneCount: scenes.length, appearanceCount };
}
