import { parseDuration, parseWhenField } from '../utils/date';

export type CueKind = 'advance' | 'checkpoint' | 'clock' | 'uncertain' | 'backward' | 'manual';
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
    /** Provisional running total after this cue; see SceneTimeSnapshot.estimated. */
    estimated: number;
    conflict: boolean;
    clockLabel?: string;
    clockEstimated?: boolean;
}
export interface SceneTimeSnapshot extends SceneTimeScan {
    cues: ResolvedCue[];
    elapsed: number;
    /** Provisional total: confirmed decisions plus the suggested durations of unconfirmed forward cues. */
    estimated: number;
    confirmed: number;
    pending: number;
    conflict: boolean;
    /** Declared YAML Duration measured against the provisional running total; null without a positive Duration. */
    duration: SceneDurationTrack | null;
}
export interface SceneDurationTrack {
    /** Declared duration in minutes. */
    planned: number;
    /** short: the prose's time cues never reach the declared duration; over: they pass it at `stop`. */
    status: 'short' | 'match' | 'over';
    /** First cue whose provisional running total passes the declared duration. */
    stop: { line: number; from: number } | null;
}
/** The stretch of the duration line beside prose lines first..last. */
export interface DurationSegment {
    status: SceneDurationTrack['status'];
    planned: number;
    /** Offset of the cue where the line stops, when that cue lies in this stretch. */
    stopFrom: number | null;
    /** Declared minutes the prose never reaches; set only beside the last prose line. */
    shortfall: number | null;
}

const ONES = 'one|two|three|four|five|six|seven|eight|nine';
const TENS = 'twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety';
const NUMBER = `(?:\\d+(?:\\.\\d+)?|(?:${TENS})(?:[ \\t\\-\u2010\u2011]+(?:${ONES}))?|zero|${ONES}|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|an?|half an?)`;
const SPAN = `${NUMBER}\\s+(?:seconds?|minutes?|hours?|days?|weeks?)`;
const numberWords: Record<string, number> = { a: 1, an: 1, zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
    thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
    twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const NUMBER_TAIL = new RegExp(`(?:${TENS}|hundred|thousand|million)(?:\\s+and)?[ \\t]+$`, 'i');

function minutesFromSpan(text: string): number | null {
    const match = /^(.*?)\s+(seconds?|minutes?|hours?|days?|weeks?)$/i.exec(text);
    if (!match) return null;
    const amount = match[1].toLowerCase();
    const parts = amount.split(/[\s\-\u2010\u2011]+/);
    const number = /^half an?$/.test(amount) ? 0.5
        : parts.every(part => part in numberWords) ? parts.reduce((sum, part) => sum + numberWords[part], 0) : Number(amount);
    if (!Number.isFinite(number)) return null;
    const ms = parseDuration(`${number} ${match[2]}`);
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
        // Bare “one day” usually introduces an unspecified occasion, not a 24-hour advance.
        // Explicit elapsed/context patterns above take precedence; measured predicates remain quantities.
        { regex: new RegExp(`\\b(?:takes?|took|lasts?|lasted|spends?|spent)\\s+(${SPAN})\\b`, 'gi'), kind: 'uncertain', span: true },
        { regex: /\bone\s+day\b/gi, kind: 'uncertain' },
        { regex: /\b(?:a few|several|some|a couple of)\s+(?:seconds?|minutes?|hours?|days?)\s*(?:later)?\b|\b(?:moments?|seconds?)\s+later\b|\b(?:the\s+)?(?:next|following)\s+(?:morning|evening|night|day|week)\b|\blater\s+that\s+(?:day|night|evening)\b/gi, kind: 'uncertain' },
        { regex: /\b(?:\d{1,2}:\d{2}(?:\s*[ap]\.?m\.?)?|\d{1,2}\s*[ap]\.?m\.?|(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+(?:o['’]clock|in the (?:morning|afternoon|evening)))\b|\b(?:midnight|noon|dawn|dusk|sunrise|sunset)\b/gi, kind: 'clock' },
        { regex: new RegExp(`\\b(${SPAN})\\b`, 'gi'), kind: 'uncertain', span: true }
    ];
    for (const pattern of patterns) {
        let match: RegExpExecArray | null;
        while ((match = pattern.regex.exec(text)) !== null) {
            const from = match.index;
            const to = from + match[0].length;
            // A word boundary also occurs inside a hyphenated number. Never accept its suffix.
            const before = text.slice(0, from);
            if (/[a-z0-9][-\u2010\u2011]$/i.test(before) || NUMBER_TAIL.test(before)) continue;
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

export function resolveSceneTime(scan: SceneTimeScan, decisions: Record<string, TimeDecision>, when?: unknown, duration?: unknown): SceneTimeSnapshot {
    let elapsed = 0;
    let estimate = 0;
    let confirmed = 0;
    let pending = 0;
    let conflict = false;
    const cues = scan.cues.map(cue => {
        const decision = cue.duplicate ? undefined : decisions[cue.key];
        let cueConflict = false;
        if (!decision) {
            pending++;
            // Unconfirmed cues only estimate; backward references never advance the scene.
            if (cue.suggestedMinutes !== null && cue.kind !== 'backward') {
                if (cue.kind === 'checkpoint') estimate = Math.max(estimate, cue.suggestedMinutes);
                else estimate += cue.suggestedMinutes;
            }
        } else if (decision.action !== 'exclude') {
            confirmed++;
            if (decision.action === 'add') { elapsed += decision.minutes; estimate += decision.minutes; }
            else if (decision.minutes < elapsed) { conflict = true; cueConflict = true; }
            else { elapsed = decision.minutes; estimate = Math.max(estimate, decision.minutes); }
        }
        return { ...cue, decision, elapsed, estimated: estimate, conflict: cueConflict };
    });
    const start = typeof when === 'string' && /\d:\d|\d\s*[ap]m\b/i.test(when) ? parseWhenField(when) : null;
    let clock = start ? start.getHours() * 60 + start.getMinutes() : null;
    const startMinutes = clock;
    let estimated = false;
    const timedCues = cues.map(cue => {
        let label: string | undefined;
        if (cue.decision?.action !== 'exclude' && cue.kind !== 'backward') {
            if (cue.decision?.action === 'checkpoint') {
                clock = startMinutes === null ? null : startMinutes + cue.decision.minutes;
                estimated = false;
            } else if (cue.decision?.action === 'add') {
                if (clock !== null) clock += cue.decision.minutes;
            } else if (cue.kind === 'clock') {
                clock = parseCueClock(cue.quote);
                estimated = true;
            } else if (cue.kind === 'advance' && cue.suggestedMinutes !== null) {
                if (clock !== null) clock += cue.suggestedMinutes;
                estimated = true;
            } else if (cue.kind === 'checkpoint' && cue.suggestedMinutes !== null) {
                clock = startMinutes === null ? null : startMinutes + cue.suggestedMinutes;
                estimated = true;
            } else estimated = true;
            if (clock !== null) label = formatCueClock(clock);
        }
        return { ...cue, clockLabel: label, clockEstimated: estimated || cue.conflict };
    });
    return { ...scan, cues: timedCues, elapsed, estimated: estimate, confirmed, pending, conflict, duration: durationTrack(cues, estimate, duration) };
}

const MINUTE_EPSILON = 1e-6;
/** The running total never decreases, so the first cue past the declared duration is where the line stops. */
function durationTrack(cues: ResolvedCue[], estimate: number, duration: unknown): SceneDurationTrack | null {
    const ms = typeof duration === 'string' ? parseDuration(duration) : null;
    if (ms === null || !(ms > 0)) return null;
    const planned = ms / 60000;
    const stop = cues.find(cue => cue.estimated > planned + MINUTE_EPSILON);
    return { planned, status: stop ? 'over' : estimate < planned - MINUTE_EPSILON ? 'short' : 'match',
        stop: stop ? { line: stop.line, from: stop.from } : null };
}

/** Null once the prose has already run past the declared duration before this stretch. */
export function durationSegment(snapshot: SceneTimeSnapshot, first: number, last: number): DurationSegment | null {
    const track = snapshot.duration;
    if (!track || (track.stop && track.stop.line < first)) return null;
    const holdsEnd = first <= snapshot.lastLine && snapshot.lastLine <= last;
    return { status: track.status, planned: track.planned,
        stopFrom: track.stop && track.stop.line <= last ? track.stop.from : null,
        shortfall: track.status === 'short' && holdsEnd ? track.planned - snapshot.estimated : null };
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
    if (cue.kind === 'manual') return 'manual';
    if (cue.decision) return 'confirmed';
    if (cue.kind === 'backward') return 'backward';
    if (cue.kind === 'uncertain' || cue.kind === 'clock') return 'uncertain';
    return 'detected';
}

export function cueDescription(cue: ResolvedCue): string {
    const state = cueState(cue);
    if (state === 'conflict') return 'Checkpoint is earlier than the confirmed elapsed time. Review the sequence.';
    if (cue.decision?.action === 'exclude') return 'Excluded from elapsed time';
    if (cue.kind === 'manual') return `Manually assigned ${elapsedLabel(cue.decision?.minutes ?? 0)} · Elapsed ${elapsedLabel(cue.elapsed)}`;
    if (cue.decision) return `${cue.decision.action === 'checkpoint' ? 'Checkpoint' : 'Advance'} ${elapsedLabel(cue.decision.minutes)} · Confirmed elapsed ${elapsedLabel(cue.elapsed)}`;
    return `${cue.kind === 'backward' ? 'Backward reference' : cue.kind === 'clock' ? 'Clock anchor' : cue.kind === 'checkpoint' ? 'Checkpoint candidate' : cue.kind === 'uncertain' ? 'Uncertain cue' : 'Advance candidate'}${cue.suggestedMinutes !== null ? ` · ${elapsedLabel(cue.suggestedMinutes)}` : ''} · Not confirmed`;
}

/** Clock anchors are explicit; dawn/dusk and bare twelve-hour clocks stay unquantified. */
function parseCueClock(quote: string): number | null {
    const text = quote.toLowerCase().replace(/\./g, '').trim();
    if (text === 'noon') return 720;
    if (text === 'midnight') return 0;
    const match = /^(\d{1,2})(?::(\d{2}))?\s*([ap]m)?$/.exec(text);
    if (!match) return null;
    const hour = Number(match[1]), minute = Number(match[2] || 0);
    if (minute > 59 || hour > 23 || (match[3] && (hour < 1 || hour > 12))) return null;
    if (!match[3] && hour <= 12) return null;
    return (match[3] ? hour % 12 + (match[3] === 'pm' ? 12 : 0) : hour) * 60 + minute;
}
function formatCueClock(minutes: number): string {
    const value = ((Math.round(minutes) % 1440) + 1440) % 1440;
    const hour = Math.floor(value / 60), minute = value % 60;
    return `${hour % 12 || 12}${minute ? `:${String(minute).padStart(2, '0')}` : ''}${hour < 12 ? 'am' : 'pm'}`;
}

/** Marker text describes this cue; inferred clock-of-day remains in its tooltip. */
export function cueMarkerLabel(cue: ResolvedCue): string | null {
    if (cue.kind === 'manual') return `[${elapsedLabel(cue.decision?.minutes ?? 0)}]`;
    if (cue.kind === 'clock') return cue.quote.trim().toLowerCase().replace(/(\d)\s*([ap])\.?m\.?$/i, '$1$2m');
    const minutes = cue.decision?.action !== 'exclude' && cue.decision ? cue.decision.minutes : cue.suggestedMinutes;
    if (minutes === null) return null;
    const prefix = cue.decision?.action === 'checkpoint' || (!cue.decision && cue.kind === 'checkpoint') ? '='
        : cue.kind === 'backward' && !cue.decision ? '−' : '+';
    return `${prefix}${elapsedLabel(minutes)}`;
}
