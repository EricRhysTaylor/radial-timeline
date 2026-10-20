import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import * as obsidian from 'obsidian';
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
    afterEach(() => vi.restoreAllMocks());
    beforeEach(() => {
        setMomentLocale('en');
    });

    it('declares the shipped locale set explicitly', () => {
        expect(SUPPORTED_LOCALES).toEqual(['en', 'ja', 'zh', 'ko', 'de', 'es', 'fr', 'th', 'vi']);
    });

    it.each([
        ['en', 'Legacy: source path (deprecated)'],
        ['ja', 'ソースパス'],
        ['zh-CN', '源路径'],
        ['zh-Hans', '源路径'],
        ['ko', '원본 경로'],
        ['de', 'Quellpfad'],
        ['es-MX', 'Carpeta de origen'],
        ['fr-CA', 'Dossier source'],
        ['th-TH', 'โฟลเดอร์ต้นทาง'],
        ['vi-VN', 'Thư mục nguồn'],
    ])('resolves %s to its supported interface locale', (locale, expected) => {
        setMomentLocale(locale);

        expect(t('settings.general.sourcePath.name')).toBe(expected);
    });

    it('falls back to English for unsupported locales and Traditional Chinese variants', () => {
        setMomentLocale('it');
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

    it('uses the configured app language independently of Moment locale', () => {
        setMomentLocale('en');
        vi.spyOn(obsidian, 'getLanguage').mockReturnValue('fr-CA');
        expect(getLocale()).toBe('fr');
        expect(getFormattingLocale()).toBe('fr-CA');
        expect(t('settings.general.sourcePath.name')).toBe('Dossier source');
    });

    it('uses the locale string and interpolates it', () => {
        setMomentLocale('de');

        expect(t('settings.ai.localLlmConfig.contextWindowName')).toBe('Kontextfenster (Tokens)');
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

    it('inserts values literally, in one pass', () => {
        setMomentLocale('en');
        // `$&` would expand under a string replacement; `{{count}}` inside a
        // value must not be filled by a later placeholder.
        expect(t('common.counts.scene.other', { count: 'A $& B {{count}}' })).toBe('A $& B {{count}} scenes');
    });

    it('uses French singular at zero and localized number grouping', () => {
        setMomentLocale('fr');
        expect(tCount('scene', 0)).toBe(t('common.counts.scene.one', { count: 0 }));
        expect(tCount('scene', 2)).toBe(t('common.counts.scene.other', { count: 2 }));
        expect(tCount('scene', 1200)).toContain(new Intl.NumberFormat('fr').format(1200));
    });

    it('keeps English grammar when an unsupported language uses English text', () => {
        setMomentLocale('pt-BR');
        expect(tCount('scene', 0)).toBe('0 scenes');
    });

    it.each(['th', 'vi'])('uses the invariant other form for %s counts', locale => {
        setMomentLocale(locale);
        for (const count of [0, 1, 2, 21]) {
            expect(tCount('scene', count)).toBe(t('common.counts.scene.other', { count }));
        }
    });

    it.each([
        ['es', 'Cerrar'], ['fr', 'Fermer'], ['th', 'ปิด'], ['vi', 'Đóng'],
    ])('uses action wording and preserves the Word product name in %s', (locale, close) => {
        setMomentLocale(locale);
        expect(t('manuscriptModal.formatDocx')).toBe('Word');
        expect(t('ui.manuscriptOptionsModal.close')).toBe(close);
        expect(t('ui.layoutVisuals.partsNumberingWord')).not.toBe('Word');
    });

    it.each(SUPPORTED_LOCALES)('keeps recovery instructions tied to real vault paths in %s', locale => {
        setMomentLocale(locale);
        const instructions = t('ui.refactorAlerts.recoveryFilesDescription');
        for (const path of [
            'Radial Timeline/Recover',
            'Radial Timeline/Logs',
            'Radial Timeline/Logs/Snapshots',
            'Radial Timeline/Logs/Gossamer Archive',
            'Radial Timeline/Snapshots',
        ]) {
            expect(instructions).toContain(path);
        }
    });
});
