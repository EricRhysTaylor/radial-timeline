import { t } from '../i18n';
import { safeTitle } from '../utils/noteTitle';
import { isStoryActHeading } from './canvasNavigation';

/** Canvas data is intentionally open: other plugins may add their own fields. */
export interface CanvasCard {
    id: string;
    type: string;
    text?: string;
    [key: string]: unknown;
}
export interface StoryCanvasData {
    nodes?: CanvasCard[];
    edges?: Array<{ fromNode: string; toNode: string; [key: string]: unknown }>;
    [key: string]: unknown;
}

/** A text card that carries writing: the only kind the sketch import reads. */
export type CanvasTextCard = CanvasCard & { text: string };

export function canvasTextCards(data: StoryCanvasData): CanvasTextCard[] {
    return (data.nodes ?? []).filter((node): node is CanvasTextCard => node.type === 'text' && !node.id.startsWith('acportal||') && typeof node.text === 'string' && node.text.trim().length > 0 && !isStoryActHeading(node.text)); // SAFE: canvas JSON may omit nodes; none = no text cards
}

export function sketchTitle(text: string): string {
    const line = text.split(/\r?\n/).find(part => part.trim()) ?? ''; // SAFE: an all-blank card yields '' and takes the new-sketch name below
    return safeTitle(line.replace(/^\s*#{1,6}\s+/, '').slice(0, 100)) || t('ui.timetable.newSketchName');
}

/** Give file cards new IDs, as Canvas requires when changing a node's type.
 * Repoint edges so the visual connections and edge metadata are preserved. */
export function linkSketches(data: StoryCanvasData, replacements: Map<string, { id: string; path: string }>): StoryCanvasData {
    return {
        ...data,
        nodes: data.nodes?.map(node => {
            const replacement = replacements.get(node.id);
            if (!replacement || node.type !== 'text') return node;
            const { text: _text, ...rest } = node;
            return { ...rest, id: replacement.id, type: 'file', file: replacement.path };
        }),
        edges: data.edges?.map(edge => ({
            ...edge,
            fromNode: replacements.get(edge.fromNode)?.id ?? edge.fromNode,
            toNode: replacements.get(edge.toNode)?.id ?? edge.toNode,
        })),
    };
}
