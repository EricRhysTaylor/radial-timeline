import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildPandocLuaFilter } from './pandocLuaFilters';

describe('buildPandocLuaFilter', () => {
    it('adds no filter to a PDF export without line-per-paragraph', () => {
        expect(buildPandocLuaFilter({ targetFormat: 'pdf' })).toBeNull();
    });

    it('always converts Word scene breaks and adds line splitting only when asked', () => {
        const docx = buildPandocLuaFilter({ targetFormat: 'docx' });
        expect(docx).toContain('function HorizontalRule');
        expect(docx).not.toContain('function Para');

        const docxLines = buildPandocLuaFilter({ targetFormat: 'docx', lineBreaksAsParagraphs: true });
        expect(docxLines).toContain('function Para');
        expect(docxLines).toContain('function HorizontalRule');

        const pdfLines = buildPandocLuaFilter({ targetFormat: 'pdf', lineBreaksAsParagraphs: true });
        expect(pdfLines).toContain('function Para');
        expect(pdfLines).not.toContain('function HorizontalRule');
    });
});

type PandocBlock = { t: string; c?: unknown };

const hasPandoc = spawnSync('pandoc', ['--version']).status === 0;

// Runs the real filters through Pandoc so a Lua error fails here, not at export.
describe.skipIf(!hasPandoc)('Pandoc Lua filters', () => {
    function runFilter(markdown: string, lineBreaksAsParagraphs: boolean): PandocBlock[] {
        const dir = mkdtempSync(join(tmpdir(), 'rt-lua-filter-'));
        try {
            const filterPath = join(dir, 'filter.lua');
            writeFileSync(filterPath, buildPandocLuaFilter({ targetFormat: 'docx', lineBreaksAsParagraphs }) ?? '', 'utf8');
            const result = spawnSync('pandoc', ['-f', 'markdown', '-t', 'json', '--lua-filter', filterPath], { input: markdown, encoding: 'utf8' });
            expect(result.stderr).toBe('');
            return (JSON.parse(result.stdout) as { blocks: PandocBlock[] }).blocks;
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    }

    const scene = [
        '“How much longer?” she asks.',
        '“All of them.” He raises an eyebrow.',
        'A line of verse,\\',
        'kept with its partner.',
        '',
        '---',
        '',
        '- a list item',
        '  that wraps',
    ].join('\n');

    it('splits single returns into paragraphs and keeps explicit breaks', () => {
        const blocks = runFilter(scene, true);
        expect(blocks.map(block => block.t)).toEqual(['Para', 'Para', 'Para', 'Div', 'BulletList']);
        const verse = blocks[2].c as PandocBlock[];
        expect(verse.some(inline => inline.t === 'LineBreak')).toBe(true);
    });

    it('leaves paragraphs whole when the option is off', () => {
        expect(runFilter(scene, false).map(block => block.t)).toEqual(['Para', 'Div', 'BulletList']);
    });

    it('turns a horizontal rule into a centered Scene Break "#"', () => {
        const div = runFilter(scene, false).find(block => block.t === 'Div');
        expect(JSON.stringify(div)).toContain('"custom-style","Scene Break"');
        expect(JSON.stringify(div)).toContain('"Str","c":"#"');
    });
});
