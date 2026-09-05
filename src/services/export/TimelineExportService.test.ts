import { describe, expect, it } from 'vitest';
import {
    applyGenericSubplotNames,
    buildBakedStyleDeclaration,
    buildTimelineDataExport,
    wallClockWhen,
    ExportStyleClasses,
    generateExportId,
    isRuntimeChromeElement,
    resolveTimelineImageExportFolder,
    snapshotRenderConfig,
    LEGACY_TIMELINE_EXPORT_FOLDER,
    TIMELINE_COMMUNITY_EXPORT_FOLDER,
    TIMELINE_DATA_EXPORT_SCHEMA_VERSION,
    TIMELINE_IMAGE_EXPORT_SUBFOLDER,
    type BuildTimelineDataExportParams,
    type TimelineDataExportDocument,
} from './TimelineExportService';
import {
    buildFontFaceCss,
    isDataUriOnlySrc,
    parseFontFamilyList,
    selectFontFacesForFamilies,
    type ExportFontFaceRule,
} from './exportFonts';
import type { BookMeta, RadialTimelineSettings, TimelineItem } from '../../types';
import { RT_SYSTEM_FOLDER, systemFolderPath } from '../../utils/systemFolder';
import { DEFAULT_SETTINGS } from '../../settings/defaults';
import type RadialTimelinePlugin from '../../main';

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
        exportId: '00000000-0000-4000-8000-000000000000',
        ...overrides,
    };
}

describe('wallClockWhen', () => {
    // Every Date here is built from LOCAL components, the way `parseWhenField`
    // builds one from the author's frontmatter — so these assertions hold in
    // any timezone, which is the whole point of the function under test.

    it('keeps the author’s own clock time, not the UTC instant', () => {
        // The report: a 7 PM scene arriving on the website as 2 AM the next
        // day, i.e. shifted by the exporting machine's offset.
        const when = new Date(2085, 2, 31, 19, 0, 0);
        expect(wallClockWhen({ when })).toBe('2085-03-31T19:00:00');
        // What JSON.stringify would have written instead, west of Greenwich.
        expect(when.toISOString()).not.toBe('2085-03-31T19:00:00');
    });

    it('does not invent a time for a date the author left unclocked', () => {
        // A bare `When` is parsed to local noon; serialising that as an
        // instant printed a precise hour nobody wrote.
        const when = new Date(1812, 8, 19, 12, 0, 0);
        expect(wallClockWhen({ when, rawFrontmatter: { When: '1812-9-19' } })).toBe('1812-09-19');
        expect(wallClockWhen({ when, rawFrontmatter: { When: '1812-09-19' } })).toBe('1812-09-19');
    });

    it('keeps a real noon when the author actually wrote one', () => {
        const when = new Date(1812, 8, 19, 12, 0, 0);
        expect(wallClockWhen({ when, rawFrontmatter: { When: '1812-09-19 12:00' } })).toBe(
            '1812-09-19T12:00:00',
        );
    });

    it('pads every component, and carries seconds', () => {
        expect(wallClockWhen({ when: new Date(2085, 0, 2, 3, 4, 5) })).toBe('2085-01-02T03:04:05');
    });

    it('is undefined when there is no usable date', () => {
        expect(wallClockWhen({})).toBeUndefined();
        expect(wallClockWhen({ when: new Date('nonsense') })).toBeUndefined();
    });
});

describe('buildTimelineDataExport', () => {
    it('stamps the schema version, timestamp, generator, and plugin version', () => {
        const doc = buildTimelineDataExport(makeParams());
        expect(doc.schemaVersion).toBe(TIMELINE_DATA_EXPORT_SCHEMA_VERSION);
        expect(doc.schemaVersion).toBe('1.1.0');
        expect(doc.exportedAt).toBe('2026-07-19T12:00:00.000Z');
        expect(doc.generator).toBe('Radial Timeline');
        expect(doc.pluginVersion).toBe('6.2.6');
    });

    it('writes every item’s `when` as a wall clock, never a UTC instant', () => {
        const items = [
            { title: '1 Evening', path: 'Book/1.md', itemType: 'Scene' as const, when: new Date(2085, 2, 31, 19, 0, 0) },
            { title: '2 Unclocked', path: 'Book/2.md', itemType: 'Scene' as const, when: new Date(1812, 8, 19, 12, 0, 0), rawFrontmatter: { When: '1812-9-19' } },
            { title: '3 No date', path: 'Book/3.md', itemType: 'Scene' as const },
        ];
        const doc = buildTimelineDataExport(makeParams({ items }));
        expect(doc.items.map((item) => item.when)).toEqual([
            '2085-03-31T19:00:00',
            '1812-09-19',
            undefined,
        ]);
        // And it survives serialisation — the defect was JSON.stringify
        // calling toISOString() on a Date the document still carried.
        const roundTripped = JSON.parse(JSON.stringify(doc)) as { items: { when?: string }[] };
        expect(roundTripped.items[0].when).toBe('2085-03-31T19:00:00');
        expect(roundTripped.items[2]).not.toHaveProperty('when');
    });

    it('stamps the injected provenance exportId and generates one when absent', () => {
        const doc = buildTimelineDataExport(makeParams());
        expect(doc.exportId).toBe('00000000-0000-4000-8000-000000000000');
        const generated = buildTimelineDataExport(makeParams({ exportId: undefined }));
        expect(generated.exportId).toMatch(/[0-9a-f-]{8,}/i);
        expect(generated.exportId).not.toBe(doc.exportId);
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

/**
 * Fixture modeling a multi-subplot scene the way SceneDataService actually
 * produces it: one TimelineItem per subplot, all sharing a single
 * `rawFrontmatter` object by reference (metadata.Subplot as an array).
 * Includes a single-subplot scene and a Main-Plot-default scene (no
 * `Subplot` key in its frontmatter at all) to exercise the passthrough paths.
 */
function makeGenericNameItems(): TimelineItem[] {
    const heistFrontmatter: Record<string, unknown> = { Class: 'Scene', Subplot: ['Heist', 'Redemption Arc'] };
    return [
        {
            title: '1 Opening', date: '2020-01-01', path: 'Book/1 Opening.md', itemType: 'Scene',
            subplot: 'Redemption Arc',
            rawFrontmatter: { Class: 'Scene', Subplot: 'Redemption Arc' },
        },
        {
            title: '2 Heist Setup', date: '2020-01-02', path: 'Book/2 Heist Setup.md', itemType: 'Scene',
            subplot: 'Heist',
            rawFrontmatter: heistFrontmatter,
        },
        {
            title: '2 Heist Setup', date: '2020-01-02', path: 'Book/2 Heist Setup.md', itemType: 'Scene',
            subplot: 'Redemption Arc',
            rawFrontmatter: heistFrontmatter,
        },
        {
            title: '3 Quiet Scene', date: '2020-01-03', path: 'Book/3 Quiet.md', itemType: 'Scene',
            subplot: 'Main Plot',
            rawFrontmatter: { Class: 'Scene' },
        },
    ];
}

describe('applyGenericSubplotNames (via buildTimelineDataExport genericSubplotNames option)', () => {
    it('maps subplot names to "Subplot N" in order of first appearance across items', () => {
        const doc = buildTimelineDataExport(makeParams({ items: makeGenericNameItems(), genericSubplotNames: true }));
        // Encounter order: 'Redemption Arc' (item 0), 'Heist' (item 1), 'Main Plot' (item 3).
        expect(doc.items[0].subplot).toBe('Subplot 1'); // Redemption Arc
        expect(doc.items[1].subplot).toBe('Subplot 2'); // Heist
        expect(doc.items[2].subplot).toBe('Subplot 1'); // Redemption Arc again -> same mapping
        expect(doc.items[3].subplot).toBe('Subplot 3'); // Main Plot
    });

    it('applies the same mapping to rawFrontmatter.Subplot, both string and array forms', () => {
        const doc = buildTimelineDataExport(makeParams({ items: makeGenericNameItems(), genericSubplotNames: true }));
        expect(doc.items[0].rawFrontmatter?.Subplot).toBe('Subplot 1');
        expect(doc.items[1].rawFrontmatter?.Subplot).toEqual(['Subplot 2', 'Subplot 1']);
        // The Main-Plot scene never had a Subplot key in its frontmatter; it
        // must not be invented by the transform.
        expect(doc.items[3].rawFrontmatter).not.toHaveProperty('Subplot');
    });

    it('keeps sibling items of a multi-subplot scene sharing one rawFrontmatter object, mutated once', () => {
        const doc = buildTimelineDataExport(makeParams({ items: makeGenericNameItems(), genericSubplotNames: true }));
        // Items 1 and 2 were exploded from the same scene and must still
        // reference the identical (cloned) rawFrontmatter object post-export,
        // so the web-engine adapter's dedup-by-reference still works.
        expect(doc.items[1].rawFrontmatter).toBe(doc.items[2].rawFrontmatter);
    });

    it('remaps renderConfig.dominantSubplots values using the same mapping', () => {
        const doc = buildTimelineDataExport(makeParams({
            items: makeGenericNameItems(),
            genericSubplotNames: true,
            settings: makeSettings({ dominantSubplots: { 'Book/2 Heist Setup.md': 'Redemption Arc' } }),
        }));
        expect(doc.renderConfig.dominantSubplots).toEqual({ 'Book/2 Heist Setup.md': 'Subplot 1' });
    });

    it('leaves renderConfig.dominantSubplots absent when the settings snapshot carries none', () => {
        const doc = buildTimelineDataExport(makeParams({ items: makeGenericNameItems(), genericSubplotNames: true }));
        expect(doc.renderConfig.dominantSubplots).toBeUndefined();
    });

    it('preserves the item count', () => {
        const items = makeGenericNameItems();
        const doc = buildTimelineDataExport(makeParams({ items, genericSubplotNames: true }));
        expect(doc.items).toHaveLength(items.length);
        expect(doc.context.itemCount).toBe(items.length);
    });

    it('never touches scene titles (a revealing field, not structural)', () => {
        const doc = buildTimelineDataExport(makeParams({ items: makeGenericNameItems(), genericSubplotNames: true }));
        expect(doc.items[0].title).toBe('1 Opening');
        expect(doc.items[1].title).toBe('2 Heist Setup');
        expect(doc.items[3].title).toBe('3 Quiet Scene');
    });

    it('is deterministic: identical input produces an identical mapping on repeated calls', () => {
        const first = buildTimelineDataExport(makeParams({ items: makeGenericNameItems(), genericSubplotNames: true }));
        const second = buildTimelineDataExport(makeParams({ items: makeGenericNameItems(), genericSubplotNames: true }));
        expect(second.items.map((i) => i.subplot)).toEqual(first.items.map((i) => i.subplot));
        expect(second.items.map((i) => i.rawFrontmatter?.Subplot)).toEqual(first.items.map((i) => i.rawFrontmatter?.Subplot));
    });

    it('OFF (default) is a passthrough: subplot names are exported verbatim', () => {
        const doc = buildTimelineDataExport(makeParams({ items: makeGenericNameItems() }));
        expect(doc.items[0].subplot).toBe('Redemption Arc');
        expect(doc.items[1].subplot).toBe('Heist');
        expect(doc.items[1].rawFrontmatter?.Subplot).toEqual(['Heist', 'Redemption Arc']);
        expect(doc.items[3].subplot).toBe('Main Plot');
    });

    it('OFF (genericSubplotNames explicitly false) is also a passthrough', () => {
        const doc = buildTimelineDataExport(makeParams({ items: makeGenericNameItems(), genericSubplotNames: false }));
        expect(doc.items[0].subplot).toBe('Redemption Arc');
        expect(doc.items[1].rawFrontmatter?.Subplot).toEqual(['Heist', 'Redemption Arc']);
    });

    it('applyGenericSubplotNames tolerates a non-string entry inside a Subplot array', () => {
        const doc: TimelineDataExportDocument = buildTimelineDataExport(makeParams({
            items: [
                { title: 'S', date: '2020-01-01', path: 'Book/S.md', itemType: 'Scene', subplot: 'Alpha', rawFrontmatter: { Subplot: ['Alpha', 42] } },
            ],
        }));
        applyGenericSubplotNames(doc);
        expect(doc.items[0].subplot).toBe('Subplot 1');
        expect(doc.items[0].rawFrontmatter?.Subplot).toEqual(['Subplot 1', 42]);
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

/** Build a getComputedStyle-shaped getter from a plain property map. */
function styleGetter(map: Record<string, string>): (prop: string) => string {
    return (prop) => map[prop] ?? '';
}

describe('buildBakedStyleDeclaration', () => {
    it('always emits fill but drops inert paint defaults', () => {
        const decl = buildBakedStyleDeclaration(
            styleGetter({
                fill: 'rgb(10, 20, 30)',
                'fill-opacity': '1',
                'fill-rule': 'nonzero',
                opacity: '1',
                stroke: 'none',
            }),
            false
        );
        expect(decl).toBe('fill:rgb(10, 20, 30)');
    });

    it('drops all stroke-* longhands when there is no stroke', () => {
        const decl = buildBakedStyleDeclaration(
            styleGetter({
                fill: 'none',
                stroke: 'none',
                'stroke-width': '2px',
                'stroke-miterlimit': '4',
                'stroke-dashoffset': '0px',
            }),
            false
        );
        expect(decl).toBe('fill:none');
        expect(decl).not.toContain('stroke');
    });

    it('emits stroke and its non-default longhands when a stroke is present', () => {
        const decl = buildBakedStyleDeclaration(
            styleGetter({
                fill: 'none',
                stroke: 'rgb(255, 0, 0)',
                'stroke-width': '3px',
                'stroke-miterlimit': '4', // default -> dropped
                'stroke-linecap': 'round', // non-default -> kept
            }),
            false
        );
        expect(decl).toContain('stroke:rgb(255, 0, 0)');
        expect(decl).toContain('stroke-width:3px');
        expect(decl).toContain('stroke-linecap:round');
        expect(decl).not.toContain('stroke-miterlimit');
    });

    it('omits font/text props for non-text elements', () => {
        const decl = buildBakedStyleDeclaration(
            styleGetter({
                fill: 'rgb(0, 0, 0)',
                'font-family': '"Asimovian", Impact, sans-serif',
                'font-size': '18px',
                'font-weight': '700',
                'text-anchor': 'middle',
            }),
            false
        );
        expect(decl).toBe('fill:rgb(0, 0, 0)');
        expect(decl).not.toContain('font');
        expect(decl).not.toContain('text-anchor');
    });

    it('emits font/text props for text-bearing elements, dropping their defaults', () => {
        const decl = buildBakedStyleDeclaration(
            styleGetter({
                fill: 'rgb(0, 0, 0)',
                'font-family': '"Asimovian", sans-serif',
                'font-size': '18px',
                'font-weight': '400', // default -> dropped
                'font-style': 'normal', // default -> dropped
                'text-anchor': 'middle',
                'text-decoration': 'none solid rgb(0, 0, 0)', // inert -> dropped
            }),
            true
        );
        expect(decl).toContain('font-family:"Asimovian", sans-serif');
        expect(decl).toContain('font-size:18px');
        expect(decl).toContain('text-anchor:middle');
        expect(decl).not.toContain('font-weight');
        expect(decl).not.toContain('font-style');
        expect(decl).not.toContain('text-decoration');
    });

    it('preserves display:none and non-visible visibility so hidden nodes stay hidden', () => {
        const decl = buildBakedStyleDeclaration(
            styleGetter({ display: 'none', visibility: 'hidden', fill: 'rgb(1, 2, 3)' }),
            false
        );
        expect(decl).toContain('display:none');
        expect(decl).toContain('visibility:hidden');
    });
});

describe('ExportStyleClasses', () => {
    it('interns identical declarations to a single shared class', () => {
        const classes = new ExportStyleClasses();
        const a = classes.intern('fill:rgb(1, 2, 3)');
        const b = classes.intern('fill:rgb(1, 2, 3)');
        const c = classes.intern('fill:rgb(9, 9, 9)');
        expect(a).toBe(b);
        expect(a).not.toBe(c);
        expect(classes.size).toBe(2);
    });

    it('emits one CSS rule per distinct declaration', () => {
        const classes = new ExportStyleClasses();
        classes.intern('fill:rgb(1, 2, 3)');
        classes.intern('fill:rgb(1, 2, 3)');
        classes.intern('fill:none;stroke:rgb(0, 0, 0)');
        const css = classes.toCss();
        expect(css).toBe('.rtx0{fill:rgb(1, 2, 3)}\n.rtx1{fill:none;stroke:rgb(0, 0, 0)}');
        expect(css.match(/\{/g)).toHaveLength(2);
    });
});

describe('isRuntimeChromeElement', () => {
    const target = (localName: string, classes: string[]) =>
        ({ localName, classList: { contains: (c: string) => classes.includes(c) } }) as unknown as {
            localName: string;
            classList: DOMTokenList;
        };

    it('flags every foreignObject (canvas-tainting embedded XHTML chrome)', () => {
        expect(isRuntimeChromeElement(target('foreignObject', ['rt-runtime-icon-container']))).toBe(true);
        expect(isRuntimeChromeElement(target('foreignObject', ['ert-recent-moves-fo']))).toBe(true);
        expect(isRuntimeChromeElement(target('foreignObject', ['rt-gossamer-runs-fo']))).toBe(true);
    });

    it('flags the hidden text-measurement scaffold', () => {
        expect(isRuntimeChromeElement(target('text', ['rt-measure-text']))).toBe(true);
    });

    it('keeps still artwork (paths, real text, groups, the svg root)', () => {
        expect(isRuntimeChromeElement(target('path', ['rt-scene-path']))).toBe(false);
        expect(isRuntimeChromeElement(target('text', ['rt-scene-title']))).toBe(false);
        expect(isRuntimeChromeElement(target('g', []))).toBe(false);
        expect(isRuntimeChromeElement(target('svg', ['radial-timeline-svg']))).toBe(false);
    });
});

describe('export destinations', () => {
    function pluginWithExportFolder(value: string | undefined): RadialTimelinePlugin {
        return { settings: { manuscriptOutputFolder: value } } as unknown as RadialTimelinePlugin;
    }

    it('writes the community share JSON beside Social in the canonical system folder', () => {
        expect(TIMELINE_COMMUNITY_EXPORT_FOLDER).toBe(systemFolderPath('Community'));
        expect(TIMELINE_COMMUNITY_EXPORT_FOLDER).toBe('Radial Timeline/Community');
    });

    it('writes timeline images under the configured Export folder', () => {
        expect(resolveTimelineImageExportFolder(pluginWithExportFolder(undefined)))
            .toBe(`${DEFAULT_SETTINGS.manuscriptOutputFolder}/${TIMELINE_IMAGE_EXPORT_SUBFOLDER}`);
        expect(resolveTimelineImageExportFolder(pluginWithExportFolder(undefined)))
            .toBe('Radial Timeline/Export/Timeline');
    });

    it('follows a retargeted Export folder instead of re-joining the system root', () => {
        expect(resolveTimelineImageExportFolder(pluginWithExportFolder('Manuscripts/Out')))
            .toBe('Manuscripts/Out/Timeline');
    });

    it('never creates a second top-level folder beside the canonical one', () => {
        const destinations = [
            TIMELINE_COMMUNITY_EXPORT_FOLDER,
            resolveTimelineImageExportFolder(pluginWithExportFolder(undefined)),
        ];
        for (const destination of destinations) {
            expect(destination.startsWith(`${RT_SYSTEM_FOLDER}/`)).toBe(true);
            expect(destination.startsWith(LEGACY_TIMELINE_EXPORT_FOLDER)).toBe(false);
        }
    });

    it('keeps the legacy folder name as a read-only marker, never a destination', () => {
        expect(LEGACY_TIMELINE_EXPORT_FOLDER).toBe('Radial Timeline Exports');
        expect(TIMELINE_COMMUNITY_EXPORT_FOLDER).not.toBe(LEGACY_TIMELINE_EXPORT_FOLDER);
    });
});

describe('generateExportId', () => {
    it('produces a distinct id on each call', () => {
        expect(generateExportId()).not.toBe(generateExportId());
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
