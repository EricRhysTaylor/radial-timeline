import { describe, expect, it } from 'vitest';
import { buildImportedTemplateFactRows, formatPageSize, renderImportedLayoutSummary } from './ImportedLayoutSummary';
import { readTemplateFacts } from '../../../publishing/templateFacts';
import type { ImportedTemplateCheckRecord } from '../../../publishing/importedTemplateCheck';
import { getBundledPandocLayoutContent } from '../../../utils/pandocBundledLayouts';

class ElementStub {
    children: ElementStub[] = []; text = ''; cls = ''; attr: Record<string, string> = {};
    createDiv(options: { text?: string; cls?: string } = {}) { return this.createEl('div', options); }
    createEl(_tag: string, options: { text?: string; cls?: string; attr?: Record<string, string> } = {}) {
        const child = new ElementStub();
        child.text = options.text ?? ''; child.cls = options.cls ?? ''; child.attr = options.attr ?? {};
        this.children.push(child);
        return child;
    }
    find(cls: string): ElementStub[] { return [...(this.cls.split(' ').includes(cls) ? [this] : []), ...this.children.flatMap(child => child.find(cls))]; }
    allText(): string { return [this.text, ...this.children.map(child => child.allText())].filter(Boolean).join(' | '); }
}

const check: ImportedTemplateCheckRecord = { schemaVersion: 1, sha256: 'x', checkedAt: '2026-11-19T12:00:00.000Z', pages: 4, pageWidthPt: 432, pageHeightPt: 648, samplePage: 3 };
const rowsFor = (tex: string, extra: { check?: ImportedTemplateCheckRecord; copyPath?: string } = {}) =>
    Object.fromEntries(buildImportedTemplateFactRows({ facts: readTemplateFacts(tex), ...extra }).map(row => [row.label, row]));

describe('imported template facts', () => {
    it('states the test PDF as measured: pages, page size and the day it was built', () => {
        const row = rowsFor('$body$', { check })['Test PDF'];
        expect(row.value).toMatch(/^4 pages, 6 × 9 in, built .*2026/);
        expect(row.note).toBe('Built on this computer from a short sample manuscript.');
        expect(rowsFor('$body$', { check: { ...check, pages: 1 } })['Test PDF'].value).toMatch(/^1 page, /);
        // No test PDF on record, or the file has changed since: nothing is said about one.
        expect(rowsFor('$body$')['Test PDF']).toBeUndefined();
    });

    it('names standard paper sizes and gives any other in inches', () => {
        expect(formatPageSize(432, 648)).toBe('6 × 9 in');
        expect(formatPageSize(360, 576)).toBe('5 × 8 in');
        expect(formatPageSize(612, 792)).toBe('8.5 × 11 in (US Letter)');
        expect(formatPageSize(595.276, 841.89)).toBe('8.27 × 11.69 in (A4)');
    });

    it('gives the four built-in layouts different summaries', () => {
        const summaries = ['bundled-fiction-classic-manuscript', 'bundled-fiction-contemporary-literary', 'bundled-fiction-signature-literary', 'bundled-fiction-modern-classic']
            .map(id => rowsFor(getBundledPandocLayoutContent(id) || ''));
        expect(summaries.map(rows => rows.Class.value)).toEqual(['book (11pt, oneside)', 'book (11pt, twoside)', 'book (11pt, twoside)', 'book (11pt, twoside, openany)']);
        expect(summaries.map(rows => rows.Fonts.value)).toEqual(['Arial (main)', 'Source Serif 4 (main)', 'Sorts Mill Goudy (main)', 'lmroman10-regular.otf (main)']);
        expect(summaries[3].Structure.value).toContain('\\rtPart');
        expect(summaries[0].Structure.value).toContain('second-level heading');
        expect(new Set(summaries.map(rows => JSON.stringify(rows))).size).toBe(4);
        for (const rows of summaries) {
            expect(rows['Book Details'].value).toBe('Prints the title and author');
            // They read $header-includes$, so there is nothing to say about PDF settings.
            expect(rows['PDF settings']).toBeUndefined();
        }
    });

    it('reports what depends on a Pandoc variable as such, apart from what is always on', () => {
        const rows = rowsFor([
            '\\documentclass{$documentclass$}',
            '\\usepackage{xcolor}',
            '$if(geometry)$\\usepackage{geometry}$endif$',
            '$if(fancyfont)$\\setmainfont{EB Garamond}$endif$',
            '$body$',
        ].join('\n'));
        expect(rows.Class.value).toBe('Set by the Pandoc variable documentclass');
        expect(rows.Packages.value).toBe('xcolor');
        expect(rows.Packages.note).toBe('Loaded only when a Pandoc variable is set: geometry');
        expect(rows.Fonts.value).toBe('EB Garamond (main), when set');
        expect(rows['Other variables'].value).toBe('documentclass, fancyfont, geometry');
        expect(rows['Other variables'].note).toContain('Custom Pandoc metadata');
        expect(rows['Book Details'].value).toBe('The template does not read the title or author');
        expect(rows['PDF settings'].value).toContain('$header-includes$');
    });

    it('says a plain template names no font and loads no package, without guessing a style', () => {
        const rows = rowsFor('\\documentclass{article}\n\\begin{document}\n$title$\n$body$\n\\end{document}');
        expect(rows.Class.value).toBe('article');
        expect(rows.Fonts.value).toBe('None named in the template');
        expect(rows.Packages.value).toBe('None');
        expect(rows['Book Details'].value).toBe('Prints the title');
        const everything = JSON.stringify(rows).toLowerCase();
        for (const guess of ['confidence', 'detected', 'screenplay', 'literary', 'manuscript formatting', 'approximate']) expect(everything).not.toContain(guess);
    });

    it('shortens a long list and says how many more there are', () => {
        const names = Array.from({ length: 15 }, (_, index) => `pkg${index + 1}`);
        const value = rowsFor(`\\usepackage{${names.join(',')}}\n$body$`).Packages.value;
        expect(value).toBe(`${names.slice(0, 12).join(', ')} and 3 more`);
    });

    it('ends with where the copy is saved and what to do after editing it', () => {
        const row = rowsFor('$body$', { copyPath: 'Radial Timeline/Pandoc/imported/my-book.tex' })['Saved as'];
        expect(row.value).toBe('Radial Timeline/Pandoc/imported/my-book.tex');
        expect(row.note).toContain('Your original file is left as it was');
        expect(row.note).toContain('Check again');
        expect(rowsFor('$body$')['Saved as']).toBeUndefined();
    });
});

describe('imported layout row', () => {
    const rows = buildImportedTemplateFactRows({ facts: readTemplateFacts('\\documentclass{book}\n$body$'), check });

    it('shows the facts, the description, and the saved first page when there is one', () => {
        const root = new ElementStub();
        renderImportedLayoutSummary(root as unknown as HTMLElement, { rows, description: 'Author description', preview: { src: 'app://local/imported/my-book.png', page: 3 } });
        expect(root.find('ert-layout-imported-row')).toHaveLength(rows.length);
        expect(root.allText()).toContain('Author description');
        const [image] = root.find('ert-layout-imported-page');
        expect(image.attr).toEqual({ src: 'app://local/imported/my-book.png', alt: 'Page 3 of the test PDF' });
    });

    it('shows no picture rather than a made-up one', () => {
        const root = new ElementStub();
        renderImportedLayoutSummary(root as unknown as HTMLElement, { rows, description: '', preview: null });
        expect(root.find('ert-layout-imported-preview')).toEqual([]);
        expect(root.find('ert-layout-imported-page')).toEqual([]);
    });
});
