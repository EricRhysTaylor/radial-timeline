import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { en } from '../i18n/locales/en';
import { de } from '../i18n/locales/de';
import { es } from '../i18n/locales/es';
import { fr } from '../i18n/locales/fr';
import { ja } from '../i18n/locales/ja';
import { ko } from '../i18n/locales/ko';
import { th } from '../i18n/locales/th';
import { vi } from '../i18n/locales/vi';
import { zh } from '../i18n/locales/zh';

const lookup = (root: unknown, key: string): unknown =>
    key.split('.').reduce<unknown>((node, part) => (node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined), root);

describe('Promote to scene strings', () => {
    it('resolves every string the dialog asks for, so none shows as a [missing: …] marker', () => {
        const source = readFileSync(resolve(process.cwd(), 'src/modals/PromoteToSceneModal.ts'), 'utf8');
        const keys = [...source.matchAll(/\bt\('([^']+)'/g)].map(match => match[1]);
        expect(keys).toContain('ui.promoteToScene.noNumber');
        expect(keys.filter(key => typeof lookup(en, key) !== 'string')).toEqual([]);
    });
    it('carries the translated Position choice in every locale', () => {
        for (const locale of [en, de, es, fr, ja, ko, th, vi, zh]) {
            expect(typeof lookup(locale, 'ui.promoteToScene.noNumber')).toBe('string');
            expect(lookup(locale, 'ui.backdropSection.noNumber')).toBeUndefined();
        }
    });
});
