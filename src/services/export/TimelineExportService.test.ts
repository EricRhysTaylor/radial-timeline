import { describe, expect, it } from 'vitest';
import {
    buildTimelineDataExport,
    snapshotRenderConfig,
    TIMELINE_DATA_EXPORT_SCHEMA_VERSION,
    type BuildTimelineDataExportParams,
} from './TimelineExportService';
import {
    buildFontFaceCss,
    isDataUriOnlySrc,
    parseFontFamilyList,
    selectFontFacesForFamilies,
    type ExportFontFaceRule,
} from './exportFonts';
import type { BookMeta, RadialTimelineSettings, TimelineItem } from '../../types';

/**
 * Minimal settings stub carrying only the facade-consumed fields the render
 * config snapshot reads. Cast through the full settings type — the builder only
 * touches the enumerated keys.
 */
function makeSettings(overrides: Partial<RadialTimelineSettings> = {}): RadialTimelineSettings {
    return {
        publishStageColors: { Zero: '#111111', Author: '#222222', House: '#333333', Press: '#444444' },
        subplotColors: ['#aaaaaa', '#bbbbbb'],
        enableAiSceneAnalysis: false,
        currentMode: 'narrative',
        sortByWhenDate: false,
        actCount: 3,
        books: [],
        activeBookId: 'book-1',
        ...overrides,
    } as unknown as RadialTimelineSettings;
}

function makeItems(): TimelineItem[] {
    return [
        { title: '1 Opening', date: '2020-01-01', path: 'Book/1 Opening.md', itemType: 'Scene', when: new Date('2020-01-01T00:00:00Z') },
        { title: 'Copyright', date: '', path: 'Book/0.1 Copyright.md', itemType: 'Frontmatter', matterMeta: { side: 'front', role: 'copyright' } },
        { title: 'Acknowledgments', date: '', path: 'Book/200.1 Ack.md', itemType: 'Backmatter', matterMeta: { side: 'back', role: 'acknowledgments' } },
    ];
}

function makeParams(overrides: Partial<BuildTimelineDataExportParams> = {}): BuildTimelineDataExportParams {
    const bookMeta: BookMeta = { title: 'Test Book', author: 'A. Writer', sourcePath: 'Book/BookMeta.md' };
    return {
        items: makeItems(),
        bookMeta,
        settings: makeSettings(),
        pluginVersion: '6.2.6',
        mode: 'narrative',
        activeBookId: 'book-1',
        bookTitle: 'Test Book',
        now: new Date('2026-07-19T12:00:00Z'),
        ...overrides,
    };
}

describe('buildTimelineDataExport', () => {
    it('stamps the schema version, timestamp, generator, and plugin version', () => {
        const doc = buildTimelineDataExport(makeParams());
        expect(doc.schemaVersion).toBe(TIMELINE_DATA_EXPORT_SCHEMA_VERSION);
        expect(doc.schemaVersion).toBe('1.0.0');
        expect(doc.exportedAt).toBe('2026-07-19T12:00:00.000Z');
        expect(doc.generator).toBe('Radial Timeline');
        expect(doc.pluginVersion).toBe('6.2.6');
    });

    it('includes the full item array as fed to the renderer', () => {
        const items = makeItems();
        const doc = buildTimelineDataExport(makeParams({ items }));
        expect(doc.items).toHaveLength(items.length);
        expect(doc.context.itemCount).toBe(items.length);
        expect(doc.items[0].title).toBe('1 Opening');
    });

    it('extracts front/back matter entries with their parsed matter meta', () => {
        const doc = buildTimelineDataExport(makeParams());
        expect(doc.matter).toHaveLength(2);
        const roles = doc.matter.map((m) => m.matterMeta?.role).sort();
        expect(roles).toEqual(['acknowledgments', 'copyright']);
        expect(doc.matter.every((m) => typeof m.path === 'string')).toBe(true);
    });

    it('carries book meta through and tolerates a null book meta', () => {
        expect(buildTimelineDataExport(makeParams()).bookMeta?.title).toBe('Test Book');
        expect(buildTimelineDataExport(makeParams({ bookMeta: null })).bookMeta).toBeNull();
    });

    it('deep-clones input so later mutation does not leak into the document', () => {
        const items = makeItems();
        const doc = buildTimelineDataExport(makeParams({ items }));
        items[0].title = 'MUTATED';
        expect(doc.items[0].title).toBe('1 Opening');
    });

    it('contains no machine-specific absolute paths', () => {
        const doc = buildTimelineDataExport(makeParams());
        const serialized = JSON.stringify(doc);
        expect(serialized).not.toContain('/Users/');
        expect(serialized).not.toContain('/home/');
        expect(serialized).not.toMatch(/[A-Za-z]:\\\\/); // Windows drive path
    });
});

describe('snapshotRenderConfig', () => {
    it('captures the facade-consumed settings subset as values', () => {
        const settings = makeSettings({ readabilityScale: 'large' as RadialTimelineSettings['readabilityScale'] });
        const config = snapshotRenderConfig(settings);
        expect(config.publishStageColors).toEqual(settings.publishStageColors);
        expect(config.subplotColors).toEqual(settings.subplotColors);
        expect(config.enableAiSceneAnalysis).toBe(false);
        expect(config.currentMode).toBe('narrative');
        expect(config.actCount).toBe(3);
        expect(config.activeBookId).toBe('book-1');
    });

    it('does not carry keys outside the facade-consumed subset', () => {
        const settings = makeSettings({ pandocPath: '/usr/local/bin/pandoc' } as Partial<RadialTimelineSettings>);
        const config = snapshotRenderConfig(settings);
        expect(config as Record<string, unknown>).not.toHaveProperty('pandocPath');
    });
});

describe('font embedding helpers', () => {
    const asimovian: ExportFontFaceRule = {
        family: 'Asimovian',
        cssText: "@font-face { font-family: 'Asimovian'; src: url(\"data:font/woff2;base64,AAEAAAAR\") format(\"woff2\"); font-weight: 400; }",
    };
    const pixel: ExportFontFaceRule = {
        family: '04b03b',
        cssText: "@font-face { font-family: '04b03b'; src: url(\"data:font/woff2;base64,AAEAAAAO\") format(\"woff2\"); font-weight: 400; }",
    };
    const hooge: ExportFontFaceRule = {
        family: 'hooge05_55Regular',
        cssText: "@font-face { font-family: 'hooge05_55Regular'; src: url(\"data:font/ttf;base64,AAEAAAAO\") format(\"truetype\"); }",
    };

    describe('parseFontFamilyList', () => {
        it('splits a computed family list and strips quotes', () => {
            expect(parseFontFamilyList('"04b03b", Monaco, "Courier New", monospace'))
                .toEqual(['04b03b', 'Monaco', 'Courier New', 'monospace']);
            expect(parseFontFamilyList("'Asimovian', Impact, sans-serif"))
                .toEqual(['Asimovian', 'Impact', 'sans-serif']);
        });

        it('tolerates empty values and stray whitespace', () => {
            expect(parseFontFamilyList('')).toEqual([]);
            expect(parseFontFamilyList('  serif  ')).toEqual(['serif']);
        });
    });

    describe('isDataUriOnlySrc', () => {
        it('accepts data-URI sources, with or without quotes and local() entries', () => {
            expect(isDataUriOnlySrc("url('data:font/woff2;base64,AAAA') format('woff2')")).toBe(true);
            expect(isDataUriOnlySrc('url(data:font/ttf;base64,AAAA)')).toBe(true);
            expect(isDataUriOnlySrc("local('X'), url(\"data:font/woff2;base64,AAAA\")")).toBe(true);
        });

        it('rejects sources that reference external files', () => {
            expect(isDataUriOnlySrc("url('assets/fonts/JetBrainsMono-Thin.woff2') format('woff2')")).toBe(false);
            expect(isDataUriOnlySrc("url('data:font/woff2;base64,AAAA'), url('https://x.test/f.woff2')")).toBe(false);
            expect(isDataUriOnlySrc('')).toBe(false);
            expect(isDataUriOnlySrc("local('OnlyLocal')")).toBe(false);
        });
    });

    describe('selectFontFacesForFamilies', () => {
        it('keeps only rules whose family the render uses, case-insensitively', () => {
            const selected = selectFontFacesForFamilies(
                [asimovian, pixel, hooge],
                ['asimovian', '04B03B', 'Monaco', 'monospace']
            );
            expect(selected).toEqual([asimovian, pixel]);
        });

        it('deduplicates identical rules but keeps distinct variants of a family', () => {
            const bold: ExportFontFaceRule = {
                family: 'Asimovian',
                cssText: asimovian.cssText.replace('font-weight: 400', 'font-weight: 700'),
            };
            const selected = selectFontFacesForFamilies([asimovian, asimovian, bold], ['Asimovian']);
            expect(selected).toEqual([asimovian, bold]);
        });

        it('returns nothing when no used family has an embeddable rule', () => {
            expect(selectFontFacesForFamilies([asimovian], ['Impact', 'sans-serif'])).toEqual([]);
        });
    });

    it('composes a <style> payload carrying the @font-face rules the SVG export embeds', () => {
        const css = buildFontFaceCss(selectFontFacesForFamilies([asimovian, pixel, hooge], ['Asimovian', 'hooge05_55Regular']));
        expect(css).toContain('@font-face');
        expect(css).toContain("font-family: 'Asimovian'");
        expect(css).toContain('data:font/ttf;base64,');
        expect(css).not.toContain('04b03b');
        // XML-safe as an SVG <style> text node: no markup-significant chars.
        expect(css).not.toMatch(/[<&]/);
    });
});
