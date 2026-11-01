/** Outline notes in the selected book plus explicitly attached reference notes. */
export function outlineDocumentPaths(bookId: string | undefined, notes: Array<{ path: string; bookId?: string; className: unknown }>, attached: string[]): string[] {
    const discovered = bookId ? notes.filter(note => note.bookId === bookId && typeof note.className === 'string' && note.className.trim().toLowerCase() === 'outline').map(note => note.path) : [];
    return [...new Set([...discovered, ...attached])];
}
