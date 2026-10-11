import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'fs'; // SAFE: isolated test fixture filesystem operations.
import * as os from 'os'; // SAFE: test-only temporary folder locations.
import * as path from 'path'; // SAFE: test-only fixture paths.
import { execFileSync } from 'child_process'; // SAFE: opt-in local Poppler verification of a generated test PDF.
import { unzipSync, strFromU8 } from 'fflate';
import { runPandocOnContent } from './exportFormats';
import { BUNDLED_FICTION_SPECS } from '../publishing/bundledStyleSpecs';
import { generateDesignedStyleTex } from '../publishing/designedStyle';
import { getBundledPandocLayoutContent } from './pandocBundledLayouts';

const live = process.env.RT_PUBLISH_LIVE_OUTPUT === '1';
const folders: string[] = [];
afterEach(() => folders.splice(0).forEach(folder => fs.rmSync(folder, { recursive: true, force: true })));

describe.runIf(live)('installed Pandoc output publication', () => {
    it('produces a readable Word package and preserves the prior export', async () => {
        const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-live-word-'));
        folders.push(folder);
        const options = { targetFormat: 'docx', referenceDocPath: path.join(process.cwd(), 'src/assets/pandoc/reference-manuscript.docx') } as const;
        const first = await runPandocOnContent('# Chapter one\n\nFirst manuscript paragraph.', path.join(folder, 'Book.docx'), options);
        const original = fs.readFileSync(first);
        const second = await runPandocOnContent('# Chapter two\n\nSecond manuscript paragraph.', first, options);
        expect(fs.readFileSync(first).equals(original)).toBe(true);
        const document = strFromU8(unzipSync(fs.readFileSync(second))['word/document.xml']);
        expect(document).toContain('Second manuscript paragraph.');
        expect(document).not.toContain('First manuscript paragraph.');
        expect(fs.readdirSync(folder).filter(name => name.startsWith('.'))).toEqual([]);
    });

    it('produces a PDF whose prose can be read by Poppler', async () => {
        const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-live-pdf-'));
        folders.push(folder);
        const published = await runPandocOnContent('# A manuscript proof\n\nVerified PDF manuscript paragraph.\n\n\\AuditMarker', path.join(folder, 'Book.pdf'), {
            targetFormat: 'pdf', headerIncludes: '\\newcommand{\\AuditMarker}{Author preamble preserved}',
        });
        const text = execFileSync('pdftotext', [published, '-'], { encoding: 'utf8' });
        expect(text).toContain('Verified PDF manuscript paragraph.');
        expect(text).toContain('Author preamble preserved');
        expect(fs.readdirSync(folder)).toEqual(['Book.pdf']);
    });

    it.each(['default', ...Object.keys(BUNDLED_FICTION_SPECS), 'bundled-screenplay', 'bundled-podcast'])('keeps literal text inside the page in %s', async layoutId => {
        const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-literal-pdf-'));
        folders.push(folder);
        const longToken = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.repeat(12);
        const letter = 'The long letter retains every word and wraps within the manuscript margins. '.repeat(12);
        const rows = Array.from({ length: 70 }, (_, index) => `ROW${index.toString().padStart(3, '0')} manuscript literal text remains readable across page boundaries.`);
        const content = [
            `    ${letter}`,
            `\`\`\`\n${longToken}\n\`\`\``,
            `\`\`\`python\nmessage = "${longToken}"\n\`\`\``,
            `\`\`\`\n${rows.join('\n')}\n\`\`\``,
        ].join('\n\n');
        const spec = BUNDLED_FICTION_SPECS[layoutId as keyof typeof BUNDLED_FICTION_SPECS];
        const template = spec
            ? generateDesignedStyleTex(spec, { vaultFontDir: path.join(process.cwd(), 'src/assets/fonts') })
            : layoutId === 'default' ? undefined : getBundledPandocLayoutContent(layoutId);
        if (layoutId !== 'default') expect(template).toBeTruthy();
        const templatePath = template ? path.join(folder, 'layout.tex') : undefined;
        if (templatePath && template) fs.writeFileSync(templatePath, template);
        const pdf = await runPandocOnContent(content, path.join(folder, 'Literal.pdf'), {
            targetFormat: 'pdf', templatePath,
            metadata: { title: 'Literal regression', author: 'QA Writer', geometry: 'paperwidth=6in,paperheight=9in,margin=0.6in' },
        });
        const normalize = (value: string) => value.normalize('NFKC').replace(/[^\p{L}\p{N}]/gu, '');
        const text = execFileSync('pdftotext', ['-layout', pdf, '-'], { encoding: 'utf8' })
            .split('\f').map(page => page.split('\n').filter(line => !/Literalregression|QAWriter/i.test(normalize(line)) && !/^(?:\d+|[ivxlcdm]+)$/i.test(normalize(line))).join('\n')).join('\n');
        const expected = execFileSync('pandoc', ['-f', 'markdown', '-t', 'plain'], { input: content, encoding: 'utf8' });
        expect(normalize(text)).toBe(normalize(expected));
        const bbox = execFileSync('pdftotext', ['-bbox', pdf, '-'], { encoding: 'utf8' });
        const pages = [...bbox.matchAll(/<page width="([\d.]+)" height="([\d.]+)">([\s\S]*?)<\/page>/g)];
        expect(pages.length).toBeGreaterThan(1);
        const margin = spec ? Math.min(spec.margins.leftIn, spec.margins.rightIn) * 72 : layoutId === 'default' ? 0.6 * 72 : 72;
        // Permit the designed styles' optical glyph protrusion at the text margin.
        for (const page of pages) {
            const words = [...page[3].matchAll(/<word xMin="([\d.-]+)" yMin="([\d.-]+)" xMax="([\d.-]+)" yMax="([\d.-]+)"/g)];
            for (const word of words) {
                expect(Number(word[1])).toBeGreaterThanOrEqual(margin - 2);
                expect(Number(word[3])).toBeLessThanOrEqual(Number(page[1]) - margin + 2);
                expect(Number(word[2])).toBeGreaterThanOrEqual(0);
                expect(Number(word[4])).toBeLessThanOrEqual(Number(page[2]));
            }
        }
    }, 60_000);
});
