import { describe, expect, it } from 'vitest';
import { ingestScrivenerFolder, inspectScrivenerExport, parseOutlineSidecar, type ScrivenerFile, type ScrivenerSource } from './adapters/scrivenerAdapter';
const files = (titles = ['Arrival', 'Departure']): ScrivenerFile[] =>
  titles.map((title, i) => ({ fileName: `${i + 1} ${title}.txt`, path: `Book/ACT 1/${i + 1} ${title}.txt`, content: 'Actual scene prose.' }));
const check = (csv: string | null, titles?: string[]) => inspectScrivenerExport(files(titles), csv === null ? null : parseOutlineSidecar(csv));
const source = (csv: string): ScrivenerSource => ({
  async listSceneFiles() { return files(); },
  async readSidecar() { return { name: 'Outline.csv', text: csv }; },
});
describe('Scrivener export readiness', () => {
  it('accepts matched scenes, punctuation-folded titles, and empty binder folders', () => {
    expect(check('Title,Synopsis,Word Count\nAct 1,,0\nArrival?,Author synopsis,5\nDeparture,Another synopsis,5\nEmpty placeholder,,0')).toEqual({ errors: [], warnings: [] });
  });
  it('reports a missing CSV as optional metadata, with an export fix', () => {
    const result = check(null);
    expect(result.errors).toEqual([]);
    expect(result.warnings[0]).toContain('Outliner Contents as CSV');
  });
  it('blocks missing scene prose listed in Word Count', () => {
    const result = check('Title,Synopsis,Word Count\nArrival,,5\nDeparture,,5\nMissing scene,,50');
    expect(result.errors[0]).toContain('Missing scene');
    expect(result.errors[0]).toContain('export both Files and Outliner Contents');
  });
  it('blocks mismatched metadata even when filenames are numbered', () => {
    expect(check('Title,Synopsis,Word Count\nOther book,,50').errors.some(error => error.includes('not in the outline'))).toBe(true);
  });
  it('rejects unrelated and header-only CSVs during ingest', async () => {
    for (const csv of ['Email,Name\na@b.test,Name', 'Title,Synopsis']) {
      const result = await ingestScrivenerFolder(source(csv), 'Book');
      expect(result.kind).toBe('needs-order');
      if (result.kind === 'needs-order') expect(result.reason).toContain('Title');
    }
  });
  it('warns rather than guessing about unmatched rows without Word Count', () => {
    const result = check('Title,Synopsis\nArrival,one\nDeparture,two\nMaybe a folder,');
    expect(result.errors).toEqual([]);
    expect(result.warnings[0]).toContain('no exported file');
  });
  it('blocks duplicate scene titles without rejecting repeated empty folder headings', () => {
    expect(check('Title,Synopsis,Word Count\nArrival,,5\nArrival,,5', ['Arrival', 'Arrival']).errors[0]).toContain('share a title');
    expect(check('Title,Synopsis,Word Count\nFolder,,0\nArrival,,5\nFolder,,0\nDeparture,,5').errors).toEqual([]);
  });
});
