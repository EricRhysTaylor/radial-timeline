import type { App } from 'obsidian';
import { RT_SYSTEM_FOLDER } from '../utils/systemFolder';
import { hasTitleColumn, isScrivenerAuxiliaryFile, isSnapshotFolderName, outlineListsAll, parseOutlineSidecar } from './adapters/scrivenerAdapter';

/**
 * A manuscript found in the vault. A Scrivener export is two parts: the folder
 * of scene text files, and the Outliner CSV carrying the scenes' properties
 * (null when none was found beside it).
 */
export type OnboardingCandidate =
  | { kind: 'scrivener'; folder: string; sceneCount: number; outline: string | null }
  | { kind: 'word'; folder: string; document: string };

/** One-line description, for lists that show a candidate as text. */
export function describeOnboardingCandidate(candidate: OnboardingCandidate): string {
  if (candidate.kind === 'word') return `Word document ${candidate.document}`;
  const scenes = `${candidate.sceneCount} scene${candidate.sceneCount === 1 ? '' : 's'}`;
  return candidate.outline ? `${scenes} · ${candidate.outline}` : `${scenes} · no outline CSV`;
}

/** Binder folders inside an export: numbered ("03 Chapter Three") or ACT folders. */
function isBinderFolderName(name: string): boolean {
  return /^\s*\d/.test(name) || /^ACT[ _-]?\d/i.test(name);
}

const isSceneFile = (file: { extension: string; name: string }): boolean =>
  /^(md|txt)$/i.test(file.extension) && !isScrivenerAuxiliaryFile(file.name);

/** Candidate discovery is read-only and runs on demand, never in the background. */
export async function discoverOnboardingCandidates(app: App, registeredFolders: string[]): Promise<OnboardingCandidate[]> {
  // The plugin's own folder (templates, fonts, logs) is never a manuscript.
  const files = app.vault.getFiles().filter(file => !file.path.startsWith(`${RT_SYSTEM_FOLDER}/`) && !file.path.split('/').some(part => part.endsWith('.scriv') || isSnapshotFolderName(part)));
  const excluded = (path: string) => registeredFolders.some(folder => folder && (path === folder || path.startsWith(`${folder}/`)));
  const scenesUnder = (folder: string) => files.filter(f => f.path.startsWith(`${folder}/`) && isSceneFile(f));
  const candidates = new Map<string, OnboardingCandidate>();
  for (const file of files) {
    if (excluded(file.path) || file.extension.toLowerCase() !== 'csv') continue;
    const outline = parseOutlineSidecar(await app.vault.read(file));
    if (!outline || !hasTitleColumn(outline)) continue;
    if (!outline.fields.some(field => /^(synopsis|word count|label|status|section type)$/i.test(field))) continue;
    const parent = file.path.slice(0, file.path.lastIndexOf('/'));
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
    const parent = file.path.slice(0, file.path.lastIndexOf('/'));
    if (claimed(parent)) continue;
    if (file.extension.toLowerCase() === 'docx') {
      candidates.set(parent, { kind: 'word', folder: parent, document: file.name });
    } else if (file.extension.toLowerCase() === 'txt') {
      // A text export without an outline: climb out of its binder folders to
      // the export itself, so one export is one candidate.
      let folder = parent;
      while (folder.includes('/') && isBinderFolderName(folder.slice(folder.lastIndexOf('/') + 1))) {
        folder = folder.slice(0, folder.lastIndexOf('/'));
      }
      if (!excluded(folder) && !claimed(folder)) {
        candidates.set(folder, { kind: 'scrivener', folder, sceneCount: scenesUnder(folder).length, outline: null });
      }
    }
  }
  return [...candidates.values()].sort((a, b) => a.folder.localeCompare(b.folder));
}
