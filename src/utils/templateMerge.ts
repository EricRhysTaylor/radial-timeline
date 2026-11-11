/**
 * Canonical template merge helper used by getTemplateParts()/getMergedTemplate().
 */

/** A property name: double quoted, single quoted, or plain. */
const FIELD_START = /^(?:"((?:[^"\\]|\\.)*)"|'((?:[^']|'')*)'|([^\s#:{}[\]"'-][^:#]*?))[ \t]*:(?:\s|$)/;

function readFieldStart(line: string): { key: string; keyLength: number; matched: string } | null {
    const match = FIELD_START.exec(line);
    if (!match) return null;
    const [matched, double, single, plain] = match;
    if (double !== undefined) return { key: double.replace(/\\(.)/g, '$1'), keyLength: double.length + 2, matched };
    if (single !== undefined) return { key: single.replace(/''/g, "'"), keyLength: single.length + 2, matched };
    return { key: plain, keyLength: plain.length, matched };
}

/**
 * The field a template line starts, or null for a continuation line, a comment
 * or a placeholder. Every template reader goes through this, so a key the
 * editor accepts can never be invisible to the code that resolves it.
 */
export function templateFieldKey(line: string): string | null {
    return readFieldStart(line)?.key ?? null;
}

/** Where the value starts on a line that begins a field, or null for any other line. */
export function templateValueStart(line: string): number | null {
    const start = readFieldStart(line);
    if (!start) return null;
    const afterColon = start.matched.trimEnd().length;
    return afterColon + (/^[ \t]*/.exec(line.slice(afterColon))?.[0].length ?? 0); // SAFE: /^[ \t]*/ always matches; the types say exec can return null
}

export interface TemplateField {
    key: string;
    /** The field's lines, as written. */
    lines: string;
    /** The same lines without the name, from the colon on. Lets a caller respell the name. */
    rest: string;
}

/** A template as its fields, each with its continuation lines. */
export function splitTemplateFields(template: string): TemplateField[] {
    const fields: Array<{ key: string; keyLength: number; lines: string[] }> = [];
    for (const line of (template || '').split('\n')) {
        const start = readFieldStart(line);
        if (start) fields.push({ key: start.key, keyLength: start.keyLength, lines: [line] });
        else fields[fields.length - 1]?.lines.push(line);
    }
    return fields.map(({ key, keyLength, lines }) => {
        const text = lines.join('\n').trimEnd();
        return { key, lines: text, rest: text.slice(keyLength) };
    });
}

/** The template without the named fields and their continuation lines. */
export function removeTemplateFields(template: string, keys: string[]): string {
    return splitTemplateFields(template)
        .filter(field => !keys.includes(field.key))
        .map(field => field.lines)
        .join('\n');
}

function filterAdvancedFields(advancedTemplate: string, baseFields: Set<string>): string {
    const seen = new Set(baseFields);
    return splitTemplateFields(advancedTemplate)
        .filter(field => {
            if (seen.has(field.key)) return false;
            seen.add(field.key);
            return true;
        })
        .map(field => field.lines)
        .join('\n');
}

/**
 * Merge base template fields with advanced additions while preserving canonical order.
 */
export function mergeTemplateParts(baseTemplate: string, advancedFields: string): string {
    const baseFields = new Set(splitTemplateFields(baseTemplate).map(field => field.key));
    const filteredAdvanced = filterAdvancedFields(advancedFields, baseFields);

    const lines = baseTemplate.split('\n');
    const advancedLines = filteredAdvanced.split('\n').filter(line => line.trim());

    if (advancedLines.length === 0) {
        return baseTemplate;
    }

    const result: string[] = [];
    let inserted = false;

    for (const line of lines) {
        if (line.match(/^Subplot:\s*{{Subplot}}/)) {
            result.push('Subplot:');
            result.push('{{SubplotList}}');
            continue;
        }

        if (line.match(/^Character:\s*{{Character}}/)) {
            result.push('Character:');
            result.push('{{CharacterList}}');
            continue;
        }

        if (line.startsWith('Pulse Update:')) {
            result.push(...advancedLines);
            inserted = true;
        }

        result.push(line);
    }

    if (!inserted) {
        result.push(...advancedLines);
    }

    return result.join('\n');
}
