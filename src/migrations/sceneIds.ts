import { stringifyYaml } from 'obsidian';
import type RadialTimelinePlugin from '../main';
import { ensureSceneIdFrontmatter, isSceneClassFrontmatter, readSceneId } from '../utils/sceneIds';
import { buildFrontmatterDocument } from '../utils/frontmatterDocument';
import { resolveBookScopedMarkdownFiles } from '../services/NoteScopeResolver';
import {
    formatAliasConflictMessage,
    prepareFrontmatterRewrite,
    verifyFrontmatterRewrite,
} from '../utils/frontmatterWriteSafety';

export async function migrateSceneFrontmatterIds(plugin: RadialTimelinePlugin): Promise<number> {
    let migrated = 0;
    try {
        const scope = resolveBookScopedMarkdownFiles(plugin.app, plugin.settings);
        if (!scope.sourcePath) {
            return 0;
        }

        const files = scope.files;
        for (const file of files) {
            try {
                // Cheap pre-check on a cached snapshot to decide whether this
                // file needs work at all (avoids a no-op atomic write).
                const snapshot = await plugin.app.vault.cachedRead(file);
                const pre = prepareFrontmatterRewrite(snapshot);
                if (!pre) continue;
                if (pre.aliasConflicts.length > 0) {
                    console.warn('[Radial Timeline] Skipping scene id migration due to duplicate canonical aliases:', file.path, formatAliasConflictMessage(pre.aliasConflicts));
                    continue;
                }
                if (!isSceneClassFrontmatter(pre.parsed)) continue;
                if (readSceneId(pre.parsed)) continue;

                // Atomic read-modify-write. The frontmatter is re-parsed from
                // the authoritative content inside the callback so the body
                // written is never a stale copy, and verification runs on the
                // exact bytes about to be written — throwing aborts the write
                // entirely (no corrupt file can reach disk).
                let changed = false;
                await plugin.app.vault.process(file, (content) => {
                    const prepared = prepareFrontmatterRewrite(content);
                    if (!prepared) return content;
                    if (prepared.aliasConflicts.length > 0) {
                        throw new Error(`Refused rewrite due to duplicate canonical aliases: ${formatAliasConflictMessage(prepared.aliasConflicts)}`);
                    }
                    if (!isSceneClassFrontmatter(prepared.parsed)) return content;
                    if (readSceneId(prepared.parsed)) return content;

                    const normalized = ensureSceneIdFrontmatter(prepared.parsed);
                    const rebuiltYaml = stringifyYaml(normalized.frontmatter);
                    const updated = buildFrontmatterDocument(rebuiltYaml, prepared.body);
                    const verification = verifyFrontmatterRewrite(updated, {
                        originalBody: prepared.body,
                        verifyParsed: (verifiedFrontmatter) => readSceneId(verifiedFrontmatter) === normalized.sceneId
                    });
                    if (!verification.ok) {
                        throw new Error(verification.reason ?? 'Scene id migration verification failed.');
                    }
                    changed = true;
                    return updated;
                });
                if (changed) migrated++;
            } catch (error) {
                console.warn('[Radial Timeline] Scene id migration skipped:', file.path, error instanceof Error ? error.message : String(error));
                continue;
            }
        }
    } catch (error) {
        console.error('[Radial Timeline] Error during scene id migration:', error);
    }
    return migrated;
}
