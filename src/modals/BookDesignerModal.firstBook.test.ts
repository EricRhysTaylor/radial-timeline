import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Modal } from 'obsidian';
import type { App } from 'obsidian';
import type RadialTimelinePlugin from '../main';
import type { BookProfile } from '../types/settings';

const firstBook = vi.hoisted(() => ({ ensure: vi.fn(), notices: [] as string[] }));
vi.mock('./EnsureFirstBookModal', () => ({ ensureActiveBookFolder: firstBook.ensure }));
vi.mock('../../tests/mocks/obsidian.ts', async importOriginal => ({
    ...await importOriginal<typeof import('obsidian')>(),
    Notice: class { constructor(message: string) { firstBook.notices.push(message); } },
}));

import { BookDesignerModal } from './BookDesignerModal';

function designer(books: Array<Partial<BookProfile>>) {
    const plugin = { settings: { books, activeBookId: books[0]?.id, actCount: 3 } } as unknown as RadialTimelinePlugin; // SAFE: opening reads only the book list
    return new BookDesignerModal({} as App, plugin);
}

describe('Book Designer with no book yet', () => {
    let shellOpens: ReturnType<typeof vi.spyOn>;
    beforeEach(() => {
        firstBook.ensure.mockReset();
        shellOpens = vi.spyOn(Modal.prototype, 'open');
        shellOpens.mockClear();
    });

    it('shows only the first-book prompt, then Book Designer once the book exists', async () => {
        let resolve!: (book: BookProfile | null) => void;
        firstBook.ensure.mockReturnValue(new Promise(done => { resolve = done; }));
        designer([]).open();
        expect(firstBook.ensure).toHaveBeenCalledOnce();
        expect(shellOpens).not.toHaveBeenCalled();
        resolve({ id: 'b1', title: 'The Keeper’s Log', sourceFolder: 'The Keeper’s Log' } as BookProfile);
        await vi.waitFor(() => expect(shellOpens).toHaveBeenCalledOnce());
    });

    it('says so when the first-book prompt fails, instead of swallowing it', async () => {
        firstBook.notices.length = 0;
        firstBook.ensure.mockRejectedValue(new Error('Folder could not be created'));
        designer([]).open();
        await vi.waitFor(() => expect(firstBook.notices).toEqual(['Book designer could not open: Folder could not be created']));
        expect(shellOpens).not.toHaveBeenCalled();
    });

    it('opens nothing when the prompt is cancelled', async () => {
        firstBook.ensure.mockResolvedValue(null);
        designer([]).open();
        await Promise.resolve(); await Promise.resolve();
        expect(shellOpens).not.toHaveBeenCalled();
    });

    it('asks for a folder when the book has none', () => {
        firstBook.ensure.mockReturnValue(new Promise(() => undefined));
        designer([{ id: 'b1', title: 'Draft', sourceFolder: '  ' }]).open();
        expect(firstBook.ensure).toHaveBeenCalledOnce();
        expect(shellOpens).not.toHaveBeenCalled();
    });

    it('opens straight away when a book with a folder exists', () => {
        designer([{ id: 'b1', title: 'Pride and Prejudice', sourceFolder: 'Pride and Prejudice' }]).open();
        expect(firstBook.ensure).not.toHaveBeenCalled();
        expect(shellOpens).toHaveBeenCalledOnce();
    });
});
