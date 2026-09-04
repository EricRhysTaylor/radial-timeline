import { TFolder, Vault, normalizePath } from 'obsidian';
import { escapeRegExp } from '../../utils/regex';

export const MAX_RESOLVED_SCAN_ROOTS = 50;

export type ResolvedScanRoots = {
    resolvedRoots: string[];
    totalMatches: number;
};

const MAX_RANGE_EXPANSION = 200;

export const normalizeScanRootPattern = (raw: string): string => {
    const trimmed = raw.trim();
    if (!trimmed || trimmed === '/' || trimmed === '.') return '/';
    const cleaned = trimmed.replace(/^\/+/, '').replace(/\/+$/, '');
    const normalized = normalizePath(cleaned);
    if (!normalized) return '/';
    return `/${normalized}/`;
};

export const normalizeScanRootPatterns = (roots?: string[]): string[] => {
    if (!roots || !roots.length) return [];
    const list = roots.map(normalizeScanRootPattern).filter(Boolean);
    return Array.from(new Set(list));
};

export const parseScanRootInput = (raw: string): string[] => {
    const lines = raw
        .split(/[\n,;]+/)
        .map(entry => entry.trim())
        .filter(Boolean);
    if (!lines.length) return [];
    return normalizeScanRootPatterns(lines);
};

export const toVaultRoot = (root: string): string => {
    const normalized = normalizeScanRootPattern(root);
    if (normalized === '/') return '';
    return normalized.slice(1, -1);
};

export const toDisplayRoot = (root: string): string => {
    if (!root) return '/';
    const normalized = normalizePath(root);
    return `/${normalized}/`;
};

export const resolveScanRoots = (
    patterns: string[],
    vault: Vault,
    maxRoots = MAX_RESOLVED_SCAN_ROOTS
): ResolvedScanRoots => {
    const normalized = normalizeScanRootPatterns(patterns);
    if (!normalized.length) {
        return { resolvedRoots: [], totalMatches: 0 };
    }
    const folders = vault.getAllLoadedFiles().filter((file): file is TFolder => file instanceof TFolder);
    const folderPaths = folders.map(folder => folder.path);
    const resolved = new Set<string>();

    normalized.forEach(pattern => {
        if (pattern === '/') {
            resolved.add('');
            return;
        }
        const vaultRoot = toVaultRoot(pattern);
        const segments = vaultRoot.split('/').filter(Boolean);
        const hasWildcard = segments.some(segment => segment.includes('*') || /\d+\s*-\s*\d+/.test(segment));
        if (!hasWildcard) {
            const folder = vault.getAbstractFileByPath(vaultRoot);
            if (folder instanceof TFolder) {
                resolved.add(folder.path);
            }
            return;
        }
        const regex = new RegExp(`^${segments.map(buildSegmentRegex).join('/')}$`);
        folderPaths.forEach(path => {
            if (regex.test(path)) resolved.add(path);
        });
    });

    const list = Array.from(resolved).sort((a, b) => a.localeCompare(b));
    const totalMatches = list.length;
    const limited = list.slice(0, maxRoots);

    return {
        resolvedRoots: limited.map(toDisplayRoot),
        totalMatches
    };
};

function buildSegmentRegex(segment: string): string {
    const tokenRegex = /(\d+\s*-\s*\d+)|\*/g;
    let cursor = 0;
    let output = '';
    let match: RegExpExecArray | null;
    while ((match = tokenRegex.exec(segment)) !== null) {
        const index = match.index;
        if (index > cursor) {
            output += escapeRegExp(segment.slice(cursor, index));
        }
        const token = match[0];
        if (token === '*') {
            output += '[^/]*';
        } else {
            const rangeMatch = token.match(/(\d+)\s*-\s*(\d+)/);
            if (rangeMatch) {
                const start = Number(rangeMatch[1]);
                const end = Number(rangeMatch[2]);
                const min = Math.min(start, end);
                const max = Math.max(start, end);
                const span = max - min + 1;
                if (span > 0 && span <= MAX_RANGE_EXPANSION) {
                    const values = Array.from({ length: span }, (_, i) => String(min + i));
                    output += `(?:${values.join('|')})`;
                } else {
                    output += '\\d+';
                }
            }
        }
        cursor = index + token.length;
    }
    if (cursor < segment.length) {
        output += escapeRegExp(segment.slice(cursor));
    }
    return output;
}
