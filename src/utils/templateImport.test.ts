import { describe, expect, it } from 'vitest';
import { normalizePath, TFile, TFolder } from 'obsidian';
import type RadialTimelinePlugin from '../main';
import type { RadialTimelineSettings } from '../types';
import { DEFAULT_SETTINGS } from '../settings/defaults';
import { buildImportedTemplateCandidate, buildImportedTemplateId, compactTemplatePathForStorage } from './templateImport';
import { getBundledPandocLayoutContent } from './pandocBundledLayouts';
import { detectTemplateProfile } from '../publishing/templateDetection';

function createPluginWithFiles(files: Record<string, string>): RadialTimelinePlugin {
    const fileMap = new Map<string, { file: TFile; content: string }>();
    const folders = new Set<string>();
    const vault = {
        getAbstractFileByPath: (input: string) => {
            const key = normalizePath(input);
            const entry = fileMap.get(key);
            if (entry) return entry.file;
            if (folders.has(key)) return new TFolder(key);
            return null;
        },
        getFiles: () => Array.from(fileMap.values()).map(entry => entry.file),
        read: async (file: TFile) => fileMap.get(normalizePath(file.path))?.content || '',
        modify: async () => undefined,
        create: async (input: string, content: string) => {
            const key = normalizePath(input);
            const file = new TFile(key);
            fileMap.set(key, { file, content });
            return file;
        },
        createFolder: async (input: string) => {
            folders.add(normalizePath(input));
            return new TFolder(normalizePath(input));
        },
    } as unknown as RadialTimelinePlugin['app']['vault'];

    Object.entries(files).forEach(([path, content]) => {
        const key = normalizePath(path);
        fileMap.set(key, { file: new TFile(key), content });
    });

    const settings: RadialTimelineSettings = {
        ...DEFAULT_SETTINGS,
        pandocFolder: 'Radial Timeline/Pandoc',
        pandocLayouts: [],
    };

    return {
        settings,
        app: { vault } as RadialTimelinePlugin['app'],
    } as unknown as RadialTimelinePlugin;
}

describe('templateImport helper', () => {
    it('infers screenplay classification and preserves profile IDs', async () => {
        const plugin = createPluginWithFiles({
            'Templates/screenplay.tex': [
                '\\documentclass{article}',
                '\\begin{document}',
                'INT. OFFICE - DAY',
                'CHARACTER',
                'Dialogue line',
                '$body$',
                '\\end{document}',
            ].join('\n'),
        });

        const candidate = await buildImportedTemplateCandidate(plugin, { sourcePath: 'Templates/screenplay.tex' });

        expect(candidate.layout.preset).toBe('screenplay');
        expect(candidate.profile.id).toBe(candidate.layout.id);
        expect(candidate.profile.usageContexts).toEqual(['screenplay']);
        expect(candidate.profile.outputIntent).toBe('screenplay-pdf');
        expect(candidate.detectedTemplate.usageContext).toBe('screenplay');
        expect(candidate.canActivate).toBe(true);
    });

    it('blocks activation when the template is missing $body$', async () => {
        const plugin = createPluginWithFiles({
            'Templates/bad.tex': [
                '\\documentclass{book}',
                '\\begin{document}',
                'No body marker here',
                '\\end{document}',
            ].join('\n'),
        });

        const candidate = await buildImportedTemplateCandidate(plugin, { sourcePath: 'Templates/bad.tex' });

        expect(candidate.canActivate).toBe(false);
        expect(candidate.issues.some(issue => issue.code === 'import_missing_body')).toBe(true);
    });

    it('keeps pandoc-folder storage compact for relative paths', () => {
        const plugin = createPluginWithFiles({});
        const stored = compactTemplatePathForStorage(plugin, 'Radial Timeline/Pandoc/custom.tex');
        expect(stored).toBe('custom.tex');
        expect(buildImportedTemplateId('My Template', 'novel', ['imported-my-template-novel'])).toBe('imported-my-template-novel-2');
    });

    it('preserves absolute paths during import storage normalization', () => {
        const plugin = createPluginWithFiles({});
        const absolutePath = '/tmp/absolute-template.tex';
        expect(compactTemplatePathForStorage(plugin, absolutePath)).toBe(absolutePath);
    });

    it('detects rich formatting from a vault TFile when no sourceContent override is supplied', async () => {
        // Regression: simulates the Import wizard picking a .tex file from a deep vault
        // path (not under the configured pandocFolder). The build pipeline must read
        // the TFile content and feed it to the heuristic — not silently fall back to
        // empty content (which would yield "Custom · Custom LaTeX styling" + low confidence).
        const richContent = getBundledPandocLayoutContent('bundled-fiction-modern-classic') || '';
        expect(richContent.length).toBeGreaterThan(200);
        const deepVaultPath = 'Author/New/Fresh/Jane Austin/Sherlock Holmes/Pandoc/rt_modern_classic.tex';
        const plugin = createPluginWithFiles({ [deepVaultPath]: richContent });

        const candidate = await buildImportedTemplateCandidate(plugin, { sourcePath: deepVaultPath });

        expect(candidate.detectedTemplate.styleHint).not.toBe('custom');
        expect(candidate.detectedTemplate.confidence).not.toBe('low');
        expect(candidate.detectedTemplate.traits.length).toBeGreaterThanOrEqual(3);
        expect(candidate.canActivate).toBe(true);
    });

    it('detects rich formatting when the picked file lives under the configured pandoc folder', async () => {
        // Regression: when the source file is inside `Radial Timeline/Pandoc/`,
        // compactTemplatePathForStorage strips the prefix from layout.path. The read
        // pipeline must still locate the TFile via the original picked path or via
        // resolveTemplatePath; otherwise content reads as empty and detection collapses
        // to "Custom · Custom LaTeX styling" with low confidence (the reported symptom).
        const richContent = getBundledPandocLayoutContent('bundled-fiction-modern-classic') || '';
        const pickedPath = 'Radial Timeline/Pandoc/rt_modern_classic.tex';
        const plugin = createPluginWithFiles({ [pickedPath]: richContent });

        const candidate = await buildImportedTemplateCandidate(plugin, { sourcePath: pickedPath });

        expect(candidate.layout.path).toBe('rt_modern_classic.tex');
        expect(candidate.detectedTemplate.styleHint).not.toBe('custom');
        expect(candidate.detectedTemplate.confidence).not.toBe('low');
        expect(candidate.detectedTemplate.traits.length).toBeGreaterThanOrEqual(3);
        expect(candidate.canActivate).toBe(true);
    });

    it('returns the minimal Custom profile when the vault file cannot be read', async () => {
        // When no TFile resolves to the requested sourcePath and no sourceContent
        // override is provided, content reads as empty and the detector returns
        // the minimal Custom profile. This is the documented end-of-the-line
        // behavior — not a regression to mask with fallbacks.
        const plugin = createPluginWithFiles({});

        const candidate = await buildImportedTemplateCandidate(plugin, {
            sourcePath: 'Missing/Folder/never-installed.tex',
        });

        expect(candidate.detectedTemplate.styleHint).toBe('custom');
        expect(candidate.detectedTemplate.confidence).toBe('low');
        expect(candidate.detectedTemplate.traits).toEqual(['Custom LaTeX styling']);
    });

    it('detects rich formatting on the canonical Modern Classic bundled spec content', () => {
        // Sanity check: the detector itself produces a confident, multi-trait profile
        // when given the live spec-generated bundled .tex output.
        const richContent = getBundledPandocLayoutContent('bundled-fiction-modern-classic') || '';
        expect(richContent.length).toBeGreaterThan(200);
        const profile = detectTemplateProfile(richContent);

        expect(profile.styleHint).not.toBe('custom');
        expect(['medium', 'high']).toContain(profile.confidence);
        expect(profile.traits.length).toBeGreaterThanOrEqual(3);
    });

    it('detects rich formatting from provided template content', async () => {
        const plugin = createPluginWithFiles({
            'Templates/ajfinn.tex': '$body$',
        });
        const templateContent = [
            '\\documentclass[11pt]{book}',
            '\\usepackage{fontspec}',
            '\\usepackage{fancyhdr}',
            '\\usepackage{titlesec}',
            '\\usepackage{geometry}',
            '\\usepackage{setspace}',
            '\\setmainfont{Sorts Mill Goudy}',
            '\\geometry{paperwidth=6in, paperheight=9in}',
            '\\fancyhead[CE]{Author}',
            '\\onehalfspacing',
            '\\begin{document}',
            '$body$',
            '\\end{document}',
        ].join('\n');

        const candidate = await buildImportedTemplateCandidate(plugin, {
            sourcePath: 'Templates/ajfinn.tex',
            sourceContent: templateContent,
        });

        expect(candidate.canActivate).toBe(true);
        expect(candidate.detectedTemplate.styleHint).toBe('book');
        expect(candidate.detectedTemplate.confidence).toBe('high');
        expect(candidate.detectedTemplate.traits).toContain('Running headers detected');
        expect(candidate.detectedTemplate.traits).toContain('Book-style page structure');
        expect(candidate.detectedTemplate.traits).toContain('OpenType fonts configured');
        expect(candidate.detectedTemplate.traits).toContain('Custom margins detected');
        expect(candidate.detectedTemplate.traits).toContain('Adjusted line spacing');
    });
});
