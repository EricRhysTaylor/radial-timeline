export const INQUIRY_BRIEF_LINK_TOKEN = '[[Inquiry Brief —';
export const INQUIRY_BRIEF_ID_TOKEN_RE = /\[\[IB-\d{6}-\d{4}/;

export interface PendingEditsValidationResult {
    ok: boolean;
    text: string;
    newline: string;
    lines: string[];
    reason?: string;
}

export interface PendingEditsMutationResult {
    ok: boolean;
    value?: string;
    outcome?: 'written' | 'duplicate' | 'skipped';
    reason?: string;
}

export function normalizeInquiryLinkLine(line: string): string {
    if (!line) return line;
    return line
        .replace(/^\\?"(\[\[[^\]]+\]\])"\\?(\s+—?\s*)/, '$1$2')
        .replace(/^\\?"(\[\[[^\]]+\]\])"\\?$/, '$1');
}

export function isInquiryLine(line: string): boolean {
    return line.includes(INQUIRY_BRIEF_LINK_TOKEN) || INQUIRY_BRIEF_ID_TOKEN_RE.test(line);
}

const INQUIRY_MARKER_REGEX =
    /^(\[\[(?:IB-\d{6}-\d{4}(?:-[A-Za-z0-9]+)?|Inquiry Brief — [^\]|]+)(?:\|[^\]]+)?\]\])(?:\s+(?:—\s+)?.+)?$/;

function extractInquiryMarker(line: string): string | null {
    const normalized = normalizeInquiryLinkLine(line).trim();
    const match = normalized.match(INQUIRY_MARKER_REGEX);
    return match?.[1] ?? null;
}

export function validatePendingEditsValue(rawValue: unknown): PendingEditsValidationResult {
    let text = '';
    if (rawValue === undefined || rawValue === null) {
        text = '';
    } else if (typeof rawValue === 'string') {
        text = rawValue;
    } else if (Array.isArray(rawValue)) {
        if (!rawValue.every((entry) => typeof entry === 'string')) {
            return {
                ok: false,
                text: '',
                newline: '\n',
                lines: [],
                reason: 'Pending Edits contains a non-string list value.'
            };
        }
        text = rawValue.join('\n');
    } else {
        return {
            ok: false,
            text: '',
            newline: '\n',
            lines: [],
            reason: 'Pending Edits is not stored as text.'
        };
    }

    const newline = text.includes('\r\n') ? '\r\n' : '\n';
    const lines = text === '' ? [] : text.split(/\r?\n/);
    const inquiryMarkers = new Map<string, number>();

    for (const line of lines) {
        if (!isInquiryLine(line)) continue;
        const marker = extractInquiryMarker(line);
        if (!marker) {
            return {
                ok: false,
                text,
                newline,
                lines,
                reason: 'Pending Edits contains malformed Inquiry lines.'
            };
        }
        inquiryMarkers.set(marker, (inquiryMarkers.get(marker) ?? 0) + 1);
    }

    if ([...inquiryMarkers.values()].some((count) => count > 1)) {
        return {
            ok: false,
            text,
            newline,
            lines,
            reason: 'Pending Edits contains duplicate Inquiry markers.'
        };
    }

    return {
        ok: true,
        text,
        newline,
        lines,
    };
}

export function appendInquiryNotesToPendingEdits(
    rawValue: unknown,
    briefMarker: string,
    notes: string[],
    maxInquiryLines: number
): PendingEditsMutationResult {
    if (!notes.length) {
        return { ok: true, outcome: 'skipped', value: typeof rawValue === 'string' ? rawValue : '' };
    }

    const validated = validatePendingEditsValue(rawValue);
    if (!validated.ok) {
        return { ok: false, reason: validated.reason };
    }

    const briefLinkNeedle = `[[${briefMarker}`;
    const normalizedLines = validated.lines.map(line => normalizeInquiryLinkLine(line));
    const normalizedExisting = normalizedLines.some((line, index) => line !== validated.lines[index]);
    const inquiryIndices = normalizedLines.reduce<number[]>((acc, line, index) => {
        if (isInquiryLine(line)) acc.push(index);
        return acc;
    }, []);

    if (inquiryIndices.some(index => normalizedLines[index].includes(briefLinkNeedle))) {
        if (!normalizedExisting) {
            return { ok: true, outcome: 'duplicate', value: validated.text };
        }
        return {
            ok: true,
            outcome: 'written',
            value: normalizedLines.join(validated.newline)
        };
    }

    const nextNotes = notes.map(note => normalizeInquiryLinkLine(note));
    let nextLines = [...normalizedLines, ...nextNotes];
    const nextInquiryIndices = nextLines.reduce<number[]>((acc, line, index) => {
        if (isInquiryLine(line)) acc.push(index);
        return acc;
    }, []);
    if (nextInquiryIndices.length > maxInquiryLines) {
        const dropCount = nextInquiryIndices.length - maxInquiryLines;
        const dropIndices = new Set(nextInquiryIndices.slice(0, dropCount));
        nextLines = nextLines.filter((_, index) => !dropIndices.has(index));
    }

    return {
        ok: true,
        outcome: 'written',
        value: nextLines.join(validated.newline)
    };
}

export function purgeInquiryNotesFromPendingEdits(rawValue: unknown): PendingEditsMutationResult {
    const validated = validatePendingEditsValue(rawValue);
    if (!validated.ok) {
        return { ok: false, reason: validated.reason };
    }

    if (!validated.text.trim()) {
        return { ok: true, outcome: 'skipped', value: validated.text };
    }

    const filteredLines = validated.lines.filter(line => !isInquiryLine(line));
    if (filteredLines.length === validated.lines.length) {
        return { ok: true, outcome: 'skipped', value: validated.text };
    }

    return {
        ok: true,
        outcome: 'written',
        value: filteredLines.join(validated.newline).trim()
    };
}
