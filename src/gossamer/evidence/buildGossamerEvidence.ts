import type { MetadataCache, TFile, Vault } from 'obsidian';
import { normalizeFrontmatterKeys } from '../../utils/frontmatter';
import { readSceneId, resolveSceneReferenceId } from '../../utils/sceneIds';
import { cleanEvidenceBody } from '../../inquiry/utils/evidenceCleaning';
import { countWords } from '../../utils/text';

export interface GossamerEvidenceDocument {
    text: string;
    totalScenes: number;
    includedScenes: number;
    totalWords: number;
}

interface SceneEvidenceEntry {
    title: string;
    sceneId: string;
    content: string;
}

const getNormalizedFrontmatter = (
    metadataCache: MetadataCache,
    file: TFile,
    frontmatterMappings?: Record<string, string>
): Record<string, unknown> => {
    const cache = metadataCache.getFileCache(file);
    const frontmatter = cache?.frontmatter;
    if (!frontmatter) return {};
    return normalizeFrontmatterKeys(frontmatter, frontmatterMappings);
};

/**
 * Build a Gossamer evidence document from scene bodies.
 * Always reads full scene body content — no summary mode.
 */
export async function buildGossamerEvidenceDocument(params: {
    sceneFiles: TFile[];
    vault: Vault;
    metadataCache: MetadataCache;
    frontmatterMappings?: Record<string, string>;
}): Promise<GossamerEvidenceDocument> {
    const entries: SceneEvidenceEntry[] = [];
    for (const sceneFile of params.sceneFiles) {
        const frontmatter = getNormalizedFrontmatter(params.metadataCache, sceneFile, params.frontmatterMappings);
        const sceneId = resolveSceneReferenceId(readSceneId(frontmatter) ?? undefined, sceneFile.path);

        const raw = await params.vault.read(sceneFile);
        const content = cleanEvidenceBody(raw);

        if (!content) continue;
        entries.push({
            title: sceneFile.basename,
            sceneId,
            content
        });
    }

    if (!entries.length) {
        return {
            text: 'No scene body content available.',
            totalScenes: params.sceneFiles.length,
            includedScenes: 0,
            totalWords: 0
        };
    }

    const tocLines = [
        '# TABLE OF CONTENTS',
        '',
        `Total Scenes: ${entries.length}`,
        'Evidence: Bodies',
        '',
        '---',
        ''
    ];
    // Scene titles already carry their own narrative-order prefix (e.g. "1 Opening",
    // "10 Breakfast"). No outer enumeration — a second "${index + 1}." in front
    // only doubles the numbering and adds noise for the LLM.
    entries.forEach((entry) => {
        tocLines.push(`${entry.title} (${entry.sceneId})`);
    });
    tocLines.push('', '---', '');

    const sceneSections = entries.map((entry) =>
        `## ${entry.title} (${entry.sceneId})\n\n${entry.content}`
    );
    const text = `${tocLines.join('\n')}\n${sceneSections.join('\n\n')}\n`;
    const totalWords = entries.reduce((sum, entry) => sum + countWords(entry.content), 0);

    return {
        text,
        totalScenes: params.sceneFiles.length,
        includedScenes: entries.length,
        totalWords
    };
}
