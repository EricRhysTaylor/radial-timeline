/**
 * Canonical template merge helper used by getTemplateParts()/getMergedTemplate().
 */

/**
 * The field a template line starts, or null for a continuation line, a comment
 * or a placeholder. Every template reader goes through this, so a key the
 * editor accepts can never be invisible to the code that resolves it.
 */
export function templateFieldKey(line: string): string | null {
    const match = /^([^\s#:{}[\]"'-][^:#]*?)[ \t]*:(?:\s|$)/.exec(line);
    return match ? match[1] : null;
}

export interface TemplateField {
    key: string;
    /** The field's lines, as written. */
    lines: string;
}

/** A template as its fields, each with its continuation lines. */
export function splitTemplateFields(template: string): TemplateField[] {
    const fields: Array<{ key: string; lines: string[] }> = [];
    for (const line of (template || '').split('\n')) {
        const key = templateFieldKey(line);
        if (key !== null) fields.push({ key, lines: [line] });
        else fields[fields.length - 1]?.lines.push(line);
    }
    return fields.map(field => ({ key: field.key, lines: field.lines.join('\n').trimEnd() }));
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
