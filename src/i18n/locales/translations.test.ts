import { describe, expect, it } from 'vitest';
import { en } from './en';
import { de } from './de';
import { ja } from './ja';
import { ko } from './ko';
import { zh } from './zh';
import { es } from './es';
import { fr } from './fr';
import { th } from './th';
import { vi } from './vi';

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
const locales: Record<string, Tree> = { de, ja, ko, zh, es, fr, th, vi } as unknown as Record<string, Tree>;

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

    it('does not drop source text or retain temporary translation tokens', () => {
        const invalid = Object.keys(translated).filter(key =>
            (english[key]?.trim() && !translated[key].trim()) || /[⟦⟧]|ZXQKEEP\d+ZXQ/.test(translated[key]));
        expect(invalid).toEqual([]);
    });
});

describe.each(['es', 'fr', 'th', 'vi'])('%s protected author syntax', locale => {
    it('preserves inline code examples verbatim', () => {
        const translated = flatten(locales[locale]);
        // Inline code and %%…%% author markers are syntax the author types.
        const snippets = (value: string): string[] => (value.match(/`[^`]+`|%%[^%]+%%/g) ?? []).sort();
        const changed = Object.keys(english).filter(key =>
            JSON.stringify(snippets(english[key])) !== JSON.stringify(snippets(translated[key])));
        expect(changed).toEqual([]);
    });

    it('preserves paragraph boundaries and significant outer whitespace', () => {
        const translated = flatten(locales[locale]);
        const structure = (value: string): string => JSON.stringify([
            value.match(/^\s*/)?.[0], value.match(/\s*$/)?.[0], (value.match(/\n/g) ?? []).length,
        ]);
        const changed = Object.keys(english).filter(key => structure(english[key]) !== structure(translated[key]));
        expect(changed).toEqual([]);
    });
});
