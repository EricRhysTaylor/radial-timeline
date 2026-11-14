import { makeFile } from '../../tests/helpers/obsidianFixtures';
import { describe, expect, it } from 'vitest';
import type { TFile, Vault } from 'obsidian';
import { assembleManuscript } from './manuscript';
import { getDefaultManuscriptCleanupOptions, sanitizeCompiledManuscript, sanitizeCompiledManuscriptForPdf } from './manuscriptSanitize';
import { extractRuntimeBody } from './runtimeEstimator';

function makeVault(contents: Record<string, string>): Vault {
    return { read: async (file: TFile) => contents[file.path] || '' } as unknown as Vault;
}

const SCENE = '---\nClass: Scene\nWords: 1200\n---\n\nBefore.\n\n---\nKade: Get down!\n---\n\nAfter.';

describe('scene-break blocks in manuscript export', () => {
    const files = [makeFile('Scenes/1 Opening.md'), makeFile('Scenes/2 Arrival.md')];
    const vault = makeVault({
        [files[0].path]: SCENE,
        [files[1].path]: '---\nClass: Scene\nRole: other\n---\nSecond scene.',
    });

    it.each([
        ['Markdown', (text: string) => sanitizeCompiledManuscript(text, getDefaultManuscriptCleanupOptions('markdown'))],
        ['PDF', (text: string) => sanitizeCompiledManuscriptForPdf(text, getDefaultManuscriptCleanupOptions('pdf'))],
    ])('%s export keeps the dialogue and removes each scene\'s frontmatter', async (_format, sanitize) => {
        const assembled = await assembleManuscript(files, vault, undefined, false, undefined, false);
        const out = sanitize(assembled.text);
        expect(out).toContain('---\nKade: Get down!\n---');
        expect(out).toContain('Before.');
        expect(out).toContain('After.');
        expect(out).toContain('Second scene.');
        expect(out).not.toContain('Class: Scene');
        expect(out).not.toContain('Words: 1200');
        expect(out).not.toContain('Role: other');
    });

    it('keeps the dialogue when the scene has no frontmatter of its own above it', async () => {
        const file = makeFile('Scenes/3 Break.md');
        const assembled = await assembleManuscript([file], makeVault({ [file.path]: 'Before.\n\n---\nKade: Get down!\n---\n\nAfter.' }), undefined, false, undefined, false);
        expect(sanitizeCompiledManuscript(assembled.text)).toContain('Kade: Get down!');
    });

    it('source-note export also removes only the leading block', async () => {
        const assembled = await assembleManuscript([files[0]], vault, undefined, false, undefined, false, undefined, undefined, { sourceNotes: 'markdown' });
        const out = sanitizeCompiledManuscript(assembled.text);
        expect(out).toBe('Before.\n\n---\nKade: Get down!\n---\n\nAfter.');
    });

    it('runtime estimates read the same scene text as before', () => {
        expect(extractRuntimeBody(SCENE)).toBe('Before.\n\n---\nKade: Get down!\n---\n\nAfter.');
    });
});
