import { describe, it, expect } from 'vitest';
import {
  ingestScrivenerFolder,
  parseDelimited,
  parseOutlineSidecar,
  proposeScrivenerAutomap,
  applyMetadataMapping,
  applyMetadataMappingToModel,
  isScrivenerAuxiliaryFile,
  isSnapshotFolderName,
  deriveSourceAct,
  titleFromExportFileName,
  type ScrivenerFile,
  type ScrivenerSource,
  type ScrivenerFieldTarget,
} from './scrivenerAdapter';
import { flattenScenes } from './manuscriptModel';

// --- Fixtures ---------------------------------------------------------------
// A realistic Scrivener 3 export: File ▸ Export ▸ Files… with "number exported
// files" on (numbered .md scene files) plus File ▸ Export ▸ Outliner Contents
// as CSV… (Title / Synopsis / Label / Status / Keywords / one custom column).

function file(fileName: string, content: string): ScrivenerFile {
  return { fileName, path: `Book/Source/${fileName}`, content };
}

const SCENE_FILES: ScrivenerFile[] = [
  file('1 The Hook.md', 'Mara finds the letter under the floorboard.'),
  file('2 Landfall.md', 'The ferry docks at dawn; nobody is waiting.'),
  file('3 The Archivist.md', 'Basement records, and a name that should not be there.'),
  file('4 Unlisted.md', 'A scene the outline forgot.'),
];

// Note the quoted comma in row 1's synopsis, a quoted embedded newline in
// row 3's synopsis, and NO row for "Unlisted" (file 4). "Word Count" is a
// derived outliner column; "Storyline" is custom metadata.
const OUTLINE_CSV = [
  'Title,Synopsis,Label,Status,Keywords,Storyline,Word Count',
  '"The Hook","Mara finds the letter, and hides it again.",Discovery,First Draft,letter; secrets,Homecoming,812',
  '"Landfall","The ferry arrives at dawn.",Travel,Done,,Homecoming,1043',
  '"The Archivist","Records in the basement.\nA forbidden name surfaces.",Reveal,To Do,archives,Conspiracy,977',
].join('\n');

function sourceOf(files: ScrivenerFile[], sidecar: string | null): ScrivenerSource {
  return {
    listSceneFiles: async () => files,
    readSidecar: async () => sidecar,
  };
}

// --- CSV parsing ------------------------------------------------------------

describe('parseDelimited', () => {
  it('handles quoted commas, escaped quotes, and embedded newlines', () => {
    const csv = 'a,b,c\n"one, two","she said ""hi""","line1\nline2"';
    expect(parseDelimited(csv)).toEqual([
      ['a', 'b', 'c'],
      ['one, two', 'she said "hi"', 'line1\nline2'],
    ]);
  });

  it('handles CRLF rows and drops trailing empty rows', () => {
    expect(parseDelimited('a,b\r\n1,2\r\n\r\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('sniffs a tab delimiter when the header row is tab-separated', () => {
    expect(parseDelimited('Title\tSynopsis\nHook\tThe letter.')).toEqual([
      ['Title', 'Synopsis'],
      ['Hook', 'The letter.'],
    ]);
  });
});

describe('parseOutlineSidecar', () => {
  it('keys rows by header and pads short rows with empty strings', () => {
    const sidecar = parseOutlineSidecar('Title,Label\nHook');
    expect(sidecar).not.toBeNull();
    expect(sidecar?.fields).toEqual(['Title', 'Label']);
    expect(sidecar?.rows).toEqual([{ Title: 'Hook', Label: '' }]);
  });

  it('returns null for an empty or header-only export', () => {
    expect(parseOutlineSidecar('')).toBeNull();
    expect(parseOutlineSidecar('Title,Synopsis\n')).toBeNull();
  });
});

// --- Titles -----------------------------------------------------------------

describe('titleFromExportFileName', () => {
  it('drops the export-order prefix and the extension (.md and .txt)', () => {
    expect(titleFromExportFileName('1 The Hook.md')).toBe('The Hook');
    expect(titleFromExportFileName('02 - Landfall.txt')).toBe('Landfall');
    expect(titleFromExportFileName('Epilogue.md')).toBe('Epilogue');
  });
});

// --- Ingest -----------------------------------------------------------------

describe('ingestScrivenerFolder', () => {
  it('orders scenes by filename numbering regardless of listing order', async () => {
    const shuffled = [SCENE_FILES[2], SCENE_FILES[0], SCENE_FILES[3], SCENE_FILES[1]];
    const result = await ingestScrivenerFolder(sourceOf(shuffled, OUTLINE_CSV), 'Book/Source');
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(flattenScenes(result.model).map((scene) => scene.sourceRef)).toEqual([
        'Book/Source/1 The Hook.md',
        'Book/Source/2 Landfall.md',
        'Book/Source/3 The Archivist.md',
        'Book/Source/4 Unlisted.md',
      ]);
      expect(result.model.sourceKind).toBe('scrivener');
    }
  });

  it('carries synopsis and metadata from matched sidecar rows', async () => {
    const result = await ingestScrivenerFolder(sourceOf(SCENE_FILES, OUTLINE_CSV), 'Book/Source');
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    const [hook, landfall, archivist] = flattenScenes(result.model);

    // Quoted comma survives; synopsis routed to knownSynopsis, not metadata.
    expect(hook.knownSynopsis).toBe('Mara finds the letter, and hides it again.');
    expect(hook.title).toBe('The Hook');
    expect(hook.rawText).toBe('Mara finds the letter under the floorboard.');
    expect(hook.knownMetadata.Label).toBe('Discovery');
    expect(hook.knownMetadata.Keywords).toBe('letter; secrets');
    expect(hook.knownMetadata.Storyline).toBe('Homecoming');

    // Embedded newline inside a quoted cell survives.
    expect(archivist.knownSynopsis).toBe('Records in the basement.\nA forbidden name surfaces.');

    // Empty cells (Landfall's Keywords) are not carried.
    expect('Keywords' in landfall.knownMetadata).toBe(false);
  });

  it('never uses canonical RT keys in knownMetadata (collisions get prefixed)', async () => {
    const result = await ingestScrivenerFolder(sourceOf(SCENE_FILES, OUTLINE_CSV), 'Book/Source');
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    const hook = flattenScenes(result.model)[0];

    // Scrivener's Status column collides with the canonical Status key.
    expect('Status' in hook.knownMetadata).toBe(false);
    expect('Synopsis' in hook.knownMetadata).toBe(false);
    expect(hook.knownMetadata['Scrivener Status']).toBe('First Draft');

    // customFields lists the carried keys (derived Word Count is carried too —
    // the mapping table proposes ignoring it; ingest itself drops nothing).
    expect(result.model.customFields).toEqual([
      'Keywords', 'Label', 'Scrivener Status', 'Storyline', 'Word Count',
    ]);
  });

  it('leaves a file without a sidecar row bare (no synopsis, no metadata)', async () => {
    const result = await ingestScrivenerFolder(sourceOf(SCENE_FILES, OUTLINE_CSV), 'Book/Source');
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    const unlisted = flattenScenes(result.model)[3];
    expect(unlisted.title).toBe('Unlisted');
    expect(unlisted.knownSynopsis).toBeNull();
    expect(unlisted.knownMetadata).toEqual({});
    expect(unlisted.alreadyOnboarded).toBe(false);
  });

  it('ingests scene files alone when there is no sidecar', async () => {
    const result = await ingestScrivenerFolder(sourceOf(SCENE_FILES, null), 'Book/Source');
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    const scenes = flattenScenes(result.model);
    expect(scenes).toHaveLength(4);
    expect(scenes[0].knownSynopsis).toBeNull();
    expect(scenes[0].knownMetadata).toEqual({});
    expect(result.model.customFields).toEqual([]);
  });

  it('falls back to sidecar row order when file names are unnumbered', async () => {
    const unnumbered = [
      file('Landfall.md', 'Dawn ferry.'),
      file('The Hook.md', 'The letter.'),
      file('The Archivist.md', 'The basement.'),
    ];
    const result = await ingestScrivenerFolder(sourceOf(unnumbered, OUTLINE_CSV), 'Book/Source');
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(flattenScenes(result.model).map((scene) => scene.title)).toEqual([
      'The Hook', 'Landfall', 'The Archivist',
    ]);
  });

  it('asks for order when files are unnumbered and the sidecar cannot cover them', async () => {
    const unnumbered = [file('Alpha.md', 'a'), file('Beta.md', 'b')];
    const noSidecar = await ingestScrivenerFolder(sourceOf(unnumbered, null), 'Book/Source');
    expect(noSidecar.kind).toBe('needs-order');

    const partial = await ingestScrivenerFolder(sourceOf(unnumbered, OUTLINE_CSV), 'Book/Source');
    expect(partial.kind).toBe('needs-order');
  });

  it('strips a leading YAML block from exported file bodies', async () => {
    const withYaml = [file('1 A.md', '---\ntitle: A\n---\nActual prose.')];
    const result = await ingestScrivenerFolder(sourceOf(withYaml, null), 'Book/Source');
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(flattenScenes(result.model)[0].rawText).toBe('Actual prose.');
  });
});

// --- Automap ----------------------------------------------------------------

describe('proposeScrivenerAutomap', () => {
  it('maps canonical-named and aliased fields to RT keys', () => {
    const proposals = proposeScrivenerAutomap([
      'Synopsis', 'Status', 'Scrivener Status', 'POV', 'Storyline', 'Location',
    ]);
    expect(proposals['Synopsis']).toEqual({ target: 'rt-key', key: 'Synopsis' });
    expect(proposals['Status']).toEqual({ target: 'rt-key', key: 'Status' });
    // The adapter's collision-prefixed key still automaps to the RT key.
    expect(proposals['Scrivener Status']).toEqual({ target: 'rt-key', key: 'Status' });
    expect(proposals['POV']).toEqual({ target: 'rt-key', key: 'POV' });
    expect(proposals['Storyline']).toEqual({ target: 'rt-key', key: 'Subplot' });
    expect(proposals['Location']).toEqual({ target: 'rt-key', key: 'Place' });
  });

  it('keeps Label, Keywords, and unknown fields as custom (nothing silently lost)', () => {
    const proposals = proposeScrivenerAutomap(['Label', 'Keywords', 'Magic System']);
    expect(proposals['Label']).toEqual({ target: 'custom' });
    expect(proposals['Keywords']).toEqual({ target: 'custom' });
    expect(proposals['Magic System']).toEqual({ target: 'custom' });
  });

  it('ignores derived outliner columns', () => {
    const proposals = proposeScrivenerAutomap([
      'Word Count', 'Total Word Count', 'Modified Date', 'Include in Compile', 'Section Type',
    ]);
    for (const field of Object.keys(proposals)) {
      expect(proposals[field]).toEqual({ target: 'ignore' });
    }
  });
});

describe('applyMetadataMapping', () => {
  const mapping: Record<string, ScrivenerFieldTarget> = {
    'Scrivener Status': { target: 'rt-key', key: 'Status' },
    Storyline: { target: 'rt-key', key: 'Subplot' },
    'Word Count': { target: 'ignore' },
    Label: { target: 'custom' },
  };

  it('renames rt-key fields, keeps custom, drops ignored', () => {
    const out = applyMetadataMapping(
      { 'Scrivener Status': 'First Draft', 'Word Count': '812', Label: 'Blue', Storyline: 'Revenge' },
      mapping
    );
    expect(out).toEqual({ Status: 'First Draft', Label: 'Blue', Subplot: 'Revenge' });
  });

  it('subplot-flag: column NAME becomes the subplot, cell text stays as a note', () => {
    const flags: Record<string, ScrivenerFieldTarget> = {
      'Operation FarStar': { target: 'subplot-flag' },
      'The IcT': { target: 'subplot-flag' },
      'Scrivener Status': { target: 'rt-key', key: 'Status' },
    };
    // Only FarStar has a value → scene belongs to "Operation FarStar".
    const out = applyMetadataMapping(
      { 'Operation FarStar': 'Picked up and adopted by Char.', 'The IcT': '', 'Scrivener Status': 'First Pass' },
      flags
    );
    expect(out.Subplot).toBe('Operation FarStar');
    expect(out['Operation FarStar']).toBe('Picked up and adopted by Char.'); // note preserved
    expect(out.Status).toBe('First Pass');
    expect('The IcT' in out).toBe(false); // empty cell = not flagged, nothing carried
  });

  it('subplot-flag: first flagged column wins when a scene is marked in several', () => {
    const flags: Record<string, ScrivenerFieldTarget> = {
      'Newlan as Leader': { target: 'subplot-flag' },
      BowShock: { target: 'subplot-flag' },
    };
    const out = applyMetadataMapping({ 'Newlan as Leader': 'x', BowShock: 'also x' }, flags);
    expect(out.Subplot).toBe('Newlan as Leader');
    expect(out.BowShock).toBe('also x'); // the other column's note still rides along
  });

  it('keeps unmapped fields as-is and lets the first writer win on collision', () => {
    const out = applyMetadataMapping(
      { Mood: 'tense', A: 'first', B: 'second' },
      { A: { target: 'rt-key', key: 'Same' }, B: { target: 'rt-key', key: 'Same' } }
    );
    expect(out.Mood).toBe('tense');
    expect(out.Same).toBe('first');
  });
});

describe('applyMetadataMappingToModel', () => {
  it('maps every scene and recomputes customFields', () => {
    const model = {
      sourceKind: 'scrivener' as const,
      customFields: ['Storyline', 'Word Count', 'Label'],
      chapters: [{
        title: null,
        scenes: [{
          title: 'One',
          rawText: 'text',
          knownMetadata: { Storyline: 'Revenge', 'Word Count': '812', Label: 'Blue' },
          knownSynopsis: null,
          sourceRef: '01 One.md',
          alreadyOnboarded: false,
        }],
      }],
    };
    const out = applyMetadataMappingToModel(model, {
      Storyline: { target: 'rt-key', key: 'Subplot' },
      'Word Count': { target: 'ignore' },
      Label: { target: 'custom' },
    });
    expect(out.chapters[0].scenes[0].knownMetadata).toEqual({ Subplot: 'Revenge', Label: 'Blue' });
    expect(out.customFields).toEqual(['Label', 'Subplot']);
    // Original model untouched (pure).
    expect(model.chapters[0].scenes[0].knownMetadata['Word Count']).toBe('812');
  });
});

describe('real-export furniture (recursive exports)', () => {
  it('classifies MetaData/Notes sidecars and snapshot folders', () => {
    expect(isScrivenerAuxiliaryFile('A Party MetaData.txt')).toBe(true);
    expect(isScrivenerAuxiliaryFile('A Party Notes.txt')).toBe(true);
    expect(isScrivenerAuxiliaryFile('A Party.txt')).toBe(false);
    expect(isSnapshotFolderName('Intruder Snapshots')).toBe(true);
    expect(isSnapshotFolderName('Intruder')).toBe(false);
  });

  it('derives the structural act from ACT folders (deepest wins, none = undefined)', () => {
    expect(deriveSourceAct('Book/Book/ACT 1/A Party.txt')).toBe(1);
    expect(deriveSourceAct('Book/ACT 2/sub/Scene.txt')).toBe(2);
    expect(deriveSourceAct('Book/Book/Wrapup/Finale.txt')).toBeUndefined();
    expect(deriveSourceAct('Practice ACT/Scene.txt')).toBeUndefined();
  });

  it('skips auxiliary, snapshot, and empty files during ingest and stamps sourceAct', async () => {
    const files: ScrivenerFile[] = [
      { fileName: '1 Hook.txt', path: 'Book/ACT 1/1 Hook.txt', content: 'Real prose.' },
      { fileName: '1 Hook MetaData.txt', path: 'Book/ACT 1/1 Hook MetaData.txt', content: 'Status: First Pass' },
      { fileName: '1 Hook Notes.txt', path: 'Book/ACT 1/1 Hook Notes.txt', content: 'author note' },
      { fileName: 'Old.txt', path: 'Book/ACT 1/Hook Snapshots/Old.txt', content: 'stale snapshot' },
      { fileName: '2 Beat.txt', path: 'Book/ACT 1/2 Beat.txt', content: '   ' },
      { fileName: '3 Finale.txt', path: 'Book/Wrapup/3 Finale.txt', content: 'The end.' },
    ];
    const result = await ingestScrivenerFolder(sourceOf(files, null), 'Book');
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    const scenes = flattenScenes(result.model);
    expect(scenes.map((scene) => scene.title)).toEqual(['Hook', 'Finale']);
    expect(scenes[0].sourceAct).toBe(1);
    expect(scenes[1].sourceAct).toBeUndefined();
  });
});
