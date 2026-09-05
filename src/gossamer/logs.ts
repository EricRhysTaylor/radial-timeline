import { App, TFile, TFolder, getFrontMatterInfo, parseYaml, stringifyYaml } from 'obsidian';
import {
    ensureGossamerArchiveRoot,
    ensureGossamerContentLogsRoot,
    ensureGossamerLogsRoot,
    formatLogTimestamp,
    resolveAvailableLogPath,
    resolveGossamerArchiveRoot,
    resolveGossamerContentLogsRoot,
    resolveGossamerLogsRoot
} from '../ai/log';

function sanitizeSegment(value: string | null | undefined): string {
    if (!value) return '';
    return value
        .replace(/[<>:"/\\|?*]+/g, '-')
        .replace(/\s+/g, ' ')
        .replace(/-+/g, '-')
        .trim()
        .replace(/^-+|-+$/g, '');
}

async function readFrontmatterFromFile(app: App, file: TFile): Promise<Record<string, unknown> | null> {
    const content = await app.vault.read(file);
    const info = getFrontMatterInfo(content);
    if (!info?.exists || !info.frontmatter) return null;
    const parsed = parseYaml(info.frontmatter);
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : null;
}

function humanizeOperation(operation: string): string {
    return operation
        .replace(/^gossamer-/, '')
        .split(/[-_]+/)
        .filter(Boolean)
        .map((segment) => {
            const lower = segment.toLowerCase();
            if (lower === 'ai') return 'AI';
            return segment.charAt(0).toUpperCase() + segment.slice(1);
        })
        .join(' ') || 'Archive';
}

function formatMeta(meta: Record<string, unknown> | undefined): string[] {
    if (!meta) return [];
    return Object.entries(meta)
        .filter(([, value]) => value !== undefined && value !== null && value !== '')
        .map(([key, value]) => `- ${key}: ${String(value)}`);
}

export function resolveGossamerLogFolder(): string {
    return resolveGossamerLogsRoot();
}

export function resolveGossamerContentLogFolder(): string {
    return resolveGossamerContentLogsRoot();
}

export async function ensureGossamerLogFolder(app: App): Promise<TFolder | null> {
    return ensureGossamerLogsRoot(app.vault);
}

export async function ensureGossamerContentLogFolder(app: App): Promise<TFolder | null> {
    return ensureGossamerContentLogsRoot(app.vault);
}

export function resolveGossamerArchiveFolder(): string {
    return resolveGossamerArchiveRoot();
}

export async function ensureGossamerArchiveFolder(app: App): Promise<TFolder | null> {
    return ensureGossamerArchiveRoot(app.vault);
}

export async function archiveGossamerFrontmatterFields(
    app: App,
    files: TFile[],
    options: {
        operation: string;
        selectFields: (frontmatter: Record<string, unknown>, file: TFile) => Record<string, unknown>;
        meta?: Record<string, unknown>;
    }
): Promise<string | null> {
    const uniqueFiles = [...new Map(files.map((file) => [file.path, file])).values()];
    const entries: Array<{ path: string; basename: string; fields: Record<string, unknown> }> = [];

    for (const file of uniqueFiles) {
        try {
            const frontmatter = await readFrontmatterFromFile(app, file);
            if (!frontmatter) continue;
            const selected = options.selectFields(frontmatter, file);
            if (Object.keys(selected).length === 0) continue;
            entries.push({
                path: file.path,
                basename: file.basename,
                fields: selected
            });
        } catch {
            continue;
        }
    }

    if (entries.length === 0) return null;

    const folder = await ensureGossamerArchiveFolder(app);
    if (!folder) return null;

    const now = new Date();
    const readableTimestamp = formatLogTimestamp(now);
    const operationLabel = humanizeOperation(options.operation);
    const title = `Gossamer Archive — ${operationLabel} ${readableTimestamp}`;
    const baseName = `Gossamer Archive — ${sanitizeSegment(operationLabel)} ${sanitizeSegment(readableTimestamp)}`;

    const lines: string[] = [
        `# ${title}`,
        '',
        `- Created: ${now.toISOString()}`,
        `- Operation: ${operationLabel}`,
        `- Files: ${entries.length}`,
        ...formatMeta(options.meta),
        '',
        '## Archived fields'
    ];

    for (const entry of entries) {
        lines.push('');
        lines.push(`### ${entry.basename}`);
        lines.push(`- Path: \`${entry.path}\``);
        lines.push('```yaml');
        lines.push(stringifyYaml(entry.fields).trim());
        lines.push('```');
    }

    const filePath = resolveAvailableLogPath(app.vault, resolveGossamerArchiveFolder(), baseName);
    await app.vault.create(filePath, lines.join('\n').trim());
    return filePath;
}
