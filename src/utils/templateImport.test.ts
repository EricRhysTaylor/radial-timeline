import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeDiskVaultPlugin } from '../../tests/helpers/diskVault';
import {
    buildImportedTemplateCandidate,
    buildImportedTemplateId,
    compactTemplatePathForStorage,
    finalizeImportedLayout,
    planImportedTemplatePath,
    registerImportedTemplate,
} from './templateImport';
import { hashTemplateText, type ImportedTemplateCheckRecord } from '../publishing/importedTemplateCheck';
import { getImportedTemplatePreview, getImportedTemplatePreviewPath } from '../publishing/importedTemplatePreview';
import { getImportedTemplateState } from '../publishing/importedTemplateState';
import { getBundledPandocLayoutContent } from './pandocBundledLayouts';

const GOOD = '\\documentclass{book}\n\\begin{document}\n$body$\n\\end{document}\n';
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]).buffer;
const recordFor = (text: string): ImportedTemplateCheckRecord => ({
    schemaVersion: 1, sha256: hashTemplateText(text), checkedAt: '2026-11-19T00:00:00.000Z', pages: 3, pageWidthPt: 432, pageHeightPt: 648, samplePage: 2,
});

let root = '';
let vault: ReturnType<typeof makeDiskVaultPlugin>;
const put = (vaultPath: string, text: string): string => {
    mkdirSync(join(vault.abs(vaultPath), '..'), { recursive: true });
    writeFileSync(vault.abs(vaultPath), text);
    return vaultPath;
};

beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'rt-template-import-'));
    vault = makeDiskVaultPlugin(root);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('reading the chosen template', () => {
    it('accepts a template with the Pandoc body placeholder, for novel use unless told otherwise', async () => {
        // A template mentioning "character" or "dialogue" is still a novel
        // template until the author says so: the usage is never guessed.
        const candidate = await buildImportedTemplateCandidate(vault.plugin, {
            sourcePath: put('Templates/My Book.tex', `% dialogue and character spacing\n${GOOD}`),
        });
        expect(candidate.canActivate).toBe(true);
        expect(candidate.layout).toMatchObject({
            id: 'imported-my-book-novel', name: 'My Book', preset: 'novel', origin: 'imported',
            // Radial Timeline's own copy, not the author's file.
            path: 'Radial Timeline/Pandoc/imported/my-book.tex',
            description: 'Imported from My Book.tex.',
            usesModernClassicStructure: false, hasEpigraphs: false, hasSceneOpenerHeadingOptions: false,
        });
        expect(candidate.sourceText).toContain('$body$');
        // What the dialog shows is read from the file, nothing more.
        expect(candidate.facts).toMatchObject({ hasBody: true, documentClass: { kind: 'named', name: 'book', options: [] }, fonts: [], packages: [] });
    });

    it('requires the case-sensitive Pandoc body variable, outside a comment', async () => {
        const upper = await buildImportedTemplateCandidate(vault.plugin, { sourcePath: put('Templates/upper.tex', '\\documentclass{book}\n$BODY$') });
        expect(upper.canActivate).toBe(false);
        expect(upper.issues.map(issue => issue.code)).toEqual(['import_missing_body']);
        const commented = await buildImportedTemplateCandidate(vault.plugin, { sourcePath: put('Templates/commented.tex', '\\documentclass{book}\n% $body$') });
        expect(commented.issues.map(issue => issue.code)).toEqual(['import_missing_body']);
    });

    it('tells an empty file, a missing file and an unreadable file apart', async () => {
        const empty = await buildImportedTemplateCandidate(vault.plugin, { sourcePath: put('Templates/empty.tex', '  \n') });
        expect(empty.issues.map(issue => issue.code)).toEqual(['import_empty']);

        const missing = await buildImportedTemplateCandidate(vault.plugin, { sourcePath: 'Templates/never.tex' });
        expect(missing.issues.map(issue => issue.code)).toEqual(['import_source_missing']);

        const outside = join(root, 'locked.tex');
        writeFileSync(outside, GOOD);
        chmodSync(outside, 0o000);
        try {
            const locked = await buildImportedTemplateCandidate(vault.plugin, { sourcePath: outside });
            // chmod cannot lock a file from root.
            if (process.getuid?.() !== 0) expect(locked.issues.map(issue => issue.code)).toEqual(['import_source_unreadable']);
        } finally { chmodSync(outside, 0o644); }

        for (const candidate of [empty, missing]) {
            expect(candidate.canActivate).toBe(false);
            expect(candidate.sourceText).toBe('');
            expect(candidate.issues[0].message.length).toBeGreaterThan(20);
        }
    });

    it('refuses a file that is not a LaTeX template', async () => {
        const candidate = await buildImportedTemplateCandidate(vault.plugin, { sourcePath: put('Templates/notes.md', GOOD) });
        expect(candidate.issues.map(issue => issue.code)).toEqual(['import_not_tex']);
    });

    it('reads a file outside the vault from disk each time', async () => {
        const outside = join(root, 'external.tex');
        writeFileSync(outside, GOOD);
        expect((await buildImportedTemplateCandidate(vault.plugin, { sourcePath: outside })).canActivate).toBe(true);
        writeFileSync(outside, '');
        expect((await buildImportedTemplateCandidate(vault.plugin, { sourcePath: outside })).canActivate).toBe(false);
    });

    it('rejects a template whose \\rtPart takes the old three arguments', async () => {
        const candidate = await buildImportedTemplateCandidate(vault.plugin, {
            sourcePath: put('Templates/old.tex', `\\newcommand{\\rtPart}[3]{#1}\n${GOOD}`),
        });
        expect(candidate.issues.map(issue => issue.code)).toEqual(['import_part_arity_mismatch']);
    });

    it('takes the structural path for a template that defines the part, chapter and scene macros', async () => {
        const text = getBundledPandocLayoutContent('bundled-fiction-modern-classic') || '';
        const candidate = await buildImportedTemplateCandidate(vault.plugin, { sourcePath: put('Templates/sig.tex', text) });
        expect(candidate.layout).toMatchObject({ usesModernClassicStructure: true, hasEpigraphs: true });
        // Mentioning \epigraph, or the macros in a comment, is not defining them.
        const plain = await buildImportedTemplateCandidate(vault.plugin, {
            sourcePath: put('Templates/plain.tex', `\\usepackage{epigraph}\n% \\newcommand{\\rtPart}[4]{} \\newcommand{\\rtChapter}[2]{} \\newcommand{\\rtSceneSep}[1]{}\n${GOOD}`),
        });
        expect(plain.layout).toMatchObject({ usesModernClassicStructure: false, hasEpigraphs: false });
    });
});

describe('names, ids and paths', () => {
    it('keeps pandoc-folder storage compact for relative paths and absolute paths whole', () => {
        expect(compactTemplatePathForStorage(vault.plugin, 'Radial Timeline/Pandoc/custom.tex')).toBe('custom.tex');
        expect(compactTemplatePathForStorage(vault.plugin, '/tmp/absolute-template.tex')).toBe('/tmp/absolute-template.tex');
        expect(buildImportedTemplateId('My Template', 'novel', ['imported-my-template-novel'])).toBe('imported-my-template-novel-2');
    });

    it('plans a copy path where neither a template nor a picture already sits, registered or not', () => {
        expect(planImportedTemplatePath(vault.plugin, 'My Book')).toBe('Radial Timeline/Pandoc/imported/my-book.tex');
        put('Radial Timeline/Pandoc/imported/my-book.tex', 'ORPHAN');
        put('Radial Timeline/Pandoc/imported/my-book-2.png', 'ORPHAN PICTURE');
        expect(planImportedTemplatePath(vault.plugin, 'My Book')).toBe('Radial Timeline/Pandoc/imported/my-book-3.tex');
    });

    it('applies the entered name, usage and description to the saved layout, and stores no guess about its style', async () => {
        const candidate = await buildImportedTemplateCandidate(vault.plugin, { sourcePath: put('Templates/a.tex', GOOD) });
        const layout = finalizeImportedLayout(vault.plugin, candidate, { name: ' House Style ', preset: 'screenplay', description: 'For the script.' });
        expect(layout).toMatchObject({
            id: 'imported-house-style-screenplay', name: 'House Style', preset: 'screenplay', description: 'For the script.',
            path: 'Radial Timeline/Pandoc/imported/house-style.tex', origin: 'imported', draft: false,
        });
        expect(Object.keys(layout)).not.toContain('importDetection');
    });
});

describe('registering an imported template', () => {
    const layoutFor = async () => {
        const candidate = await buildImportedTemplateCandidate(vault.plugin, { sourcePath: put('Templates/My Book.tex', GOOD) });
        return finalizeImportedLayout(vault.plugin, candidate, { name: 'My Book', preset: 'novel', description: '' });
    };

    it('writes its own copy and first page, records the check, and leaves the author\'s file alone', async () => {
        const layout = await layoutFor();
        const registered = await registerImportedTemplate(vault.plugin, layout, GOOD, recordFor(GOOD), PNG);
        expect(vault.plugin.settings.pandocLayouts).toEqual([registered]);
        expect(registered.importCheck).toEqual(recordFor(GOOD));
        expect(readFileSync(vault.abs(registered.path), 'utf8')).toBe(GOOD);
        expect(readFileSync(vault.abs('Templates/My Book.tex'), 'utf8')).toBe(GOOD);
        expect(new Uint8Array(readFileSync(vault.abs('Radial Timeline/Pandoc/imported/my-book.png')))).toEqual(new Uint8Array(PNG));
        expect(getImportedTemplatePreview(vault.plugin, registered)).toEqual({ src: 'app://vault/Radial Timeline/Pandoc/imported/my-book.png', page: 2 });
        expect(vault.saveSettings).toHaveBeenCalledOnce();
        // Ready here, where the test PDF was built; a second computer builds its own.
        expect(getImportedTemplateState(vault.plugin, registered)).toBe('ready');
        vault.moveToAnotherComputer();
        expect(getImportedTemplateState(vault.plugin, registered)).toBe('unchecked');
    });

    it('registers without a picture when none could be drawn', async () => {
        const registered = await registerImportedTemplate(vault.plugin, await layoutFor(), GOOD, recordFor(GOOD));
        expect(vault.listFiles()).toEqual(['Radial Timeline/Pandoc/imported/my-book.tex', 'Templates/My Book.tex']);
        expect(getImportedTemplatePreview(vault.plugin, registered)).toBeNull();
    });

    it('refuses text other than the text that built the test PDF', async () => {
        const layout = await layoutFor();
        await expect(registerImportedTemplate(vault.plugin, layout, `${GOOD}% edited`, recordFor(GOOD), PNG)).rejects.toThrow();
        expect(vault.plugin.settings.pandocLayouts).toEqual([]);
        expect(vault.listFiles()).toEqual(['Templates/My Book.tex']);
    });

    it('takes its copy and its picture back when the settings save fails', async () => {
        const layout = await layoutFor();
        vault.saveSettings.mockRejectedValueOnce(new Error('QA write denied'));
        await expect(registerImportedTemplate(vault.plugin, layout, GOOD, recordFor(GOOD), PNG)).rejects.toThrow('QA write denied');
        expect(vault.plugin.settings.pandocLayouts).toEqual([]);
        expect(vault.listFiles()).toEqual(['Templates/My Book.tex']);
    });

    it('registers nothing and writes nothing while settings cannot be saved', async () => {
        const layout = await layoutFor();
        vault.plugin.isSettingsPersistenceBlocked = () => true;
        await expect(registerImportedTemplate(vault.plugin, layout, GOOD, recordFor(GOOD), PNG)).rejects.toThrow();
        expect(vault.listFiles()).toEqual(['Templates/My Book.tex']);
        expect(vault.saveSettings).not.toHaveBeenCalled();
    });

    it('fails rather than replace a file that appeared at the copy path', async () => {
        const layout = await layoutFor();
        put(layout.path, 'APPEARED_AFTER_PLANNING');
        await expect(registerImportedTemplate(vault.plugin, layout, GOOD, recordFor(GOOD), PNG)).rejects.toThrow();
        expect(readFileSync(vault.abs(layout.path), 'utf8')).toBe('APPEARED_AFTER_PLANNING');
        expect(vault.plugin.settings.pandocLayouts).toEqual([]);
        expect(vault.listFiles()).toEqual(['Radial Timeline/Pandoc/imported/my-book.tex', 'Templates/My Book.tex']);
    });

    it('takes the copy back when a picture already sits at its path', async () => {
        const layout = await layoutFor();
        put('Radial Timeline/Pandoc/imported/my-book.png', 'APPEARED_AFTER_PLANNING');
        await expect(registerImportedTemplate(vault.plugin, layout, GOOD, recordFor(GOOD), PNG)).rejects.toThrow();
        expect(readFileSync(vault.abs('Radial Timeline/Pandoc/imported/my-book.png'), 'utf8')).toBe('APPEARED_AFTER_PLANNING');
        expect(vault.plugin.settings.pandocLayouts).toEqual([]);
        expect(vault.listFiles()).toEqual(['Radial Timeline/Pandoc/imported/my-book.png', 'Templates/My Book.tex']);
    });
});

describe('first-page picture path', () => {
    it('sits beside the copy, and a template outside the vault has none', () => {
        expect(getImportedTemplatePreviewPath({ path: 'Radial Timeline/Pandoc/imported/my-book.tex' })).toBe('Radial Timeline/Pandoc/imported/my-book.png');
        expect(getImportedTemplatePreviewPath({ path: '/Users/author/templates/my-book.tex' })).toBeNull();
        expect(getImportedTemplatePreviewPath({ path: 'C:\\templates\\my-book.tex' })).toBeNull();
    });
});
