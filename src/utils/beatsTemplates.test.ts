import { describe, expect, it } from 'vitest';
import type { PlotSystemPreset } from './beatsSystems';
import { createBeatNotesFromSet, ensureBeatInThisBookTemplateField } from './beatsTemplates';
import { DEFAULT_SETTINGS } from '../settings/defaults';
import { getTemplateParts } from './yamlTemplateNormalize';

function createVaultMock() {
    const files = new Map<string, string>();
    return {
        files,
        getAbstractFileByPath(path: string) {
            return files.has(path) ? { path } : null;
        },
        async createFolder() {
            return undefined;
        },
        async create(path: string, content: string) {
            files.set(path, content);
            return { path, content };
        }
    };
}

describe('beatsTemplates', () => {
    it('keeps canonical Purpose in default export output', async () => {
        const vault = createVaultMock();
        const customSystem: PlotSystemPreset = {
            name: 'Custom',
            beatCount: 1,
            beats: ['Opening Beat'],
            beatDetails: [
                {
                    name: 'Opening Beat',
                    description: 'Legacy purpose',
                    act: 1
                }
            ]
        };

        await createBeatNotesFromSet(vault as never, 'Custom', 'Story', customSystem);

        const created = vault.files.values().next().value as string;
        expect(created).toContain('Purpose: "Legacy purpose"');
        expect(created).not.toContain('Description: "Legacy purpose"');
    });

    it('keeps Description placeholder compatibility only at the template export boundary', async () => {
        const vault = createVaultMock();
        const customSystem: PlotSystemPreset = {
            name: 'Custom',
            beatCount: 1,
            beats: ['Opening Beat'],
            beatDetails: [
                {
                    name: 'Opening Beat',
                    description: 'Legacy purpose',
                    act: 1
                }
            ]
        };

        await createBeatNotesFromSet(vault as never, 'Custom', 'Story', customSystem, {
            beatTemplate: '---\nClass: Beat\nDescription: {{Description}}\nBeat Model: {{BeatModel}}\n---'
        });

        const created = vault.files.values().next().value as string;
        expect(created).toContain('Description: "Legacy purpose"');
        expect(created).not.toContain('{{Description}}');
    });

    it('supports explicit scene anchoring for beat filenames', async () => {
        const vault = createVaultMock();
        const customSystem: PlotSystemPreset = {
            name: 'Custom',
            beatCount: 2,
            beats: ['Opening Beat', 'Closing Beat'],
            beatDetails: [
                {
                    name: 'Opening Beat',
                    description: 'Opener',
                    act: 1
                },
                {
                    name: 'Closing Beat',
                    description: 'Closer',
                    act: 3
                }
            ]
        };

        await createBeatNotesFromSet(vault as never, 'Custom', 'Story', customSystem, {
            explicitSceneNumbers: [3, 12]
        });

        expect([...vault.files.keys()]).toEqual([
            'Story/3.01 Opening Beat.md',
            'Story/12.01 Closing Beat.md'
        ]);
    });
});

describe('In This Book beat field', () => {
    const preFieldBase = 'ID:\nClass: Beat\nBeat Model: {{BeatModel}}\nAct: {{Act}}\nPurpose: {{Purpose}}\nRange: {{Range}}\nChapter:';

    it('adds In This Book right after Purpose in a stored template that predates it', () => {
        expect(ensureBeatInThisBookTemplateField(preFieldBase)).toBe(
            'ID:\nClass: Beat\nBeat Model: {{BeatModel}}\nAct: {{Act}}\nPurpose: {{Purpose}}\nIn This Book:\nRange: {{Range}}\nChapter:'
        );
    });

    it('is idempotent and leaves a template without Purpose alone', () => {
        const migrated = ensureBeatInThisBookTemplateField(preFieldBase);
        expect(ensureBeatInThisBookTemplateField(migrated)).toBe(migrated);
        expect(ensureBeatInThisBookTemplateField(DEFAULT_SETTINGS.beatYamlTemplates!.base))
            .toBe(DEFAULT_SETTINGS.beatYamlTemplates!.base);
        expect(ensureBeatInThisBookTemplateField('Class: Beat\nAct: {{Act}}')).toBe('Class: Beat\nAct: {{Act}}');
    });

    it('seeds an empty In This Book line into new beat notes, after Purpose', async () => {
        const vault = createVaultMock();
        const system: PlotSystemPreset = {
            name: 'Custom',
            beatCount: 1,
            beats: ['Break into Three'],
            beatDetails: [{ name: 'Break into Three', description: 'The protagonist has an epiphany.', act: 3 }]
        };
        const beatTemplate = getTemplateParts('Beat', DEFAULT_SETTINGS).merged;

        await createBeatNotesFromSet(vault as never, 'Custom', 'Story', system, { beatTemplate });

        const [content] = [...vault.files.values()];
        expect(content).toMatch(/^Purpose: "The protagonist has an epiphany\."\nIn This Book:\n/m);
    });
});
