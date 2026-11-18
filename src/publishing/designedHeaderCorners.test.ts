import { describe, expect, it } from 'vitest';
import { cloneArchetypeSpec } from './bundledStyleSpecs';
import {
    generateDesignedStyleTex,
    getEffectiveHeaderField,
    migrateDesignedStyleSpec,
    setHeaderCornerField,
    type DesignedStyleSpec,
} from './designedStyle';

// The wizard's corner editor. Every built-in layout names only a header
// style and leaves its six corners unset, so the editor has to read what the
// style prints there, and "Empty" has to really clear it.
describe('header corners', () => {
    it('reads what the header style prints when the corner is unset', () => {
        const basic = cloneArchetypeSpec('submission'); // centered-title
        expect(basic.runningHeader.evenCenter).toBeUndefined();
        expect(getEffectiveHeaderField(basic, 'evenCenter')).toBe('title');
        expect(getEffectiveHeaderField(basic, 'evenLeft')).toBeUndefined();

        const standard = cloneArchetypeSpec('reading-draft'); // left-title-right-context
        expect(getEffectiveHeaderField(standard, 'evenLeft')).toBe('title');
        expect(getEffectiveHeaderField(standard, 'oddRight')).toBe('scene-context');
    });

    it('prefers the author\'s own choice for a corner', () => {
        const spec = cloneArchetypeSpec('submission');
        setHeaderCornerField(spec, 'evenLeft', 'author');
        expect(getEffectiveHeaderField(spec, 'evenLeft')).toBe('author');
    });

    it('"Empty" clears a corner the header style fills, and the PDF template says so', () => {
        const spec = cloneArchetypeSpec('reading-draft');
        expect(generateDesignedStyleTex(spec)).not.toContain('\\fancyhead[LE]{}');
        setHeaderCornerField(spec, 'evenLeft', undefined);
        expect(spec.runningHeader.evenLeft).toBe('empty');
        expect(getEffectiveHeaderField(spec, 'evenLeft')).toBe('empty');
        // Emitted after the style's own line, so the empty one wins.
        expect(generateDesignedStyleTex(spec)).toContain('\\fancyhead[LE]{}');
    });

    it('"Empty" on a corner the style leaves blank just removes the author\'s choice', () => {
        const spec = cloneArchetypeSpec('submission');
        setHeaderCornerField(spec, 'evenLeft', 'author');
        setHeaderCornerField(spec, 'evenLeft', undefined);
        expect('evenLeft' in spec.runningHeader).toBe(false);
    });
});

// The Literary header prints one centred line per page. The editor must read
// it there, and editing that slot must change what prints.
describe('Literary header', () => {
    const literaryLines = (tex: string): string[] => tex.split('\n').filter(line => line.startsWith('\\fancyhead['));

    it('reads the centred line in the centre slots and nothing at the sides', () => {
        const signature = cloneArchetypeSpec('structured'); // Literary, plain caps
        expect(getEffectiveHeaderField(signature, 'evenCenter')).toEqual({ join: ['page', 'author'] });
        expect(getEffectiveHeaderField(signature, 'oddCenter')).toEqual({ join: ['title', 'page'] });
        for (const corner of ['evenLeft', 'evenRight', 'oddLeft', 'oddRight'] as const) {
            expect(getEffectiveHeaderField(signature, corner), corner).toBeUndefined();
        }
    });

    it('prints the same line it always has, plain and with spaced caps', () => {
        expect(literaryLines(generateDesignedStyleTex(cloneArchetypeSpec('structured')))).toEqual([
            '\\fancyhead[CE]{\\thepage\\hspace{1em}|\\hspace{1em}\\AuthorName}',
            '\\fancyhead[CO]{\\BookTitle\\hspace{1em}|\\hspace{1em}\\thepage}',
        ]);
        expect(literaryLines(generateDesignedStyleTex(cloneArchetypeSpec('literary')))).toEqual([
            '\\fancyhead[CE]{\\raisebox{0.2ex}{\\thepage}\\hspace{1em}\\HeaderSeparator\\hspace{1em}\\KernedText{\\AuthorName}}',
            '\\fancyhead[CO]{\\KernedText{\\BookTitle}\\hspace{1em}\\HeaderSeparator\\hspace{1em}\\raisebox{0.2ex}{\\thepage}}',
        ]);
    });

    it('replaces the line when the author picks another field for that slot, and "Empty" clears it', () => {
        const spec = cloneArchetypeSpec('structured');
        setHeaderCornerField(spec, 'evenCenter', 'chapter');
        setHeaderCornerField(spec, 'oddCenter', undefined);
        expect(spec.runningHeader.oddCenter).toBe('empty');
        const lines = literaryLines(generateDesignedStyleTex(spec));
        // Emitted after the style's own lines, so these win.
        expect(lines.slice(-2)).toEqual([
            '\\fancyhead[CE]{\\rtChapterRunningTitle}',
            '\\fancyhead[CO]{}',
        ]);
    });

    it('drops the four side corners older versions stored, keeping the author\'s real choices', () => {
        const spec = cloneArchetypeSpec('structured');
        Object.assign(spec.runningHeader, { evenLeft: 'page', evenRight: 'author', oddLeft: 'title', oddRight: 'chapter' });
        (spec as unknown as { specVersion: number }).specVersion = 3;
        const migrated: DesignedStyleSpec = migrateDesignedStyleSpec(spec);
        expect(migrated.runningHeader.evenLeft).toBeUndefined();
        expect(migrated.runningHeader.evenRight).toBeUndefined();
        expect(migrated.runningHeader.oddLeft).toBeUndefined();
        expect(migrated.runningHeader.oddRight).toBe('chapter');
    });

    it('leaves side corners alone in a current style', () => {
        const spec = cloneArchetypeSpec('structured');
        spec.runningHeader.evenLeft = 'page';
        expect(migrateDesignedStyleSpec(spec)).toBe(spec);
    });
});
