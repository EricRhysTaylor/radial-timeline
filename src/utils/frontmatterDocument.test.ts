import { describe, expect, it } from 'vitest';
import { buildFrontmatterDocument, extractBodyAfterFrontmatter, stripFrontmatter } from './frontmatterDocument';

describe('frontmatterDocument', () => {
    it('extracts body from position.end when provided', () => {
        const content = '---\nClass: Scene\n---\nBody line';
        const body = extractBodyAfterFrontmatter(content, {
            position: { end: { offset: '---\nClass: Scene\n---'.length } }
        });
        expect(body).toBe('\nBody line');
    });

    it('falls back to stripping first frontmatter block when position metadata is missing', () => {
        const content = '---\nClass: Scene\nSummary: Hello\n---\n---\nBody line';
        const body = extractBodyAfterFrontmatter(content, {});
        expect(body).toBe('\n---\nBody line');
    });

    it('rebuilds with exactly one closing fence and a single separator when needed', () => {
        const yaml = 'id: scn_deadbeef\nClass: Scene\n';
        const rebuilt = buildFrontmatterDocument(yaml, 'Body line');
        expect(rebuilt).toBe('---\nid: scn_deadbeef\nClass: Scene\n---\nBody line');
        expect(rebuilt).not.toContain('------');
    });

    it('does not insert an extra separator when body already starts with newline', () => {
        const yaml = 'id: scn_deadbeef\nClass: Scene\n';
        const rebuilt = buildFrontmatterDocument(yaml, '\nBody line');
        expect(rebuilt).toBe('---\nid: scn_deadbeef\nClass: Scene\n---\nBody line');
    });
});

describe('stripFrontmatter', () => {
    it('removes the block and the line break after its closing fence', () => {
        expect(stripFrontmatter('---\nClass: Scene\n---\nBody line')).toBe('Body line');
    });

    it('tolerates CRLF line endings and trailing spaces on the fences', () => {
        expect(stripFrontmatter('--- \r\nClass: Scene\r\n---\t\r\nBody line')).toBe('Body line');
    });

    it('returns content without frontmatter unchanged', () => {
        expect(stripFrontmatter('Body line\n---\nnot frontmatter')).toBe('Body line\n---\nnot frontmatter');
    });

    it('does not treat a line that merely starts with --- as the closing fence', () => {
        expect(stripFrontmatter('---\ntitle: a\n---b\nmore: 1\n---\nBody')).toBe('Body');
    });

    it('strips a block that ends the document', () => {
        expect(stripFrontmatter('---\nClass: Scene\n---')).toBe('');
    });
});
