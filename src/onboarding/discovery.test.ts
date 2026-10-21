import { describe, it, expect } from 'vitest';
import type { App } from 'obsidian';
import { countSceneNotes, discoverOnboardingCandidates, holdsManuscriptExport } from './discovery';
/** A synthetic vault; a value of `SCENE` is a note whose frontmatter says `Class: Scene`. */
const SCENE = '---\nClass: Scene\n---\nProse.';
function app(paths: Record<string, string>): App {
  // SAFE: discovery consumes only these vault and metadata-cache methods; all data is synthetic.
  return {
    vault: {
      getFiles: () => Object.keys(paths).map(path => ({ path, name: path.slice(path.lastIndexOf('/') + 1), extension: path.split('.').pop() })),
      read: async (file: { path: string }) => paths[file.path],
    },
    metadataCache: { getFileCache: (file: { path: string }) => (paths[file.path] === SCENE ? { frontmatter: { Class: 'Scene' } } : null) },
  } as unknown as App;
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
  it('reports an unregistered folder of scene notes as a book, never as an export to import', async () => {
    const vault = app({
      'Saga/Book 4/01 Arrival.md': SCENE,
      'Saga/Book 4/02 Departure.md': SCENE,
      'Saga/Book 4/Notes.md': 'plain note',
      'Saga/Book 4/Exports/Book 4.docx': 'binary',
      'Saga/Book 1/01 Opening.md': SCENE,
      'Saga/01 Saturn/01 Ring.md': SCENE,
      'Saga/02 Jupiter/01 Storm.md': SCENE,
    });
    expect(await discoverOnboardingCandidates(vault, ['Saga/Book 1'])).toEqual([
      { kind: 'book', folder: 'Saga/01 Saturn', sceneCount: 1 },
      { kind: 'book', folder: 'Saga/02 Jupiter', sceneCount: 1 },
      { kind: 'book', folder: 'Saga/Book 4', sceneCount: 2 },
    ]);
  });
  it('never offers a folder holding a registered book as a book', async () => {
    const vault = app({
      'Saga/Intro.md': SCENE,
      'Saga/Book 1/01 Opening.md': SCENE,
      'Saga/Book 2/01 Storm.md': SCENE,
    });
    expect(await discoverOnboardingCandidates(vault, ['Saga/Book 1'])).toEqual([
      { kind: 'book', folder: 'Saga/Book 2', sceneCount: 1 },
    ]);
  });
  it('tells a book folder from a manuscript export', () => {
    const vault = app({ 'Book/01 Arrival.md': SCENE, 'Book/Act 2/02 Storm.md': SCENE, 'Export/01 Arrival.txt': 'prose', 'Export/Notes.md': 'plain' });
    expect(countSceneNotes(vault, 'Book')).toBe(2);
    expect(countSceneNotes(vault, 'Export')).toBe(0);
    expect(holdsManuscriptExport(vault, 'Export')).toBe(true);
    expect(holdsManuscriptExport(vault, 'Book')).toBe(false);
  });
});
