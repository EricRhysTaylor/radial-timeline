import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { App, ButtonComponent, DropdownComponent } from 'obsidian';
import { TFile, TFolder } from '../../tests/mocks/obsidian';
import { makeFile } from '../../tests/helpers/obsidianFixtures';
import type RadialTimelinePlugin from '../main';
import { DEFAULT_SETTINGS } from '../settings/defaults';
import { CommandRegistrar } from './CommandRegistrar';
import { PublishingValidationService } from './PublishingValidationService';
import type { ManuscriptModalResult } from '../modals/ManuscriptOptionsModal';
import { getVaultAbsolutePath, runPandocOnContent } from '../utils/exportFormats';
import { ManuscriptOptionsModal } from '../modals/ManuscriptOptionsModal';
import { checkExportDelivery } from '../publishing/exportDelivery';
import * as exportFormats from '../utils/exportFormats';
import { ExportFailure } from '../utils/exportErrors';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'; // SAFE: isolated local export fixtures, removed after verification.
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
vi.mock('../publishing/exportDelivery', async (importOriginal) => ({
    ...await importOriginal<typeof import('../publishing/exportDelivery')>(),
    checkExportDelivery: vi.fn(async () => ({ schemaVersion: 1, receiptPath: 'Exports/Receipts/test.json', files: [], problems: [], expectedFiles: 1 })),
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
        isSettingsPersistenceBlocked: () => false,
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
    return { registrar, writer, writes, options, plugin, files, content };
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
    it.each(['pdf', 'docx'] as const)('passes document contents and depth to %s rendering', async outputFormat => {
        const { registrar, options } = formattedFixture();
        vi.spyOn(registrar as unknown as { ensureVaultFolderPath(path: string): Promise<void> }, 'ensureVaultFolderPath').mockResolvedValue(undefined);
        await registrar['handleManuscriptExport']({ ...options, outputFormat, tocMode: 'document', tocDepth: 2 });
        expect(runPandocOnContent).toHaveBeenCalledWith(expect.any(String), expect.any(String), expect.objectContaining({ targetFormat: outputFormat, documentContents: true, tocDepth: 2 }));
    });
    it('builds per-file Markdown contents after cleanup in split exports', async () => {
        const { registrar, writer, options } = fixture();
        vi.spyOn(registrar as unknown as { ensureVaultFolderPath(path: string): Promise<void> }, 'ensureVaultFolderPath').mockResolvedValue(undefined);
        await registrar['handleManuscriptExport']({ ...options, tocMode: 'document', splitMode: 'parts', splitParts: 2 });
        const outputs = writer.mock.calls.map(call => call[1]);
        expect(outputs).toHaveLength(2);
        expect(outputs[0]).toContain('[1 First](#^manuscript-heading-1)');
        expect(outputs[0]).not.toContain('2 Second');
        expect(outputs[1]).toContain('[2 Second](#^manuscript-heading-1)');
        expect(outputs[1]).not.toContain('1 First');
        expect(outputs[0]).not.toContain('private note');
    });
    it('attaches checks for completed outputs when a later split render fails', async () => {
        const { registrar, options, plugin } = formattedFixture();
        vi.spyOn(registrar as unknown as { ensureVaultFolderPath(path: string): Promise<void> }, 'ensureVaultFolderPath').mockResolvedValue(undefined);
        vi.mocked(runPandocOnContent).mockImplementationOnce(async (_text, path) => path).mockRejectedValueOnce(new Error('Second part failed'));
        const failure = await registrar['handleManuscriptExport']({ ...options, outputFormat: 'docx', splitMode: 'parts', splitParts: 2 }).catch(error => error as import('../utils/exportErrors').ExportFailure);
        if (!(failure instanceof ExportFailure)) throw new Error('Expected a split export failure.');
        expect(failure.completedPaths).toHaveLength(1);
        expect(failure.delivery).toBeDefined();
        expect(checkExportDelivery).toHaveBeenCalledWith(plugin, expect.anything(), expect.objectContaining({ renderedPaths: failure.completedPaths }), 'Test book', ['Book/1 First.md', 'Book/2 Second.md'], expect.any(String));
    });
    it('routes an explicit destination and actual selected sources into delivery checks', async () => {
        const { registrar, plugin, options } = fixture();
        const outcome = await registrar['handleManuscriptExport']({ ...options, outputFolder: 'Book', reviewedSourcePaths: ['Book/2 Second.md'], rangeStart: 2, rangeEnd: 2 });
        expect(checkExportDelivery).toHaveBeenCalledWith(plugin, expect.objectContaining({ outputFolder: 'Book' }), expect.objectContaining({ outputFolder: 'Book' }), 'Test book', ['Book/2 Second.md']);
        expect(outcome.delivery?.receiptPath).toBe('Exports/Receipts/test.json');
    });
    it('blocks changed selections and destinations that would overwrite a source note', async () => {
        const { registrar, writer, options } = fixture();
        await expect(registrar['handleManuscriptExport']({ ...options, reviewedSourcePaths: ['Book/2 Second.md'] })).rejects.toThrow('selection changed');
        const naming = vi.spyOn(exportFormats, 'buildExportFilename').mockReturnValue('1 First.md');
        try {
            await expect(registrar['handleManuscriptExport']({ ...options, outputFolder: 'Book' })).rejects.toThrow('overwrite a manuscript source');
            expect(writer).not.toHaveBeenCalled();
        } finally { naming.mockRestore(); }
    });
    it('shows an invalid destination before enabling generation', () => {
        const { plugin } = fixture();
        const modal = new ManuscriptOptionsModal(plugin.app, plugin, async () => ({}));
        modal['totalScenes'] = 2;
        modal['rangeEnd'] = 2;
        const setDisabled = vi.fn();
        modal['actionButton'] = { setDisabled } as unknown as ButtonComponent;
        modal['destination'] = '../outside';
        modal['updateDestinationUi']();
        expect(setDisabled).toHaveBeenLastCalledWith(true);
        modal['destination'] = 'QA Delivery';
        modal['updateDestinationUi']();
        expect(modal['destinationError']).toBeNull();
        expect(setDisabled).toHaveBeenLastCalledWith(false);
    });

    it('removes only the confirmed saved record while keeping the current source and other records', async () => {
        const { plugin, files } = fixture();
        const first = { schemaVersion: 1 as const, id: 'one', name: 'One', source: { kind: 'file' as const, path: files[0].path, paths: [files[0].path], title: 'One', author: 'Writer' }, candidatePaths: [files[0].path] };
        const second = { ...first, id: 'two', name: 'Two' };
        plugin.settings.savedManuscriptSources = [first, second];
        plugin.settings.lastUsedManuscriptSourceId = first.id;
        const modal = new ManuscriptOptionsModal(plugin.app, plugin, async () => ({}));
        modal['restoreSavedSourceState'](first);
        await modal['deleteSavedSource'](first.id);
        expect(plugin.settings.savedManuscriptSources).toEqual([second]);
        expect(plugin.settings.lastUsedManuscriptSourceId).toBeUndefined();
        expect(modal['source']).toEqual(first.source);
        expect(modal['savedSourceId']).toBeUndefined();
    });

    it('clears a recovered source error and re-enables review of a corrected selection', () => {
        const { plugin, files } = fixture();
        const modal = new ManuscriptOptionsModal(plugin.app, plugin, async () => ({}));
        modal['source'] = { kind: 'folder', path: 'Book', paths: [files[0].path], title: '', author: '' };
        modal['sourceReviewed'] = false;
        const errorEl = { toggleClass: vi.fn(), setText: vi.fn() };
        const setDisabled = vi.fn();
        modal['sourceErrorEl'] = errorEl as unknown as HTMLElement;
        modal['sourceReviewButton'] = { setDisabled } as unknown as ButtonComponent;
        modal['sourceError'] = 'Missing note';
        modal['updateSourceActions']();
        expect(errorEl.setText).toHaveBeenLastCalledWith('Missing note');
        expect(setDisabled).toHaveBeenLastCalledWith(true);
        modal['sourceError'] = null;
        modal['updateSourceActions']();
        expect(errorEl.toggleClass).toHaveBeenLastCalledWith('ert-hidden', true);
        expect(errorEl.setText).toHaveBeenLastCalledWith('');
        expect(setDisabled).toHaveBeenLastCalledWith(false);
    });

    it('saves reusable direct-source selections and restores them in a new modal', async () => {
        const { plugin, files } = fixture();
        const modal = new ManuscriptOptionsModal(plugin.app, plugin, async () => ({}));
        modal['source'] = { kind: 'folder', path: 'Book', paths: [files[1].path, files[0].path], title: 'Direct manuscript', author: 'Writer' };
        modal['sourceCandidates'] = [files[1].path, files[0].path];
        modal['savedSourceName'] = 'Editorial packet';
        const save = vi.spyOn(plugin, 'saveSettings');
        await modal['saveSource'](false);
        expect(save).toHaveBeenCalledOnce();
        const record = plugin.settings.savedManuscriptSources![0];
        const reopened = new ManuscriptOptionsModal(plugin.app, plugin, async () => ({}));
        reopened['restoreSavedSourceState'](record);
        expect(reopened['source']).toEqual(modal['source']);
        expect(reopened['sourceReviewed']).toBe(true);
        expect(plugin.settings.lastUsedManuscriptSourceId).toBe(record.id);
        expect(plugin.settings.activeBookId).toBe('book');
        modal['source'].title = 'Unsaved edit';
        expect(record.source.title).toBe('Direct manuscript');
    });

    it.each(['write failure', 'blocked settings'])('does not claim a saved manuscript after %s', async failure => {
        const { plugin, files } = fixture();
        const previous = plugin.settings.savedManuscriptSources;
        const save = vi.spyOn(plugin, 'saveSettings').mockRejectedValue(new Error('Disk unavailable'));
        if (failure === 'blocked settings') vi.spyOn(plugin, 'isSettingsPersistenceBlocked').mockReturnValue(true);
        const modal = new ManuscriptOptionsModal(plugin.app, plugin, async () => ({}));
        modal['source'] = { kind: 'file', path: files[0].path, paths: [files[0].path], title: 'One', author: 'Writer' };
        modal['sourceCandidates'] = [files[0].path];
        modal['savedSourceName'] = 'One';
        await modal['saveSource'](false);
        expect(plugin.settings.savedManuscriptSources).toBe(previous);
        expect(plugin.settings.lastUsedManuscriptSourceId).toBeUndefined();
        expect(modal['savedSourceId']).toBeUndefined();
        expect(modal['sourceSaving']).toBe(false);
        if (failure === 'blocked settings') expect(save).not.toHaveBeenCalled();
    });

    it.each([1, 2])('renders a %i-file proof through the same PDF pipeline without source or preference writes', async parts => {
        const { registrar, plugin, writes, options, content } = formattedFixture();
        const temp = mkdtempSync(join(tmpdir(), 'rt-proof-contract-'));
        const template = join(temp, 'layout.tex');
        writeFileSync(template, '$body$');
        plugin.settings.pandocLayouts[0].path = template;
        const save = vi.fn(async () => {});
        plugin.saveSettings = save;
        const sidecarWrite = vi.fn(async (_path: string, _text: string) => {});
        plugin.app.vault.adapter = { write: sidecarWrite } as unknown as typeof plugin.app.vault.adapter; // SAFE: proof byte reads and sidecar writes use exact local job paths, including PDFs not yet indexed by Obsidian.
        vi.spyOn(registrar as unknown as { ensureVaultFolderPath: (path: string) => Promise<void> }, 'ensureVaultFolderPath').mockImplementation(async path => { mkdirSync(join(temp, path), { recursive: true }); });
        vi.mocked(getVaultAbsolutePath).mockImplementation((_plugin, path) => join(temp, path));
        vi.mocked(runPandocOnContent).mockImplementation(async (_text, path) => {
            if (parts === 2) content.set('Book/2 Second.md', 'Mutated during render');
            writeFileSync(path, '%PDF-1.7\nQA'); return path;
        });
        try {
            const outcome = await registrar['handleManuscriptExport']({ ...options, outputFormat: 'pdf', intent: 'proof', updateWordCounts: true, saveMarkdownArtifact: true, selectedLayoutId: 'test-layout', rangeStart: parts === 2 ? 1 : 2, rangeEnd: 2, splitMode: parts === 2 ? 'parts' : 'single', splitParts: parts });
            expect(outcome.proof?.renderedPaths[0]).toMatch(/^Exports\/Proofs\//);
            expect(outcome.proof?.dependencies).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'Book/2 Second.md' }), expect.objectContaining({ path: template })]));
            expect(sidecarWrite).toHaveBeenCalledWith(expect.stringMatching(/proof.json$/), expect.stringContaining('"schemaVersion": 1'));
            expect(outcome.proof?.renderedPaths).toHaveLength(parts);
            expect(outcome.proof?.sourceWordCounts['Book/2 Second.md']).toBe(3);
            expect(vi.mocked(runPandocOnContent).mock.calls[parts - 1][0]).toContain('Second scene prose.');
            expect(vi.mocked(runPandocOnContent).mock.calls[parts - 1][0]).not.toContain('First scene prose.');
            expect(vi.mocked(runPandocOnContent).mock.calls[parts - 1][0]).not.toContain('Mutated during render');
            expect(vi.mocked(runPandocOnContent).mock.calls[0][2]?.workingDir).toBe(join(temp, 'Exports'));
            expect(writes).not.toHaveBeenCalled();
            expect(save).not.toHaveBeenCalled();
            expect(outcome.savedPaths).toBeUndefined();
        } finally {
            rmSync(temp, { recursive: true, force: true });
            vi.mocked(getVaultAbsolutePath).mockReturnValue('/tmp/rt-export-contract');
            vi.mocked(runPandocOnContent).mockImplementation(async (_text, path) => path);
        }
    });


    it.each(['markdown', 'pdf', 'docx'] as const)('exports plain notes in reviewed order to %s without RT structure or source writes', async outputFormat => {
        const { registrar, writer, writes, options, files, content } = formattedFixture();
        content.set(files[0].path, '---\nClass: Frontmatter\nRole: dedication\nWords: 99\n---\n# My own heading\n\nFirst prose.');
        content.set(files[1].path, '# Final chapter\n\nSecond prose.');
        const outcome = await registrar['handleManuscriptExport']({
            ...options, outputFormat, selectedLayoutId: 'test-layout', saveMarkdownArtifact: false, updateWordCounts: true,
            source: { kind: 'folder', path: 'Book', paths: [files[1].path, files[0].path], title: 'Plain manuscript', author: 'Writer' },
        });
        expect(outcome.savedPath || outcome.renderedPath).toBeTruthy();
        const text = outputFormat === 'markdown' ? writer.mock.calls[0][1] : vi.mocked(runPandocOnContent).mock.calls[0][0];
        expect(text.indexOf('Second prose.')).toBeLessThan(text.indexOf('First prose.'));
        expect(text).toContain('# My own heading');
        expect(text).not.toContain('## 1 First');
        expect(text).not.toContain('Words:');
        expect(writes).not.toHaveBeenCalled();
        if (outputFormat !== 'markdown') expect(vi.mocked(runPandocOnContent).mock.calls[0][2]?.metadata).toMatchObject({ title: 'Plain manuscript', author: 'Writer' });
    });

    it('does not let a saved RT range or subplot narrow an explicit reviewed manuscript', async () => {
        const { registrar, writer, options, plugin, files } = fixture();
        const modal = new ManuscriptOptionsModal(plugin.app, plugin, async () => ({}));
        await modal['chooseSource']('folder', 'Book');
        const profile = { ...modal['buildLiveProfile']('test', 'Test', true), rangeStart: 2, rangeEnd: 2, order: 'reverse-narrative' as const, subplot: 'Other' };
        await modal['applyTemplate'](profile, { showNotice: false });
        expect(modal['getSelectedScenePaths']()).toEqual(files.map(file => file.path));
        await registrar['handleManuscriptExport']({ ...options, rangeStart: 2, rangeEnd: 2, subplot: 'Other', source: { kind: 'folder', path: 'Book', paths: files.map(file => file.path), title: 'Plain', author: '' } });
        expect(writer.mock.calls[0][1]).toContain('First scene prose.');
        expect(writer.mock.calls[0][1]).toContain('Second scene prose.');
    });

    it('exports a single file exactly once and leaves its own chapter headings intact', async () => {
        const { registrar, writer, options, files, content } = fixture();
        content.set(files[1].path, '# Chapter one\n\nOne.\n\n# Chapter two\n\nTwo.');
        await registrar['handleManuscriptExport']({ ...options, source: { kind: 'file', path: files[1].path, paths: [files[1].path], title: 'Single', author: '' } });
        expect(writer.mock.calls[0][1]).toBe('# Chapter one\n\nOne.\n\n# Chapter two\n\nTwo.');
    });

    it('does not let a deleted reviewed note silently disappear', async () => {
        const { registrar, writer, options } = fixture();
        await expect(registrar['handleManuscriptExport']({ ...options, source: { kind: 'folder', path: 'Book', paths: ['Book/missing.md'], title: 'Plain', author: '' } })).rejects.toThrow('missing');
        expect(writer).not.toHaveBeenCalled();
    });

    it('pins the modal book identity when the active timeline book changes', async () => {
        const { plugin } = fixture();
        const modal = new ManuscriptOptionsModal(plugin.app, plugin, async () => ({}));
        plugin.settings.books.push({ id: 'other', title: 'Other book', sourceFolder: 'Other' });
        plugin.settings.activeBookId = 'other';
        expect(modal['getSourceBook']()?.id).toBe('book');
        await modal['loadScenesForOrder']();
        expect(modal['scenePaths']).toEqual(['Book/1 First.md', 'Book/2 Second.md']);
    });

    it('locks all export controls for the job and restores them after completion', async () => {
        const { plugin } = fixture();
        let finish!: (outcome: { savedPath: string }) => void;
        const submit = vi.fn(() => new Promise<{ savedPath: string }>(resolve => { finish = resolve; }));
        const modal = new ManuscriptOptionsModal(plugin.app, plugin, submit);
        await modal['chooseSource']('file', 'Book/2 Second.md');
        const card = { inert: false };
        modal['controlsEl'] = card as unknown as HTMLElement;
        const exporting = modal['submit']();
        expect(card.inert).toBe(true);
        finish({ savedPath: 'Exports/Single.md' });
        await exporting;
        expect(card.inert).toBe(false);
    });

    it('ignores an older scene-load response after switching to a plain file', async () => {
        const { plugin } = fixture();
        let resolveScenes!: (items: Awaited<ReturnType<RadialTimelinePlugin['getSceneData']>>) => void;
        plugin.getSceneData = vi.fn(() => new Promise(resolve => { resolveScenes = resolve; }));
        const modal = new ManuscriptOptionsModal(plugin.app, plugin, async () => ({}));
        const earlier = modal['loadScenesForOrder']();
        await modal['chooseSource']('file', 'Book/2 Second.md');
        resolveScenes([{ path: 'Book/1 First.md', title: 'First', itemType: 'Scene' }]);
        await earlier;
        expect(modal['scenePaths']).toEqual(['Book/2 Second.md']);
    });

    it('does not submit a folder before its contents have been reviewed', async () => {
        const { plugin } = fixture();
        const submit = vi.fn(async () => ({}));
        const modal = new ManuscriptOptionsModal(plugin.app, plugin, submit);
        await modal['chooseSource']('folder', 'Book');
        await modal['submit']();
        expect(submit).not.toHaveBeenCalled();
        modal['sourceReviewed'] = true;
        await modal['submit']();
        expect(submit).toHaveBeenCalledWith(expect.objectContaining({ source: expect.objectContaining({ kind: 'folder' }), updateWordCounts: false }));
    });

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

    it('counts only scene notes in the open-scenes scope label', async () => {
        const { plugin } = fixture();
        const modal = new ManuscriptOptionsModal(plugin.app, plugin, async () => ({}));
        modal['openScenePathsSnapshot'] = new Set(['Book/1 First.md', 'Book/2 Second.md', 'Book/000 BookMeta.md']);
        const addOption = vi.fn();
        modal['subplotDropdown'] = { selectEl: { textContent: '' }, addOption, setValue: vi.fn() } as unknown as DropdownComponent;
        await modal['loadSubplots']();
        expect(addOption).toHaveBeenCalledWith('__open_scenes__', 'Open Scenes (2)');
        expect(addOption).not.toHaveBeenCalledWith('__open_scenes__', 'Open Scenes (3)');
    });

    it('refreshes the output count when a narrowed range returns to single-file export', () => {
        const { plugin } = fixture();
        const modal = new ManuscriptOptionsModal(plugin.app, plugin, async () => ({}));
        modal['totalScenes'] = 3;
        modal['rangeStart'] = 2;
        modal['rangeEnd'] = 2;
        modal['splitMode'] = 'parts';
        modal['splitParts'] = 3;
        modal['outputFormat'] = 'pdf';
        const setButtonText = vi.fn();
        modal['actionButton'] = { setButtonText, setDisabled: vi.fn(), setCta: vi.fn(), removeCta: vi.fn() } as unknown as ButtonComponent;
        modal['updateSplitUi']();
        expect(modal['splitMode']).toBe('single');
        expect(setButtonText).toHaveBeenCalledWith('Generate PDF');
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
