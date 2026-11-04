import type { BookProfile } from '../types/settings';
import { getBookIdForPath } from '../utils/books';

type CardNode = { type?: string; file?: string; subpath?: string };

/** Only a whole note inside a book becomes a card; any other Canvas node stays Obsidian's own. */
export function bookCardFor(books: BookProfile[] | undefined, node: CardNode | undefined): { path: string; bookId: string } | null {
    if (node?.type !== 'file' || !node.file || node.subpath || !node.file.endsWith('.md')) return null;
    const bookId = getBookIdForPath(books, node.file);
    return bookId ? { path: node.file, bookId } : null;
}
