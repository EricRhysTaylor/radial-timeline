/**
 * Canonical template merge helper used by getTemplateParts()/getMergedTemplate().
 */

function extractFieldNames(template: string): Set<string> {
    const fields = new Set<string>();
    const lines = template.split('\n');
    for (const line of lines) {
        const match = line.match(/^([A-Za-z][A-Za-z0-9 _'-]*):/);
        if (match) {
            fields.add(match[1].trim());
        }
    }
    return fields;
}

function filterAdvancedFields(advancedTemplate: string, baseFields: Set<string>): string {
    const lines = advancedTemplate.split('\n');
    const result: string[] = [];
    const seenAdvancedFields = new Set<string>();
    let skipUntilNextField = false;

    for (const line of lines) {
        const fieldMatch = line.match(/^([A-Za-z][A-Za-z0-9 _'-]*):/);

        if (fieldMatch) {
            const fieldName = fieldMatch[1].trim();
            if (baseFields.has(fieldName) || seenAdvancedFields.has(fieldName)) {
                skipUntilNextField = true;
                continue;
            }
            seenAdvancedFields.add(fieldName);
            skipUntilNextField = false;
            result.push(line);
            continue;
        }

        if (skipUntilNextField) {
            continue;
        }
        result.push(line);
    }

    return result.join('\n');
}

/**
 * Merge base template fields with advanced additions while preserving canonical order.
 */
export function mergeTemplateParts(baseTemplate: string, advancedFields: string): string {
    const baseFields = extractFieldNames(baseTemplate);
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
