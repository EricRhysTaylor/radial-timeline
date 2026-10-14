import { describe, expect, it } from 'vitest';
import type RadialTimelinePlugin from '../main';
import type { ManuscriptModalResult } from '../modals/ManuscriptOptionsModal';
import { DEFAULT_SETTINGS } from '../settings/defaults';
import { getManuscriptProofConfigurationKey, getManuscriptProofStaleReason, hashProofInput, type ManuscriptProofReceipt } from './manuscriptProof';

function fixture() {
    const bodies = new Map([['Draft/One.md', 'Original manuscript']]);
    const plugin = {
        settings: { ...DEFAULT_SETTINGS, books: [{ id: 'one', title: 'One', sourceFolder: 'One' }, { id: 'two', title: 'Two', sourceFolder: 'Two' }], activeBookId: 'one' },
        app: { vault: { adapter: { readBinary: async (path: string) => {
            if (!bodies.has(path)) throw new Error('Missing');
            return new TextEncoder().encode(bodies.get(path)).buffer;
        } } } },
        getPublishingValidationService: () => ({ resolveBookMetaForBook: () => ({ bookMeta: { title: 'One', author: 'Writer' } }) }),
    } as unknown as RadialTimelinePlugin;
    const request: ManuscriptModalResult = { source: { kind: 'folder', path: 'Draft', paths: ['Draft/One.md'], title: 'Direct', author: 'Author' }, outputFormat: 'pdf', exportType: 'manuscript', order: 'narrative', tocMode: 'none' };
    const receipt: ManuscriptProofReceipt = { schemaVersion: 1, generatedAt: '2026-10-11', styleName: 'Basic', notices: [], configurationKey: getManuscriptProofConfigurationKey(plugin, request), dependencies: [{ kind: 'vault', path: 'Draft/One.md', sha256: hashProofInput('Original manuscript') }], renderedPaths: ['Proof.pdf'], sourceWordCounts: {} };
    return { plugin, bodies, request, receipt };
}

describe('manuscript proof freshness', () => {
    it('uses rendering options while excluding proof intent and export-only side effects', () => {
        const { plugin, request, receipt } = fixture();
        expect(getManuscriptProofConfigurationKey(plugin, { ...request, intent: 'proof', updateWordCounts: true, saveMarkdownArtifact: true })).toBe(receipt.configurationKey);
        expect(getManuscriptProofConfigurationKey(plugin, { ...request, lineBreaksAsParagraphs: true })).not.toBe(receipt.configurationKey);
        plugin.settings.pdfBindingGutter = true;
        expect(getManuscriptProofConfigurationKey(plugin, request)).not.toBe(receipt.configurationKey);
    });
    it('does not attach a direct manuscript proof to the active timeline book', () => {
        const { plugin, request, receipt } = fixture();
        plugin.settings.activeBookId = 'two';
        expect(getManuscriptProofConfigurationKey(plugin, request)).toBe(receipt.configurationKey);
    });
    it('verifies actual source bytes and rejects edits or unavailable inputs', async () => {
        const { plugin, bodies, request, receipt } = fixture();
        expect(await getManuscriptProofStaleReason(plugin, receipt, request)).toBeNull();
        bodies.set('Draft/One.md', 'Revised manuscript');
        expect(await getManuscriptProofStaleReason(plugin, receipt, request)).toContain('content');
        bodies.delete('Draft/One.md');
        expect(await getManuscriptProofStaleReason(plugin, receipt, request)).toContain('unavailable');
    });
    it('invalidates a changed source selection or metadata', async () => {
        const { plugin, request, receipt } = fixture();
        expect(await getManuscriptProofStaleReason(plugin, receipt, { ...request, rangeStart: 2 })).toContain('settings');
        expect(await getManuscriptProofStaleReason(plugin, receipt, { ...request, tocMode: 'document', tocDepth: 2 })).toContain('settings');
        const contents = { ...request, tocMode: 'document' as const, tocDepth: 2 };
        expect(getManuscriptProofConfigurationKey(plugin, contents)).not.toBe(getManuscriptProofConfigurationKey(plugin, { ...contents, tocDepth: 3 }));
        expect(await getManuscriptProofStaleReason(plugin, receipt, { ...request, source: { kind: 'file', path: 'Draft/One.md', paths: ['Draft/One.md'], title: 'Changed', author: 'Author' } })).toContain('settings');
    });
});
