/*
 * The test PDF behind an imported template.
 *
 * "Import template…" brings in an author's own LaTeX. Radial Timeline cannot
 * know what that LaTeX does, so it makes one promise only: a template is
 * usable once it has built a PDF on this computer. This file builds that PDF.
 *
 *   - A short manuscript is assembled the way an export assembles one for the
 *     layout (buildLayoutAssemblyOptions), so the template is sent the same
 *     headings, markers and macros a real export will send it.
 *   - It is built by runPandocOnContent, the plugin's own Pandoc call.
 *   - Everything happens in a folder under the system's temporary directory,
 *     removed afterwards. Nothing is written to the vault.
 *
 * A template that fails gets the lines LaTeX printed and nothing more. This
 * file never tries to explain or repair someone's LaTeX.
 */
import * as fs from 'fs'; // SAFE: the test PDF is built in a temporary folder outside the vault.
import * as os from 'os';
import * as path from 'path';
import type { PandocLayoutTemplate } from '../types';
import { assembleManuscript, type ManuscriptSourceFile } from '../utils/manuscript';
import { buildLayoutAssemblyOptions } from '../utils/manuscriptLayoutExport';
import { sanitizeCompiledManuscriptForPdf } from '../utils/manuscriptSanitize';
import { categorizeExportError, extractLatexErrorLines } from '../utils/exportErrors';
import { runPandocOnContent } from '../utils/exportFormats';
import type { TimelineChapterMarker } from '../utils/timelineChapters';
import { hashProofInput } from './manuscriptProof';
import { measurePdf, type PdfMeasure } from './ManuscriptProofPreview';

export const IMPORTED_TEMPLATE_CHECK_SCHEMA_VERSION = 1;

/**
 * Stored on an imported layout: the template text that last built a test PDF,
 * and what that PDF measured. The measurements are of the test manuscript,
 * not of the author's book.
 */
export interface ImportedTemplateCheckRecord {
    schemaVersion: typeof IMPORTED_TEMPLATE_CHECK_SCHEMA_VERSION;
    sha256: string;
    checkedAt: string;
    pages: number;
    /** First-page size in PDF points (1/72 inch). */
    pageWidthPt: number;
    pageHeightPt: number;
    /** The page where the sample manuscript starts: the one shown as the template's picture. */
    samplePage: number;
}

export type ImportedTemplateCheckResult =
    /** `pdf` is the test PDF itself, so the caller can show its first page. */
    | { ok: true; record: ImportedTemplateCheckRecord; pdf: Uint8Array }
    /** `tools`: Pandoc or LaTeX could not be run. `latex`: the template did not build. `missing`: no file to check. */
    | { ok: false; reason: 'tools' | 'latex' | 'missing'; message: string; latexLines: string[] };

export function hashTemplateText(text: string): string {
    return hashProofInput(text);
}

const CHECK_PARAGRAPHS = [
    'Mara followed the lantern down to the harbor, where the last ferry waited. “You’re late,” said the ferryman — not unkindly. She had *almost* turned back at the café; the letter in her pocket felt **heavier** than paper should.',
    'The water kept its own counsel. Gulls argued over the tide line, and somewhere behind her a door closed on the life she was leaving. She counted the steps to the gangway: eleven, twelve, thirteen.',
    'Nobody on the quay looked up. That was the mercy of small towns at dusk… everyone busy with their own lamps.',
];

/** The title and author the test PDF is built with, standing in for Book Details. */
export const IMPORTED_TEMPLATE_CHECK_TITLE = 'Your Book Title';
export const IMPORTED_TEMPLATE_CHECK_AUTHOR = 'Author Name';

/** The sample manuscript's first words: the page that prints them is the one shown as the template's picture. */
export const IMPORTED_TEMPLATE_CHECK_OPENING = 'Mara followed the lantern';

/** Phrases the test PDF must contain; the compile tests look for them in the output. */
export const IMPORTED_TEMPLATE_CHECK_PHRASES = ['the last ferry waited', 'a second lantern answered', 'the far shore arrived'] as const;

const CHECK_SCENES: Array<{ title: string; part?: string; chapter?: string; body: string }> = [
    {
        title: 'The Harbor',
        part: 'Part One',
        chapter: 'Chapter One',
        // Long enough to run onto a second page, so running headers and page
        // numbers are set at least once: many template errors only appear
        // when LaTeX ships a full page.
        body: Array.from({ length: 5 }, () => CHECK_PARAGRAPHS.join('\n\n')).join('\n\n'),
    },
    {
        title: 'The Letter',
        body: '> Come before the frost. I will leave a light.\n\nShe read it twice, then a third time. Out past the breakwater a second lantern answered the first.\n\n---\n\nBy morning the page was soft from handling.',
    },
    {
        title: 'The Crossing',
        chapter: 'Chapter Two',
        body: 'The crossing took an hour. When the far shore arrived it did so quietly, the way a held breath ends.',
    },
];

/** The manuscript the test PDF is built from, assembled as an export would for this layout. */
export async function buildImportedTemplateCheckManuscript(layout: PandocLayoutTemplate): Promise<string> {
    const contents = new Map<string, string>();
    const chapters: Record<string, TimelineChapterMarker[]> = {};
    const files = CHECK_SCENES.map((scene, index) => {
        const scenePath = `Template Check/${index + 1} ${scene.title}.md`;
        contents.set(scenePath, `---\nClass: Scene\n${scene.part ? `Part: "${scene.part}"\n` : ''}---\n\n${scene.body}\n`);
        if (scene.chapter) {
            chapters[scenePath] = [{
                sourcePath: scenePath, sourceType: 'Scene', title: scene.chapter,
                resolvedScenePath: scenePath, resolvedTimelinePosition: index + 1,
            }];
        }
        // These scenes exist in memory, not in the vault.
        return { path: scenePath, basename: `${index + 1} ${scene.title}` };
    });
    const assembled = await assembleManuscript(
        files,
        {
            read: async (file: ManuscriptSourceFile) => {
                const text = contents.get(file.path);
                if (text === undefined) throw new Error(`No test scene at ${file.path}`);
                return text;
            },
        },
        undefined, false, undefined, false, undefined, undefined,
        buildLayoutAssemblyOptions(layout, { chapterMarkersByScenePath: chapters }),
    );
    return sanitizeCompiledManuscriptForPdf(assembled.text, {});
}

/**
 * Build a test PDF from `templateText` for `layout`.
 *
 * `layout` is the record as it will be saved: its id, name and flags decide
 * how the manuscript is assembled. The template file on disk is not read;
 * the caller passes the text it wants checked, and a pass is recorded against
 * that exact text.
 */
export async function runImportedTemplateCheck(input: {
    layout: PandocLayoutTemplate;
    templateText: string;
    pandocPath?: string;
    /** Reads page count and page size from the PDF. PDF.js in Obsidian; the compile tests pass Poppler. */
    measure?: (pdf: Uint8Array, findText?: string) => Promise<PdfMeasure>;
}): Promise<ImportedTemplateCheckResult> {
    const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'rt-template-check-'));
    try {
        const templatePath = path.join(dir, 'template.tex');
        await fs.promises.writeFile(templatePath, input.templateText, 'utf8');
        const markdown = await buildImportedTemplateCheckManuscript(input.layout);
        const pdfPath = await runPandocOnContent(markdown, path.join(dir, 'check.pdf'), {
            targetFormat: 'pdf',
            templatePath,
            workingDir: dir,
            disableShellEscape: true,
            pandocPath: input.pandocPath,
            // What Book Details supplies in a real export; shown where the template prints them.
            metadata: { title: IMPORTED_TEMPLATE_CHECK_TITLE, author: IMPORTED_TEMPLATE_CHECK_AUTHOR },
        });
        const pdf = new Uint8Array(await fs.promises.readFile(pdfPath));
        const measured = await (input.measure ?? measurePdf)(pdf, IMPORTED_TEMPLATE_CHECK_OPENING);
        return {
            ok: true,
            pdf,
            record: {
                schemaVersion: IMPORTED_TEMPLATE_CHECK_SCHEMA_VERSION,
                sha256: hashTemplateText(input.templateText),
                checkedAt: new Date().toISOString(),
                pages: measured.pages,
                pageWidthPt: measured.widthPt,
                pageHeightPt: measured.heightPt,
                samplePage: measured.textPage,
            },
        };
    } catch (error) {
        const failure = categorizeExportError(error);
        return {
            ok: false,
            reason: failure.category === 'missing_dependency' ? 'tools' : 'latex',
            message: failure.message,
            latexLines: extractLatexErrorLines(failure.rawOutput ?? failure.detail ?? failure.message),
        };
    } finally {
        await fs.promises.rm(dir, { recursive: true, force: true });
    }
}
