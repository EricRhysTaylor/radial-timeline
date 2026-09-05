import { describe, expect, it } from 'vitest';
import { TFile, type App } from 'obsidian';
import { useSystemTrash, writeDeletionSnapshot } from './logVaultOps';

function buildMockApp(trashOption?: string): App {
    return {
        vault: {
            getConfig: (key: string) => {
                if (key === 'trashOption') return trashOption;
                return undefined;
            },
        },
    } as unknown as App;
}

describe('useSystemTrash', () => {
    it('returns true when user has trashOption set to system', () => {
        expect(useSystemTrash(buildMockApp('system'))).toBe(true);
    });

    it('returns false when user has trashOption set to local', () => {
        expect(useSystemTrash(buildMockApp('local'))).toBe(false);
    });

    it('returns false when user has trashOption set to none', () => {
        expect(useSystemTrash(buildMockApp('none'))).toBe(false);
    });

    it('returns false when trashOption is undefined', () => {
        expect(useSystemTrash(buildMockApp(undefined))).toBe(false);
    });

    it('returns false when getConfig is not available', () => {
        const app = { vault: {} } as unknown as App;
        expect(useSystemTrash(app)).toBe(false);
    });

    it('returns false when vault.getConfig throws', () => {
        const app = {
            vault: {
                getConfig: () => { throw new Error('broken'); },
            },
        } as unknown as App;
        expect(useSystemTrash(app)).toBe(false);
    });
});

function buildSnapshotMockApp(): { app: App; created: Array<{ path: string; content: string }> } {
    const created: Array<{ path: string; content: string }> = [];
    const app = {
        vault: {
            getAbstractFileByPath: () => null,
            createFolder: async () => { /* no-op: always "creates" successfully */ },
            create: async (path: string, content: string) => { created.push({ path, content }); },
        },
    } as unknown as App;
    return { app, created };
}

describe('writeDeletionSnapshot', () => {
    it('returns null and writes nothing when every previewed field is empty', async () => {
        const { app, created } = buildSnapshotMockApp();
        const file = new TFile('Scenes/One.md');
        const preview = new Map([[file, { fields: ['Foo'], values: { Foo: '' } }]]);

        const result = await writeDeletionSnapshot(app, {
            noteType: 'Scene',
            operation: 'delete_advanced',
            preview,
            scopeSummary: 'All scenes',
        });

        expect(result).toBeNull();
        expect(created).toHaveLength(0);
    });

    it('writes the snapshot under Recover/Snapshots, named after the note type, dropping empty-valued fields', async () => {
        const { app, created } = buildSnapshotMockApp();
        const file = new TFile('Beats/One.md');
        const preview = new Map([[file, {
            fields: ['Foo', 'Bar'],
            values: { Foo: 'kept', Bar: '' },
        }]]);

        const result = await writeDeletionSnapshot(app, {
            noteType: 'Beat',
            operation: 'delete_advanced',
            preview,
            scopeSummary: 'Active book',
        });

        expect(result).toMatch(/^Radial Timeline\/Recover\/Snapshots\/.+-beat-delete_advanced\.json$/);
        expect(created).toHaveLength(1);
        expect(created[0].path).toBe(result);

        const payload = JSON.parse(created[0].content);
        expect(payload.noteType).toBe('Beat');
        expect(payload.operation).toBe('delete_advanced');
        expect(payload.scopeSummary).toBe('Active book');
        expect(payload.filesWithValuedDeletes).toBe(1);
        expect(payload.valuedFieldDeletes).toBe(1);
        expect(payload.entries).toEqual([{
            path: 'Beats/One.md',
            basename: 'One',
            fields: [{ key: 'Foo', value: 'kept' }],
        }]);
    });
});
