import { describe, expect, it } from 'vitest';
import { checkScrivenerExport, type ScrivenerSource } from './adapters/scrivenerAdapter';
const source = (csv: string | null, titles = ['Arrival', 'Departure']): ScrivenerSource => ({
  async listSceneFiles() { return titles.map((title, i) => ({ fileName: `${i + 1} ${title}.txt`, path: `Book/ACT 1/${i + 1} ${title}.txt`, content: 'Actual scene prose.' })); },
  async readSidecar() { return csv; },
});
describe('Scrivener export readiness', () => {
  it('accepts matched scenes, punctuation-folded titles, and empty binder folders', async () => {
    const check = await checkScrivenerExport(source('Title,Synopsis,Word Count\nAct 1,,0\nArrival?,Author synopsis,5\nDeparture,Another synopsis,5\nEmpty placeholder,,0'), 'Book');
    expect(check).toEqual({ errors: [], warnings: [] });
  });
  it('reports missing CSV as optional metadata, with an export fix', async () => {
    const check = await checkScrivenerExport(source(null), 'Book');
    expect(check.errors).toEqual([]);
    expect(check.warnings[0]).toContain('Outliner Contents as CSV');
  });
  it('blocks missing scene prose listed in Word Count', async () => {
    const check = await checkScrivenerExport(source('Title,Synopsis,Word Count\nArrival,,5\nDeparture,,5\nMissing scene,,50'), 'Book');
    expect(check.errors[0]).toContain('Missing scene');
    expect(check.errors[0]).toContain('re-export Files');
  });
  it('blocks mismatched metadata even when filenames are numbered', async () => {
    const check = await checkScrivenerExport(source('Title,Synopsis,Word Count\nOther book,,50'), 'Book');
    expect(check.errors.some(error => error.includes('Scene files missing from the outline'))).toBe(true);
  });
  it('rejects unrelated and header-only CSVs', async () => {
    for (const csv of ['Email,Name\na@b.test,Name', 'Title,Synopsis']) {
      expect((await checkScrivenerExport(source(csv), 'Book')).errors[0]).toContain('Title');
    }
  });
  it('warns rather than guessing about unmatched rows without Word Count', async () => {
    const check = await checkScrivenerExport(source('Title,Synopsis\nArrival,one\nDeparture,two\nMaybe a folder,'), 'Book');
    expect(check.errors).toEqual([]);
    expect(check.warnings[0]).toContain('completeness cannot be checked');
  });
  it('blocks duplicate scene titles without rejecting repeated empty folder headings', async () => {
    const bad = await checkScrivenerExport(source('Title,Synopsis,Word Count\nArrival,,5\nArrival,,5', ['Arrival', 'Arrival']), 'Book');
    expect(bad.errors[0]).toContain('Repeated document titles');
    const good = await checkScrivenerExport(source('Title,Synopsis,Word Count\nFolder,,0\nArrival,,5\nFolder,,0\nDeparture,,5'), 'Book');
    expect(good.errors).toEqual([]);
  });
});
