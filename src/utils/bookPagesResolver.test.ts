import { describe, it, expect } from 'vitest';
import type { BookMeta } from '../types';
import {
    resolveBookPages,
    inferRoleFromFilename,
    applyBookPageOrder,
    type MatterNoteSummary,
    type ResolvedPage,
} from './bookPagesResolver';

const baseBookMeta: BookMeta = {
    title: 'Untitled',
    rights: { copyright_holder: 'Holder', year: 2026 },
    frontmatter: { dedication: 'For someone' },
    backmatter: {},
};

const dedicationNote: MatterNoteSummary = {
    role: 'dedication',
    path: 'Books/X/0.4 Dedication.md',
    title: '0.4 Dedication',
    bodyMode: 'plain',
    side: 'frontmatter',
};

describe('resolveBookPages', () => {
    it('uses the note when a note overrides BookMeta for the same role', () => {
        const pages = resolveBookPages(baseBookMeta, [dedicationNote]);
        const dedication = pages.find(p => p.role === 'dedication');
        expect(dedication).toBeDefined();
        expect(dedication?.source).toBe('note');
        expect(dedication?.path).toBe(dedicationNote.path);
        // No duplicate bookmeta-source entry for the same role.
        const dedicationCount = pages.filter(p => p.role === 'dedication').length;
        expect(dedicationCount).toBe(1);
    });

    it('falls back to BookMeta when no note exists for a role', () => {
        const pages = resolveBookPages(baseBookMeta, []);
        const dedication = pages.find(p => p.role === 'dedication');
        expect(dedication).toBeDefined();
        expect(dedication?.source).toBe('bookmeta');
        expect(dedication?.path).toBeUndefined();
    });

    it('a disabled canonical-role note steps aside so BookMeta resurfaces', () => {
        const disabled: MatterNoteSummary = { ...dedicationNote, enabled: false };
        const pages = resolveBookPages(baseBookMeta, [disabled]);
        const dedication = pages.find(p => p.role === 'dedication');
        // The note is dropped; BookMeta fills the dedication slot instead.
        expect(dedication).toBeDefined();
        expect(dedication?.source).toBe('bookmeta');
        expect(pages.some(p => p.path === disabled.path)).toBe(false);
    });

    it('a disabled custom note is dropped entirely (no BookMeta to resurface)', () => {
        const customDisabled: MatterNoteSummary = {
            role: '',
            path: 'Books/X/0.9 Bonus Quote.md',
            title: '0.9 Bonus Quote',
            bodyMode: 'latex',
            side: 'frontmatter',
            enabled: false,
        };
        const pages = resolveBookPages(baseBookMeta, [customDisabled]);
        expect(pages.some(p => p.path === customDisabled.path)).toBe(false);
    });

    it('enabled:true and undefined both resolve normally (no migration needed)', () => {
        const explicitTrue: MatterNoteSummary = { ...dedicationNote, enabled: true };
        const undefinedFlag: MatterNoteSummary = { ...dedicationNote };
        for (const note of [explicitTrue, undefinedFlag]) {
            const pages = resolveBookPages(baseBookMeta, [note]);
            const dedication = pages.find(p => p.role === 'dedication');
            expect(dedication?.source).toBe('note');
            expect(dedication?.path).toBe(note.path);
        }
    });

    it('excludes roles with neither note nor BookMeta content', () => {
        // BookMeta has no epigraph, no acknowledgments — they must NOT appear.
        const pages = resolveBookPages(baseBookMeta, []);
        expect(pages.find(p => p.role === 'epigraph')).toBeUndefined();
        expect(pages.find(p => p.role === 'acknowledgments')).toBeUndefined();
        expect(pages.find(p => p.role === 'about-author')).toBeUndefined();
    });

    it('emits exactly one row per role even when input has duplicate notes', () => {
        const dupA: MatterNoteSummary = { ...dedicationNote, path: 'A.md', title: 'A' };
        const dupB: MatterNoteSummary = { ...dedicationNote, path: 'B.md', title: 'B' };
        const pages = resolveBookPages(baseBookMeta, [dupA, dupB]);
        const dedicationRows = pages.filter(p => p.role === 'dedication');
        expect(dedicationRows.length).toBe(1);
        // Deterministic rule: first input wins.
        expect(dedicationRows[0].path).toBe('A.md');
    });

    it('propagates the body mode from the note', () => {
        const latexNote: MatterNoteSummary = { ...dedicationNote, bodyMode: 'latex' };
        const pages = resolveBookPages(undefined, [latexNote]);
        const dedication = pages.find(p => p.role === 'dedication');
        expect(dedication?.source).toBe('note');
        expect(dedication?.bodyMode).toBe('latex');
    });

    it('infers role from filename when explicit Role is missing', () => {
        // User's existing notes that lack `Role:` yaml — must still dedupe.
        const noRoleTitle: MatterNoteSummary = {
            role: '',
            path: 'Books/X/0.2 Title Page.md',
            title: '0.2 Title Page',
            bodyMode: 'latex',
            side: 'frontmatter',
        };
        const pages = resolveBookPages(baseBookMeta, [noRoleTitle]);
        const titlePages = pages.filter(p => p.role === 'title-page');
        expect(titlePages.length).toBe(1);
        expect(titlePages[0].source).toBe('note');
        expect(titlePages[0].path).toBe(noRoleTitle.path);
    });

    it('explicit Role yaml ALWAYS wins over filename inference', () => {
        // Filename says "Title Page" but Role: dedication wins.
        const conflicted: MatterNoteSummary = {
            role: 'dedication',
            path: 'Books/X/0.2 Title Page.md',
            title: '0.2 Title Page',
            bodyMode: 'plain',
            side: 'frontmatter',
        };
        const pages = resolveBookPages(undefined, [conflicted]);
        const ded = pages.find(p => p.role === 'dedication');
        expect(ded?.source).toBe('note');
        expect(ded?.path).toBe(conflicted.path);
        // Title-page row should NOT be derived from this note.
        expect(pages.find(p => p.role === 'title-page')?.source).not.toBe('note');
    });

    it('surfaces custom notes (no canonical role match) with role: null', () => {
        const custom: MatterNoteSummary = {
            role: '',
            path: 'Books/X/0.6 Title 2.md',
            title: '0.6 Title 2',
            bodyMode: 'plain',
            side: 'frontmatter',
        };
        const pages = resolveBookPages(undefined, [custom]);
        const customPages = pages.filter(p => p.role === null);
        expect(customPages.length).toBe(1);
        expect(customPages[0].source).toBe('note');
        expect(customPages[0].path).toBe(custom.path);
    });

    it('two filename-inferred notes with the same role → first-wins dedup', () => {
        const a: MatterNoteSummary = {
            role: '',
            path: 'A/0.2 Title Page.md',
            title: '0.2 Title Page',
            bodyMode: 'plain',
            side: 'frontmatter',
        };
        const b: MatterNoteSummary = {
            role: '',
            path: 'B/0.5 Titlepage.md',
            title: '0.5 Titlepage',
            bodyMode: 'plain',
            side: 'frontmatter',
        };
        const pages = resolveBookPages(undefined, [a, b]);
        const titleRows = pages.filter(p => p.role === 'title-page');
        expect(titleRows.length).toBe(1);
        expect(titleRows[0].path).toBe(a.path);
    });

    it('user fixture: BookMeta + legacy notes without Role: collapse correctly', () => {
        // The exact filenames called out in the spec.
        const notes: MatterNoteSummary[] = [
            { role: '', path: 'Book/0.1 Alpha Readers.md',  title: '0.1 Alpha Readers',  bodyMode: 'plain', side: 'frontmatter' },
            { role: '', path: 'Book/0.2 Title Page.md',     title: '0.2 Title Page',     bodyMode: 'latex', side: 'frontmatter' },
            { role: '', path: 'Book/0.3 Copyright.md',      title: '0.3 Copyright',      bodyMode: 'latex', side: 'frontmatter' },
            { role: '', path: 'Book/0.4 Dedication.md',     title: '0.4 Dedication',     bodyMode: 'plain', side: 'frontmatter' },
            { role: '', path: 'Book/0.5 Epigraph.md',       title: '0.5 Epigraph',       bodyMode: 'plain', side: 'frontmatter' },
            { role: '', path: 'Book/0.6 Title 2.md',        title: '0.6 Title 2',        bodyMode: 'plain', side: 'frontmatter' },
            { role: '', path: 'Book/0.7 Quotation.md',      title: '0.7 Quotation',      bodyMode: 'plain', side: 'frontmatter' },
        ];
        const bookMeta: BookMeta = {
            title: 'My Book',
            rights: { copyright_holder: 'Author', year: 2026 },
            frontmatter: {},
            backmatter: {},
        };
        const pages = resolveBookPages(bookMeta, notes);

        // BookMeta has title-page + copyright content, but the notes also exist —
        // the notes win, so we get exactly ONE title-page and ONE copyright row,
        // both `source: 'note'`.
        const titles = pages.filter(p => p.role === 'title-page');
        const copyrights = pages.filter(p => p.role === 'copyright');
        expect(titles.length).toBe(1);
        expect(titles[0].source).toBe('note');
        expect(copyrights.length).toBe(1);
        expect(copyrights[0].source).toBe('note');

        // Dedication and epigraph come from notes (filename-inferred).
        expect(pages.find(p => p.role === 'dedication')?.source).toBe('note');
        expect(pages.find(p => p.role === 'epigraph')?.source).toBe('note');

        // Custom notes (Alpha Readers, Title 2, Quotation) appear with role: null.
        const customs = pages.filter(p => p.role === null);
        expect(customs.map(c => c.path)).toEqual([
            'Book/0.1 Alpha Readers.md',
            'Book/0.6 Title 2.md',
            'Book/0.7 Quotation.md',
        ]);
    });
});

describe('inferRoleFromFilename', () => {
    it('matches canonical roles with numeric prefix and spaces', () => {
        expect(inferRoleFromFilename('0.2 Title Page.md')).toBe('title-page');
        expect(inferRoleFromFilename('0.3 Copyright.md')).toBe('copyright');
        expect(inferRoleFromFilename('0.4 Dedication.md')).toBe('dedication');
        expect(inferRoleFromFilename('0.5 Epigraph.md')).toBe('epigraph');
        expect(inferRoleFromFilename('200.1 Acknowledgments.md')).toBe('acknowledgments');
        expect(inferRoleFromFilename('200.2 About the Author.md')).toBe('about-author');
        expect(inferRoleFromFilename("200.3 Author's Note.md")).toBe('author-note');
        expect(inferRoleFromFilename('200.4 Other Works.md')).toBe('other-works');
    });

    it('strips full vault paths', () => {
        expect(inferRoleFromFilename('Books/My Book/0.2 Title Page.md')).toBe('title-page');
    });

    it('handles British spelling and singular/plural variants', () => {
        expect(inferRoleFromFilename('Acknowledgements.md')).toBe('acknowledgments');
        expect(inferRoleFromFilename('Acknowledgement.md')).toBe('acknowledgments');
        expect(inferRoleFromFilename('Dedications.md')).toBe('dedication');
    });

    it('is lenient about separators and case', () => {
        expect(inferRoleFromFilename('TITLE_PAGE.md')).toBe('title-page');
        expect(inferRoleFromFilename('title-page.md')).toBe('title-page');
        expect(inferRoleFromFilename('Title  Page.md')).toBe('title-page');
        expect(inferRoleFromFilename('about-the-author.md')).toBe('about-author');
    });

    it('returns null for non-matches (custom pages)', () => {
        expect(inferRoleFromFilename('0.6 Title 2.md')).toBeNull();
        expect(inferRoleFromFilename('0.1 Alpha Readers.md')).toBeNull();
        expect(inferRoleFromFilename('0.7 Quotation.md')).toBeNull();
        expect(inferRoleFromFilename('Random Note.md')).toBeNull();
    });

    it('returns null for empty / numeric-only input', () => {
        expect(inferRoleFromFilename('')).toBeNull();
        expect(inferRoleFromFilename('0.2 .md')).toBeNull();
    });
});

describe('applyBookPageOrder', () => {
    const samplePages = (): ResolvedPage[] => ([
        { id: 'note:Book/0.2 Title Page.md', role: 'title-page', side: 'frontmatter', source: 'note', title: '0.2 Title Page', bodyMode: 'latex', path: 'Book/0.2 Title Page.md' },
        { id: 'bookmeta:copyright',           role: 'copyright',  side: 'frontmatter', source: 'bookmeta', title: 'Copyright' },
        { id: 'note:Book/0.4 Dedication.md',  role: 'dedication', side: 'frontmatter', source: 'note', title: '0.4 Dedication', bodyMode: 'plain', path: 'Book/0.4 Dedication.md' },
    ]);

    it('returns canonical order unchanged when saved is undefined', () => {
        const pages = samplePages();
        const result = applyBookPageOrder(pages, undefined);
        expect(result.map(p => p.id)).toEqual(pages.map(p => p.id));
    });

    it('returns canonical order unchanged when saved is empty', () => {
        const pages = samplePages();
        const result = applyBookPageOrder(pages, []);
        expect(result.map(p => p.id)).toEqual(pages.map(p => p.id));
    });

    it('reorders to match a full saved order', () => {
        const pages = samplePages();
        const saved = [
            'note:Book/0.4 Dedication.md',
            'note:Book/0.2 Title Page.md',
            'bookmeta:copyright',
        ];
        const result = applyBookPageOrder(pages, saved);
        expect(result.map(p => p.id)).toEqual(saved);
    });

    it('appends new (unsaved) pages at the end in canonical order', () => {
        const pages = samplePages();
        // saved knows about only the first two — third (dedication) is new.
        const saved = ['bookmeta:copyright', 'note:Book/0.2 Title Page.md'];
        const result = applyBookPageOrder(pages, saved);
        expect(result.map(p => p.id)).toEqual([
            'bookmeta:copyright',
            'note:Book/0.2 Title Page.md',
            'note:Book/0.4 Dedication.md',
        ]);
    });

    it('silently drops removed pages from saved', () => {
        const pages = samplePages();
        const saved = [
            'note:Book/0.4 Dedication.md',
            'note:Book/Deleted Page.md',           // no longer exists
            'bookmeta:copyright',
            'note:Book/0.2 Title Page.md',
        ];
        const result = applyBookPageOrder(pages, saved);
        expect(result.map(p => p.id)).toEqual([
            'note:Book/0.4 Dedication.md',
            'bookmeta:copyright',
            'note:Book/0.2 Title Page.md',
        ]);
    });

    it('combined: resolver + saved order + filename inference', () => {
        const notes: MatterNoteSummary[] = [
            { role: '', path: 'Book/0.2 Title Page.md', title: '0.2 Title Page', bodyMode: 'latex', side: 'frontmatter' },
            { role: '', path: 'Book/0.4 Dedication.md', title: '0.4 Dedication', bodyMode: 'plain', side: 'frontmatter' },
            { role: '', path: 'Book/0.6 Title 2.md',    title: '0.6 Title 2',    bodyMode: 'plain', side: 'frontmatter' },
        ];
        const bookMeta: BookMeta = {
            title: 'X',
            rights: { copyright_holder: 'Y', year: 2026 },
            frontmatter: {},
            backmatter: {},
        };
        const resolved = resolveBookPages(bookMeta, notes);
        // User dragged the custom page (Title 2) to the top.
        const saved = ['note:Book/0.6 Title 2.md'];
        const result = applyBookPageOrder(resolved, saved);
        expect(result[0].path).toBe('Book/0.6 Title 2.md');
        expect(result[0].role).toBeNull();
        // The remaining canonical pages follow in canonical order.
        expect(result.slice(1).map(p => p.id)).toEqual(
            resolved.filter(p => p.id !== 'note:Book/0.6 Title 2.md').map(p => p.id)
        );
    });
});
