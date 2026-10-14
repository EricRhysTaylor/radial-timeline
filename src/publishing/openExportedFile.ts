import type { App } from 'obsidian';
import { getVaultAbsolutePath } from '../utils/exportFormats';
import { t } from '../i18n';
import type { DeliveryFormat } from './exportDelivery';

/** Word uses the system document app; other formats use Obsidian's file viewer. */
export async function openExportedFile(app: App, vaultPath: string, format: DeliveryFormat): Promise<void> {
    if (!await app.vault.adapter.exists(vaultPath)) throw new Error(t('ui.exportFormats.fileNotFoundInVault', { path: vaultPath })); // SAFE: fresh generated artifacts may not yet be indexed; prevent creating a note for a missing export.
    if (format !== 'docx') {
        await app.workspace.openLinkText(vaultPath, '', 'tab');
        return;
    }
    const absolute = getVaultAbsolutePath({ app }, vaultPath);
    if (!absolute) throw new Error(t('ui.exportDeliveryReviewModal.openWithDeviceApp'));
    const shell = (window as unknown as { require?: (name: string) => { shell?: { openPath(path: string): Promise<string> } } }).require?.('electron').shell;
    if (!shell) throw new Error(t('ui.exportDeliveryReviewModal.openerUnavailable'));
    const error = await shell.openPath(absolute);
    if (error) throw new Error(error);
}
