import type { App } from 'obsidian';
import { isScrivenerAuxiliaryFile, isSnapshotFolderName, parseOutlineSidecar } from './adapters/scrivenerAdapter';

export interface OnboardingCandidate { folder: string; evidence: string }
/** Candidate discovery is read-only and runs on demand, never in the background. */
export async function discoverOnboardingCandidates(app: App, registeredFolders: string[]): Promise<OnboardingCandidate[]> {
  const files = app.vault.getFiles().filter(file => !file.path.split('/').some(part => part.endsWith('.scriv') || isSnapshotFolderName(part)));
  const excluded = (path: string) => registeredFolders.some(folder => folder && (path === folder || path.startsWith(`${folder}/`)));
  const candidates = new Map<string, OnboardingCandidate>();
  for (const file of files) {
    if (excluded(file.path) || file.extension.toLowerCase() !== 'csv') continue;
    const outline = parseOutlineSidecar(await app.vault.read(file));
    if (!outline || !outline.fields.some(field => field.toLowerCase() === 'title')) continue;
    if (!outline.fields.some(field => /^(synopsis|word count|label|status|section type)$/i.test(field))) continue;
    const parent = file.path.slice(0, file.path.lastIndexOf('/'));
    const roots = file.path.includes('/') ? [parent] : [...new Set(files.filter(f => f.path.includes('/')).map(f => f.path.split('/')[0]))];
    for (const folder of roots) {
      if (excluded(folder)) continue;
      const scenes = files.filter(f => f.path.startsWith(`${folder}/`) && /^(md|txt)$/i.test(f.extension) && !isScrivenerAuxiliaryFile(f.name));
      candidates.set(folder, { folder, evidence: `${scenes.length} scene files · outline ${file.name}` });
    }
  }
  for (const file of files) {
    if (excluded(file.path) || !/^(txt|docx)$/i.test(file.extension) || isScrivenerAuxiliaryFile(file.name) || !file.path.includes('/')) continue;
    const folder = file.path.slice(0, file.path.lastIndexOf('/'));
    if ([...candidates.keys()].some(root => folder === root || folder.startsWith(`${root}/`))) continue;
    candidates.set(folder, { folder, evidence: file.extension === 'docx' ? 'Word manuscript' : 'Text export — outline not detected' });
  }
  return [...candidates.values()].sort((a, b) => a.folder.localeCompare(b.folder));
}
