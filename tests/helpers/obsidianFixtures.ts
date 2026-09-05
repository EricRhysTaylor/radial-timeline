/**
 * Shared test fixtures for Obsidian-shaped values.
 *
 * `makeFile` used to be copied into fourteen test files with three signatures.
 * This is the one definition: `basename` defaults to the file name without its
 * extension, and `name` is always the last path segment.
 */
import type { TFile } from 'obsidian';

export function makeFile(path: string, basename?: string): TFile {
    const name = path.split('/').pop() || path;
    return {
        path,
        name,
        basename: basename ?? name.replace(/\.md$/i, ''),
        extension: name.includes('.') ? name.split('.').pop() ?? '' : ''
    } as TFile; // SAFE: tests need only the identity fields of a TFile
}
