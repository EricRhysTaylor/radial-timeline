import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync, copyFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import { BUNDLED_FICTION_SPECS } from '../src/publishing/bundledStyleSpecs.ts';
import { generateDesignedStyleTex } from '../src/publishing/designedStyle.ts';
import { WIZARD_FIXTURES } from './wizard-pdf-fixtures.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const args = new Set(process.argv.slice(2));
const updateBaselines = args.has('--update-baselines');
const visual = args.has('--visual') || updateBaselines;
const keepOutput = args.has('--keep-output');
const wizardOnly = args.has('--wizard-fixtures');

const outputArgIndex = process.argv.indexOf('--output');
const outputRoot = outputArgIndex >= 0 && process.argv[outputArgIndex + 1]
    ? resolve(process.argv[outputArgIndex + 1])
    : join(repoRoot, 'tmp', 'publishing-pdf-qa');

const baselineRoot = join(repoRoot, 'tests', 'fixtures', 'publishing-pdf-baselines');
const fontRoot = join(repoRoot, 'src', 'assets', 'fonts');
const contemporaryLongScene = Array.from({ length: 20 }, () => (
    'The first scene continues across pages so the PDF text audit can verify the right-page running header. The prose itself avoids the scene title, which means an extracted title hit must come from the header or opener chrome.'
)).join('\n\n');

const layouts = [
    {
        id: 'bundled-fiction-classic-manuscript',
        slug: 'standard-manuscript',
        expectedPages: 2,
        body: String.raw`\rtSceneOpener{1}
\rtSetSceneRunningTitle{Arrival}

First paragraph of the first scene. More words occupy the page and exercise body text after the opener.

\rtSceneOpener{2}
\rtSetSceneRunningTitle{The Garden}

Second scene body text follows the opener.
`,
    },
    {
        id: 'bundled-fiction-contemporary-literary',
        slug: 'contemporary-literary',
        expectedPages: 7,
        expectedLatexText: ['\\rtSetSceneRunningTitle{Arrival}'],
        forbiddenLatexText: ['\\markboth{}{Arrival}'],
        expectedPageText: [
            { page: 3, text: 'Arrival' },
            { page: 4, text: 'Audit Book' },
        ],
        body: String.raw`\rtChapter{1}{Boy with a Skull}

\rtSceneOpener{1}
\rtSetSceneRunningTitle{Arrival}

${contemporaryLongScene}

\rtSceneOpener{2}
\rtSetSceneRunningTitle{The Garden}

Second scene body text follows the opener.

\rtChapter{2}{New Horizons}

\rtSceneOpener{3}
\rtSetSceneRunningTitle{Departure}

Third scene body text starts the second chapter.
`,
    },
    {
        id: 'bundled-fiction-signature-literary',
        slug: 'signature-literary',
        expectedPages: 2,
        body: String.raw`\rtSceneOpener{1\\{\normalsize (Arrival)}}
\rtSetSceneRunningTitle{Arrival}

First paragraph of the first scene. More words occupy the page and exercise body text after the opener.

\rtSceneOpener{2\\{\normalsize (The Garden)}}
\rtSetSceneRunningTitle{The Garden}

Second scene body text follows the opener.
`,
    },
    {
        id: 'bundled-fiction-modern-classic',
        slug: 'modern-classic',
        expectedPages: 7,
        expectedPageText: [
            { page: 1, text: 'I' },
            { page: 1, text: 'A precise line.' },
            { page: 1, text: 'AUTHOR A' },
            { page: 3, text: 'i.' },
            { page: 3, text: 'First paragraph of chapter one.' },
            { page: 5, text: 'Most merry' },
            { page: 5, text: 'ARTHUR RIMBAUD' },
        ],
        forbiddenPageText: [
            { page: 1, text: 'PART I' },
            { page: 2, text: 'A precise line.' },
            { page: 3, text: 'Audit Book' },
            { page: 3, text: 'Audit Author' },
        ],
        body: String.raw`\rtPart{I}{A precise line.}{Author A}

\rtChapter{1}{Boy with a Skull}

\rtSceneSep{i}

First paragraph of chapter one.

\rtSceneSep{ii}

Second scene body text follows an inline roman separator.

\rtPart{II}{When we are strongest — who draws back?\\
Most merry — who falls down laughing?\\
When we are very bad, what can they do to us?}{Arthur Rimbaud}

\rtChapter{2}{New Horizons}

\rtSceneSep{i}

Third scene body text starts the second act.
`,
    },
];

function commandPath(name) {
    const result = spawnSync('which', [name], { encoding: 'utf8' });
    return result.status === 0 ? result.stdout.trim() : '';
}

function run(command, argv, options = {}) {
    const result = spawnSync(command, argv, {
        cwd: options.cwd ?? repoRoot,
        encoding: options.encoding ?? 'utf8',
        stdio: options.stdio ?? 'pipe',
    });
    if (result.status !== 0) {
        const stdout = result.stdout ? `\nstdout:\n${result.stdout}` : '';
        const stderr = result.stderr ? `\nstderr:\n${result.stderr}` : '';
        throw new Error(`${command} ${argv.join(' ')} failed with exit ${result.status}.${stdout}${stderr}`);
    }
    return result;
}

function requireCommand(name, installHint) {
    const found = commandPath(name);
    if (!found) {
        throw new Error(`Missing required command "${name}". ${installHint}`);
    }
    return found;
}

function pdfInfo(pdfPath) {
    const result = run('pdfinfo', [pdfPath]);
    const pages = Number((result.stdout.match(/^Pages:\s+(\d+)/m) ?? [])[1]);
    const pageSize = (result.stdout.match(/^Page size:\s+(.+)$/m) ?? [])[1] ?? '';
    return { pages, pageSize };
}

function pdfText(pdfPath, page) {
    const pageArgs = page ? ['-f', String(page), '-l', String(page)] : [];
    return run('pdftotext', ['-layout', ...pageArgs, pdfPath, '-']).stdout;
}

function rasterize(pdfPath, outDir) {
    rmSync(outDir, { recursive: true, force: true });
    mkdirSync(outDir, { recursive: true });
    const prefix = join(outDir, 'page');
    run('pdftoppm', ['-png', '-r', '72', pdfPath, prefix]);
    return readdirSync(outDir)
        .filter(name => /^page-\d+\.png$/.test(name))
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
        .map(name => join(outDir, name));
}

function readPng(path) {
    return PNG.sync.read(readFileSync(path));
}

function comparePng(actualPath, expectedPath, diffPath) {
    const actual = readPng(actualPath);
    const expected = readPng(expectedPath);
    if (actual.width !== expected.width || actual.height !== expected.height) {
        throw new Error(`PNG dimensions differ for ${actualPath}: actual ${actual.width}x${actual.height}, expected ${expected.width}x${expected.height}`);
    }
    const diff = new PNG({ width: actual.width, height: actual.height });
    const diffPixels = pixelmatch(
        actual.data,
        expected.data,
        diff.data,
        actual.width,
        actual.height,
        { threshold: 0.1, includeAA: false }
    );
    if (diffPixels > 0) {
        writeFileSync(diffPath, PNG.sync.write(diff));
    }
    return diffPixels;
}

function updateBaseline(slug, actualPages) {
    const targetDir = join(baselineRoot, slug);
    rmSync(targetDir, { recursive: true, force: true });
    mkdirSync(targetDir, { recursive: true });
    actualPages.forEach((page, index) => {
        copyFileSync(page, join(targetDir, `page-${String(index + 1).padStart(2, '0')}.png`));
    });
}

function compareBaseline(slug, actualPages, diffDir) {
    const targetDir = join(baselineRoot, slug);
    if (!existsSync(targetDir)) {
        throw new Error(`Missing PDF visual baseline for ${slug}. Run npm run publish:pdf-baseline.`);
    }
    const expectedPages = readdirSync(targetDir)
        .filter(name => /^page-\d+\.png$/.test(name))
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
        .map(name => join(targetDir, name));
    if (actualPages.length !== expectedPages.length) {
        throw new Error(`${slug} page-count baseline mismatch: actual ${actualPages.length}, expected ${expectedPages.length}`);
    }
    mkdirSync(diffDir, { recursive: true });
    let totalDiffPixels = 0;
    actualPages.forEach((actual, index) => {
        const diffPath = join(diffDir, `page-${String(index + 1).padStart(2, '0')}.diff.png`);
        totalDiffPixels += comparePng(actual, expectedPages[index], diffPath);
    });
    return totalDiffPixels;
}

/**
 * Modern Classic uses Latin Modern, which is NOT bundled: it ships with every
 * TeX distribution. The contract is that it resolves from the texmf tree by
 * FILE NAME, never by family name — verified on macOS + TeX Live 2026:
 *
 *   \setmainfont{Latin Modern Roman}      → fontspec: "cannot be found"
 *   \setmainfont{lmroman10-regular.otf}   → compiles
 *
 * Emitting the family-name form was the PDF half of GH #34. This asserts the
 * emitted form is the one that actually compiles, and then compiles it with
 * no vault font directory at all — the state of a real user's machine.
 */
function assertModernClassicResolvesLatinModernFromTexTree(spec, layoutDir) {
    // No vaultFontDir: exactly what a user has, since Latin Modern is never
    // written into the vault.
    const tex = generateDesignedStyleTex(spec, {
        bundledLayoutId: 'bundled-fiction-modern-classic',
    });
    if (tex.includes('\\setmainfont{Latin Modern Roman}')) {
        throw new Error('Modern Classic emitted the Latin Modern family-name form, which does not resolve on a stock TeX install (GH #34).');
    }
    if (!tex.includes('\\setmainfont{lmroman10-regular.otf}')) {
        throw new Error('Modern Classic must emit the Latin Modern TeX filename form so kpathsea resolves it from the texmf tree.');
    }
    if (/Path\s*=.*latin-modern/.test(tex)) {
        throw new Error('Modern Classic generated a Latin Modern Path directive; it must resolve from the TeX tree, not a bundled copy.');
    }

    const texPath = join(layoutDir, 'modern-classic-tex-tree.tex');
    const mdPath = join(layoutDir, 'modern-classic-tex-tree.md');
    const pdfPath = join(layoutDir, 'modern-classic-tex-tree.pdf');
    writeFileSync(texPath, tex);
    writeFileSync(mdPath, [
        '---',
        'title: Audit Book',
        'author: E. R. Taylor',
        '---',
        '',
        '\\rtPart{I}{A quote}{J. Name}',
        '\\rtChapter{1}{Chapter One}',
        '\\rtSceneSep{ii}',
        'Modern Classic font smoke.',
    ].join('\n'));
    // Must compile with no bundled fonts anywhere — that is the whole point.
    run('pandoc', [
        mdPath,
        '--from', 'markdown+raw_tex',
        '--pdf-engine', 'xelatex',
        '--template', texPath,
        '-o', pdfPath,
    ]);
    if (!existsSync(pdfPath)) {
        throw new Error('Modern Classic did not produce a PDF from the TeX-tree font path.');
    }
}

function writeReadme() {
    mkdirSync(baselineRoot, { recursive: true });
    const readme = `# Publishing PDF Visual Baselines

These PNGs are generated by \`npm run publish:pdf-baseline\` from deterministic Pandoc/XeLaTeX fixture PDFs.

Run \`npm run publish:pdf-smoke\` for compile/page-count checks.
Run \`npm run publish:pdf-assembly\` to verify the real manuscript assembler output survives Pandoc macro expansion and renders expected page headers.
Run \`npm run publish:pdf-visual\` to rasterize PDFs with Poppler and compare them to these baselines.

Required local tools:

- pandoc
- xelatex
- pdfinfo, pdftotext, and pdftoppm from Poppler

Do not edit baseline PNGs by hand.
`;
    writeFileSync(join(baselineRoot, 'README.md'), readme);
}

/**
 * Compile-gate runner for wizard-shaped specs. Iterates WIZARD_FIXTURES,
 * generates .tex via the same generator the wizard uses (no bundledLayoutId),
 * runs pandoc + xelatex, asserts the PDF compiles and has at least
 * minExpectedPages. Failures collect into the shared `failures` array.
 *
 * When `--visual` is set, also rasterizes each PDF and pixel-diffs against
 * baselines in `tests/fixtures/publishing-pdf-baselines/<slug>/`. When
 * `--update-baselines` is set, regenerates them.
 */
function runWizardFixtures(failures) {
    for (const fixture of WIZARD_FIXTURES) {
        const layoutDir = join(outputRoot, fixture.slug);
        mkdirSync(layoutDir, { recursive: true });
        const texPath = join(layoutDir, `${fixture.slug}.tex`);
        const mdPath  = join(layoutDir, `${fixture.slug}.md`);
        const pdfPath = join(layoutDir, `${fixture.slug}.pdf`);
        try {
            const tex = generateDesignedStyleTex(fixture.spec, {
                vaultFontDir: fontRoot,
            });
            writeFileSync(texPath, tex);
            writeFileSync(mdPath, fixture.body);
            run('pandoc', [
                mdPath,
                '--from=markdown+raw_tex',
                '--pdf-engine=xelatex',
                `--template=${texPath}`,
                '-V', 'title=Wizard Fixture',
                '-V', 'author=Wizard Author',
                '-o', pdfPath,
            ]);
            const info = pdfInfo(pdfPath);
            if (info.pages < fixture.minExpectedPages) {
                throw new Error(`${fixture.slug} expected at least ${fixture.minExpectedPages} pages, got ${info.pages}`);
            }
            if (visual) {
                const actualPages = rasterize(pdfPath, join(layoutDir, 'pages'));
                if (updateBaselines) {
                    updateBaseline(fixture.slug, actualPages);
                } else {
                    const diffPixels = compareBaseline(fixture.slug, actualPages, join(layoutDir, 'diffs'));
                    if (diffPixels > 0) {
                        throw new Error(`${fixture.slug} visual baseline differs by ${diffPixels} pixels. Diffs: ${join(layoutDir, 'diffs')}`);
                    }
                }
            }
            console.log(`✓ ${fixture.slug}: ${info.pages} pages`);
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            failures.push(`${fixture.slug}: ${msg}`);
            console.error(`✗ ${fixture.slug}: ${msg}`);
        }
    }
    if (updateBaselines) writeReadme();
}

/** Shared exit handling — used by both main() and the wizard branch. */
function finalize(failures) {
    if (failures.length > 0) {
        if (!keepOutput) console.error(`Artifacts preserved for debugging: ${outputRoot}`);
        process.exitCode = 1;
        return;
    }
    if (!keepOutput && !updateBaselines) {
        rmSync(outputRoot, { recursive: true, force: true });
    }
    console.log(`Publishing PDF QA passed.${keepOutput ? ` Artifacts: ${outputRoot}` : ''}`);
}

function main() {
    requireCommand('pandoc', 'Install Pandoc first.');
    requireCommand('xelatex', 'Install a TeX distribution with XeLaTeX first.');
    requireCommand('pdfinfo', 'Install Poppler first. On macOS: brew install poppler.');
    requireCommand('pdftotext', 'Install Poppler first. On macOS: brew install poppler.');
    if (visual) {
        requireCommand('pdftoppm', 'Install Poppler first. On macOS: brew install poppler.');
    }

    rmSync(outputRoot, { recursive: true, force: true });
    mkdirSync(outputRoot, { recursive: true });
    const failures = [];

    // --wizard-fixtures swaps in the wizard-shaped spec set instead of the
    // bundled-template QA. The wizard set is a compile-gate floor: each spec
    // must produce a PDF with at least minExpectedPages. No text-content or
    // visual-baseline assertions — the property test + bundled QA cover those.
    if (wizardOnly) {
        runWizardFixtures(failures);
        finalize(failures);
        return;
    }

    for (const layout of layouts) {
        const spec = BUNDLED_FICTION_SPECS[layout.id];
        const layoutDir = join(outputRoot, layout.slug);
        mkdirSync(layoutDir, { recursive: true });
        const texPath = join(layoutDir, `${layout.slug}.tex`);
        const mdPath = join(layoutDir, `${layout.slug}.md`);
        const pdfPath = join(layoutDir, `${layout.slug}.pdf`);
        const expandedTexPath = join(layoutDir, `${layout.slug}.expanded.tex`);
        writeFileSync(texPath, generateDesignedStyleTex(spec, {
            bundledLayoutId: layout.id,
            vaultFontDir: fontRoot,
        }));
        writeFileSync(mdPath, layout.body);

        try {
            if (layout.id === 'bundled-fiction-modern-classic') {
                assertModernClassicResolvesLatinModernFromTexTree(spec, layoutDir);
            }
            run('pandoc', [
                mdPath,
                '--from=markdown',
                '--pdf-engine=xelatex',
                `--template=${texPath}`,
                '-V',
                'title=Audit Book',
                '-V',
                'author=Audit Author',
                '-o',
                pdfPath,
            ]);
            if (layout.expectedLatexText?.length || layout.forbiddenLatexText?.length) {
                run('pandoc', [
                    mdPath,
                    '--from=markdown',
                    '--to=latex',
                    '--standalone',
                    `--template=${texPath}`,
                    '-V',
                    'title=Audit Book',
                    '-V',
                    'author=Audit Author',
                    '-o',
                    expandedTexPath,
                ]);
                const expandedTex = readFileSync(expandedTexPath, 'utf8');
                const missingLatex = (layout.expectedLatexText || []).filter(text => !expandedTex.includes(text));
                if (missingLatex.length > 0) {
                    throw new Error(`${layout.slug} expanded LaTeX is missing expected macro text: ${missingLatex.join(', ')}`);
                }
                const forbiddenLatex = (layout.forbiddenLatexText || []).filter(text => expandedTex.includes(text));
                if (forbiddenLatex.length > 0) {
                    throw new Error(`${layout.slug} expanded LaTeX contains forbidden macro expansion: ${forbiddenLatex.join(', ')}`);
                }
            }
            const info = pdfInfo(pdfPath);
            if (info.pages !== layout.expectedPages) {
                throw new Error(`${layout.slug} expected ${layout.expectedPages} pages, got ${info.pages}`);
            }
            if (!/432 x 648 pts/.test(info.pageSize)) {
                throw new Error(`${layout.slug} expected 6x9 page size (432 x 648 pts), got "${info.pageSize}"`);
            }
            if (layout.expectedPageText?.length) {
                const missing = layout.expectedPageText.filter(({ page, text }) => !pdfText(pdfPath, page).includes(text));
                if (missing.length > 0) {
                    throw new Error(`${layout.slug} PDF page text is missing expected header/body text: ${missing.map(({ page, text }) => `page ${page}: ${text}`).join(', ')}`);
                }
            }
            if (layout.forbiddenPageText?.length) {
                const present = layout.forbiddenPageText.filter(({ page, text }) => pdfText(pdfPath, page).includes(text));
                if (present.length > 0) {
                    throw new Error(`${layout.slug} PDF page text contains forbidden text: ${present.map(({ page, text }) => `page ${page}: ${text}`).join(', ')}`);
                }
            }
            if (visual) {
                const actualPages = rasterize(pdfPath, join(layoutDir, 'pages'));
                if (updateBaselines) {
                    updateBaseline(layout.slug, actualPages);
                } else {
                    const diffPixels = compareBaseline(layout.slug, actualPages, join(layoutDir, 'diffs'));
                    if (diffPixels > 0) {
                        throw new Error(`${layout.slug} visual baseline differs by ${diffPixels} pixels. Diffs: ${join(layoutDir, 'diffs')}`);
                    }
                }
            }
            console.log(`✓ ${layout.slug}: ${layout.expectedPages} pages`);
        } catch (error) {
            failures.push(error instanceof Error ? error.message : String(error));
            console.error(`✗ ${layout.slug}: ${failures[failures.length - 1]}`);
        }
    }

    if (updateBaselines) writeReadme();

    if (failures.length > 0) {
        if (!keepOutput) console.error(`Artifacts preserved for debugging: ${outputRoot}`);
        process.exitCode = 1;
        return;
    }

    if (!keepOutput && !updateBaselines) {
        rmSync(outputRoot, { recursive: true, force: true });
    }

    console.log(updateBaselines
        ? `Updated PDF visual baselines in ${baselineRoot}`
        : `Publishing PDF QA passed.${keepOutput ? ` Artifacts: ${outputRoot}` : ''}`);
}

main();
