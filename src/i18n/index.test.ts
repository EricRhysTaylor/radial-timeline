import { describe, expect, it, beforeEach } from 'vitest';
import { moment } from 'obsidian';
import {
    clearLocaleCache,
    getFormattingLocale,
    getLocale,
    SUPPORTED_LOCALES,
    t,
    tCount,
} from './index';

function setMomentLocale(locale: string): void {
    (moment as { locale: () => string }).locale = () => locale;
    clearLocaleCache();
}

describe('i18n locale resolution', () => {
    beforeEach(() => {
        setMomentLocale('en');
    });

    it('declares the shipped locale set explicitly', () => {
        expect(SUPPORTED_LOCALES).toEqual(['en', 'ja', 'zh', 'ko', 'de']);
    });

    it.each([
        ['en', 'Legacy: source path (deprecated)'],
        ['ja', 'ソースパス'],
        ['zh-CN', '源路径'],
        ['zh-Hans', '源路径'],
        ['ko', '원본 경로'],
        ['de', 'Quellpfad'],
    ])('resolves %s to its supported interface locale', (locale, expected) => {
        setMomentLocale(locale);

        expect(t('settings.general.sourcePath.name')).toBe(expected);
    });

    it('falls back to English for unsupported locales and Traditional Chinese variants', () => {
        setMomentLocale('fr');
        expect(t('settings.general.sourcePath.name')).toBe('Legacy: source path (deprecated)');

        setMomentLocale('zh-TW');
        expect(getLocale()).toBe('zh-tw');
        expect(t('settings.general.sourcePath.name')).toBe('Legacy: source path (deprecated)');
    });

    it('keeps full formatting locale while normalizing interface locale', () => {
        setMomentLocale('de-AT');

        expect(getLocale()).toBe('de');
        expect(getFormattingLocale()).toBe('de-AT');
    });

    it('uses the locale string and interpolates it', () => {
        setMomentLocale('de');

        expect(t('settings.configuration.synopsisMaxLines.error')).toBe('Bitte geben Sie eine gültige Zahl zwischen 10 und 300 ein.');
        expect(t('timeline.acts.actFallback', { number: 7 })).toBe('Akt 7');
    });

    it('builds counted phrases per language instead of appending an English plural', () => {
        setMomentLocale('de');
        expect(tCount('scene', 1)).toBe('1 Szene');
        expect(tCount('scene', 3)).toBe('3 Szenen');

        setMomentLocale('en');
        expect(tCount('scene', 1)).toBe('1 scene');
        expect(tCount('scene', 0)).toBe('0 scenes');
    });
});
