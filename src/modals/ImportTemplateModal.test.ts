import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TFile } from 'obsidian';
import type RadialTimelinePlugin from '../main';
import { DEFAULT_SETTINGS } from '../settings/defaults';
import { buildImportedTemplateCandidate, persistImportedTemplate } from '../utils/templateImport';
import { ImportTemplateModal, type ImportedTemplateCommit } from './ImportTemplateModal';

function fixture() {
    const path = 'Radial Timeline/Pandoc/import-test.tex';
    const contents = new Map([[path, '\\documentclass{article}\n\\begin{document}\n$body$\n\\end{document}']]);
    const saveSettings = vi.fn(async () => undefined);
    const plugin = {
        settings: { ...structuredClone(DEFAULT_SETTINGS), pandocLayouts: [] },
        saveSettings, isSettingsPersistenceBlocked: () => false,
        app: { vault: {
            getAbstractFileByPath: (name: string) => contents.has(name) ? new TFile(name) : null,
            getFiles: () => [...contents.keys()].map(name => new TFile(name)),
            read: async (file: TFile) => contents.get(file.path)!,
            adapter: { getBasePath: () => '/tmp/publish-import-qa' },
        } },
    } as unknown as RadialTimelinePlugin;
    const onCommit = vi.fn(async ({ layout }: ImportedTemplateCommit) => persistImportedTemplate(plugin, layout));
    const modal = new ImportTemplateModal(plugin.app, plugin, onCommit);
    modal['sourcePath'] = path;
    return { path, contents, plugin, saveSettings, onCommit, modal };
}

describe('template import activation', () => {
    afterEach(() => vi.unstubAllGlobals());

    it('resolves dropped files with the public Electron API without File.path', async () => {
        const { path, modal } = fixture();
        const getPathForFile = vi.fn(() => path);
        vi.stubGlobal('require', vi.fn(() => ({ webUtils: { getPathForFile } })));
        const dropped = { name: 'import-test.tex' } as File;
        await modal['handleDroppedTemplate']([dropped] as unknown as FileList);
        expect(getPathForFile).toHaveBeenCalledWith(dropped);
        expect(modal['candidate']?.canActivate).toBe(true);
    });
    it.each(['deleted', 'emptied'] as const)('rechecks a %s source before activation', async change => {
        const { path, contents, modal, onCommit } = fixture();
        await modal['refreshCandidate']();
        expect(modal['candidate']?.canActivate).toBe(true);
        if (change === 'deleted') contents.delete(path);
        else contents.set(path, '');
        await modal['commit']();
        expect(modal['candidate']?.canActivate).toBe(false);
        expect(onCommit).not.toHaveBeenCalled();
    });

    it('pins the chosen vault file rather than a root-level namesake', async () => {
        const { path, contents, modal, onCommit } = fixture();
        contents.set('import-test.tex', '$body$\nROOT_SHADOW');
        await modal['refreshCandidate']();
        await modal['commit']();
        expect(onCommit).toHaveBeenCalledOnce();
        expect(onCommit.mock.calls[0][0].layout.path).toBe(path);
        expect(contents.get('import-test.tex')).toContain('ROOT_SHADOW');
    });

    it('keeps a failed registration inactive and permits a clean retry', async () => {
        const { modal, plugin, saveSettings, onCommit } = fixture();
        await modal['refreshCandidate']();
        saveSettings.mockRejectedValueOnce(new Error('QA write denied'));
        const close = vi.spyOn(modal, 'close');
        await modal['commit']();
        expect(plugin.settings.pandocLayouts).toEqual([]);
        expect(close).not.toHaveBeenCalled();
        await modal['commit']();
        expect(onCommit).toHaveBeenCalledTimes(2);
        expect(plugin.settings.pandocLayouts).toHaveLength(1);
        expect(close).toHaveBeenCalledOnce();
    });

    it('does not activate an import when settings writes are blocked', async () => {
        const { modal, plugin, saveSettings } = fixture();
        await modal['refreshCandidate']();
        vi.spyOn(plugin, 'isSettingsPersistenceBlocked').mockReturnValue(true);
        await modal['commit']();
        expect(plugin.settings.pandocLayouts).toEqual([]);
        expect(saveSettings).not.toHaveBeenCalled();
    });

    it('reads an external source from disk again instead of reusing dropped text', async () => {
        const { plugin } = fixture();
        const folder = mkdtempSync(join(tmpdir(), 'publish-external-template-'));
        const path = join(folder, 'external.tex');
        try {
            writeFileSync(path, '\\documentclass{article}\n$body$');
            expect((await buildImportedTemplateCandidate(plugin, { sourcePath: path })).canActivate).toBe(true);
            writeFileSync(path, '');
            expect((await buildImportedTemplateCandidate(plugin, { sourcePath: path })).canActivate).toBe(false);
        } finally { rmSync(folder, { recursive: true, force: true }); }
    });
});
