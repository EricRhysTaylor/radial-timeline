import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeDiskVaultPlugin } from '../../tests/helpers/diskVault';
import { registerImportedTemplate } from '../utils/templateImport';
import { hashTemplateText, type ImportedTemplateCheckResult } from '../publishing/importedTemplateCheck';
import { ImportTemplateModal, type ImportedTemplateCommit } from './ImportTemplateModal';

// The test PDF needs Pandoc and LaTeX; the real builds are in
// tests/publishing-pdf-assembly.test.ts ("Imported template compile"). Here
// the build is stood in for, so the dialog's own decisions can be tested.
const runCheck = vi.hoisted(() => vi.fn());
vi.mock('../publishing/importedTemplateCheck', async importOriginal => ({
    ...await importOriginal<typeof import('../publishing/importedTemplateCheck')>(),
    runImportedTemplateCheck: runCheck,
}));

// Drawing a page needs a canvas; the dialog's use of the picture is what is tested here.
const renderPng = vi.hoisted(() => vi.fn());
vi.mock('../publishing/importedTemplatePreview', async importOriginal => ({
    ...await importOriginal<typeof import('../publishing/importedTemplatePreview')>(),
    renderPdfPagePng: renderPng,
}));

const GOOD = '\\documentclass{article}\n\\begin{document}\n$body$\n\\end{document}';
const SOURCE = 'Templates/import-test.tex';
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer;
const pass = (text: string): ImportedTemplateCheckResult => ({
    ok: true, pdf: PDF,
    record: { schemaVersion: 1, sha256: hashTemplateText(text), checkedAt: '2026-11-19T00:00:00.000Z', pages: 3, pageWidthPt: 432, pageHeightPt: 648, samplePage: 2 },
});
const fail: ImportedTemplateCheckResult = { ok: false, reason: 'latex', message: 'failed', latexLines: ['! Undefined control sequence.', 'l.3 \\nope'] };

let root = '';
let vault: ReturnType<typeof makeDiskVaultPlugin>;
let onCommit: ReturnType<typeof vi.fn<(commit: ImportedTemplateCommit) => Promise<void>>>;
let modal: ImportTemplateModal;

beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'rt-import-modal-'));
    vault = makeDiskVaultPlugin(root);
    mkdirSync(vault.abs('Templates'));
    writeFileSync(vault.abs(SOURCE), GOOD);
    runCheck.mockReset();
    runCheck.mockImplementation(async ({ templateText }: { templateText: string }) => pass(templateText));
    renderPng.mockReset();
    renderPng.mockResolvedValue(PNG);
    onCommit = vi.fn(async (commit: ImportedTemplateCommit) => {
        await registerImportedTemplate(vault.plugin, commit.layout, commit.templateText, commit.record, commit.firstPagePng);
    });
    modal = new ImportTemplateModal(vault.plugin.app, vault.plugin, onCommit);
    modal['sourcePath'] = SOURCE;
});
afterEach(() => {
    vi.unstubAllGlobals();
    rmSync(root, { recursive: true, force: true });
});

describe('template import dialog', () => {
    it('resolves dropped files with the public Electron API without File.path', async () => {
        const getPathForFile = vi.fn(() => SOURCE);
        vi.stubGlobal('require', vi.fn(() => ({ webUtils: { getPathForFile } })));
        const dropped = { name: 'import-test.tex' } as File;
        await modal['handleDroppedTemplate']([dropped] as unknown as FileList);
        expect(getPathForFile).toHaveBeenCalledWith(dropped);
        expect(modal['check'].state).toBe('passed');
    });

    it('is ready only once a test PDF has been built, and saves the checked text as its own copy', async () => {
        await modal['refreshCandidate']();
        expect(runCheck).toHaveBeenCalledOnce();
        modal['step'] = 2;
        expect(modal['canAdvanceToNextStep']()).toBe(true);
        await modal['commit']();
        // Same text, same layout: the pass on hand is used, not a second build.
        expect(runCheck).toHaveBeenCalledOnce();
        expect(onCommit).toHaveBeenCalledOnce();
        const [layout] = vault.plugin.settings.pandocLayouts;
        expect(layout).toMatchObject({ path: 'Radial Timeline/Pandoc/imported/import-test.tex', origin: 'imported' });
        expect(layout.importCheck?.sha256).toBe(hashTemplateText(GOOD));
        expect(readFileSync(vault.abs(layout.path), 'utf8')).toBe(GOOD);
        expect(readFileSync(vault.abs(SOURCE), 'utf8')).toBe(GOOD);
        // The picture saved beside the copy is the sample page of the PDF that was built.
        expect(renderPng).toHaveBeenCalledWith(PDF, 2, undefined);
        expect(new Uint8Array(readFileSync(vault.abs('Radial Timeline/Pandoc/imported/import-test.png')))).toEqual(new Uint8Array(PNG));
    });

    it('still imports when the first page cannot be drawn, without a picture', async () => {
        renderPng.mockRejectedValue(new Error('no canvas'));
        const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        await modal['refreshCandidate']();
        await modal['commit']();
        expect(vault.plugin.settings.pandocLayouts).toHaveLength(1);
        expect(vault.listFiles()).toEqual(['Radial Timeline/Pandoc/imported/import-test.tex', SOURCE]);
        expect(logged).toHaveBeenCalled();
        logged.mockRestore();
    });

    it('shows facts read from the file and measured from the test PDF, and nothing guessed', async () => {
        writeFileSync(vault.abs(SOURCE), [
            '% a screenplay with dialogue and character names',
            '\\documentclass[11pt]{book}', '\\usepackage{geometry}', '\\setmainfont{EB Garamond}',
            '\\begin{document}', '$title$', '$body$', '\\end{document}',
        ].join('\n'));
        await modal['refreshCandidate']();
        const rows = Object.fromEntries(modal['getFactRows']('Radial Timeline/Pandoc/imported/import-test.tex').map(row => [row.label, row.value]));
        expect(rows).toMatchObject({
            Class: 'book (11pt)', Fonts: 'EB Garamond (main)', Packages: 'geometry', 'Book Details': 'Prints the title',
            'Saved as': 'Radial Timeline/Pandoc/imported/import-test.tex',
        });
        expect(rows['Test PDF']).toMatch(/^3 pages, 6 × 9 in, built /);
        expect(JSON.stringify(rows).toLowerCase()).not.toMatch(/confidence|detected|screenplay|approximate/);
    });

    it('does not advance or save a template whose test PDF failed, and shows what LaTeX printed', async () => {
        runCheck.mockResolvedValue(fail);
        await modal['refreshCandidate']();
        expect(modal['candidate']?.canActivate).toBe(true); // the file itself looks right
        expect(modal['check']).toMatchObject({ state: 'failed', reason: 'latex', latexLines: fail.ok ? [] : fail.latexLines });
        modal['step'] = 2;
        expect(modal['canAdvanceToNextStep']()).toBe(false);
        modal['step'] = 4;
        await modal['commit']();
        expect(onCommit).not.toHaveBeenCalled();
        expect(vault.plugin.settings.pandocLayouts).toEqual([]);
        expect(modal['step']).toBe(2);
    });

    it('names the style after the file chosen last, unless the author typed a name', async () => {
        writeFileSync(vault.abs('Templates/Second Choice.tex'), GOOD);
        await modal['refreshCandidate']();
        expect(modal['templateName']).toBe('import-test');
        modal['sourcePath'] = 'Templates/Second Choice.tex';
        await modal['refreshCandidate']();
        expect(modal['templateName']).toBe('Second Choice');
        expect(modal['templateDescription']).toBe('Imported from Second Choice.tex.');
        // A typed name stays when the file changes.
        modal['templateName'] = 'House Style';
        modal['templateNameTouched'] = true;
        modal['sourcePath'] = SOURCE;
        await modal['refreshCandidate']();
        expect(modal['templateName']).toBe('House Style');
        expect(modal['templateDescription']).toBe('Imported from import-test.tex.');
    });

    it('does not build a test PDF for a file that is blocked as a file', async () => {
        writeFileSync(vault.abs(SOURCE), 'no placeholder');
        await modal['refreshCandidate']();
        expect(runCheck).not.toHaveBeenCalled();
        expect(modal['check'].state).toBe('idle');
        modal['step'] = 2;
        expect(modal['canAdvanceToNextStep']()).toBe(false);
    });

    it.each(['deleted', 'emptied'] as const)('reads a %s source again before saving', async change => {
        await modal['refreshCandidate']();
        if (change === 'deleted') rmSync(vault.abs(SOURCE));
        else writeFileSync(vault.abs(SOURCE), '');
        await modal['commit']();
        expect(modal['candidate']?.canActivate).toBe(false);
        expect(onCommit).not.toHaveBeenCalled();
        expect(vault.plugin.settings.pandocLayouts).toEqual([]);
    });

    it('builds a new test PDF when the file changed after the check', async () => {
        await modal['refreshCandidate']();
        const edited = `${GOOD}\n% edited`;
        writeFileSync(vault.abs(SOURCE), edited);
        await modal['commit']();
        expect(runCheck).toHaveBeenCalledTimes(2);
        expect(onCommit.mock.calls[0][0].templateText).toBe(edited);
        expect(vault.plugin.settings.pandocLayouts[0].importCheck?.sha256).toBe(hashTemplateText(edited));
    });

    it('does not rebuild the test PDF for a new name: what an imported template is called changes nothing about its export', async () => {
        await modal['refreshCandidate']();
        modal['templateName'] = 'Modern Classic';
        modal['templateNameTouched'] = true;
        await modal['commit']();
        expect(runCheck).toHaveBeenCalledOnce();
        expect(vault.plugin.settings.pandocLayouts[0]).toMatchObject({ name: 'Modern Classic', path: 'Radial Timeline/Pandoc/imported/modern-classic.tex' });
    });

    it('keeps a failed registration inactive and permits a clean retry', async () => {
        await modal['refreshCandidate']();
        vault.saveSettings.mockRejectedValueOnce(new Error('QA write denied'));
        const close = vi.spyOn(modal, 'close');
        await modal['commit']();
        expect(vault.plugin.settings.pandocLayouts).toEqual([]);
        expect(vault.listFiles()).toEqual([SOURCE]);
        expect(close).not.toHaveBeenCalled();
        await modal['commit']();
        expect(onCommit).toHaveBeenCalledTimes(2);
        expect(vault.plugin.settings.pandocLayouts).toHaveLength(1);
        expect(close).toHaveBeenCalledOnce();
    });

    it('does not import while settings writes are blocked', async () => {
        await modal['refreshCandidate']();
        vault.plugin.isSettingsPersistenceBlocked = () => true;
        await modal['commit']();
        expect(vault.plugin.settings.pandocLayouts).toEqual([]);
        expect(vault.saveSettings).not.toHaveBeenCalled();
        expect(vault.listFiles()).toEqual([SOURCE]);
    });

    it('ignores a second Save while the first is still in flight', async () => {
        await modal['refreshCandidate']();
        await Promise.all([modal['commit'](), modal['commit']()]);
        expect(onCommit).toHaveBeenCalledOnce();
        expect(vault.plugin.settings.pandocLayouts).toHaveLength(1);
    });
});
