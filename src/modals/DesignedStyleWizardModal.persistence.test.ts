import { describe, expect, it, vi } from 'vitest';
import { normalizePath, TFile, TFolder } from 'obsidian';
import type RadialTimelinePlugin from '../main';
import type { PandocLayoutTemplate } from '../types';
import { DEFAULT_SETTINGS } from '../settings/defaults';
import { cloneArchetypeSpec, DesignedStyleWizardModal } from './DesignedStyleWizardModal';

function fixture(storedPath: string, existingPath?: string) {
    const originalSpec = cloneArchetypeSpec('submission');
    const layout: PandocLayoutTemplate = {
        id: 'designed-qa-copy', name: 'QA Copy', preset: 'novel', path: storedPath,
        origin: 'designed', bundled: false, designedSpec: originalSpec,
    };
    const files = new Map<string, TFile | TFolder>();
    const contents = new Map<string, string>();
    if (existingPath) {
        files.set(existingPath, new TFile(existingPath));
        contents.set(existingPath, 'original template');
    }
    const saveSettings = vi.fn(async () => undefined);
    const plugin = {
        settings: { ...DEFAULT_SETTINGS, pandocFolder: 'Radial Timeline/Pandoc', pandocLayouts: [layout] },
        saveSettings,
        isSettingsPersistenceBlocked: () => false,
        app: { fileManager: { trashFile: async (file: TFile) => { files.delete(file.path); contents.delete(file.path); } }, vault: {
            getAbstractFileByPath: (path: string) => files.get(normalizePath(path)) ?? null,
            createFolder: async (path: string) => { files.set(path, new TFolder(path)); },
            create: async (path: string, text: string) => {
                const file = new TFile(path); files.set(path, file); contents.set(path, text); return file;
            },
            modify: async (file: TFile, text: string) => { contents.set(file.path, text); },
            read: async (file: TFile) => contents.get(file.path)!,
            process: async (file: TFile, change: (text: string) => string) => { const text = change(contents.get(file.path)!); contents.set(file.path, text); return text; },
        } },
    } as unknown as RadialTimelinePlugin;
    const edited = structuredClone(originalSpec);
    edited.paperSize = 'a4';
    edited.body.sizePt = 14;
    const modal = new DesignedStyleWizardModal(plugin.app, plugin, {
        initialSpec: edited, initialName: 'QA Updated', initialLayoutId: layout.id, onSave: () => undefined,
    });
    return { modal, layout, files, contents, saveSettings, plugin };
}

describe('designed style update persistence', () => {
    it('saves the spec captured when Save starts even if inputs change during the read', async () => {
        const path = 'Radial Timeline/Pandoc/designed/qa-copy.tex';
        const { modal, layout, plugin } = fixture(path, path);
        let release!: (value: string) => void;
        vi.spyOn(plugin.app.vault, 'read').mockReturnValueOnce(new Promise(resolve => { release = resolve; }));
        const pending = modal['persistLayout']();
        modal['spec'].body.sizePt = 20;
        release('original template');
        await pending;
        expect(layout.designedSpec?.body.sizePt).toBe(14);
    });

    it('preserves a later external template edit if settings persistence fails', async () => {
        const path = 'Radial Timeline/Pandoc/designed/qa-copy.tex';
        const { modal, contents, saveSettings } = fixture(path, path);
        saveSettings.mockImplementationOnce(async () => { contents.set(path, 'newer external edit'); throw new Error('settings denied'); });
        await expect(modal['persistLayout']()).rejects.toThrow('settings denied');
        expect(contents.get(path)).toBe('newer external edit');
    });

    it('restores the template and existing layout when settings persistence fails', async () => {
        const path = 'Radial Timeline/Pandoc/designed/qa-copy.tex';
        const { modal, layout, contents, saveSettings } = fixture(path, path);
        const original = structuredClone(layout);
        saveSettings.mockRejectedValueOnce(new Error('QA settings write denied'));
        await expect(modal['persistLayout']()).rejects.toThrow('QA settings write denied');
        expect(layout).toEqual(original);
        expect(contents.get(path)).toBe('original template');
        await modal['persistLayout']();
        expect(layout.name).toBe('QA Updated');
        expect(contents.get(path)).toContain('paperwidth=210mm');
    });

    it('removes a failed new registration and trashes only its generated template before retry', async () => {
        const { plugin, contents, saveSettings } = fixture('designed/qa-copy.tex');
        const original = structuredClone(plugin.settings.pandocLayouts);
        const modal = new DesignedStyleWizardModal(plugin.app, plugin, {
            initialSpec: cloneArchetypeSpec('submission'), initialName: 'QA New', onSave: () => undefined,
        });
        saveSettings.mockRejectedValueOnce(new Error('QA settings write denied'));
        await expect(modal['persistLayout']()).rejects.toThrow('QA settings write denied');
        expect(plugin.settings.pandocLayouts).toEqual(original);
        expect(contents.size).toBe(0);
        const result = await modal['persistLayout']();
        expect(result.layoutId).toBe('designed-qa-new');
    });

    it('does not write a template when this session cannot persist settings', async () => {
        const path = 'Radial Timeline/Pandoc/designed/qa-copy.tex';
        const { modal, plugin, contents, saveSettings } = fixture(path, path);
        vi.spyOn(plugin, 'isSettingsPersistenceBlocked').mockReturnValue(true);
        await expect(modal['persistLayout']()).rejects.toThrow();
        expect(contents.get(path)).toBe('original template');
        expect(saveSettings).not.toHaveBeenCalled();
    });

    it('updates the existing Pandoc template when its stored path is compact', async () => {
        const path = 'Radial Timeline/Pandoc/designed/qa-copy.tex';
        const { modal, layout, contents, saveSettings } = fixture('designed/qa-copy.tex', path);
        await modal['persistLayout']();
        expect([...contents.keys()]).toEqual([path]);
        expect(contents.get(path)).toContain('paperwidth=210mm');
        expect(layout.designedSpec?.paperSize).toBe('a4');
        expect(layout.path).toBe(path);
        expect(saveSettings).toHaveBeenCalledOnce();
    });

    it('updates a full vault-relative path in place without adding the Pandoc prefix twice', async () => {
        const path = 'Radial Timeline/Pandoc/designed/qa-copy.tex';
        const { modal, contents } = fixture(path, path);
        await modal['persistLayout']();
        expect([...contents.keys()]).toEqual([path]);
        expect(contents.get(path)).toContain('paperwidth=210mm');
    });

    it('reports a missing template without creating a replacement at the vault root or changing settings', async () => {
        const { modal, layout, contents, saveSettings } = fixture('designed/missing.tex');
        const original = structuredClone(layout);
        await expect(modal['persistLayout']()).rejects.toThrow();
        expect(contents.size).toBe(0);
        expect(layout).toEqual(original);
        expect(saveSettings).not.toHaveBeenCalled();
    });

    it('preserves a root-level duplicate and pins export to the updated canonical file', async () => {
        const path = 'Radial Timeline/Pandoc/designed/qa-copy.tex';
        const rootPath = 'designed/qa-copy.tex';
        const { modal, layout, files, contents } = fixture(rootPath, path);
        files.set(rootPath, new TFile(rootPath));
        contents.set(rootPath, 'unrelated or historical root file');
        await modal['persistLayout']();
        expect(contents.get(rootPath)).toBe('unrelated or historical root file');
        expect(contents.get(path)).toContain('paperwidth=210mm');
        expect(layout.path).toBe(path);
    });

    it('stores a new design at its exact vault path even when a root file has the same compact name', async () => {
        const { plugin, files, contents } = fixture('designed/qa-copy.tex');
        files.set('designed/qa-new.tex', new TFile('designed/qa-new.tex'));
        contents.set('designed/qa-new.tex', 'unrelated root file');
        const modal = new DesignedStyleWizardModal(plugin.app, plugin, {
            initialSpec: cloneArchetypeSpec('submission'), initialName: 'QA New', onSave: () => undefined,
        });
        const result = await modal['persistLayout']();
        const created = plugin.settings.pandocLayouts?.find(layout => layout.id === result.layoutId);
        expect(created?.path).toBe('Radial Timeline/Pandoc/designed/qa-new.tex');
        expect(contents.has(created!.path)).toBe(true);
        expect(contents.get('designed/qa-new.tex')).toBe('unrelated root file');
    });

    it('does not overwrite an unregistered template already at the new design path', async () => {
        const { plugin, files, contents } = fixture('designed/qa-copy.tex');
        const occupied = 'Radial Timeline/Pandoc/designed/qa-new.tex';
        files.set(occupied, new TFile(occupied));
        contents.set(occupied, 'author-owned template');
        const modal = new DesignedStyleWizardModal(plugin.app, plugin, {
            initialSpec: cloneArchetypeSpec('submission'), initialName: 'QA New', onSave: () => undefined,
        });
        const result = await modal['persistLayout']();
        expect(contents.get(occupied)).toBe('author-owned template');
        expect(result.layoutId).toBe('designed-qa-new-2');
        expect(contents.has('Radial Timeline/Pandoc/designed/qa-new-2.tex')).toBe(true);
    });

    it('ignores repeated Save while a slow save is still in progress', async () => {
        const path = 'Radial Timeline/Pandoc/designed/qa-copy.tex';
        const { modal, saveSettings } = fixture(path, path);
        let finishSave!: () => void;
        const pending = new Promise<void>(resolve => { finishSave = resolve; });
        saveSettings.mockImplementation(() => pending);
        const first = modal['handleSave']();
        await vi.waitFor(() => expect(saveSettings).toHaveBeenCalledOnce());
        const second = modal['handleSave']();
        finishSave();
        await Promise.all([first, second]);
        expect(saveSettings).toHaveBeenCalledOnce();
    });

    it('preserves the existing design when the template write fails and allows a retry', async () => {
        const path = 'Radial Timeline/Pandoc/designed/qa-copy.tex';
        const { modal, layout, contents, plugin, saveSettings } = fixture(path, path);
        const original = structuredClone(layout);
        const modify = vi.spyOn(plugin.app.vault, 'modify');
        modify.mockRejectedValueOnce(new Error('QA disk write denied'));
        await modal['handleSave']();
        expect(layout).toEqual(original);
        expect(contents.get(path)).toBe('original template');
        expect(saveSettings).not.toHaveBeenCalled();
        await modal['handleSave']();
        expect(layout.designedSpec?.paperSize).toBe('a4');
        expect(saveSettings).toHaveBeenCalledOnce();
    });
});
