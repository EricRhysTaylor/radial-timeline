import { App, normalizePath, TFile, TFolder, TAbstractFile } from 'obsidian';
import { DEFAULT_INQUIRY_ARTIFACT_FOLDER } from '../constants';

export function resolveInquiryArtifactFolder(): string {
    return normalizePath(DEFAULT_INQUIRY_ARTIFACT_FOLDER);
}

export async function ensureInquiryArtifactFolder(
    app: App
): Promise<TFolder | null> {
    const folderPath = resolveInquiryArtifactFolder();
    const existing = app.vault.getAbstractFileByPath(folderPath);
    if (existing && !(existing instanceof TFolder)) {
        return null;
    }
    try {
        await app.vault.createFolder(folderPath);
    } catch {
        // Folder may already exist.
    }
    const folder = app.vault.getAbstractFileByPath(folderPath);
    return folder instanceof TFolder ? folder : null;
}

export function getMostRecentArtifactFile(
    app: App
): TFile | null {
    const folderPath = resolveInquiryArtifactFolder();
    const folder = app.vault.getAbstractFileByPath(folderPath);
    if (!folder || !(folder instanceof TFolder)) return null;

    let latest: TFile | null = null;

    const scan = (node: TAbstractFile) => {
        if (node instanceof TFile) {
            if (node.extension === 'md') {
                if (!latest || node.stat.mtime > latest.stat.mtime) {
                    latest = node;
                }
            }
            return;
        }
        if (node instanceof TFolder) {
            node.children.forEach(child => scan(child));
        }
    };

    scan(folder);
    return latest;
}
