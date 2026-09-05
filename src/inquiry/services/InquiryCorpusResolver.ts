import { MetadataCache, TFile, Vault } from 'obsidian';
import type { InquiryScope } from '../state';
import type { BookProfile, InquiryClassConfig, InquirySourcesSettings } from '../../types/settings';
import { normalizeFrontmatterKeys } from '../../utils/frontmatter';
import { getScenePrefixNumber } from '../../utils/text';
import { readSceneId } from '../../utils/sceneIds';
import { resolveBookManagerInquiryBooks } from './bookResolution';
import { resolveInquirySourceRoots } from '../utils/sourceRoots';
import { buildInquiryBookAnchorId } from './canonicalInquiryCorpus';

export type InquiryCorpusItem = {
    id: string;
    displayLabel: string;
    filePaths: string[];
    sceneId?: string;
    hasSynopsis?: boolean;
};

export type InquiryBookItem = InquiryCorpusItem & {
    rootPath: string;
    bookNumber?: number;
};

export type InquirySceneItem = InquiryCorpusItem & {
    bookId: string;
    filePath: string;
    sceneNumber?: number;
};

export type InquiryCorpusSnapshot = {
    scope: InquiryScope;
    resolvedRoots: string[];
    books: InquiryBookItem[];
    scenes: InquirySceneItem[];
    activeBookId?: string;
    /** True when book scope has at least one resolved book, or when scope is not 'book'. */
    bookResolved: boolean;
};

export type InquiryCorpusResolveParams = {
    scope: InquiryScope;
    activeBookId?: string;
    sources: InquirySourcesSettings;
    bookProfiles?: BookProfile[];
};

export class InquiryCorpusResolver {
    private vault: Vault;
    private metadataCache: MetadataCache;
    private frontmatterMappings?: Record<string, string>;

    constructor(vault: Vault, metadataCache: MetadataCache, frontmatterMappings?: Record<string, string>) {
        this.vault = vault;
        this.metadataCache = metadataCache;
        this.frontmatterMappings = frontmatterMappings;
    }

    resolve(params: InquiryCorpusResolveParams): InquiryCorpusSnapshot {
        const sources = params.sources;
        const classScope = this.getClassScopeConfig(sources.classScope);
        if (!classScope.allowAll && classScope.allowed.size === 0) {
            return {
                scope: params.scope,
                resolvedRoots: [],
                books: [],
                scenes: [],
                activeBookId: undefined,
                bookResolved: params.scope !== 'book'
            };
        }

        const rootResolution = resolveInquirySourceRoots(this.vault, sources, params.bookProfiles);
        const { resolvedRoots, resolvedVaultRoots } = rootResolution;
        const bookResolution = resolveBookManagerInquiryBooks(params.bookProfiles);

        const books = this.buildBookItems(bookResolution.includedBooks.map(book => ({
            rootPath: book.rootPath,
            bookNumber: book.bookNumber
        })));
        const activeBookId = this.getActiveBookId(books, params.activeBookId);
        const scenes = params.scope === 'book' && activeBookId
            ? this.buildSceneItems(activeBookId, resolvedVaultRoots, sources.classes || [], classScope)
            : [];

        return {
            scope: params.scope,
            resolvedRoots,
            books,
            scenes,
            activeBookId,
            bookResolved: params.scope !== 'book' || books.length > 0
        };
    }

    private buildBookItems(books: Array<{ rootPath: string; bookNumber?: number }>): InquiryBookItem[] {
        return books
            .sort((a, b) => {
                const numA = a.bookNumber ?? Number.POSITIVE_INFINITY;
                const numB = b.bookNumber ?? Number.POSITIVE_INFINITY;
                if (numA !== numB) return numA - numB;
                return a.rootPath.localeCompare(b.rootPath);
            })
            .map((book, index) => ({
                id: book.rootPath,
                rootPath: book.rootPath,
                filePaths: [book.rootPath],
                sceneId: buildInquiryBookAnchorId(book.rootPath),
                displayLabel: `B${this.clampLabelNumber(book.bookNumber ?? index + 1)}`,
                bookNumber: book.bookNumber
            }));
    }

    private buildSceneItems(
        bookId: string,
        resolvedVaultRoots: string[],
        classConfigs: InquiryClassConfig[],
        classScope: { allowAll: boolean; allowed: Set<string> }
    ): InquirySceneItem[] {
        const classConfig = classConfigs.find(cfg => cfg.className === 'scene');
        if (!classConfig || !classConfig.enabled || classConfig.bookScope === 'excluded') return [];
        if (!classScope.allowAll && !classScope.allowed.has('scene')) return [];

        const inRoots = (path: string): boolean => {
            return resolvedVaultRoots.some(root => !root || path === root || path.startsWith(`${root}/`));
        };

        const isInBook = (path: string): boolean => {
            return path === bookId || path.startsWith(`${bookId}/`);
        };

        const files = this.vault.getMarkdownFiles();
        const scenes: InquirySceneItem[] = [];

        files.forEach(file => {
            if (!inRoots(file.path)) return;
            if (!isInBook(file.path)) return;
            const frontmatter = this.getFrontmatter(file);
            if (!frontmatter) return;
            const classValues = this.extractClassValues(frontmatter);
            if (!classValues.includes('scene')) return;
            const sceneNumber = this.getSceneNumber(file.basename);
            const hasSynopsis = this.hasSynopsis(frontmatter);
            const sceneId = readSceneId(frontmatter);
            const stableId = sceneId && sceneId.trim().length > 0 ? sceneId.trim() : file.path;
            scenes.push({
                id: stableId,
                bookId,
                filePath: file.path,
                filePaths: [file.path],
                displayLabel: '',
                sceneId,
                sceneNumber,
                hasSynopsis
            });
        });

        scenes.sort((a, b) => {
            const numA = a.sceneNumber ?? Number.POSITIVE_INFINITY;
            const numB = b.sceneNumber ?? Number.POSITIVE_INFINITY;
            if (numA !== numB) return numA - numB;
            return a.filePath.localeCompare(b.filePath);
        });

        return scenes.map((scene, index) => ({
            ...scene,
            displayLabel: `S${this.clampLabelNumber(scene.sceneNumber ?? index + 1)}`
        }));
    }

    private getActiveBookId(books: InquiryBookItem[], activeBookId?: string): string | undefined {
        if (!books.length) return undefined;
        if (activeBookId && books.some(book => book.id === activeBookId)) return activeBookId;
        return books[0].id;
    }

    private getFrontmatter(file: TFile): Record<string, unknown> | null {
        const cache = this.metadataCache.getFileCache(file);
        const frontmatter = cache?.frontmatter;
        if (!frontmatter) return null;
        return normalizeFrontmatterKeys(frontmatter, this.frontmatterMappings);
    }

    private extractClassValues(frontmatter: Record<string, unknown>): string[] {
        const rawClass = frontmatter['Class'];
        const values = Array.isArray(rawClass) ? rawClass : rawClass ? [rawClass] : [];
        return values
            .map(value => (typeof value === 'string' ? value : String(value)).trim())
            .filter(Boolean)
            .map(value => value.toLowerCase());
    }

    private getSceneNumber(title?: string): number | undefined {
        const prefix = getScenePrefixNumber(title ?? '', undefined);
        if (!prefix) return undefined;
        const parsed = Number(prefix);
        if (!Number.isFinite(parsed)) return undefined;
        return Math.max(1, Math.floor(parsed));
    }

    private getClassScopeConfig(raw?: string[]): { allowAll: boolean; allowed: Set<string> } {
        const list = (raw || []).map(entry => entry.trim().toLowerCase()).filter(Boolean);
        const allowAll = list.includes('/');
        const allowed = new Set(list.filter(entry => entry !== '/'));
        return { allowAll, allowed };
    }

    /**
     * Returns true when frontmatter["Summary"] exists.
     * Synopsis is not used by Inquiry.
     * Legacy name kept for type compatibility with InquiryCorpusItem.hasSynopsis.
     */
    private hasSynopsis(frontmatter: Record<string, unknown>): boolean {
        const value = frontmatter['Summary'];
        if (Array.isArray(value)) return value.length > 0;
        if (typeof value === 'string') return value.trim().length > 0;
        return !!value;
    }

    /** Alias for hasSynopsis — prefer in new code to prevent semantic drift. */
    private hasSummary(frontmatter: Record<string, unknown>): boolean {
        return this.hasSynopsis(frontmatter);
    }

    private clampLabelNumber(value: number): number {
        if (!Number.isFinite(value)) return 1;
        return Math.min(Math.max(Math.floor(value), 1), 999);
    }
}
