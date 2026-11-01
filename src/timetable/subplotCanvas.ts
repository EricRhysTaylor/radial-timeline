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

/** Slice narrative order before subplot filtering, so each third has a stable meaning. */
export function storyRangeRows(rows: TimetableRow[], act: number | null, range: StoryRange): TimetableRow[] {
    const ordered = rows.filter(row => row.kind === 'scene' && (act === null || row.act === act)).sort(compareManuscriptRows);
    if (range === 'all') return ordered;
    const part = range === 'beginning' ? 0 : range === 'middle' ? 1 : 2;
    return ordered.slice(Math.ceil(ordered.length * part / 3), Math.ceil(ordered.length * (part + 1) / 3));
}

/** Build bounded narrative strips. A card's column is its position in the act,
 * so a scene on multiple lanes aligns vertically without duplicating its note. */
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
    const CARD_W = 300, CARD_H = 170, STEP_X = 350, STEP_Y = 300, LEFT = 36, TOP = 170, COLS = 8;
    let sectionY = 0;
    let appearanceCount = 0;
    const acts = [...new Set(scenes.map(row => row.act))];
    for (const act of acts) {
        const actScenes = scenes.filter(row => row.act === act);
        for (let start = 0; start < actScenes.length; start += COLS) {
            const segment = actScenes.slice(start, start + COLS);
            const lanes = laneNames.filter(lane => segment.some(row => lanesFor(row).includes(lane)));
            const width = LEFT * 2 + (segment.length - 1) * STEP_X + CARD_W;
            nodes.push({ id: id(), type: 'text', x: 0, y: sectionY, width: Math.max(width, 500), height: 115,
                text: `**${act === null ? 'No act' : `Act ${act}`} · ${options.range && options.range !== 'all' ? 'selected scenes' : 'scenes'} ${start + 1}–${start + segment.length} of ${actScenes.length}**\n\nLines show narrative order within each subplot.` });
            lanes.forEach((lane, laneIndex) => {
                const y = sectionY + TOP + laneIndex * STEP_Y;
                nodes.push({ id: id(), type: 'group', x: 0, y, width, height: 220, label: lane === unassigned ? 'No subplot' : String(lane) });
                let previous: string | null = null;
                segment.forEach((row, index) => {
                    if (!lanesFor(row).includes(lane)) return;
                    const nodeId = id();
                    nodes.push({ id: nodeId, type: 'file', file: row.path, x: LEFT + index * STEP_X, y: y + 35, width: CARD_W, height: CARD_H });
                    appearanceCount++;
                    if (previous) edges.push({ id: id(), fromNode: previous, toNode: nodeId, fromSide: 'right', toSide: 'left' });
                    previous = nodeId;
                });
            });
            sectionY += TOP + lanes.length * STEP_Y + 70;
        }
    }
    // JSON Canvas renders nodes in array order. Groups must sit behind cards.
    return { nodes: [...nodes.filter(node => node.type !== 'file'), ...nodes.filter(node => node.type === 'file')], edges, sceneCount: scenes.length, appearanceCount };
}
