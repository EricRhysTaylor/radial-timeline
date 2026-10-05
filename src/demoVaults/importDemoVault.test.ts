import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parseYaml, TFile, TFolder } from 'obsidian';
import * as obsidian from 'obsidian';
import * as importPlan from './demoImportPlan';
import { strToU8 } from 'fflate';
import { importDemoVault } from './importDemoVault';
import type { BonusVaultDef } from '../settings/bonusVaults';

const mocks = { request: vi.fn(), prepare: vi.fn() };
const demo: BonusVaultDef = { id: 'test', title: 'Test', author: 'Author', countLabel: '1 scene', status: 'available', books: [{ title: 'Book', sourceFolder: 'Book' }], archive: { url: 'https://example.com', sha256: 'hash', root: 'Demo', bytes: 1 } };
const destination = 'Demo Projects/Test';
const scene = `${destination}/Book/1 Scene.md`;
const sceneBody = '---\nClass: Scene\nID: unique-demo-id\n---\nDemo scene';
const manifest = '---\nrt_sample_vault: true\nschema_version: 1\ndisplay_name: Test\nbook_folder: Demo Projects/Test/Book\n---';

function fixture(options?: { writeFailure?: boolean; idCollision?: boolean; renameFailure?: boolean }) {
    const entries = new Map<string, TFile | TFolder>();
    const texts = new Map<string, string>();
    const author = new TFile('Author/Chapter.md');
    entries.set(author.path, author);
    texts.set(author.path, options?.idCollision ? sceneBody : '---\nID: author-id\nClass: Scene\n---\nAuthor scene');
    const authorBook = { id: 'author-book', title: 'Author', sourceFolder: 'Author', includeInSaga: true };
    const sources = { classes: [{ className: 'scene', enabled: false }], classScope: ['outline'], scanRoots: ['Author'] };
    const settings = { books: [authorBook], activeBookId: authorBook.id, enableAiSceneAnalysis: false, anthropicApiKey: 'keep-local', inquirySources: sources };
    const vault = {
        getAbstractFileByPath: (path: string) => entries.get(path) ?? null,
        getMarkdownFiles: () => Array.from(entries.values()).filter((entry): entry is TFile => entry instanceof TFile && entry.path.endsWith('.md')),
        read: async (file: TFile) => texts.get(file.path)!,
        createFolder: async (path: string) => { if (entries.has(path)) throw new Error('exists'); const folder = new TFolder(path); entries.set(path, folder); return folder; },
        create: async (path: string, text: string) => { if (options?.writeFailure && path.endsWith('/1 Scene.md')) throw new Error('disk full'); const file = new TFile(path); entries.set(path, file); texts.set(path, text); return file; },
        createBinary: vi.fn(),
        rename: async (folder: TFolder, path: string) => {
            if (options?.renameFailure) throw new Error('rename failed');
            if (entries.has(path)) throw new Error('exists');
            const old = folder.path;
            for (const [key, entry] of Array.from(entries)) {
                if (key === old || key.startsWith(`${old}/`)) {
                    entries.delete(key); entry.path = `${path}${key.slice(old.length)}`; entries.set(entry.path, entry);
                    if (texts.has(key)) { texts.set(entry.path, texts.get(key)!); texts.delete(key); }
                }
            }
        }
    };
    const fileManager = {
        trashFile: vi.fn(async (folder: TFolder) => {
            for (const key of Array.from(entries.keys())) if (key === folder.path || key.startsWith(`${folder.path}/`)) { entries.delete(key); texts.delete(key); }
        })
    };
    const refresh = vi.fn(async () => undefined);
    const activate = vi.fn(async () => undefined);
    const plugin = {
        settings, _inquiryRunInFlight: null,
        app: { vault, fileManager, metadataCache: { getFileCache: (file: TFile) => {
            const match = /^---\n([\s\S]*?)\n---/.exec(texts.get(file.path) ?? '');
            return match ? { frontmatter: parseYaml(match[1]) } : null;
        } } },
        saveSettings: vi.fn(async () => undefined),
        setActiveBookId: vi.fn(async (id: string) => { settings.activeBookId = id; }),
        getInquiryService: () => ({ getInquiryViews: () => [{ onDemoProjectsChanged: refresh }] }),
        getTimelineService: () => ({ activateView: activate })
    };
    return { plugin, entries, texts, refresh, activate, vault, fileManager, sources, authorBook };
}

beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    vi.spyOn(obsidian, 'requestUrl').mockImplementation(mocks.request);
    vi.spyOn(importPlan, 'prepareDemoImport').mockImplementation(mocks.prepare);
    mocks.request.mockResolvedValue({ status: 200, arrayBuffer: new Uint8Array([1]).buffer });
    mocks.prepare.mockResolvedValue({ files: new Map([
        ['Book/1 Scene.md', strToU8(sceneBody)],
        ['Sample Vault Config.md', strToU8(manifest)],
        ['Radial Timeline/Inquiry/Sessions/sessions.json', strToU8(JSON.stringify({ schemaVersion: 1, sessions: [{ key: 'demo-answer', activeBookId: `${destination}/Book`, result: {} }] }))]
    ]), ids: new Set(['unique-demo-id']), indexedPaths: [scene] });
});

describe('demo import orchestration', () => {
    it('waits for staged metadata before moving files Obsidian is still reading', async () => {
        vi.useFakeTimers();
        try {
            const { plugin, vault, entries } = fixture();
            const rename = vi.spyOn(vault, 'rename');
            const getCache = plugin.app.metadataCache.getFileCache;
            let indexed = false;
            vi.spyOn(plugin.app.metadataCache, 'getFileCache').mockImplementation(file =>
                file.path.includes('/Demo Imports/') && !indexed ? null : getCache(file));
            const task = importDemoVault(plugin as never, demo);
            await vi.advanceTimersByTimeAsync(0);
            expect(Array.from(entries.keys()).some(path => path.includes('/Demo Imports/') && path.endsWith('/1 Scene.md'))).toBe(true);
            expect(rename).not.toHaveBeenCalled();
            indexed = true;
            await vi.advanceTimersByTimeAsync(100);
            await task;
            expect(rename).toHaveBeenCalledOnce();
            expect(entries.has(scene)).toBe(true);
        } finally {
            vi.useRealTimers();
        }
    });
    it('explains a download timeout without staging files or changing book settings', async () => {
        const { plugin, entries, fileManager, authorBook } = fixture();
        mocks.request.mockRejectedValue(new Error('net::ERR_TIMED_OUT'));
        await expect(importDemoVault(plugin as never, demo)).rejects.toThrow('The demo download timed out. Nothing was added.');
        expect(Array.from(entries.keys())).toEqual(['Author/Chapter.md']);
        expect(plugin.settings.books).toEqual([authorBook]);
        expect(fileManager.trashFile).not.toHaveBeenCalled();
    });
    it('adds one complete project, preserving author profiles, content, AI permission and source configuration', async () => {
        const { plugin, texts, refresh, activate, sources, authorBook } = fixture();
        await importDemoVault(plugin as never, demo);
        expect(texts.get('Author/Chapter.md')).toContain('Author scene');
        expect(texts.get(scene)).toBe(sceneBody);
        expect(plugin.settings.books[0]).toBe(authorBook);
        expect(plugin.settings.books[1].sourceFolder).toBe(`${destination}/Book`);
        expect(plugin.settings.books[1].includeInSaga).toBe(false);
        expect(plugin.settings.enableAiSceneAnalysis).toBe(false);
        expect(plugin.settings.anthropicApiKey).toBe('keep-local');
        expect(plugin.settings.inquirySources).toBe(sources);
        expect(refresh).toHaveBeenCalledOnce();
        expect(activate).toHaveBeenCalledOnce();
    });
    it('opens an installed demo again without downloading, copying files or duplicating profiles', async () => {
        const { plugin, entries, texts } = fixture();
        await importDemoVault(plugin as never, demo);
        const originalParse = obsidian.parseYaml;
        vi.spyOn(obsidian, 'parseYaml').mockImplementation(value => value.includes('rt_sample_vault')
            ? { rt_sample_vault: true, schema_version: 1, display_name: 'Test', book_folder: `${destination}/Book`, books: [{ title: 'Book', source_folder: `${destination}/Book` }] }
            : originalParse(value));
        const count = entries.size;
        const originalScene = texts.get(scene);
        await importDemoVault(plugin as never, demo);
        expect(entries.size).toBe(count);
        expect(texts.get(scene)).toBe(originalScene);
        expect(plugin.settings.books).toHaveLength(2);
        expect(mocks.request).toHaveBeenCalledOnce();
    });
    it.each([{ writeFailure: true }, { renameFailure: true }])('cleans only its staging folder on failure: %j', async options => {
        const { plugin, entries, fileManager, texts } = fixture(options);
        await expect(importDemoVault(plugin as never, demo)).rejects.toThrow();
        expect(entries.has(destination)).toBe(false);
        expect(texts.get('Author/Chapter.md')).toContain('Author scene');
        expect(fileManager.trashFile).toHaveBeenCalledOnce();
        expect(plugin.settings.books).toHaveLength(1);
    });
    it('leaves an incomplete installed demo untouched instead of silently opening it', async () => {
        const { plugin, texts } = fixture();
        await importDemoVault(plugin as never, demo);
        texts.set(`${destination}/Radial Timeline/Inquiry/Sessions/sessions.json`, '{bad');
        const originalParse = obsidian.parseYaml;
        vi.spyOn(obsidian, 'parseYaml').mockImplementation(value => value.includes('rt_sample_vault')
            ? { rt_sample_vault: true, schema_version: 1, display_name: 'Test', book_folder: `${destination}/Book`, books: [{ title: 'Book', source_folder: `${destination}/Book` }] }
            : originalParse(value));
        await expect(importDemoVault(plugin as never, demo)).rejects.toThrow('missing its saved');
        expect(texts.get(scene)).toBe(sceneBody);
        expect(mocks.request).toHaveBeenCalledOnce();
    });
    it('never replaces an existing non-demo destination', async () => {
        const { plugin, entries } = fixture();
        entries.set(destination, new TFolder(destination));
        await expect(importDemoVault(plugin as never, demo)).rejects.toThrow('Nothing was changed');
        expect(mocks.request).not.toHaveBeenCalled();
    });
    it('refuses a duplicate manuscript before writing any files', async () => {
        const { plugin, entries } = fixture({ idCollision: true });
        await expect(importDemoVault(plugin as never, demo)).rejects.toThrow('already exists');
        expect(entries.size).toBe(1);
    });
    it('refuses an import while Inquiry is running', async () => {
        const { plugin } = fixture();
        (plugin as unknown as { _inquiryRunInFlight: unknown })._inquiryRunInFlight = { sessionKey: 'running' };
        await expect(importDemoVault(plugin as never, demo)).rejects.toThrow('Inquiry run');
        expect(mocks.request).not.toHaveBeenCalled();
    });
    it('blocks a second import on the same plugin until the first finishes', async () => {
        const { plugin } = fixture();
        let resolve!: (value: unknown) => void;
        mocks.request.mockReturnValueOnce(new Promise(done => { resolve = done; }));
        const first = importDemoVault(plugin as never, demo);
        await expect(importDemoVault(plugin as never, demo)).rejects.toThrow('Another demo');
        resolve({ status: 200, arrayBuffer: new Uint8Array([1]).buffer });
        await first;
    });
});
