import { describe, expect, it } from 'vitest';
import { addMarkdownContents, contentsDepth, documentContentsHeader } from './documentContents';
import { assembleManuscript } from '../utils/manuscript';
import { makeFile } from '../../tests/helpers/obsidianFixtures';
import type { TimelineChapterMarker } from '../utils/timelineChapters';

function fixture() {
    const files = ['1 Arrival', '2 Return', '3 Arrival'].map(name => makeFile(`Draft/${name}.md`));
    const bodies = [
        '---\nPart: First crossing\nChapter: Beginnings\n---\nFirst prose.',
        '---\nChapter: Return\n---\nSecond prose.',
        '---\nPart: Act II\nChapter: Beginnings\n---\nThird prose.',
    ];
    const chapters: Record<string, TimelineChapterMarker[]> = {};
    files.forEach((file, index) => { chapters[file.path] = [{ sourcePath: file.path, sourceType: 'Scene', title: index === 1 ? 'Return' : 'Beginnings', resolvedScenePath: file.path, resolvedTimelinePosition: index + 1 }]; });
    return { files, chapters, vault: { read: async (file: { path: string }) => bodies[files.findIndex(f => f.path === file.path)] } };
}

describe('document contents', () => {
    it('links repeated headings to distinct destinations and retains nested headings', () => {
        const output = addMarkdownContents('# Arrival\n\n## Chapter & café\n\n# Arrival\n\nText');
        expect(output).toContain('- [Arrival](#^manuscript-heading-1)');
        expect(output).toContain('  - [Chapter & café](#^manuscript-heading-2)');
        expect(output).toContain('- [Arrival](#^manuscript-heading-3)');
        expect(output).toContain('<a id="^manuscript-heading-3"></a>\n\n# Arrival ^manuscript-heading-3');
    });
    it('excludes fenced code and HTML comments and respects depth', () => {
        const output = addMarkdownContents('# Real\n\n```md\n# Code\n```\n\n<!--\n# Comment\n-->\n\n## Child', 1);
        expect(output.match(/\]\(#\^manuscript-heading-/g)).toHaveLength(1);
        expect(output).toContain('# Code');
    });
    it('supports setext headings without treating horizontal rules after blank lines as headings', () => {
        const output = addMarkdownContents('First\n===\n\nSecond\n---\n\n---');
        expect(output).toContain('[First]'); expect(output).toContain('[Second]');
        expect(output.match(/\]\(#\^manuscript-heading-/g)).toHaveLength(2);
    });
    it('blocks a requested empty contents instead of claiming navigation exists', () => {
        expect(() => addMarkdownContents('Prose only.')).toThrow('No document headings');
    });
    it('avoids existing block IDs, preserves authored targets and ignores indented code', () => {
        const output = addMarkdownContents('# Keep ^author-target\n\nReserved manuscript-heading-1\n\n    Code\n    ---\n\n## New ###');
        expect(output).toContain('[Keep](#^author-target)');
        expect(output).toContain('[New](#^manuscript-heading-2)');
        expect(output).toContain('## New ^manuscript-heading-2');
        expect(output.match(/\]\(#\^/g)).toHaveLength(2);
    });
    it('disambiguates authored block IDs repeated across compiled notes', () => {
        const output = addMarkdownContents('# Arrival ^arrival\n\nFirst.\n\n# Arrival ^arrival\n\nSecond.');
        expect(output).toContain('[Arrival](#^arrival)');
        expect(output).toContain('[Arrival](#^manuscript-heading-1)');
        expect(output).toContain('# Arrival ^manuscript-heading-1');
    });
    it('normalizes depth and provides numbered contents/bookmark levels with queued destinations', () => {
        expect([contentsDepth(), contentsDepth(0), contentsDepth(9)]).toEqual([3, 3, 6]);
        const header = documentContentsHeader(2);
        expect(header).toContain('\\setcounter{tocdepth}{1}');
        expect(header).toContain('\\hypersetup{bookmarksdepth=1}');
        expect(header).toContain('\\phantomsection');
        expect(header).toContain('\\addcontentsline{toc}{chapter}{#2}');
    });
    it('creates real part, chapter and scene headings for Word without changing source notes', async () => {
        const { files, chapters, vault } = fixture();
        const result = await assembleManuscript(files, vault, undefined, false, undefined, false, undefined, undefined, { documentContents: { format: 'docx', depth: 3, chapters } });
        expect(result.text).toContain('# Part I: First crossing');
        expect(result.text).toContain('## Beginnings');
        expect(result.text).toContain('### 1 Arrival');
        expect(result.text).toContain('# Act II');
        expect(result.text).not.toContain('TABLE OF CONTENTS');
    });
    it('retains invisible hierarchy for scene-only PDF layouts and queues destinations before their opener', async () => {
        const { files, chapters, vault } = fixture();
        const result = await assembleManuscript(files, vault, undefined, false, undefined, false, undefined, undefined, { sceneHeadingRenderMode: 'latex-section-starred', chapterMarkersByScenePath: {}, documentContents: { format: 'pdf', depth: 3, chapters } });
        expect(result.text).toContain('\\tableofcontents');
        expect(result.text).toContain('\\rtQueueNavigation{1}{Part I: First crossing}');
        expect(result.text).toContain('\\rtQueueNavigation{2}{Beginnings}');
        expect(result.text).toContain('\\rtQueueNavigation{3}');
        expect(result.text.indexOf('\\rtQueueNavigation{2}{Beginnings}')).toBeLessThan(result.text.indexOf('\\rtSceneOpener'));
        expect(result.text).not.toContain('\\rtChapter{');
    });
});
