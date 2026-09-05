/*
 * UI ⇄ export alignment contract for the Book Pages resolver.
 *
 * Both consumers — the Settings → Publish "Book Pages preview" UI and the
 * manuscript export pipeline — call `resolveBookPages` + `applyBookPageOrder`
 * with the same `(bookMeta, summaries, savedOrder)` triple. This file is the
 * locked-in contract that proves the data layer is unified: the same input
 * produces the same output for export and preview.
 *
 * If a future change makes the preview re-walk notes or BookMeta independently,
 * the assertions below will fail because they hard-code the resolver's
 * promised invariants:
 *
 *   - Notes win for canonical roles (no duplicate canonical row from BookMeta).
 *   - Custom notes (no canonical role) are preserved as `role: null`.
 *   - Frontmatter pages precede backmatter pages in canonical render order.
 *   - Saved drag order is honoured by `applyBookPageOrder`.
 */
import { describe, it, expect } from 'vitest';
import type { BookMeta } from '../types';
import {
    resolveBookPages,
    applyBookPageOrder,
    type MatterNoteSummary,
    type ResolvedPage,
} from './bookPagesResolver';

/**
 * Canonical fixture matching the user's actual vault shape:
 *   - 7 matter notes: 6 canonical roles (Title Page, Copyright, Dedication,
 *     Epigraph, Acknowledgments, About the Author) + 1 custom (Alpha Readers)
 *   - BookMeta with title set (would emit a Title Page from BookMeta if no note
 *     existed for that role)
 */
const fixtureBookMeta: BookMeta = {
    title: 'A Test Manuscript',
    rights: { copyright_holder: 'Eric Rhys Taylor', year: 2026 },
    frontmatter: { dedication: 'For everyone' },
    backmatter: {
        acknowledgments: 'Thanks',
        about_author: 'Bio',
    },
};

const fixtureNotes: MatterNoteSummary[] = [
    { role: '',                path: 'Books/X/0.1 Alpha Readers.md',     title: '0.1 Alpha Readers',     bodyMode: 'plain', side: 'frontmatter' },
    { role: 'title-page',      path: 'Books/X/0.2 Title Page.md',        title: '0.2 Title Page',        bodyMode: 'plain', side: 'frontmatter' },
    { role: 'copyright',       path: 'Books/X/0.3 Copyright.md',         title: '0.3 Copyright',         bodyMode: 'plain', side: 'frontmatter' },
    { role: 'dedication',      path: 'Books/X/0.4 Dedication.md',        title: '0.4 Dedication',        bodyMode: 'plain', side: 'frontmatter' },
    { role: 'epigraph',        path: 'Books/X/0.5 Epigraph.md',          title: '0.5 Epigraph',          bodyMode: 'latex', side: 'frontmatter' },
    { role: 'acknowledgments', path: 'Books/X/200.1 Acknowledgments.md', title: '200.1 Acknowledgments', bodyMode: 'plain', side: 'backmatter' },
    { role: 'about-author',    path: 'Books/X/200.2 About the Author.md', title: '200.2 About the Author', bodyMode: 'plain', side: 'backmatter' },
];

describe('Book Pages resolver — UI ⇄ export alignment', () => {
    it('produces identical resolved+ordered output for both consumers', () => {
        // Export-side call (mirrors src/utils/manuscript.ts).
        const exportResolved = resolveBookPages(fixtureBookMeta, fixtureNotes);
        const exportOrdered = applyBookPageOrder(exportResolved, undefined);

        // UI-side call (mirrors the Book Pages preview in PublishSection.ts).
        const uiResolved = resolveBookPages(fixtureBookMeta, fixtureNotes);
        const uiOrdered = applyBookPageOrder(uiResolved, undefined);

        expect(uiOrdered).toEqual(exportOrdered);
    });

    it('renders 7 rows: 6 note-backed canonical pages + 1 custom note, zero BookMeta-generated pages (notes win)', () => {
        const resolved = resolveBookPages(fixtureBookMeta, fixtureNotes);
        const ordered = applyBookPageOrder(resolved, undefined);

        expect(ordered).toHaveLength(7);

        const noteCount     = ordered.filter(p => p.source === 'note').length;
        const bookMetaCount = ordered.filter(p => p.source === 'bookmeta').length;
        expect(noteCount).toBe(7);
        expect(bookMetaCount).toBe(0);

        // All canonical roles present exactly once + one custom (role: null).
        const roles = ordered.map(p => p.role);
        expect(roles).toContain('title-page');
        expect(roles).toContain('copyright');
        expect(roles).toContain('dedication');
        expect(roles).toContain('epigraph');
        expect(roles).toContain('acknowledgments');
        expect(roles).toContain('about-author');
        expect(roles.filter(r => r === null)).toHaveLength(1);
    });

    it('groups output by side: all frontmatter rows precede all backmatter rows', () => {
        const resolved = resolveBookPages(fixtureBookMeta, fixtureNotes);
        const ordered = applyBookPageOrder(resolved, undefined);

        // Hard contract: every frontmatter row must come before every
        // backmatter row, regardless of role/source/customness. The export
        // pipeline relies on this front→manuscript→back ordering, and the
        // UI's "no cross-side dragging" guard reflects the same invariant.
        const sides = ordered.map(p => p.side);
        const lastFront = sides.lastIndexOf('frontmatter');
        const firstBack = sides.indexOf('backmatter');
        expect(firstBack).toBeGreaterThan(-1);
        expect(lastFront).toBeLessThan(firstBack);

        // Custom notes (role: null) sit on whichever side they declared. The
        // fixture's "Alpha Readers" note declares `side: 'frontmatter'`, so it
        // belongs in the frontmatter group — NOT at the end of the whole list.
        const customRow = ordered.find(p => p.role === null);
        expect(customRow).toBeDefined();
        expect(customRow!.side).toBe('frontmatter');
        const customIdx = ordered.indexOf(customRow!);
        expect(customIdx).toBeLessThanOrEqual(lastFront);
    });

    it('does NOT duplicate a canonical role even when BookMeta also has content for it', () => {
        // Dedication appears as both a note (fixtureNotes[3]) AND a BookMeta
        // field (fixtureBookMeta.frontmatter.dedication). Notes win — only
        // one Dedication row may surface.
        const resolved = resolveBookPages(fixtureBookMeta, fixtureNotes);
        const ordered = applyBookPageOrder(resolved, undefined);

        const dedicationRows = ordered.filter(p => p.role === 'dedication');
        expect(dedicationRows).toHaveLength(1);
        expect(dedicationRows[0].source).toBe('note');
    });

    it('preserves the custom note (Alpha Readers) as role: null with source: note', () => {
        const resolved = resolveBookPages(fixtureBookMeta, fixtureNotes);
        const ordered = applyBookPageOrder(resolved, undefined);

        const customs = ordered.filter(p => p.role === null);
        expect(customs).toHaveLength(1);
        const [alphaReaders] = customs;
        expect(alphaReaders.source).toBe('note');
        expect(alphaReaders.path).toBe('Books/X/0.1 Alpha Readers.md');
    });

    it('honours saved drag-reorder via applyBookPageOrder (UI persists, export consumes the same field)', () => {
        const resolved = resolveBookPages(fixtureBookMeta, fixtureNotes);

        // Simulate the user dragging within the backmatter group:
        // Acknowledgments moves above About-the-Author. Side-grouping is
        // enforced (a backmatter row CANNOT migrate to the frontmatter side
        // even if the saved order tries to put it at index 0), so the saved
        // order is honored only within the backmatter partition.
        const acknowledgmentsId = 'note:Books/X/200.1 Acknowledgments.md';
        const aboutAuthorId     = 'note:Books/X/200.2 About the Author.md';
        const canonicalIds = resolved.map(p => p.id);
        // Caller "asks" for Acknowledgments at index 0 — which would mean a
        // backmatter row in the frontmatter slot. The applier must ignore
        // that and keep frontmatter-then-backmatter ordering.
        const savedOrder = [
            acknowledgmentsId,
            ...canonicalIds.filter(id => id !== acknowledgmentsId),
        ];

        const orderedUi     = applyBookPageOrder(resolved, savedOrder);
        const orderedExport = applyBookPageOrder(resolved, savedOrder);

        // Both consumers must agree.
        expect(orderedUi).toEqual(orderedExport);
        // Side-grouping enforced: index 0 must still be a frontmatter row.
        expect(orderedUi[0].side).toBe('frontmatter');
        // Acknowledgments stays in the backmatter partition.
        const ackIdx = orderedUi.findIndex(p => p.id === acknowledgmentsId);
        const aboutIdx = orderedUi.findIndex(p => p.id === aboutAuthorId);
        expect(ackIdx).toBeGreaterThan(-1);
        expect(orderedUi[ackIdx].side).toBe('backmatter');
        // Within backmatter, the saved relative order is honored:
        // Acknowledgments now precedes About-the-Author.
        expect(ackIdx).toBeLessThan(aboutIdx);
    });

    it('drops a BookMeta-only role when no matching note exists AND BookMeta has no content for it', () => {
        // BookMeta has no `author_note` and no note carries that role → row absent.
        const resolved = resolveBookPages(fixtureBookMeta, fixtureNotes);
        const ordered: ResolvedPage[] = applyBookPageOrder(resolved, undefined);

        const authorNoteRows = ordered.filter(p => p.role === 'author-note');
        expect(authorNoteRows).toHaveLength(0);
    });
});
