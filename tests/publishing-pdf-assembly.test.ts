import { makeFile } from './helpers/obsidianFixtures';
import { describe, expect, it } from 'vitest';
import type { TFile, Vault } from 'obsidian';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { assembleManuscript } from '../src/utils/manuscript';
import { getManuscriptLayoutExportBehavior } from '../src/utils/manuscriptLayoutExport';
import { sanitizeCompiledManuscriptForPdf } from '../src/utils/manuscriptSanitize';
import { BUNDLED_FICTION_SPECS } from '../src/publishing/bundledStyleSpecs';
import { generateDesignedStyleTex } from '../src/publishing/designedStyle';

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
