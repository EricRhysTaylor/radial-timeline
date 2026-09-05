/** One YAML frontmatter block at the top of a note: opening fence, contents, closing fence. */
const FRONTMATTER_BLOCK_SOURCE = '^---[ \\t]*\\r?\\n[\\s\\S]*?\\r?\\n---[ \\t]*';
const FRONTMATTER_BLOCK_RE = new RegExp(FRONTMATTER_BLOCK_SOURCE);
/** The block plus the line break that ends its closing fence. */
const FRONTMATTER_BLOCK_WITH_BREAK_RE = new RegExp(`${FRONTMATTER_BLOCK_SOURCE}(?:\\r?\\n|$)`);

/**
 * Body text with the leading frontmatter block (and its closing line break)
 * removed. CRLF tolerant. Content with no frontmatter is returned unchanged.
 */
export function stripFrontmatter(content: string): string {
    return content.replace(FRONTMATTER_BLOCK_WITH_BREAK_RE, '');
}

export interface FrontmatterBounds {
    to?: number;
    position?: { end?: { offset?: number } };
}

/**
 * Extract markdown body text following YAML frontmatter.
 *
 * Prefers Obsidian's `position.end.offset` when available. Falls back to
 * stripping the first frontmatter block from the raw content.
 */
export function extractBodyAfterFrontmatter(content: string, bounds: FrontmatterBounds): string {
    const endOffset = bounds.position?.end?.offset;
    if (typeof endOffset === 'number' && endOffset >= 0 && endOffset <= content.length) {
        return content.slice(endOffset);
    }

    const stripped = content.replace(FRONTMATTER_BLOCK_RE, '');
    if (stripped !== content) return stripped;

    if (typeof bounds.to === 'number' && bounds.to >= 0 && bounds.to <= content.length) {
        return content.slice(bounds.to);
    }

    return content;
}

/**
 * Rebuild a file with normalized YAML frontmatter and preserved body content.
 *
 * Guarantees exactly one closing YAML fence and inserts a line break between
 * frontmatter and body only when needed.
 */
export function buildFrontmatterDocument(yaml: string, body: string): string {
    const normalizedYaml = yaml.endsWith('\n') ? yaml : `${yaml}\n`;
    const needsSeparator = body.length > 0 && !body.startsWith('\n') && !body.startsWith('\r\n');
    return `---\n${normalizedYaml}---${needsSeparator ? '\n' : ''}${body}`;
}
