import { makeFile } from './helpers/obsidianFixtures';
import { describe, expect, it } from 'vitest';
import type { TFile, Vault } from 'obsidian';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { assembleManuscript } from '../src/utils/manuscript';
import { getManuscriptLayoutExportBehavior } from '../src/utils/manuscriptLayoutExport';
import { sanitizeCompiledManuscriptForPdf } from '../src/utils/manuscriptSanitize';
import { BUNDLED_FICTION_SPECS } from '../src/publishing/bundledStyleSpecs';
import { generateDesignedStyleTex, type DesignedStyleSpec } from '../src/publishing/designedStyle';

const runAssemblyPdf = process.env.RT_PUBLISH_PDF_ASSEMBLY === '1';
const contemporaryLongScene = Array.from({ length: 20 }, () => (
  'The first scene continues across pages so the integration test can verify the right-page running header. The prose itself avoids the scene title, which means an extracted title hit must come from the header or opener chrome.'
)).join('\n\n');

function commandExists(name: string): boolean {
  return spawnSync('which', [name], { encoding: 'utf8' }).status === 0;
}

function run(command: string, args: string[], cwd: string): string {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', stdio: 'pipe' });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed.\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  }
  return result.stdout;
}

function makeVault(contents: Record<string, string>): Vault {
  return {
    read: async (file: TFile) => contents[file.path] ?? '',
  } as unknown as Vault;
}

describe.skipIf(!runAssemblyPdf)('assembled Contemporary Literary PDF contract', () => {
  it('preserves scene-title setter through Pandoc and renders odd/right continuation headers', async () => {
    for (const cmd of ['pandoc', 'xelatex', 'pdfinfo', 'pdftotext']) {
      expect(commandExists(cmd), `${cmd} must be installed for publishing PDF assembly QA`).toBe(true);
    }

    const layout = {
      id: 'bundled-fiction-contemporary-literary',
      name: 'Contemporary Literary',
      path: 'rt_contemporary_literary.tex',
      designedSpec: BUNDLED_FICTION_SPECS['bundled-fiction-contemporary-literary'],
    };
    const behavior = getManuscriptLayoutExportBehavior(layout);
    const scene1 = makeFile('Scenes/1 Arrival.md');
    const scene2 = makeFile('Scenes/2 The Garden.md');
    const scene3 = makeFile('Scenes/3 Departure.md');
    const assembled = await assembleManuscript(
      [scene1, scene2, scene3],
      makeVault({
        [scene1.path]: contemporaryLongScene,
        [scene2.path]: 'Second scene body text follows the opener.',
        [scene3.path]: 'Third scene body text starts the second chapter.',
      }),
      undefined,
      false,
      undefined,
      false,
      undefined,
      undefined,
      {
        sceneHeadingMode: behavior.defaultSceneHeadingMode,
        sceneHeadingRenderMode: behavior.sceneHeadingRenderMode,
        useRtChapterMacro: behavior.useRtChapterMacro,
        chapterMarkersByScenePath: {
          [scene1.path]: [{
            sourcePath: scene1.path,
            sourceType: 'Scene',
            title: 'Boy with a Skull',
            resolvedScenePath: scene1.path,
            resolvedTimelinePosition: 1,
          }],
          [scene3.path]: [{
            sourcePath: scene3.path,
            sourceType: 'Scene',
            title: 'New Horizons',
            resolvedScenePath: scene3.path,
            resolvedTimelinePosition: 3,
          }],
        },
      }
    );
    const markdown = sanitizeCompiledManuscriptForPdf(assembled.text, {});
    expect(markdown).toContain('\\rtSetSceneRunningTitle{Arrival}');
    expect(markdown).not.toContain('\\providecommand{\\rtSetSceneRunningTitle}');

    const workDir = mkdtempSync(join(tmpdir(), 'rt-publish-assembly-'));
    try {
      const mdPath = join(workDir, 'contemporary.md');
      const texPath = join(workDir, 'contemporary.tex');
      const expandedPath = join(workDir, 'contemporary.expanded.tex');
      const pdfPath = join(workDir, 'contemporary.pdf');
      writeFileSync(mdPath, markdown);
      writeFileSync(texPath, generateDesignedStyleTex(BUNDLED_FICTION_SPECS['bundled-fiction-contemporary-literary'], {
        bundledLayoutId: 'bundled-fiction-contemporary-literary',
        // Resolve Source Serif 4 from the repo's bundled font files (same
        // mechanism as the vault install at runtime) so the test does not
        // depend on fonts being installed in the machine's font cache.
        vaultFontDir: join(process.cwd(), 'src', 'assets', 'fonts'),
      }));

      run('pandoc', [mdPath, '--from=markdown', '--to=latex', '--standalone', `--template=${texPath}`, '-V', 'title=Audit Book', '-V', 'author=Audit Author', '-o', expandedPath], workDir);
      const expanded = readFileSync(expandedPath, 'utf8');
      expect(expanded).toContain('\\rtSetSceneRunningTitle{Arrival}');
      expect(expanded).not.toContain('\\markboth{}{Arrival}');
      expect(expanded).not.toContain('\\providecommand{\\rtSetSceneRunningTitle}');

      run('pandoc', [mdPath, '--from=markdown', '--pdf-engine=xelatex', `--template=${texPath}`, '-V', 'title=Audit Book', '-V', 'author=Audit Author', '-o', pdfPath], workDir);
      // Contemporary Literary header contract ('left-title-right-context'):
      // even/left pages carry the book title, odd/right continuation pages
      // carry the running scene title. Assert the contract by scanning pages
      // rather than pinning page numbers — typography changes (widow/orphan
      // penalties, \raggedbottom) legitimately reflow pagination.
      const pageCountMatch = run('pdfinfo', [pdfPath], workDir).match(/^Pages:\s+(\d+)/m);
      const pageCount = pageCountMatch ? Number(pageCountMatch[1]) : 0;
      expect(pageCount).toBeGreaterThanOrEqual(4);
      let sawSceneHeaderOnOddPage = false;
      let sawBookTitleOnEvenPage = false;
      for (let page = 2; page <= pageCount; page++) {
        const text = run('pdftotext', ['-layout', '-f', String(page), '-l', String(page), pdfPath, '-'], workDir);
        if (page % 2 === 1 && text.includes('Arrival') && !text.includes('Audit Book')) {
          sawSceneHeaderOnOddPage = true;
        }
        if (page % 2 === 0 && text.includes('Audit Book')) {
          sawBookTitleOnEvenPage = true;
        }
      }
      expect(sawSceneHeaderOnOddPage, 'an odd/right continuation page should show the running scene title without the book title').toBe(true);
      expect(sawBookTitleOnEvenPage, 'an even/left page should show the book title header').toBe(true);
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  }, 60_000);
});

describe.skipIf(!runAssemblyPdf)('assembled designed PDF contracts', () => {
  it.each(['dedicated-page', 'roman-with-rule', 'inline-separator'] as const)('compiles actual %s scene assembly', async opener => {
    const spec = structuredClone(BUNDLED_FICTION_SPECS['bundled-fiction-modern-classic']);
    spec.scene = { opener, headingMode: 'scene-number', suppressHeaderFooterOnOpener: false };
    spec.body.font = 'latin-modern';
    spec.parts.mode = opener === 'roman-with-rule' ? 'roman' : 'off';
    spec.chapters.resetSceneCounter = true;
    const first = makeFile('Scenes/1 Arrival.md');
    const second = makeFile('Scenes/2 Garden.md');
    const third = makeFile('Scenes/3 Departure.md');
    const marker = (file: TFile, title: string, position: number) => ({ sourcePath: file.path, sourceType: 'Scene' as const, title, resolvedScenePath: file.path, resolvedTimelinePosition: position });
    const assembled = await assembleManuscript([first, second, third], makeVault({
      [first.path]: '---\nClass: Scene\nPart: true\n---\n\nDESIGN_START. Café costs $5.50.',
      [second.path]: 'DESIGN_MIDDLE. The garden waits.',
      [third.path]: 'DESIGN_END. The boat leaves.',
    }), undefined, false, undefined, false, undefined, undefined, {
      chapterMarkersByScenePath: { [first.path]: [marker(first, 'Opening Chapter', 1)], [third.path]: [marker(third, 'Closing Chapter', 3)] },
      modernClassicStructure: { enabled: true, sceneOpener: opener, suppressPartMarkers: spec.parts.mode === 'off', resetSceneCounterOnChapter: true, partEpigraphs: ['DESIGN_QUOTE'], partEpigraphAttributions: ['QA AUTHOR'] },
    });
    const artifactRoot = process.env.RT_PUBLISH_PDF_ARTIFACT_DIR;
    const workDir = artifactRoot ? join(artifactRoot, opener) : mkdtempSync(join(tmpdir(), 'rt-designed-assembly-'));
    mkdirSync(workDir, { recursive: true });
    try {
      const markdown = sanitizeCompiledManuscriptForPdf(assembled.text, {});
      expect(markdown).not.toMatch(/^## /m);
      writeFileSync(join(workDir, 'manuscript.md'), markdown);
      writeFileSync(join(workDir, 'template.tex'), generateDesignedStyleTex(spec));
      run('pandoc', ['manuscript.md', '--from=markdown+raw_tex', '--pdf-engine=xelatex', '--template=template.tex', '-V', 'title=Designed Assembly Audit', '-V', 'author=QA Author', '-o', 'manuscript.pdf'], workDir);
      const text = run('pdftotext', ['-layout', 'manuscript.pdf', '-'], workDir);
      for (const token of ['DESIGN_START', 'DESIGN_MIDDLE', 'DESIGN_END', 'Opening Chapter', 'Closing Chapter']) expect(text).toContain(token);
      expect(text).not.toContain('0.0.');
      if (opener === 'roman-with-rule') expect(text).toContain('DESIGN_QUOTE');
      else expect(markdown).not.toContain('\\rtPart{');
    } finally {
      if (!artifactRoot) rmSync(workDir, { recursive: true, force: true });
    }
  }, 60_000);
});

const completionCases: Array<{ id: string; configure(spec: DesignedStyleSpec): void; expected: string[]; footer?: boolean; chapterHeader?: boolean }> = [
  { id: 'headers-off-footer-on', configure: s => { s.runningHeader = { mode: 'none' }; s.folio = { position: 'bottom-center', format: 'arabic' }; s.parts.mode = 'off'; s.chapters.mode = 'off'; s.scene.opener = 'inline-separator'; }, expected: [], footer: true },
  { id: 'custom-facing-corners', configure: s => { s.runningHeader = { mode: 'none', evenLeft: { literal: 'QA_EVEN & #1' }, oddRight: { literal: 'QA_ODD $5' }, evenRight: 'page', oddLeft: 'page' }; s.folio.position = 'header'; s.parts.mode = 'off'; s.chapters.mode = 'off'; s.scene.opener = 'inline-separator'; }, expected: ['QA_EVEN & #1', 'QA_ODD $5'] },
  { id: 'chapter-running-title', configure: s => { s.runningHeader = { mode: 'none', evenCenter: 'chapter', oddCenter: 'chapter' }; s.folio.position = 'bottom-center'; s.parts.mode = 'off'; s.scene.opener = 'inline-separator'; }, expected: ['QA Chapter One', 'QA Chapter Two'], chapterHeader: true },
  { id: 'source-serif-context', configure: s => { s.body.font = 'source-serif'; s.body.sizePt = 12; s.runningHeader = { mode: 'left-title-right-context', font: 'sans' }; s.margins.mirrored = true; s.parts.mode = 'off'; s.scene.opener = 'dedicated-page'; }, expected: ['Completion Audit'] },
  { id: 'word-parts-own-epigraph', configure: s => { s.parts.mode = 'word'; s.parts.title = true; s.parts.epigraphPlacement = 'own-page'; s.chapters.mode = 'off'; }, expected: ['One', 'Two', 'QA_PART_QUOTE_ONE', 'QA_PART_QUOTE_TWO'] },
  { id: 'arabic-parts-inline', configure: s => { s.parts.mode = 'arabic'; s.parts.title = true; s.parts.pageBreak = false; s.parts.epigraphPlacement = 'inline'; s.chapters.mode = 'titled'; s.chapters.pageBreak = false; s.scene.opener = 'inline-separator'; }, expected: ['QA_PART_QUOTE_ONE', 'QA_PART_QUOTE_TWO'] },
  { id: 'custom-paper-no-chrome', configure: s => { s.paperSize = { widthIn: 7, heightIn: 10 }; s.runningHeader = { mode: 'none' }; s.folio.position = 'none'; s.body.font = 'sorts-mill-goudy'; s.body.sizePt = 10; s.body.paragraphIndentEm = 0; s.parts.mode = 'off'; s.chapters.mode = 'off'; s.scene.opener = 'inline-separator'; s.scene.separatorGlyph = '# $ &'; }, expected: ['# $ &'] },
  { id: 'a4-opener-spacing', configure: s => { s.paperSize = 'a4'; s.body.sizePt = 14; s.body.lineSpacing = 2; s.scene.opener = 'dedicated-page'; s.scene.headingMode = 'title-only'; s.scene.openerSpacing = { topFraction: 0.08, bottomFraction: 0.06 }; s.scene.suppressHeaderFooterOnOpener = true; s.folio.format = 'roman-frontmatter'; }, expected: ['QA Scene 1', 'QA Scene 6'] },
];

describe.skipIf(!runAssemblyPdf)('Publish wizard completion matrix', () => {
  it.each(completionCases)('$id preserves body, structure and configured chrome', async fixture => {
    const spec = structuredClone(BUNDLED_FICTION_SPECS['bundled-fiction-modern-classic']);
    spec.body.font = 'latin-modern';
    fixture.configure(spec);
    const files = Array.from({ length: 6 }, (_, i) => makeFile(`Scenes/${i + 1} QA Scene ${i + 1}.md`));
    const chapter = (file: TFile, title: string, n: number) => ({ sourcePath: file.path, sourceType: 'Scene' as const, title, resolvedScenePath: file.path, resolvedTimelinePosition: n });
    const chapters = spec.chapters.mode === 'off' ? {} : { [files[0].path]: [chapter(files[0], 'QA Chapter One', 1)], [files[3].path]: [chapter(files[3], 'QA Chapter Two', 4)] };
    const paragraph = 'Mara follows the lantern through the garden beside the harbor. The reader can see this paragraph continue across a page while every header and footer keeps its assigned content. ';
    const assembled = await assembleManuscript(files, makeVault(Object.fromEntries(files.map((file, i) => [file.path,
      `---\nClass: Scene\n${i === 0 || i === 3 ? 'Part: "QA Part & Crossing"\n' : ''}---\n\nQA_SCENE_${i + 1}_START\n\n${Array.from({ length: i === 0 ? 35 : 4 }, () => paragraph).join('\n\n')}\n\nQA_SCENE_${i + 1}_END`,
    ]))), undefined, false, undefined, false, undefined, undefined, {
      sceneHeadingMode: spec.scene.headingMode,
      chapterMarkersByScenePath: chapters,
      modernClassicStructure: { enabled: true, sceneOpener: spec.scene.opener, suppressPartMarkers: spec.parts.mode === 'off', resetSceneCounterOnChapter: spec.chapters.resetSceneCounter, partNumberStyle: spec.parts.mode === 'off' ? undefined : spec.parts.mode, partEpigraphs: ['QA_PART_QUOTE_ONE', 'QA_PART_QUOTE_TWO'], partEpigraphAttributions: ['QA AUTHOR ONE', 'QA AUTHOR TWO'] },
    });
    const root = process.env.RT_PUBLISH_PDF_ARTIFACT_DIR;
    const dir = root ? join(root, fixture.id) : mkdtempSync(join(tmpdir(), 'rt-publish-completion-'));
    mkdirSync(dir, { recursive: true });
    try {
      writeFileSync(join(dir, 'manuscript.md'), 'QA_FRONTMATTER\n\n\\newpage\n\n' + sanitizeCompiledManuscriptForPdf(assembled.text, {}));
      writeFileSync(join(dir, 'template.tex'), generateDesignedStyleTex(spec, { vaultFontDir: join(process.cwd(), 'src/assets/fonts') }));
      writeFileSync(join(dir, 'spec.json'), JSON.stringify(spec, null, 2));
      run('pandoc', ['manuscript.md', '--from=markdown+raw_tex', '--pdf-engine=xelatex', '--template=template.tex', '-V', 'title=Completion Audit', '-V', 'author=QA Author', '-o', 'manuscript.pdf'], dir);
      const text = run('pdftotext', ['-layout', 'manuscript.pdf', '-'], dir);
      writeFileSync(join(dir, 'manuscript.txt'), text);
      for (let n = 1; n <= 6; n++) { expect(text).toContain(`QA_SCENE_${n}_START`); expect(text).toContain(`QA_SCENE_${n}_END`); }
      for (const expected of fixture.expected) expect(text.replace(/\s+/g, '')).toContain(expected.replace(/\s+/g, ''));
      expect(text).not.toContain('0.0.');
      if (fixture.footer) {
        const bbox = run('pdftotext', ['-f', '1', '-l', '1', '-bbox', 'manuscript.pdf', '-'], dir);
        expect(bbox).toMatch(/yMin="(?:5\d\d|6\d\d)\.\d+"[^>]*>1<\/word>/);
      }
      if (fixture.chapterHeader) {
        const pages = text.split('\f');
        expect(pages.some(page => page.trimStart().startsWith('QA Chapter One'))).toBe(true);
        expect(pages.some(page => page.trimStart().startsWith('QA Chapter Two'))).toBe(true);
      }
    } finally { if (!root) rmSync(dir, { recursive: true, force: true }); }
  }, 60_000);
});
