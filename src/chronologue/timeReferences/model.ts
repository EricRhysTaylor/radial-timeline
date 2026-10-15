/** Author-owned time references; operational identity is derived, never written to YAML. */
export const TIME_REFERENCES_KEY = 'Time References';
export const REFERENCE_KINDS = ['enacted', 'recollection', 'mention', 'possibility'] as const;
export type ReferenceKind = typeof REFERENCE_KINDS[number];
export interface ReferenceDate {
    text: string;
    precision: 'year' | 'month' | 'day' | 'minute' | 'second';
    start: number;
    end: number;
}
export interface TimeReference {
    key: string;
    path: string;
    index: number;
    label: string;
    kind: ReferenceKind;
    when: ReferenceDate;
    end?: ReferenceDate;
    passage?: string;
}
export interface ReferenceProblem { index: number; reason: 'array' | 'entry' | 'label' | 'kind' | 'date' | 'range' | 'passage' }
export interface ReferenceSnapshot { references: TimeReference[]; problems: ReferenceProblem[] }

/** Strict local calendar parsing; bounds express precision rather than invented clock times. */
export function parseReferenceDate(value: unknown): ReferenceDate | null {
    if (typeof value !== 'string') return null;
    const text = value.trim();
    const match = /^(\d{4})(?:-(\d{1,2})(?:-(\d{1,2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2}))?)?)?)?$/.exec(text);
    if (!match) return null;
    const year = Number(match[1]), month = Number(match[2] ?? 1), day = Number(match[3] ?? 1);
    const hour = Number(match[4] ?? 0), minute = Number(match[5] ?? 0), second = Number(match[6] ?? 0);
    const date = new Date(0);
    date.setFullYear(year, month - 1, day);
    date.setHours(hour, minute, second, 0);
    const actual = [date.getFullYear(), date.getMonth() + 1, date.getDate(), date.getHours(), date.getMinutes(), date.getSeconds()];
    const expected = [year, month, day, hour, minute, second];
    if (!actual.every((component, index) => component === expected[index])) return null;
    const precision = match[6] ? 'second' : match[4] ? 'minute' : match[3] ? 'day' : match[2] ? 'month' : 'year';
    const end = new Date(date);
    switch (precision) {
        case 'year': end.setFullYear(year + 1); break;
        case 'month': end.setMonth(month); break;
        case 'day': end.setDate(day + 1); break;
        case 'minute': end.setMinutes(minute + 1); break;
        case 'second': end.setSeconds(second + 1); break;
    }
    return { text, precision, start: date.getTime(), end: end.getTime() };
}

export function readTimeReferences(raw: unknown, path: string): ReferenceSnapshot {
    const references: TimeReference[] = [], problems: ReferenceProblem[] = [];
    if (raw === undefined) return { references, problems };
    if (!Array.isArray(raw)) return { references, problems: [{ index: -1, reason: 'array' }] };
    raw.forEach((entry: unknown, index) => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) { problems.push({ index, reason: 'entry' }); return; }
        const value = entry as Record<string, unknown>; // SAFE: non-array object checked above.
        const when = parseReferenceDate(value.When);
        const end = value.End === undefined || value.End === '' ? undefined : parseReferenceDate(value.End);
        let reason: ReferenceProblem['reason'] | undefined;
        if (typeof value.Label !== 'string' || !value.Label.trim()) reason = 'label';
        else if (!REFERENCE_KINDS.some(kind => kind === value.Kind)) reason = 'kind';
        else if (!when || end === null) reason = 'date';
        else if (end && end.end <= when.start) reason = 'range';
        else if (value.Passage !== undefined && typeof value.Passage !== 'string') reason = 'passage';
        if (reason || !when) { problems.push({ index, reason: reason ?? 'date' }); return; }
        references.push({ key: JSON.stringify([path, index, { Label: value.Label, When: when.text, End: end?.text, Kind: value.Kind, Passage: value.Passage }]), path, index,
            label: String(value.Label).trim(), kind: value.Kind as ReferenceKind, // SAFE: enum membership checked above.
            when, end: end ?? undefined, passage: typeof value.Passage === 'string' ? value.Passage : undefined });
    });
    return { references, problems };
}

export function referenceDateLabel(reference: TimeReference): string {
    return reference.end ? `${reference.when.text} – ${reference.end.text}` : reference.when.text;
}

/** Repeated prose is ambiguous. Surrounding edits do not invalidate a unique exact excerpt. */
export function locateReferencePassage(body: string, passage: string): { from: number; to: number } | null {
    if (!passage.trim()) return null;
    const from = body.indexOf(passage);
    return from < 0 || body.indexOf(passage, from + 1) >= 0 ? null : { from, to: from + passage.length };
}
