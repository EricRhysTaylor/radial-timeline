import { normalizePath, TFile } from 'obsidian';
import type RadialTimelinePlugin from '../main';
import { ensureMovesLogsRoot, resolveAvailableLogPath, resolveMovesLogsRoot } from '../ai/log';
import { openOrRevealFile, openOrRevealFileAtSubpath } from './fileUtils';
import { getActiveBook, getActiveBookTitle } from './books';
import { getActiveRecentStructuralMoves } from './recentStructuralMoves';
import type { StructuralMoveHistoryEntry } from '../types/settings';

function sanitizeSegment(value: string | null | undefined): string {
    if (!value) return '';
    return value
        .replace(/[<>:"/\\|?*]+/g, '-')
        .replace(/\s+/g, ' ')
        .replace(/-+/g, '-')
        .trim()
        .replace(/^-+|-+$/g, '');
}

function formatBoolean(value: boolean | undefined): string {
    return value ? 'Yes' : 'No';
}

function buildMoveHistoryMarkdown(plugin: RadialTimelinePlugin): string {
    const activeBook = getActiveBook(plugin.settings);
    const bookTitle = getActiveBookTitle(plugin.settings);
    const entries = getActiveRecentStructuralMoves(plugin.settings);
    const generatedAt = new Date().toISOString();

    const lines: string[] = [
        `# Note move history — ${bookTitle}`,
        '',
        `- Generated: ${generatedAt}`,
        `- Book ID: ${activeBook?.id ?? 'unknown'}`,
        `- Source folder: ${activeBook?.sourceFolder ?? ''}`,
        `- Stored entries: ${entries.length}`,
        ''
    ];

    if (entries.length === 0) {
        lines.push('No note move history is currently stored for this book.', '');
        return lines.join('\n');
    }

    entries.forEach((entry, index) => {
        lines.push(`## ${index + 1}. ${entry.summary}`);
        lines.push(`- Timestamp: ${entry.timestamp}`);
        lines.push(`- Item type: ${entry.itemType}`);
        lines.push(`- Item label: ${entry.itemLabel}`);
        lines.push(`- Stable ID: ${entry.itemId}`);
        lines.push(`- Source context: ${entry.sourceContext ?? '—'}`);
        lines.push(`- Destination context: ${entry.destinationContext ?? '—'}`);
        lines.push(`- Rename impact: ${entry.renameCount ?? 0} note${(entry.renameCount ?? 0) === 1 ? '' : 's'}`);
        lines.push(`- Crossed Acts: ${formatBoolean(entry.crossedActs)}`);
        lines.push(`- Ripple rename: ${formatBoolean(entry.rippleRename)}`);
        lines.push('');
    });

    return lines.join('\n');
}

export async function openStructuralMoveHistoryLog(
    plugin: RadialTimelinePlugin,
    targetEntry?: StructuralMoveHistoryEntry
): Promise<void> {
    const logsRoot = resolveMovesLogsRoot();
    const folder = await ensureMovesLogsRoot(plugin.app.vault);
    if (!folder) {
        throw new Error(`Unable to prepare log folder: ${logsRoot}`);
    }

    const bookTitle = getActiveBookTitle(plugin.settings).trim() || 'Project';
    const baseName = `Move History — ${sanitizeSegment(bookTitle)}`;
    const preferredPath = normalizePath(`${logsRoot}/${baseName}.md`);
    const entries = getActiveRecentStructuralMoves(plugin.settings);
    const content = buildMoveHistoryMarkdown(plugin);

    const existing = plugin.app.vault.getAbstractFileByPath(preferredPath);
    let file: TFile;
    if (existing instanceof TFile) {
        await plugin.app.vault.modify(existing, content);
        file = existing;
    } else if (!existing) {
        file = await plugin.app.vault.create(preferredPath, content);
    } else {
        const datedName = `${baseName} — ${new Date().toISOString().slice(0, 10)}`;
        const logPath = resolveAvailableLogPath(plugin.app.vault, logsRoot, datedName);
        file = await plugin.app.vault.create(logPath, content);
    }

    if (targetEntry) {
        const matchIndex = entries.findIndex(
            (e) => e.timestamp === targetEntry.timestamp && e.itemId === targetEntry.itemId
        );
        if (matchIndex >= 0) {
            const heading = `${matchIndex + 1}. ${entries[matchIndex].summary}`;
            await openOrRevealFileAtSubpath(plugin.app, file, `#${heading}`, false);
            return;
        }
    }

    await openOrRevealFile(plugin.app, file, false);
}
