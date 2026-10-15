import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type RadialTimelinePlugin from '../src/main';
import { ingestMarkdownFolder, type MarkdownNote } from '../src/onboarding/adapters/mdAdapter';
import { flattenScenes } from '../src/onboarding/adapters/manuscriptModel';
import { applySplitsToModel, planSceneSplit } from '../src/onboarding/sceneSplitting';
import { OnboardingService } from '../src/onboarding/OnboardingService';

// Opt-in acceptance against prepared public-domain source files, never an author vault.
const sourceRoot = process.env.RT_VERSE_SOURCE_QA;

describe.skipIf(!sourceRoot)('prepared verse through the shipped onboarding pipeline', () => {
  it('retains all 75 canto units, six separate proems, stanza references and source lines without AI', async () => {
    if (!sourceRoot) throw new Error('RT_VERSE_SOURCE_QA is required');
    const manifest = JSON.parse(await readFile(join(sourceRoot, 'source-inventory.json'), 'utf8')) as {
      units: number;
      narrativeUnits: number;
      proems: number;
      stanzas: number;
      files: Array<{ path: string; sha256: string; stanzas: number }>;
    };
    expect(manifest).toMatchObject({ units: 81, narrativeUnits: 75, proems: 6, stanzas: 3848 });
    let stanzaCount = 0;
    for (const entry of manifest.files) {
      const text = await readFile(join(sourceRoot, entry.path), 'utf8');
      expect(createHash('sha256').update(text).digest('hex')).toBe(entry.sha256);
      expect(text).not.toMatch(/^Class:/m);
      expect(text.match(/^##### Stanza \d+/gm)).toHaveLength(entry.stanzas);
      stanzaCount += entry.stanzas;
    }
    expect(stanzaCount).toBe(3848);
    const folders = (await readdir(sourceRoot)).filter((name) => /^\d{2} Book /.test(name)).sort();
    expect(folders).toHaveLength(7);
    // SAFE: deterministic proposal construction reads actCount only; no runtime/provider calls.
    const service = new OnboardingService({ settings: { actCount: 3 } } as unknown as RadialTimelinePlugin);
    let total = 0;
    for (const folder of folders) {
      const names = (await readdir(join(sourceRoot, folder))).filter((name) => name.endsWith('.md'));
      const notes: MarkdownNote[] = await Promise.all(names.map(async (name) => {
        const content = await readFile(join(sourceRoot, folder, name), 'utf8');
        const metadata: Record<string, string> = {};
        for (const line of content.split('---')[1].trim().split('\n')) {
          const colon = line.indexOf(':');
          metadata[line.slice(0, colon)] = JSON.parse(line.slice(colon + 1));
        }
        return { fileName: name, path: `${folder}/${name}`, content, frontmatter: metadata };
      }));
      const result = await ingestMarkdownFolder({ listNotes: async () => notes, readToc: async () => null }, folder);
      expect(result.kind).toBe('ok');
      if (result.kind !== 'ok') throw new Error(result.reason);
      const scenes = flattenScenes(result.model);
      expect(scenes).toHaveLength(folder.startsWith('07') ? 3 : 12);
      const plans = new Map(scenes.map((scene) => [scene.sourceRef, planSceneSplit(scene)]));
      const confirmed = applySplitsToModel(result.model, plans);
      expect(flattenScenes(confirmed).map((scene) => scene.rawText)).toEqual(scenes.map((scene) => scene.rawText));
      const preview = service.buildStructureOnlyProposals(confirmed, { publishStage: 'Press' });
      expect(preview.proposals).toHaveLength(scenes.length);
      for (let i = 0; i < scenes.length; i++) {
        expect(preview.proposals[i].body).toBe(scenes[i].rawText);
        expect(preview.proposals[i].frontmatter?.['Source Reference']).toBe(scenes[i].knownMetadata['Source Reference']);
        expect(preview.proposals[i].frontmatter).not.toHaveProperty('When');
        expect(preview.proposals[i].frontmatter).not.toHaveProperty('Summary');
      }
      total += scenes.length;
    }
    expect(total).toBe(75);
  });
});
