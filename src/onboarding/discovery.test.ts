import { describe, it, expect } from 'vitest';
import type { App } from 'obsidian';
import { discoverOnboardingCandidates } from './discovery';
function app(paths: Record<string, string>): App {
  // SAFE: discovery consumes only these vault methods; all data is a synthetic export.
  return { vault: {
    getFiles: () => Object.keys(paths).map(path => ({ path, name: path.slice(path.lastIndexOf('/') + 1), extension: path.split('.').pop() })),
    read: async (file: { path: string }) => paths[file.path],
  } } as unknown as App;
}
const outline = 'Title,Synopsis,Word Count\nArrival,An arrival,5';
describe('read-only onboarding discovery', () => {
  it('groups an outline and nested scenes as one manuscript', async () => {
    const candidates = await discoverOnboardingCandidates(app({ 'Export/Outline.csv': outline, 'Export/Book/ACT 1/Arrival.txt': 'prose', 'Export/Book/ACT 1/Arrival Notes.txt': 'notes' }), []);
    expect(candidates).toEqual([{ kind: 'scrivener', folder: 'Export', sceneCount: 1, outline: 'Outline.csv' }]);
  });
  it('excludes registered books, snapshots and raw Scrivener internals', async () => {
    const candidates = await discoverOnboardingCandidates(app({ 'Book/Outline.csv': outline, 'Book/Scene.txt': 'prose', 'Other/Scene Snapshots/old.txt': 'old', 'Project.scriv/Files/Scene.txt': 'internal' }), ['Book']);
    expect(candidates).toEqual([]);
  });
  it('nominates only the folders holding a vault-root outline\'s documents', async () => {
    const candidates = await discoverOnboardingCandidates(app({
      'Salt Outline.csv': outline,
      'Salt/01 Arrival.txt': 'prose',
      'Place/Arrival.md': 'a place sharing a scene title',
      'Place/Harbor.md': 'another place',
      'Radial Timeline/Pandoc/fonts/OFL.txt': 'font license',
    }), []);
    expect(candidates).toEqual([{ kind: 'scrivener', folder: 'Salt', sceneCount: 1, outline: 'Salt Outline.csv' }]);
  });
  it('does not label arbitrary CSVs as Scrivener projects', async () => {
    expect(await discoverOnboardingCandidates(app({ 'Accounts/data.csv': 'Title,Price\nProduct,50' }), [])).toEqual([]);
  });
  it('reports CSV-only and text-only exports so incomplete exports can be inspected', async () => {
    const candidates = await discoverOnboardingCandidates(app({ 'CSV only/Outline.csv': outline, 'Text only/Arrival.txt': 'prose' }), []);
    expect(candidates.map(candidate => candidate.folder)).toEqual(['CSV only', 'Text only']);
    expect(candidates[1]).toEqual({ kind: 'scrivener', folder: 'Text only', sceneCount: 1, outline: null });
  });
  it('reports a text export without an outline once, at the folder above its binder folders', async () => {
    const candidates = await discoverOnboardingCandidates(app({
      'Imports/Salt/01 Chapter One/01 Arrival.txt': 'prose',
      'Imports/Salt/02 Chapter Two/01 Departure.txt': 'prose',
      'Drafts/Novel.docx': 'binary',
    }), []);
    expect(candidates).toEqual([
      { kind: 'word', folder: 'Drafts', document: 'Novel.docx' },
      { kind: 'scrivener', folder: 'Imports/Salt', sceneCount: 2, outline: null },
    ]);
  });
});
