import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { App } from 'obsidian';
import { TFile, TFolder } from '../../tests/mocks/obsidian';
import { makeFile } from '../../tests/helpers/obsidianFixtures';
import type RadialTimelinePlugin from '../main';
import { DEFAULT_SETTINGS } from '../settings/defaults';
import { CommandRegistrar } from './CommandRegistrar';
import { PublishingValidationService } from './PublishingValidationService';
import type { ManuscriptModalResult } from '../modals/ManuscriptOptionsModal';
import { getVaultAbsolutePath, runPandocOnContent } from '../utils/exportFormats';
import { ManuscriptOptionsModal } from '../modals/ManuscriptOptionsModal';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'; // SAFE: isolated local export fixtures, removed after verification.
import { tmpdir } from 'node:os'; // SAFE: test-only temporary folder location.
import { join } from 'node:path'; // SAFE: test-only export fixture paths.
import { execFileSync } from 'node:child_process'; // SAFE: opt-in local Poppler verification of the excerpt PDF.

vi.mock('../utils/exportFormats', async (importOriginal) => ({
    ...await importOriginal<typeof import('../utils/exportFormats')>(),
    validatePandocLayout: () => ({ valid: true }),
    getStructuredFontDiagnostic: () => ({ state: 'ok' }),
    getTemplateFontDiagnostics: () => ({ fontsEmbeddedInPdf: false, missingRequiredFonts: [] }),
    getVaultAbsolutePath: vi.fn(() => '/tmp/rt-export-contract'),
    runPandocOnContent: vi.fn(async (_text: string, destination: string) => destination),
}));
vi.mock('../utils/pandocBundledLayouts', async (importOriginal) => ({
    ...await importOriginal<typeof import('../utils/pandocBundledLayouts')>(),
    ensureManuscriptReferenceDocxInstalled: () => ({ path: '/tmp/reference.docx', installed: false }),
}));

beforeEach(() => vi.clearAllMocks());

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
    return { registrar, writer, writes, options, plugin };
}

function formattedFixture() {
    const setup = fixture();
    setup.plugin.settings.pandocLayouts = [{ id: 'test-layout', name: 'Test layout', preset: 'novel', path: '/tmp/test-layout.tex', tier: 'free' }];
    const service = new PublishingValidationService(setup.plugin);
    const snapshot = service.collect('book', { exportType: 'manuscript', outputFormat: 'markdown' });
    vi.spyOn(service, 'collect').mockReturnValue(snapshot);
    vi.spyOn(service, 'resolveBookMetaForBook').mockReturnValue({ bookMeta: { title: 'Test book', author: 'Test author' } });
    setup.plugin.getPublishingValidationService = () => service;
    return setup;
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

    it.each(['pdf', 'docx'] as const)('exports the same selected excerpt to %s without broadening it', async (outputFormat) => {
        const { registrar, writer, writes, options } = formattedFixture();
        await registrar['handleManuscriptExport']({ ...options, rangeStart: 2, rangeEnd: 2 });
        const markdown = writer.mock.calls[0][1];
        const outcome = await registrar['handleManuscriptExport']({ ...options, outputFormat, selectedLayoutId: 'test-layout', rangeStart: 2, rangeEnd: 2, saveMarkdownArtifact: false });
        expect(outcome.renderedPath).toMatch(new RegExp(`^Exports/.*\\.${outputFormat}$`));
        const renderedText = vi.mocked(runPandocOnContent).mock.calls[0][0];
        for (const text of [markdown, renderedText]) {
            expect(text).toContain('Second scene prose.');
            expect(text).not.toContain('First scene prose.');
            expect(text).not.toContain('private note');
        }
        expect(writes).not.toHaveBeenCalled();
    });

    it('keeps explicit selected-note filtering in PDF', async () => {
        const { registrar, options } = formattedFixture();
        await registrar['handleManuscriptExport']({ ...options, outputFormat: 'pdf', selectedLayoutId: 'test-layout', scenePathFilter: ['Book/2 Second.md'], rangeStart: 1, rangeEnd: 1, saveMarkdownArtifact: false });
        const text = vi.mocked(runPandocOnContent).mock.calls[0][0];
        expect(text).toContain('Second scene prose.');
        expect(text).not.toContain('First scene prose.');
    });

    it('does not ignore a PDF subplot filter', async () => {
        const { registrar, options } = formattedFixture();
        const outcome = await registrar['handleManuscriptExport']({ ...options, outputFormat: 'pdf', selectedLayoutId: 'test-layout', subplot: 'Other plot', saveMarkdownArtifact: false });
        expect(outcome).toEqual({});
        expect(runPandocOnContent).not.toHaveBeenCalled();
    });

    it('preserves the modal selection when switching formats', () => {
        const { plugin } = formattedFixture();
        const modal = new ManuscriptOptionsModal(plugin.app, plugin, async () => ({}));
        modal['totalScenes'] = 2;
        modal['rangeStart'] = 2;
        modal['rangeEnd'] = 2;
        modal['order'] = 'chronological';
        modal['subplot'] = 'Main Plot';
        modal['hasWhenDates'] = true;
        const reload = vi.spyOn(modal as unknown as { loadScenesForOrder: () => Promise<void> }, 'loadScenesForOrder');
        for (const format of ['pdf', 'docx', 'markdown'] as const) {
            modal['outputFormat'] = format;
            modal['syncExportUi']();
            expect([modal['rangeStart'], modal['rangeEnd'], modal['order'], modal['subplot']]).toEqual([2, 2, 'chronological', 'Main Plot']);
        }
        expect(reload).not.toHaveBeenCalled();
    });

    it('moves range endpoints with the keyboard without crossing or exceeding the manuscript', () => {
        const { plugin } = formattedFixture();
        const modal = new ManuscriptOptionsModal(plugin.app, plugin, async () => ({}));
        modal['totalScenes'] = 5;
        modal['rangeStart'] = 2;
        modal['rangeEnd'] = 4;
        const press = (handle: 'start' | 'end', key: string) => {
            const event = { key, preventDefault: vi.fn(), stopPropagation: vi.fn() };
            modal['handleRangeKeyDown'](handle, event as unknown as KeyboardEvent);
            return event;
        };
        expect(press('start', 'ArrowRight').preventDefault).toHaveBeenCalled();
        expect(modal['rangeStart']).toBe(3);
        press('start', 'End');
        expect(modal['rangeStart']).toBe(4);
        press('end', 'Home');
        expect(modal['rangeEnd']).toBe(4);
        press('start', 'Home');
        press('start', 'ArrowLeft');
        press('end', 'End');
        press('end', 'ArrowRight');
        expect([modal['rangeStart'], modal['rangeEnd']]).toEqual([1, 5]);
        expect(press('start', 'Tab').preventDefault).not.toHaveBeenCalled();
    });

    it('submits an open-scene excerpt without applying its range twice', async () => {
        const { registrar, plugin, writes } = formattedFixture();
        const submit = vi.fn((result: ManuscriptModalResult) => registrar['handleManuscriptExport'](result));
        const modal = new ManuscriptOptionsModal(plugin.app, plugin, submit);
        modal['totalScenes'] = 2;
        modal['scenePaths'] = ['Book/1 First.md', 'Book/2 Second.md'];
        modal['rangeStart'] = 2;
        modal['rangeEnd'] = 2;
        modal['subplot'] = '__open_scenes__';
        modal['outputFormat'] = 'pdf';
        modal['updateWordCounts'] = false;
        modal['saveMarkdownArtifact'] = false;
        await modal['submit']();
        expect(submit).toHaveBeenCalledWith(expect.objectContaining({
            scenePathFilter: ['Book/2 Second.md'], rangeStart: undefined, rangeEnd: undefined,
        }));
        expect(runPandocOnContent).toHaveBeenCalledOnce();
        expect(vi.mocked(runPandocOnContent).mock.calls[0][0]).toContain('Second scene prose.');
        expect(vi.mocked(runPandocOnContent).mock.calls[0][0]).not.toContain('First scene prose.');
        expect(writes).not.toHaveBeenCalled();
    });

    it('uses the chosen PDF order before selecting the range', async () => {
        const { registrar, options } = formattedFixture();
        await registrar['handleManuscriptExport']({ ...options, outputFormat: 'pdf', order: 'reverse-narrative', selectedLayoutId: 'test-layout', rangeStart: 1, rangeEnd: 1, saveMarkdownArtifact: false });
        const text = vi.mocked(runPandocOnContent).mock.calls[0][0];
        expect(text).toContain('Second scene prose.');
        expect(text).not.toContain('First scene prose.');
    });

    it.runIf(process.env.RT_PUBLISH_LIVE_OUTPUT === '1')('renders the runner-selected excerpt into a real PDF', async () => {
        const folder = mkdtempSync(join(tmpdir(), 'rt-range-pdf-'));
        try {
            const template = join(folder, 'excerpt.tex');
            writeFileSync(template, '\\documentclass{article}\n\\usepackage{hyperref}\n\\begin{document}\n$body$\n\\end{document}\n');
            const { registrar, options, plugin, writes } = formattedFixture();
            plugin.settings.pandocLayouts[0].path = template;
            vi.mocked(getVaultAbsolutePath).mockReturnValueOnce(folder);
            const actual = await vi.importActual<typeof import('../utils/exportFormats')>('../utils/exportFormats');
            vi.mocked(runPandocOnContent).mockImplementationOnce(actual.runPandocOnContent);
            const outcome = await registrar['handleManuscriptExport']({ ...options, outputFormat: 'pdf', selectedLayoutId: 'test-layout', rangeStart: 2, rangeEnd: 2, saveMarkdownArtifact: false });
            expect(outcome.renderedPath).toBeTruthy();
            const destination = vi.mocked(runPandocOnContent).mock.calls.at(-1)![1];
            const text = execFileSync('pdftotext', [destination, '-'], { encoding: 'utf8' });
            expect(text).toContain('Second scene prose.');
            expect(text).not.toContain('First scene prose.');
            expect(text).not.toContain('private note');
            expect(writes).not.toHaveBeenCalled();
        } finally {
            rmSync(folder, { recursive: true, force: true });
        }
    }, 60_000);
});
