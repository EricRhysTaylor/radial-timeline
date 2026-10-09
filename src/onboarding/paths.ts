/*
 * Pure path/text helpers for onboarding. Obsidian dependency is limited to
 * `normalizePath` so these stay unit-testable.
 */

import { normalizePath } from 'obsidian';
import { basename as lastSegment } from '../utils/paths';

/** Base file/folder name from a vault path. */
export function basename(path: string): string {
  return lastSegment(normalizePath(path));
}

/** Parent folder path ('' for a top-level entry). */
export function dirname(path: string): string {
  const norm = normalizePath(path);
  const idx = norm.lastIndexOf('/');
  return idx === -1 ? '' : norm.slice(0, idx);
}

/**
 * Destination for the onboarded RT book: a sibling of the untouched source
 * folder named `<Book title> RT`. The suffix keeps it distinct from the
 * source when the title matches the export folder's name.
 */
export function suggestOnboardingFolderName(sourceFolder: string, bookTitle: string): string {
  const parent = dirname(sourceFolder);
  const base = sanitizeFileName(bookTitle) || basename(sourceFolder) || 'Book'; // SAFE: a blank title names the folder after the source; a vault-root source with no name uses the generic stem
  const name = `${base} RT`;
  return parent ? `${parent}/${name}` : name;
}

/** Strip characters illegal in vault file names; collapse whitespace. */
export function sanitizeFileName(name: string): string {
  return name
    .replace(/[\\/:*?"<>|#^[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^\.+/, '')
    .trim();
}

/** First `n` words of a text (frontmatter already stripped), with an ellipsis when truncated. */
export function openingWords(text: string, n: number): string {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const head = words.slice(0, n).join(' ');
  return words.length > n ? `${head}…` : head;
}
