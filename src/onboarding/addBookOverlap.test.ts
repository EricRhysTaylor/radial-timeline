import { describe, expect, it, vi } from 'vitest';
import type RadialTimelinePlugin from '../main';
import { OnboardingService } from './OnboardingService';
import { getBookInsideFolder } from '../utils/books';

function serviceWith(folders: string[]) {
    const plugin = {
        settings: { books: folders.map((sourceFolder, i) => ({ id: `b${i}`, title: `Book ${i + 1}`, sourceFolder })) },
        persistBookSettings: vi.fn(async () => {}),
        setActiveBookId: vi.fn(async () => {}),
    };
    return { service: new OnboardingService(plugin as unknown as RadialTimelinePlugin), plugin };
}

describe('adding a book never overlaps a registered one', () => {
    it('finds a registered book inside the chosen folder, not the folder itself or a sibling', () => {
        const { plugin } = serviceWith(['Saga/Book 1']);
        const books = plugin.settings.books as Parameters<typeof getBookInsideFolder>[0];
        expect(getBookInsideFolder(books, 'Saga')?.title).toBe('Book 1');
        expect(getBookInsideFolder(books, 'Saga/Book 1')).toBeNull();
        expect(getBookInsideFolder(books, 'Saga/Book 2')).toBeNull();
        expect(getBookInsideFolder(books, 'Sagas')).toBeNull();
    });

    it('refuses to add a parent folder of a registered book', async () => {
        const { service, plugin } = serviceWith(['Saga/Book 1']);
        await expect(service.addBook({ title: 'Saga', sourceFolder: 'Saga' })).rejects.toThrow();
        expect(plugin.settings.books).toHaveLength(1);
        expect(plugin.persistBookSettings).not.toHaveBeenCalled();
    });

    it('adds a sibling folder', async () => {
        const { service, plugin } = serviceWith(['Saga/Book 1']);
        await service.addBook({ title: 'Book 2', sourceFolder: 'Saga/Book 2' });
        expect(plugin.settings.books).toHaveLength(2);
    });
});
