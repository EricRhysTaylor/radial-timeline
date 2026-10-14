import { describe, expect, it } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { unzipSync, strFromU8 } from 'fflate';
import { assembleManuscript } from '../utils/manuscript';
import { makeFile } from '../../tests/helpers/obsidianFixtures';
import { getManuscriptLayoutExportBehavior } from '../utils/manuscriptLayoutExport';
import { sanitizeCompiledManuscriptForPdf } from '../utils/manuscriptSanitize';
import { runPandocOnContent } from '../utils/exportFormats';
import { BUNDLED_FICTION_SPECS } from './bundledStyleSpecs';
import { generateDesignedStyleTex } from './designedStyle';
import type { TimelineChapterMarker } from '../utils/timelineChapters';

const live = process.env.RADIAL_TIMELINE_CONTENTS_QA === '1';
const folder = join(process.cwd(), 'tmp', 'publishing-pdf-qa', 'document-contents');
describe.runIf(live)('rendered document contents', () => {
    it.each(Object.keys(BUNDLED_FICTION_SPECS))('renders linked structural contents in %s', async id => {
        mkdirSync(folder, { recursive: true });
        const spec = structuredClone(BUNDLED_FICTION_SPECS[id as keyof typeof BUNDLED_FICTION_SPECS]);
        // Exercise Contemporary's page/navigation logic without requiring an optional OS font.
        if (spec.body.font === 'source-serif') spec.body.font = 'system-serif';
        const template = join(folder, `${id}.tex`);
        writeFileSync(template, generateDesignedStyleTex(spec));
        const layout = { id, name: id, path: template, designedSpec: spec };
        const behavior = getManuscriptLayoutExportBehavior(layout);
        const files = ['1 Arrival', '2 Return', '3 Arrival'].map(name => makeFile(`Draft/${name}.md`));
        const bodies = files.map((_f, i) => `---\n${i !== 1 ? `Part: ${i === 0 ? 'The Crossing' : 'Act II'}\n` : ''}Chapter: Chapter ${i + 1}\n---\n${`Distinct prose for segment ${i + 1}, with café and a quiet harbor. `.repeat(40)}`);
        const chapters: Record<string, TimelineChapterMarker[]> = {};
        files.forEach((f, i) => { chapters[f.path] = [{ sourcePath: f.path, sourceType: 'Scene', title: `Chapter ${i + 1}`, resolvedScenePath: f.path, resolvedTimelinePosition: i + 1 }]; });
        const assembled = await assembleManuscript(files, { read: async f => bodies[files.findIndex(file => file.path === f.path)] }, undefined, false, undefined, false, undefined, undefined, {
            sceneHeadingMode: behavior.defaultSceneHeadingMode,
            sceneHeadingRenderMode: behavior.sceneHeadingRenderMode,
            useRtChapterMacro: behavior.useRtChapterMacro,
            modernClassicStructure: { enabled: id === 'bundled-fiction-modern-classic' },
            chapterMarkersByScenePath: behavior.suppressChapterMarkers ? {} : chapters,
            documentContents: { format: 'pdf', depth: 3, chapters },
        });
        const content = sanitizeCompiledManuscriptForPdf(assembled.text, {});
        writeFileSync(join(folder, `${id}.md`), content);
        const pdf = await runPandocOnContent(content, join(folder, `${id}.pdf`), { targetFormat: 'pdf', templatePath: template, documentContents: true, tocDepth: 3, metadata: { title: 'Harbor navigation proof', author: 'Synthetic QA' } });
        const text = execFileSync('pdftotext', [pdf, '-'], { encoding: 'utf8' });
        expect(text).toContain('Contents');
        expect(text).toContain('Chapter 1');
        expect(text).toContain('Part I: The Crossing');
        expect(text).toContain('Act II');
        expect(text).toContain('Distinct prose for segment 3');
        writeFileSync(join(folder, `${id}.txt`), text);
    }, 90_000);
    it('writes an updateable Word TOC using real heading styles', async () => {
        mkdirSync(folder, { recursive: true });
        const output = await runPandocOnContent('# Part I\n\n## Chapter A\n\n### Arrival\n\nReadable prose.', join(folder, 'contents.docx'), { targetFormat: 'docx', documentContents: true, tocDepth: 3, referenceDocPath: join(process.cwd(), 'src/assets/pandoc/reference-manuscript.docx') });
        const parts = unzipSync(readFileSync(output));
        const xml = strFromU8(parts['word/document.xml']);
        expect(xml).toContain('TOC');
        expect(xml).toContain('Heading1'); expect(xml).toContain('Heading2'); expect(xml).toContain('Heading3');
        expect(xml).toContain('1-3');
    });
    it('paginates a long contents for a plain Markdown source with repeated headings', async () => {
        const content = `\n\n${Array.from({ length: 70 }, (_, i) => `# Chapter ${i + 1}\n\n## Arrival\n\nProse ${i + 1}.\n\n`).join('')}`;
        const pdf = await runPandocOnContent(['```{=latex}', '\\clearpage\\tableofcontents\\clearpage', '```', content].join('\n'), join(folder, 'plain-long.pdf'), { targetFormat: 'pdf', documentContents: true, tocDepth: 2 });
        const text = execFileSync('pdftotext', [pdf, '-'], { encoding: 'utf8' });
        expect(text).toContain('Chapter 70');
        expect(text).toContain('Prose 70.');
        const contents = text.slice(0, text.indexOf('Prose 1.'));
        expect(contents).toContain('Chapter 70');
        expect(contents.split('\f').length).toBeGreaterThan(2);
    }, 90_000);
});
