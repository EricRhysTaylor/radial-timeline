import { describe, expect, it } from 'vitest';
import { en } from './en';
import { de } from './de';
import { ja } from './ja';
import { ko } from './ko';
import { zh } from './zh';

type Tree = { [key: string]: unknown };

function flatten(node: Tree, prefix = '', out: Record<string, string> = {}): Record<string, string> {
    for (const [key, value] of Object.entries(node)) {
        const path = prefix ? `${prefix}.${key}` : key;
        if (typeof value === 'string') out[path] = value;
        else if (value && typeof value === 'object') flatten(value as Tree, path, out);
    }
    return out;
}

const placeholders = (value: string): string =>
    (value.match(/\{\{\s*[\w.]+\s*\}\}/g) ?? []).sort().join(',');

const english = flatten(en as unknown as Tree);
const locales: Record<string, Tree> = { de, ja, ko, zh } as unknown as Record<string, Tree>;

describe.each(Object.keys(locales))('%s translations', locale => {
    const translated = flatten(locales[locale]);

    it('uses exactly the placeholders of the English string', () => {
        const mismatched = Object.keys(translated).filter(key =>
            placeholders(translated[key]) !== placeholders(english[key] ?? ''));
        expect(mismatched).toEqual([]);
    });

    it('translates every English key', () => {
        const missing = Object.keys(english).filter(key => !(key in translated));
        expect(missing).toEqual([]);
    });
});
