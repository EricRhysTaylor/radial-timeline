/**
 * A plugin whose vault is a real folder on disk.
 *
 * For code that mixes Obsidian's vault API with Node's fs on the same files
 * (template import writes through the vault and reads back by absolute path).
 * `create` is exclusive, as Obsidian's is: it fails if the file exists.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { vi } from 'vitest';
import { FileSystemAdapter, normalizePath, TFile, TFolder } from 'obsidian';
import type RadialTimelinePlugin from '../../src/main';
import { DEFAULT_SETTINGS } from '../../src/settings/defaults';

function listFiles(root: string, folder = ''): string[] {
    return readdirSync(join(root, folder), { withFileTypes: true }).flatMap(entry => {
        const relative = folder ? `${folder}/${entry.name}` : entry.name;
        return entry.isDirectory() ? listFiles(root, relative) : [relative];
    });
}

export function makeDiskVaultPlugin(root: string) {
    const abs = (vaultPath: string) => join(root, normalizePath(vaultPath));
    const saveSettings = vi.fn(async () => undefined);
    const trashFile = vi.fn(async (file: TFile) => { rmSync(abs(file.path)); });
    // Obsidian's storage for this vault on this computer: it does not sync.
    // Clearing it stands in for opening the same vault on another computer.
    const thisComputer = new Map<string, unknown>();
    const plugin = {
        settings: { ...structuredClone(DEFAULT_SETTINGS), pandocFolder: 'Radial Timeline/Pandoc', pandocLayouts: [] },
        saveSettings,
        isSettingsPersistenceBlocked: () => false,
        app: {
            loadLocalStorage: (key: string) => thisComputer.get(key) ?? null, // SAFE: mirrors Obsidian, which returns null for a key never saved
            saveLocalStorage: (key: string, data: unknown) => { if (data === null) thisComputer.delete(key); else thisComputer.set(key, structuredClone(data)); },
            vault: {
                adapter: new (FileSystemAdapter as unknown as new (basePath: string) => FileSystemAdapter)(root), // SAFE: the test mock takes the base path; Obsidian's own constructor is not public
                getAbstractFileByPath: (vaultPath: string) => {
                    const target = abs(vaultPath);
                    if (!existsSync(target)) return null;
                    return statSync(target).isDirectory() ? new TFolder(normalizePath(vaultPath)) : new TFile(normalizePath(vaultPath));
                },
                getFiles: () => listFiles(root).map(name => new TFile(name)),
                read: async (file: TFile) => readFileSync(abs(file.path), 'utf8'),
                create: async (vaultPath: string, content: string) => {
                    writeFileSync(abs(vaultPath), content, { encoding: 'utf8', flag: 'wx' });
                    return new TFile(normalizePath(vaultPath));
                },
                createBinary: async (vaultPath: string, data: ArrayBuffer) => {
                    writeFileSync(abs(vaultPath), new Uint8Array(data), { flag: 'wx' });
                    return new TFile(normalizePath(vaultPath));
                },
                modifyBinary: async (file: TFile, data: ArrayBuffer) => { writeFileSync(abs(file.path), new Uint8Array(data)); },
                getResourcePath: (file: TFile) => `app://vault/${file.path}`,
                createFolder: async (vaultPath: string) => { mkdirSync(abs(vaultPath)); return new TFolder(normalizePath(vaultPath)); },
            },
            fileManager: { trashFile },
        },
    } as unknown as RadialTimelinePlugin;
    return { plugin, saveSettings, trashFile, abs, listFiles: () => listFiles(root).sort(), moveToAnotherComputer: () => thisComputer.clear() };
}
