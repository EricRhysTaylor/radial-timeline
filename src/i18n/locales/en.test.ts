import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('locale placeholders', () => {
    it('uses the double-brace form t() substitutes; a single-brace {name} would ship literally', () => {
        const source = readFileSync(resolve(process.cwd(), 'src/i18n/locales/en.ts'), 'utf8');
        const singleBrace = source.split('\n').filter(line => /(?<!\{)\{[a-zA-Z]+\}(?!\})/.test(line));
        expect(singleBrace).toEqual([]);
    });
});
