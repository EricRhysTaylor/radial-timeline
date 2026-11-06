/*
 * Text-level frontmatter editing.
 *
 * Obsidian's processFrontMatter reserializes the whole block, so one changed
 * field costs the author every YAML comment and hand formatting in the note.
 * These helpers change only the named fields and keep every other byte. Each
 * write is parsed again before it is returned: an edit that would leave broken
 * YAML throws, and the note stays as it was.
 */
import { isMap, isScalar, parseDocument, type Node } from 'yaml';
import { t } from '../i18n';

export interface FrontmatterField {
    key: string;
    keyStart: number;
    keyEnd: number;
    /** Offset just after the colon. */
    colonEnd: number;
    valueStart: number;
    valueEnd: number;
    /** Offset just past the line that ends the value, trailing comment included. */
    lineEnd: number;
    /** Where this field's block starts: the comment lines above it belong to it. */
    blockStart: number;
    value: unknown;
    /** The value defines a YAML anchor, so changing it could change other properties. */
    anchored: boolean;
}

export interface FrontmatterText {
    open: string;
    raw: string;
    /** Closing fence and everything after it. */
    tail: string;
    newline: string;
    fields: FrontmatterField[];
}

export interface TextEdit {
    start: number;
    end: number;
    text: string;
}

const invalidFrontmatter = (): Error => new Error(t('ui.timetable.noteDropInvalidYaml'));

function endOfLine(raw: string, offset: number): number {
    if (offset > 0 && raw[offset - 1] === '\n') return offset;
    const newline = raw.indexOf('\n', offset);
    return newline < 0 ? raw.length : newline + 1;
}

/** Walk up over comment and blank lines that sit directly above `lineStart`. */
function blockStartFor(raw: string, lineStart: number, floor: number): number {
    let start = lineStart;
    while (start > floor) {
        const previous = raw.lastIndexOf('\n', start - 2) + 1;
        if (previous < floor) break;
        const line = raw.slice(previous, start).trim();
        if (line && !line.startsWith('#')) break;
        start = previous;
    }
    return start;
}

function readFields(raw: string): FrontmatterField[] {
    const doc = parseDocument(raw);
    if (doc.errors.length) throw invalidFrontmatter();
    if (doc.contents === null) return [];
    if (!isMap(doc.contents) || doc.contents.flow) throw invalidFrontmatter();
    let values: Record<string, unknown>;
    try {
        values = doc.toJS() as Record<string, unknown>;
    } catch {
        // An alias with no anchor before it.
        throw invalidFrontmatter();
    }
    const fields: FrontmatterField[] = [];
    let previousEnd = 0;
    for (const pair of doc.contents.items) {
        if (!isScalar(pair.key) || !pair.key.range) throw invalidFrontmatter();
        const keyStart = pair.key.range[0];
        const keyEnd = pair.key.range[1];
        const colonEnd = raw.indexOf(':', keyEnd) + 1;
        const node = pair.value as Node | null;
        const valueStart = node?.range?.[0] ?? colonEnd;
        const valueEnd = node?.range?.[1] ?? colonEnd;
        const lineEnd = endOfLine(raw, Math.max(valueEnd, colonEnd));
        const lineStart = raw.lastIndexOf('\n', keyStart - 1) + 1;
        fields.push({
            key: String(pair.key.value),
            keyStart,
            keyEnd,
            colonEnd,
            valueStart,
            valueEnd,
            lineEnd,
            blockStart: fields.length === 0 ? 0 : blockStartFor(raw, lineStart, previousEnd),
            value: values[String(pair.key.value)],
            anchored: /(?:^|[\s[{,])&[\w-]+/.test(raw.slice(colonEnd, valueEnd)),
        });
        previousEnd = lineEnd;
    }
    return fields;
}

/** The note's frontmatter, or null when it has none. Malformed frontmatter throws. */
export function readFrontmatterText(content: string): FrontmatterText | null {
    const start = /^---[ \t]*\r?\n/.exec(content);
    if (!start) return null;
    const rest = content.slice(start[0].length);
    const close = /^---[ \t]*\r?$/m.exec(rest);
    if (!close) throw invalidFrontmatter();
    const raw = rest.slice(0, close.index);
    return {
        open: start[0],
        raw,
        tail: rest.slice(close.index),
        newline: start[0].endsWith('\r\n') ? '\r\n' : '\n',
        fields: readFields(raw),
    };
}

/** The fields as a plain record, keyed as the note spells them. */
export function frontmatterValues(text: FrontmatterText): Record<string, unknown> {
    return Object.fromEntries(text.fields.map(field => [field.key, field.value]));
}

/** Apply edits and return the whole note. Throws rather than return broken YAML. */
export function applyFrontmatterEdits(text: FrontmatterText, edits: TextEdit[]): string {
    if (edits.length === 0) return text.open + text.raw + text.tail;
    // Stable sort, applied back to front: edits at one offset keep their order.
    const ordered = edits.map((edit, index) => ({ edit, index }))
        .sort((a, b) => b.edit.start - a.edit.start || b.index - a.index);
    let raw = text.raw;
    for (const { edit } of ordered) raw = raw.slice(0, edit.start) + edit.text + raw.slice(edit.end);
    try {
        readFields(raw);
    } catch {
        throw new Error(t('ui.timetable.timelineDropComplexProperty'));
    }
    return text.open + raw + text.tail;
}

function withLineBreak(text: FrontmatterText, lines: string): string {
    return lines.replace(/\r?\n/g, text.newline) + text.newline;
}

export interface FieldPlacement {
    /** Canonical key order. */
    order: string[];
    /** A note key's canonical name, so renamed and differently cased keys rank correctly. */
    canonicalOf: (key: string) => string;
    /** Plugin-managed keys kept after the template fields, such as Gossamer scores. */
    isDynamic?: (key: string) => boolean;
}

/**
 * Where a new field goes: after the nearest earlier managed field in the note,
 * and after any custom fields attached below that field. Without a canonical
 * position it goes last.
 */
function insertionOffset(text: FrontmatterText, key: string, placement: FieldPlacement | undefined): number {
    const rank = placement ? placement.order.indexOf(key) : -1;
    if (!placement || rank < 0) return text.raw.length;
    const rankOf = (field: FrontmatterField) => placement.order.indexOf(placement.canonicalOf(field.key));
    let anchor = -1;
    let best = -1;
    text.fields.forEach((field, index) => {
        const fieldRank = rankOf(field);
        if (fieldRank >= 0 && fieldRank < rank && fieldRank > best) {
            best = fieldRank;
            anchor = index;
        }
    });
    if (anchor < 0) return 0;
    const isAttached = (field: FrontmatterField) => rankOf(field) < 0 && !placement.isDynamic?.(placement.canonicalOf(field.key));
    while (anchor + 1 < text.fields.length && isAttached(text.fields[anchor + 1])) anchor += 1;
    return text.fields[anchor].lineEnd;
}

/** Edits that add whole fields. `lines` is the complete YAML for one field. */
export function insertFieldEdits(
    text: FrontmatterText,
    additions: Array<{ key: string; lines: string }>,
    placement?: FieldPlacement
): TextEdit[] {
    return additions.map(({ key, lines }) => {
        const offset = insertionOffset(text, key, placement);
        return { start: offset, end: offset, text: withLineBreak(text, lines) };
    });
}

export function isBlankFrontmatterValue(value: unknown): boolean {
    if (value === undefined || value === null) return true;
    if (typeof value === 'string') return value.trim().length === 0;
    return Array.isArray(value) && value.length === 0;
}

/** Replace a field's value in place, keeping a comment on the same line. */
export function replaceValueEdit(text: FrontmatterText, field: FrontmatterField, value: string): TextEdit {
    if (field.anchored) throw new Error(t('ui.timetable.timelineDropComplexProperty'));
    if (field.valueEnd > field.valueStart) {
        const trailing = /\s*$/.exec(text.raw.slice(field.valueStart, field.valueEnd))?.[0] ?? '';
        // A block list may sit at column 0 under its key; a scalar there would
        // read as a new top-level line, so it takes the usual indent.
        const indent = text.raw[field.valueStart - 1] === '\n' ? '  ' : '';
        return { start: field.valueStart, end: field.valueEnd, text: indent + value + trailing };
    }
    const rest = text.raw.slice(field.colonEnd, field.lineEnd);
    const gap = /^[ \t]*/.exec(rest)?.[0].length ?? 0;
    const comment = rest[gap] === '#' ? ' ' : '';
    return { start: field.colonEnd, end: field.colonEnd + gap, text: ` ${value}${comment}` };
}

/** Remove a field and its line. Comment lines above it stay. */
export function removeFieldEdit(field: FrontmatterField, raw: string): TextEdit {
    if (field.anchored) throw new Error(t('ui.timetable.timelineDropComplexProperty'));
    const lineStart = raw.lastIndexOf('\n', field.keyStart - 1) + 1;
    return { start: lineStart, end: field.lineEnd, text: '' };
}

/**
 * Rebuild the block with its fields in `keys` order. Each field moves with its
 * comments. `renames` respells a key without touching its value.
 */
export function reorderFrontmatterFields(text: FrontmatterText, keys: string[], renames?: Map<string, string>): string {
    const blocks = new Map(text.fields.map((field, index) => {
        const end = text.fields[index + 1]?.blockStart ?? text.raw.length;
        const rename = renames?.get(field.key);
        const block = rename === undefined
            ? text.raw.slice(field.blockStart, end)
            : text.raw.slice(field.blockStart, field.keyStart) + rename + text.raw.slice(field.keyEnd, end);
        return [field.key, block];
    }));
    if (keys.length !== blocks.size || keys.some(key => !blocks.has(key))) throw invalidFrontmatter();
    const raw = keys.map(key => blocks.get(key)!).join(''); // SAFE: every key was checked against blocks on the line above
    const before = new Map(text.fields.map(field => [renames?.get(field.key) ?? field.key, JSON.stringify(field.value)]));
    const after = readFields(raw);
    if (after.length !== before.size || after.some(field => before.get(field.key) !== JSON.stringify(field.value))) {
        throw new Error(t('ui.timetable.timelineDropComplexProperty'));
    }
    return text.open + raw + text.tail;
}

/** Words YAML 1.1 tools read as booleans, though the parser here does not. */
const BOOLEAN_WORDS = /^(?:yes|no|on|off)$/i;

/** Whether the parser reads this YAML as one mapping entry. Asks the parser, so no form of number or tag slips past. */
function parsesAs(yaml: string, key: string, value: string): boolean {
    try {
        const doc = parseDocument(yaml, { logLevel: 'silent' });
        if (doc.errors.length || !isMap(doc.contents) || doc.contents.items.length !== 1) return false;
        const [pair] = doc.contents.items;
        return isScalar(pair.key) && pair.key.value === key
            && isScalar(pair.value) && pair.value.value === value;
    } catch {
        return false;
    }
}

/** A string as a YAML value, quoted only when plain text would read back as anything else. */
export function yamlScalar(value: string): string {
    if (value === '') return '';
    return parsesAs(`k: ${value}`, 'k', value) && !BOOLEAN_WORDS.test(value) ? value : JSON.stringify(value);
}

/** A string as a YAML property name, quoted only when plain text would read back as anything else. */
export function yamlKey(key: string): string {
    return parsesAs(`${key}: v`, key, 'v') && !BOOLEAN_WORDS.test(key) ? key : JSON.stringify(key);
}

/** One field as YAML lines. An empty value is written `Key:`, as the templates do. */
export function formatYamlField(key: string, value: string | string[]): string {
    const name = yamlKey(key);
    if (Array.isArray(value)) {
        if (value.length === 0) return `${name}:`;
        return [`${name}:`, ...value.map(item => `  - ${yamlScalar(item)}`)].join('\n');
    }
    return value === '' ? `${name}:` : `${name}: ${yamlScalar(value)}`;
}
