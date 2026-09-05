import { describe, expect, it } from 'vitest';

/**
 * Regression: a deactivated font produced only "Pandoc export failed during
 * PDF compilation." The engine had already said exactly which font and why —
 * that detail was collected into `detail` and then dropped from the message
 * the user actually reads. fontspec wraps the error across lines with a
 * "(fontspec)" gutter, so the extraction must survive that shape.
 */
describe('categorizeExportError — missing font', () => {
    const fontspecStderr = [
        'Error producing PDF.',
        '! Package fontspec Error: ',
        '(fontspec)                The font "EB Garamond" cannot be found; this',
        '(fontspec)                may be but usually is not a fontspec bug.',
    ].join('\n');

    it('names the font that could not be loaded', () => {
        const failure = categorizeExportError(new Error(fontspecStderr));
        expect(failure.message).toContain('EB Garamond');
        expect(failure.message).not.toBe('Pandoc export failed during PDF compilation.');
    });

    it('points at deactivation, the cause a user cannot otherwise guess', () => {
        const failure = categorizeExportError(new Error(fontspecStderr));
        expect(failure.message.toLowerCase()).toContain('font book');
    });

    it('keeps the generic message when no font error is present', () => {
        const failure = categorizeExportError(new Error('pandoc: something else went wrong'));
        expect(failure.message).not.toContain('cannot be found');
    });
});
import { categorizeExportError } from './exportErrors';

describe('export error categorization', () => {
    it('categorizes missing dependencies ahead of generic pandoc failures', () => {
        const failure = categorizeExportError('xelatex not found on PATH');
        expect(failure.category).toBe('missing_dependency');
        expect(failure.message).toMatch(/Missing export dependency/i);
    });

    it('categorizes template validation failures', () => {
        const failure = categorizeExportError('Layout "Signature Literary" is invalid: Template file must use a .tex extension.');
        expect(failure.category).toBe('invalid_template');
    });

    it('preserves raw detail for disclosure', () => {
        const failure = categorizeExportError('! LaTeX Error: File `foo.sty` not found.');
        expect(failure.category).toBe('pandoc_compile_failure');
        expect(failure.detail).toContain('foo.sty');
    });
});
