import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeDiskVaultPlugin } from '../../tests/helpers/diskVault';
import type { PandocLayoutTemplate } from '../types';
import { hashTemplateText, type ImportedTemplateCheckRecord, type ImportedTemplateCheckResult } from './importedTemplateCheck';
import { describeImportedTemplateBlock, getImportedTemplateState, recheckImportedTemplate, recordTemplateCheckedHere } from './importedTemplateState';

// Real test PDFs are built in tests/publishing-pdf-assembly.test.ts.
const runCheck = vi.hoisted(() => vi.fn());
vi.mock('./importedTemplateCheck', async importOriginal => ({
    ...await importOriginal<typeof import('./importedTemplateCheck')>(),
    runImportedTemplateCheck: runCheck,
}));

const TEXT = '\\documentclass{book}\n\\begin{document}\n$body$\n\\end{document}\n';
const PATH = 'Radial Timeline/Pandoc/imported/my-book.tex';
const recordFor = (text: string): ImportedTemplateCheckRecord => ({ schemaVersion: 1, sha256: hashTemplateText(text), checkedAt: '2026-11-19T00:00:00.000Z', pages: 3, pageWidthPt: 432, pageHeightPt: 648, samplePage: 2 });
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46]);

let root = '';
let vault: ReturnType<typeof makeDiskVaultPlugin>;
let layout: PandocLayoutTemplate;

beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'rt-imported-state-'));
    vault = makeDiskVaultPlugin(root);
    mkdirSync(join(vault.abs(PATH), '..'), { recursive: true });
    writeFileSync(vault.abs(PATH), TEXT);
    layout = { id: 'imported-my-book-novel', name: 'My Book', preset: 'novel', path: PATH, origin: 'imported', importCheck: recordFor(TEXT) };
    vault.plugin.settings.pandocLayouts = [layout];
    recordTemplateCheckedHere(vault.plugin, layout.id, hashTemplateText(TEXT));
    runCheck.mockReset();
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('imported template state', () => {
    it('is ready while the file is the one that built the test PDF', () => {
        expect(getImportedTemplateState(vault.plugin, layout)).toBe('ready');
        expect(describeImportedTemplateBlock(vault.plugin, layout)).toBeNull();
    });

    it('is changed after any edit, even one that changes no visible character', () => {
        writeFileSync(vault.abs(PATH), `${TEXT} `);
        expect(getImportedTemplateState(vault.plugin, layout)).toBe('changed');
        expect(describeImportedTemplateBlock(vault.plugin, layout)).toMatchObject({ state: 'changed' });
    });

    it('is unchecked when no test PDF is on record', () => {
        delete layout.importCheck;
        expect(getImportedTemplateState(vault.plugin, layout)).toBe('unchecked');
    });

    it('is not ready on a second computer until it has built a test PDF there', async () => {
        // The vault syncs, settings and template with it; the note that it
        // built a PDF on the first computer does not.
        vault.moveToAnotherComputer();
        expect(getImportedTemplateState(vault.plugin, layout)).toBe('unchecked');
        expect(describeImportedTemplateBlock(vault.plugin, layout)?.message).toContain('on this computer');
        // A font this computer lacks is found at the check, not during an export.
        runCheck.mockResolvedValue({ ok: false, reason: 'latex', message: 'failed', latexLines: ['! Package fontspec Error:'], cause: { kind: 'font', name: 'EB Garamond' } });
        expect(await recheckImportedTemplate(vault.plugin, layout)).toMatchObject({ ok: false, cause: { kind: 'font', name: 'EB Garamond' } });
        expect(getImportedTemplateState(vault.plugin, layout)).toBe('unchecked');
        runCheck.mockImplementation(async ({ templateText }: { templateText: string }) => ({ ok: true, pdf: PDF, record: recordFor(templateText) }));
        expect((await recheckImportedTemplate(vault.plugin, layout)).ok).toBe(true);
        expect(getImportedTemplateState(vault.plugin, layout)).toBe('ready');
    });

    it('is missing when the file is gone', () => {
        rmSync(vault.abs(PATH));
        expect(getImportedTemplateState(vault.plugin, layout)).toBe('missing');
        expect(describeImportedTemplateBlock(vault.plugin, layout)?.message).toContain('My Book');
    });

    it('works for a layout that points at a file outside the vault', () => {
        const outside = join(root, 'outside.tex');
        writeFileSync(outside, TEXT);
        layout.path = outside;
        expect(getImportedTemplateState(vault.plugin, layout)).toBe('ready');
        writeFileSync(outside, `${TEXT}%`);
        expect(getImportedTemplateState(vault.plugin, layout)).toBe('changed');
    });
});

describe('checking an imported template again', () => {
    it('records a pass against the text on disk and saves it', async () => {
        const edited = `${TEXT}% edited`;
        writeFileSync(vault.abs(PATH), edited);
        runCheck.mockImplementation(async ({ templateText }: { templateText: string }): Promise<ImportedTemplateCheckResult> => ({ ok: true, pdf: PDF, record: recordFor(templateText) }));
        expect((await recheckImportedTemplate(vault.plugin, layout)).ok).toBe(true);
        expect(runCheck.mock.calls[0][0]).toMatchObject({ templateText: edited, layout });
        expect(layout.importCheck?.sha256).toBe(hashTemplateText(edited));
        expect(vault.saveSettings).toHaveBeenCalledOnce();
        expect(getImportedTemplateState(vault.plugin, layout)).toBe('ready');
    });

    it('changes nothing when the check fails', async () => {
        writeFileSync(vault.abs(PATH), `${TEXT}\\broken`);
        runCheck.mockResolvedValue({ ok: false, reason: 'latex', message: 'failed', latexLines: ['! Undefined control sequence.'], cause: null });
        const result = await recheckImportedTemplate(vault.plugin, layout);
        expect(result).toMatchObject({ ok: false, reason: 'latex' });
        expect(layout.importCheck).toEqual(recordFor(TEXT));
        expect(vault.saveSettings).not.toHaveBeenCalled();
        expect(getImportedTemplateState(vault.plugin, layout)).toBe('changed');
    });

    it('keeps the old record when the pass cannot be saved', async () => {
        writeFileSync(vault.abs(PATH), `${TEXT}% edited`);
        runCheck.mockImplementation(async ({ templateText }: { templateText: string }) => ({ ok: true, pdf: PDF, record: recordFor(templateText) }));
        vault.saveSettings.mockRejectedValueOnce(new Error('QA write denied'));
        await expect(recheckImportedTemplate(vault.plugin, layout)).rejects.toThrow('QA write denied');
        expect(layout.importCheck).toEqual(recordFor(TEXT));
    });

    it('does not run a check for a file that is gone', async () => {
        rmSync(vault.abs(PATH));
        expect(await recheckImportedTemplate(vault.plugin, layout)).toMatchObject({ ok: false, reason: 'missing' });
        expect(runCheck).not.toHaveBeenCalled();
    });
});
