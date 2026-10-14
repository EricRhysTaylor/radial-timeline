import { afterEach, describe, expect, it, vi } from 'vitest';
import type { App } from 'obsidian';
import { getVaultAbsolutePath } from '../utils/exportFormats';
import { openExportedFile } from './openExportedFile';
vi.mock('../utils/exportFormats', () => ({ getVaultAbsolutePath: vi.fn(() => '/vault/Out/One.docx') }));
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });
const fixture = (exists = true) => {
    const openLinkText = vi.fn(async () => {});
    return { openLinkText, app: { vault: { adapter: { exists: async () => exists } }, workspace: { openLinkText } } as unknown as App };
};
describe('open delivered files', () => {
    it('opens PDF in the vault viewer', async () => {
        const { app, openLinkText } = fixture(); await openExportedFile(app, 'Out/One.pdf', 'pdf');
        expect(openLinkText).toHaveBeenCalledWith('Out/One.pdf', '', 'tab');
    });
    it('opens Word with the system app and reports system opener failures', async () => {
        const { app, openLinkText } = fixture(); const openPath = vi.fn(async () => '');
        vi.stubGlobal('window', { require: () => ({ shell: { openPath } }) });
        await openExportedFile(app, 'Out/One.docx', 'docx');
        expect(getVaultAbsolutePath).toHaveBeenCalled(); expect(openPath).toHaveBeenCalledWith('/vault/Out/One.docx');
        expect(openLinkText).not.toHaveBeenCalled();
        openPath.mockResolvedValue('No application');
        await expect(openExportedFile(app, 'Out/One.docx', 'docx')).rejects.toThrow('No application');
    });
    it('blocks a missing export rather than creating a new note', async () => {
        const { app, openLinkText } = fixture(false);
        await expect(openExportedFile(app, 'Out/Gone.pdf', 'pdf')).rejects.toThrow();
        expect(openLinkText).not.toHaveBeenCalled();
    });
});
