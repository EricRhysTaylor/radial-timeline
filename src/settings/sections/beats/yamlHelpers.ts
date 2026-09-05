import { parseYaml } from 'obsidian';
import type { FieldEntry, FieldEntryValue } from './types';

export function extractKeysInOrder(template: string): string[] {
    const keys: string[] = [];
    const lines = (template || '').split('\n');
    for (const line of lines) {
        const match = line.match(/^([A-Za-z0-9 _'-]+):/);
        if (match) {
            const key = match[1].trim();
            if (key && !keys.includes(key)) keys.push(key);
        }
    }
    return keys;
}

export function sanitizeTemplatePlaceholdersForYamlParse(template: string): string {
    return (template || '')
        .split('\n')
        .filter(line => !/^\s*{{[^{}\n]+}}\s*$/.test(line))
        .map(line => line.replace(/{{[^{}\n]+}}/g, match => JSON.stringify(match)))
        .join('\n');
}

export function normalizeParsedTemplateScalar(value: unknown): string {
    return String(value).replace(/^['"]({{[^{}\n]+}})['"]$/, '$1');
}

export function safeParseYaml(template: string): Record<string, FieldEntryValue> {
    try {
        const parsed = parseYaml(sanitizeTemplatePlaceholdersForYamlParse(template));
        if (!parsed || typeof parsed !== 'object') return {};
        const entries: Record<string, FieldEntryValue> = {};
        Object.entries(parsed as Record<string, unknown>).forEach(([key, value]) => {
            if (Array.isArray(value)) {
                entries[key] = value.map((v) => normalizeParsedTemplateScalar(v));
            } else if (value === undefined || value === null) {
                entries[key] = '';
            } else {
                entries[key] = normalizeParsedTemplateScalar(value);
            }
        });
        return entries;
    } catch {
        return {};
    }
}

export function mergeOrders(primary: string[], secondary: string[]): string[] {
    const seen = new Set<string>();
    const result: string[] = [];
    [...primary, ...secondary].forEach(key => {
        if (!key || seen.has(key)) return;
        seen.add(key);
        result.push(key);
    });
    return result;
}

export function buildYamlFromEntries(entries: FieldEntry[], commentMap?: Record<string, string>): string {
    const lines: string[] = [];
    entries.forEach(entry => {
        const comment = commentMap?.[entry.key];
        if (Array.isArray(entry.value)) {
            lines.push(comment ? `${entry.key}: # ${comment}` : `${entry.key}:`);
            entry.value.forEach((v: string) => {
                lines.push(`  - ${v}`);
            });
        } else {
            const valueStr = entry.value ?? '';
            lines.push(comment ? `${entry.key}: ${valueStr} # ${comment}` : `${entry.key}: ${valueStr}`);
        }
    });
    return lines.join('\n');
}

export function entriesFromTemplate(template: string, requiredOrder: string[]): FieldEntry[] {
    const order = mergeOrders(extractKeysInOrder(template), requiredOrder);
    const obj = safeParseYaml(template);
    return order.map(key => ({
        key,
        value: obj[key] ?? '',
        required: requiredOrder.includes(key)
    }));
}
