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
    expect(candidates).toEqual([{ folder: 'Export', evidence: '1 scene files · outline Outline.csv' }]);
  });
  it('excludes registered books, snapshots and raw Scrivener internals', async () => {
    const candidates = await discoverOnboardingCandidates(app({ 'Book/Outline.csv': outline, 'Book/Scene.txt': 'prose', 'Other/Scene Snapshots/old.txt': 'old', 'Project.scriv/Files/Scene.txt': 'internal' }), ['Book']);
    expect(candidates).toEqual([]);
  });
  it('does not label arbitrary CSVs as Scrivener projects', async () => {
    expect(await discoverOnboardingCandidates(app({ 'Accounts/data.csv': 'Title,Price\nProduct,50' }), [])).toEqual([]);
  });
  it('reports CSV-only and text-only exports so incomplete exports can be inspected', async () => {
    const candidates = await discoverOnboardingCandidates(app({ 'CSV only/Outline.csv': outline, 'Text only/Arrival.txt': 'prose' }), []);
    expect(candidates.map(candidate => candidate.folder)).toEqual(['CSV only', 'Text only']);
  });
});
