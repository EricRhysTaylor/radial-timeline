import { describe, expect, it, beforeEach } from 'vitest';
import { moment } from 'obsidian';
import {
    clearLocaleCache,
    getFormattingLocale,
    getLocale,
    SUPPORTED_LOCALES,
    t,
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

    it('preserves English fallback and interpolation for missing partial-locale keys', () => {
        setMomentLocale('de');

        expect(t('settings.configuration.synopsisMaxLines.error')).toBe('Please enter a valid number between 10 and 300.');
        expect(t('timeline.acts.actFallback', { number: 7 })).toBe('Akt 7');
    });
});
