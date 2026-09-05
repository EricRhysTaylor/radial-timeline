import { describe, expect, it } from 'vitest';
import type { PlotSystemPreset } from './beatsSystems';
import { createBeatNotesFromSet } from './beatsTemplates';

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
