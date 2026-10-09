import { describe, expect, it } from 'vitest';
import type RadialTimelinePlugin from '../main';
import {
  applyMetadataMappingToModel,
  ingestScrivenerFolder,
  proposeScrivenerAutomap,
  type ScrivenerFile,
  type ScrivenerSource,
} from './adapters/scrivenerAdapter';
import { authoredSubplots, parseActValue, resolveImportActs } from './extraction';
import { OnboardingService } from './OnboardingService';
import { summarizeImport } from './importSummary';

// A Scrivener plain-text export with numbered files in numbered chapter
// folders (numbering restarts per folder), plus an Outliner CSV whose column
// names diverge from Radial Timeline's: Themes, People, Location, Story Date.
const scene = (folder: string, name: string): ScrivenerFile => ({
  fileName: name,
  path: `Salt/${folder}/${name}`,
  content: `${name} prose.`,
});
const FILES = [
  scene('02 Chapter Two', '01 Salt and Silver.txt'),
  scene('01 Chapter One', '02 Ines Comes Home.txt'),
  scene('01 Chapter One', '01 The Harbor at Dawn.txt'),
  scene('02 Chapter Two', '02 The Salt Road Home.txt'),
];
const OUTLINE = [
  'Title,Synopsis,Label,Status,Word Count,Themes,People,Location,Story Date,POV,Tension',
  'Chapter One,,Chapter,,0,,,,,,',
  'The Harbor at Dawn,Mara loads a crate.,Scene,First Draft,74,Smuggling Run,"Mara Vell, Tomas Reyes",Port Cassel,1891-03-02,Mara Vell,3',
  'Ines Comes Home,Her sister returns.,Scene,First Draft,73,Sisters,"Mara Vell, Ines Vell",Port Cassel,1891-03-03,Ines Vell,2',
  'Chapter Two,,Chapter,,0,,,,,,',
  'Salt and Silver,One last run.,Scene,To Do,80,Smuggling Run; Sisters,"Mara Vell, Ines Vell, Captain Oduya",The Salt Flats,1891-03-09,Mara Vell,5',
  'The Salt Road Home,Mara walks out.,Scene,First Draft,60,,"Mara Vell, Ines Vell",The Salt Flats,1892-05-20,,6',
].join('\n');

function source(files: ScrivenerFile[], outline: string | null): ScrivenerSource {
  return {
    listSceneFiles: async () => files,
    readSidecar: async () => (outline === null ? null : { name: 'Salt Outline.csv', text: outline }),
  };
}

// SAFE: buildStructureOnlyProposals reads only settings.actCount; everything else is pure.
const service = new OnboardingService({ settings: { actCount: 3 } } as unknown as RadialTimelinePlugin);

describe('Scrivener import with diverging field names', () => {
  it('maps Themes, People, Location and Story Date onto scene fields without losing any theme', async () => {
    const ingest = await ingestScrivenerFolder(source(FILES, OUTLINE), 'Salt');
    expect(ingest.kind).toBe('ok');
    if (ingest.kind !== 'ok') return;
    expect(ingest.outlineName).toBe('Salt Outline.csv');
    expect(ingest.warnings).toEqual([]);

    const mapping = proposeScrivenerAutomap(ingest.model.customFields);
    expect(mapping['Themes']).toEqual({ target: 'rt-key', key: 'Subplot' });
    expect(mapping['People']).toEqual({ target: 'rt-key', key: 'Character' });
    expect(mapping['Location']).toEqual({ target: 'rt-key', key: 'Place' });
    expect(mapping['Story Date']).toEqual({ target: 'rt-key', key: 'When' });
    expect(mapping['Scrivener POV']).toEqual({ target: 'pov-character' });
    expect(mapping['Scrivener Status']).toEqual({ target: 'custom' });
    expect(mapping['Word Count']).toEqual({ target: 'ignore' });

    const result = service.buildStructureOnlyProposals(applyMetadataMappingToModel(ingest.model, mapping), { publishStage: 'Zero' });
    expect(result.proposals.map((proposal) => proposal.title)).toEqual([
      'The Harbor at Dawn', 'Ines Comes Home', 'Salt and Silver', 'The Salt Road Home',
    ]);
    const salt = result.proposals[2].frontmatter;
    expect(salt).toMatchObject({
      Class: 'Scene',
      Synopsis: 'One last run.',
      Subplot: ['Smuggling Run', 'Sisters'],
      Character: ['[[Mara Vell]]', '[[Ines Vell]]', '[[Captain Oduya]]'],
      Place: ['[[The Salt Flats]]'],
      When: '1891-03-09',
      'Publish Stage': 'Zero',
      'Scrivener Status': 'To Do',
      Tension: '5',
      Label: 'Scene',
    });
    expect(salt).not.toHaveProperty('Word Count');
    expect(salt).not.toHaveProperty('POV');
    // Radial Timeline marks the first listed character as the POV character.
    expect(result.proposals[1].frontmatter?.Character).toEqual(['[[Ines Vell]]', '[[Mara Vell]]']);
    expect(result.proposals[3].frontmatter?.Subplot).toEqual(['Main Plot']);
    expect(result.actSource).toBe('position');

    const summary = summarizeImport(result.proposals);
    expect(summary.subplots).toEqual([
      { name: 'Smuggling Run', scenes: 2 },
      { name: 'Sisters', scenes: 2 },
      { name: 'Main Plot', scenes: 1 },
    ]);
    expect(summary.characters).toEqual(['Mara Vell', 'Tomas Reyes', 'Ines Vell', 'Captain Oduya']);
    expect(summary.places).toEqual(['Port Cassel', 'The Salt Flats']);
  });

  it('takes acts from a mapped Act column over ACT folders and position', () => {
    const scenes = [
      { knownMetadata: { Act: 'Act I' }, sourceAct: 2 },
      { knownMetadata: {}, sourceAct: 2 },
      { knownMetadata: { Act: '2' } },
      { knownMetadata: { Act: 'Act 4' } },
    ];
    expect(resolveImportActs(scenes, 3)).toEqual({ acts: [1, 1, 2, 3], source: 'column', highest: 4 });
    expect(resolveImportActs(scenes.map((s) => ({ ...s, knownMetadata: {} })), 3)).toMatchObject({ acts: [2, 2, 2, 2], source: 'folders' });
    expect(resolveImportActs([{ knownMetadata: {} }, { knownMetadata: {} }, { knownMetadata: {} }], 3)).toEqual({ acts: [1, 2, 3], source: 'position', highest: 0 });
    expect(parseActValue('Act III')).toBe(3);
    expect(parseActValue('Prologue')).toBeUndefined();
  });

  it('keeps every authored subplot once, and Main Plot only for a scene with none', () => {
    expect(authoredSubplots(['Grief', 'grief', 'Sisters'])).toEqual(['Grief', 'Sisters']);
    expect(authoredSubplots([])).toEqual(['Main Plot']);
  });
});

describe('numbered exports without an outline', () => {
  it('orders per-folder numbering by folder number, then file number', async () => {
    const result = await ingestScrivenerFolder(source(FILES, null), 'Salt');
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.model.chapters[0].scenes.map((s) => s.title)).toEqual([
      'The Harbor at Dawn', 'Ines Comes Home', 'Salt and Silver', 'The Salt Road Home',
    ]);
    expect(result.warnings[0]).toContain('No outline CSV');
  });

  it('orders book-wide numbering by file number alone, whatever the folder names', async () => {
    const files = [scene('Chapter Two', '3 Salt and Silver.txt'), scene('Chapter One', '1 The Harbor at Dawn.txt'), scene('Chapter One', '2 Ines Comes Home.txt')];
    const result = await ingestScrivenerFolder(source(files, null), 'Salt');
    expect(result.kind === 'ok' && result.model.chapters[0].scenes.map((s) => s.title)).toEqual([
      'The Harbor at Dawn', 'Ines Comes Home', 'Salt and Silver',
    ]);
  });

  it('asks for the outline when numbering restarts in unnumbered folders', async () => {
    const files = [scene('Chapter Two', '1 Salt and Silver.txt'), scene('Chapter One', '1 The Harbor at Dawn.txt')];
    const result = await ingestScrivenerFolder(source(files, null), 'Salt');
    expect(result.kind).toBe('needs-order');
  });
});
