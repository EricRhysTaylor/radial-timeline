/** Outline notes in the selected book plus explicitly attached reference notes. */
export function outlineDocumentPaths(bookId: string | undefined, notes: Array<{ path: string; bookId?: string; className: unknown }>, attached: string[]): string[] {
    const discovered = bookId ? notes.filter(note => note.bookId === bookId && typeof note.className === 'string' && note.className.trim().toLowerCase() === 'outline').map(note => note.path) : [];
    return [...new Set([...discovered, ...attached])];
}

export type OutlineReferenceType = 'outline' | 'scene' | 'sketch' | 'character' | 'place' | 'note';

/** Presentation follows an existing Class; unknown or absent classes remain ordinary notes. */
export function outlineReferenceType(className: unknown): OutlineReferenceType {
    const name = typeof className === 'string' ? className.trim().toLowerCase() : '';
    return name === 'outline' || name === 'scene' || name === 'sketch' || name === 'character' || name === 'place' ? name : 'note';
}

export function planOutlineReferences(paths: string[], existing: string[]): { add: string[]; duplicates: string[] } {
    const already = new Set(existing);
    const unique = [...new Set(paths)];
    return { add: unique.filter(path => !already.has(path)), duplicates: unique.filter(path => already.has(path)) };
}
