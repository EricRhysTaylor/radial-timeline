import { describe, expect, it } from 'vitest';
import { cloneArchetypeSpec } from './bundledStyleSpecs';
import { generateDesignedStyleTex, getEffectiveHeaderField, setHeaderCornerField } from './designedStyle';

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
