import { App, TAbstractFile, TFile, Vault, getFrontMatterInfo, normalizePath, parseYaml } from 'obsidian';
import { confirmWithErtModal } from '../modals/ErtConfirmModal';
import { resolveRecoverSnapshotsRoot } from '../ai/log';

export interface SnapshotFrontmatterFieldsOptions {
    operation: string;
    fields?: string[];
    selectFields?: (frontmatter: Record<string, unknown>, file: TFile) => Record<string, unknown>;
    meta?: Record<string, unknown>;
}

export interface SnapshotFileBeforeOverwriteOptions {
    operation: string;
    meta?: Record<string, unknown>;
}

export interface DeletionSnapshotPreviewDetail {
    fields: string[];
    values: Record<string, unknown>;
}

export interface WriteDeletionSnapshotOptions {
    /** Display name of the note type being pruned, e.g. 'Beat', 'Backdrop', 'Scene'. */
    noteType: string;
    operation: 'delete_advanced';
    preview: Map<TFile, DeletionSnapshotPreviewDetail>;
    scopeSummary: string;
}

export interface ManagedOutputOverwriteCheckOptions {
    managedMarkers?: string[];
    isManagedContent?: (content: string, file: TFile) => boolean;
}

export interface ManagedOutputWriteOptions extends ManagedOutputOverwriteCheckOptions {
    operation: string;
    managedMarker?: string;
    unmanagedOverwritePrompt?: string | ((file: TFile) => string);
    snapshotOnManagedOverwrite?: boolean;
    meta?: Record<string, unknown>;
}

export interface ManagedOutputWriteResult {
    path: string;
    created: boolean;
    overwritten: boolean;
    confirmedUnmanagedOverwrite: boolean;
    snapshotPath: string | null;
    skipped: boolean;
}

/**
 * Reads the user's Obsidian "Deleted files" preference and returns whether
 * to use the OS system trash (macOS Trash / Windows Recycle Bin) or the
 * vault-local `.trash/` folder. Falls back to `.trash/` when the setting
 * is missing or set to anything other than `'system'`.
 */
export function useSystemTrash(app: App): boolean {
    try {
        // getConfig is an undocumented Vault API; type it structurally.
        const vault = app.vault as Vault & { getConfig?: (key: string) => unknown };
        const trashOption = vault.getConfig?.('trashOption');
        return trashOption === 'system';
    } catch {
        return false;
    }
}

async function ensureFolder(app: App, folderPath: string): Promise<void> {
    const normalized = normalizePath(folderPath.trim());
    if (!normalized) return;

    const parts = normalized.split('/').filter(Boolean);
    let current = '';
    for (const part of parts) {
        current = current ? `${current}/${part}` : part;
        const existing = app.vault.getAbstractFileByPath(current);
        if (existing) continue;
        await app.vault.createFolder(current);
    }
}

function createSnapshotFileName(operation: string): string {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const safeOperation = operation.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'snapshot';
    return `${timestamp}-${safeOperation}.json`;
}

async function writeSnapshotPayload(app: App, payload: Record<string, unknown>, options: { operation: string }): Promise<string> {
    const logsFolder = resolveRecoverSnapshotsRoot();
    await ensureFolder(app, logsFolder);
    const snapshotPath = normalizePath(`${logsFolder}/${createSnapshotFileName(options.operation)}`);
    await app.vault.create(snapshotPath, JSON.stringify(payload, null, 2));
    return snapshotPath;
}

async function readFrontmatterFromFile(app: App, file: TFile): Promise<Record<string, unknown> | null> {
    const content = await app.vault.read(file);
    const info = getFrontMatterInfo(content);
    if (!info?.exists || !info.frontmatter) return null;
    const parsed: unknown = parseYaml(info.frontmatter);
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : null;
}

function selectFields(frontmatter: Record<string, unknown>, file: TFile, options: SnapshotFrontmatterFieldsOptions): Record<string, unknown> {
    if (options.selectFields) {
        return options.selectFields(frontmatter, file);
    }
    if (options.fields?.length) {
        const selected: Record<string, unknown> = {};
        for (const key of options.fields) {
            if (Object.prototype.hasOwnProperty.call(frontmatter, key)) {
                selected[key] = frontmatter[key];
            }
        }
        return selected;
    }
    return { ...frontmatter };
}

function wrapManagedContent(content: string, marker?: string): string {
    if (!marker) return content;
    if (content.includes(marker)) return content;
    return `${marker}\n${content}`;
}

async function readTextFile(app: App, file: TFile): Promise<string> {
    return app.vault.read(file);
}

export async function snapshotFrontmatterFields(
    app: App,
    files: TFile[],
    options: SnapshotFrontmatterFieldsOptions
): Promise<string | null> {
    const uniqueFiles = [...new Map(files.map((file) => [file.path, file])).values()];
    const entries: Array<Record<string, unknown>> = [];

    for (const file of uniqueFiles) {
        try {
            const frontmatter = await readFrontmatterFromFile(app, file);
            if (!frontmatter) continue;
            const selected = selectFields(frontmatter, file, options);
            if (Object.keys(selected).length === 0) continue;
            entries.push({
                path: file.path,
                basename: file.basename,
                extension: file.extension,
                fields: selected
            });
        } catch {
            continue;
        }
    }

    if (entries.length === 0) return null;

    return writeSnapshotPayload(app, {
        version: 1,
        kind: 'frontmatter-fields',
        operation: options.operation,
        createdAt: new Date().toISOString(),
        fileCount: entries.length,
        entries,
        meta: options.meta ?? {}
    }, { operation: options.operation });
}

export async function snapshotFileBeforeOverwrite(
    app: App,
    file: TFile,
    options: SnapshotFileBeforeOverwriteOptions
): Promise<string | null> {
    const content = await readTextFile(app, file);
    return writeSnapshotPayload(app, {
        version: 1,
        kind: 'file-overwrite',
        operation: options.operation,
        createdAt: new Date().toISOString(),
        fileCount: 1,
        entries: [{
            path: file.path,
            basename: file.basename,
            extension: file.extension,
            content
        }],
        meta: options.meta ?? {}
    }, { operation: options.operation });
}

function isEmptyDeletionValue(value: unknown): boolean {
    if (value === undefined || value === null) return true;
    if (typeof value === 'string') return value.trim().length === 0;
    if (Array.isArray(value)) return value.length === 0;
    return false;
}

/**
 * Canonical "advanced field delete" snapshot writer. Records only the fields
 * that carried a value before deletion, so a no-op delete (all-empty fields)
 * never produces a snapshot file. Output path and payload shape are shared by
 * every note type that supports advanced-field deletion (Beat, Backdrop,
 * Scene) — the noteType field is the only per-caller variation.
 */
export async function writeDeletionSnapshot(
    app: App,
    options: WriteDeletionSnapshotOptions
): Promise<string | null> {
    const entries: Array<{
        path: string;
        basename: string;
        fields: Array<{ key: string; value: unknown }>;
    }> = [];

    for (const [file, detail] of options.preview.entries()) {
        const fields = detail.fields
            .filter((field) => !isEmptyDeletionValue(detail.values[field]))
            .map((field) => ({ key: field, value: detail.values[field] }));
        if (fields.length === 0) continue;
        entries.push({
            path: file.path,
            basename: file.basename,
            fields
        });
    }

    if (entries.length === 0) return null;

    const logsRoot = resolveRecoverSnapshotsRoot();
    await ensureFolder(app, logsRoot);

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `${timestamp}-${options.noteType.toLowerCase()}-${options.operation}.json`;
    const snapshotPath = normalizePath(`${logsRoot}/${filename}`);
    const payload = {
        version: 1,
        createdAt: new Date().toISOString(),
        noteType: options.noteType,
        operation: options.operation,
        scopeSummary: options.scopeSummary,
        filesWithValuedDeletes: entries.length,
        valuedFieldDeletes: entries.reduce((sum, entry) => sum + entry.fields.length, 0),
        entries
    };

    await app.vault.create(snapshotPath, `${JSON.stringify(payload, null, 2)}\n`);
    return snapshotPath;
}

export async function canOverwriteManagedOutput(
    app: App,
    file: TFile,
    options: ManagedOutputOverwriteCheckOptions = {}
): Promise<{ allowed: boolean; reason: string; content: string }> {
    const content = await readTextFile(app, file);
    const markers = (options.managedMarkers ?? []).filter(Boolean);
    if (markers.some((marker) => content.includes(marker))) {
        return { allowed: true, reason: 'managed-marker', content };
    }
    if (options.isManagedContent?.(content, file)) {
        return { allowed: true, reason: 'managed-predicate', content };
    }
    return { allowed: false, reason: 'unmanaged', content };
}

export async function writeManagedOutput(
    app: App,
    fileOrPath: TFile | string,
    content: string,
    options: ManagedOutputWriteOptions
): Promise<ManagedOutputWriteResult> {
    const path = typeof fileOrPath === 'string' ? normalizePath(fileOrPath) : fileOrPath.path;
    const existing = app.vault.getAbstractFileByPath(path);
    const finalContent = wrapManagedContent(content, options.managedMarker);

    if (existing && !(existing instanceof TFile)) {
        throw new Error(`Cannot write managed output because a folder exists at ${path}.`);
    }

    if (!(existing instanceof TFile)) {
        await app.vault.create(path, finalContent);
        return {
            path,
            created: true,
            overwritten: false,
            confirmedUnmanagedOverwrite: false,
            snapshotPath: null,
            skipped: false
        };
    }

    const overwriteCheck = await canOverwriteManagedOutput(app, existing, {
        managedMarkers: [options.managedMarker ?? '', ...(options.managedMarkers ?? [])].filter(Boolean),
        isManagedContent: options.isManagedContent
    });

    let snapshotPath: string | null = null;
    let confirmedUnmanagedOverwrite = false;
    if (!overwriteCheck.allowed) {
        const prompt = typeof options.unmanagedOverwritePrompt === 'function'
            ? options.unmanagedOverwritePrompt(existing)
            : options.unmanagedOverwritePrompt
                ?? `Overwrite existing output "${existing.path}"? Existing content will be archived to a log snapshot first.`;
        const confirmed = await confirmWithErtModal(app, {
            title: 'Overwrite existing output?',
            message: prompt,
            confirmText: 'Overwrite'
        });
        if (!confirmed) {
            return {
                path,
                created: false,
                overwritten: false,
                confirmedUnmanagedOverwrite: false,
                snapshotPath: null,
                skipped: true
            };
        }
        snapshotPath = await snapshotFileBeforeOverwrite(app, existing, {
            operation: options.operation,
            meta: {
                reason: 'overwrite-unmanaged-output',
                ...(options.meta ?? {})
            }
        });
        confirmedUnmanagedOverwrite = true;
    } else if (options.snapshotOnManagedOverwrite) {
        snapshotPath = await snapshotFileBeforeOverwrite(app, existing, {
            operation: options.operation,
            meta: {
                reason: 'overwrite-managed-output',
                ...(options.meta ?? {})
            }
        });
    }

    await app.vault.modify(existing, finalContent);
    return {
        path,
        created: false,
        overwritten: true,
        confirmedUnmanagedOverwrite,
        snapshotPath,
        skipped: false
    };
}

export function isTFile(value: TAbstractFile | null): value is TFile {
    return value instanceof TFile;
}
