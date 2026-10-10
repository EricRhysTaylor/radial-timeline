import type { ManuscriptExportCleanupOptions } from '../types';
import { MARKDOWN_FENCE_OPEN_PATTERN as CODE_FENCE_PATTERN, isClosingMarkdownFence as isClosingFence } from './markdownFence';

export type ManuscriptCleanupFormat = 'markdown' | 'pdf';

/**
 * Single source of truth for which cleanup posture an output format gets.
 * PDF and DOCX are reader-facing (strip comments/links/callouts by default);
 * markdown is the review-handoff path and keeps them. Accepts a plain string
 * so settings-layer unions and ExportFormat both flow through without casts.
 */
export function cleanupFormatForOutputFormat(outputFormat: string | undefined): ManuscriptCleanupFormat {
    return outputFormat === 'pdf' || outputFormat === 'docx' ? 'pdf' : 'markdown';
}

const MARKDOWN_CLEANUP_DEFAULTS: ManuscriptExportCleanupOptions = {
    stripComments: false,
    stripAiComments: false,
    stripLinks: false,
    stripCallouts: false,
    stripBlockIds: false
};

const PDF_CLEANUP_DEFAULTS: ManuscriptExportCleanupOptions = {
    stripComments: true,
    // PDF is reader-facing output, so author queries are stripped by default
    // here (markdown — the review handoff path — retains them by default).
    stripAiComments: true,
    stripLinks: true,
    stripCallouts: true,
    stripBlockIds: false
};

const YAML_KEY_PATTERN = /^\s*[A-Za-z0-9_"'.-]+\s*:/;
const EDITORIALIST_REVIEW_FENCE_PATTERN = /^\s*(`{3,}|~{3,})\s*editorialist-review\b.*$/i;
const EDITORIALIST_REVIEW_WRAPPER_LINE = /^Return only this fenced block\. No extra text\.\s*$/i;

function normalizeLineEndings(text: string): string {
    return text.replace(/\r\n?/g, '\n');
}

function stripYamlFrontmatterBlocks(content: string): string {
    const lines = content.split('\n');
    const output: string[] = [];
    let codeFence: string | null = null;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        if (codeFence !== null) {
            if (isClosingFence(line, codeFence)) codeFence = null;
            output.push(line);
            continue;
        }

        const fenceMatch = line.match(CODE_FENCE_PATTERN);
        if (fenceMatch) {
            codeFence = fenceMatch[1];
            output.push(line);
            continue;
        }

        if (line.trim() !== '---') {
            output.push(line);
            continue;
        }

        let end = i + 1;
        while (end < lines.length && lines[end].trim() !== '---') {
            end += 1;
        }

        if (end >= lines.length) {
            output.push(line);
            continue;
        }

        const candidate = lines.slice(i + 1, end);
        const hasYamlKeys = candidate.some(candidateLine => YAML_KEY_PATTERN.test(candidateLine));
        const hasCodeFence = candidate.some(candidateLine => CODE_FENCE_PATTERN.test(candidateLine));
        if (!hasYamlKeys || hasCodeFence) {
            output.push(line);
            continue;
        }

        i = end;
        if (i + 1 < lines.length && lines[i + 1].trim() === '') {
            i += 1;
        }
    }

    return output.join('\n');
}

// Obsidian comments pair `%%` delimiters left to right. Both comment strippers
// walk these pairs and then classify each one, so a stray closing `%%` can
// never be read as the opener of the next comment.
const OBSIDIAN_COMMENT_PATTERN = /%%[\s\S]*?%%/g;

// Editorialist author queries: `%%query: <question>%%`, plus the legacy
// `%%ai: <question>%%` spelling that manuscripts written before the rename
// still carry. Matched case-insensitively and tolerant of whitespace,
// mirroring Editorialist's own extractor.
const AUTHOR_QUERY_PREFIX_PATTERN = /^%%\s*(?:query|ai)\s*:/i;

function stripComments(content: string): string {
    return content
        // Generic comment strip deliberately spares author queries so they are
        // governed only by the stripAiComments toggle.
        .replace(OBSIDIAN_COMMENT_PATTERN, comment => AUTHOR_QUERY_PREFIX_PATTERN.test(comment) ? comment : '')
        .replace(/<!--[\s\S]*?-->/g, '');
}

function stripAuthorQueries(content: string): string {
    return content.replace(OBSIDIAN_COMMENT_PATTERN, comment => AUTHOR_QUERY_PREFIX_PATTERN.test(comment) ? '' : comment);
}

export function stripEditorialistReviewBlocks(content: string): string {
    const lines = content.split('\n');
    const output: string[] = [];
    let codeFence: string | null = null;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (codeFence !== null) {
            if (isClosingFence(line, codeFence)) codeFence = null;
            output.push(line);
            continue;
        }
        const fenceMatch = line.match(EDITORIALIST_REVIEW_FENCE_PATTERN);
        if (!fenceMatch) {
            const ordinaryFence = line.match(CODE_FENCE_PATTERN);
            if (ordinaryFence) codeFence = ordinaryFence[1];
            output.push(line);
            continue;
        }

        if (output.length > 0 && output[output.length - 1].trim() === '') {
            const wrapperIndex = output.length - 2;
            if (wrapperIndex >= 0 && EDITORIALIST_REVIEW_WRAPPER_LINE.test(output[wrapperIndex])) {
                output.pop();
                output.pop();
            }
        } else if (output.length > 0 && EDITORIALIST_REVIEW_WRAPPER_LINE.test(output[output.length - 1])) {
            output.pop();
        }

        const fence = fenceMatch[1];

        i += 1;
        while (i < lines.length && !isClosingFence(lines[i], fence)) {
            i += 1;
        }

        while (i + 1 < lines.length && lines[i + 1].trim() === '') {
            i += 1;
        }
    }

    return output.join('\n');
}

function extractWikilinkLabel(inner: string): string {
    const [targetRaw, aliasRaw] = inner.split('|', 2);
    const alias = aliasRaw?.trim();
    if (alias) return alias;

    const target = (targetRaw || '').trim();
    if (!target) return '';

    const hashIndex = target.lastIndexOf('#');
    const targetWithoutAnchor = hashIndex >= 0 ? target.slice(0, hashIndex) : target;
    const anchor = hashIndex >= 0 ? target.slice(hashIndex + 1) : '';
    const displaySource = anchor || targetWithoutAnchor;
    const pathParts = displaySource.split('/');
    return (pathParts[pathParts.length - 1] || displaySource).trim();
}

function stripLinks(content: string): string {
    const withoutMarkdownLinks = content.replace(/!?\[([^\]]+)\]\((?:\\.|[^)\n\\])+\)/g, (_match, label: string) => label);
    return withoutMarkdownLinks.replace(/!?\[\[([^\]]+)\]\]/g, (_match, inner: string) => extractWikilinkLabel(inner));
}

function stripCallouts(content: string): string {
    const lines = content.split('\n');
    const output: string[] = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!/^\s*>\s*\[![^\]]+\]/i.test(line)) {
            output.push(line);
            continue;
        }

        i += 1;
        while (i < lines.length && /^\s*>/.test(lines[i])) {
            i += 1;
        }
        while (i < lines.length && lines[i].trim() === '') {
            i += 1;
        }
        i -= 1;
    }

    return output.join('\n');
}

function stripBlockIds(content: string): string {
    const withoutInline = content.replace(/[ \t]+\^[A-Za-z0-9][A-Za-z0-9_-]*(?=\s*$)/gm, '');
    return withoutInline.replace(/^\^[A-Za-z0-9][A-Za-z0-9_-]*\s*$/gm, '');
}

function stripTaskListMarkers(content: string): string {
    return content.replace(/^(\s{0,3}(?:[-+*]|\d+[.)])\s+)\[[ xX]\]\s+/gm, '$1');
}

// ── Protected-segment masking ────────────────────────────────────────────────
// The opt-in strippers are plain regexes with no syntax awareness. Raw LaTeX
// environments, fenced code blocks, and display math legitimately contain
// text that *looks* like Obsidian syntax (`%%`, `[..](..)`, `> [!`, `^id`) —
// authors migrating a Pandoc/LaTeX manuscript rely on those blocks surviving
// verbatim. Mask them behind placeholder tokens before the strippers run and
// restore them afterwards. Tokens are NUL-delimited (\u0000); NUL cannot
// appear in Obsidian note text, so tokens cannot collide with author content.

const LATEX_BEGIN_PATTERN = /^\s*\\begin\{([A-Za-z@*]+)\}/;
const DISPLAY_MATH_OPEN_PATTERN = /^\s*\$\$/;

function protectToken(index: number): string {
    return `\u0000RTPROTECT${index}\u0000`;
}

interface MaskedContent {
    masked: string;
    segments: string[];
}

function maskProtectedSegments(content: string): MaskedContent {
    const lines = content.split('\n');
    const out: string[] = [];
    const segments: string[] = [];

    const capture = (from: number, to: number): void => {
        segments.push(lines.slice(from, to + 1).join('\n'));
        out.push(protectToken(segments.length - 1));
    };

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        const fenceMatch = line.match(CODE_FENCE_PATTERN);
        if (fenceMatch) {
            const fence = fenceMatch[1];
            let end = i + 1;
            while (end < lines.length && !isClosingFence(lines[end], fence)) end += 1;
            if (end < lines.length) {
                capture(i, end);
                i = end;
                continue;
            }
            // Unclosed fence: leave as-is rather than swallowing the document.
            out.push(line);
            continue;
        }

        const beginMatch = line.match(LATEX_BEGIN_PATTERN);
        if (beginMatch) {
            const env = beginMatch[1].replace(/\*/g, '\\*');
            const beginRe = new RegExp(`\\\\begin\\{${env}\\}`, 'g');
            const endRe = new RegExp(`\\\\end\\{${env}\\}`, 'g');
            let depth = 0;
            let end = -1;
            for (let j = i; j < lines.length; j++) {
                depth += (lines[j].match(beginRe) || []).length; // SAFE: String.match returns null for no match; zero matches means zero nesting opened on this line
                depth -= (lines[j].match(endRe) || []).length; // SAFE: String.match returns null for no match; zero matches means zero nesting closed on this line
                if (depth <= 0) { end = j; break; }
            }
            if (end >= 0) {
                capture(i, end);
                i = end;
                continue;
            }
            out.push(line); // unclosed environment: pass through untouched
            continue;
        }

        if (DISPLAY_MATH_OPEN_PATTERN.test(line)) {
            // Single-line `$$ … $$` (closing pair after the opener) or block form.
            const rest = line.replace(/^\s*\$\$/, '');
            if (rest.includes('$$')) {
                capture(i, i);
                continue;
            }
            let end = i + 1;
            while (end < lines.length && !lines[end].includes('$$')) end += 1;
            if (end < lines.length) {
                capture(i, end);
                i = end;
                continue;
            }
            out.push(line);
            continue;
        }

        out.push(line);
    }

    return { masked: out.join('\n'), segments };
}

function restoreProtectedSegments(content: string, segments: string[]): string {
    let restored = content;
    for (let i = 0; i < segments.length; i++) {
        restored = restored.replace(protectToken(i), () => segments[i]);
    }
    return restored;
}

export interface ManuscriptCommentCounts {
    /** Editorialist author queries: `%%query: …%%` and the legacy `%%ai: …%%`. */
    authorQueries: number;
    /** Every other `%%…%%` or `<!-- … -->` comment: the author's private notes. */
    privateNotes: number;
}

/**
 * Counts what the two comment strippers act on, using their pairing,
 * classification and code/LaTeX masking, so the export modal's summary never
 * disagrees with the exported file.
 */
export function countManuscriptComments(text: string): ManuscriptCommentCounts {
    const { masked } = maskProtectedSegments(stripEditorialistReviewBlocks(normalizeLineEndings(text)));
    let authorQueries = 0;
    let privateNotes = 0;
    for (const [comment] of masked.matchAll(OBSIDIAN_COMMENT_PATTERN)) {
        if (AUTHOR_QUERY_PREFIX_PATTERN.test(comment)) authorQueries += 1;
        else privateNotes += 1;
    }
    privateNotes += [...masked.matchAll(/<!--[\s\S]*?-->/g)].length;
    return { authorQueries, privateNotes };
}

export function getDefaultManuscriptCleanupOptions(format: ManuscriptCleanupFormat): ManuscriptExportCleanupOptions {
    return format === 'pdf'
        ? { ...PDF_CLEANUP_DEFAULTS }
        : { ...MARKDOWN_CLEANUP_DEFAULTS };
}

export function normalizeManuscriptCleanupOptions(
    options: Partial<ManuscriptExportCleanupOptions> | undefined,
    format: ManuscriptCleanupFormat
): ManuscriptExportCleanupOptions {
    const defaults = getDefaultManuscriptCleanupOptions(format);
    return {
        stripComments: options?.stripComments ?? defaults.stripComments,
        stripAiComments: options?.stripAiComments ?? defaults.stripAiComments,
        stripLinks: options?.stripLinks ?? defaults.stripLinks,
        stripCallouts: options?.stripCallouts ?? defaults.stripCallouts,
        stripBlockIds: options?.stripBlockIds ?? defaults.stripBlockIds
    };
}

export function sanitizeCompiledManuscript(
    text: string,
    opts: Partial<ManuscriptExportCleanupOptions> = {}
): string {
    let cleaned = normalizeLineEndings(text);
    // Structural strippers run unmasked on purpose: the editorialist stripper
    // must still find its own fenced blocks, and the YAML stripper is already
    // fence-aware.
    cleaned = stripYamlFrontmatterBlocks(cleaned);
    cleaned = stripEditorialistReviewBlocks(cleaned);

    const anyOptIn = opts.stripComments || opts.stripAiComments
        || opts.stripLinks || opts.stripCallouts || opts.stripBlockIds; // SAFE: "is any cleanup enabled" disjunction over the cleanup flags, not a value fallback
    if (!anyOptIn) return cleaned.trim();

    const { masked, segments } = maskProtectedSegments(cleaned);
    let working = masked;
    if (opts.stripComments) working = stripComments(working);
    if (opts.stripAiComments) working = stripAuthorQueries(working);
    if (opts.stripLinks) working = stripLinks(working);
    if (opts.stripCallouts) working = stripCallouts(working);
    if (opts.stripBlockIds) working = stripBlockIds(working);

    return restoreProtectedSegments(working, segments).trim();
}

export function sanitizeCompiledManuscriptForPdf(
    text: string,
    opts: Partial<ManuscriptExportCleanupOptions> = {}
): string {
    // Task-marker strip is masked too: a `- [ ]` inside a code block or raw
    // LaTeX example must survive verbatim.
    const cleaned = sanitizeCompiledManuscript(text, opts);
    const { masked, segments } = maskProtectedSegments(cleaned);
    return restoreProtectedSegments(stripTaskListMarkers(masked), segments).trim();
}
