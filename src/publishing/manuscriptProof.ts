import { createHash } from 'crypto'; // SAFE: local proof fingerprints; no credentials or network access.
import { promises as fs } from 'fs'; // SAFE: hash the local LaTeX template used by the renderer.
import type RadialTimelinePlugin from '../main';
import type { ManuscriptModalResult } from '../modals/ManuscriptOptionsModal';
import { getActiveBook } from '../utils/books';
import { hasProFeatureAccess } from '../settings/featureGate';

export interface ManuscriptProofDependency {
    kind: 'vault' | 'file';
    path: string;
    sha256: string;
}

export interface ManuscriptProofReceipt {
    schemaVersion: 1;
    generatedAt: string;
    styleName: string;
    notices: string[];
    configurationKey: string;
    dependencies: ManuscriptProofDependency[];
    renderedPaths: string[];
    sourceWordCounts: Record<string, number>;
    /** New RT scenes inside this folder also invalidate a book proof's selection. */
    bookSourceFolder?: string;
}

export function hashProofInput(content: string | Uint8Array): string {
    return createHash('sha256').update(content).digest('hex');
}

/** Only renderer inputs: unrelated preferences and credentials do not invalidate a proof. */
export function getManuscriptProofConfigurationKey(plugin: RadialTimelinePlugin, result: ManuscriptModalResult): string {
    const { intent: _intent, updateWordCounts: _words, saveMarkdownArtifact: _artifact, ...request } = result;
    const source = result.source;
    const book = source ? source.kind === 'book' ? plugin.settings.books.find(book => book.id === source.bookId) : undefined : getActiveBook(plugin.settings);
    const metadata = source && source.kind !== 'book'
        ? { title: source.title, author: source.author }
        : book ? plugin.getPublishingValidationService().resolveBookMetaForBook(book.sourceFolder).bookMeta : null;
    return hashProofInput(JSON.stringify({
        request, book, metadata,
        layouts: plugin.settings.pandocLayouts,
        pandocPath: plugin.settings.pandocPath,
        outputFolder: plugin.settings.manuscriptOutputFolder,
        bindingGutter: plugin.settings.pdfBindingGutter,
        customMetadata: plugin.settings.customPandocMetadata,
        preamble: plugin.settings.customLatexPreamble,
        proAccess: hasProFeatureAccess(plugin),
    }));
}

/** Recheck actual bytes, not mtime or a ready-looking UI. A failed check is explicitly stale. */
export async function getManuscriptProofStaleReason(plugin: RadialTimelinePlugin, receipt: ManuscriptProofReceipt, result: ManuscriptModalResult): Promise<string | null> {
    if (getManuscriptProofConfigurationKey(plugin, result) !== receipt.configurationKey) return 'Export settings or publishing details changed.';
    for (const dependency of receipt.dependencies) {
        try {
            const bytes = dependency.kind === 'vault'
                ? new Uint8Array(await plugin.app.vault.adapter.readBinary(dependency.path)) // SAFE: proof byte reads and sidecar writes use exact local job paths, including PDFs not yet indexed by Obsidian.
                : await fs.readFile(dependency.path);
            if (hashProofInput(bytes) !== dependency.sha256) return 'Manuscript content, an embedded asset, or the PDF style changed.';
        } catch {
            return `A proof input is unavailable: ${dependency.path}`;
        }
    }
    return null;
}
