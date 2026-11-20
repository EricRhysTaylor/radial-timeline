import { makeFile } from './helpers/obsidianFixtures';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as obsidian from 'obsidian';
import type { TFile, Vault } from 'obsidian';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { assembleManuscript } from '../src/utils/manuscript';
import { getManuscriptLayoutExportBehavior } from '../src/utils/manuscriptLayoutExport';
import { sanitizeCompiledManuscriptForPdf } from '../src/utils/manuscriptSanitize';
import { BUNDLED_FICTION_SPECS, cloneArchetypeSpec } from '../src/publishing/bundledStyleSpecs';
import { generateDesignedStyleTex, type DesignArchetype, type DesignedStyleSpec } from '../src/publishing/designedStyle';
import { existsSync, statSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { validateDesignedStyleSpec } from '../src/modals/DesignedStyleWizardModal';
import { buildWizardMatrixCases, type WizardMatrixCase, type WizardMatrixMachine } from '../src/publishing/wizardControlMatrix';
import { getFontDiagnosticForFontKey, runPandocOnContent } from '../src/utils/exportFormats';
import { ImportTemplateModal, type ImportedTemplateCommit } from '../src/modals/ImportTemplateModal';
import { registerImportedTemplate } from '../src/utils/templateImport';
import { getImportedTemplateState, recheckImportedTemplate } from '../src/publishing/importedTemplateState';
import { IMPORTED_TEMPLATE_CHECK_PHRASES, buildImportedTemplateCheckManuscript, hashTemplateText, runImportedTemplateCheck } from '../src/publishing/importedTemplateCheck';
import { extractLatexErrorLines } from '../src/utils/exportErrors';
import { makeDiskVaultPlugin } from './helpers/diskVault';
import { readTemplateFacts } from '../src/publishing/templateFacts';
import { buildImportedTemplateFactRows } from '../src/settings/sections/publish/ImportedLayoutSummary';

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

// ─────────────────────────────────────────────────────────────────────────
// Design wizard compile matrix
//
// The evidence behind letting authors design their own PDF style: every
// setting the wizard offers, at the ends of its range, builds a real PDF from
// each of the four built-in layouts. The case list comes from
// src/publishing/wizardControlMatrix.ts, which reads the same range table the
// wizard's own controls read.
//
// Each case goes the way a real export goes: the manuscript is assembled with
// the options CommandRegistrar derives for a wizard-made style, and the PDF is
// built by runPandocOnContent — the plugin's own Pandoc call.
//
// A failing case is fixed by narrowing the range or fixing the LaTeX the
// generator writes. It is never skipped.
// ─────────────────────────────────────────────────────────────────────────

const execFileAsync = promisify(execFile);
const MATRIX_ARCHETYPES: readonly DesignArchetype[] = ['submission', 'reading-draft', 'literary', 'structured'];
const BUNDLED_FONT_DIR = join(process.cwd(), 'src', 'assets', 'fonts');

/** What this machine can print with, asked the way the wizard's font picker asks. */
function detectMatrixMachine(): WizardMatrixMachine {
  const customFontName = ['Georgia', 'Palatino', 'Times New Roman', 'DejaVu Serif', 'Liberation Serif']
    .find(name => getFontDiagnosticForFontKey('custom', undefined, name).state === 'ok');
  if (!customFontName) throw new Error('The wizard matrix needs one common system serif font for its "Custom (system font)" case.');
  return {
    isSystemFontFound: key => getFontDiagnosticForFontKey(key).state === 'ok',
    customFontName,
  };
}

// Built at collection time only when the suite will run: it probes XeLaTeX.
const matrixMachine = runAssemblyPdf ? detectMatrixMachine() : null;
const matrixCasesFor = (archetype: DesignArchetype): WizardMatrixCase[] =>
  matrixMachine ? buildWizardMatrixCases(archetype, matrixMachine) : [];

async function assembleMatrixManuscript(spec: DesignedStyleSpec): Promise<string> {
  // The same derivation CommandRegistrar uses for a style saved by the wizard.
  const behavior = getManuscriptLayoutExportBehavior({
    id: 'designed-matrix', name: 'Matrix', path: 'designed/matrix.tex', origin: 'designed', designedSpec: spec,
  });
  const files = Array.from({ length: 6 }, (_, i) => makeFile(`Scenes/${i + 1} QA Scene ${i + 1}.md`));
  const chapter = (file: TFile, title: string, n: number) => ({ sourcePath: file.path, sourceType: 'Scene' as const, title, resolvedScenePath: file.path, resolvedTimelinePosition: n });
  const chapters = { [files[0].path]: [chapter(files[0], 'QA Chapter One', 1)], [files[3].path]: [chapter(files[3], 'QA Chapter Two', 4)] };
  const paragraph = 'Mara follows the lantern through the garden beside the harbor. The reader can see this paragraph continue across a page while every header and footer keeps its assigned content. ';
  const contents = Object.fromEntries(files.map((file, i) => [file.path,
    `---\nClass: Scene\n${i === 0 || i === 3 ? 'Part: "QA Part & Crossing"\n' : ''}---\n\nQA_SCENE_${i + 1}_START\n\n${Array.from({ length: i === 0 ? 35 : 4 }, () => paragraph).join('\n\n')}\n\nQA_SCENE_${i + 1}_END`,
  ]));
  const assembled = await assembleManuscript(files, makeVault(contents), undefined, false, undefined, false, undefined, undefined, {
    chapterMarkersByScenePath: behavior.suppressChapterMarkers ? {} : chapters,
    sceneHeadingMode: behavior.defaultSceneHeadingMode,
    sceneHeadingRenderMode: behavior.sceneHeadingRenderMode,
    suppressMatterPageChrome: true,
    useRtChapterMacro: behavior.useRtChapterMacro,
    modernClassicStructure: {
      enabled: true,
      partEpigraphs: ['QA_PART_QUOTE_ONE', 'QA_PART_QUOTE_TWO'],
      partEpigraphAttributions: ['QA AUTHOR ONE', 'QA AUTHOR TWO'],
      sceneOpener: spec.scene.opener,
      suppressPartMarkers: behavior.suppressPartMarkers,
      resetSceneCounterOnChapter: spec.chapters.resetSceneCounter,
      partNumberStyle: spec.parts.mode === 'off' ? undefined : spec.parts.mode,
    },
  });
  return sanitizeCompiledManuscriptForPdf(assembled.text, {});
}

describe.skipIf(!runAssemblyPdf)('Design wizard compile matrix', () => {
  it('has the tools it needs', () => {
    for (const cmd of ['pandoc', 'xelatex', 'pdfinfo', 'pdftotext']) {
      expect(commandExists(cmd), `${cmd} must be installed for the wizard compile matrix`).toBe(true);
    }
  });

  for (const archetype of MATRIX_ARCHETYPES) {
    describe.concurrent(archetype, () => {
      it.each(matrixCasesFor(archetype))('$id', async ({ id, apply }) => {
        const spec = cloneArchetypeSpec(archetype);
        apply(spec);
        // In scope: exactly the styles the wizard would let an author save.
        expect(validateDesignedStyleSpec(spec, 'Matrix').errors).toEqual([]);

        const root = process.env.RT_PUBLISH_PDF_ARTIFACT_DIR;
        const dir = root
          ? join(root, 'wizard-matrix', archetype, id.replace(/[^A-Za-z0-9.=()_-]+/g, '_'))
          : mkdtempSync(join(tmpdir(), 'rt-wizard-matrix-'));
        mkdirSync(dir, { recursive: true });
        try {
          const templatePath = join(dir, 'template.tex');
          writeFileSync(templatePath, generateDesignedStyleTex(spec, { bundledLayoutId: 'designed-matrix', vaultFontDir: BUNDLED_FONT_DIR }));
          writeFileSync(join(dir, 'spec.json'), JSON.stringify(spec, null, 2));
          const markdown = await assembleMatrixManuscript(spec);
          writeFileSync(join(dir, 'manuscript.md'), markdown);

          const pdfPath = await runPandocOnContent(markdown, join(dir, 'manuscript.pdf'), {
            targetFormat: 'pdf',
            templatePath,
            workingDir: dir,
            metadata: { title: 'Matrix Audit', author: 'QA Author' },
          });

          expect(existsSync(pdfPath)).toBe(true);
          expect(statSync(pdfPath).size).toBeGreaterThan(0);
          const info = (await execFileAsync('pdfinfo', [pdfPath])).stdout;
          expect(Number(info.match(/^Pages:\s+(\d+)/m)?.[1] ?? 0)).toBeGreaterThanOrEqual(2);
          const text = (await execFileAsync('pdftotext', ['-layout', pdfPath, '-'], { maxBuffer: 32 * 1024 * 1024 })).stdout;
          for (let n = 1; n <= 6; n++) {
            expect(text, `scene ${n} start`).toContain(`QA_SCENE_${n}_START`);
            expect(text, `scene ${n} end`).toContain(`QA_SCENE_${n}_END`);
          }
        } finally { if (!root) rmSync(dir, { recursive: true, force: true }); }
      }, 180_000);
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────
// Imported template compile tests
//
// The evidence behind "Import template…": an author's own LaTeX becomes a
// usable layout only after it has built a PDF, and a file that cannot build
// one leaves nothing behind.
//
// Each case goes through the import dialog's own code (ImportTemplateModal
// with the registration Settings → Publish uses), against a vault that is a
// real folder on disk and the plugin's own Pandoc call. The one stand-in is
// for PDF.js, which exists only inside Obsidian: page count and page size
// are read from the same PDF by Poppler's pdfinfo instead. The first-page
// picture needs a canvas, so no picture is saved here.
// ─────────────────────────────────────────────────────────────────────────

const IMPORT_GOOD_TEMPLATE = String.raw`\documentclass[11pt]{book}
\usepackage[paperwidth=6in,paperheight=9in,margin=0.9in]{geometry}
\usepackage{fancyhdr}
\pagestyle{fancy}
\fancyhf{}
\fancyhead[LE]{$title$}
\fancyhead[RO]{$author$}
\fancyfoot[C]{\thepage}
$for(header-includes)$
$header-includes$
$endfor$
\begin{document}
IMPORTGOODMARK
$body$
\end{document}
`;

// The three definitions the wiki gives for printing parts and chapters
// (wiki/Manuscript-Export.md, "Add chapters and parts"). The test below builds
// a PDF with exactly these lines and checks the wiki still prints them.
const IMPORT_GUIDE_STRUCTURE = String.raw`% Part page. #1 number, #2 title, #3 epigraph, #4 who said it
\newcommand{\rtPart}[4]{\cleardoublepage\thispagestyle{empty}\vspace*{2in}%
  \begin{center}{\LARGE Part #1}\par\bigskip{\Large #2}\par\bigskip{\itshape #3}\par #4\end{center}\cleardoublepage}
% Chapter opening. #1 number, #2 title
\newcommand{\rtChapter}[2]{\clearpage\thispagestyle{plain}\vspace*{1in}%
  \begin{center}{\large Chapter #1}\par\medskip{\LARGE #2}\end{center}\vspace{0.5in}}
% Start of each scene. #1 the scene's number within its part, in lowercase Roman numerals
\newcommand{\rtSceneSep}[1]{\par\bigskip\begin{center}#1\end{center}\par\medskip}`;

const badLatexTemplate = (preamble: string, body = '') => String.raw`\documentclass{book}
` + preamble + String.raw`
\begin{document}
` + body + String.raw`
$body$
\end{document}
`;

// Prints the engine's shell-escape mode into the PDF (0 = off), then tries to
// run a program and to write a file by name.
const IMPORT_PROBE_TEMPLATE = String.raw`\documentclass{article}
\begin{document}
SHELLMODE\ifdefined\shellescape\the\shellescape\else\the\pdfshellescape\fi END
\immediate\write18{touch rt-shell-probe.txt}
\newwrite\rtprobe
\immediate\openout\rtprobe=rt-openout-probe.txt
\immediate\write\rtprobe{x}
\immediate\closeout\rtprobe
$body$
\end{document}
`;

describe.skipIf(!runAssemblyPdf)('Imported template compile', () => {
  let vaultRoot = '';
  let sourceDir = '';
  let harness: ReturnType<typeof makeDiskVaultPlugin>;

  beforeAll(() => {
    // PDF.js's getDocument, answered by pdfinfo and pdftotext run on the same bytes.
    vi.spyOn(obsidian, 'loadPdfJs').mockResolvedValue({
      getDocument: ({ data }: { data: Uint8Array }) => ({
        destroy: async () => undefined,
        promise: (async () => {
          const dir = mkdtempSync(join(tmpdir(), 'rt-import-measure-'));
          try {
            writeFileSync(join(dir, 'measure.pdf'), data);
            const info = (await execFileAsync('pdfinfo', [join(dir, 'measure.pdf')])).stdout;
            const pageTexts = (await execFileAsync('pdftotext', [join(dir, 'measure.pdf'), '-'])).stdout.split('\f');
            const size = /^Page size:\s+([\d.]+) x ([\d.]+) pts/m.exec(info);
            if (!size) throw new Error('pdfinfo gave no page size.');
            return {
              numPages: Number(/^Pages:\s+(\d+)/m.exec(info)?.[1]),
              getPage: async (number: number) => ({
                getViewport: ({ scale }: { scale: number }) => ({ width: Number(size[1]) * scale, height: Number(size[2]) * scale }),
                getTextContent: async () => ({ items: [{ str: pageTexts[number - 1] }] }),
              }),
            };
          } finally { rmSync(dir, { recursive: true, force: true }); }
        })(),
      }),
    });
    // The dialog logs that it could not draw the first page (no canvas here).
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vaultRoot = mkdtempSync(join(tmpdir(), 'rt-import-vault-'));
    sourceDir = mkdtempSync(join(tmpdir(), 'rt-import-source-'));
    harness = makeDiskVaultPlugin(vaultRoot);
  });
  afterAll(() => {
    vi.restoreAllMocks();
    rmSync(vaultRoot, { recursive: true, force: true });
    rmSync(sourceDir, { recursive: true, force: true });
  });

  const writeSource = (name: string, text: string): string => {
    const path = join(sourceDir, name);
    writeFileSync(path, text);
    return path;
  };
  /** Choose a file in the import dialog, name it, and press Save. */
  const importThroughDialog = async (sourcePath: string, name?: string) => {
    const modal = new ImportTemplateModal(harness.plugin.app, harness.plugin, async (commit: ImportedTemplateCommit) => {
      await registerImportedTemplate(harness.plugin, commit.layout, commit.templateText, commit.record, commit.firstPagePng);
    });
    modal['sourcePath'] = sourcePath;
    if (name) { modal['templateName'] = name; modal['templateNameTouched'] = true; }
    await modal['refreshCandidate']();
    await modal['commit']();
    return modal;
  };
  const pandocFiles = () => harness.listFiles().filter(file => file.startsWith('Radial Timeline/Pandoc/'));
  const layouts = () => harness.plugin.settings.pandocLayouts;

  it('imports a good template from outside the vault: copy, record, and a PDF that prints the manuscript', async () => {
    const source = writeSource('My Book.tex', IMPORT_GOOD_TEMPLATE);
    await importThroughDialog(source);

    expect(layouts()).toHaveLength(1);
    const layout = layouts()[0];
    expect(layout).toMatchObject({ id: 'imported-my-book-novel', name: 'My Book', origin: 'imported', path: 'Radial Timeline/Pandoc/imported/my-book.tex', draft: false });
    // Radial Timeline's copy is the author's text, byte for byte; the author's file is as it was.
    expect(readFileSync(harness.abs(layout.path), 'utf8')).toBe(IMPORT_GOOD_TEMPLATE);
    expect(readFileSync(source, 'utf8')).toBe(IMPORT_GOOD_TEMPLATE);
    expect(layout.importCheck).toMatchObject({ schemaVersion: 1, sha256: hashTemplateText(IMPORT_GOOD_TEMPLATE) });
    expect(getImportedTemplateState(harness.plugin, layout)).toBe('ready');
    // Measured from the test PDF: the 6 × 9 in page the template sets, and more than one page.
    expect(layout.importCheck?.pages).toBeGreaterThanOrEqual(2);
    expect(Math.round(layout.importCheck!.pageWidthPt)).toBe(432);
    expect(Math.round(layout.importCheck!.pageHeightPt)).toBe(648);
    // This template has no title page: the sample manuscript starts on page 1.
    expect(layout.importCheck?.samplePage).toBe(1);
    // What the layout's row says: read from the file and measured, nothing guessed.
    const rows = Object.fromEntries(buildImportedTemplateFactRows({ facts: readTemplateFacts(IMPORT_GOOD_TEMPLATE), check: layout.importCheck, copyPath: layout.path }).map(row => [row.label, row.value]));
    expect(rows['Test PDF']).toMatch(new RegExp(`^${layout.importCheck!.pages} pages, 6 × 9 in, built `));
    expect(rows).toMatchObject({ 'Document class': 'book (11pt)', Fonts: 'None named', 'LaTeX packages': 'geometry, fancyhdr', 'Book Details': 'Title and author' });

    // The PDF an export with this layout builds, kept where it can be read.
    const root = process.env.RT_PUBLISH_PDF_ARTIFACT_DIR;
    const exportDir = root ? join(root, 'import-template', 'good') : mkdtempSync(join(tmpdir(), 'rt-import-export-'));
    mkdirSync(exportDir, { recursive: true });
    try {
      const pdfPath = await runPandocOnContent(await buildImportedTemplateCheckManuscript(layout), join(exportDir, 'imported.pdf'), {
        targetFormat: 'pdf', templatePath: harness.abs(layout.path), workingDir: exportDir, disableShellEscape: true,
        metadata: { title: 'Import Audit', author: 'QA Author' },
      });
      const info = (await execFileAsync('pdfinfo', [pdfPath])).stdout;
      expect(Number(info.match(/^Pages:\s+(\d+)/m)?.[1] ?? 0)).toBeGreaterThanOrEqual(2);
      // Rejoin words LaTeX hyphenated at a line end, then flatten line breaks.
      const text = (await execFileAsync('pdftotext', ['-layout', pdfPath, '-'])).stdout.replace(/-\n\s*/g, '').replace(/\s+/g, ' ');
      for (const phrase of [...IMPORTED_TEMPLATE_CHECK_PHRASES, 'IMPORTGOODMARK', 'Import Audit', 'The Harbor', 'The Crossing']) expect(text).toContain(phrase);
      // The page count on record is the count of this same build.
      expect(Number(info.match(/^Pages:\s+(\d+)/m)?.[1])).toBe(layout.importCheck?.pages);
      // No scratch files beside the PDF.
      expect(readdirSync(exportDir).filter(name => name !== 'imported.pdf')).toEqual([]);
    } finally { if (!root) rmSync(exportDir, { recursive: true, force: true }); }
  }, 120_000);

  it('imports a template picked inside the vault, and never reuses a name another file holds', async () => {
    mkdirSync(harness.abs('Templates'), { recursive: true });
    writeFileSync(harness.abs('Templates/My Book.tex'), IMPORT_GOOD_TEMPLATE);
    const before = layouts().length;
    await importThroughDialog('Templates/My Book.tex');
    expect(layouts()).toHaveLength(before + 1);
    const layout = layouts()[layouts().length - 1];
    // The first import took my-book.tex; this one gets its own file and id.
    expect(layout).toMatchObject({ id: 'imported-my-book-novel-2', path: 'Radial Timeline/Pandoc/imported/my-book-2.tex' });
    expect(readFileSync(harness.abs('Templates/My Book.tex'), 'utf8')).toBe(IMPORT_GOOD_TEMPLATE);
    expect(getImportedTemplateState(harness.plugin, layout)).toBe('ready');
  }, 120_000);

  it('imports an edited copy of a built-in layout with its part, chapter and scene macros', async () => {
    const source = writeSource('Signature Edit.tex', generateDesignedStyleTex(BUNDLED_FICTION_SPECS['bundled-fiction-modern-classic'], { vaultFontDir: BUNDLED_FONT_DIR }));
    const before = layouts().length;
    await importThroughDialog(source, 'House Style');
    expect(layouts()).toHaveLength(before + 1);
    const layout = layouts()[layouts().length - 1];
    expect(layout.usesModernClassicStructure).toBe(true);
    // The test PDF was built from \rtPart, \rtChapter and \rtSceneSep calls, as an export will send them.
    const markdown = await buildImportedTemplateCheckManuscript(layout);
    for (const macro of ['\\rtPart{', '\\rtChapter{', '\\rtSceneSep{']) expect(markdown).toContain(macro);
  }, 120_000);

  it('prints parts and chapters once a template adds the three definitions the wiki gives', async () => {
    // The wiki shows these lines as they are tested here.
    const wiki = readFileSync(join(process.cwd(), 'wiki', 'Manuscript-Export.md'), 'utf8');
    expect(wiki).toContain(IMPORT_GUIDE_STRUCTURE);
    const template = IMPORT_GOOD_TEMPLATE.replace('\\begin{document}', () => `${IMPORT_GUIDE_STRUCTURE}\n\\begin{document}`);
    // Before: no parts or chapters. After: sent through the template's own definitions.
    expect(readTemplateFacts(IMPORT_GOOD_TEMPLATE).structuralMacros).toBe(false);
    expect(readTemplateFacts(template).structuralMacros).toBe(true);
    const source = writeSource('Guide Structure.tex', template);
    await importThroughDialog(source);
    const layout = layouts()[layouts().length - 1];
    expect(layout.usesModernClassicStructure).toBe(true);
    expect(getImportedTemplateState(harness.plugin, layout)).toBe('ready');

    const exportDir = mkdtempSync(join(tmpdir(), 'rt-import-guide-'));
    try {
      const pdfPath = await runPandocOnContent(await buildImportedTemplateCheckManuscript(layout), join(exportDir, 'guide.pdf'), {
        targetFormat: 'pdf', templatePath: harness.abs(layout.path), workingDir: exportDir, disableShellEscape: true,
        metadata: { title: 'Import Audit', author: 'QA Author' },
      });
      const text = (await execFileAsync('pdftotext', ['-layout', pdfPath, '-'])).stdout.replace(/-\n\s*/g, '').replace(/\s+/g, ' ');
      // The part page, both chapter openings, and every line of the sample manuscript.
      for (const phrase of ['Part I', 'Chapter 1 Chapter One', 'Chapter 2 Chapter Two', ...IMPORTED_TEMPLATE_CHECK_PHRASES]) expect(text).toContain(phrase);
      // Scenes arrive as numbered breaks on this path, not as titled headings.
      expect(text).not.toContain('The Harbor');
    } finally { rmSync(exportDir, { recursive: true, force: true }); }
  }, 120_000);

  const badCases: Array<{ id: string; file: string; text: string; issue?: string; latex?: RegExp; cause?: { kind: 'font' | 'package'; name: string } | null; prepare?: (path: string) => void; restore?: (path: string) => void }> = [
    { id: 'an empty file', file: 'empty.tex', text: '', issue: 'import_empty' },
    {
      id: 'a file that cannot be read', file: 'locked.tex', text: IMPORT_GOOD_TEMPLATE, issue: 'import_source_unreadable',
      prepare: path => chmodSync(path, 0o000), restore: path => chmodSync(path, 0o644),
    },
    { id: 'a template without $body$', file: 'nobody.tex', text: badLatexTemplate('').replace('$body$', 'No placeholder here.'), issue: 'import_missing_body' },
    { id: 'a font that is not installed', file: 'nofont.tex', text: badLatexTemplate(String.raw`\usepackage{fontspec}` + '\n' + String.raw`\setmainfont{RT No Such Font Anywhere}`), latex: /RT No Such Font Anywhere/, cause: { kind: 'font', name: 'RT No Such Font Anywhere' } },
    { id: 'a package that is not installed', file: 'nopackage.tex', text: badLatexTemplate(String.raw`\usepackage{rtnosuchpackage}`), latex: /rtnosuchpackage\.sty' not found/, cause: { kind: 'package', name: 'rtnosuchpackage' } },
    { id: 'a plain LaTeX error', file: 'latexerror.tex', text: badLatexTemplate('', String.raw`\thisMacroDoesNotExist`), latex: /Undefined control sequence[\s\S]*thisMacroDoesNotExist/, cause: null },
  ];

  it.each(badCases)('keeps $id inactive and says why', async ({ file, text, issue, latex, cause, prepare, restore }) => {
    // chmod cannot lock a file from root, so that case proves nothing there.
    if (prepare && process.getuid?.() === 0) return;
    const source = writeSource(file, text);
    const layoutsBefore = structuredClone(layouts());
    const filesBefore = pandocFiles();
    harness.saveSettings.mockClear();
    prepare?.(source);
    let modal: ImportTemplateModal;
    try { modal = await importThroughDialog(source); }
    finally { restore?.(source); }

    // Nothing registered, nothing written, the author's file as it was.
    expect(layouts()).toEqual(layoutsBefore);
    expect(pandocFiles()).toEqual(filesBefore);
    expect(harness.saveSettings).not.toHaveBeenCalled();
    expect(readFileSync(source, 'utf8')).toBe(text);

    const candidate = modal['candidate'];
    const check = modal['check'];
    if (issue) {
      expect(candidate?.canActivate).toBe(false);
      const found = candidate?.issues.find(item => item.code === issue);
      expect(found?.message.length ?? 0).toBeGreaterThan(20);
      expect(check.state).toBe('idle');
    } else {
      expect(check.state).toBe('failed');
      if (check.state !== 'failed') return;
      expect(check.reason).toBe('latex');
      // LaTeX's own lines, short enough to read: not the whole log.
      expect(check.latexLines.length).toBeGreaterThan(0);
      expect(check.latexLines.length).toBeLessThanOrEqual(9);
      expect(check.latexLines.join('\n')).toMatch(latex!);
      // A font or package this computer lacks is named, so the dialog can say so in plain words.
      expect(check.cause).toEqual(cause);
    }
    // The dialog is on the Check step, where the reason is shown.
    expect(modal['step']).toBe(2);
  }, 120_000);

  it('leaves nothing behind when the settings save fails, and imports cleanly on the next try', async () => {
    const source = writeSource('Retry.tex', IMPORT_GOOD_TEMPLATE);
    const layoutsBefore = structuredClone(layouts());
    const filesBefore = pandocFiles();
    harness.saveSettings.mockRejectedValueOnce(new Error('QA write denied'));
    await importThroughDialog(source);
    expect(layouts()).toEqual(layoutsBefore);
    expect(pandocFiles()).toEqual(filesBefore);

    await importThroughDialog(source);
    expect(layouts()).toHaveLength(layoutsBefore.length + 1);
    expect(pandocFiles()).toContain('Radial Timeline/Pandoc/imported/retry.tex');
  }, 120_000);

  it('never replaces a file already in the imported folder', async () => {
    mkdirSync(harness.abs('Radial Timeline/Pandoc/imported'), { recursive: true });
    writeFileSync(harness.abs('Radial Timeline/Pandoc/imported/orphan.tex'), 'ORPHAN_SENTINEL');
    await importThroughDialog(writeSource('Orphan.tex', IMPORT_GOOD_TEMPLATE));
    expect(readFileSync(harness.abs('Radial Timeline/Pandoc/imported/orphan.tex'), 'utf8')).toBe('ORPHAN_SENTINEL');
    expect(layouts()[layouts().length - 1].path).toBe('Radial Timeline/Pandoc/imported/orphan-2.tex');
  }, 120_000);

  it('reports a changed, broken or deleted template and stays unusable until a check passes', async () => {
    const layout = layouts().find(item => item.id === 'imported-my-book-novel')!;
    const file = harness.abs(layout.path);
    const firstRecord = structuredClone(layout.importCheck);

    // Edited: not ready until checked again; a good edit passes and is recorded.
    const edited = IMPORT_GOOD_TEMPLATE.replace('IMPORTGOODMARK', 'IMPORTEDITEDMARK');
    writeFileSync(file, edited);
    expect(getImportedTemplateState(harness.plugin, layout)).toBe('changed');
    const passed = await recheckImportedTemplate(harness.plugin, layout);
    expect(passed.ok).toBe(true);
    expect(layout.importCheck?.sha256).toBe(hashTemplateText(edited));
    expect(layout.importCheck?.sha256).not.toBe(firstRecord?.sha256);
    expect(getImportedTemplateState(harness.plugin, layout)).toBe('ready');

    // Broken: the check fails with LaTeX's lines, and nothing is recorded.
    const goodRecord = structuredClone(layout.importCheck);
    writeFileSync(file, edited.replace('IMPORTEDITEDMARK', String.raw`\thisMacroDoesNotExist`));
    harness.saveSettings.mockClear();
    const failed = await recheckImportedTemplate(harness.plugin, layout);
    expect(failed.ok).toBe(false);
    if (!failed.ok) expect(failed.latexLines.join('\n')).toMatch(/Undefined control sequence/);
    expect(layout.importCheck).toEqual(goodRecord);
    expect(harness.saveSettings).not.toHaveBeenCalled();
    expect(getImportedTemplateState(harness.plugin, layout)).toBe('changed');

    // The same vault on a second computer: not ready until it builds a test PDF there.
    harness.moveToAnotherComputer();
    writeFileSync(file, edited);
    expect(getImportedTemplateState(harness.plugin, layout)).toBe('unchecked');
    expect((await recheckImportedTemplate(harness.plugin, layout)).ok).toBe(true);
    expect(getImportedTemplateState(harness.plugin, layout)).toBe('ready');

    // Deleted.
    rmSync(file);
    expect(getImportedTemplateState(harness.plugin, layout)).toBe('missing');
    const missing = await recheckImportedTemplate(harness.plugin, layout);
    expect(missing).toMatchObject({ ok: false, reason: 'missing' });
  }, 120_000);

  it('builds an imported template with shell escape off and no scratch files in the working folder', async () => {
    const layout = { id: 'imported-probe-novel', name: 'Probe', preset: 'novel' as const, path: 'probe.tex', origin: 'imported' as const };
    // The import check passes this template: neither attempt is an error.
    expect((await runImportedTemplateCheck({ layout, templateText: IMPORT_PROBE_TEMPLATE })).ok).toBe(true);

    const dir = mkdtempSync(join(tmpdir(), 'rt-import-probe-'));
    try {
      const templatePath = join(dir, 'probe.tex');
      writeFileSync(templatePath, IMPORT_PROBE_TEMPLATE);
      const exportDir = join(dir, 'Export');
      mkdirSync(exportDir);
      const pdfPath = await runPandocOnContent(await buildImportedTemplateCheckManuscript(layout), join(exportDir, 'probe.pdf'), {
        targetFormat: 'pdf', templatePath, workingDir: exportDir, disableShellEscape: true,
      });
      const text = (await execFileAsync('pdftotext', ['-layout', pdfPath, '-'])).stdout;
      // TeX takes the space after the number, so the PDF reads "SHELLMODE0END".
      expect(text).toMatch(/SHELLMODE0\s*END/);
      // Only the PDF: no program ran, the named file went to Pandoc's own
      // temporary folder, and the staging folder is gone.
      expect(readdirSync(exportDir)).toEqual(['probe.pdf']);
      expect(readdirSync(dir).sort()).toEqual(['Export', 'probe.tex']);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }, 120_000);

  it('reduces what LaTeX printed to the lines of its first error', () => {
    const raw = "Error producing PDF.\n! LaTeX Error: File `rtnosuchpackage.sty' not found.\n\nType X to quit or <RETURN> to proceed,\nor enter new name. (Default extension: sty)\n\nEnter file name: \n! Emergency stop.\n<read *> \n         \nl.3 \\begin\n\n";
    expect(extractLatexErrorLines(raw)).toEqual(["! LaTeX Error: File `rtnosuchpackage.sty' not found.", '! Emergency stop.', 'l.3 \\begin']);
  });
});
