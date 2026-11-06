import { describe, expect, it } from 'vitest';
import type { App, TFile } from 'obsidian';
import { DEFAULT_SETTINGS } from '../settings/defaults';
import { runYamlAudit } from './yamlAudit';

const auditNote = async (frontmatter: Record<string, unknown>) => {
    const file = { path: 'Book/1 Scene.md', basename: '1 Scene' } as TFile;
    const app = { metadataCache: { getFileCache: () => ({ frontmatter }) } } as unknown as App;
    const settings = {
        ...DEFAULT_SETTINGS,
        sceneYamlTemplates: { ...DEFAULT_SETTINGS.sceneYamlTemplates!, advanced: 'Mood:' },
    };
    const result = await runYamlAudit({ app, settings, noteType: 'Scene', files: [file] });
    return result.notes[0] ?? { missingFields: [], extraKeys: [] };
};

describe('YAML audit letter case', () => {
    it('counts a property as present in any letter case, and never offers it for deletion', async () => {
        const note = await auditNote({ Class: 'Scene', mood: 'tense' });
        expect(note.missingFields).not.toContain('Mood');
        expect(note.extraKeys).not.toContain('mood');
    });

    it('still reports a property that is truly absent or foreign', async () => {
        const note = await auditNote({ Class: 'Scene', Weather: 'rain' });
        expect(note.missingFields).toContain('Mood');
        expect(note.extraKeys).toContain('Weather');
    });
});
