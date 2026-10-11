import { describe, expect, it, vi } from 'vitest';
import type { App } from 'obsidian';
import { TFile, TFolder } from '../../tests/mocks/obsidian';
import { makeFile } from '../../tests/helpers/obsidianFixtures';
import type RadialTimelinePlugin from '../main';
import { DEFAULT_SETTINGS } from '../settings/defaults';
import { CommandRegistrar } from './CommandRegistrar';
import { PublishingValidationService } from './PublishingValidationService';
import type { ManuscriptModalResult } from '../modals/ManuscriptOptionsModal';

function fixture() {
    const files = ['Book/1 First.md', 'Book/2 Second.md'].map(name => Object.assign(new TFile(name), makeFile(name)));
    const content = new Map([[files[0].path, 'First scene prose.\n\n%%private note%%'], [files[1].path, 'Second scene prose.\n\n%%private note%%']]);
    const writes = vi.fn();
    const app = {
        vault: {
            getMarkdownFiles: () => files,
            getAbstractFileByPath: (name: string) => files.find(file => file.path === name) || (['Book', 'Exports'].includes(name) ? new TFolder(name) : null),
            cachedRead: async (file: { path: string }) => content.get(file.path) || '',
            read: async (file: { path: string }) => content.get(file.path) || '',
        },
        metadataCache: { getFileCache: () => ({ frontmatter: { Class: 'Scene' } }) },
        fileManager: { processFrontMatter: writes },
    } as unknown as App;
    const plugin = {
        app,
        settings: { ...DEFAULT_SETTINGS, books: [{ id: 'book', title: 'Test book', sourceFolder: 'Book' }], activeBookId: 'book', pandocLayouts: [], manuscriptOutputFolder: 'Exports' },
        saveSettings: async () => {},
        getBookMeta: () => null,
        getSceneData: async () => files.map((file, index) => ({ path: file.path, title: file.basename, itemType: 'Scene', number: `${index + 1}`, subplot: 'Main Plot', rawFrontmatter: { Class: 'Scene' } })),
    } as unknown as RadialTimelinePlugin;
    plugin.getPublishingValidationService = () => new PublishingValidationService(plugin);
    const registrar = new CommandRegistrar(plugin, app);
    const writer = vi.spyOn(registrar as unknown as { writeVaultTextFile: (name: string, text: string, operation: string) => Promise<boolean> }, 'writeVaultTextFile').mockResolvedValue(true);
    const options: ManuscriptModalResult = {
        order: 'narrative', tocMode: 'none', exportType: 'manuscript', outputFormat: 'markdown', manuscriptPreset: 'novel', updateWordCounts: false,
        exportCleanup: { stripComments: true, stripAiComments: true, stripLinks: true, stripCallouts: true, stripBlockIds: true },
    };
    return { registrar, writer, writes, options };
}

describe('manuscript export UI-to-runner contract', () => {
    it('exports the selected prose without BookMeta and removes private notes', async () => {
        const { registrar, writer, writes, options } = fixture();
        const outcome = await registrar['handleManuscriptExport']({ ...options, rangeStart: 2, rangeEnd: 2 });
        expect(outcome.savedPath).toMatch(/^Exports\/.*\.md$/);
        const text = writer.mock.calls[0][1];
        expect(text).toContain('Second scene prose.');
        expect(text).not.toContain('First scene prose.');
        expect(text).not.toContain('private note');
        expect(writes).not.toHaveBeenCalled();
    });

    it('retains completed paths when a later split part fails', async () => {
        const { registrar, writer, options } = fixture();
        // Folder creation is outside this failure boundary; keep output placement fixed.
        vi.spyOn(registrar as unknown as { createSplitOutputFolder: () => Promise<string> }, 'createSplitOutputFolder').mockResolvedValue('Exports/Split');
        writer.mockResolvedValueOnce(true).mockRejectedValueOnce(new Error('Permission denied'));
        await expect(registrar['handleManuscriptExport']({ ...options, splitMode: 'parts', splitParts: 2 })).rejects.toMatchObject({
            category: 'write_failure', completedPaths: ['Exports/Split/Test book - Part 1.md'],
        });
    });
});
