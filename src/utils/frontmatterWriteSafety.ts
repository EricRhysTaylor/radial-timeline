import { getFrontMatterInfo, parseYaml } from 'obsidian';
import type { CanonicalAliasConflict } from './frontmatter';
import { findCanonicalAliasConflicts } from './frontmatter';
import { extractBodyAfterFrontmatter } from './frontmatterDocument';

export interface FrontmatterRewriteInfo {
    exists?: boolean;
    frontmatter?: string;
    to?: number;
    position?: { end?: { offset?: number } };
}

export interface PreparedFrontmatterRewrite {
    info: FrontmatterRewriteInfo;
    parsed: Record<string, unknown>;
    body: string;
    aliasConflicts: CanonicalAliasConflict[];
}

export interface FrontmatterRewriteVerification {
    ok: boolean;
    reason?: string;
    parsed?: Record<string, unknown>;
}

export function prepareFrontmatterRewrite(
    content: string,
    customMappings?: Record<string, string>
): PreparedFrontmatterRewrite | null {
    const info = getFrontMatterInfo(content) as unknown as FrontmatterRewriteInfo;
    if (!info?.exists || !info.frontmatter) return null;

    const yaml = parseYaml(info.frontmatter);
    if (!yaml || typeof yaml !== 'object') return null;

    const parsed = yaml as Record<string, unknown>;
    return {
        info,
        parsed,
        body: extractBodyAfterFrontmatter(content, info),
        aliasConflicts: findCanonicalAliasConflicts(parsed, customMappings),
    };
}

export function verifyFrontmatterRewrite(
    content: string,
    options: {
        originalBody: string;
        verifyParsed?: (parsed: Record<string, unknown>) => boolean;
    }
): FrontmatterRewriteVerification {
    const prepared = prepareFrontmatterRewrite(content);
    if (!prepared) {
        return { ok: false, reason: 'Frontmatter could not be parsed after write.' };
    }

    if (prepared.body !== options.originalBody) {
        return { ok: false, reason: 'Note body changed unexpectedly during frontmatter rewrite.' };
    }

    if (options.verifyParsed && !options.verifyParsed(prepared.parsed)) {
        return { ok: false, reason: 'Expected frontmatter changes were not verified after write.' };
    }

    return { ok: true, parsed: prepared.parsed };
}

export function formatAliasConflictMessage(conflicts: CanonicalAliasConflict[]): string {
    return conflicts
        .map(conflict => `${conflict.canonicalKey} (${conflict.keys.join(', ')})`)
        .join('; ');
}
