import { orderBeatsByAct, parseBeatRow } from '../../../storyBeats/beatRows';
import { clampBeatAct, normalizeBeatTitle } from '../../../storyBeats/beatSystemStatus';
import { hasBeatReadableText } from '../../../utils/beatsInputNormalize';

export type ActGridBeat = { name: string; key: string };
export type ActGridColumn = { label: string; beats: ActGridBeat[]; rank: number; isNumericAct: boolean };

export const stripActPrefix = (name: string): string => {
    const m = name.match(/^Act\s*\d+\s*:\s*(.+)$/i);
    return m ? m[1].trim() : name.trim();
};

export const buildBeatActColumns = (definitions: readonly unknown[], maxActs: number): { columns: ActGridColumn[]; totalBeats: number } => {
    const beats = definitions.map(parseBeatRow).filter(b => hasBeatReadableText(b.name));
    const ordered = orderBeatsByAct(
        beats.map(b => ({ ...b, act: clampBeatAct(b.act, maxActs) })),
        maxActs
    );
    const grouped = new Map<string, ActGridColumn>();
    ordered.forEach((beatLine) => {
        const actNum = clampBeatAct(beatLine.act, maxActs);
        const key = `act:${actNum}`;
        if (!grouped.has(key)) {
            grouped.set(key, { label: `Act ${actNum}`, beats: [], rank: actNum, isNumericAct: true });
        }
        grouped.get(key)!.beats.push({
            name: stripActPrefix(beatLine.name),
            key: normalizeBeatTitle(beatLine.name)
        });
    });
    const columns = Array.from(grouped.values()).sort((a, b) => a.rank - b.rank);
    return { columns, totalBeats: ordered.length };
};

