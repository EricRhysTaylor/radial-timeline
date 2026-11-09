import { TFile, type MetadataCache, type Vault } from 'obsidian';
import type { InquirySourcesSettings } from '../types/settings';
import { readSampleVaultManifest } from '../utils/sampleVault';
import type { InquiryScope } from './state';

/** Use the imported manifest as the authority, including for previously imported editions. */
export function isImportedStoryBook(vault: Vault, cache: MetadataCache, scope: InquiryScope, book?: string): boolean {
    if (scope !== 'book' || !book) return false;
    const parts = book.split('/');
    if (parts.length < 3 || parts[0] !== 'Demo Projects' || !parts[1]) return false;
    const manifest = vault.getAbstractFileByPath(`Demo Projects/${parts[1]}/Sample Vault Config.md`);
    if (!(manifest instanceof TFile)) return false;
    const frontmatter = cache.getFileCache(manifest)?.frontmatter;
    if (!frontmatter) return false;
    try {
        const sample = readSampleVaultManifest(frontmatter);
        return !!sample?.books?.some(entry => entry.sourceFolder === book);
    } catch {
        return false;
    }
}

/** A temporary book-scoped view; never write these defaults to the author's settings. */
export function storyBookInquirySources(sources: InquirySourcesSettings): InquirySourcesSettings {
    const scene = sources.classes?.find(config => config.className === 'scene');
    const classScope = sources.classScope || [];
    return {
        ...sources,
        classScope: classScope.includes('/') || classScope.includes('scene') ? classScope : [...classScope, 'scene'],
        classes: [
            ...(sources.classes || []).filter(config => config.className !== 'scene'),
            {
                className: 'scene',
                enabled: true,
                bookScope: scene?.enabled && scene.bookScope !== 'excluded' ? scene.bookScope : 'full',
                sagaScope: scene?.sagaScope ?? 'excluded',
                referenceScope: 'excluded'
            }
        ]
    };
}
