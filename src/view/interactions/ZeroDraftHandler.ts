import { App, Notice, TFile } from 'obsidian';
import { canonicalizeFrontmatterKey, frontmatterValueToText, normalizeFrontmatterKeys } from '../../utils/frontmatter';
import { normalizeStatus } from '../../utils/text';
import { prepareFrontmatterRewrite, verifyFrontmatterRewrite } from '../../utils/frontmatterWriteSafety';
import { getActiveBookTitle } from '../../utils/books';
import type { RadialTimelineSettings } from '../../types/settings';
import { t } from '../../i18n';

type ZeroDraftOptions = {
    app: App;
    file: TFile;
    settings: RadialTimelineSettings;
    sceneTitle?: string;
    onOverrideOpen: () => Promise<void>;
};

const PENDING_EDITS = 'Pending Edits';

/** Pending Edits as display text: a YAML list reads one entry per line. */
export const pendingEditsText = (value: unknown): string =>
    Array.isArray(value)
        ? value.map(entry => frontmatterValueToText(entry).trim()).filter(Boolean).join('\n')
        : frontmatterValueToText(value).trim();

/** Adds new edits after the existing ones, keeping a YAML list a list. */
export const appendPendingEdits = (current: unknown, addition: string): unknown => {
    if (Array.isArray(current)) return [...(current as unknown[]), addition];
    const existing = frontmatterValueToText(current).trim();
    return existing ? `${existing}\n${addition}` : addition;
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
    const { app, file, settings, sceneTitle, onOverrideOpen } = options;
    if (!settings.enableZeroDraftMode) return false;

    const cache = app.metadataCache.getFileCache(file);
    const rawFrontmatter = (cache?.frontmatter ?? {}) as Record<string, unknown>;
    const frontmatter = normalizeFrontmatterKeys(rawFrontmatter);
    const stageValue = normalizeYamlValue(frontmatter['Publish Stage']);
    const statusValue = frontmatter['Status'];

    if (!isStageZero(stageValue) || !isStatusComplete(statusValue)) {
        return false;
    }

    const title = sceneTitle || file.basename || t('ui.zeroDraftHandler.sceneFallback');
    const { default: ZeroDraftModal } = await import('../../modals/ZeroDraftModal');
    const modal = new ZeroDraftModal(app, {
        bookTitle: getActiveBookTitle(settings),
        sceneTitle: title,
        currentEdits: pendingEditsText(frontmatter[PENDING_EDITS]),
        onSave: async (addition: string) => {
            try {
                const originalContent = await app.vault.read(file);
                const prepared = prepareFrontmatterRewrite(originalContent);
                if (!prepared || prepared.aliasConflicts.length > 0) {
                    new Notice(t('ui.zeroDraftHandler.unsafeStructureNotice'), 7000);
                    return false;
                }
                // Append to the value on disk now, under the author's own spelling of the key.
                let expected = '';
                await app.fileManager.processFrontMatter(file, (yaml: Record<string, unknown>) => {
                    const key = Object.keys(yaml).find(k => canonicalizeFrontmatterKey(k) === PENDING_EDITS) ?? PENDING_EDITS;
                    yaml[key] = appendPendingEdits(yaml[key], addition);
                    expected = pendingEditsText(yaml[key]);
                });
                const verifiedContent = await app.vault.read(file);
                const verification = verifyFrontmatterRewrite(verifiedContent, {
                    originalBody: prepared.body,
                    verifyParsed: (verifiedFrontmatter) =>
                        pendingEditsText(normalizeFrontmatterKeys(verifiedFrontmatter)[PENDING_EDITS]) === expected
                });
                if (!verification.ok) {
                    new Notice(t('ui.zeroDraftHandler.potentialIssueNotice'), 8000);
                    return false;
                }
                return true;
            } catch {
                new Notice(t('ui.zeroDraftHandler.unsafeStructureNotice'), 7000);
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
