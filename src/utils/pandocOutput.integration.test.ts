import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'fs'; // SAFE: isolated test fixture filesystem operations.
import * as os from 'os'; // SAFE: test-only temporary folder locations.
import * as path from 'path'; // SAFE: test-only fixture paths.
import { execFileSync } from 'child_process'; // SAFE: opt-in local Poppler verification of a generated test PDF.
import { unzipSync, strFromU8 } from 'fflate';
import { runPandocOnContent } from './exportFormats';

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
        const published = await runPandocOnContent('# A manuscript proof\n\nVerified PDF manuscript paragraph.', path.join(folder, 'Book.pdf'), { targetFormat: 'pdf' });
        expect(execFileSync('pdftotext', [published, '-'], { encoding: 'utf8' })).toContain('Verified PDF manuscript paragraph.');
        expect(fs.readdirSync(folder)).toEqual(['Book.pdf']);
    });
});
