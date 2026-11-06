import { describe, expect, it, vi } from 'vitest';
import type RadialTimelinePlugin from '../main';
import { OnboardingService } from './OnboardingService';
import { getOverlappingBook } from '../utils/books';
import { DEFAULT_SETTINGS } from '../settings/defaults';
import { createInMemoryApp } from '../../tests/helpers/inMemoryObsidian';

function serviceWith(folders: string[]) {
    const plugin = {
        settings: { books: folders.map((sourceFolder, i) => ({ id: `b${i}`, title: `Book ${i + 1}`, sourceFolder })) },
        persistBookSettings: vi.fn(async () => {}),
        setActiveBookId: vi.fn(async () => {}),
    };
    return { service: new OnboardingService(plugin as unknown as RadialTimelinePlugin), plugin };
}

describe('adding a book never overlaps a registered one', () => {
    it('finds equal, parent and child book scopes, but allows siblings and the card itself', () => {
        const { plugin } = serviceWith(['Saga/Book 1']);
        const books = plugin.settings.books as Parameters<typeof getOverlappingBook>[0];
        expect(getOverlappingBook(books, 'Saga')?.title).toBe('Book 1');
        expect(getOverlappingBook(books, 'Saga/Book 1')?.id).toBe('b0');
        expect(getOverlappingBook(books, 'Saga/Book 1/Chapter 1')?.id).toBe('b0');
        expect(getOverlappingBook(books, 'Saga//Book 1/Chapter 1/')?.id).toBe('b0');
        expect(getOverlappingBook(books, 'Saga/Book 1', 'b0')).toBeNull();
        expect(getOverlappingBook(books, '')).toBeNull();
        expect(getOverlappingBook(books, 'Saga/Book 2')).toBeNull();
        expect(getOverlappingBook(books, 'Sagas')).toBeNull();
    });

    it('refuses to add a parent folder of a registered book', async () => {
        const { service, plugin } = serviceWith(['Saga/Book 1']);
        await expect(service.addBook({ title: 'Saga', sourceFolder: 'Saga' })).rejects.toThrow();
        expect(plugin.settings.books).toHaveLength(1);
        expect(plugin.persistBookSettings).not.toHaveBeenCalled();
    });

    it.each(['Saga/Book 1', 'Saga/Book 1/Chapter 1'])('refuses overlapping folder %s at the service boundary', async sourceFolder => {
        const { service, plugin } = serviceWith(['Saga/Book 1']);
        await expect(service.addBook({ title: 'Overlap', sourceFolder })).rejects.toThrow();
        expect(plugin.settings.books).toHaveLength(1);
        expect(plugin.persistBookSettings).not.toHaveBeenCalled();
    });

    it('refuses an overlapping import destination before creating files', async () => {
        const { service, plugin } = serviceWith(['Saga']);
        const createFolder = vi.fn();
        Object.assign(plugin, { app: { vault: { createFolder } } });
        await expect(service.materialize({ id: 'source', title: 'Novel', sourceFolder: 'Saga/Export' }, [], [])).rejects.toThrow();
        expect(createFolder).not.toHaveBeenCalled();
    });

    it('finishes every imported scene from the configured template, with nothing invented', async () => {
        const app = createInMemoryApp({});
        const { service, plugin } = serviceWith([]);
        Object.assign(plugin, { app, settings: { ...DEFAULT_SETTINGS, books: [] } });
        const proposal = { title: 'Arrival', body: 'Prose.', flags: [], frontmatter: { Class: 'Scene', Act: 1, Synopsis: 'Lands', Status: 'Complete', 'Publish Stage': 'Zero' } };
        const report = await service.materialize({ id: 'source', title: 'Novel', sourceFolder: 'Export' }, [proposal as never], []);
        expect(report.errors).toEqual([]);
        const file = app.vault.getMarkdownFiles()[0];
        const content = await app.vault.read(file);
        expect(content).toMatch(/^---\nID: scn_/);
        expect(content).toContain('\nDuration:\n');
        expect(content).toContain('\nDue:\n');
        expect(content).toContain('Status: Complete');
        expect(content).toContain('Prose.');
    });

    it('adds a sibling folder', async () => {
        const { service, plugin } = serviceWith(['Saga/Book 1']);
        await service.addBook({ title: 'Book 2', sourceFolder: 'Saga/Book 2' });
        expect(plugin.settings.books).toHaveLength(2);
    });
});
