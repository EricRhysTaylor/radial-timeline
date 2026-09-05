/**
 * Sources ViewModel builder for Inquiry results.
 *
 * Transforms normalized Inquiry attribution + optional evidence metadata into
 * a UI-ready data structure for rendering the author-facing "Sources" block.
 *
 * Product rule: the output is author-centric. No provider payload internals:
 * render scene titles/paths for manuscript citations and clear labels for
 * tool/URL/grounded attribution.
 */
import type { EvidenceDocumentMeta, InquiryCitation, InquiryFinding } from '../state';

// ── Types ──────────────────────────────────────────────────────────────────

export interface InquirySourceItem {
    /** Normalized attribution family for truthful rendering. */
    attributionType: 'direct_manuscript' | 'tool_file' | 'tool_url' | 'grounded' | 'scene_anchor';
    /** Display title (e.g. "The Departure"). */
    title: string;
    /** Short excerpt from cited text (1–2 lines, truncated). */
    excerpt: string;
    /** Vault-relative file path for "Open scene" navigation. */
    path?: string;
    /** Scene ID, if a scene document. */
    sceneId?: string;
    /** Display label for evidence class (e.g. "Scene", "Outline"). */
    classLabel: string;
    /** Number of citations referencing this document. */
    citationCount: number;
    /** External source URL when attribution points outside the manuscript. */
    url?: string;
}

export interface InquirySourcesViewModel {
    /** Source items, deduplicated by document and ordered by citation count descending. */
    items: InquirySourceItem[];
    /** Total number of source documents referenced. */
    totalCount: number;
    /** Number to show initially (max 2). */
    initialCount: number;
    /** Whether the Sources block should render at all. */
    hasContent: boolean;
}

// ── Constants ──────────────────────────────────────────────────────────────

/**
 * Cap for synthesized commentary excerpts (scene_anchor fallback) and external-tool
 * source labels. Real manuscript citations (Anthropic-style cited_text) render at
 * full length — they are verbatim quotes from the source documents and the author
 * needs the whole span to evaluate the model's claim.
 */
const MAX_EXCERPT_LENGTH = 600;
const INITIAL_SHOW_COUNT = 2;

// ── Builder ────────────────────────────────────────────────────────────────

/**
 * Build a Sources ViewModel from Inquiry citations and evidence metadata.
 *
 * Returns `{ hasContent: false }` when there is nothing to render (no citations,
 * no metadata, or no resolvable documents).
 */
export function buildInquirySourcesViewModel(
    citations: InquiryCitation[] | undefined,
    evidenceDocumentMeta: EvidenceDocumentMeta[] | undefined,
    findings?: InquiryFinding[]
): InquirySourcesViewModel {
    const empty: InquirySourcesViewModel = {
        items: [],
        totalCount: 0,
        initialCount: 0,
        hasContent: false
    };

    const items: InquirySourceItem[] = [];
    const normalizedCitations = citations ?? [];
    if (!normalizedCitations.length && !findings?.length) return empty;

    // Direct manuscript citations remain grouped by evidence document index.
    if (normalizedCitations.length && evidenceDocumentMeta?.length) {
        const byIndex = new Map<number, InquiryCitation[]>();
        for (const citation of normalizedCitations) {
            if (!isDirectManuscriptCitation(citation)) continue;
            if (citation.documentIndex < 0 || citation.documentIndex >= evidenceDocumentMeta.length) continue;
            const existing = byIndex.get(citation.documentIndex) ?? [];
            existing.push(citation);
            byIndex.set(citation.documentIndex, existing);
        }

        for (const [docIndex, docCitations] of byIndex) {
            const meta = evidenceDocumentMeta[docIndex];
            if (!meta) continue;
            // Real manuscript quotes (Anthropic cited_text) render full — no truncation.
            const excerpt = bestQuoteFull(docCitations);
            items.push({
                attributionType: 'direct_manuscript',
                title: meta.title,
                excerpt,
                path: meta.path,
                sceneId: meta.sceneId,
                classLabel: formatEvidenceClassLabel(meta.evidenceClass),
                citationCount: docCitations.length
            });
        }
    }

    // OpenAI/Gemini-style tool/grounded attribution groups by source identity.
    const externalCitations = normalizedCitations.filter(isExternalAttributionCitation);
    if (externalCitations.length) {
        const bySource = new Map<string, typeof externalCitations>();
        for (const citation of externalCitations) {
            const key = [
                citation.attributionType,
                citation.sourceId ?? '',
                citation.url ?? '',
                citation.fileId ?? '',
                citation.filename ?? '',
                citation.sourceLabel
            ].join('|');
            const existing = bySource.get(key) ?? [];
            existing.push(citation);
            bySource.set(key, existing);
        }

        for (const grouped of bySource.values()) {
            const first = grouped[0];
            const excerpt = bestExcerpt(grouped);
            items.push({
                attributionType: first.attributionType,
                title: first.sourceLabel,
                excerpt,
                classLabel: formatAttributionClassLabel(first.attributionType),
                citationCount: grouped.length,
                url: first.url
            });
        }
    }

    // Scene-anchor fallback: when the provider returns no inline citations
    // (Anthropic strict-JSON tool_use cannot attach inline citations to tool
    // input), surface the per-finding `evidence_quote` the model emitted as
    // the verbatim source span.
    //
    // Sources is for verifiable quotes, not commentary. A finding without an
    // `evidence_quote` is not a citation — it is the AI's analysis of the
    // scene. We drop those entries entirely rather than render a misleading
    // "1 citation" pill with no quoted text. The finding still appears in the
    // per-scene notes section; only the Sources block enforces "show me what
    // the AI is grounding its claim on."
    if (!items.length && evidenceDocumentMeta?.length && findings?.length) {
        const byScene = new Map<string, { meta: EvidenceDocumentMeta; findings: InquiryFinding[] }>();
        for (const finding of findings) {
            const refId = finding.refId?.trim();
            if (!refId) continue;
            const quote = (finding.evidenceQuote ?? '').trim();
            if (!quote) continue;
            const meta = evidenceDocumentMeta.find(doc => doc.sceneId?.trim() === refId);
            if (!meta) continue;
            const key = `${meta.sceneId ?? ''}|${meta.path ?? ''}|${meta.title}`;
            const existing = byScene.get(key);
            if (existing) {
                existing.findings.push(finding);
                continue;
            }
            byScene.set(key, { meta, findings: [finding] });
        }

        for (const grouped of byScene.values()) {
            const quote = pickEvidenceQuote(grouped.findings);
            if (!quote) continue;
            items.push({
                attributionType: 'scene_anchor',
                title: grouped.meta.title,
                excerpt: quote,
                path: grouped.meta.path,
                sceneId: grouped.meta.sceneId,
                classLabel: 'Scene',
                citationCount: grouped.findings.length
            });
        }
    }

    // Sort: most-cited first, then alphabetically by title.
    items.sort((a, b) => b.citationCount - a.citationCount || a.title.localeCompare(b.title));

    return {
        items,
        totalCount: items.length,
        initialCount: Math.min(INITIAL_SHOW_COUNT, items.length),
        hasContent: items.length > 0
    };
}

function isDirectManuscriptCitation(citation: InquiryCitation): citation is Extract<InquiryCitation, { documentIndex: number }> {
    return citation.attributionType === undefined
        || citation.attributionType === 'direct_manuscript';
}

function isExternalAttributionCitation(citation: InquiryCitation): citation is Extract<InquiryCitation, { attributionType: 'tool_file' | 'tool_url' | 'grounded' }> {
    return citation.attributionType === 'tool_file'
        || citation.attributionType === 'tool_url'
        || citation.attributionType === 'grounded';
}

function bestExcerpt(citations: Array<{ citedText?: string }>): string {
    const best = citations
        .filter(citation => citation.citedText?.trim())
        .sort((a, b) => (b.citedText?.length ?? 0) - (a.citedText?.length ?? 0))[0];
    return truncateExcerpt(best?.citedText ?? '', MAX_EXCERPT_LENGTH);
}

/**
 * Pick the best citation and return the full cited text without truncation.
 * Used for direct manuscript citations — real verbatim quotes deserve full display.
 */
function bestQuoteFull(citations: Array<{ citedText?: string }>): string {
    const best = citations
        .filter(citation => citation.citedText?.trim())
        .sort((a, b) => (b.citedText?.length ?? 0) - (a.citedText?.length ?? 0))[0];
    return (best?.citedText ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * Pick the longest non-empty evidence_quote from a group of findings on the
 * same scene. Returns empty string when no finding emitted a quote — callers
 * should render the source without an excerpt rather than fake one.
 */
function pickEvidenceQuote(findings: InquiryFinding[]): string {
    const quotes = findings
        .map(finding => (finding.evidenceQuote ?? '').trim())
        .filter(Boolean)
        .sort((a, b) => b.length - a.length);
    return (quotes[0] ?? '').replace(/\s+/g, ' ').trim();
}

// ── Helpers ────────────────────────────────────────────────────────────────

/** Truncate excerpt to maxLength, breaking at a word boundary, and append ellipsis. */
function truncateExcerpt(text: string, maxLength: number): string {
    const cleaned = text.replace(/\s+/g, ' ').trim();
    if (cleaned.length <= maxLength) return cleaned;
    const truncated = cleaned.substring(0, maxLength);
    const lastSpace = truncated.lastIndexOf(' ');
    return (lastSpace > maxLength * 0.6 ? truncated.substring(0, lastSpace) : truncated) + '\u2026';
}

/** Capitalize evidence class for display (e.g. "scene" → "Scene"). */
function formatEvidenceClassLabel(evidenceClass: string): string {
    if (!evidenceClass) return 'Reference';
    // Already formatted classes (from formatClassLabel in runner) pass through cleanly.
    if (evidenceClass.charAt(0) === evidenceClass.charAt(0).toUpperCase()) return evidenceClass;
    return evidenceClass
        .replace(/[_-]+/g, ' ')
        .trim()
        .split(/\s+/)
        .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join(' ');
}

function formatAttributionClassLabel(attributionType: InquirySourceItem['attributionType']): string {
    if (attributionType === 'tool_file') return 'Tool File';
    if (attributionType === 'tool_url') return 'Tool URL';
    if (attributionType === 'grounded') return 'Grounded Source';
    if (attributionType === 'scene_anchor') return 'Scene';
    return 'Reference';
}
