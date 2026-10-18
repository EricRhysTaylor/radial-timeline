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
        app: { vault: {
            getAbstractFileByPath: (path: string) => files.get(normalizePath(path)) ?? null,
            createFolder: async (path: string) => { files.set(path, new TFolder(path)); },
            create: async (path: string, text: string) => {
                const file = new TFile(path); files.set(path, file); contents.set(path, text); return file;
            },
            modify: async (file: TFile, text: string) => { contents.set(file.path, text); },
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
