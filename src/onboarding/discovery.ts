import type { App } from 'obsidian';
import { RT_SYSTEM_FOLDER } from '../utils/systemFolder';
import { isPathInFolderScope } from '../utils/pathScope';
import { isSceneClassFrontmatter } from '../utils/sceneIds';
import { hasTitleColumn, isScrivenerAuxiliaryFile, isSnapshotFolderName, outlineListsAll, parseOutlineSidecar } from './adapters/scrivenerAdapter';

/**
 * A manuscript found in the vault. A book is a folder of scene notes that no
 * book in Book Manager points at yet: it is added as it is, never imported.
 * A Scrivener export is two parts: the folder of scene text files, and the
 * Outliner CSV carrying the scenes' properties (null when none was found
 * beside it).
 */
export type OnboardingCandidate =
  | { kind: 'book'; folder: string; sceneCount: number }
  | { kind: 'scrivener'; folder: string; sceneCount: number; outline: string | null }
  | { kind: 'word'; folder: string; document: string };

/** Binder folders inside an export: numbered ("03 Chapter Three") or ACT folders. */
function isBinderFolderName(name: string): boolean {
  return /^\s*\d/.test(name) || /^ACT[ _-]?\d/i.test(name);
}

const parentOf = (path: string): string => path.slice(0, Math.max(0, path.lastIndexOf('/')));

/** Climb out of binder folders to the manuscript folder that holds them. */
function aboveBinderFolders(folder: string): string {
  while (folder.includes('/') && isBinderFolderName(folder.slice(folder.lastIndexOf('/') + 1))) {
    folder = parentOf(folder);
  }
  return folder;
}

/**
 * Scene notes (`Class: Scene`) in a folder at any depth: the notes the
 * timeline reads for a book there. A folder holding any is already a Radial
 * Timeline book, and importing it would only copy what is there.
 */
export function countSceneNotes(app: App, folder: string): number {
  return app.vault.getFiles().filter(file => file.extension === 'md' && isPathInFolderScope(file.path, folder)
    && isSceneClassFrontmatter(app.metadataCache.getFileCache(file)?.frontmatter)).length;
}

const isSceneFile = (file: { extension: string; name: string }): boolean =>
  /^(md|txt)$/i.test(file.extension) && !isScrivenerAuxiliaryFile(file.name);

/** True when a folder holds exported manuscript files (Scrivener text, a Word document) to import. */
export function holdsManuscriptExport(app: App, folder: string): boolean {
  return app.vault.getFiles().some(file => /^(txt|docx)$/i.test(file.extension) && isPathInFolderScope(file.path, folder)
    && !isScrivenerAuxiliaryFile(file.name));
}

/** Candidate discovery is read-only and runs on demand, never in the background. */
export async function discoverOnboardingCandidates(app: App, registeredFolders: string[]): Promise<OnboardingCandidate[]> {
  // The plugin's own folder (templates, fonts, logs) is never a manuscript.
  const files = app.vault.getFiles().filter(file => !file.path.startsWith(`${RT_SYSTEM_FOLDER}/`) && !file.path.split('/').some(part => part.endsWith('.scriv') || isSnapshotFolderName(part)));
  const registered = (path: string) => registeredFolders.some(folder => isPathInFolderScope(path, folder));
  const scenesUnder = (folder: string) => files.filter(f => f.path.startsWith(`${folder}/`) && isSceneFile(f));
  const candidates = new Map<string, OnboardingCandidate>();

  // Books first: scene notes outside every registered book, grouped at the
  // outermost folder holding them (book folders are never binder-climbed:
  // "Books/01 Saturn" and "Books/02 Jupiter" are two books). Exports inside a
  // book folder belong to that book.
  const sceneNotes = files.filter(file => file.extension === 'md' && file.path.includes('/') && !registered(file.path)
    && isSceneClassFrontmatter(app.metadataCache.getFileCache(file)?.frontmatter));
  const bookFolders: string[] = [];
  // A folder holding a registered book is never a book itself: it would overlap that book.
  const holdsRegistered = (folder: string) => registeredFolders.some(book => isPathInFolderScope(book, folder));
  for (const folder of [...new Set(sceneNotes.map(file => parentOf(file.path)))].sort((a, b) => a.length - b.length)) {
    if (holdsRegistered(folder)) continue;
    if (!bookFolders.some(book => isPathInFolderScope(folder, book))) bookFolders.push(folder);
  }
  for (const folder of bookFolders) {
    candidates.set(folder, { kind: 'book', folder, sceneCount: sceneNotes.filter(file => isPathInFolderScope(file.path, folder)).length });
  }
  const excluded = (path: string) => registered(path) || bookFolders.some(book => isPathInFolderScope(path, book));
  for (const file of files) {
    if (excluded(file.path) || file.extension.toLowerCase() !== 'csv') continue;
    const outline = parseOutlineSidecar(await app.vault.read(file));
    if (!outline || !hasTitleColumn(outline)) continue;
    if (!outline.fields.some(field => /^(synopsis|word count|label|status|section type)$/i.test(field))) continue;
    const parent = parentOf(file.path);
    const atVaultRoot = !file.path.includes('/');
    const roots = atVaultRoot ? [...new Set(files.filter(f => f.path.includes('/')).map(f => f.path.split('/')[0]))] : [parent];
    for (const folder of roots) {
      if (excluded(folder)) continue;
      const scenes = scenesUnder(folder);
      // An outline at the vault root sits beside every top-level folder; only a
      // folder whose every document it lists is that export — the same rule
      // the import uses to find an export's outline.
      if (atVaultRoot && !outlineListsAll(outline, scenes.map(f => f.name))) continue;
      candidates.set(folder, { kind: 'scrivener', folder, sceneCount: scenes.length, outline: file.name });
    }
  }
  const claimed = (folder: string) => [...candidates.keys()].some(root => folder === root || folder.startsWith(`${root}/`));
  for (const file of files) {
    if (excluded(file.path) || !file.path.includes('/') || isScrivenerAuxiliaryFile(file.name)) continue;
    const parent = parentOf(file.path);
    if (claimed(parent)) continue;
    if (file.extension.toLowerCase() === 'docx') {
      candidates.set(parent, { kind: 'word', folder: parent, document: file.name });
    } else if (file.extension.toLowerCase() === 'txt') {
      // A text export without an outline: climb out of its binder folders to
      // the export itself, so one export is one candidate.
      const folder = aboveBinderFolders(parent);
      if (!excluded(folder) && !claimed(folder)) {
        candidates.set(folder, { kind: 'scrivener', folder, sceneCount: scenesUnder(folder).length, outline: null });
      }
    }
  }
  return [...candidates.values()].sort((a, b) => a.folder.localeCompare(b.folder));
}
