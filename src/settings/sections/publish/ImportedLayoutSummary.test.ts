import { describe, expect, it, vi } from 'vitest';
import {
    buildImportedTemplateFactRows, formatPageSize, renderImportedLayoutSummary, renderImportedTemplateFacts,
    type ImportedTemplateFactRow,
} from './ImportedLayoutSummary';
import { readTemplateFacts } from '../../../publishing/templateFacts';
import type { ImportedTemplateCheckRecord } from '../../../publishing/importedTemplateCheck';
import { getBundledPandocLayoutContent } from '../../../utils/pandocBundledLayouts';

// The tooltip helper reads the live DOM; here a tooltip is recorded as the label a screen reader gets.
vi.mock('../../../utils/domTooltip', () => ({
    setTooltip: (element: { setAttribute(name: string, value: string): void }, text: string) => element.setAttribute('aria-label', text),
}));

class ElementStub {
    children: ElementStub[] = []; text = ''; cls = ''; tag = 'div'; attr: Record<string, string> = {};
    listeners: Record<string, () => void> = {};
    createDiv(options: { text?: string; cls?: string } = {}) { return this.createEl('div', options); }
    createSpan(options: { text?: string; cls?: string; attr?: Record<string, string> } = {}) { return this.createEl('span', options); }
    createEl(tag: string, options: { text?: string; cls?: string; attr?: Record<string, string> } = {}) {
        const child = new ElementStub();
        child.tag = tag; child.text = options.text ?? ''; child.cls = options.cls ?? ''; child.attr = { ...options.attr };
        this.children.push(child);
        return child;
    }
    setAttribute(name: string, value: string) { this.attr[name] = value; }
    onClickEvent(listener: () => void) { this.listeners.click = listener; }
    find(cls: string): ElementStub[] { return [...(this.cls.split(' ').includes(cls) ? [this] : []), ...this.children.flatMap(child => child.find(cls))]; }
    allText(): string { return [this.text, ...this.children.map(child => child.allText())].filter(Boolean).join(' | '); }
}

const check: ImportedTemplateCheckRecord = { schemaVersion: 1, sha256: 'x', checkedAt: '2026-11-19T12:00:00.000Z', pages: 4, pageWidthPt: 432, pageHeightPt: 648, samplePage: 3 };
const COPY = 'Radial Timeline/Pandoc/imported/my-book.tex';
const rowsFor = (tex: string, extra: { check?: ImportedTemplateCheckRecord; copyPath?: string; filledFields?: string[] } = {}): Record<string, ImportedTemplateFactRow> =>
    Object.fromEntries(buildImportedTemplateFactRows({ facts: readTemplateFacts(tex), ...extra }).map(row => [row.label, row]));

describe('imported template facts', () => {
    it('states the test PDF as measured, with the explanation behind the info icon', () => {
        const row = rowsFor('$body$', { check })['Test PDF'];
        expect(row.value).toMatch(/^4 pages, 6 × 9 in, built .*2026/);
        expect(row.info).toContain('short sample manuscript');
        expect(row.detail).toBeUndefined();
        expect(rowsFor('$body$', { check: { ...check, pages: 1 } })['Test PDF'].value).toMatch(/^1 page, /);
        // No test PDF built here, or the file has changed since: nothing is said about one.
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
        expect(summaries.map(rows => rows['Document class'].value)).toEqual(['book (11pt, oneside)', 'book (11pt, twoside)', 'book (11pt, twoside)', 'book (11pt, twoside, openany)']);
        expect(summaries.map(rows => rows.Fonts.value)).toEqual(['Arial (body text)', 'Source Serif 4 (body text)', 'Sorts Mill Goudy (body text)', 'lmroman10-regular.otf (body text)']);
        expect(summaries.map(rows => rows['Chapters and parts'].value)).toEqual([
            'Not printed; scenes print as headings', 'Not printed; scenes print as headings', 'Not printed; scenes print as headings', 'Printed in the template\'s own styles',
        ]);
        expect(new Set(summaries.map(rows => JSON.stringify(rows))).size).toBe(4);
        for (const rows of summaries) {
            expect(rows['Book Details'].value).toBe('Title and author');
            // They read $header-includes$, so there is nothing to say about the binding margin.
            expect(rows['Binding margin']).toBeUndefined();
            // The only other field they read is one Pandoc fills itself: nothing for the author to fill.
            expect(rows['Fields to fill']).toBeUndefined();
        }
    });

    it('keeps every row to one short line and puts the explanation behind its info icon', () => {
        const rows = buildImportedTemplateFactRows({
            facts: readTemplateFacts('\\documentclass{book}\n\\usepackage{geometry}\n$publisher$\n$body$'), check, copyPath: COPY,
        });
        for (const row of rows) {
            expect(row.info?.length, row.label).toBeGreaterThan(40);
            expect(row.value.length, row.label).toBeLessThanOrEqual(60);
        }
    });

    it('lists the fields the author fills, with where to fill them, and leaves out the ones Pandoc fills', () => {
        const tex = '\\documentclass{book}\n$if(highlighting-macros)$$highlighting-macros$$endif$\n$publisher$ $lang$\n$body$';
        const row = rowsFor(tex)['Fields to fill'];
        expect(row.value).toBe('lang, publisher');
        expect(row.next).toEqual([{ kind: 'setting', trail: ['Settings', 'Publish', 'Custom Pandoc metadata'] }]);
        expect(row.info).toContain('publisher: Your Press');
        expect(row.info).toContain('Pandoc fills these itself: highlighting-macros.');
        // A field already filled under Custom Pandoc metadata is shown as filled.
        const partly = rowsFor(tex, { filledFields: ['lang', 'unrelated'] })['Fields to fill'];
        expect([partly.value, partly.detail]).toEqual(['publisher', 'Filled: lang']);
        const all = rowsFor(tex, { filledFields: ['lang', 'publisher'] })['Fields to fill'];
        expect([all.value, all.detail]).toEqual(['All filled', 'Filled: lang, publisher']);
    });

    it('reports what depends on a field as such, apart from what is always on', () => {
        const rows = rowsFor([
            '\\documentclass{$documentclass$}',
            '\\usepackage{xcolor}',
            '$if(geometry)$\\usepackage{geometry}$endif$',
            '$if(fancyfont)$\\setmainfont{EB Garamond}$endif$',
            '$body$',
        ].join('\n'));
        expect(rows['Document class'].value).toBe('Set by the documentclass field');
        expect(rows['Document class'].info).toContain('"article"');
        expect(rows['LaTeX packages'].value).toBe('xcolor');
        expect(rows['LaTeX packages'].detail).toBe('Only when a field is filled: geometry');
        expect(rows.Fonts.value).toBe('EB Garamond (body text), when set');
        expect(rows['Fields to fill'].value).toBe('fancyfont, geometry');
        expect(rows['Book Details'].value).toBe('Not printed');
        expect(rows['Binding margin'].value).toBe('Not applied by this template');
    });

    it('says a plain template names no font and loads no package, without guessing a style', () => {
        const rows = rowsFor('\\documentclass{article}\n\\begin{document}\n$title$\n$body$\n\\end{document}');
        expect(rows['Document class'].value).toBe('article');
        expect(rows.Fonts.value).toBe('None named');
        expect(rows['LaTeX packages'].value).toBe('None');
        expect(rows['Book Details'].value).toBe('Title');
        const everything = JSON.stringify(rows).toLowerCase();
        for (const guess of ['confidence', 'detected', 'screenplay', 'literary', 'manuscript formatting', 'approximate']) expect(everything).not.toContain(guess);
    });

    it('shortens a long list and says how many more there are', () => {
        const names = Array.from({ length: 15 }, (_, index) => `pkg${index + 1}`);
        const value = rowsFor(`\\usepackage{${names.join(',')}}\n$body$`)['LaTeX packages'].value;
        expect(value).toBe(`${names.slice(0, 12).join(', ')} and 3 more`);
    });

    it('names the template file once, on its own row, and points chapters at the guide', () => {
        const rows = rowsFor('\\documentclass{book}\n$body$', { copyPath: COPY });
        const guide = { kind: 'guide', label: 'How to add chapters and parts', wikiPage: 'Manuscript-Export#add-chapters-and-parts' };
        expect(rows['Template file']).toMatchObject({ value: '', next: [{ kind: 'file', path: COPY }] });
        expect(rows['Template file'].info).toContain('your original file is left as it was');
        expect(rows['Template file'].info).toContain('Check again');
        expect(rows['Chapters and parts'].next).toEqual([guide]);
        expect(rows['Chapters and parts'].info).toContain('\\rtPart, \\rtChapter and \\rtSceneSep');
        // A row that asks for a change to the template says so in its explanation
        // and does not repeat the file.
        for (const label of ['Chapters and parts', 'Binding margin', 'Book Details']) {
            expect(rows[label].info).toContain('the template file');
        }
        expect(rows['Binding margin'].next).toBeUndefined();
        expect(rows['Book Details'].next).toBeUndefined();
        const fileSteps = Object.values(rows).flatMap(row => row.next ?? []).filter(step => step.kind === 'file');
        expect(fileSteps).toHaveLength(1);
        // Before the copy exists (the dialog's Check step) there is no file row.
        const early = rowsFor('\\documentclass{book}\n$body$');
        expect(early['Template file']).toBeUndefined();
        expect(early['Chapters and parts'].next).toEqual([guide]);
        // A template that already prints chapters and parts has nothing to change.
        const structural = rowsFor(getBundledPandocLayoutContent('bundled-fiction-modern-classic') || '', { copyPath: COPY });
        expect(structural['Chapters and parts'].next).toBeUndefined();
    });
});

describe('drawing the rows', () => {
    const rows = buildImportedTemplateFactRows({
        facts: readTemplateFacts('\\documentclass{book}\n$publisher$\n$body$'), check, copyPath: COPY,
    });

    it('gives each row an info icon whose tooltip is the explanation', () => {
        const root = new ElementStub();
        renderImportedTemplateFacts(root as unknown as HTMLElement, rows);
        const icons = root.find('ert-layout-imported-info');
        expect(icons).toHaveLength(rows.length);
        expect(icons.map(icon => icon.attr['aria-label'])).toEqual(rows.map(row => row.info));
        // The explanation is in the tooltip, not on the page.
        expect(root.allText()).not.toContain('Radial Timeline does not fill them');
    });

    it('keeps an info icon with the last word of its value, so it never wraps alone', () => {
        const root = new ElementStub();
        renderImportedTemplateFacts(root as unknown as HTMLElement, [
            { label: 'Fonts', value: 'EB Garamond (body text)', info: 'Why' },
            { label: 'Class', value: 'book', info: 'Why' },
        ]);
        const [fonts, single] = root.find('ert-layout-imported-tail');
        expect(fonts.text).toBe('text) ');
        expect(fonts.find('ert-layout-imported-info')).toHaveLength(1);
        expect(single.text).toBe('book ');
        // The words before the last one are whole and in order.
        expect(root.allText()).toContain('EB Garamond (body ');
    });

    it('shows a settings location as a trail, and makes it a button when it can take the author there', () => {
        const shown = new ElementStub();
        renderImportedTemplateFacts(shown as unknown as HTMLElement, rows);
        const [staticTrail] = shown.find('ert-layout-imported-trail');
        expect(staticTrail.find('ert-layout-imported-trail-place').map(place => place.text)).toEqual(['Settings', 'Publish', 'Custom Pandoc metadata']);

        const openSetting = vi.fn();
        const live = new ElementStub();
        renderImportedTemplateFacts(live as unknown as HTMLElement, rows, { openSetting });
        const [button] = live.find('ert-layout-imported-trail');
        expect(button.tag).toBe('button');
        expect(staticTrail.tag).toBe('span');
        button.listeners.click();
        expect(openSetting).toHaveBeenCalledOnce();
    });

    it('shows the template file as folder and name, with Open and Show in folder when they can act', () => {
        const openFile = vi.fn(); const showFile = vi.fn();
        const root = new ElementStub();
        renderImportedTemplateFacts(root as unknown as HTMLElement, rows, { openFile, showFile });
        // The file is on the card once, on the Template file row.
        const files = root.find('ert-layout-imported-file');
        expect(files).toHaveLength(1);
        expect(files[0].tag).toBe('span');
        expect(files[0].find('ert-layout-imported-file-folder')[0].text).toBe('Radial Timeline/Pandoc/imported/');
        expect(files[0].find('ert-layout-imported-file-name')[0].text).toBe('my-book.tex');
        // Open and Show in folder sit beside it.
        const actions = root.find('ert-layout-imported-fileAction');
        expect(actions.map(action => action.text)).toEqual(['Open', 'Show in folder']);
        actions[0].listeners.click();
        actions[1].listeners.click();
        expect(openFile).toHaveBeenCalledTimes(1);
        expect(openFile).toHaveBeenCalledWith(COPY);
        expect(showFile).toHaveBeenCalledWith(COPY);

        const still = new ElementStub();
        renderImportedTemplateFacts(still as unknown as HTMLElement, rows);
        expect(still.find('ert-layout-imported-fileAction')).toEqual([]);
    });

    it('links the chapters row to the guide', () => {
        const root = new ElementStub();
        renderImportedTemplateFacts(root as unknown as HTMLElement, rows);
        const [guide] = root.find('ert-layout-imported-guide');
        expect(guide.text).toBe('How to add chapters and parts');
        expect(guide.attr.href).toBe('https://docs.radialtimeline.com/Manuscript-Export/#add-chapters-and-parts');
    });
});

describe('imported layout row', () => {
    const rows = buildImportedTemplateFactRows({ facts: readTemplateFacts('\\documentclass{book}\n$body$'), check });

    it('shows the facts, the description, and the saved page when there is one', () => {
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
