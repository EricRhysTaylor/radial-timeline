import { App, Notice, TFile } from 'obsidian';
import { frontmatterValueToText, normalizeFrontmatterKeys } from '../../utils/frontmatter';
import { normalizeStatus } from '../../utils/text';
import { prepareFrontmatterRewrite, verifyFrontmatterRewrite } from '../../utils/frontmatterWriteSafety';

type ZeroDraftOptions = {
    app: App;
    file: TFile;
    enableZeroDraftMode?: boolean;
    sceneTitle?: string;
    onOverrideOpen: () => Promise<void>;
};

const normalizeYamlValue = (value: unknown): string | undefined => {
    if (value === null || value === undefined) return undefined;
    if (Array.isArray(value)) {
        return value.length > 0 ? String(value[0]).trim() : undefined;
    }
    if (typeof value === 'string') {
        return value.trim() || undefined;
    }
    return frontmatterValueToText(value).trim() || undefined;
};

const isStageZero = (value: string | undefined): boolean => {
    if (!value) return true;
    return value.trim().toLowerCase() === 'zero';
};

const isStatusComplete = (value: unknown): boolean => {
    const normalized = normalizeStatus(value);
    if (normalized) {
        return normalized === 'Completed';
    }
    const raw = normalizeYamlValue(value) ?? '';
    return raw.trim().toLowerCase() === 'complete';
};

export async function maybeHandleZeroDraftClick(options: ZeroDraftOptions): Promise<boolean> {
    const { app, file, enableZeroDraftMode, sceneTitle, onOverrideOpen } = options;
    if (!enableZeroDraftMode) return false;

    const cache = app.metadataCache.getFileCache(file);
    const rawFrontmatter = (cache?.frontmatter ?? {}) as Record<string, unknown>;
    const frontmatter = normalizeFrontmatterKeys(rawFrontmatter);
    const stageValue = normalizeYamlValue(frontmatter['Publish Stage']);
    const statusValue = frontmatter['Status'];

    if (!isStageZero(stageValue) || !isStatusComplete(statusValue)) {
        return false;
    }

    const pendingEdits = normalizeYamlValue(frontmatter['Pending Edits']) ?? '';
    const title = sceneTitle || file.basename || 'Scene';
    const { default: ZeroDraftModal } = await import('../../modals/ZeroDraftModal');
    const modal = new ZeroDraftModal(app, {
        titleText: `Pending Edits — ${title}`,
        initialText: pendingEdits,
        onOk: async (nextText: string) => {
            try {
                const originalContent = await app.vault.read(file);
                const prepared = prepareFrontmatterRewrite(originalContent);
                if (!prepared || prepared.aliasConflicts.length > 0) {
                    new Notice('Pending Edits could not be safely updated due to unexpected structure. Please review or reset the Pending Edits section.', 7000);
                    return false;
                }
                await app.fileManager.processFrontMatter(file, (yaml: Record<string, unknown>) => {
                    yaml['Pending Edits'] = nextText;
                });
                const verifiedContent = await app.vault.read(file);
                const verification = verifyFrontmatterRewrite(verifiedContent, {
                    originalBody: prepared.body,
                    verifyParsed: (verifiedFrontmatter) => {
                        const normalizedVerified = normalizeFrontmatterKeys(verifiedFrontmatter);
                        const verifiedValue = normalizedVerified['Pending Edits'];
                        return typeof verifiedValue === 'string' ? verifiedValue.trim() === nextText.trim() : nextText.trim() === '';
                    }
                });
                if (!verification.ok) {
                    new Notice('RT detected a potential issue after this operation. Please review the affected note. If needed, use backup or sync/version history to restore.', 8000);
                    return false;
                }
                return true;
            } catch {
                new Notice('Pending Edits could not be safely updated due to unexpected structure. Please review or reset the Pending Edits section.', 7000);
                return false;
            }
        },
        onOverride: () => {
            void onOverrideOpen();
        }
    });
    modal.open();
    return true;
}
