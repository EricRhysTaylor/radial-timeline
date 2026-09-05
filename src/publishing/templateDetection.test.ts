import { describe, expect, it } from 'vitest';
import { detectTemplateProfile } from './templateDetection';

describe('detectTemplateProfile', () => {
    it('detects a chaptered book template with strong confidence', () => {
        const detected = detectTemplateProfile([
            '\\documentclass{book}',
            '\\usepackage{fancyhdr}',
            '\\usepackage{titlesec}',
            '\\chapter{One}',
            '\\pagestyle{fancy}',
        ].join('\n'));

        expect(detected.usageContext).toBe('novel');
        expect(detected.styleHint).toBe('chaptered');
        expect(detected.mockPreviewKind).toBe('chaptered');
        expect(detected.confidence).toBe('high');
        expect(detected.traits).toContain('Chapter-based structure');
        expect(detected.traits).toContain('Running headers detected');
    });

    it('detects a simple manuscript template', () => {
        const detected = detectTemplateProfile([
            '\\documentclass{article}',
            '\\usepackage{geometry}',
            '\\usepackage{setspace}',
            '\\doublespacing',
            '$body$',
        ].join('\n'));

        expect(detected.styleHint).toBe('manuscript');
        expect(detected.mockPreviewKind).toBe('manuscript');
        expect(detected.confidence === 'medium' || detected.confidence === 'high').toBe(true);
        expect(detected.traits).toContain('Minimal manuscript formatting');
    });

    it('surfaces richer formatting traits when extra layout signals are present', () => {
        const detected = detectTemplateProfile([
            '\\documentclass[twoside,openright]{book}',
            '\\usepackage{fontspec}',
            '\\usepackage{microtype}',
            '\\usepackage{geometry}',
            '\\usepackage{parskip}',
            '\\tableofcontents',
            '$body$',
        ].join('\n'));

        expect(detected.traits).toContain('OpenType fonts configured');
        expect(detected.traits).toContain('Book-style page structure');
        expect(detected.traits.some((trait) => trait.includes('margins') || trait.includes('spacing') || trait.includes('print layout'))).toBe(true);
    });

    it('falls back to a neutral custom profile when there are no strong layout signals', () => {
        const detected = detectTemplateProfile([
            '\\newcommand{\\mystyle}{custom}',
            '$body$',
        ].join('\n'));

        expect(detected.usageContext).toBe('unknown');
        expect(detected.styleHint).toBe('custom');
        expect(detected.mockPreviewKind).toBe('generic');
        expect(detected.traits).toEqual(['Pandoc manuscript body hook', 'Custom LaTeX styling']);
    });
});
