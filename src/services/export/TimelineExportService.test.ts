import { describe, expect, it } from 'vitest';
import {
    buildBakedStyleDeclaration,
    ExportStyleClasses,
    generateExportId,
    isRuntimeChromeElement,
    resolveTimelineImageExportFolder,
    LEGACY_TIMELINE_EXPORT_FOLDER,
    TIMELINE_IMAGE_EXPORT_SUBFOLDER,
} from './TimelineExportService';
import { wallClockWhen } from './timelineExportFormat';
import {
    buildFontFaceCss,
    isDataUriOnlySrc,
    parseFontFamilyList,
    selectFontFacesForFamilies,
    type ExportFontFaceRule,
} from './exportFonts';
import { RT_SYSTEM_FOLDER } from '../../utils/systemFolder';
import { DEFAULT_SETTINGS } from '../../settings/defaults';
import type RadialTimelinePlugin from '../../main';

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
        const destination = resolveTimelineImageExportFolder(pluginWithExportFolder(undefined));
        expect(destination.startsWith(`${RT_SYSTEM_FOLDER}/`)).toBe(true);
        expect(destination.startsWith(LEGACY_TIMELINE_EXPORT_FOLDER)).toBe(false);
    });

    it('keeps the legacy folder name as a read-only marker, never a destination', () => {
        expect(LEGACY_TIMELINE_EXPORT_FOLDER).toBe('Radial Timeline Exports');
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
