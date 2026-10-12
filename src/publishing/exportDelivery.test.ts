import { describe, expect, it, vi } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import type RadialTimelinePlugin from '../main';
import type { ManuscriptModalResult } from '../modals/ManuscriptOptionsModal';
import { TFile, TFolder } from '../../tests/mocks/obsidian';
import { checkExportDelivery, ensureExportDestination, isDeliveryReviewed, readDeliveryReceipt, recheckDelivery, validateExportDestination } from './exportDelivery';
import { readPdfPageCount } from './ManuscriptProofPreview';
import { t } from '../i18n';

vi.mock('./ManuscriptProofPreview', () => ({ readPdfPageCount: vi.fn(async () => 2) }));

function fixture(format: 'pdf' | 'docx' | 'markdown' = 'markdown') {
    const bytes = new Map<string, Uint8Array>();
    const text = new Map<string, string>();
    const folders = new Set(['Out']);
    const plugin = {
        settings: {}, saveSettings: vi.fn(async () => {}),
        app: { vault: {
            getAbstractFileByPath: (path: string) => folders.has(path) ? new TFolder(path) : bytes.has(path) ? new TFile(path) : null,
            createFolder: async (path: string) => { folders.add(path); },
            adapter: {
                readBinary: async (path: string) => { if (!bytes.has(path)) throw new Error('Missing output'); return bytes.get(path)!.slice().buffer; },
                write: async (path: string, value: string) => { text.set(path, value); },
                read: async (path: string) => text.get(path),
            },
        } },
    } as unknown as RadialTimelinePlugin;
    const request: ManuscriptModalResult = { outputFolder: 'Out', outputFormat: format, exportType: 'manuscript', order: 'narrative', tocMode: 'none', saveMarkdownArtifact: false, reviewedSourcePaths: ['Draft/One.md'] };
    return { plugin, bytes, text, folders, request };
}

describe('export delivery checks', () => {
    it.each(['/outside', '../outside', 'Out/../Other', 'C:\\Outside', '.obsidian', '', 'Out/./Nested'])('rejects invalid explicit destination %s without substituting a folder', value => {
        expect(() => validateExportDestination(value)).toThrow(t('ui.exportDelivery.invalidDestination'));
    });
    it('creates nested vault folders and rejects a file in the destination chain', async () => {
        const { plugin, bytes, folders } = fixture();
        expect(await ensureExportDestination(plugin.app, ' Out/Nested/Final ')).toBe('Out/Nested/Final');
        expect(folders.has('Out/Nested/Final')).toBe(true);
        bytes.set('Out/Blocked', strToU8('Existing note'));
        await expect(ensureExportDestination(plugin.app, 'Out/Blocked/Final')).rejects.toThrow(t('ui.exportDelivery.fileBlocksFolder', { path: 'Out/Blocked' }));
    });
    it('persists exact output paths, bytes and hashes without treating automatic checks as content review', async () => {
        const { plugin, bytes, text, request } = fixture();
        bytes.set('Out/One.md', strToU8('# Actual manuscript'));
        const receipt = await checkExportDelivery(plugin, request, { savedPaths: ['Out/One.md'], outputFolder: 'Out' }, 'One', ['Draft/One.md']);
        expect(receipt.problems).toEqual([]);
        expect(receipt.files[0].bytes).toBe(bytes.get('Out/One.md')!.length);
        expect(receipt.files[0].sha256).toMatch(/^[a-f0-9]{64}$/);
        expect(text.has(receipt.receiptPath)).toBe(true);
        expect((await readDeliveryReceipt(plugin.app, receipt.receiptPath)).sourcePaths).toEqual(['Draft/One.md']);
        expect(isDeliveryReviewed(receipt)).toBe(false);
        expect(receipt.reviewedAt).toBeUndefined();
    });
    it('requires every requested split part and working artifact and surfaces empty/unavailable output', async () => {
        const { plugin, bytes, request } = fixture('pdf');
        bytes.set('Out/Part1.pdf', strToU8('%PDF-1.7'));
        bytes.set('Out/Source.md', new Uint8Array());
        const receipt = await checkExportDelivery(plugin, { ...request, splitMode: 'parts', splitParts: 2, saveMarkdownArtifact: true }, { renderedPaths: ['Out/Part1.pdf', 'Out/Part2.pdf'], savedPaths: ['Out/Source.md'], outputFolder: 'Out' }, 'One', ['Draft/One.md'], 'Second part failed');
        expect(receipt.files[0].pages).toBe(2);
        expect(readPdfPageCount).toHaveBeenCalled();
        expect(receipt.problems.join(' ')).toContain(t('ui.exportDelivery.workingFileCountMismatch', { expected: 4, returned: 1 }));
        expect(receipt.problems.join(' ')).toContain('Missing output');
        expect(receipt.problems.join(' ')).toContain(t('ui.exportDelivery.fileEmpty'));
        expect(receipt.problems.join(' ')).toContain(t('ui.exportDelivery.generationUnfinished', { error: 'Second part failed' }));
        expect(isDeliveryReviewed(receipt)).toBe(false);
    });
    it('checks the Word package body rather than assuming a ZIP is a manuscript', async () => {
        const { plugin, bytes, request } = fixture('docx');
        bytes.set('Out/One.docx', zipSync({ 'word/document.xml': strToU8('<w:document><w:body><w:p/></w:body></w:document>'), '[Content_Types].xml': strToU8('<Types/>'), '_rels/.rels': strToU8('<Relationships/>') }));
        const valid = await checkExportDelivery(plugin, request, { renderedPaths: ['Out/One.docx'], outputFolder: 'Out' }, 'One', ['Draft/One.md']);
        expect(valid.problems).toEqual([]);
        bytes.set('Out/One.docx', zipSync({ 'random.txt': strToU8('Not a Word document') }));
        const invalid = await recheckDelivery(plugin.app, valid);
        expect(invalid.problems.join(' ')).toContain(t('ui.exportDelivery.wordPackageIncomplete'));
    });
    it('invalidates review marks when bytes change and preserves them only for unchanged files', async () => {
        const { plugin, bytes, request } = fixture();
        bytes.set('Out/One.md', strToU8('Original'));
        const receipt = await checkExportDelivery(plugin, request, { savedPaths: ['Out/One.md'], outputFolder: 'Out' }, 'One', ['Draft/One.md']);
        receipt.files[0].reviewedSha256 = receipt.files[0].sha256;
        receipt.reviewedAt = new Date().toISOString();
        expect(isDeliveryReviewed(await recheckDelivery(plugin.app, receipt))).toBe(true);
        bytes.set('Out/One.md', strToU8('Edited after review'));
        const changed = await recheckDelivery(plugin.app, receipt);
        expect(changed.files[0].modifiedAfterExport).toBe(true);
        expect(changed.reviewedAt).toBeUndefined();
        expect(isDeliveryReviewed(changed)).toBe(false);
    });
    it('rejects receipt traversal and preserves original export provenance during review', async () => {
        const { plugin, bytes, text, request } = fixture();
        bytes.set('Out/One.md', strToU8('Original'));
        const receipt = await checkExportDelivery(plugin, request, { savedPaths: ['Out/One.md'], outputFolder: 'Out' }, 'One', ['Draft/One.md']);
        receipt.files[0].path = '../Secret.md';
        text.set(receipt.receiptPath, JSON.stringify(receipt));
        await expect(readDeliveryReceipt(plugin.app, receipt.receiptPath)).rejects.toThrow(t('ui.exportDelivery.invalidDestination'));
    });
});
