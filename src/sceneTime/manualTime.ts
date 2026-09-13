import { maskNonProse, type SceneTimeScan, type TimeDecision } from './model';

const PREFIX = 'manual-selection-v1:';
export const manualTimeKey = (quote: string): string => PREFIX + JSON.stringify(quote);
export function manualTimeQuote(key: string): string | null {
    if (!key.startsWith(PREFIX)) return null;
    try {
        const quote: unknown = JSON.parse(key.slice(PREFIX.length));
        if (typeof quote !== 'string' || !quote.trim() || /[\r\n]/.test(quote)) throw new Error('Invalid manual scene time anchor.');
        return quote;
    } catch { throw new Error('Invalid manual scene time anchor.'); }
}

/** Exact unique prose selections survive surrounding edits; ambiguous anchors never transfer. */
export function attachManualTimes(source: string, scan: SceneTimeScan, decisions: Record<string, TimeDecision>): string[] {
    const prose = maskNonProse(source);
    const detached: string[] = [];
    for (const key of Object.keys(decisions)) {
        const quote = manualTimeQuote(key);
        if (quote === null) continue;
        const from = prose.indexOf(quote);
        const to = from + quote.length;
        if (from < 0 || prose.indexOf(quote, from + 1) >= 0
            || scan.cues.some(cue => cue.from < to && cue.to > from)) {
            detached.push(key);
            continue;
        }
        const start = source.lastIndexOf('\n', from - 1) + 1;
        const end = source.indexOf('\n', to);
        scan.cues.push({ key, from, to, quote, line: source.slice(0, from).split('\n').length - 1,
            context: source.slice(start, end < 0 ? source.length : end), contextOffset: from - start,
            kind: 'manual', suggestedMinutes: decisions[key].minutes, duplicate: false });
    }
    scan.cues.sort((a, b) => a.from - b.from);
    return detached;
}
