import { describe, expect, it } from 'vitest';
import { TFile } from 'obsidian';
import type RadialTimelinePlugin from '../main';
import { parseBookMetaFromFrontmatter } from '../services/PublishingValidationService';
import {
    BOOK_META_NOTE_NAME,
    buildBookMetaSampleContent,
    buildStarterMatterSamples,
    buildTemplatePathCandidates,
    isRetiredBundledPersonalMatterSample,
    resolveExistingTemplateVaultPath,
    resolveTargetTemplateVaultPath
} from './starterSetup';

function makePlugin(pandocFolder: string, existingPaths: string[] = []): RadialTimelinePlugin {
    const files = new Map(existingPaths.map(p => [p, new TFile(p)]));
    return {
        settings: { pandocFolder },
        app: { vault: { getAbstractFileByPath: (p: string) => files.get(p) ?? null } }
    } as unknown as RadialTimelinePlugin; // SAFE: the path helpers read only settings.pandocFolder and vault.getAbstractFileByPath
}

// The obsidian test mock's parseYaml is flat; the sample is a two-level map of
// quoted strings and numbers, which is all this needs to read back.
function parseTwoLevelYaml(yaml: string): Record<string, unknown> {
    const root: Record<string, unknown> = {};
    let section: Record<string, unknown> | null = null;
    const scalar = (raw: string): unknown => {
        const text = raw.trim();
        if (/^".*"$/.test(text)) return text.slice(1, -1);
        if (/^-?\d+$/.test(text)) return Number(text);
        return text;
    };
    for (const line of yaml.split('\n')) {
        if (!line.trim()) continue;
        const nested = line.match(/^ {2}([A-Za-z_]+):\s*(.*)$/);
        if (nested && section) { section[nested[1]] = scalar(nested[2]); continue; }
        const top = line.match(/^([A-Za-z_]+):\s*(.*)$/);
        if (!top) throw new Error(`unexpected line: ${line}`);
        if (top[2].trim() === '') { section = {}; root[top[1]] = section; }
        else { section = null; root[top[1]] = scalar(top[2]); }
    }
    return root;
}

describe('starter Book Details note', () => {
    it('produces frontmatter the publishing pipeline parses back into a full BookMeta', () => {
        const content = buildBookMetaSampleContent(2031);
        const yaml = content.replace(/^---\n/, '').replace(/\n---\n$/, '');
        const frontmatter = parseTwoLevelYaml(yaml);
        expect(frontmatter.Class).toBe('BookMeta');
        const meta = parseBookMetaFromFrontmatter(frontmatter, `Book/${BOOK_META_NOTE_NAME}`);
        expect(meta.title).toBe('Untitled Manuscript');
        expect(meta.author).toBe('Author');
        expect(meta.rights?.year).toBe(2031);
        expect(meta.identifiers?.isbn_paperback).toBe('000-0-00-000000-0');
        expect(meta.publisher?.imprint).toBe('Imprint');
        expect(meta.sourcePath).toBe(`Book/${BOOK_META_NOTE_NAME}`);
    });
});

describe('starter matter samples', () => {
    it('are front matter before back matter, every one inline LaTeX with the deletable-example comment', () => {
        const samples = buildStarterMatterSamples();
        expect(samples.map(s => s.name)).toEqual([
            '0.1 Alpha Readers.md', '0.2 Title Page.md', '0.3 Copyright.md', '0.4 Dedication.md', '0.5 Epigraph.md',
            '0.6 Title 2.md', '0.7 Quotation.md', '0.8 Quotation 2.md', '0.9 Quotation 3.md',
            '200.1 Acknowledgments.md', '200.2 About the Author.md'
        ]);
        for (const { name, content } of samples) {
            expect(content.startsWith('---\nClass: ')).toBe(true);
            expect(content).toContain('BodyMode: latex');
            expect(content).toContain('may be deleted at any time');
            expect(content.includes('Class: Backmatter')).toBe(name.startsWith('200.'));
        }
    });

    it('never treats the current sample bodies as retired', () => {
        for (const { name, content } of buildStarterMatterSamples()) {
            expect(isRetiredBundledPersonalMatterSample(name, content)).toBe(false);
        }
        expect(isRetiredBundledPersonalMatterSample('not-a-sample.md', 'anything')).toBe(false);
    });
});

describe('template vault paths', () => {
    const plugin = makePlugin('Radial Timeline/Pandoc', ['Radial Timeline/Pandoc/novel.tex', 'Custom/other.tex']);

    it('tries the Pandoc-folder form first for a bare name, and only the given path when already prefixed', () => {
        expect(buildTemplatePathCandidates(plugin, 'novel.tex')).toEqual(['Radial Timeline/Pandoc/novel.tex', 'novel.tex']);
        expect(buildTemplatePathCandidates(plugin, 'Radial Timeline/Pandoc/novel.tex')).toEqual(['Radial Timeline/Pandoc/novel.tex']);
        expect(buildTemplatePathCandidates(plugin, '/abs/novel.tex')).toEqual([]);
        expect(buildTemplatePathCandidates(plugin, '   ')).toEqual([]);
    });

    it('resolves an existing template through either candidate', () => {
        expect(resolveExistingTemplateVaultPath(plugin, 'novel.tex')).toBe('Radial Timeline/Pandoc/novel.tex');
        expect(resolveExistingTemplateVaultPath(plugin, 'Custom/other.tex')).toBe('Custom/other.tex');
        expect(resolveExistingTemplateVaultPath(plugin, 'missing.tex')).toBeNull();
    });

    it('targets bare filenames into the Pandoc folder and leaves nested or absolute paths as given', () => {
        expect(resolveTargetTemplateVaultPath(plugin, 'new.tex')).toBe('Radial Timeline/Pandoc/new.tex');
        expect(resolveTargetTemplateVaultPath(plugin, 'Custom/new.tex')).toBe('Custom/new.tex');
        expect(resolveTargetTemplateVaultPath(plugin, 'Radial Timeline/Pandoc/new.tex')).toBe('Radial Timeline/Pandoc/new.tex');
        expect(resolveTargetTemplateVaultPath(plugin, 'C:\\abs\\new.tex')).toBeNull();
        expect(resolveTargetTemplateVaultPath(plugin, '')).toBeNull();
    });
});
