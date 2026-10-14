import type RadialTimelinePlugin from '../main';
import { resolveExportOutputFolder } from '../utils/aiOutput';
import { readDeliveryReceipt, validateExportDestination, type ExportDeliveryReceipt } from './exportDelivery';

/** The settings index is a shortcut, not the archive: portable receipts stay on disk. */
export async function readRecentExportDeliveries(plugin: RadialTimelinePlugin, destination?: string): Promise<{ receipts: ExportDeliveryReceipt[]; problems: string[] }> {
    const { app, settings } = plugin;
    const paths = new Set(settings.recentExportDeliveryReceiptPaths || []);
    const folders = new Set<string>();
    const problems: string[] = [];
    if (settings.lastExportDeliveryReceiptPath) {
        paths.add(settings.lastExportDeliveryReceiptPath);
        folders.add(settings.lastExportDeliveryReceiptPath.slice(0, settings.lastExportDeliveryReceiptPath.lastIndexOf('/')));
    }
    const roots = new Set([settings.manuscriptOutputFolder || resolveExportOutputFolder(plugin)]);
    if (destination) roots.add(destination);
    // Discover pre-history exports in known destinations, including split-output subfolders.
    for (const root of roots) {
        try {
            validateExportDestination(root);
            if (!await app.vault.adapter.exists(root)) continue; // SAFE: optional receipt directories can be absent from Obsidian's indexed files.
            folders.add(`${root}/Receipts`);
            const listing = await app.vault.adapter.list(root); // SAFE: discover portable JSON receipts, including files Obsidian does not index.
            for (const folder of listing.folders) folders.add(`${folder}/Receipts`);
        } catch (error) { problems.push(`${root}: ${error instanceof Error ? error.message : String(error)}`); }
    }
    for (const folder of folders) {
        try {
            validateExportDestination(folder);
            if (!await app.vault.adapter.exists(folder)) continue; // SAFE: test exact validated receipt directory before listing unindexed JSON.
            const listing = await app.vault.adapter.list(folder); // SAFE: exact validated vault-local receipt folder; no vault-wide scan.
            for (const path of listing.files) if (path.endsWith('.json')) paths.add(path);
        } catch (error) { problems.push(`${folder}: ${error instanceof Error ? error.message : String(error)}`); }
    }
    const receipts: ExportDeliveryReceipt[] = [];
    for (const path of paths) {
        try { receipts.push(await readDeliveryReceipt(app, path)); }
        catch (error) { problems.push(`${path}: ${error instanceof Error ? error.message : String(error)}`); }
    }
    receipts.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || a.receiptPath.localeCompare(b.receiptPath));
    return { receipts: receipts.slice(0, 5), problems };
}
