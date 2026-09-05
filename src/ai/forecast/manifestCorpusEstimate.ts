/*
 * Radial Timeline Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 */

import { TFile, type MetadataCache, type Vault } from 'obsidian';
import type { CorpusManifestEntry } from '../../inquiry/runner/types';
import type { RTCorpusTokenEstimate } from '../types';
import { buildRTCorpusEstimateFromChars } from '../../inquiry/services/buildRTCorpusEstimate';
import { cleanEvidenceBody } from '../../inquiry/utils/evidenceCleaning';
import { extractSummary, normalizeFrontmatterKeys, type getActiveFrontmatterMappings } from '../../utils/frontmatter';

/**
 * The chars/4 corpus estimate for a manifest: summary entries measure the
 * normalised summary field, full entries the cleaned body. Missing files
 * still count toward the class totals but contribute no characters.
 */
export async function estimateCorpusFromManifestEntries(params: {
    vault: Vault;
    metadataCache: MetadataCache;
    frontmatterMappings: ReturnType<typeof getActiveFrontmatterMappings>;
    entries: CorpusManifestEntry[];
}): Promise<RTCorpusTokenEstimate> {
    const counts = { sceneCount: 0, outlineCount: 0, referenceCount: 0, sceneChars: 0, outlineChars: 0, referenceChars: 0 };
    for (const entry of params.entries) {
        const cls = entry.class === 'scene' ? 'scene' : entry.class === 'outline' ? 'outline' : 'reference';
        counts[`${cls}Count`] += 1;

        const file = params.vault.getAbstractFileByPath(entry.path);
        if (!(file instanceof TFile)) continue;

        let chars = 0;
        if (entry.mode === 'summary') {
            const rawFrontmatter = params.metadataCache.getFileCache(file)?.frontmatter;
            const frontmatter = rawFrontmatter ? normalizeFrontmatterKeys(rawFrontmatter, params.frontmatterMappings) : {};
            chars = extractSummary(frontmatter).length;
        } else if (entry.mode === 'full') {
            chars = cleanEvidenceBody(await params.vault.read(file)).length;
        }
        counts[`${cls}Chars`] += chars;
    }
    return buildRTCorpusEstimateFromChars(counts);
}
