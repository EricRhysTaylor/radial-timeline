import type { MetadataCache, Vault } from 'obsidian';
import { TFile } from 'obsidian';
import type { RTCorpusTokenBreakdown, RTCorpusTokenEstimate } from '../../ai/types';
import type { CorpusManifestEntry } from '../runner/types';
import { extractSummary, normalizeFrontmatterKeys } from '../../utils/frontmatter';
import { cleanEvidenceBody } from '../utils/evidenceCleaning';
import { estimateTokensFromChars } from '../../ai/estimates';

type BuildExactCorpusEstimateParams = {
    entries: CorpusManifestEntry[];
    vault: Vault;
    metadataCache: MetadataCache;
    frontmatterMappings?: Record<string, string>;
};

const toBreakdown = (
    sceneChars: number,
    outlineChars: number,
    referenceChars: number
): RTCorpusTokenBreakdown => ({
    scenesTokens: estimateTokensFromChars(sceneChars),
    outlineTokens: estimateTokensFromChars(outlineChars),
    referenceTokens: estimateTokensFromChars(referenceChars)
});

function isTFile(file: unknown): file is TFile {
    return file instanceof TFile;
}

function normalizeMode(mode?: CorpusManifestEntry['mode']): 'excluded' | 'summary' | 'full' {
    if (mode === 'summary') return 'summary';
    if (mode === 'full') return 'full';
    return 'excluded';
}

function countEntries(entries: CorpusManifestEntry[]): {
    sceneCount: number;
    outlineCount: number;
    referenceCount: number;
} {
    let sceneCount = 0;
    let outlineCount = 0;
    let referenceCount = 0;
    entries.forEach(entry => {
        if (normalizeMode(entry.mode) === 'excluded') return;
        if (entry.class === 'scene') {
            sceneCount += 1;
        } else if (entry.class === 'outline') {
            outlineCount += 1;
        } else {
            referenceCount += 1;
        }
    });
    return { sceneCount, outlineCount, referenceCount };
}

export function buildPendingCorpusEstimateFromManifestEntries(
    entries: CorpusManifestEntry[]
): RTCorpusTokenEstimate {
    const counts = countEntries(entries);
    return {
        sceneCount: counts.sceneCount,
        outlineCount: counts.outlineCount,
        referenceCount: counts.referenceCount,
        evidenceChars: 0,
        estimatedTokens: 0,
        method: 'rt_pending',
        breakdown: {
            scenesTokens: 0,
            outlineTokens: 0,
            referenceTokens: 0
        }
    };
}

export async function buildExactCorpusEstimateFromManifestEntries(
    params: BuildExactCorpusEstimateParams
): Promise<RTCorpusTokenEstimate> {
    let sceneChars = 0;
    let outlineChars = 0;
    let referenceChars = 0;
    const counts = countEntries(params.entries);

    for (const entry of params.entries) {
        const mode = normalizeMode(entry.mode);
        if (mode === 'excluded') continue;

        const file = params.vault.getAbstractFileByPath(entry.path);
        if (!isTFile(file)) continue;

        let chars = 0;
        if (mode === 'summary') {
            const cache = params.metadataCache.getFileCache(file);
            const rawFrontmatter = cache?.frontmatter;
            const frontmatter = rawFrontmatter
                ? normalizeFrontmatterKeys(rawFrontmatter, params.frontmatterMappings)
                : {};
            chars = extractSummary(frontmatter).length;
        } else if (mode === 'full') {
            const raw = await params.vault.cachedRead(file);
            chars = cleanEvidenceBody(raw).length;
        }

        if (entry.class === 'scene') {
            sceneChars += chars;
        } else if (entry.class === 'outline') {
            outlineChars += chars;
        } else {
            referenceChars += chars;
        }
    }

    const breakdown = toBreakdown(sceneChars, outlineChars, referenceChars);
    return {
        sceneCount: counts.sceneCount,
        outlineCount: counts.outlineCount,
        referenceCount: counts.referenceCount,
        evidenceChars: sceneChars + outlineChars + referenceChars,
        estimatedTokens: breakdown.scenesTokens + breakdown.outlineTokens + breakdown.referenceTokens,
        method: 'rt_cleaned_corpus_exact',
        breakdown
    };
}
