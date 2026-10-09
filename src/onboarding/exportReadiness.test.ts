import { describe, expect, it } from 'vitest';
import { ingestScrivenerFolder, inspectScrivenerExport, parseOutlineSidecar, type ScrivenerFile, type ScrivenerSource } from './adapters/scrivenerAdapter';
import { flattenScenes } from './adapters/manuscriptModel';
const files = (titles = ['Arrival', 'Departure']): ScrivenerFile[] =>
  titles.map((title, i) => ({ fileName: `${i + 1} ${title}.txt`, path: `Book/ACT 1/${i + 1} ${title}.txt`, content: `${title} prose.` }));
const check = (csv: string | null, titles?: string[]) => inspectScrivenerExport(files(titles), csv === null ? null : parseOutlineSidecar(csv));
const source = (csv: string | null, titles?: string[]): ScrivenerSource => ({
  async listSceneFiles() { return files(titles); },
  async readSidecar() { return csv === null ? null : { name: 'Outline.csv', text: csv }; },
});
describe('Scrivener export readiness', () => {
  it('accepts matched scenes, punctuation-folded titles, and empty binder folders', () => {
    expect(check('Title,Synopsis,Word Count\nAct 1,,0\nArrival?,Author synopsis,5\nDeparture,Another synopsis,5\nEmpty placeholder,,0')).toEqual({ problems: [], warnings: [] });
  });
  it('accepts scene files without an outline (the review flags the missing CSV)', () => {
    expect(check(null)).toEqual({ problems: [], warnings: [] });
  });
  it('flags outline documents with text but no file, and says they are left out if imported', () => {
    const [problem] = check('Title,Synopsis,Word Count\nArrival,,5\nDeparture,,5\nMissing scene,,50').problems;
    expect(problem.problem).toContain('“Missing scene”');
    expect(problem.ifImported).toBe('“Missing scene” is not imported.');
  });
  it('flags scene files the outline does not list', () => {
    const [problem] = check('Title,Synopsis,Word Count\nOther book,,50').problems.filter(item => item.problem.includes('not in the outline'));
    expect(problem.ifImported).toContain('without outline properties, after the scenes the outline lists');
  });
  it('flags unrelated and header-only CSVs, and leaves them out when imported anyway', async () => {
    for (const csv of ['Email,Name\na@b.test,Name', 'Title,Synopsis']) {
      const result = await ingestScrivenerFolder(source(csv), 'Book');
      expect(result.kind === 'problems' && result.problems[0].problem).toContain('Title');
      const anyway = await ingestScrivenerFolder(source(csv), 'Book', { importAnyway: true });
      expect(anyway.kind === 'ok' && anyway.outlineName).toBeNull();
    }
  });
  it('warns rather than guessing about unmatched rows without Word Count', () => {
    const result = check('Title,Synopsis\nArrival,one\nDeparture,two\nMaybe a folder,');
    expect(result.problems).toEqual([]);
    expect(result.warnings[0]).toContain('no exported file');
  });
  it('flags duplicate scene titles without rejecting repeated empty folder headings', () => {
    expect(check('Title,Synopsis,Word Count\nArrival,,5\nArrival,,5', ['Arrival', 'Arrival']).problems[0].problem).toContain('More than one document is titled “Arrival”');
    expect(check('Title,Synopsis,Word Count\nFolder,,0\nArrival,,5\nFolder,,0\nDeparture,,5').problems).toEqual([]);
  });
  it('imports anyway: outline order first, unlisted files after, ambiguous titles without properties', async () => {
    const titles = ['Unlisted', 'Twin', 'Opening', 'Twin'];
    const csv = 'Title,Synopsis,Word Count\nOpening,The start,5\nTwin,first,5\nTwin,second,5';
    const result = await ingestScrivenerFolder(source(csv, titles), 'Book', { importAnyway: true });
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    const scenes = flattenScenes(result.model);
    expect(scenes.map(scene => scene.title)).toEqual(['Opening', 'Twin', 'Twin', 'Unlisted']);
    expect(scenes[0].knownSynopsis).toBe('The start');
    expect(scenes[1].knownSynopsis).toBeNull();
    expect(result.warnings).toEqual(expect.arrayContaining([
      'Scenes titled “Twin” import without outline properties.',
      '“Unlisted” imports without outline properties, after the scenes the outline lists.',
    ]));
  });
});
