import { parseDuration } from '../utils/date';

export type CueKind = 'advance' | 'checkpoint' | 'clock' | 'uncertain' | 'backward';
export type TimeDecision = { action: 'add' | 'checkpoint' | 'exclude'; minutes: number };
export interface TimeCue {
    key: string;
    from: number;
    to: number;
    line: number;
    quote: string;
    context: string;
    contextOffset: number;
    kind: CueKind;
    suggestedMinutes: number | null;
    duplicate: boolean;
}
export interface SceneTimeScan {
    cues: TimeCue[];
    firstLine: number;
    lastLine: number;
    proseLines: Set<number>;
}
export interface ResolvedCue extends TimeCue {
    decision?: TimeDecision;
    elapsed: number;
    conflict: boolean;
}
export interface SceneTimeSnapshot extends SceneTimeScan {
    cues: ResolvedCue[];
    elapsed: number;
    confirmed: number;
    pending: number;
    conflict: boolean;
}

const NUMBER = '(?:\\d+(?:\\.\\d+)?|an?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|half an?)';
const SPAN = `${NUMBER}\\s+(?:seconds?|minutes?|hours?|days?|weeks?)`;
const numberWords: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };

function minutesFromSpan(text: string): number | null {
    const normalized = text.toLowerCase().replace(/half an?\b/, '0.5').replace(/\b[a-z]+\b/, word => word in numberWords ? String(numberWords[word]) : word);
    const ms = parseDuration(normalized);
    return ms !== null && Number.isFinite(ms) ? ms / 60000 : null;
}

/** Offset-preserving mask: metadata, comments, code, links and headings are not narrative evidence. */
export function maskNonProse(source: string): string {
    const blank = (value: string): string => value.replace(/[^\n]/g, ' ');
    return source
        .replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, blank)
        .replace(/%%[\s\S]*?(?:%%|$)/g, blank)
        .replace(/<!--[\s\S]*?(?:-->|$)/g, blank)
        .replace(/^[ \t]*(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:^[ \t]*\1[^\n]*(?:\n|$)|(?![\s\S]))/gm, blank)
        .replace(/`[^`\n]*`/g, blank)
        .replace(/!\[\[[^\n]*?\]\]|!\[[^\n]*?\]\([^\n]*?\)/g, blank)
        .replace(/\[\[[^\n]*?\]\]|\[[^\n]*?\]\([^\n]*?\)/g, blank)
        .replace(/^\s*(?:#{1,6}\s+.*|[-*_]{3,}\s*|\[\^[^\]]+\]:.*)$/gm, blank);
}

/** Every occurrence is retained; detection proposes interpretations and never confirms them. */
export function scanSceneTime(source: string): SceneTimeScan {
    const text = maskNonProse(source);
    const lines = text.split('\n');
    const proseLines = new Set<number>();
    lines.forEach((line, index) => { if (line.trim()) proseLines.add(index); });
    const indices = Array.from(proseLines);
    const cues: TimeCue[] = [];
    const patterns: Array<{ regex: RegExp; kind: CueKind; span?: boolean }> = [
        { regex: new RegExp(`\\b(${SPAN})\\s+(?:(?:had|have|has)\\s+)?(?:passed|elapsed)\\s+since\\b`, 'gi'), kind: 'checkpoint', span: true },
        { regex: new RegExp(`\\b(${SPAN})\\s+(?:earlier|ago|before)\\b`, 'gi'), kind: 'backward', span: true },
        { regex: new RegExp(`\\b(${SPAN})\\s+(?:later|afterward|afterwards|on)\\b`, 'gi'), kind: 'advance', span: true },
        { regex: new RegExp(`\\b(?:slept|sleeps?|sleeping|waited|waits?|waiting|walked|walks?|walking|travelled|traveled|rested|resting|climbed|climbs?|climbing)\\s+(?:for\\s+)?(${SPAN})\\b`, 'gi'), kind: 'advance', span: true },
        { regex: new RegExp(`\\b(?:for|in|after|another|within)\\s+(${SPAN})\\b`, 'gi'), kind: 'uncertain', span: true },
        { regex: /\b(?:a few|several|some|a couple of)\s+(?:seconds?|minutes?|hours?|days?)\s*(?:later)?\b|\b(?:moments?|seconds?)\s+later\b|\b(?:the\s+)?(?:next|following)\s+(?:morning|evening|night|day|week)\b|\blater\s+that\s+(?:day|night|evening)\b/gi, kind: 'uncertain' },
        { regex: /\b(?:\d{1,2}:\d{2}(?:\s*[ap]\.?m\.?)?|\d{1,2}\s*[ap]\.?m\.?|(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+(?:o['’]clock|in the (?:morning|afternoon|evening)))\b|\b(?:midnight|noon|dawn|dusk|sunrise|sunset)\b/gi, kind: 'clock' },
        { regex: new RegExp(`\\b(${SPAN})\\b`, 'gi'), kind: 'uncertain', span: true }
    ];
    for (const pattern of patterns) {
        let match: RegExpExecArray | null;
        while ((match = pattern.regex.exec(text)) !== null) {
            const from = match.index;
            const to = from + match[0].length;
            if (cues.some(cue => cue.from < to && cue.to > from)) continue;
            const lineStart = source.lastIndexOf('\n', from - 1) + 1;
            const newline = source.indexOf('\n', to);
            const lineEnd = newline < 0 ? source.length : newline;
            let paragraphStart = lineStart;
            let paragraphEnd = lineEnd;
            while (paragraphStart > 0) {
                const previous = source.lastIndexOf('\n', paragraphStart - 2) + 1;
                if (!text.slice(previous, paragraphStart).trim()) break;
                paragraphStart = previous;
            }
            while (paragraphEnd < source.length) {
                const nextBreak = source.indexOf('\n', paragraphEnd + 1);
                const next = nextBreak < 0 ? source.length : nextBreak;
                if (!text.slice(paragraphEnd, next).trim()) break;
                paragraphEnd = next;
            }
            const context = source.slice(paragraphStart, paragraphEnd);
            cues.push({ key: JSON.stringify([context, from - paragraphStart, match[0]]), from, to,
                line: text.slice(0, from).split('\n').length - 1, quote: match[0], context, contextOffset: from - paragraphStart,
                kind: pattern.kind, suggestedMinutes: pattern.span ? minutesFromSpan(match[1]) : null, duplicate: false });
        }
    }
    const counts = new Map<string, number>();
    cues.forEach(cue => counts.set(cue.key, (counts.get(cue.key) || 0) + 1));
    cues.forEach(cue => { cue.duplicate = counts.get(cue.key)! > 1; });
    return { cues: cues.sort((a, b) => a.from - b.from), firstLine: indices.length ? indices[0] : -1,
        lastLine: indices.length ? indices[indices.length - 1] : -1, proseLines };
}

export function resolveSceneTime(scan: SceneTimeScan, decisions: Record<string, TimeDecision>): SceneTimeSnapshot {
    let elapsed = 0;
    let confirmed = 0;
    let pending = 0;
    let conflict = false;
    const cues = scan.cues.map(cue => {
        const decision = cue.duplicate ? undefined : decisions[cue.key];
        let cueConflict = false;
        if (!decision) pending++;
        else if (decision.action !== 'exclude') {
            confirmed++;
            if (decision.action === 'add') elapsed += decision.minutes;
            else if (decision.minutes < elapsed) { conflict = true; cueConflict = true; }
            else elapsed = decision.minutes;
        }
        return { ...cue, decision, elapsed, conflict: cueConflict };
    });
    return { ...scan, cues, elapsed, confirmed, pending, conflict };
}

export function elapsedLabel(minutes: number): string {
    const rounded = Math.round(minutes * 100) / 100;
    if (rounded < 1 && rounded > 0) return `${Math.round(minutes * 60)}s`;
    const hours = Math.floor(rounded / 60);
    const remainder = Math.round((rounded - hours * 60) * 100) / 100;
    return hours ? `${hours}h${remainder ? ` ${remainder}m` : ''}` : `${rounded}m`;
}

export function cueState(cue: ResolvedCue): string {
    if (cue.conflict) return 'conflict';
    if (cue.decision?.action === 'exclude') return 'excluded';
    if (cue.decision) return 'confirmed';
    if (cue.kind === 'backward') return 'backward';
    if (cue.kind === 'uncertain' || cue.kind === 'clock') return 'uncertain';
    return 'detected';
}

export function cueDescription(cue: ResolvedCue): string {
    const state = cueState(cue);
    if (state === 'conflict') return 'Checkpoint is earlier than the confirmed elapsed time. Review the sequence.';
    if (cue.decision?.action === 'exclude') return 'Excluded from elapsed time';
    if (cue.decision) return `${cue.decision.action === 'checkpoint' ? 'Checkpoint' : 'Advance'} ${elapsedLabel(cue.decision.minutes)} · Confirmed elapsed ${elapsedLabel(cue.elapsed)}`;
    return `${cue.kind === 'backward' ? 'Backward reference' : cue.kind === 'clock' ? 'Clock anchor' : cue.kind === 'checkpoint' ? 'Checkpoint candidate' : cue.kind === 'uncertain' ? 'Uncertain cue' : 'Advance candidate'}${cue.suggestedMinutes !== null ? ` · ${elapsedLabel(cue.suggestedMinutes)}` : ''} · Not confirmed`;
}
