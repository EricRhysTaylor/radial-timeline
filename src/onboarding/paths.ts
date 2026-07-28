/*
 * Pure path/text helpers for onboarding. Obsidian dependency is limited to
 * `normalizePath` so these stay unit-testable.
 */

import { normalizePath } from 'obsidian';

/** Base file/folder name from a vault path. */
export function basename(path: string): string {
  const norm = normalizePath(path);
  const idx = norm.lastIndexOf('/');
  return idx === -1 ? norm : norm.slice(idx + 1);
}

/** Parent folder path ('' for a top-level entry). */
export function dirname(path: string): string {
  const norm = normalizePath(path);
  const idx = norm.lastIndexOf('/');
  return idx === -1 ? '' : norm.slice(0, idx);
}

/**
 * Suggested destination for the onboarded RT book: a sibling of the untouched
 * source folder named `<Source> RT` (working name — see plan Open Question 5).
 */
export function suggestOnboardingFolderName(sourceFolder: string): string {
  const parent = dirname(sourceFolder);
  const base = basename(sourceFolder) || 'Book'; // SAFE: a source folder at the vault root has no basename; 'Book' is the stem for the suggested name
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
